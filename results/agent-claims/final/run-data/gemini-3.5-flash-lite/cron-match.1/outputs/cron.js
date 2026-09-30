'use strict';

const FIELD_DEFS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 }
];

function cronMatches(expression, date) {
  if (typeof expression !== 'string') {
    throw new TypeError('Expression must be a string');
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Date must be a valid Date object');
  }

  const trimmed = expression.trim();
  const fields = trimmed === '' ? [] : trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new SyntaxError('Expression must have exactly 5 fields');
  }

  const parsedFields = fields.map((fieldStr, index) => {
    const def = FIELD_DEFS[index];
    return parseField(fieldStr, def.min, def.max);
  });

  const minuteVal = date.getUTCMinutes();
  const hourVal = date.getUTCHours();
  const domVal = date.getUTCDate();
  const monthVal = date.getUTCMonth() + 1;
  const dowVal = date.getUTCDay();

  const minuteMatch = parsedFields[0].has(minuteVal);
  const hourMatch = parsedFields[1].has(hourVal);
  const monthMatch = parsedFields[3].has(monthVal);

  if (!minuteMatch || !hourMatch || !monthMatch) {
    return false;
  }

  const domFieldStr = fields[2];
  const dowFieldStr = fields[4];

  const domStartsStar = domFieldStr.startsWith('*');
  const dowStartsStar = dowFieldStr.startsWith('*');

  const domMatch = parsedFields[2].has(domVal);
  const dowMatch = parsedFields[4].has(dowVal);

  if (!domStartsStar && !dowStartsStar) {
    return domMatch || dowMatch;
  } else {
    return domMatch && dowMatch;
  }
}

function parseField(fieldStr, min, max) {
  if (typeof fieldStr !== 'string' || fieldStr.length === 0) {
    throw new SyntaxError('Malformed field');
  }

  const items = fieldStr.split(',');
  const matchedValues = new Set();

  for (const item of items) {
    if (item === '') {
      throw new SyntaxError('Empty item in list');
    }

    if (item === '*') {
      for (let v = min; v <= max; v++) {
        matchedValues.add(v);
      }
      continue;
    }

    if (item.startsWith('*/')) {
      const stepStr = item.slice(2);
      if (!/^\d+$/.test(stepStr)) {
        throw new SyntaxError('Invalid step');
      }
      const step = Number(stepStr);
      if (step <= 0) {
        throw new SyntaxError('Step must be positive');
      }
      for (let v = min; v <= max; v += step) {
        matchedValues.add(v);
      }
      continue;
    }

    if (item.includes('/')) {
      const [rangePart, stepStr] = item.split('/');
      if (!rangePart || !stepStr) {
        throw new SyntaxError('Malformed step item');
      }
      if (!/^\d+$/.test(stepStr)) {
        throw new SyntaxError('Invalid step');
      }
      const step = Number(stepStr);
      if (step <= 0) {
        throw new SyntaxError('Step must be positive');
      }

      let start, end;
      if (rangePart.includes('-')) {
        const parts = rangePart.split('-');
        if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
          throw new SyntaxError('Malformed range');
        }
        start = Number(parts[0]);
        end = Number(parts[1]);
      } else {
        throw new SyntaxError('N/S with a single number is not allowed');
      }

      if (start > end) {
        throw new SyntaxError('Reversed range');
      }
      if (start < min || end > max) {
        throw new SyntaxError('Value outside range');
      }

      for (let v = start; v <= end; v += step) {
        matchedValues.add(v);
      }
      continue;
    }

    if (item.includes('-')) {
      const parts = item.split('-');
      if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
        throw new SyntaxError('Malformed range');
      }
      const start = Number(parts[0]);
      const end = Number(parts[1]);
      if (start > end) {
        throw new SyntaxError('Reversed range');
      }
      if (start < min || end > max) {
        throw new SyntaxError('Value outside range');
      }

      for (let v = start; v <= end; v++) {
        matchedValues.add(v);
      }
      continue;
    }

    if (/^\d+$/.test(item)) {
      const val = Number(item);
      if (val < min || val > max) {
        throw new SyntaxError('Value outside range');
      }
      matchedValues.add(val);
      continue;
    }

    throw new SyntaxError('Malformed item');
  }

  return matchedValues;
}

module.exports = { cronMatches };
