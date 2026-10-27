export type KeyframeReason = 'initial' | 'interval' | 'motion' | 'confidence' | 'scene-change' | 'manual';

export interface FrameSignals {
  motion: number;
  lowConfidenceFraction: number;
  sceneDifference: number;
}

export interface SchedulerOptions {
  interval: number;
  motionThreshold: number;
  confidenceThreshold: number;
  sceneThreshold: number;
}

const DEFAULTS: SchedulerOptions = {
  interval: 5,
  motionThreshold: 7,
  confidenceThreshold: 0.34,
  sceneThreshold: 0.2,
};

export class KeyframeScheduler {
  private options: SchedulerOptions;
  private hasKeyframe = false;
  private inferenceRunning = false;
  private framesSinceKeyframe = 0;

  constructor(options: Partial<SchedulerOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  setInterval(interval: number): void {
    this.options.interval = Math.min(8, Math.max(2, Math.round(interval)));
  }

  beginFrame(signals: FrameSignals, manual = false): KeyframeReason | null {
    this.framesSinceKeyframe += 1;
    if (this.inferenceRunning) return null;
    let reason: KeyframeReason | null = null;
    if (manual) reason = 'manual';
    else if (!this.hasKeyframe) reason = 'initial';
    else if (signals.sceneDifference >= this.options.sceneThreshold) reason = 'scene-change';
    else if (signals.lowConfidenceFraction >= this.options.confidenceThreshold) reason = 'confidence';
    else if (signals.motion >= this.options.motionThreshold) reason = 'motion';
    else if (this.framesSinceKeyframe >= this.options.interval) reason = 'interval';
    if (reason) this.inferenceRunning = true;
    return reason;
  }

  complete(): void {
    this.inferenceRunning = false;
    this.hasKeyframe = true;
    this.framesSinceKeyframe = 0;
  }

  fail(): void {
    this.inferenceRunning = false;
  }

  get age(): number { return this.framesSinceKeyframe; }
  get busy(): boolean { return this.inferenceRunning; }
}
