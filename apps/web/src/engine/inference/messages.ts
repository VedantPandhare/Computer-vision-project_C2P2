export type InferenceBackend = 'webgpu' | 'wasm';

export type InferenceWorkerRequest =
  | { type: 'probe'; preferredBackend: InferenceBackend }
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
  | { type: 'error'; message: string };

