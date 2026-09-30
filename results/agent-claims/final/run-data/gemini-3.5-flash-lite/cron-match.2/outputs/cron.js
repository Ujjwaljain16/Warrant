'use strict';

const FIELD_RANGES = [
  { min: 0, max: 59, name: 'minute' },
  { min: 0, max: 23, name: 'hour' },
  { min: 1, max: 31, name: 'day of month' },
  { min: 1, max: 12, name: 'month' },
  { min: 0, max: 6, name: 'day of week' },
];

function parseField(fieldStr, min, max) {
  if (typeof fieldStr !== 'string' || fieldStr.length === 0) {
    throw new SyntaxError('Invalid field');
  }

  const values = new Set();
  const parts = fieldStr.split(',');

  for (const part of parts) {
    if (part === '') {
      throw new SyntaxError('Empty list item');
    }

    let step = 1;
    let base = part;
    const slashIdx = part.indexOf('/');
    if (slashIdx !== -1) {
      if (slashIdx === 0 || slashIdx === part.length - 1) {
        throw new SyntaxError('Malformed step');
      }
      if (part.indexOf('/', slashIdx + 1) !== -1) {
        throw new SyntaxError('Multiple slashes');
      }
      const stepStr = part.slice(slashIdx + 1);
      if (!/^\d+$/.test(stepStr)) {
        throw new SyntaxError('Invalid step');
      }
      step = parseInt(stepStr, 10);
      if (step <= 0) {
        throw new SyntaxError('Step must be positive');
      }
      base = part.slice(0, slashIdx);
      if (!base.includes('-') && base !== '*') {
        throw new SyntaxError('N/S with a single number is not allowed');
      }
    }

    if (base === '*') {
      for (let i = min; i <= max; i += step) {
        values.add(i);
      }
    } else if (base.includes('-')) {
      const rangeParts = base.split('-');
      if (rangeParts.length !== 2) {
        throw new SyntaxError('Malformed range');
      }
      const [startStr, endStr] = rangeParts;
      if (!/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        throw new SyntaxError('Invalid range values');
      }
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (start < min || start > max || end < min || end > max) {
        throw new SyntaxError('Range value out of bounds');
      }
      if (start > end) {
        throw new SyntaxError('Reversed range');
      }
      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    } else {
      if (!/^\d+$/.test(base)) {
        throw new SyntaxError('Invalid item');
      }
      const val = parseInt(base, 10);
      if (val < min || val > max) {
        throw new SyntaxError('Value out of bounds');
      }
      values.add(val);
    }
  }

  return values;
}

function cronMatches(expression, date) {
  if (typeof expression !== 'string') {
    throw new TypeError('Expression must be a string');
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new SyntaxError('Expression must have 5 fields');
  }

  const parsedFields = fields.map((f, i) => parseField(f, FIELD_RANGES[i].min, FIELD_RANGES[i].max));

  const [minSet, hourSet, domSet, monthSet, dowSet] = parsedFields;

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dow = date.getUTCDay();

  if (!minSet.has(minute)) return false;
  if (!hourSet.has(hour)) return false;
  if (!monthSet.has(month)) return false;

  const domRaw = fields[2];
  const dowRaw = fields[4];

  const domStartsWidthStar = domRaw.startsWith('*');
  const dowStartsWidthStar = dowRaw.startsWith('*');

  const domMatches = domSet.has(dom);
  const dowMatches = dowSet.has(dow);

  if (!domStartsWidthStar && !dowStartsWidthStar) {
    if (!domMatches && !dowMatches) return false;
  } else {
    if (!domMatches || !dowMatches) return false;
  }

  return true;
}

module.exports = { cronMatches };
