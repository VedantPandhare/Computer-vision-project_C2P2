export interface AffineFit { scale: number; shift: number; samples: number }

function fitLeastSquares(source: Float32Array, target: Float32Array, indices: number[]): AffineFit {
  if (indices.length < 2) return { scale: 1, shift: 0, samples: indices.length };
  let sourceMean = 0;
  let targetMean = 0;
  for (const index of indices) {
    sourceMean += source[index];
    targetMean += target[index];
  }
  sourceMean /= indices.length;
  targetMean /= indices.length;
  let covariance = 0;
  let variance = 0;
  for (const index of indices) {
    const centered = source[index] - sourceMean;
    covariance += centered * (target[index] - targetMean);
    variance += centered * centered;
  }
  if (variance <= 1e-8) return { scale: 1, shift: targetMean - sourceMean, samples: indices.length };
  const scale = Math.min(4, Math.max(0.25, covariance / variance));
  return { scale, shift: Math.min(1, Math.max(-1, targetMean - scale * sourceMean)), samples: indices.length };
}

export function fitRobustAffine(source: Float32Array, target: Float32Array, confidence?: Float32Array): AffineFit {
  const count = Math.min(source.length, target.length, confidence?.length ?? Number.MAX_SAFE_INTEGER);
  const stride = Math.max(1, Math.floor(count / 20_000));
  const candidates: number[] = [];
  for (let index = 0; index < count; index += stride) {
    if ((!confidence || confidence[index] >= 0.45) && Number.isFinite(source[index]) && Number.isFinite(target[index])) candidates.push(index);
  }
  const initial = fitLeastSquares(source, target, candidates);
  if (candidates.length < 8) return initial;
  const residuals = candidates.map((index) => Math.abs(target[index] - (source[index] * initial.scale + initial.shift))).sort((a, b) => a - b);
  const cutoff = Math.max(0.025, residuals[Math.floor(residuals.length * 0.85)] * 1.5);
  const inliers = candidates.filter((index) => Math.abs(target[index] - (source[index] * initial.scale + initial.shift)) <= cutoff);
  return fitLeastSquares(source, target, inliers);
}

export function applyAffine(values: Float32Array, fit: AffineFit): Float32Array {
  return Float32Array.from(values, (value) => Math.min(1, Math.max(0, value * fit.scale + fit.shift)));
}

export function stabilizeDepth(
  current: Float32Array,
  previous: Float32Array | null,
  confidence: Float32Array,
  transition: number,
  motion: number,
): Float32Array {
  if (!previous || previous.length !== current.length) return current.slice();
  const result = new Float32Array(current.length);
  const motionRelease = Math.min(1, Math.max(0, motion / 8));
  const temporalBase = 0.6 + motionRelease * 0.3;
  for (let index = 0; index < result.length; index += 1) {
    const trust = 0.08 + 0.92 * Math.min(1, Math.max(0, confidence[index] ?? 0));
    const weight = Math.min(1, transition * trust * temporalBase);
    result[index] = previous[index] + (current[index] - previous[index]) * weight;
  }
  return result;
}
