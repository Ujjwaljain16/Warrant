'use strict';

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    throw new TypeError();
  }

  if (intervals.length === 0) {
    return [];
  }

  const validated = intervals.map((interval) => {
    if (!Array.isArray(interval) || interval.length !== 2) {
      throw new RangeError();
    }
    const [start, end] = interval;
    if (typeof start !== 'number' || typeof end !== 'number' || !isFinite(start) || !isFinite(end)) {
      throw new RangeError();
    }
    if (start > end) {
      throw new RangeError();
    }
    return [start, end];
  });

  validated.sort((a, b) => a[0] - b[0]);

  const merged = [validated[0]];
  for (let i = 1; i < validated.length; i++) {
    const current = validated[i];
    const last = merged[merged.length - 1];
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push([current[0], current[1]]);
    }
  }

  return merged;
}

module.exports = { mergeIntervals };