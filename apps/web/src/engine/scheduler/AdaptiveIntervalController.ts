import type { FrameSignals } from './KeyframeScheduler';

export class AdaptiveIntervalController {
  private calmFrames = 0;
  private pressureFrames = 0;

  constructor(private interval = 5) {}

  update(signals: FrameSignals, inferenceMs: number): number {
    const pressured = signals.motion >= 3.5 || signals.lowConfidenceFraction >= 0.22 || signals.sceneDifference >= 0.1;
    const calm = signals.motion < 1.2 && signals.lowConfidenceFraction < 0.1 && signals.sceneDifference < 0.04;

    if (pressured) {
      this.pressureFrames += 1;
      this.calmFrames = 0;
    } else if (calm) {
      this.calmFrames += inferenceMs > 1200 ? 2 : 1;
      this.pressureFrames = 0;
    } else {
      this.calmFrames = Math.max(0, this.calmFrames - 1);
      this.pressureFrames = Math.max(0, this.pressureFrames - 1);
    }

    if (this.pressureFrames >= 2 && this.interval > 2) {
      this.interval -= 1;
      this.pressureFrames = 0;
    } else if (this.calmFrames >= 10 && this.interval < 8) {
      this.interval += 1;
      this.calmFrames = 0;
    }
    return this.interval;
  }

  reset(interval: number): void {
    this.interval = Math.min(8, Math.max(2, Math.round(interval)));
    this.calmFrames = 0;
    this.pressureFrames = 0;
  }
}
