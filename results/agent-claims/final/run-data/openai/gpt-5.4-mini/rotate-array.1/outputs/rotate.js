function rotate(_items, _k) {
  if (typeof _k !== 'number' || !Number.isInteger(_k)) {
    throw new RangeError('k must be an integer');
  }
  if (!Array.isArray(_items)) {
    throw new TypeError('items must be an array');
  }
  if (_items.length === 0 || _k === 0) {
    return [..._items];
  }
  const n = _items.length;
  let effectiveK = _k;
  if (_k < 0) {
    effectiveK = (_k % n + n) % n;
  } else {
    effectiveK = _k % n;
  }
  return [..._items.slice(n - effectiveK), ..._items.slice(0, n - effectiveK)];
}

module.exports = { rotate };