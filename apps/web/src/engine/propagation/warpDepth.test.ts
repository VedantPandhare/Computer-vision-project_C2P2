import { describe, expect, it } from 'vitest';
import { warpDepth } from './warpDepth';

describe('warpDepth', () => {
  it('preserves a static depth map', () => {
    const anchor = new Float32Array([0, 0.25, 0.5, 1]);
    const result = warpDepth(anchor, 2, 2, new Float32Array(8), new Float32Array([1, 1, 1, 1]), 2, 2);
    expect(Array.from(result.depth)).toEqual(Array.from(anchor));
    expect(Array.from(result.confidence)).toEqual([1, 1, 1, 1]);
  });

  it('backward-warps a translated row and marks outside samples', () => {
    const anchor = new Float32Array([0, 0.5, 1]);
    const flow = new Float32Array([-1, 0, -1, 0, -1, 0]);
    const result = warpDepth(anchor, 3, 1, flow, new Float32Array([1, 1, 1]), 3, 1);
    expect(Array.from(result.depth)).toEqual([0, 0, 0.5]);
    expect(Array.from(result.confidence)).toEqual([0, 1, 1]);
  });
});
