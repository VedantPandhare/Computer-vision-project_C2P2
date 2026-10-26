export type InferenceBackend = 'webgpu' | 'wasm';

export type InferenceWorkerRequest =
  | { type: 'probe'; preferredBackend: InferenceBackend }
  | { type: 'estimate'; preferredBackend: InferenceBackend; image: ImageBitmap }
  | { type: 'dispose' };

export type InferenceWorkerResponse =
  | { type: 'progress'; message: string }
  | {
      type: 'probe-result';
      backend: InferenceBackend;
      loadMs: number;
      inferenceMs: number;
      outputShape: readonly number[];
    }
  | {
      type: 'estimate-result';
      backend: InferenceBackend;
      depth: Float32Array;
      width: number;
      height: number;
      sourceWidth: number;
      sourceHeight: number;
      loadMs: number;
      inferenceMs: number;
    }
  | { type: 'error'; message: string };
