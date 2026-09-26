'use strict';

function daysBetween(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  return Math.floor(ms / 86400000);
}

module.exports = { daysBetween };
