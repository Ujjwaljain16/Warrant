'use strict';

function render(template, data) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => (data[key] === undefined || data[key] === null ? '' : String(data[key])));
}

module.exports = { render };
