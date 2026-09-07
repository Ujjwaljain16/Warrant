'use strict';

// Canonical JSON and SHA-256, identical to third_party/citadel/core/operations/canonical.js:
// object keys sorted (UTF-16 code-unit order), -0 normalised to 0, non-finite numbers and cycles rejected.
// The hash goes through WebCrypto (crypto.subtle), which exists in every modern browser and in Node 22, so
// the same code is exercised by the tests and by the page.

function canonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical data cannot contain non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError(`Canonical data cannot contain ${typeof value}`);
  if (seen.has(value)) throw new TypeError('Canonical data cannot contain cycles');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, seen));
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Canonical data must use plain JSON objects');
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`Canonical data cannot contain undefined at ${key}`);
      // defineProperty so a hostile "__proto__" key stays an ordinary own property instead of changing the prototype.
      Object.defineProperty(output, key, { value: canonicalValue(value[key], seen), enumerable: true, writable: true, configurable: true });
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function canonicalSerialize(value) {
  return JSON.stringify(canonicalValue(value));
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

// Portable SHA-256 used only when WebCrypto is missing (an insecure context, for example a page opened from a
// data: URL or plain http). The constants are derived, not typed: fractional parts of square and cube roots of primes.
let constants = null;
function sha256Constants() {
  if (constants) return constants;
  const primes = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((q) => n % q !== 0)) primes.push(n);
  const frac = (x) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
  constants = { K: primes.map((q) => frac(Math.cbrt(q))), H: primes.slice(0, 8).map((q) => frac(Math.sqrt(q))) };
  return constants;
}

function sha256HexFallback(bytes) {
  const { K, H: init } = sha256Constants();
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 4294967296));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const H = init.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const v = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) H[i] = (H[i] + v[i]) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

let backend = 'webcrypto';

// 'webcrypto' normally; 'javascript fallback' once a call had to do without crypto.subtle.
function hashBackend() { return backend; }

async function sha256HexOfText(text) {
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) { backend = 'javascript fallback'; return sha256HexFallback(bytes); }
  backend = 'webcrypto';
  return toHex(await subtle.digest('SHA-256', bytes));
}

async function sha256Digest(value) {
  return `sha256:${await sha256HexOfText(canonicalSerialize(value))}`;
}

module.exports = { canonicalSerialize, canonicalValue, hashBackend, sha256Digest, sha256HexFallback, sha256HexOfText };
