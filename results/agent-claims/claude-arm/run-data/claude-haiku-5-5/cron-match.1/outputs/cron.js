'use strict';

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 6 },
];

function parseStep(text, field) {
  const step = Number(text);
  if (!/^\d+$/.test(text) || step < 1) {
    throw new SyntaxError(`invalid step "${text}" in ${field.name} field`);
  }
  return step;
}

function parseValue(text, field) {
  if (!/^\d+$/.test(text)) {
    throw new SyntaxError(`malformed value "${text}" in ${field.name} field`);
  }
  const n = Number(text);
  if (n < field.min || n > field.max) {
    throw new SyntaxError(`value ${n} out of range ${field.min}-${field.max} in ${field.name} field`);
  }
  return n;
}

// Marks every value from `from` to `to` (inclusive) that is reached by stepping `step`.
function markRange(allowed, from, to, step) {
  for (let v = from; v <= to; v += step) allowed[v] = true;
}

function parseField(text, field) {
  const allowed = new Array(field.max + 1).fill(false);
  for (const item of text.split(',')) {
    let m;
    if (item === '*') {
      markRange(allowed, field.min, field.max, 1);
    } else if ((m = /^\*\/(\d+)$/.exec(item))) {
      markRange(allowed, field.min, field.max, parseStep(m[1], field));
    } else if ((m = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(item))) {
      const from = parseValue(m[1], field);
      const to = parseValue(m[2], field);
      if (from > to) {
        throw new SyntaxError(`reversed range "${item}" in ${field.name} field`);
      }
      const step = m[3] === undefined ? 1 : parseStep(m[3], field);
      markRange(allowed, from, to, step);
    } else if (/^\d+$/.test(item)) {
      allowed[parseValue(item, field)] = true;
    } else {
      throw new SyntaxError(`malformed item "${item}" in ${field.name} field`);
    }
  }
  return { allowed, wildcard: text.startsWith('*') };
}

function isValidDate(date) {
  return Object.prototype.toString.call(date) === '[object Date]' && !Number.isNaN(date.getTime());
}

function cronMatches(expression, date) {
  if (typeof expression !== 'string') {
    throw new TypeError('cron expression must be a string');
  }
  if (!isValidDate(date)) {
    throw new TypeError('date must be a valid Date');
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new SyntaxError(`cron expression must have 5 fields, got ${parts.length}`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((text, i) =>
    parseField(text, FIELDS[i])
  );

  if (!minute.allowed[date.getUTCMinutes()]) return false;
  if (!hour.allowed[date.getUTCHours()]) return false;
  if (!month.allowed[date.getUTCMonth() + 1]) return false;

  const domMatch = dayOfMonth.allowed[date.getUTCDate()];
  const dowMatch = dayOfWeek.allowed[date.getUTCDay()];
  if (!dayOfMonth.wildcard && !dayOfWeek.wildcard) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}

module.exports = { cronMatches };
