'use strict';

function addBusinessDays(date, n) {
  if (typeof date !== 'string') {
    throw new TypeError('date must be a string');
  }
  const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymdRegex.test(date)) {
    throw new RangeError('date must be in YYYY-MM-DD format');
  }
  const [yearStr, monthStr, dayStr] = date.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError('date must be in YYYY-MM-DD format');
  }
  let ms = Date.UTC(year, month - 1, day);
  if (n === 0) {
    return date;
  }
  const absN = Math.abs(n);
  if (!Number.isSafeInteger(n) || absN > 100000) {
    throw new RangeError('n must be a safe integer and |n| <= 100000');
  }
  const isForward = n > 0;
  const stepsPerWeek = 5;
  let remaining = absN;
  let totalDays = 0;
  const dayMap = { '0': 6, '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 };
  const dowMap = { '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' };
  let targetDow;
  if (isForward) {
    targetDow = dayMap[String((new Date(ms).getUTCDay() + 1) % 7)];
  } else {
    targetDow = dayMap[String((new Date(ms).getUTCDay() - 1 + 7) % 7)];
  }
  const isWeekend = targetDow === 'Saturday' || targetDow === 'Sunday';
  const stepsInCurrentWeek = isWeekend ? 2 : 1;
  const maxSteps = Math.min(remaining, stepsInCurrentWeek);
  totalDays += maxSteps;
  remaining -= maxSteps;
  if (remaining > 0) {
    if (isForward) {
      if (targetDow === 'Friday') {
        totalDays += 2;
        remaining -= 2;
      } else if (targetDow === 'Saturday') {
        totalDays += 1;
        remaining -= 1;
      }
    } else {
      if (targetDow === 'Monday') {
        totalDays -= 2;
        remaining -= 2;
      } else if (targetDow === 'Sunday') {
        totalDays -= 1;
        remaining -= 1;
      }
    }
  }
  let newMs = ms + totalDays * 86400000;
  const newDate = new Date(newMs);
  const newYear = newDate.getUTCFullYear();
  const newMonth = newDate.getUTCMonth() + 1;
  const newDay = newDate.getUTCDate();
  if (newYear < 1000 || newYear > 9999) {
    throw new RangeError('date must be in YYYY-MM-DD format');
  }
  return String(newYear).padStart(4, '0') + '-' + String(newMonth).padStart(2, '0') + '-' + String(newDay).padStart(2, '0');
}

module.exports = { addBusinessDays };