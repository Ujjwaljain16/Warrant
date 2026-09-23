'use strict';

const DAY = 86400000;

function parse(date) {
  if (typeof date !== 'string') throw new TypeError('date must be a string');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  if (year < 1000 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) throw new RangeError(`no such day: ${date}`);
  return t;
}

function addBusinessDays(date, n) {
  let t = parse(date);
  if (!Number.isSafeInteger(n)) throw new RangeError('n must be a safe integer');
  const direction = n < 0 ? -1 : 1;
  for (let step = 0; step < Math.abs(n); step++) {
    do { t += direction * DAY; } while ([0, 6].includes(new Date(t).getUTCDay()));
  }
  const out = new Date(t);
  if (out.getUTCFullYear() < 1000 || out.getUTCFullYear() > 9999) throw new RangeError('result is outside years 1000-9999');
  return out.toISOString().slice(0, 10);
}

module.exports = { addBusinessDays };
