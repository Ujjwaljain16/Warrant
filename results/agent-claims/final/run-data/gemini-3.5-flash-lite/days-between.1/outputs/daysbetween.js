'use strict';

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getDaysInMonth(year, month) {
  const daysInMonths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysInMonths[month - 1];
}

function parseDate(str) {
  if (typeof str !== 'string') {
    throw new TypeError('Date must be a string');
  }

  const regex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = str.match(regex);
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

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    throw new RangeError('Invalid day for month');
  }

  return { year, month, day };
}

function dateToDays(y, m, d) {
  let days = 0;
  for (let year = 1000; year < y; year++) {
    days += isLeapYear(year) ? 366 : 365;
  }
  for (let month = 1; month < m; month++) {
    days += getDaysInMonth(y, month);
  }
  days += (d - 1);
  return days;
}

function daysBetween(from, to) {
  const f = parseDate(from);
  const t = parseDate(to);

  const fDays = dateToDays(f.year, f.month, f.day);
  const tDays = dateToDays(t.year, t.month, t.day);

  if (tDays < fDays) {
    throw new RangeError('to date cannot be earlier than from date');
  }

  return tDays - fDays + 1;
}

module.exports = { daysBetween };
