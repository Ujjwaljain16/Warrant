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
    const registrations = this._events.get(event);
    const registration = { listener, once: false };
    registrations.push(registration);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = registrations.indexOf(registration);
      if (idx !== -1) {
        registrations.splice(idx, 1);
      }
    };
  }

  once(event, listener) {
    this._validate(event, listener);
    if (!this._events.has(event)) {
      this._events.set(event, []);
    }
    const registrations = this._events.get(event);
    const registration = { listener, once: true };
    registrations.push(registration);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = registrations.indexOf(registration);
      if (idx !== -1) {
        registrations.splice(idx, 1);
      }
    };
  }

  off(event, listener) {
    this._validate(event, listener);
    const registrations = this._events.get(event);
    if (!registrations) {
      return false;
    }
    const idx = registrations.findIndex(r => r.listener === listener);
    if (idx !== -1) {
      registrations.splice(idx, 1);
      return true;
    }
    return false;
  }

  emit(event, ...args) {
    if (typeof event !== 'string') {
      throw new TypeError('Event must be a string');
    }
    const registrations = this._events.get(event);
    if (!registrations || registrations.length === 0) {
      return false;
    }

    const snapshot = [...registrations];

    for (const reg of snapshot) {
      if (reg.once) {
        const idx = registrations.indexOf(reg);
        if (idx !== -1) {
          registrations.splice(idx, 1);
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
    const registrations = this._events.get(event);
    return registrations ? registrations.length : 0;
  }
}

module.exports = { Emitter };
