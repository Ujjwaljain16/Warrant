'use strict';

// The membrane: lets code in one container use objects that live in another container as if they were local.
//
// Two peers speak a JSON-lines protocol (relayed by the host, see ../relay.js). A peer exports an object by giving it an
// id and the other side builds a Proxy for it. Calls into the other peer are synchronous (Atomics.wait while the answer
// travels) so a test written for in-process code keeps working unchanged; while a peer waits, it still serves requests
// coming from the other side (callbacks), so calls nest like a stack.
//
//   functions, arrays, plain and class objects  cross by reference (Proxy; a snapshot of own properties is cached until
//                                               either peer runs code, so reading a result costs no round trip)
//   Date, RegExp, Map, Set, typed arrays, Error cross by value (copies; a copy handed back resolves to the original object)
//   promises                                    become promises on the other side, settled by a message
//   primitives                                  tagged where JSON cannot carry them (undefined, NaN, -0, bigint, symbols)
//
// The verdict side (guard = true) never hands the solution a built-in object or function of its own realm (Function,
// Object.prototype, ...): from `fn.constructor` the solution could otherwise reach `Function` and run code in the
// verdict process. Only a short list of pure built-ins (Math.floor, String, ...) is passed, as call-only references.

const { types } = require('node:util');

const MAX_INLINE_NODES = 20_000;
const MAX_INLINE_DEPTH = 48;
const LAZY_LENGTH = 50_000;
const MAX_TABLE = 2_000_000;
const MAX_STACK = 4000;

const F_ENUMERABLE = 1;
const F_WRITABLE = 2;
const F_CONFIGURABLE = 4;
const F_ACCESSOR = 8;
const F_GETTER = 16;
const F_SETTER = 32;

const HOLE = Object.freeze({ t: 'h' });
const ASYNC_FUNCTION_PROTO = Object.getPrototypeOf(async () => {});
const GENERATOR_FUNCTION_PROTO = Object.getPrototypeOf(function* generator() {});
const ERROR_ORDER = ['TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'Error'];
const ERROR_CTORS = Object.assign(Object.create(null), { Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, AggregateError });
const WELL_KNOWN = new Map();
for (const name of Object.getOwnPropertyNames(Symbol)) if (typeof Symbol[name] === 'symbol') WELL_KNOWN.set(Symbol[name], name);
const WELL_KNOWN_BY_NAME = new Map([...WELL_KNOWN].map(([symbol, name]) => [name, symbol]));
const NUMBER_WORDS = new Set(['NaN', 'Infinity', '-Infinity', '-0']);

class GateError extends Error {
  constructor(message) { super(message); this.name = 'GateError'; }
}

// ---------------------------------------------------------------- the verdict side's list of things it must never export

function collectIntrinsics() {
  const seen = new Set();
  const visit = (value, depth) => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null || seen.has(value) || depth > 4) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      let d;
      try { d = Object.getOwnPropertyDescriptor(value, key); } catch (_error) { continue; }
      if (!d) continue;
      if ('value' in d) visit(d.value, depth + 1); else { visit(d.get, depth + 1); visit(d.set, depth + 1); }
    }
    try { visit(Object.getPrototypeOf(value), depth + 1); } catch (_error) { /* exotic */ }
  };
  visit(globalThis, 0);
  for (const sample of [async () => {}, function* gen() {}, async function* agen() {}, new Uint8Array(0), Symbol.iterator, [][Symbol.iterator](), new Map()[Symbol.iterator](), (function () { return arguments; })()]) {
    visit(sample, 0);
    try { visit(Object.getPrototypeOf(sample), 0); } catch (_error) { /* primitive */ }
  }
  visit(Object.getPrototypeOf(async () => {}).constructor, 0);
  visit(Object.getPrototypeOf(function* gen() {}).constructor, 0);
  visit(Object.getPrototypeOf(async function* agen() {}).constructor, 0);
  visit(Object.getPrototypeOf(Uint8Array), 0);
  return seen;
}

