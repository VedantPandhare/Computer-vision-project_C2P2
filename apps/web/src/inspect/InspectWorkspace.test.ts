import { describe, expect, it } from 'vitest';
import { attentionHeatPixels, pixelToPatch } from './InspectWorkspace';

describe('InspectWorkspace helpers', () => {
  it('maps image coordinates to the transformer patch grid', () => {
    expect(pixelToPatch(29, 15, 56, 28, 4, 2)).toEqual({ column: 2, row: 1, index: 6 });
  });

  it('clamps edge clicks to the final patch', () => {
    expect(pixelToPatch(56, 28, 56, 28, 4, 2)).toEqual({ column: 3, row: 1, index: 7 });
  });

  it('renders stronger attention with brighter heat colours', () => {
    const pixels = attentionHeatPixels(new Float32Array([0, 1]));
    expect(pixels[4]).toBeGreaterThan(pixels[0]);
    expect(pixels[5]).toBeGreaterThan(pixels[1]);
  });
});
