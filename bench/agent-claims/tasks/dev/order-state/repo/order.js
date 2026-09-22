'use strict';

class Order {
  get state() { throw new Error('not implemented'); }
  get history() { throw new Error('not implemented'); }
  pay() { throw new Error('not implemented'); }
  ship() { throw new Error('not implemented'); }
  deliver() { throw new Error('not implemented'); }
  cancel() { throw new Error('not implemented'); }
}

module.exports = { Order };
