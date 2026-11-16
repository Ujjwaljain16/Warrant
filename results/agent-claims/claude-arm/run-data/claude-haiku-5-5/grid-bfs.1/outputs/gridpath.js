'use strict';

function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new TypeError('grid must be a non-empty array of strings');
  }
  const width = grid[0].length;
  for (const row of grid) {
    if (typeof row !== 'string' || row.length !== width) {
      throw new TypeError('grid must be a non-empty array of equal-length strings');
    }
  }
}

function validatePoint(point, rows, cols, name) {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !Number.isInteger(point[0]) ||
    !Number.isInteger(point[1]) ||
    point[0] < 0 ||
    point[0] >= rows ||
    point[1] < 0 ||
    point[1] >= cols
  ) {
    throw new RangeError(`${name} must be a [row, column] pair of integers inside the grid`);
  }
}

function shortestPath(grid, start, end) {
  validateGrid(grid);
  const rows = grid.length;
  const cols = grid[0].length;
  validatePoint(start, rows, cols, 'start');
  validatePoint(end, rows, cols, 'end');

  const open = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    for (let c = 0; c < cols; c++) {
      open[r * cols + c] = row.charCodeAt(c) === 46 ? 1 : 0; // '.'
    }
  }

  const startIdx = start[0] * cols + start[1];
  const endIdx = end[0] * cols + end[1];
  if (!open[startIdx] || !open[endIdx]) return -1;
  if (startIdx === endIdx) return 0;

  const dist = new Int32Array(rows * cols).fill(-1);
  const queue = new Int32Array(rows * cols);
  let head = 0;
  let tail = 0;
  dist[startIdx] = 0;
  queue[tail++] = startIdx;

  while (head < tail) {
    const cur = queue[head++];
    const r = (cur / cols) | 0;
    const c = cur - r * cols;
    const d = dist[cur] + 1;

    // neighbours: up, down, left, right
    if (r > 0) {
      const n = cur - cols;
      if (open[n] && dist[n] < 0) {
        dist[n] = d;
        if (n === endIdx) return d;
        queue[tail++] = n;
      }
    }
    if (r < rows - 1) {
      const n = cur + cols;
      if (open[n] && dist[n] < 0) {
        dist[n] = d;
        if (n === endIdx) return d;
        queue[tail++] = n;
      }
    }
    if (c > 0) {
      const n = cur - 1;
      if (open[n] && dist[n] < 0) {
        dist[n] = d;
        if (n === endIdx) return d;
        queue[tail++] = n;
      }
    }
    if (c < cols - 1) {
      const n = cur + 1;
      if (open[n] && dist[n] < 0) {
        dist[n] = d;
        if (n === endIdx) return d;
        queue[tail++] = n;
      }
    }
  }

  return -1;
}

module.exports = { shortestPath };
