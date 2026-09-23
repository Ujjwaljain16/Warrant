'use strict';

function camelToSnake(name) {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

module.exports = { camelToSnake };
