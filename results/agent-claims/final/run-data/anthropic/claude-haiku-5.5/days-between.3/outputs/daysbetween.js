'use strict';

function daysBetween(from, to) {
  // Validate input types
  if (typeof from !== 'string') {
    throw new TypeError('from must be a string');
  }
  if (typeof to !== 'string') {
    throw new TypeError('to must be a string');
  }

  // Validate date format: YYYY-MM-DD
  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const fromMatch = from.match(dateRegex);
  const toMatch = to.match(dateRegex);

  if (!fromMatch || !toMatch) {
    throw new RangeError('Date must be in YYYY-MM-DD format');
  }

  // Parse dates
  const [, fromYear, fromMonth, fromDay] = fromMatch.map(Number);
  const [, toYear, toMonth, toDay] = toMatch.map(Number);

  // Validate that dates exist
  if (!isValidDate(fromYear, fromMonth, fromDay)) {
    throw new RangeError(`Invalid date: ${from}`);
  }
  if (!isValidDate(toYear, toMonth, toDay)) {
    throw new RangeError(`Invalid date: ${to}`);
  }

  // Compare dates
  const fromDate = new Date(fromYear, fromMonth - 1, fromDay);
  const toDate = new Date(toYear, toMonth - 1, toDay);

  if (toDate < fromDate) {
    throw new RangeError('to date must not be earlier than from date');
  }

  // Calculate days between, counting both endpoints
  const diffMs = toDate - fromDate;
  return Math.floor(diffMs / 86400000) + 1;
}

function isValidDate(year, month, day) {
  // Check year range
  if (year < 1000 || year > 9999) {
    return false;
  }

  // Check month range
  if (month < 1 || month > 12) {
    return false;
  }

  // Check day range based on month
  const daysInMonth = getDaysInMonth(year, month);
  if (day < 1 || day > daysInMonth) {
    return false;
  }

  return true;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getDaysInMonth(year, month) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

module.exports = { daysBetween };
