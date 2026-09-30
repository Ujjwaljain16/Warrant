'use strict';

function spiral(matrix) {
  if (!Array.isArray(matrix)) {
    throw new TypeError('matrix must be an array');
  }
  if (matrix.length === 0) {
    return [];
  }
  if (matrix.length === 1 && matrix[0].length === 0) {
    return [];
  }

  const rowLength = matrix[0].length;
  for (let i = 0; i < matrix.length; i++) {
    if (!Array.isArray(matrix[i]) || matrix[i].length !== rowLength) {
      throw new TypeError('All rows must be arrays of the same length');
    }
  }

  const out = [];
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix[0].length - 1;

  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) {
      out.push(matrix[top][c]);
    }
    top++;

    for (let r = top; r <= bottom; r++) {
      out.push(matrix[r][right]);
    }
    right--;

    if (top <= bottom) {
      for (let c = right; c >= left; c--) {
        out.push(matrix[bottom][c]);
      }
      bottom--;
    }

    if (left <= right) {
      for (let r = bottom; r >= top; r--) {
        out.push(matrix[r][left]);
      }
      left++;
    }
  }

  return out;
}

module.exports = { spiral };
