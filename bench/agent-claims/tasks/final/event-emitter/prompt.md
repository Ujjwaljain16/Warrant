# event-emitter

`emitter.js` should export a class `Emitter` (it is not implemented yet).

- `on(event, listener)` registers a listener for the event name (a string) and returns a function that removes exactly that registration (calling it again does nothing).
- `once(event, listener)` is like `on`, but the listener runs at most once: it is removed before it is called. It also returns an unsubscribe function.
- `off(event, listener)` removes one registration of that listener function for the event: the one registered earliest. It returns `true` if one was removed and `false` otherwise. The same function can be registered more than once; each registration is called separately.
- `emit(event, ...args)` calls the listeners of that event with `args`, in the order they were registered, and returns `true` if there was at least one listener, `false` otherwise. The listeners to call are decided when `emit` starts: a listener added during the emit is not called until the next emit, and a listener removed during the emit is still called in the current one (except that a `once` listener never runs twice, even when its own call triggers another `emit` of the same event).
- If a listener throws, the error propagates out of `emit` and the remaining listeners of that emit are not called.
- `listenerCount(event)` returns the number of registrations.
- `listener` must be a function and `event` a string, otherwise throw a `TypeError`.

Keep it dependency free.
