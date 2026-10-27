import { describe, expect, it } from 'vitest';
import { frameDifference } from './LiveWorkspace';

describe('frameDifference', () => {
  it('returns zero for the first or unchanged frame', () => {
    const frame = new Uint8Array([10, 20, 30, 40]);
    expect(frameDifference(null, frame)).toBe(0);
    expect(frameDifference(frame, frame)).toBe(0);
  });

  it('normalizes brightness changes', () => {
    expect(frameDifference(new Uint8Array([0, 0, 0, 0]), new Uint8Array([255, 255, 255, 255]))).toBe(1);
  });
});
