'use strict';

function spiral(matrix) {
  // Validate input
  if (!Array.isArray(matrix)) {
    throw new TypeError('matrix must be an array');
  }
  
  // Handle empty matrix
  if (matrix.length === 0) {
    return [];
  }
  
  // Validate that all rows are arrays of the same length
  const rowLength = matrix[0].length;
  for (let i = 0; i < matrix.length; i++) {
    if (!Array.isArray(matrix[i]) || matrix[i].length !== rowLength) {
      throw new TypeError('All rows must be arrays of the same length');
    }
  }
  
  // Handle case where the first row is empty (matrix is [[]])
  if (rowLength === 0) {
    return [];
  }
  
  const out = [];
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = rowLength - 1;
  
  while (top <= bottom && left <= right) {
    // Traverse right
    for (let c = left; c <= right; c++) {
      out.push(matrix[top][c]);
    }
    top++;
    
    // Traverse down
    for (let r = top; r <= bottom; r++) {
      out.push(matrix[r][right]);
    }
    right--;
    
    // Traverse left (if there's a row remaining)
    if (top <= bottom) {
      for (let c = right; c >= left; c--) {
        out.push(matrix[bottom][c]);
      }
      bottom--;
    }
    
    // Traverse up (if there's a column remaining)
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
