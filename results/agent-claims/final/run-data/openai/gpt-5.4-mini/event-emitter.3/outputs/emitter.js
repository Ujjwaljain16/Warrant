'use strict';

class Emitter {
  on(_event, _listener) { throw new Error('not implemented'); }
  once(_event, _listener) { throw new Error('not implemented'); }
  off(_event, _listener) { throw new Error('not implemented'); }
  emit(_event, ..._args) { throw new Error('not implemented'); }
  listenerCount(_event) { throw new Error('not implemented'); }
}

module.exports = { Emitter };
