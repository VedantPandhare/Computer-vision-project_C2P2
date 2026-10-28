/**
 * TelemetryStore – collects per-frame timing, scheduler events, and rolling stats.
 *
 * All data stays on the device. Nothing is sent to any server.
 *
 * This module is consumed by the telemetry panel UI and the benchmark harness.
 */

import type { KeyframeReason } from '../engine/scheduler/KeyframeScheduler';

/* ─── Stage timing ─── */
export type StageName =
  | 'preprocess'
  | 'inference'
  | 'flow'
  | 'warp'
  | 'fusion'
  | 'effect'
  | 'total';

export interface StageTimings {
  preprocess: number;
  inference: number;
  flow: number;
  warp: number;
  fusion: number;
  effect: number;
  total: number;
}

const EMPTY_TIMINGS: StageTimings = { preprocess: 0, inference: 0, flow: 0, warp: 0, fusion: 0, effect: 0, total: 0 };

/* ─── Keyframe event ─── */
export interface KeyframeEvent {
  timestamp: number;
  frameId: number;
  reason: KeyframeReason;
  inferenceMs: number;
}

/* ─── Snapshot – everything the panel reads each tick ─── */
export interface TelemetrySnapshot {
  cameraFps: number;
  renderFps: number;
  depthFps: number;

  /** Per-stage timings for the latest frame */
  latest: StageTimings;
  /** Median per-stage timings over the rolling window */
  median: StageTimings;
  /** 95th-percentile per-stage timings */
  p95: StageTimings;

  /** Recent keyframe events for the timeline */
  keyframeEvents: readonly KeyframeEvent[];

  /** Current scheduler state */
  schedulerInterval: number;
  keyframeAge: number;
  meanMotion: number;
  lowConfidenceFraction: number;

  /** Backend info */
  backend: string;
  profile: string;
  flowBackend: string;

  /** Quality indicators */
  flickerScore: number;
  confidenceMean: number;

  /** Model calls total */
  totalModelCalls: number;
}

/* ─── Rolling window helpers ─── */
const ROLLING_WINDOW_MS = 3_000;
const MAX_KEYFRAME_EVENTS = 60;

interface TimedSample {
  timestamp: number;
  timings: StageTimings;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

function computePercentileTimings(samples: readonly TimedSample[], p: number): StageTimings {
  const result = { ...EMPTY_TIMINGS };
  if (samples.length === 0) return result;
  for (const stage of Object.keys(EMPTY_TIMINGS) as StageName[]) {
    const values = samples.map((s) => s.timings[stage]).sort((a, b) => a - b);
    result[stage] = percentile(values, p);
  }
  return result;
}

/* ─── FPS counter (rolling 1-second window) ─── */
class FpsCounter {
  private timestamps: number[] = [];

  tick(now: number): void {
    this.timestamps.push(now);
    this.timestamps = this.timestamps.filter((t) => now - t <= 1000);
  }

  get fps(): number {
    return this.timestamps.length;
  }
}

/* ─── The store itself ─── */
export class TelemetryStore {
  /* Rolling frame samples */
  private samples: TimedSample[] = [];

  /* FPS counters */
  private cameraCounter = new FpsCounter();
  private renderCounter = new FpsCounter();
  private depthCounter = new FpsCounter();

  /* Keyframe timeline */
  private events: KeyframeEvent[] = [];

  /* Latest single-frame timings */
  private lastTimings: StageTimings = { ...EMPTY_TIMINGS };

  /* Current state */
  private schedulerInterval = 5;
  private keyframeAge = 0;
  private meanMotion = 0;
  private lowConfidence = 0;
  private backend = 'wasm';
  private profile = 'base';
  private flowBackend = 'opencv-farneback';
  private flickerScore = 0;
  private confidenceMean = 0;
  private totalModelCalls = 0;

  /* Flicker tracking */
  private prevDepthSample: Float32Array | null = null;

  /* ── Record methods ── */

  recordCameraFrame(now: number): void {
    this.cameraCounter.tick(now);
  }

  recordRenderFrame(now: number): void {
    this.renderCounter.tick(now);
  }

  recordDepthFrame(now: number): void {
    this.depthCounter.tick(now);
  }

  recordTimings(timings: Partial<StageTimings>, now = performance.now()): void {
    const full: StageTimings = { ...EMPTY_TIMINGS, ...timings };
    this.lastTimings = full;
    this.samples.push({ timestamp: now, timings: full });
    const cutoff = now - ROLLING_WINDOW_MS;
    this.samples = this.samples.filter((s) => s.timestamp > cutoff);
  }

  recordKeyframe(event: KeyframeEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_KEYFRAME_EVENTS) {
      this.events = this.events.slice(-MAX_KEYFRAME_EVENTS);
    }
    this.totalModelCalls += 1;
  }

  recordSchedulerState(interval: number, age: number, motion: number, lowConf: number): void {
    this.schedulerInterval = interval;
    this.keyframeAge = age;
    this.meanMotion = motion;
    this.lowConfidence = lowConf;
  }

  recordBackendInfo(backend: string, profile: string, flowBackend = 'opencv-farneback'): void {
    this.backend = backend;
    this.profile = profile;
    this.flowBackend = flowBackend;
  }

  recordFlicker(depth: Float32Array, confidence: Float32Array): void {
    if (this.prevDepthSample && this.prevDepthSample.length === depth.length) {
      // Flicker: temporal instability on high-confidence pixels
      let diff = 0;
      let count = 0;
      const stride = Math.max(1, Math.floor(depth.length / 8000));
      for (let i = 0; i < depth.length; i += stride) {
        if (confidence[i] > 0.5) {
          diff += Math.abs(depth[i] - this.prevDepthSample[i]);
          count += 1;
        }
      }
      this.flickerScore = count > 0 ? diff / count : 0;
    }
    // Update confidence mean
    let confSum = 0;
    const confStride = Math.max(1, Math.floor(confidence.length / 4000));
    let confCount = 0;
    for (let i = 0; i < confidence.length; i += confStride) {
      confSum += confidence[i];
      confCount += 1;
    }
    this.confidenceMean = confCount > 0 ? confSum / confCount : 0;
    this.prevDepthSample = depth.slice();
  }

  /* ── Read ── */

  snapshot(): TelemetrySnapshot {
    return {
      cameraFps: this.cameraCounter.fps,
      renderFps: this.renderCounter.fps,
      depthFps: this.depthCounter.fps,
      latest: { ...this.lastTimings },
      median: computePercentileTimings(this.samples, 50),
      p95: computePercentileTimings(this.samples, 95),
      keyframeEvents: [...this.events],
      schedulerInterval: this.schedulerInterval,
      keyframeAge: this.keyframeAge,
      meanMotion: this.meanMotion,
      lowConfidenceFraction: this.lowConfidence,
      backend: this.backend,
      profile: this.profile,
      flowBackend: this.flowBackend,
      flickerScore: this.flickerScore,
      confidenceMean: this.confidenceMean,
      totalModelCalls: this.totalModelCalls,
    };
  }

  reset(): void {
    this.samples = [];
    this.events = [];
    this.lastTimings = { ...EMPTY_TIMINGS };
    this.cameraCounter = new FpsCounter();
    this.renderCounter = new FpsCounter();
    this.depthCounter = new FpsCounter();
    this.prevDepthSample = null;
    this.flickerScore = 0;
    this.confidenceMean = 0;
    this.totalModelCalls = 0;
  }
}

