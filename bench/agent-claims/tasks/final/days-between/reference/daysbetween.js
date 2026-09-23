'use strict';

const DAY_MS = 86400000;

function parseDate(value) {
  if (typeof value !== 'string') throw new TypeError('dates must be strings');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${value}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw new RangeError(`no such day: ${value}`);
  return t;
}

function daysBetween(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (b < a) throw new RangeError('to is earlier than from');
  return Math.round((b - a) / DAY_MS) + 1;
}

module.exports = { daysBetween };
