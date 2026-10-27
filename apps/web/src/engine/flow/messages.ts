export interface FlowResult {
  flow: Float32Array;
  confidence: Float32Array;
  width: number;
  height: number;
  meanMagnitude: number;
  lowConfidenceFraction: number;
  elapsedMs: number;
}

export type FlowWorkerRequest = {
  type: 'compute';
  requestId: number;
  current: Uint8Array;
  anchor: Uint8Array;
  width: number;
  height: number;
};

export type FlowWorkerResponse =
  | ({ type: 'result'; requestId: number } & FlowResult)
  | { type: 'error'; requestId: number; message: string };
