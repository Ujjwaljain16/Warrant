'use strict';

function parseDate(dateStr) {
  if (typeof dateStr !== 'string') {
    throw new TypeError('Date must be a string');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new RangeError('Invalid date format, expected YYYY-MM-DD');
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1000 || year > 9999) {
    throw new RangeError('Year must be between 1000 and 9999');
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new RangeError('Invalid calendar date');
  }

  return { year, month, day, d };
}

function formatDate(d) {
  const year = d.getUTCFullYear();
  if (year < 1000 || year > 9999) {
    throw new RangeError('Year must be between 1000 and 9999');
  }
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addBusinessDays(dateStr, n) {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('n must be a safe integer');
  }

  const { year, month, day, d } = parseDate(dateStr);

  if (n === 0) {
    return formatDate(d);
  }

  const absN = Math.abs(n);
  const stepDir = n > 0 ? 1 : -1;

  let current = d;
  for (let i = 0; i < absN; i++) {
    current = new Date(current.getTime() + stepDir * 86400000);
    let dayOfWeek = current.getUTCDay();
    while (dayOfWeek === 0 || dayOfWeek === 6) {
      current = new Date(current.getTime() + stepDir * 86400000);
      dayOfWeek = current.getUTCDay();
    }
  }

  return formatDate(current);
}

module.exports = { addBusinessDays };
