import { describe, expect, it } from 'vitest';
import { normalizeMap, pcaColors } from './explainMath';

describe('explainability math', () => {
  it('normalizes a scalar patch map', () => {
    expect(Array.from(normalizeMap(new Float32Array([2, 4, 6])))).toEqual([0, 0.5, 1]);
  });

  it('turns patch embeddings into opaque RGB colours', () => {
    const colors = pcaColors(new Float32Array([1, 0, 0, 1, -1, 0, 0, -1]), 4, 2);
    expect(colors).toHaveLength(16);
    expect(Array.from(colors.filter((_, index) => index % 4 === 3))).toEqual([255, 255, 255, 255]);
  });
});
