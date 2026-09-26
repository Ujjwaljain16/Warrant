'use strict';

function isLeapYear(year) {
  return (year % 400 === 0) || (year % 4 === 0 && year % 100 !== 0);
}

function daysInMonth(year, month) {
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return daysPerMonth[month - 1];
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

  if (year < 1000 || year > 9999) {
    throw new RangeError(`Year out of range: ${year}`);
  }

  if (month < 1 || month > 12) {
    throw new RangeError(`Invalid month: ${month}`);
  }

  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new RangeError(`Invalid day: ${day}`);
  }

  return { year, month, day };
}

function daysSinceEpoch(year, month, day) {
  let total = 0;

  // Add days for complete years before this year
  for (let y = 1; y < year; y++) {
    total += isLeapYear(y) ? 366 : 365;
  }

  // Add days for complete months in this year
  for (let m = 1; m < month; m++) {
    total += daysInMonth(year, m);
  }

  // Add the day of month
  total += day;

  return total;
}

function daysBetween(from, to) {
  const fromDate = parseDate(from);
  const toDate = parseDate(to);

  const fromDays = daysSinceEpoch(fromDate.year, fromDate.month, fromDate.day);
  const toDays = daysSinceEpoch(toDate.year, toDate.month, toDate.day);

  if (toDays < fromDays) {
    throw new RangeError('End date cannot be before start date');
  }

  // Add 1 to count both the first and last day
  return toDays - fromDays + 1;
}

module.exports = { daysBetween };
