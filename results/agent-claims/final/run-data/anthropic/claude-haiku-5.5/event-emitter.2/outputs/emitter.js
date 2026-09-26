'use strict';

class Emitter {
  constructor() {
    this.events = new Map();
  }

  on(event, listener) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    const listeners = this.events.get(event);
    listeners.push({ fn: listener, once: false });

    return () => {
      const index = listeners.findIndex(item => item.fn === listener && !item.once);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  once(event, listener) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    const listeners = this.events.get(event);
    listeners.push({ fn: listener, once: true });

    return () => {
      const index = listeners.findIndex(item => item.fn === listener && item.once);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  off(event, listener) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    if (!this.events.has(event)) {
      return false;
    }

    const listeners = this.events.get(event);
    const index = listeners.findIndex(item => item.fn === listener);

    if (index !== -1) {
      listeners.splice(index, 1);
      return true;
    }

    return false;
  }

  emit(event, ...args) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }

    if (!this.events.has(event)) {
      return false;
    }

    const listeners = this.events.get(event);
    const toCall = listeners.slice();

    for (const item of toCall) {
      if (item.once) {
        const index = listeners.indexOf(item);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }
      item.fn(...args);
    }

    return toCall.length > 0;
  }

  listenerCount(event) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }

    if (!this.events.has(event)) {
      return 0;
    }

    return this.events.get(event).length;
  }
}

module.exports = { Emitter };
