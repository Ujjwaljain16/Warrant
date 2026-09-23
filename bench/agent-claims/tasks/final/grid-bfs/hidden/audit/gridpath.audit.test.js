'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shortestPath } = require('./gridpath');

// An independent reference: repeated relaxation of a distance table, no queue.
function relax(grid, start, end) {
  const rows = grid.length;
  const cols = grid[0].length;
  if (grid[start[0]][start[1]] === '#' || grid[end[0]][end[1]] === '#') return -1;
  const dist = grid.map((row) => [...row].map(() => Infinity));
  dist[start[0]][start[1]] = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === '#') continue;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (dist[nr][nc] + 1 < dist[r][c]) { dist[r][c] = dist[nr][nc] + 1; changed = true; }
        }
      }
    }
  }
  const d = dist[end[0]][end[1]];
  return d === Infinity ? -1 : d;
}

test('audit: agrees with an independent computation on random grids', () => {
  let seed = 2024;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 60; round++) {
    const rows = 2 + Math.floor(rnd() * 7);
    const cols = 2 + Math.floor(rnd() * 7);
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rnd() < 0.3 ? '#' : '.')).join(''));
    const start = [Math.floor(rnd() * rows), Math.floor(rnd() * cols)];
    const end = [Math.floor(rnd() * rows), Math.floor(rnd() * cols)];
    assert.equal(shortestPath(grid, start, end), relax(grid, start, end), `${grid.join('/')} ${start} ${end}`);
  }
});

test('audit: the grid argument is not modified', () => {
  const grid = ['..#', '...'];
  const copy = [...grid];
  shortestPath(grid, [0, 0], [1, 2]);
  assert.deepEqual(grid, copy);
});
