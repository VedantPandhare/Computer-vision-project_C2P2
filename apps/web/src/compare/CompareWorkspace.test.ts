import { describe, expect, it } from 'vitest';
import { depthJump } from './CompareWorkspace';

describe('depthJump', () => {
  it('reports no jump without a previous frame', () => {
    expect(depthJump(new Float32Array([0, 1]), null)).toBe(0);
  });

  it('reports mean absolute change', () => {
    expect(depthJump(new Float32Array([0.2, 0.8]), new Float32Array([0, 1]))).toBeCloseTo(0.2);
  });
});
