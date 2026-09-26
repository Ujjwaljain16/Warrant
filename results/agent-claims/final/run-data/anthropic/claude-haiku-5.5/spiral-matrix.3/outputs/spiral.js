'use strict';

function spiral(matrix) {
  const out = [];
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix[0].length - 1;
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
