'use strict';

function shortestPath(grid, start, end) {
  // Validate grid
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new TypeError('grid must be a non-empty array');
  }
  for (const row of grid) {
    if (typeof row !== 'string') {
      throw new TypeError('grid must be an array of strings');
    }
  }
  const width = grid[0].length;
  for (const row of grid) {
    if (row.length !== width) {
      throw new TypeError('all grid rows must have equal length');
    }
  }

  // Validate start and end
  if (!Array.isArray(start) || start.length !== 2 || !Number.isInteger(start[0]) || !Number.isInteger(start[1])) {
    throw new RangeError('start must be a pair of integers');
  }
  if (!Array.isArray(end) || end.length !== 2 || !Number.isInteger(end[0]) || !Number.isInteger(end[1])) {
    throw new RangeError('end must be a pair of integers');
  }

  const [startRow, startCol] = start;
  const [endRow, endCol] = end;
  const height = grid.length;

  if (startRow < 0 || startRow >= height || startCol < 0 || startCol >= width) {
    throw new RangeError('start is outside the grid');
  }
  if (endRow < 0 || endRow >= height || endCol < 0 || endCol >= width) {
    throw new RangeError('end is outside the grid');
  }

  // Check if start or end is a wall
  if (grid[startRow][startCol] === '#') {
    return -1;
  }
  if (grid[endRow][endCol] === '#') {
    return -1;
  }

  // If start and end are the same
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
      const newRow = row + dr;
      const newCol = col + dc;

      if (newRow >= 0 && newRow < height && newCol >= 0 && newCol < width &&
          grid[newRow][newCol] === '.' && !visited.has(`${newRow},${newCol}`)) {
        if (newRow === endRow && newCol === endCol) {
          return dist + 1;
        }
        visited.add(`${newRow},${newCol}`);
        queue.push([newRow, newCol, dist + 1]);
      }
    }
  }

  return -1;
}

module.exports = { shortestPath };
