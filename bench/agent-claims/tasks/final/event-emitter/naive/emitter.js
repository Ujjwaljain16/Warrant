'use strict';

class Emitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(listener);
    return () => this.off(event, listener);
  }

  once(event, listener) {
    const wrapper = (...args) => { this.off(event, wrapper); listener(...args); };
    return this.on(event, wrapper);
  }

  off(event, listener) {
    const list = this._listeners.get(event) || [];
    const index = list.indexOf(listener);
    if (index === -1) return false;
    list.splice(index, 1);
    return true;
  }

  emit(event, ...args) {
    const list = this._listeners.get(event) || [];
    if (list.length === 0) return false;
    for (const listener of list) listener(...args);
    return true;
  }

  listenerCount(event) {
    return (this._listeners.get(event) || []).length;
  }
}

module.exports = { Emitter };
