'use strict';

function mergeIntervals(intervals) {
  // === Input Validation ===
  if (!Array.isArray(intervals)) {
    throw new TypeError('Expected an array of intervals');
  }

  if (intervals.length === 0) {
    return [];
  }

  // Validate each interval and clone it (new arrays for result, per spec)
  const cleanIntervals = [];
  for (let i = 0; i < intervals.length; i++) {
    const interval = intervals[i];

    if (!Array.isArray(interval)) {
      throw new RangeError('Each interval must be an array');
    }
    if (interval.length !== 2) {
      throw new RangeError('Each interval must have exactly two elements');
    }

    const [start, end] = interval;

    if (typeof start !== 'number' || typeof end !== 'number') {
      throw new RangeError('Both start and end must be finite numbers');
    }
    if (start > end) {
      throw new RangeError('Interval start must be less than or equal to end');
    }

    cleanIntervals.push([start, end]);
  }

  // === Merge Logic ===
  // Step 1: Sort by start time (stable for equal starts)
  cleanIntervals.sort((a, b) => a[0] - b[0]);

  // Step 2: Merge overlapping or touching intervals
  const merged = [cleanIntervals[0]];
  for (let i = 1; i < cleanIntervals.length; i++) {
    const lastMerged = merged[merged.length - 1];
    const current = cleanIntervals[i];

    // Condition for merge: current starts before or at the end of lastMerged
    // This covers both overlap (current[0] < lastMerged[1]) and touching (current[0] === lastMerged[1])
    // Example: [[1,2], [2,3]] -> current[0]=2 === lastMerged[1]=2 -> merge
    if (current[0] <= lastMerged[1]) {
      lastMerged[1] = Math.max(lastMerged[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

module.exports = { mergeIntervals };
