'use strict';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// Parse a YYYY-MM-DD string into {y, m, d}, validating that the date exists.
function parseDate(value) {
  if (typeof value !== 'string') {
    throw new TypeError('date must be a string in YYYY-MM-DD form');
  }
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new RangeError(`invalid date format: ${value}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) {
    throw new RangeError(`invalid month in date: ${value}`);
  }
  if (d < 1 || d > daysInMonth(y, m)) {
    throw new RangeError(`invalid day in date: ${value}`);
  }
  return { y, m, d };
}

// Days since 1970-01-01 for a proleptic Gregorian date (exact integer arithmetic).
function dayNumber({ y, m, d }) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12; // March = 0
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function daysBetween(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  const diff = dayNumber(b) - dayNumber(a);
  if (diff < 0) {
    throw new RangeError('"to" must not be earlier than "from"');
  }
  return diff + 1;
}

module.exports = { daysBetween };
