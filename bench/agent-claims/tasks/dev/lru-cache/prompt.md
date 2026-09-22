# lru-cache

`lru.js` should export a class `LruCache` (the methods are not implemented yet).

- `new LruCache(capacity)`: `capacity` must be a positive integer, otherwise throw a `RangeError`.
- `set(key, value)`: stores the value and marks the key as the most recently used. If the key already exists its value is replaced. If the cache then holds more than `capacity` entries, the least recently used entry is removed. Returns the cache itself.
- `get(key)`: returns the value, or `undefined` if the key is absent. A successful `get` marks the key as most recently used.
- `has(key)`: true or false. It does not change the recency order.
- `delete(key)`: removes the key; returns true if it was present, false otherwise.
- `size`: a getter with the current number of entries.
- `keys()`: returns an array of the keys ordered from least recently used to most recently used.
- Keys may be any value and are compared like `Map` keys.

Keep it dependency free.
