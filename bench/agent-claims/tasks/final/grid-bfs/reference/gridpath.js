'use strict';

function shortestPath(grid, start, end) {
  if (!Array.isArray(grid) || grid.length === 0 || !grid.every((row) => typeof row === 'string') || !grid.every((row) => row.length === grid[0].length) || grid[0].length === 0) {
    throw new TypeError('grid must be a non-empty array of equal-length strings');
  }
  const rows = grid.length;
  const cols = grid[0].length;
  const inside = (p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < rows && p[1] >= 0 && p[1] < cols;
  if (!inside(start) || !inside(end)) throw new RangeError('start and end must be [row, column] inside the grid');
  if (grid[start[0]][start[1]] === '#' || grid[end[0]][end[1]] === '#') return -1;
  const dist = new Int32Array(rows * cols).fill(-1);
  const queue = new Int32Array(rows * cols);
  let head = 0;
  let tail = 0;
  const s = start[0] * cols + start[1];
  const e = end[0] * cols + end[1];
  dist[s] = 0;
  queue[tail++] = s;
  while (head < tail) {
    const cur = queue[head++];
    if (cur === e) return dist[cur];
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] === '#') continue;
      const next = nr * cols + nc;
      if (dist[next] !== -1) continue;
      dist[next] = dist[cur] + 1;
      queue[tail++] = next;
    }
  }
  return -1;
}

module.exports = { shortestPath };
