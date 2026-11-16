'use strict';

const MS_PER_DAY = 86400000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Parses a strict YYYY-MM-DD string into a day number (days since 1970-01-01, UTC).
function parseDate(date) {
  if (typeof date !== 'string') {
    throw new TypeError('date must be a string');
  }
  const m = DATE_RE.exec(date);
  if (!m) {
    throw new RangeError('date must be YYYY-MM-DD');
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1000 || y > 9999) {
    throw new RangeError('year out of range 1000-9999');
  }
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError('date is not a real calendar day');
  }
  return t / MS_PER_DAY;
}

// Formats a day number back to YYYY-MM-DD, validating the year range.
function formatDay(dayNum) {
  const dt = new Date(dayNum * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  if (y < 1000 || y > 9999) {
    throw new RangeError('resulting year out of range 1000-9999');
  }
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${mo}-${d}`;
}

// 0 = Sunday ... 6 = Saturday. 1970-01-01 (day 0) was a Thursday.
function isWeekend(dayNum) {
  const wd = (((dayNum + 4) % 7) + 7) % 7;
  return wd === 0 || wd === 6;
}

function addBusinessDays(date, n) {
  let day = parseDate(date);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('n must be a safe integer');
  }
  if (n === 0) {
    return date;
  }
  const dir = n > 0 ? 1 : -1;
  let steps = Math.abs(n);
  while (steps > 0) {
    day += dir;
    while (isWeekend(day)) {
      day += dir;
    }
    steps -= 1;
  }
  return formatDay(day);
}

module.exports = { addBusinessDays };
