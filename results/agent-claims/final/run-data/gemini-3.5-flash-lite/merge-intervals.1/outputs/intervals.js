'use strict';

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    throw new TypeError('intervals must be an array');
  }

  if (intervals.length === 0) {
    return [];
  }

  const normalized = [];
  for (const interval of intervals) {
    if (
      !Array.isArray(interval) ||
      interval.length !== 2 ||
      typeof interval[0] !== 'number' ||
      typeof interval[1] !== 'number' ||
      !Number.isFinite(interval[0]) ||
      !Number.isFinite(interval[1]) ||
      interval[0] > interval[1]
    ) {
      throw new RangeError('invalid interval');
    }
    normalized.push([interval[0], interval[1]]);
  }

  normalized.sort((a, b) => {
    if (a[0] !== b[0]) {
      return a[0] - b[0];
    }
    return a[1] - b[1];
  });

  const merged = [];
  let current = normalized[0];

  for (let i = 1; i < normalized.length; i++) {
    const next = normalized[i];
    if (next[0] <= current[1]) {
      if (next[1] > current[1]) {
        current = [current[0], next[1]];
      }
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  return merged;
}

module.exports = { mergeIntervals };
