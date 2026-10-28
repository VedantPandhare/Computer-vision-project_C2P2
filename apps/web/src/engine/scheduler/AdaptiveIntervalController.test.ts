import { describe, expect, it } from 'vitest';
import { AdaptiveIntervalController } from './AdaptiveIntervalController';

const calm = { motion: 0.2, lowConfidenceFraction: 0.02, sceneDifference: 0.01 };
const motion = { motion: 5, lowConfidenceFraction: 0.02, sceneDifference: 0.01 };

describe('AdaptiveIntervalController', () => {
  it('shortens after sustained motion instead of reacting to one frame', () => {
    const controller = new AdaptiveIntervalController(5);
    expect(controller.update(motion, 100)).toBe(5);
    expect(controller.update(motion, 100)).toBe(4);
  });

  it('lengthens only after a calm hysteresis window', () => {
    const controller = new AdaptiveIntervalController(5);
    for (let index = 0; index < 9; index += 1) expect(controller.update(calm, 100)).toBe(5);
    expect(controller.update(calm, 100)).toBe(6);
  });
});
