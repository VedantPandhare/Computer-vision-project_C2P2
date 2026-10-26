/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/webgpu';
import { MODEL_CONFIG } from './modelConfig';
import type {
  InferenceBackend,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
} from './messages';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let session: ort.InferenceSession | null = null;

function respond(message: InferenceWorkerResponse): void {
  workerScope.postMessage(message);
}

async function createSession(backend: InferenceBackend): Promise<ort.InferenceSession> {
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
  };

  return ort.InferenceSession.create(MODEL_CONFIG.url, options);
}

async function runProbe(preferredBackend: InferenceBackend): Promise<void> {
  const loadStarted = performance.now();
  let backend = preferredBackend;

  respond({ type: 'progress', message: `Loading the model with ${preferredBackend.toUpperCase()}…` });

  try {
    session = await createSession(preferredBackend);
  } catch (preferredError) {
    if (preferredBackend === 'wasm') {
      throw preferredError;
    }

    backend = 'wasm';
    respond({ type: 'progress', message: 'WebGPU session failed. Trying WebAssembly…' });
    session = await createSession('wasm');
  }

  const loadMs = performance.now() - loadStarted;
  const elementCount = MODEL_CONFIG.channels * MODEL_CONFIG.inputWidth * MODEL_CONFIG.inputHeight;
  const inputData = new Float32Array(elementCount);
  const inputName = session.inputNames[0];
  const input = new ort.Tensor('float32', inputData, [
    1,
    MODEL_CONFIG.channels,
    MODEL_CONFIG.inputHeight,
    MODEL_CONFIG.inputWidth,
  ]);

  respond({ type: 'progress', message: 'Running one synthetic inference to validate the graph…' });
  const inferenceStarted = performance.now();
  const output = await session.run({ [inputName]: input });
  const inferenceMs = performance.now() - inferenceStarted;
  const firstOutput = output[session.outputNames[0]];

  if (!firstOutput || firstOutput.size === 0) {
    throw new Error('The model returned no depth values.');
  }

  respond({
    type: 'probe-result',
    backend,
    loadMs,
    inferenceMs,
    outputShape: firstOutput.dims,
  });
}

workerScope.addEventListener('message', (event: MessageEvent<InferenceWorkerRequest>) => {
  if (event.data.type === 'dispose') {
    void session?.release();
    session = null;
    workerScope.close();
    return;
  }

  void runProbe(event.data.preferredBackend).catch((error: unknown) => {
    respond({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown model feasibility error.',
    });
  });
});

