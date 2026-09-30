'use strict';

class Emitter {
  constructor() {
    this._events = new Map();
  }

  _validate(event, listener) {
    if (typeof event !== 'string') {
      throw new TypeError('Event must be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
  }

  on(event, listener) {
    this._validate(event, listener);
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    const listeners = this._events.get(event);
    const reg = { listener, once: false };
    listeners.push(reg);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const index = listeners.indexOf(reg);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this._events.delete(event);
        }
      }
    };
  }

  once(event, listener) {
    this._validate(event, listener);
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    const listeners = this._events.get(event);
    const reg = { listener, once: true };
    listeners.push(reg);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const index = listeners.indexOf(reg);
      if (index !== -1) {
        listeners.splice(index, 1);
        if (listeners.length === 0) {
          this._events.delete(event);
        }
      }
    };
  }

  off(event, listener) {
    this._validate(event, listener);
    const listeners = this._events.get(event);
    if (!listeners) return false;

    const index = listeners.findIndex(reg => reg.listener === listener);
    if (index === -1) return false;

    listeners.splice(index, 1);
    if (listeners.length === 0) {
      this._events.delete(event);
    }
    return true;
  }

  emit(event, ...args) {
    if (typeof event !== 'string') {
      throw new TypeError('Event must be a string');
    }
    const listeners = this._events.get(event);
    if (!listeners || listeners.length === 0) {
      return false;
    }

    const snapshot = [...listeners];

    for (const reg of snapshot) {
      if (reg.once) {
        const currentListeners = this._events.get(event);
        if (currentListeners) {
          const idx = currentListeners.indexOf(reg);
          if (idx !== -1) {
            currentListeners.splice(idx, 1);
            if (currentListeners.length === 0) {
              this._events.delete(event);
            }
          }
        }
        if (reg._calledOnce) {
          continue;
        }
        reg._calledOnce = true;
      }

      reg.listener(...args);
    }

    return true;
  }

  listenerCount(event) {
    if (typeof event !== 'string') {
      throw new TypeError('Event must be a string');
    }
    const listeners = this._events.get(event);
    return listeners ? listeners.length : 0;
  }
}

module.exports = { Emitter };
