'use strict';

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getDaysInMonth(year, month) {
  const daysInMonths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysInMonths[month - 1];
}

function parseDate(d) {
  if (typeof d !== 'string') {
    throw new TypeError('Date must be a string');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!match) {
    throw new RangeError('Invalid date format');
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1000 || year > 9999) {
    throw new RangeError('Year out of range (1000-9999)');
  }
  if (month < 1 || month > 12) {
    throw new RangeError('Invalid month');
  }
  const maxDay = getDaysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new RangeError('Invalid day');
  }

  return { year, month, day };
}

function dateToAbsoluteDays(y, m, d) {
  let days = 0;
  for (let yr = 1000; yr < y; yr++) {
    days += isLeapYear(yr) ? 366 : 365;
  }
  for (let mo = 1; mo < m; mo++) {
    days += getDaysInMonth(y, mo);
  }
  days += (d - 1);
  return days;
}

function daysBetween(from, to) {
  const f = parseDate(from);
  const t = parseDate(to);

  const fDays = dateToAbsoluteDays(f.year, f.month, f.day);
  const tDays = dateToAbsoluteDays(t.year, t.month, t.day);

  if (tDays < fDays) {
    throw new RangeError('To date is earlier than From date');
  }

  return tDays - fDays + 1;
}

module.exports = { daysBetween };
