import { describe, expect, it } from 'vitest';
import { pixelToPatch } from './InspectWorkspace';

describe('pixelToPatch', () => {
  it('maps an image coordinate to the 14-pixel transformer grid', () => {
    expect(pixelToPatch(29, 15, 56)).toEqual({ column: 2, row: 1, index: 6 });
  });
});
