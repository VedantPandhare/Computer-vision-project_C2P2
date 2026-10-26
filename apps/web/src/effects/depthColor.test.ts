import { describe, expect, it } from 'vitest';
import { depthToRgb } from './depthColor';

describe('depthToRgb', () => {
  it('uses black for far and white for near in the luma palette', () => {
    expect(depthToRgb(0, 'luma')).toEqual([0, 0, 0]);
    expect(depthToRgb(1, 'luma')).toEqual([255, 255, 255]);
  });

  it('clamps values before applying a colour palette', () => {
    expect(depthToRgb(-2, 'viridis')).toEqual(depthToRgb(0, 'viridis'));
    expect(depthToRgb(3, 'turbo')).toEqual(depthToRgb(1, 'turbo'));
  });
});
