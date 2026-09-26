'use strict';

function spiral(matrix) {
  if (!Array.isArray(matrix)) {
    throw new TypeError('Input must be an array');
  }
  const rows = matrix.length;
  if (rows === 0) return [];
  const cols = matrix[0].length;
  for (let i = 1; i < rows; i++) {
    if (!Array.isArray(matrix[i]) || matrix[i].length !== cols) {
      throw new TypeError('All rows must be arrays of the same length');
    }
  }
  const out = [];
  let top = 0;
  let bottom = rows - 1;
  let left = 0;
  let right = cols - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push(matrix[top][c]);
    top++;
    for (let r = top; r <= bottom; r++) out.push(matrix[r][right]);
    right--;
    for (let c = right; c >= left; c--) out.push(matrix[bottom][c]);
    bottom--;
    for (let r = bottom; r >= top; r--) out.push(matrix[r][left]);
    left++;
  }
  return out;
}

module.exports = { spiral };
