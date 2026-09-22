# order-state

`order.js` should export a class `Order` (it is not implemented yet) that models an order's lifecycle.

States: `created`, `paid`, `shipped`, `delivered`, `cancelled`. A new order is `created`.

Methods and their only allowed transitions:

- `pay()`: `created` to `paid`
- `ship()`: `paid` to `shipped`
- `deliver()`: `shipped` to `delivered`
- `cancel()`: `created` or `paid` to `cancelled` (a shipped or delivered order cannot be cancelled, and cancelling twice is not allowed)

Every successful call returns the order itself. Any other call throws an `Error` whose `code` property is `'INVALID_TRANSITION'`; a failed call changes nothing.

Also:

- `order.state` is the current state.
- `order.history` is a new array each time you read it, listing every state the order has been in, in order, starting with `'created'` and ending with the current state. Mutating the returned array does not affect the order.

Keep it dependency free.
