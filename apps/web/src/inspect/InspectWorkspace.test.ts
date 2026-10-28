import { describe, expect, it } from 'vitest';
import { depthSimilarityPixels, pixelToPatch } from './InspectWorkspace';

describe('pixelToPatch', () => {
  it('maps an image coordinate to the 14-pixel transformer grid', () => {
    expect(pixelToPatch(29, 15, 56, 28, 4, 2)).toEqual({ column: 2, row: 1, index: 6 });
  });

  it('clamps edge clicks to the final patch', () => {
    expect(pixelToPatch(56, 28, 56, 28, 4, 2)).toEqual({ column: 3, row: 1, index: 7 });
  });

  it('highlights pixels with depth close to the selected patch', () => {
    const pixels = depthSimilarityPixels(new Float32Array([0.2, 0.21, 0.9, 1]), 2, 2, { column: 0, row: 0, index: 0 }, 2, 2);
    expect(pixels[1]).toBeGreaterThan(pixels[9]);
  });
});
