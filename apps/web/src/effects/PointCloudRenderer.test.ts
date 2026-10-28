import { describe, expect, it } from 'vitest';
import { buildPointCloud, pointCloudToPly } from './PointCloudRenderer';

describe('point-cloud export', () => {
  it('back-projects sampled depth and writes matching PLY vertices', () => {
    const depth = new Float32Array([0, 0.25, 0.75, 1]);
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const cloud = buildPointCloud(depth, 2, 2, rgba, 1, 55);
    expect(cloud.count).toBe(4);
    expect(cloud.colors.slice(0, 3)).toEqual(new Uint8Array([255, 0, 0]));
    expect(pointCloudToPly(cloud)).toContain('element vertex 4');
  });
});
