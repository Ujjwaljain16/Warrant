'use strict';

function isValidDateString(dateStr) {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return false;
  }
  return y >= 1000 && y <= 9999;
}

function addBusinessDays(dateStr, n) {
  if (typeof dateStr !== 'string') {
    throw new TypeError('Date must be a string');
  }
  if (!isValidDateString(dateStr)) {
    throw new RangeError('Date must be in YYYY-MM-DD format and between 1000-9999');
  }
  if (!Number.isSafeInteger(n)) {
    throw new RangeError('n must be a safe integer');
  }

  if (n === 0) return dateStr;

  const [y, m, d] = dateStr.split('-').map(Number);
  let currentDate = new Date(Date.UTC(y, m - 1, d));
  
  const direction = n > 0 ? 1 : -1;
  let stepsRemaining = Math.abs(n);

  // Optimized movement: move in full weeks for large n
  if (stepsRemaining >= 5) {
    const fullWeeks = Math.floor(stepsRemaining / 5);
    currentDate.setUTCDate(currentDate.getUTCDate() + fullWeeks * 7 * direction);
    stepsRemaining -= fullWeeks * 5;
  }

  while (stepsRemaining > 0) {
    currentDate.setUTCDate(currentDate.getUTCDate() + direction);
    const dayOfWeek = currentDate.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      stepsRemaining--;
    }
  }

  const finalYear = currentDate.getUTCFullYear();
  if (finalYear < 1000 || finalYear > 9999) {
    throw new RangeError('Resulting year must be between 1000-9999');
  }

  const resY = finalYear;
  const resM = String(currentDate.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(currentDate.getUTCDate()).padStart(2, '0');

  return `${resY}-${resM}-${resD}`;
}

module.exports = { addBusinessDays };