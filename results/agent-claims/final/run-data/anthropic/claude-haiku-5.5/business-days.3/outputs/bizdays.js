'use strict';

function addBusinessDays(date, n) {
  // Validate date parameter
  if (typeof date !== 'string') {
    throw new TypeError('date must be a string');
  }

  // Parse and validate date format (YYYY-MM-DD)
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

  // Validate n parameter
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('n must be a safe integer');
  }

  // Create date and validate it's a real calendar day
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError('date must be a valid calendar day');
  }

  // If n is 0, return unchanged
  if (n === 0) {
    return date;
  }

  // Determine direction
  const direction = n > 0 ? 1 : -1;
  const steps = Math.abs(n);

  // Process each step
  let current = new Date(Date.UTC(year, month - 1, day));
  for (let i = 0; i < steps; i++) {
    // Move one calendar day in the direction
    current.setUTCDate(current.getUTCDate() + direction);

    // Keep moving until we hit a weekday
    while (true) {
      const dayOfWeek = current.getUTCDay();
      // 0 = Sunday, 1-5 = Mon-Fri, 6 = Saturday
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        break;
      }
      current.setUTCDate(current.getUTCDate() + direction);
    }
  }

  // Validate result year is in range
  if (current.getUTCFullYear() < 1000 || current.getUTCFullYear() > 9999) {
    throw new RangeError('result year is outside 1000-9999 range');
  }

  // Format as YYYY-MM-DD
  const resultYear = current.getUTCFullYear();
  const resultMonth = String(current.getUTCMonth() + 1).padStart(2, '0');
  const resultDay = String(current.getUTCDate()).padStart(2, '0');
  return `${resultYear}-${resultMonth}-${resultDay}`;
}

module.exports = { addBusinessDays };
