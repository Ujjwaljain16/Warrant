'use strict';

function camelToSnake(name) {
  if (typeof name !== 'string') throw new TypeError('name must be a string');
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

module.exports = { camelToSnake };
