'use strict';

function parseField(fieldStr, min, max) {
  const items = fieldStr.split(',');
  const values = new Set();

  for (const item of items) {
    if (item === '*') {
      for (let i = min; i <= max; i++) {
        values.add(i);
      }
    } else if (item.includes('-')) {
      const [start, rest] = item.split('-');
      const step = rest.includes('/') ? rest.split('/')[1] : null;
      const end = step ? rest.split('/')[0] : rest;
      const startNum = parseInt(start, 10);
      const endNum = parseInt(end, 10);

      if (isNaN(startNum) || isNaN(endNum)) {
        throw new SyntaxError(`Invalid range: ${item}`);
      }
      if (startNum > endNum) {
        throw new SyntaxError(`Invalid range: ${item}`);
      }
      if (startNum < min || endNum > max) {
        throw new SyntaxError(`Value out of range: ${item}`);
      }

      const stepNum = step ? parseInt(step, 10) : 1;
      if (stepNum <= 0) {
        throw new SyntaxError(`Invalid step: ${item}`);
      }

      for (let i = startNum; i <= endNum; i += stepNum) {
        values.add(i);
      }
    } else if (item.includes('/')) {
      const [base, stepStr] = item.split('/');
      const stepNum = parseInt(stepStr, 10);

      if (isNaN(stepNum) || stepNum <= 0) {
        throw new SyntaxError(`Invalid step: ${item}`);
      }

      if (base === '*') {
        for (let i = min; i <= max; i += stepNum) {
          values.add(i);
        }
      } else {
        throw new SyntaxError(`Invalid item: ${item}`);
      }
    } else {
      const num = parseInt(item, 10);
      if (isNaN(num)) {
        throw new SyntaxError(`Invalid item: ${item}`);
      }
      if (num < min || num > max) {
        throw new SyntaxError(`Value out of range: ${item}`);
      }
      values.add(num);
    }
  }

  return values;
}

function cronMatches(expression, date) {
  if (typeof expression !== 'string') {
    throw new TypeError('Expression must be a string');
  }

  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('Date must be a valid Date object');
  }

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new SyntaxError('Expression must have exactly 5 fields');
  }

  const [minuteStr, hourStr, dayStr, monthStr, dowStr] = fields;

  try {
    const minutes = parseField(minuteStr, 0, 59);
    const hours = parseField(hourStr, 0, 23);
    const days = parseField(dayStr, 1, 31);
    const months = parseField(monthStr, 1, 12);
    const dows = parseField(dowStr, 0, 6);

    const dateMinute = date.getUTCMinutes();
    const dateHour = date.getUTCHours();
    const dateDay = date.getUTCDate();
    const dateMonth = date.getUTCMonth() + 1;
    const dateDow = date.getUTCDay();

    // Check minute, hour, and month
    if (!minutes.has(dateMinute) || !hours.has(dateHour) || !months.has(dateMonth)) {
      return false;
    }

    // Special day matching logic
    const dayStartsWithStar = dayStr.startsWith('*');
    const dowStartsWithStar = dowStr.startsWith('*');

    if (!dayStartsWithStar && !dowStartsWithStar) {
      // Neither starts with *, day matches if either field matches
      return days.has(dateDay) || dows.has(dateDow);
    } else {
      // At least one starts with *, day matches only if both match
      return days.has(dateDay) && dows.has(dateDow);
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw e;
    }
    throw new SyntaxError(`Invalid expression: ${e.message}`);
  }
}

module.exports = { cronMatches };
