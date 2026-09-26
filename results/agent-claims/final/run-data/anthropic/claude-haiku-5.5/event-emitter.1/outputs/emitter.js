'use strict';

class Emitter {
  constructor() {
    this.listeners = {};
  }

  on(event, listener) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');

    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }

    this.listeners[event].push(listener);

    return () => {
      this.off(event, listener);
    };
  }

  once(event, listener) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');

    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };

    wrapper.original = listener;

    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }

    this.listeners[event].push(wrapper);

    return () => {
      this.off(event, wrapper);
    };
  }

  off(event, listener) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');

    if (!this.listeners[event]) {
      return false;
    }

    const listeners = this.listeners[event];
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i] === listener || listeners[i].original === listener) {
        listeners.splice(i, 1);
        return true;
      }
    }

    return false;
  }

  emit(event, ...args) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');

    if (!this.listeners[event] || this.listeners[event].length === 0) {
      return false;
    }

    const listenersToCall = [...this.listeners[event]];

    for (const listener of listenersToCall) {
      listener(...args);
    }

    return true;
  }

  listenerCount(event) {
    if (typeof event !== 'string') throw new TypeError('event must be a string');

    if (!this.listeners[event]) {
      return 0;
    }

    return this.listeners[event].length;
  }
}

module.exports = { Emitter };