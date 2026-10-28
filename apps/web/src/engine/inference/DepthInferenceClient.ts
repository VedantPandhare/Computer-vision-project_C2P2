import type { InferenceBackend, InferenceWorkerResponse } from './messages';
import type { QualityProfileId } from './modelConfig';

export interface DepthResult {
  backend: InferenceBackend;
  depth: Float32Array;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  loadMs: number;
  inferenceMs: number;
}

interface PendingRequest {
  resolve: (result: DepthResult) => void;
  reject: (error: Error) => void;
  onProgress: (message: string) => void;
}

export class DepthInferenceClient {
  private readonly worker: Worker;
  private pending: PendingRequest | null = null;

  constructor() {
    this.worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  estimate(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    preferredBackend: InferenceBackend,
    onProgress: (message: string) => void,
    profile: QualityProfileId = 'quality',
  ): Promise<DepthResult> {
    if (this.pending) {
      return Promise.reject(new Error('A depth estimate is already running.'));
    }

    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, onProgress };
      this.worker.postMessage(
        { type: 'estimate', preferredBackend, pixels, width, height, profile },
        [pixels.buffer],
      );
    });
  }

  dispose(): void {
    this.pending?.reject(new Error('The inference worker was disposed.'));
    this.pending = null;
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
  }

  private handleMessage = (event: MessageEvent<InferenceWorkerResponse>): void => {
    if (!this.pending) return;
    const message = event.data;

    if (message.type === 'progress') {
      this.pending.onProgress(message.message);
      return;
    }

    if (message.type === 'error') {
      this.pending.reject(new Error(message.message));
      this.pending = null;
      return;
    }

    if (message.type === 'estimate-result') {
      this.pending.resolve(message);
      this.pending = null;
    }
  };

  private handleWorkerError = (event: ErrorEvent): void => {
    this.pending?.reject(new Error(event.message || 'The inference worker crashed.'));
    this.pending = null;
  };
}
