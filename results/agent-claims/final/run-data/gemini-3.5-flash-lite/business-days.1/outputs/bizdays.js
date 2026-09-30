'use strict';

function isValidDateString(str) {
  if (typeof str !== 'string') return { error: 'TypeError' };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) return { error: 'RangeError' };
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  
  if (year < 1000 || year > 9999) return { error: 'RangeError' };
  if (month < 1 || month > 12) return { error: 'RangeError' };
  
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return { error: 'RangeError' };
  
  return { year, month, day };
}

function dateToDays(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function daysToDate(days) {
  const d = new Date(days * 86400000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return {
    year,
    month,
    day,
    str: String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  };
}

function getDayOfWeek(days) {
  return (days + 4) % 7;
}

function addBusinessDays(date, n) {
  if (typeof date !== 'string') {
    throw new TypeError('date must be a string');
  }

  const parsed = isValidDateString(date);
  if (parsed.error === 'TypeError') {
    throw new TypeError('date must be a string');
  }
  if (parsed.error === 'RangeError') {
    throw new RangeError('Invalid date');
  }

  if (!Number.isSafeInteger(n)) {
    throw new RangeError('n must be a safe integer');
  }

  let currentDays = dateToDays(parsed.year, parsed.month, parsed.day);
  
  if (parsed.year < 1000 || parsed.year > 9999) {
    throw new RangeError('Year out of bounds');
  }

  if (n === 0) {
    const res = daysToDate(currentDays);
    if (res.year < 1000 || res.year > 9999) {
      throw new RangeError('Year out of bounds');
    }
    return res.str;
  }

  const steps = Math.abs(n);
  const dir = n > 0 ? 1 : -1;

  for (let i = 0; i < steps; i++) {
    currentDays += dir;
    let dow = getDayOfWeek(currentDays);
    while (dow === 0 || dow === 6) {
      currentDays += dir;
      dow = getDayOfWeek(currentDays);
    }
  }

  const finalDate = daysToDate(currentDays);
  if (finalDate.year < 1000 || finalDate.year > 9999) {
    throw new RangeError('Year out of bounds');
  }

  return finalDate.str;
}

module.exports = { addBusinessDays };
