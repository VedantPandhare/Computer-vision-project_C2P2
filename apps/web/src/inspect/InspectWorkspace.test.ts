import { describe, expect, it } from 'vitest';
import { depthBandPixels, depthRelationshipPixels, depthSimilarityPixels, describeRelativeDepth, pixelToPatch } from './InspectWorkspace';

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

  it('separates nearer, similar, and farther regions around the selection', () => {
    const pixels = depthRelationshipPixels(new Float32Array([0.5, 0.8, 0.2]), 3, 1, { column: 0, row: 0, index: 0 }, 3, 1, 0.05);
    expect(Array.from(pixels.slice(0, 3))).toEqual([184, 245, 50]);
    expect(Array.from(pixels.slice(4, 7))).toEqual([239, 113, 92]);
    expect(Array.from(pixels.slice(8, 11))).toEqual([55, 87, 190]);
  });

  it('brightens only the selected quantized depth layer', () => {
    const pixels = depthBandPixels(new Float32Array([0.1, 0.12, 0.8]), 0.1, 'luma');
    expect(pixels[0]).toBe(pixels[4]);
    expect(pixels[0]).toBeGreaterThan(pixels[8]);
  });

  it('describes a selected relative-depth value in plain language', () => {
    expect(describeRelativeDepth(0.8)).toBe('80% · nearer region');
  });
});
