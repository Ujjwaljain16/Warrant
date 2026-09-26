'use strict';

function parseField(fieldStr) {
  const parts = fieldStr.split('/');
  const base = parts[0].trim();
  let step = 1;
  if (parts.length > 1) {
    step = parseInt(parts[1], 10);
    if (isNaN(step) || step <= 0) {
      throw new SyntaxError('Invalid step size in field');
    }
  }
  return { base, step };
}

function parseRange(rangeStr) {
  if (rangeStr === '*') return { min: 0, max: 59 };
  const [startStr, endStr] = rangeStr.split('-');
  let start = parseInt(startStr, 10);
  let end = parseInt(endStr, 10);
  if (isNaN(start) || isNaN(end) || start > end) {
    throw new SyntaxError('Malformed or reversed range');
  }
  return { min: start, max: end };
}

function expandRange({ min, max }, step) {
  const values = [];
  for (let i = min; i <= max; i += step) {
    values.push(i);
  }
  return values;
}

function parseCron(expression) {
  if (typeof expression !== 'string') {
    throw new TypeError('Expression must be a string');
  }
  const fields = expression.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new SyntaxError('Invalid cron expression: must have exactly five fields');
  }
  const parsed = [];
  for (const f of fields) {
    const slashMatch = f === '*' ? '*/1' : f.replace(/^(\d+)-(\d+)$/, '$1-$2').replace(/^(\d+)$/, '$1-*/1');
    const { base, step } = parseField(slashMatch);
    let values;
    if (base === '*') {
      if (step !== 1) {
        values = expandRange({ min: 0, max: 59 }, step);
      } else {
        values = [0];
      }
    } else {
      const range = parseRange(base);
      values = expandRange(range, step);
    }
    parsed.push(values);
  }
  return parsed;
}

function cronMatches(expression, date) {
  if (typeof expression !== 'string') {
    throw new TypeError('Expression must be a string');
  }
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }
  let parsed;
  try {
    parsed = parseCron(expression);
  } catch (e) {
    throw e;
  }
  const m = date.getUTCMinutes();
  const h = date.getUTCHours();
  const dom = date.getUTCDate();
  const mon = date.getUTCMonth() + 1;
  const dow = date.getUTCDay();
  if (!parsed[0].includes(m)) return false;
  if (!parsed[1].includes(h)) return false;
  if (!parsed[3].includes(mon)) return false;
  const domMatches = parsed[2].includes(dom);
  const dowMatches = parsed[4].includes(dow);
  if (parsed[2][0] === '*' || parsed[4][0] === '*') {
    return domMatches && dowMatches;
  } else {
    return domMatches || dowMatches;
  }
}

module.exports = { cronMatches };
