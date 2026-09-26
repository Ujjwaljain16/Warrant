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
      const start = parseInt(range[0], 10);
      const end = parseInt(range[1], 10);
      if (isNaN(start) || isNaN(end)) throw new SyntaxError('Invalid range');
      if (start > end) throw new SyntaxError('Invalid range');
      if (start < min || end > max) throw new SyntaxError('Value out of range');
      const step = parts.length === 2 ? parseInt(parts[1], 10) : 1;
      if (isNaN(step) || step <= 0) throw new SyntaxError('Invalid step');
      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else if (item.includes('/')) {
      const parts = item.split('/');
      if (parts[0] !== '*') throw new SyntaxError('Invalid step format');
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

  return values;
}

function cronMatches(expression, date) {
  if (typeof expression !== 'string') throw new TypeError('Expression must be a string');
  if (!(date instanceof Date) || isNaN(date.getTime())) throw new TypeError('Date must be a valid Date');

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new SyntaxError('Expression must have 5 fields');

  try {
    const minute = parseField(fields[0], 0, 59);
    const hour = parseField(fields[1], 0, 23);
    const dayOfMonth = parseField(fields[2], 1, 31);
    const month = parseField(fields[3], 1, 12);
    const dayOfWeek = parseField(fields[4], 0, 6);

    const dateMinute = date.getUTCMinutes();
    const dateHour = date.getUTCHours();
    const dateDay = date.getUTCDate();
    const dateMonth = date.getUTCMonth() + 1;
    const dateDoW = date.getUTCDay();

    const minuteMatch = minute.has(dateMinute);
    const hourMatch = hour.has(dateHour);
    const monthMatch = month.has(dateMonth);

    const domStartsWithStar = fields[2].startsWith('*');
    const dowStartsWithStar = fields[4].startsWith('*');

    let dayMatch;
    if (!domStartsWithStar && !dowStartsWithStar) {
      dayMatch = dayOfMonth.has(dateDay) || dayOfWeek.has(dateDoW);
    } else {
      dayMatch = dayOfMonth.has(dateDay) && dayOfWeek.has(dateDoW);
    }

    return minuteMatch && hourMatch && dayMatch && monthMatch;
  } catch (e) {
    if (e instanceof SyntaxError) throw e;
    throw new SyntaxError('Invalid cron expression');
  }
}

module.exports = { cronMatches };
