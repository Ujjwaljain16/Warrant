'use strict';

function addBusinessDays(date, n) {
  // Validate date type
  if (typeof date !== 'string') {
    throw new TypeError('date must be a string');
  }

  // Parse date in YYYY-MM-DD format
  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = date.match(dateRegex);
  if (!match) {
    throw new RangeError('date must be in YYYY-MM-DD format');
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  // Validate year range
  if (year < 1000 || year > 9999) {
    throw new RangeError('year must be between 1000 and 9999');
  }

  // Validate n is a safe integer
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('n must be a safe integer');
  }

  // Create date and validate it's a real calendar day
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError('date is not a valid calendar day');
  }

  // If n is 0, return the date unchanged
  if (n === 0) {
    return date;
  }

  // Make n steps, each step moves one day and lands on a weekday
  let steps = Math.abs(n);
  const direction = n > 0 ? 1 : -1;

  while (steps > 0) {
    // Move one calendar day
    d.setUTCDate(d.getUTCDate() + direction);
    steps--;

    // Keep moving in the same direction until we land on a weekday (Mon-Fri = 1-5)
    let dayOfWeek = d.getUTCDay();
    while (dayOfWeek === 0 || dayOfWeek === 6) {
      d.setUTCDate(d.getUTCDate() + direction);
      dayOfWeek = d.getUTCDay();
    }
  }

  // Validate year is still in range
  const resultYear = d.getUTCFullYear();
  if (resultYear < 1000 || resultYear > 9999) {
    throw new RangeError('resulting year is outside 1000-9999 range');
  }

  // Format result as YYYY-MM-DD
  const resultMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
  const resultDay = String(d.getUTCDate()).padStart(2, '0');
  return `${resultYear}-${resultMonth}-${resultDay}`;
}

module.exports = { addBusinessDays };
