export function normalizeMap(values: Float32Array): Float32Array {
  const normalized = new Float32Array(values.length);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value)) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  const span = maximum - minimum;
  if (!Number.isFinite(span) || span < 1e-12) return normalized;
  for (let index = 0; index < values.length; index += 1) {
    normalized[index] = Math.min(1, Math.max(0, (values[index] - minimum) / span));
  }
  return normalized;
}

function multiplyByCovariance(matrix: Float32Array, rows: number, columns: number, vector: Float32Array): Float32Array {
  const projected = new Float32Array(rows);
  for (let row = 0; row < rows; row += 1) {
    let sum = 0;
    const offset = row * columns;
    for (let column = 0; column < columns; column += 1) sum += matrix[offset + column] * vector[column];
    projected[row] = sum;
  }
  const result = new Float32Array(columns);
  for (let row = 0; row < rows; row += 1) {
    const offset = row * columns;
    for (let column = 0; column < columns; column += 1) result[column] += matrix[offset + column] * projected[row];
  }
  return result;
}

export function pcaColors(tokens: Float32Array, rows: number, columns: number): Uint8ClampedArray {
  if (tokens.length !== rows * columns) throw new Error('Token matrix dimensions do not match.');
  const working = new Float32Array(tokens);
  for (let column = 0; column < columns; column += 1) {
    let mean = 0;
    for (let row = 0; row < rows; row += 1) mean += working[row * columns + column];
    mean /= rows;
    for (let row = 0; row < rows; row += 1) working[row * columns + column] -= mean;
  }

  const componentScores: Float32Array[] = [];
  for (let component = 0; component < 3; component += 1) {
    let vector: Float32Array<ArrayBufferLike> = Float32Array.from({ length: columns }, (_, index) => Math.sin((index + 1) * (component + 1)));
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const next = multiplyByCovariance(working, rows, columns, vector);
      let norm = 0;
      for (const value of next) norm += value * value;
      norm = Math.sqrt(norm) || 1;
      for (let index = 0; index < columns; index += 1) next[index] /= norm;
      vector = next;
    }
    const scores = new Float32Array(rows);
    for (let row = 0; row < rows; row += 1) {
      const offset = row * columns;
      for (let column = 0; column < columns; column += 1) scores[row] += working[offset + column] * vector[column];
    }
    componentScores.push(normalizeMap(scores));
    for (let row = 0; row < rows; row += 1) {
      const offset = row * columns;
      for (let column = 0; column < columns; column += 1) working[offset + column] -= scores[row] * vector[column];
    }
  }

  const colors = new Uint8ClampedArray(rows * 4);
  for (let row = 0; row < rows; row += 1) {
    colors[row * 4] = Math.round(componentScores[0][row] * 255);
    colors[row * 4 + 1] = Math.round(componentScores[1][row] * 255);
    colors[row * 4 + 2] = Math.round(componentScores[2][row] * 255);
    colors[row * 4 + 3] = 255;
  }
  return colors;
}
