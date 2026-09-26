'use strict';

function shortestPath(grid, start, end) {
  if (typeof grid !== 'object' || !Array.isArray(grid) || grid.length === 0 || typeof grid[0] !== 'string') {
    throw new TypeError('grid must be a non-empty array of equal-length strings');
  }
  const rows = grid.length;
  const cols = grid[0].length;
  if (typeof start !== 'object' || !Array.isArray(start) || start.length !== 2 || typeof start[0] !== 'number' || start[0] < 0 || start[0] >= rows || typeof start[1] !== 'number' || start[1] < 0 || start[1] >= cols) {
    throw new RangeError('start must be a pair of integers inside the grid');
  }
  if (typeof end !== 'object' || !Array.isArray(end) || end.length !== 2 || typeof end[0] !== 'number' || end[0] < 0 || end[0] >= rows || typeof end[1] !== 'number' || end[1] < 0 || end[1] >= cols) {
    throw new RangeError('end must be a pair of integers inside the grid');
  }
  if (grid[start[0]][start[1]] === '#') {
    return -1;
  }
  if (grid[end[0]][end[1]] === '#') {
    return -1;
  }
  if (start[0] === end[0] && start[1] === end[1]) {
    return 0;
  }
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const queue = [[start[0], start[1], 0]];
  const visited = new Set();
  visited.add(`${start[0]},${start[1]}`);
  while (queue.length > 0) {
    const [r, c, dist] = queue.shift();
    for (const [dr, dc] of directions) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === '.' && !visited.has(`${nr},${nc}`)) {
        if (nr === end[0] && nc === end[1]) {
          return dist + 1;
        }
        visited.add(`${nr},${nc}`);
        queue.push([nr, nc, dist + 1]);
      }
    }
  }
  return -1;
}

module.exports = { shortestPath };
