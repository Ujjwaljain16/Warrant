'use strict';

function shortestPath(grid, start, end) {
  // Validate grid
  if (!Array.isArray(grid) || grid.length === 0) {
    throw new TypeError('grid must be a non-empty array');
  }
  if (!grid.every(row => typeof row === 'string')) {
    throw new TypeError('grid must contain only strings');
  }
  const gridWidth = grid[0].length;
  if (!grid.every(row => row.length === gridWidth)) {
    throw new TypeError('all rows must have equal length');
  }

  // Validate start and end coordinates
  const validateCoord = (coord, name) => {
    if (!Array.isArray(coord) || coord.length !== 2 ||
        !Number.isInteger(coord[0]) || !Number.isInteger(coord[1])) {
      throw new RangeError(`${name} must be a pair of integers`);
    }
    const [row, col] = coord;
    if (row < 0 || row >= grid.length || col < 0 || col >= gridWidth) {
      throw new RangeError(`${name} is outside the grid`);
    }
  };
  validateCoord(start, 'start');
  validateCoord(end, 'end');

  const [startRow, startCol] = start;
  const [endRow, endCol] = end;

  // Check if start or end is a wall
  if (grid[startRow][startCol] === '#' || grid[endRow][endCol] === '#') {
    return -1;
  }

  // If start and end are the same
  if (startRow === endRow && startCol === endCol) {
    return 0;
  }

  // BFS to find shortest path
  const queue = [[startRow, startCol, 0]];
  const visited = new Set();
  visited.add(`${startRow},${startCol}`);

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (queue.length > 0) {
    const [row, col, dist] = queue.shift();

    for (const [dRow, dCol] of directions) {
      const newRow = row + dRow;
      const newCol = col + dCol;

      if (newRow < 0 || newRow >= grid.length || newCol < 0 || newCol >= gridWidth) {
        continue;
      }

      if (grid[newRow][newCol] === '#') {
        continue;
      }

      const key = `${newRow},${newCol}`;
      if (visited.has(key)) {
        continue;
      }

      if (newRow === endRow && newCol === endCol) {
        return dist + 1;
      }

      visited.add(key);
      queue.push([newRow, newCol, dist + 1]);
    }
  }

  return -1;
}

module.exports = { shortestPath };