// Pure built-ins a test may legitimately pass as a callback (uniqueBy(items, String), ...). Passed as call-only references.
function allowedCallables() {
  const set = new Set([Number, String, Boolean, BigInt, parseInt, parseFloat, isNaN, isFinite, Array.isArray, JSON.stringify, JSON.parse,
    Object.keys, Object.values, Object.entries, Number.isInteger, Number.isFinite, Number.isNaN, Number.isSafeInteger, Math.max, Math.min]);
  for (const name of Object.getOwnPropertyNames(Math)) if (typeof Math[name] === 'function') set.add(Math[name]);
  for (const name of ['toLowerCase', 'toUpperCase', 'trim', 'toString']) set.add(String.prototype[name]);
  return set;
}

// ---------------------------------------------------------------- small helpers

const numberToWire = (n) => (Number.isFinite(n) && !Object.is(n, -0) ? n : { t: 'n', v: Object.is(n, -0) ? '-0' : String(n) });

function numberFromWire(word) {
  if (!NUMBER_WORDS.has(word)) throw new TypeError('bad number');
  return word === '-0' ? -0 : Number(word);
}

const isIndexKey = (key) => typeof key === 'string' && /^(?:0|[1-9]\d{0,9})$/.test(key) && Number(key) < 4294967295;

function errorKind(error) {
  for (const name of ERROR_ORDER) if (error instanceof ERROR_CTORS[name]) return name;
  return 'Error';
}

const safeString = (fn, fallback) => { try { const s = fn(); return typeof s === 'string' ? s : fallback; } catch (_error) { return fallback; } };

// ---------------------------------------------------------------- the membrane

class Membrane {
  constructor({ channel, guard = false, label = 'peer', keepAlive = false }) {
    this.channel = channel;
    this.keepAlive = keepAlive;
    this.guard = guard;
    this.label = label;
    this.intrinsics = guard ? collectIntrinsics() : null;
    this.allowed = guard ? allowedCallables() : null;
    this.epoch = 0;
    this.closed = false;
    this.closeReason = '';
    this.nextCall = 1;
    this.nextExport = 1;
    this.waiting = new Set();
    this.results = new Map();
    this.exports = new Map(); // id -> object I handed out
    this.exportIds = new WeakMap();
    this.opaque = new Set(); // ids of call-only exports
    this.symbolIds = new Map();
    this.symbolsById = new Map();
    this.remote = new Map(); // id -> meta of a proxy for an object that lives in the peer
    this.proxies = new WeakMap(); // my proxy -> meta
    this.copies = new Map(); // id -> my local copy of a by-value object of the peer
    this.copyIds = new WeakMap();
    this.remoteSymbols = new Map();
    this.remoteSymbolIds = new Map();
    this.remotePromises = new Map();
    this.watched = new WeakSet();
    this.stack = 0;
    this.pendingPromises = 0;
    this.stats = { calls: 0, served: 0, snaps: 0, bytesOut: 0, byOp: Object.create(null) };
    this.onLoad = null;
    this.onClose = null;
    this.onUnhandledRejection = null;
    this.onFatal = null;
    channel.onMessage((raw) => this.receive(raw));
    if (keepAlive) channel.ref();
  }

  // ------------------------------------------------------------ transport

  send(message) {
    const text = JSON.stringify(message);
    this.stats.bytesOut += text.length;
    this.channel.send(text);
  }

  receive(raw) {
    if (raw === null) { this.close('the other process closed the protocol stream'); return; }
    let msg;
    try { msg = JSON.parse(raw); } catch (_error) { return; }
    if (msg === null || typeof msg !== 'object' || typeof msg.op !== 'string') return;
    switch (msg.op) {
      case 'ret':
        if (this.waiting.has(msg.i)) this.results.set(msg.i, msg);
        break;
      case 'settle': this.settle(msg); break;
      case 'urej': this.epoch++; this.guarded(() => { if (this.onUnhandledRejection) this.onUnhandledRejection(this.decode(msg.v)); }); break;
      default: this.serve(msg);
    }
  }

