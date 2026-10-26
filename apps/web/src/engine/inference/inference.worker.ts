/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/webgpu';
import { MODEL_CONFIG } from './modelConfig';
import { calculateModelSize, normalizeDepth } from './depthMath';
import type {
  InferenceBackend,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
} from './messages';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
let session: ort.InferenceSession | null = null;
let sessionBackend: InferenceBackend | null = null;

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

async function ensureSession(preferredBackend: InferenceBackend): Promise<{
  backend: InferenceBackend;
  loadMs: number;
}> {
  if (session && sessionBackend) return { backend: sessionBackend, loadMs: 0 };

  const started = performance.now();
  let backend = preferredBackend;

  try {
    session = await createSession(preferredBackend);
  } catch (preferredError) {
    if (preferredBackend === 'wasm') throw preferredError;
    backend = 'wasm';
    respond({ type: 'progress', message: 'WebGPU session failed. Trying WebAssembly…' });
    session = await createSession('wasm');
  }

  sessionBackend = backend;
  return { backend, loadMs: performance.now() - started };
}

async function runProbe(preferredBackend: InferenceBackend): Promise<void> {
  respond({ type: 'progress', message: `Loading the model with ${preferredBackend.toUpperCase()}…` });
  const { backend, loadMs } = await ensureSession(preferredBackend);
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

function imageToTensor(image: ImageBitmap): { tensor: ort.Tensor; modelWidth: number; modelHeight: number } {
  const { width: modelWidth, height: modelHeight } = calculateModelSize(image.width, image.height);
  const canvas = new OffscreenCanvas(modelWidth, modelHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser could not create an image preprocessing canvas.');

  context.drawImage(image, 0, 0, modelWidth, modelHeight);
  const pixels = context.getImageData(0, 0, modelWidth, modelHeight).data;
  const planeSize = modelWidth * modelHeight;
  const input = new Float32Array(planeSize * 3);
  const mean = [0.485, 0.456, 0.406];
  const standardDeviation = [0.229, 0.224, 0.225];

  for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    input[pixelIndex] = (pixels[rgbaIndex] / 255 - mean[0]) / standardDeviation[0];
    input[planeSize + pixelIndex] = (pixels[rgbaIndex + 1] / 255 - mean[1]) / standardDeviation[1];
    input[planeSize * 2 + pixelIndex] = (pixels[rgbaIndex + 2] / 255 - mean[2]) / standardDeviation[2];
  }

  return {
    tensor: new ort.Tensor('float32', input, [1, 3, modelHeight, modelWidth]),
    modelWidth,
    modelHeight,
  };
}

async function estimateDepth(image: ImageBitmap, preferredBackend: InferenceBackend): Promise<void> {
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  respond({ type: 'progress', message: `Loading ${MODEL_CONFIG.label}…` });
  const { backend, loadMs } = await ensureSession(preferredBackend);

  respond({ type: 'progress', message: 'Preparing image pixels for the model…' });
  const { tensor, modelWidth, modelHeight } = imageToTensor(image);
  image.close();

  if (!session) throw new Error('The inference session was not created.');
  respond({ type: 'progress', message: 'Estimating relative depth…' });
  const inferenceStarted = performance.now();
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const inferenceMs = performance.now() - inferenceStarted;
  const output = results[session.outputNames[0]];
  if (!output || !(output.data instanceof Float32Array)) {
    throw new Error('The model did not return a floating-point depth map.');
  }

  const dims = output.dims;
  const height = Number(dims.at(-2) ?? modelHeight);
  const width = Number(dims.at(-1) ?? modelWidth);
  const depth = normalizeDepth(output.data);

  const response: InferenceWorkerResponse = {
    type: 'estimate-result',
    backend,
    depth,
    width,
    height,
    sourceWidth,
    sourceHeight,
    loadMs,
    inferenceMs,
  };
  workerScope.postMessage(response, [depth.buffer]);
}

workerScope.addEventListener('message', (event: MessageEvent<InferenceWorkerRequest>) => {
  if (event.data.type === 'dispose') {
    void session?.release();
    session = null;
    workerScope.close();
    return;
  }

  if (event.data.type === 'estimate') {
    void estimateDepth(event.data.image, event.data.preferredBackend).catch((error: unknown) => {
      event.data.image.close();
      respond({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown depth estimation error.',
      });
    });
    return;
  }

  void runProbe(event.data.preferredBackend).catch((error: unknown) => {
    respond({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown model feasibility error.',
    });
  });
});
