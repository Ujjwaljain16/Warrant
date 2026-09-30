'use strict';

function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new TypeError('grid must be a non-empty array');
  }
  const firstLen = typeof grid[0] === 'string' ? grid[0].length : -1;
  if (firstLen <= 0) {
    throw new TypeError('grid rows must be non-empty strings');
  }
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    if (typeof row !== 'string' || row.length !== firstLen) {
      throw new TypeError('grid must be an array of strings of equal length');
    }
  }
  return { rows: grid.length, cols: firstLen };
}

function validateCoord(coord, dims) {
  if (!Array.isArray(coord) || coord.length !== 2) {
    throw new RangeError('coordinate must be a pair');
  }
  const r = coord[0];
  const c = coord[1];
  if (!Number.isInteger(r) || !Number.isInteger(c)) {
    throw new RangeError('coordinate must be integers');
  }
  if (r < 0 || r >= dims.rows || c < 0 || c >= dims.cols) {
    throw new RangeError('coordinate is outside the grid');
  }
}

function shortestPath(grid, start, end) {
  const dims = validateGrid(grid);
  validateCoord(start, dims);
  validateCoord(end, dims);

  const sr = start[0], sc = start[1];
  const er = end[0], ec = end[1];

  if (grid[sr][sc] === '#' || grid[er][ec] === '#') {
    return -1;
  }

  if (sr === er && sc === ec) {
    return 0;
  }

  const rows = dims.rows;
  const cols = dims.cols;
  const totalCells = rows * cols;

  const dist = new Int32Array(totalCells);
  dist.fill(-1);

  const queue = new Int32Array(totalCells);
  let head = 0;
  let tail = 0;

  const startIndex = sr * cols + sc;
  const endIndex = er * cols + ec;

  dist[startIndex] = 0;
  queue[tail++] = startIndex;

  const dr = [-1, 1, 0, 0];
  const dc = [0, 0, -1, 1];

  while (head < tail) {
    const curr = queue[head++];
    if (curr === endIndex) {
      return dist[curr];
    }

    const r = Math.floor(curr / cols);
    const c = curr % cols;
    const d = dist[curr];

    for (let i = 0; i < 4; i++) {
      const nr = r + dr[i];
      const nc = c + dc[i];

      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        if (grid[nr][nc] === '.') {
          const nIndex = nr * cols + nc;
          if (dist[nIndex] === -1) {
            dist[nIndex] = d + 1;
            if (nIndex === endIndex) {
              return dist[nIndex];
            }
            queue[tail++] = nIndex;
          }
        }
      }
    }
  }

  return dist[endIndex] !== -1 ? dist[endIndex] : -1;
}

module.exports = { shortestPath };
