'use strict';

class Emitter {
  constructor() {
    this._listeners = new Map();
  }

  _add(event, listener, once) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const entry = { listener, once };
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(entry);
    return () => { this._remove(event, entry); };
  }

  _remove(event, entry) {
    const list = this._listeners.get(event);
    if (!list) return false;
    const index = list.indexOf(entry);
    if (index === -1) return false;
    list.splice(index, 1);
    return true;
  }

  on(event, listener) { return this._add(event, listener, false); }
  once(event, listener) { return this._add(event, listener, true); }

  off(event, listener) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const list = this._listeners.get(event);
    if (!list) return false;
    const entry = list.find((e) => e.listener === listener);
    return entry ? this._remove(event, entry) : false;
  }

  emit(event, ...args) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');
    const list = this._listeners.get(event);
    if (!list || list.length === 0) return false;
    for (const entry of [...list]) {
      if (entry.once && !this._remove(event, entry)) continue;
      entry.listener(...args);
    }
    return true;
  }

  listenerCount(event) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');
    const list = this._listeners.get(event);
    return list ? list.length : 0;
  }
}

module.exports = { Emitter };
