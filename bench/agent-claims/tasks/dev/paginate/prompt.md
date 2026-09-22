# paginate

`paginate.js` exports `paginate(items, page, perPage)`. Pages are numbered from 1. It returns an object:

```
{ items, page, perPage, totalItems, totalPages, hasPrev, hasNext }
```

Requirements:

- `items` is the slice of the input that belongs on that page, as a new array.
- `totalItems` is the length of the input; `totalPages` is `totalItems / perPage` rounded up (an empty input has `0` pages).
- `hasPrev` is `page > 1`; `hasNext` is `page < totalPages`.
- A page past the last page gives `items: []` (the requested `page` is echoed back unchanged).
- `page` and `perPage` must be positive integers, otherwise throw a `RangeError`.
- The input is never modified.

The current code gets several of these wrong. Fix `paginate.js`. Keep it dependency free.
