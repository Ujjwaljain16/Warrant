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
      const parts = item.split('/');
      const range = parts[0].split('-');
      if (range.length !== 2) throw new SyntaxError('Invalid range');
      const rangeMin = parseInt(range[0], 10);
      const rangeMax = parseInt(range[1], 10);
      if (isNaN(rangeMin) || isNaN(rangeMax)) throw new SyntaxError('Invalid range');
      if (rangeMin > rangeMax) throw new SyntaxError('Invalid range');
      if (rangeMin < min || rangeMax > max) throw new SyntaxError('Value out of range');
      const step = parts.length > 1 ? parseInt(parts[1], 10) : 1;
      if (isNaN(step) || step <= 0) throw new SyntaxError('Invalid step');
      for (let i = rangeMin; i <= rangeMax; i += step) {
        values.add(i);
      }
    } else if (item.includes('/')) {
      const parts = item.split('/');
      if (parts[0] !== '*') throw new SyntaxError('Invalid step syntax');
      const step = parseInt(parts[1], 10);
      if (isNaN(step) || step <= 0) throw new SyntaxError('Invalid step');
      for (let i = min; i <= max; i += step) {
        values.add(i);
      }
    } else {
      const num = parseInt(item, 10);
      if (isNaN(num)) throw new SyntaxError('Invalid value');
      if (num < min || num > max) throw new SyntaxError('Value out of range');
      values.add(num);
    }
  }

  return { values, startsWithStar: fieldStr.trim().startsWith('*') };
}

function cronMatches(expression, date) {
  if (typeof expression !== 'string') throw new TypeError('Expression must be a string');
  if (!(date instanceof Date) || isNaN(date.getTime())) throw new TypeError('Date must be a valid Date');

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new SyntaxError('Expression must have exactly 5 fields');

  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dayOfMonth = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const dayOfWeek = parseField(fields[4], 0, 6);

  const dateMinute = date.getUTCMinutes();
  const dateHour = date.getUTCHours();
  const dateDate = date.getUTCDate();
  const dateMonth = date.getUTCMonth() + 1;
  const dateDayOfWeek = date.getUTCDay();

  const minuteMatch = minute.values.has(dateMinute);
  const hourMatch = hour.values.has(dateHour);
  const monthMatch = month.values.has(dateMonth);

  let dayMatch;
  if (!dayOfMonth.startsWithStar && !dayOfWeek.startsWithStar) {
    dayMatch = dayOfMonth.values.has(dateDate) || dayOfWeek.values.has(dateDayOfWeek);
  } else {
    dayMatch = dayOfMonth.values.has(dateDate) && dayOfWeek.values.has(dateDayOfWeek);
  }

  return minuteMatch && hourMatch && monthMatch && dayMatch;
}

module.exports = { cronMatches };
