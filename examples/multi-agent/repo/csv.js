'use strict';

// Splits one line of CSV text into its fields.
function parseLine(line) {
  return line.split(',');
}

module.exports = { parseLine };
