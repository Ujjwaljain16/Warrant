'use strict';

function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    throw new TypeError('intervals must be an array');
  }

  const copies = intervals.map((interval) => {
    if (
      !Array.isArray(interval) ||
      interval.length !== 2 ||
      !Number.isFinite(interval[0]) ||
      !Number.isFinite(interval[1])
    ) {
      throw new RangeError('each interval must be a pair of finite numbers');
    }
    if (interval[0] > interval[1]) {
      throw new RangeError('interval start must not be greater than end');
    }
    return [interval[0], interval[1]];
  });

  copies.sort((a, b) => a[0] - b[0]);

  const result = [];
  for (const [start, end] of copies) {
    const last = result[result.length - 1];
    if (last && start <= last[1]) {
      if (end > last[1]) {
        last[1] = end;
      }
    } else {
      result.push([start, end]);
    }
  }
  return result;
}

module.exports = { mergeIntervals };
