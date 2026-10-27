import { describe, expect, it } from 'vitest';
import { applyAffine, fitRobustAffine, stabilizeDepth } from './depthFusion';

describe('depth fusion', () => {
  it('recovers scale and shift while rejecting an outlier', () => {
    const source = Float32Array.from({ length: 100 }, (_, index) => index / 100);
    const target = Float32Array.from(source, (value) => value * 0.6 + 0.2);
    target[50] = 1;
    const fit = fitRobustAffine(source, target, new Float32Array(100).fill(1));
    expect(fit.scale).toBeCloseTo(0.6, 2);
    expect(fit.shift).toBeCloseTo(0.2, 2);
    expect(applyAffine(new Float32Array([0, 1]), fit)[1]).toBeCloseTo(0.8, 2);
  });

  it('holds previous depth where confidence is low', () => {
    const result = stabilizeDepth(new Float32Array([1, 1]), new Float32Array([0, 0]), new Float32Array([0, 1]), 1, 8);
    expect(result[0]).toBeLessThan(0.1);
    expect(result[1]).toBeGreaterThan(0.85);
  });
});
