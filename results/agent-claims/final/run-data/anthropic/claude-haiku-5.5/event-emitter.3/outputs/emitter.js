'use strict';

class Emitter {
  constructor() {
    this.events = {};
  }

  on(event, listener) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    if (!this.events[event]) {
      this.events[event] = [];
    }

    this.events[event].push(listener);

    return () => {
      this.off(event, listener);
    };
  }

  once(event, listener) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    const wrappedListener = (...args) => {
      this.off(event, wrappedListener);
      listener(...args);
    };

    wrappedListener.original = listener;

    if (!this.events[event]) {
      this.events[event] = [];
    }

    this.events[event].push(wrappedListener);

    return () => {
      this.off(event, wrappedListener);
    };
  }

  off(event, listener) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    if (!this.events[event]) {
      return false;
    }

    const listeners = this.events[event];
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i] === listener || listeners[i].original === listener) {
        listeners.splice(i, 1);
        return true;
      }
    }

    return false;
  }

  emit(event, ...args) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }

    if (!this.events[event] || this.events[event].length === 0) {
      return false;
    }

    const listeners = this.events[event].slice();

    for (const listener of listeners) {
      listener(...args);
    }

    return true;
  }

  listenerCount(event) {
    if (typeof event !== 'string') {
      throw new TypeError('event must be a string');
    }

    if (!this.events[event]) {
      return 0;
    }

    return this.events[event].length;
  }
}

module.exports = { Emitter };
