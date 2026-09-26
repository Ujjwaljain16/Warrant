'use strict';

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    throw new TypeError('intervals must be an array');
  }

  if (intervals.length === 0) {
    return [];
  }

  // Validate all intervals
  for (const interval of intervals) {
    if (!Array.isArray(interval) || interval.length !== 2) {
      throw new RangeError('each interval must be an array of two numbers');
    }
    const [start, end] = interval;
    if (typeof start !== 'number' || typeof end !== 'number' || !isFinite(start) || !isFinite(end)) {
      throw new RangeError('interval ends must be finite numbers');
    }
    if (start > end) {
      throw new RangeError('interval start must not be greater than end');
    }
  }

  // Sort intervals by start position
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);

  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    // If current interval overlaps or touches the last merged interval, merge them
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push([current[0], current[1]]);
    }
  }

  return merged;
}

module.exports = { mergeIntervals };
