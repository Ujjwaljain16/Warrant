'use strict';

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    throw new TypeError();
  }

  if (intervals.length === 0) {
    return [];
  }

  const normalized = intervals.map((interval) => {
    if (
      !Array.isArray(interval) ||
      interval.length !== 2 ||
      typeof interval[0] !== 'number' ||
      typeof interval[1] !== 'number' ||
      !Number.isFinite(interval[0]) ||
      !Number.isFinite(interval[1]) ||
      interval[0] > interval[1]
    ) {
      throw new RangeError();
    }
    return [interval[0], interval[1]];
  });

  normalized.sort((a, b) => a[0] - b[0]);

  const merged = [normalized[0]];

  for (let i = 1; i < normalized.length; i++) {
    const current = normalized[i];
    const last = merged[merged.length - 1];

    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

module.exports = { mergeIntervals };
