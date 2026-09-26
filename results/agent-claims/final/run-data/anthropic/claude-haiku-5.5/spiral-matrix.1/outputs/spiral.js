'use strict';

function spiral(matrix) {
  // Validate input
  if (!Array.isArray(matrix)) {
    throw new TypeError();
  }
  
  // Handle empty matrix
  if (matrix.length === 0) {
    return [];
  }
  
  // Handle matrix with empty rows
  const rowLength = matrix[0].length;
  if (rowLength === 0) {
    return [];
  }
  
  // Validate all rows have the same length
  for (let i = 0; i < matrix.length; i++) {
    if (!Array.isArray(matrix[i]) || matrix[i].length !== rowLength) {
      throw new TypeError();
    }
  }
  
  const out = [];
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = rowLength - 1;
  
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
