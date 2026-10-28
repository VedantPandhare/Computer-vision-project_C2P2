import { describe, expect, it } from 'vitest';
import { TelemetryStore } from './TelemetryStore';

describe('TelemetryStore', () => {
  it('records timing percentiles and keyframe reasons', () => {
    const store = new TelemetryStore();
    store.recordTimings({ flow: 10 }, 100);
    store.recordTimings({ flow: 20 }, 200);
    store.recordKeyframe({ timestamp: 200, frameId: 7, reason: 'motion', inferenceMs: 90 });
    const snapshot = store.snapshot();
    expect(snapshot.median.flow).toBe(15);
    expect(snapshot.p95.flow).toBeCloseTo(19.5);
    expect(snapshot.keyframeEvents[0].reason).toBe('motion');
    expect(snapshot.totalModelCalls).toBe(1);
  });
});
