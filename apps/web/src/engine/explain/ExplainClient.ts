import type { InferenceBackend } from '../inference/messages';
import type { ExplainWorkerResponse } from './messages';

export interface ExplainResult {
  backend: InferenceBackend;
  depth: Float32Array;
  rollout: Float32Array;
  pcaColors: Uint8ClampedArray;
  width: number;
  height: number;
  gridColumns: number;
  gridRows: number;
  layers: number;
  heads: number;
  loadMs: number;
  inferenceMs: number;
}

interface PendingInspection {
  resolve: (result: ExplainResult) => void;
  reject: (error: Error) => void;
  onProgress: (message: string) => void;
}

export class ExplainClient {
  private readonly worker: Worker;
  private inspection: PendingInspection | null = null;
  private readonly maps = new Map<number, { resolve: (values: Float32Array) => void; reject: (error: Error) => void }>();
  private nextRequestId = 1;

  constructor() {
    this.worker = new Worker(new URL('./explain.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  inspect(pixels: Uint8ClampedArray, width: number, height: number, preferredBackend: InferenceBackend, onProgress: (message: string) => void): Promise<ExplainResult> {
    if (this.inspection) return Promise.reject(new Error('An explanation is already running.'));
    return new Promise((resolve, reject) => {
      this.inspection = { resolve, reject, onProgress };
      this.worker.postMessage({ type: 'inspect', pixels, width, height, preferredBackend }, [pixels.buffer]);
    });
  }

  attentionMap(layer: number, head: number | null, queryPatch: number): Promise<Float32Array> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.maps.set(requestId, { resolve, reject });
      this.worker.postMessage({ type: 'attention-map', requestId, layer, head, queryPatch });
    });
  }

  dispose(): void {
    const error = new Error('The explainability worker was disposed.');
    this.inspection?.reject(error);
    for (const pending of this.maps.values()) pending.reject(error);
    this.inspection = null;
    this.maps.clear();
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
  }

  private handleMessage = (event: MessageEvent<ExplainWorkerResponse>): void => {
    const message = event.data;
    if (message.type === 'progress') {
      this.inspection?.onProgress(message.message);
      return;
    }
    if (message.type === 'inspect-result') {
      this.inspection?.resolve(message);
      this.inspection = null;
      return;
    }
    if (message.type === 'attention-map-result') {
      this.maps.get(message.requestId)?.resolve(message.values);
      this.maps.delete(message.requestId);
      return;
    }
    if (message.requestId !== undefined) {
      this.maps.get(message.requestId)?.reject(new Error(message.message));
      this.maps.delete(message.requestId);
    } else {
      this.inspection?.reject(new Error(message.message));
      this.inspection = null;
    }
  };

  private handleWorkerError = (event: ErrorEvent): void => {
    const error = new Error(event.message || 'The explainability worker crashed.');
    this.inspection?.reject(error);
    for (const pending of this.maps.values()) pending.reject(error);
    this.inspection = null;
    this.maps.clear();
  };
}
