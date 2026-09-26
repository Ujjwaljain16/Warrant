'use strict';

function addBusinessDays(date, n) {
  if (typeof date !== 'string') {
    throw new TypeError('date must be a string');
  }

  if (!Number.isSafeInteger(n)) {
    throw new RangeError('n must be a safe integer');
  }

  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = date.match(dateRegex);
  if (!match) {
    throw new RangeError('date must be in YYYY-MM-DD format');
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1000 || year > 9999) {
    throw new RangeError('year must be between 1000 and 9999');
  }

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  if (dateObj.getUTCFullYear() !== year || 
      dateObj.getUTCMonth() !== month - 1 || 
      dateObj.getUTCDate() !== day) {
    throw new RangeError('date is not a valid calendar day');
  }

  if (n === 0) {
    return date;
  }

  let current = new Date(dateObj);
  const direction = n > 0 ? 1 : -1;
  const steps = Math.abs(n);

  for (let step = 0; step < steps; step++) {
    current.setUTCDate(current.getUTCDate() + direction);

    let dayOfWeek = current.getUTCDay();
    while (dayOfWeek === 0 || dayOfWeek === 6) {
      current.setUTCDate(current.getUTCDate() + direction);
      dayOfWeek = current.getUTCDay();
    }
  }

  if (current.getUTCFullYear() < 1000 || current.getUTCFullYear() > 9999) {
    throw new RangeError('resulting year is outside 1000-9999 range');
  }

  const resultYear = current.getUTCFullYear();
  const resultMonth = String(current.getUTCMonth() + 1).padStart(2, '0');
  const resultDay = String(current.getUTCDate()).padStart(2, '0');

  return `${resultYear}-${resultMonth}-${resultDay}`;
}

module.exports = { addBusinessDays };
