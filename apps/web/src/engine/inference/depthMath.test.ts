import { describe, expect, it } from 'vitest';
import { calculateModelSize, normalizeDepth } from './depthMath';

describe('calculateModelSize', () => {
  it('preserves a landscape aspect ratio and uses patch-size multiples', () => {
    const size = calculateModelSize(640, 480);
    expect(size.width % 14).toBe(0);
    expect(size.height % 14).toBe(0);
    expect(size.width).toBeGreaterThan(size.height);
    expect(size.height).toBeGreaterThanOrEqual(518);
  });

  it('handles portrait images without forcing them into a square', () => {
    const size = calculateModelSize(600, 900);
    expect(size.height).toBeGreaterThan(size.width);
    expect(size.width).toBeGreaterThanOrEqual(518);
  });
});

describe('normalizeDepth', () => {
  it('maps the robust range to zero through one', () => {
    const normalized = normalizeDepth(Float32Array.from([10, 20, 30, 40, 50]), 0, 1);
    expect(Array.from(normalized)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('clamps outliers and replaces non-finite values', () => {
    const normalized = normalizeDepth(Float32Array.from([-100, 0, 1, 2, 100, Number.NaN]), 0.2, 0.8);
    expect(normalized[0]).toBe(0);
    expect(normalized[4]).toBe(1);
    expect(normalized[5]).toBe(0);
  });
});
