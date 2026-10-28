import type { InferenceBackend } from '../inference/messages';

export type ExplainWorkerRequest =
  | {
      type: 'inspect';
      preferredBackend: InferenceBackend;
      pixels: Uint8ClampedArray;
      width: number;
      height: number;
    }
  | {
      type: 'attention-map';
      requestId: number;
      layer: number;
      head: number | null;
      queryPatch: number;
    }
  | { type: 'dispose' };

export type ExplainWorkerResponse =
  | { type: 'progress'; message: string }
  | {
      type: 'inspect-result';
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
  | { type: 'attention-map-result'; requestId: number; values: Float32Array }
  | { type: 'error'; message: string; requestId?: number };
