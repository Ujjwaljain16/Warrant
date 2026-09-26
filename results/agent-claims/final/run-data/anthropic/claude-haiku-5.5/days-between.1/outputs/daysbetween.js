'use strict';

function isLeapYear(year) {
  return (year % 400 === 0) || (year % 4 === 0 && year % 100 !== 0);
}

function isValidDate(year, month, day) {
  if (month < 1 || month > 12) return false;
  
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];
  
  return day >= 1 && day <= daysInMonth[month - 1];
}

function parseDate(dateStr) {
  if (typeof dateStr !== 'string') {
    throw new TypeError('Date argument must be a string');
  }
  
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new RangeError(`Invalid date format: ${dateStr}`);
  }
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  
  if (!isValidDate(year, month, day)) {
    throw new RangeError(`Invalid date: ${dateStr}`);
  }
  
  return new Date(year, month - 1, day);
}

function daysBetween(from, to) {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  
  if (fromDate > toDate) {
    throw new RangeError('from date must not be later than to date');
  }
  
  const diffMs = toDate - fromDate;
  const diffDays = Math.floor(diffMs / 86400000);
  
  return diffDays + 1;
}

module.exports = { daysBetween };
