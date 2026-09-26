'use strict';

function shortestPath(grid, start, end) {
  // Validate grid
  if (!Array.isArray(grid) || grid.length === 0 || typeof grid[0] !== 'string') {
    throw new TypeError('grid must be a non-empty array of strings');
  }
  const cols = grid[0].length;
  for (const row of grid) {
    if (typeof row !== 'string' || row.length !== cols) {
      throw new TypeError('grid must be an array of equal-length strings');
    }
  }

  // Validate start and end
  function validateCoord(coord) {
    if (!Array.isArray(coord) || coord.length !== 2 ||
        !Number.isInteger(coord[0]) || !Number.isInteger(coord[1])) {
      throw new RangeError('start and end must be [row, column] pairs of integers');
    }
    const [row, col] = coord;
    if (row < 0 || row >= grid.length || col < 0 || col >= cols) {
      throw new RangeError('start and end must be inside the grid');
    }
  }
  validateCoord(start);
  validateCoord(end);

  const [startRow, startCol] = start;
  const [endRow, endCol] = end;

  // Check if start or end is a wall
  if (grid[startRow][startCol] === '#' || grid[endRow][endCol] === '#') {
    return -1;
  }

  // Same cell
  if (startRow === endRow && startCol === endCol) {
    return 0;
  }

  // BFS
  const queue = [[startRow, startCol, 0]];
  const visited = new Set();
  visited.add(`${startRow},${startCol}`);

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length > 0) {
    const [row, col, dist] = queue.shift();

    for (const [dr, dc] of directions) {
      const nr = row + dr;
      const nc = col + dc;

      if (nr >= 0 && nr < grid.length && nc >= 0 && nc < cols &&
          grid[nr][nc] === '.' && !visited.has(`${nr},${nc}`)) {
        if (nr === endRow && nc === endCol) {
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