  guarded(fn) {
    try { fn(); } catch (error) { if (this.onFatal) this.onFatal(error); }
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const p of this.remotePromises.values()) if (!p.done) this.finish(p, (e) => p.reject(e), new Error(reason));
    if (this.onClose) this.guarded(() => this.onClose(reason));
  }

  // Sends a request and runs the nested event loop until its answer arrives (serving requests from the other side meanwhile).
  call(op, fields, mutates = false) {
    if (this.closed) throw new GateError(this.closeReason);
    if (this.stack > MAX_STACK) throw new GateError('membrane call stack too deep');
    if (mutates) this.epoch++;
    const i = this.nextCall++;
    this.stats.calls++;
    this.stats.byOp[op] = (this.stats.byOp[op] || 0) + 1;
    this.waiting.add(i);
    this.send({ op, i, ...fields });
    this.stack++;
    try {
      for (;;) {
        const r = this.results.get(i);
        if (r) { this.results.delete(i); return r; }
        if (this.closed) throw new GateError(this.closeReason);
        const raw = this.channel.wait(() => this.channel.poll(), 1000);
        if (raw !== undefined) this.receive(raw);
      }
    } finally {
      this.stack--;
      this.waiting.delete(i);
    }
  }

  invoke(op, fields, mutates) {
    const reply = this.call(op, fields, mutates);
    if (reply.ok === true) return this.decode(reply.v);
    throw this.decode(reply.e);
  }

  // ------------------------------------------------------------ serving requests from the other peer

  serve(msg) {
    this.stats.served++;
    if (typeof msg.i !== 'number') return;
    if (msg.op !== 'get' && msg.op !== 'has' && msg.op !== 'snap' && msg.op !== 'own' && msg.op !== 'gopd') this.epoch++;
    let reply;
    try {
      const result = this.perform(msg);
      reply = { op: 'ret', i: msg.i, ok: true, v: msg.op === 'own' ? result.map((k) => this.encodeKey(k)) : this.encode(result) };
    } catch (error) {
      let encoded;
      try { encoded = this.encode(error); } catch (_inner) { encoded = this.encode(new Error(String(error && error.message))); }
      reply = { op: 'ret', i: msg.i, ok: false, e: encoded };
    }
    this.send(reply);
  }

  exported(id, { callOnly = false } = {}) {
    const object = this.exports.get(id);
    if (object === undefined) throw new GateError('unknown object');
    if (this.opaque.has(id) && !callOnly) throw new GateError('this built-in can only be called');
    return object;
  }

  perform(msg) {
    switch (msg.op) {
      case 'apply': return Reflect.apply(this.exported(msg.f, { callOnly: true }), this.decode(msg.th), this.decodeList(msg.a));
      case 'new': return Reflect.construct(this.exported(msg.f, { callOnly: true }), this.decodeList(msg.a));
      case 'get': return Reflect.get(this.exported(msg.o), this.decodeKey(msg.k));
      case 'has': return Reflect.has(this.exported(msg.o), this.decodeKey(msg.k));
      case 'set': { const key = this.decodeKey(msg.k); if (key === '__proto__') return false; return Reflect.set(this.exported(msg.o), key, this.decode(msg.v)); }
      case 'del': { const key = this.decodeKey(msg.k); if (key === '__proto__') return false; return Reflect.deleteProperty(this.exported(msg.o), key); }
      case 'def': { const key = this.decodeKey(msg.k); if (key === '__proto__') return false; return Reflect.defineProperty(this.exported(msg.o), key, this.decodeDescriptor(msg.d)); }
      case 'own': return Reflect.ownKeys(this.exported(msg.o));
      case 'gopd': return this.describeProperty(Reflect.getOwnPropertyDescriptor(this.exported(msg.o), this.decodeKey(msg.k)));
      case 'snap': this.stats.snaps++; return this.exported(msg.o);
      case 'load': if (!this.onLoad) throw new GateError('this process loads nothing'); return this.onLoad(msg.file);
      default: throw new GateError(`unknown operation ${String(msg.op).slice(0, 20)}`);
    }
  }

  decodeList(list) {
    if (!Array.isArray(list)) throw new GateError('bad argument list');
    return list.map((w) => this.decode(w));
  }

  describeProperty(d) {
    if (!d) return undefined;
    const out = { enumerable: d.enumerable, configurable: d.configurable };
    if ('value' in d) { out.value = d.value; out.writable = d.writable; } else { out.get = d.get; out.set = d.set; }
    return out;
  }

  decodeDescriptor(w) {
    const d = this.decode(w);
    if (d === null || typeof d !== 'object') throw new GateError('bad descriptor');
    const out = {};
    for (const k of ['enumerable', 'configurable', 'writable', 'value', 'get', 'set']) if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
    return out;
  }

  // ------------------------------------------------------------ keys and symbols

  encodeKey(key) { return typeof key === 'symbol' ? this.encodeSymbol(key) : key; }

  decodeKey(w) {
    if (typeof w === 'string') return w;
    const s = this.decode(w);
    if (typeof s !== 'symbol') throw new GateError('bad property key');
    return s;
  }

  encodeSymbol(symbol) {
    const known = WELL_KNOWN.get(symbol);
    if (known) return { t: 'sy', w: known };
    const theirs = this.remoteSymbolIds.get(symbol);
    if (theirs !== undefined) return { t: 'sy', l: theirs };
    const registered = Symbol.keyFor(symbol);
    if (registered !== undefined) return { t: 'sy', f: registered };
    let id = this.symbolIds.get(symbol);
    if (id === undefined) { id = ++this.nextExport; this.symbolIds.set(symbol, id); this.symbolsById.set(id, symbol); }
    return { t: 'sy', id, d: symbol.description === undefined ? null : symbol.description };
  }

  // ------------------------------------------------------------ encoding

  encode(v, ctx = { budget: MAX_INLINE_NODES, depth: 0, seen: new Set() }) {
    const type = typeof v;
    if (type === 'string' || type === 'boolean') return v;
    if (type === 'number') return numberToWire(v);
    if (v === null) return null;
    if (type === 'undefined') return { t: 'u' };
    if (type === 'bigint') return { t: 'b', v: v.toString() };
    if (type === 'symbol') return this.encodeSymbol(v);
    const meta = this.proxies.get(v);
    if (meta) return { t: 'l', id: meta.id };
    const copyId = this.copyIds.get(v);
    if (copyId !== undefined) return { t: 'l', id: copyId };
    return this.encodeLocal(v, ctx);
  }

  classify(v) {
    if (this.guard) {
      if (this.intrinsics.has(v)) {
        if (typeof v === 'function' && this.allowed.has(v)) return 'opaque';
        throw new GateError('a built-in of the verdict process cannot be handed to the solution');
      }
      if (typeof v === 'function' && /\{\s*\[native code\]\s*\}\s*$/.test(safeString(() => Function.prototype.toString.call(v), ''))) {
        throw new GateError('a native function cannot be handed to the solution');
      }
    }
    if (typeof v === 'function') return 'f';
    if (types.isProxy(v)) return Array.isArray(v) ? 'a' : 'o';
    if (types.isDate(v)) return 'date';
    if (types.isRegExp(v)) return 'regexp';
    if (types.isNativeError(v) || v instanceof Error) return 'error';
    if (types.isMap(v)) return 'map';
    if (types.isSet(v)) return 'set';
    if (types.isPromise(v)) return 'promise';
    if (types.isArrayBuffer(v) || types.isTypedArray(v) || types.isDataView(v)) return 'bytes';
    if (Array.isArray(v)) return 'a';
    return 'o';
  }

  encodeLocal(v, ctx) {
    const kind = this.classify(v);
    let id = this.exportIds.get(v);
    if (id === undefined) {
      if (this.exports.size >= MAX_TABLE) throw new GateError('too many exported objects');
      id = ++this.nextExport;
      this.exportIds.set(v, id);
      this.exports.set(id, v);
      if (kind === 'opaque') this.opaque.add(id);
    }
    switch (kind) {
      case 'date': return { t: 'd', id, v: Number.isNaN(v.getTime()) ? null : v.getTime() };
      case 'regexp': return { t: 'x', id, s: v.source, f: v.flags };
      case 'error': return this.encodeError(v, id, ctx);
      case 'map': return { t: 'm', id, e: [...v].map(([a, b]) => [this.encode(a, ctx), this.encode(b, ctx)]) };
      case 'set': return { t: 'S', id, e: [...v].map((a) => this.encode(a, ctx)) };
      case 'bytes': {
        const view = types.isArrayBuffer(v) ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        return { t: 'y', id, c: types.isArrayBuffer(v) ? 'ArrayBuffer' : types.isDataView(v) ? 'DataView' : v.constructor.name, b: Buffer.from(view).toString('base64') };
      }
      case 'promise': this.watch(v, id); return { t: 'r', id, k: 'P' };
      case 'opaque': return { t: 'r', id, k: 'f', op: 1 };
      default: return this.encodeRef(v, id, kind, ctx);
    }
  }

  encodeRef(v, id, kind, ctx) {
    const ref = { t: 'r', id, k: kind };
    const proxy = types.isProxy(v);
    const lazy = proxy || (kind === 'a' && v.length > LAZY_LENGTH);
    if (lazy) { ref.lz = 1; ref.s = { pr: kind === 'a' ? 'A' : 'O', lz: 1 }; return ref; }
    if (ctx.budget > 0 && ctx.depth < MAX_INLINE_DEPTH && !ctx.seen.has(v)) ref.s = this.snapshot(v, kind, ctx);
    return ref;
  }

  snapshot(v, kind, ctx) {
    ctx.budget--;
    ctx.depth++;
    ctx.seen.add(v);
    try {
      const s = { pr: this.encodeProto(v, kind, ctx) };
      if (Object.isFrozen(v)) s.fz = 1; else if (Object.isSealed(v)) s.sl = 1; else if (!Object.isExtensible(v)) s.ne = 1;
      if (kind === 'a') {
        const n = v.length;
        const el = new Array(n);
        for (let i = 0; i < n; i++) { ctx.budget--; el[i] = i in v ? this.encode(v[i], ctx) : HOLE; }
        s.n = n;
        s.el = el;
        s.e = this.entries(v, (k) => !isIndexKey(k) && k !== 'length', ctx);
      } else {
        s.e = this.entries(v, null, ctx);
      }
      return s;
    } finally {
      ctx.depth--;
    }
  }

  entries(v, skip, ctx) {
    const out = [];
    for (const key of Reflect.ownKeys(v)) {
      if (skip && !skip(key)) continue;
      const d = Reflect.getOwnPropertyDescriptor(v, key);
      if (!d) continue;
      let flags = (d.enumerable ? F_ENUMERABLE : 0) | (d.configurable ? F_CONFIGURABLE : 0);
      const k = this.encodeKey(key);
      if ('value' in d) {
        flags |= d.writable ? F_WRITABLE : 0;
        ctx.budget--;
        out.push([k, flags, this.encode(d.value, ctx)]);
      } else {
        flags |= F_ACCESSOR | (d.get ? F_GETTER : 0) | (d.set ? F_SETTER : 0);
        out.push([k, flags]);
      }
    }
    return out;
  }

  encodeProto(v, kind, ctx) {
    const p = Object.getPrototypeOf(v);
    if (p === null) return 'N';
    if (p === Object.prototype) return 'O';
    if (p === Array.prototype) return 'A';
    if (p === Function.prototype) return 'F';
    if (this.guard && this.intrinsics.has(p)) return kind === 'f' ? 'F' : kind === 'a' ? 'A' : 'O';
    if (p === ASYNC_FUNCTION_PROTO || p === GENERATOR_FUNCTION_PROTO) return 'F';
    return this.encode(p, ctx);
  }

  encodeError(error, id, ctx) {
    const props = [];
    for (const key of Reflect.ownKeys(error)) {
      if (typeof key !== 'string' || key === 'stack' || key === 'message') continue;
      const d = Reflect.getOwnPropertyDescriptor(error, key);
      if (d && 'value' in d && d.enumerable) props.push([key, this.encode(d.value, ctx)]);
    }
    const w = {
      t: 'E', id, n: errorKind(error), name: safeString(() => error.name, 'Error').slice(0, 80), m: safeString(() => error.message, '').slice(0, 20_000),
      st: safeString(() => error.stack, '').slice(0, 4000), p: props,
    };
    if (error instanceof AggregateError && Array.isArray(error.errors)) w.ag = error.errors.slice(0, 50).map((e) => this.encode(e, ctx));
    if (Object.prototype.hasOwnProperty.call(error, 'cause')) w.c = this.encode(error.cause, ctx);
    return w;
  }

  watch(promise, id) {
    if (this.watched.has(promise)) return;
    this.watched.add(promise);
    const out = (ok, value) => {
      if (this.closed) return;
      let v;
      let good = ok;
      try { v = this.encode(value); } catch (error) { good = false; v = this.encode(error); }
      this.send({ op: 'settle', p: id, ok: good, v });
    };
    promise.then((value) => out(true, value), (reason) => out(false, reason));
  }

  // ------------------------------------------------------------ decoding

  decode(w) {
    if (w === null) return null;
    const type = typeof w;
    if (type === 'string' || type === 'boolean' || type === 'number') return w;
    if (type !== 'object') throw new GateError('bad wire value');
    switch (w.t) {
      case 'u': return undefined;
      case 'n': return numberFromWire(w.v);
      case 'b': return BigInt(w.v);
      case 'sy': return this.decodeSymbol(w);
      case 'l': { const v = this.exports.get(w.id); if (v === undefined) throw new GateError('unknown object'); return v; }
      case 'r': return this.decodeRef(w);
      case 'd': return this.copy(w.id, () => new Date(w.v === null ? NaN : w.v));
      case 'x': return this.copy(w.id, () => new RegExp(String(w.s), String(w.f)));
      case 'm': return this.copy(w.id, () => new Map(w.e.map(([a, b]) => [this.decode(a), this.decode(b)])));
      case 'S': return this.copy(w.id, () => new Set(w.e.map((a) => this.decode(a))));
      case 'y': return this.copy(w.id, () => this.decodeBytes(w));
      case 'E': return this.copy(w.id, () => this.decodeError(w));
      default: throw new GateError('bad wire value');
    }
  }

  copy(id, make) {
    if (typeof id !== 'number') throw new GateError('bad wire value');
    let c = this.copies.get(id);
    if (c !== undefined) return c;
    if (this.copies.size >= MAX_TABLE) throw new GateError('too many objects');
    c = make();
    this.copies.set(id, c);
    this.copyIds.set(c, id);
    return c;
  }

  decodeBytes(w) {
    const buf = Buffer.from(String(w.b), 'base64');
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    if (w.c === 'ArrayBuffer') return ab;
    if (w.c === 'DataView') return new DataView(ab);
    if (w.c === 'Buffer') return Buffer.from(ab);
    const Ctor = { Uint8Array, Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array }[w.c];
    if (!Ctor) throw new GateError('bad typed array');
    return new Ctor(ab);
  }

  decodeError(w) {
    const Ctor = ERROR_CTORS[w.n] || Error;
    const error = w.n === 'AggregateError' ? new AggregateError(Array.isArray(w.ag) ? w.ag.map((e) => this.decode(e)) : [], String(w.m)) : new Ctor(String(w.m));
    Object.defineProperty(error, 'stack', { value: String(w.st), writable: true, configurable: true, enumerable: false });
    if (typeof w.name === 'string' && w.name !== error.name) Object.defineProperty(error, 'name', { value: w.name, writable: true, configurable: true, enumerable: false });
    if (w.c !== undefined) Object.defineProperty(error, 'cause', { value: this.decode(w.c), writable: true, configurable: true, enumerable: false });
    for (const [k, v] of w.p || []) Object.defineProperty(error, String(k), { value: this.decode(v), writable: true, configurable: true, enumerable: true });
    return error;
  }

  decodeSymbol(w) {
    if (w.w !== undefined) { const s = WELL_KNOWN_BY_NAME.get(w.w); if (!s) throw new GateError('bad symbol'); return s; }
    if (w.f !== undefined) return Symbol.for(String(w.f));
    if (w.l !== undefined) { const mine = this.symbolsById.get(w.l); if (mine === undefined) throw new GateError('unknown symbol'); return mine; }
    if (typeof w.id !== 'number') throw new GateError('bad symbol');
    let s = this.remoteSymbols.get(w.id);
    if (!s) { s = Symbol(w.d === null || w.d === undefined ? undefined : String(w.d)); this.remoteSymbols.set(w.id, s); this.remoteSymbolIds.set(s, w.id); }
    return s;
  }

  decodeRef(w) {
    if (typeof w.id !== 'number') throw new GateError('bad wire value');
    if (w.k === 'P') return this.remotePromise(w.id);
    let meta = this.remote.get(w.id);
    if (!meta) {
      if (this.remote.size >= MAX_TABLE) throw new GateError('too many objects');
      meta = this.makeProxy(w.id, w.k, w.lz === 1, w.op === 1);
      this.remote.set(w.id, meta);
    }
    if (w.s) this.applySnapshot(meta, w.s);
    return meta.proxy;
  }

  remotePromise(id) {
    let p = this.remotePromises.get(id);
    if (!p) {
      p = { done: false };
      p.promise = new Promise((resolve, reject) => { p.resolve = resolve; p.reject = reject; });
      this.remotePromises.set(id, p);
      this.copyIds.set(p.promise, id);
      if (this.closed) p.reject(new Error(this.closeReason)); else if (++this.pendingPromises === 1) this.channel.ref();
    }
    return p.promise;
  }

  settle(msg) {
    this.epoch++;
    const p = this.remotePromises.get(msg.p);
    if (!p || p.done) return;
    let value;
    try { value = this.decode(msg.v); } catch (error) { this.finish(p, p.reject, error); return; }
    this.finish(p, msg.ok === true ? p.resolve : p.reject, value);
  }

  // Settles a mirrored promise once and lets the process finish when no mirrored promise is still waiting.
  finish(p, how, value) {
    p.done = true;
    how(value);
    if (--this.pendingPromises === 0 && !this.keepAlive) this.channel.unref();
  }

  // ------------------------------------------------------------ proxies for the peer's objects

  makeProxy(id, kind, lazy, opaque) {
    const target = kind === 'a' ? [] : kind === 'f' ? function () {} : {};
    const meta = { id, kind, lazy, opaque, target, proxy: null, epoch: -1, userProto: null };
    const m = this;
    meta.proxy = new Proxy(target, {
      get: (t, k, r) => m.trapGet(meta, k, r),
      set: (t, k, v) => m.invoke('set', { o: id, k: m.encodeKey(k), v: m.encode(v) }, true),
      has: (t, k) => m.trapHas(meta, k),
      deleteProperty: (t, k) => m.invoke('del', { o: id, k: m.encodeKey(k) }, true),
      defineProperty: (t, k, d) => m.invoke('def', { o: id, k: m.encodeKey(k), d: m.encode(m.descriptorObject(d)) }, true),
      ownKeys: (t) => m.trapOwnKeys(meta),
      getOwnPropertyDescriptor: (t, k) => m.trapGopd(meta, k),
      getPrototypeOf: (t) => m.trapProto(meta),
      setPrototypeOf: () => false,
      apply: (t, thisArg, args) => m.invoke('apply', { f: id, th: m.encode(thisArg), a: args.map((a) => m.encode(a)) }, true),
      construct: (t, args, newTarget) => {
        if (newTarget !== meta.proxy) throw new TypeError('classes from the other process cannot be extended');
        return m.invoke('new', { f: id, a: args.map((a) => m.encode(a)) }, true);
      },
    });
    this.proxies.set(meta.proxy, meta);
    return meta;
  }

  descriptorObject(d) {
    const out = {};
    for (const k of ['enumerable', 'configurable', 'writable', 'value', 'get', 'set']) if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = d[k];
    return out;
  }

  applySnapshot(meta, s) {
    meta.epoch = this.epoch;
    if (s.lz === 1) { meta.lazy = true; return; }
    const t = meta.target;
    for (const key of Reflect.ownKeys(t)) {
      if ((meta.kind === 'f' && key === 'prototype') || (meta.kind === 'a' && key === 'length')) continue;
      const d = Reflect.getOwnPropertyDescriptor(t, key);
      if (d && d.configurable) Reflect.deleteProperty(t, key);
    }
    if (Object.isFrozen(t) && Reflect.ownKeys(t).length > 0) return; // a frozen mirror can only mean the original froze too; its content can not change
    meta.userProto = s.pr !== null && typeof s.pr === 'object' ? s.pr : null;
    if (meta.userProto === null) Reflect.setPrototypeOf(t, s.pr === 'N' ? null : s.pr === 'A' ? Array.prototype : s.pr === 'F' ? Function.prototype : Object.prototype);
    if (meta.kind === 'a') {
      Reflect.set(t, 'length', s.n);
      for (let i = 0; i < s.n; i++) {
        const w = s.el[i];
        if (w !== null && typeof w === 'object' && w.t === 'h') continue;
        Object.defineProperty(t, i, { value: this.decode(w), writable: true, enumerable: true, configurable: true });
      }
    }
    for (const [kw, flags, vw] of s.e) {
      const key = this.decodeKey(kw);
      if (meta.kind === 'f' && key === 'prototype') { t.prototype = this.decode(vw); continue; }
      const desc = { enumerable: (flags & F_ENUMERABLE) !== 0, configurable: (flags & F_CONFIGURABLE) !== 0 };
      if (flags & F_ACCESSOR) {
        const m = this;
        const k = this.encodeKey(key);
        desc.get = flags & F_GETTER ? function () { return m.invoke('get', { o: meta.id, k }, false); } : undefined;
        desc.set = flags & F_SETTER ? function (v) { m.invoke('set', { o: meta.id, k, v: m.encode(v) }, true); } : undefined;
      } else {
        desc.value = this.decode(vw);
        desc.writable = (flags & F_WRITABLE) !== 0;
      }
      try { Object.defineProperty(t, key, desc); } catch (_error) { /* a non-configurable mirror property that already exists keeps its value */ }
    }
    if (meta.kind === 'f' && !s.e.some(([kw]) => kw === 'prototype')) t.prototype = undefined;
    if (s.fz) Object.freeze(t); else if (s.sl) Object.seal(t); else if (s.ne) Object.preventExtensions(t);
  }

  fresh(meta) {
    if (meta.lazy || meta.epoch === this.epoch) return;
    this.invoke('snap', { o: meta.id }, false);
    if (meta.epoch !== this.epoch) meta.epoch = this.epoch;
  }

  trapGet(meta, key, receiver) {
    if (meta.opaque) return undefined;
    if (meta.lazy) return this.invoke('get', { o: meta.id, k: this.encodeKey(key) }, false);
    this.fresh(meta);
    const d = Reflect.getOwnPropertyDescriptor(meta.target, key);
    if (d) {
      if ('value' in d) return d.value;
      return d.get ? d.get.call(receiver) : undefined;
    }
    if (meta.userProto !== null) {
      if (key === Symbol.hasInstance && meta.kind === 'f') return Function.prototype[Symbol.hasInstance];
      return this.invoke('get', { o: meta.id, k: this.encodeKey(key) }, false);
    }
    return Reflect.get(meta.target, key, receiver);
  }

  trapHas(meta, key) {
    if (meta.opaque) return false;
    if (meta.lazy) return this.invoke('has', { o: meta.id, k: this.encodeKey(key) }, false);
    this.fresh(meta);
    if (Reflect.getOwnPropertyDescriptor(meta.target, key)) return true;
    if (meta.userProto !== null) return this.invoke('has', { o: meta.id, k: this.encodeKey(key) }, false);
    return Reflect.has(meta.target, key);
  }

  trapOwnKeys(meta) {
    if (meta.opaque) return Reflect.ownKeys(meta.target);
    if (meta.lazy) {
      const reply = this.call('own', { o: meta.id });
      if (reply.ok !== true) throw this.decode(reply.e);
      const out = reply.v.map((w) => this.decodeKey(w));
      for (const k of Reflect.ownKeys(meta.target)) if (!out.includes(k)) out.push(k);
      return out;
    }
    this.fresh(meta);
    return Reflect.ownKeys(meta.target);
  }

  trapGopd(meta, key) {
    if (meta.opaque) return Reflect.getOwnPropertyDescriptor(meta.target, key);
    if (meta.lazy) {
      const d = this.invoke('gopd', { o: meta.id, k: this.encodeKey(key) }, false);
      if (d === undefined) return undefined;
      const own = Reflect.getOwnPropertyDescriptor(meta.target, key);
      if (own && !own.configurable) return { ...own, value: 'value' in d ? d.value : undefined };
      return { ...d, configurable: true };
    }
    this.fresh(meta);
    const d = Reflect.getOwnPropertyDescriptor(meta.target, key);
    if (meta.kind === 'f' && key === 'prototype' && d) return { ...d, value: meta.target.prototype };
    return d;
  }

  trapProto(meta) {
    if (!meta.lazy) this.fresh(meta);
    if (meta.userProto === null) return Reflect.getPrototypeOf(meta.target);
    return this.decode(meta.userProto);
  }
}

module.exports = { GateError, Membrane };
