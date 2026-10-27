import { describe, expect, it } from 'vitest';
import { KeyframeScheduler } from './KeyframeScheduler';

const quiet = { motion: 0, lowConfidenceFraction: 0, sceneDifference: 0 };

describe('KeyframeScheduler', () => {
  it('requests an initial keyframe and prevents overlapping inference', () => {
    const scheduler = new KeyframeScheduler();
    expect(scheduler.beginFrame(quiet)).toBe('initial');
    expect(scheduler.beginFrame(quiet)).toBeNull();
    scheduler.complete();
    expect(scheduler.busy).toBe(false);
  });

  it('refreshes on the configured interval', () => {
    const scheduler = new KeyframeScheduler({ interval: 2 });
    scheduler.beginFrame(quiet);
    scheduler.complete();
    expect(scheduler.beginFrame(quiet)).toBeNull();
    expect(scheduler.beginFrame(quiet)).toBe('interval');
  });

  it.each([
    [{ ...quiet, motion: 8 }, 'motion'],
    [{ ...quiet, lowConfidenceFraction: 0.5 }, 'confidence'],
    [{ ...quiet, sceneDifference: 0.3 }, 'scene-change'],
  ] as const)('reacts to frame signal %o', (signals, reason) => {
    const scheduler = new KeyframeScheduler();
    scheduler.beginFrame(quiet);
    scheduler.complete();
    expect(scheduler.beginFrame(signals)).toBe(reason);
  });

  it('prioritizes a manual refresh', () => {
    const scheduler = new KeyframeScheduler();
    scheduler.beginFrame(quiet);
    scheduler.complete();
    expect(scheduler.beginFrame(quiet, true)).toBe('manual');
  });

  it('queues a trigger that occurs while inference is busy', () => {
    const scheduler = new KeyframeScheduler();
    scheduler.beginFrame(quiet);
    expect(scheduler.beginFrame({ ...quiet, sceneDifference: 0.4 })).toBeNull();
    scheduler.complete();
    expect(scheduler.beginFrame(quiet)).toBe('scene-change');
  });
});
