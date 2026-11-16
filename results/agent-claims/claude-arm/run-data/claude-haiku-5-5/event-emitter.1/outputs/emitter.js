'use strict';

function checkEvent(event) {
  if (typeof event !== 'string') {
    throw new TypeError('event must be a string');
  }
}

function checkListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('listener must be a function');
  }
}

class Emitter {
  constructor() {
    // event name -> array of registration entries, in registration order
    this._events = new Map();
  }

  _add(event, listener, once) {
    checkEvent(event);
    checkListener(listener);
    const entry = { listener, once, fired: false };
    let list = this._events.get(event);
    if (!list) {
      list = [];
      this._events.set(event, list);
    }
    list.push(entry);
    return entry;
  }

  _remove(event, entry) {
    const list = this._events.get(event);
    if (!list) return false;
    const i = list.indexOf(entry);
    if (i === -1) return false;
    list.splice(i, 1);
    if (list.length === 0) this._events.delete(event);
    return true;
  }

  on(event, listener) {
    const entry = this._add(event, listener, false);
    return () => {
      this._remove(event, entry);
    };
  }

  once(event, listener) {
    const entry = this._add(event, listener, true);
    return () => {
      this._remove(event, entry);
    };
  }

  off(event, listener) {
    checkEvent(event);
    checkListener(listener);
    const list = this._events.get(event);
    if (!list) return false;
    const entry = list.find((e) => e.listener === listener);
    if (!entry) return false;
    return this._remove(event, entry);
  }

  emit(event, ...args) {
    checkEvent(event);
    const list = this._events.get(event);
    if (!list || list.length === 0) return false;
    // Decide the listeners to call up front: additions during this emit
    // are not called, removals during this emit do not stop the call.
    const snapshot = list.slice();
    for (const entry of snapshot) {
      if (entry.once) {
        if (entry.fired) continue;
        entry.fired = true;
        this._remove(event, entry);
      }
      entry.listener(...args);
    }
    return true;
  }

  listenerCount(event) {
    checkEvent(event);
    const list = this._events.get(event);
    return list ? list.length : 0;
  }
}

module.exports = { Emitter };
