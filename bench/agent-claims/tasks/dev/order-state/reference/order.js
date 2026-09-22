'use strict';

const TRANSITIONS = {
  pay: { from: ['created'], to: 'paid' },
  ship: { from: ['paid'], to: 'shipped' },
  deliver: { from: ['shipped'], to: 'delivered' },
  cancel: { from: ['created', 'paid'], to: 'cancelled' },
};

class Order {
  constructor() {
    this._state = 'created';
    this._history = ['created'];
  }

  get state() { return this._state; }
  get history() { return [...this._history]; }

  _go(action) {
    const t = TRANSITIONS[action];
    if (!t.from.includes(this._state)) {
      const error = new Error(`cannot ${action} an order that is ${this._state}`);
      error.code = 'INVALID_TRANSITION';
      throw error;
    }
    this._state = t.to;
    this._history.push(t.to);
    return this;
  }

  pay() { return this._go('pay'); }
  ship() { return this._go('ship'); }
  deliver() { return this._go('deliver'); }
  cancel() { return this._go('cancel'); }
}

module.exports = { Order };
