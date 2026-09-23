'use strict';

const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
const ITEM = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/;

function parseField(text, min, max) {
  const values = new Set();
  for (const item of text.split(',')) {
    const m = ITEM.exec(item);
    if (!m) throw new SyntaxError(`bad item "${item}"`);
    let lo;
    let hi;
    if (m[1] === '*') { lo = min; hi = max; } else {
      lo = Number(m[2]);
      hi = m[3] === undefined ? lo : Number(m[3]);
      if (m[3] === undefined && m[4] !== undefined) throw new SyntaxError('a step needs * or a range');
    }
    const step = m[4] === undefined ? 1 : Number(m[4]);
    if (step < 1) throw new SyntaxError('step must be positive');
    if (lo < min || hi > max || lo > hi) throw new SyntaxError(`value out of range in "${item}"`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

function cronMatches(expression, date) {
  if (typeof expression !== 'string') throw new TypeError('expression must be a string');
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('date must be a valid Date');
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new SyntaxError('expected five fields');
  const sets = parts.map((p, i) => parseField(p, RANGES[i][0], RANGES[i][1]));
  const [minute, hour, dom, month, dow] = sets;
  if (!minute.has(date.getUTCMinutes()) || !hour.has(date.getUTCHours()) || !month.has(date.getUTCMonth() + 1)) return false;
  const domMatch = dom.has(date.getUTCDate());
  const dowMatch = dow.has(date.getUTCDay());
  const anyStar = parts[2].startsWith('*') || parts[4].startsWith('*');
  return anyStar ? domMatch && dowMatch : domMatch || dowMatch;
}

module.exports = { cronMatches };
