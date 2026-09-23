'use strict';

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) throw new TypeError('intervals must be an array');
  for (const iv of intervals) {
    if (!Array.isArray(iv) || iv.length !== 2 || !iv.every((x) => typeof x === 'number' && Number.isFinite(x)) || iv[0] > iv[1]) throw new RangeError('each interval must be [start, end] with start <= end');
  }
  const sorted = intervals.map((iv) => [iv[0], iv[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push(iv);
  }
  return out;
}

module.exports = { mergeIntervals };
