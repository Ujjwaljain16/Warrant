'use strict';

class LruCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.capacity = capacity;
    this._map = new Map();
  }

  get size() { return this._map.size; }

  get(key) {
    if (!this._map.has(key)) return undefined;
    const value = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key, value) {
    this._map.delete(key);
    this._map.set(key, value);
    if (this._map.size > this.capacity) this._map.delete(this._map.keys().next().value);
    return this;
  }

  has(key) { return this._map.has(key); }
  delete(key) { return this._map.delete(key); }
  keys() { return [...this._map.keys()]; }
}

module.exports = { LruCache };
