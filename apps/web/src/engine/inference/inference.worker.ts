/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/webgpu';
import ortWasmUrl from '../../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import { MODEL_CONFIG } from './modelConfig';
import { calculateModelSize, RunningDepthNormalizer } from './depthMath';
import type {
  InferenceBackend,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
} from './messages';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
ort.env.wasm.numThreads = workerScope.crossOriginIsolated
  ? Math.min(4, workerScope.navigator.hardwareConcurrency || 1)
  : 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, workerScope.location.href).href };
let session: ort.InferenceSession | null = null;
let sessionBackend: InferenceBackend | null = null;
const depthNormalizer = new RunningDepthNormalizer();

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
    try {
      session = await createSession('wasm');
    } catch (fallbackError) {
      const webGpuMessage = preferredError instanceof Error ? preferredError.message : String(preferredError);
      const wasmMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`WebGPU failed: ${webGpuMessage} | WebAssembly failed: ${wasmMessage}`);
    }
  }

  sessionBackend = backend;
  return { backend, loadMs: performance.now() - started };
}

async function runProbe(preferredBackend: InferenceBackend): Promise<void> {
  respond({ type: 'progress', message: `Loading the model with ${preferredBackend.toUpperCase()}…` });
  const { backend, loadMs } = await ensureSession(preferredBackend);
  const activeSession = session;
  if (!activeSession) throw new Error('The inference session was not created.');
  const elementCount = MODEL_CONFIG.channels * MODEL_CONFIG.inputWidth * MODEL_CONFIG.inputHeight;
  const inputData = new Float32Array(elementCount);
  const inputName = activeSession.inputNames[0];
  const input = new ort.Tensor('float32', inputData, [
    1,
    MODEL_CONFIG.channels,
    MODEL_CONFIG.inputHeight,
    MODEL_CONFIG.inputWidth,
  ]);

  respond({ type: 'progress', message: 'Running one synthetic inference to validate the graph…' });
  const inferenceStarted = performance.now();
  const output = await activeSession.run({ [inputName]: input });
  const inferenceMs = performance.now() - inferenceStarted;
  const firstOutput = output[activeSession.outputNames[0]];

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

function imageToTensor(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
): { tensor: ort.Tensor; modelWidth: number; modelHeight: number } {
  const { width: modelWidth, height: modelHeight } = calculateModelSize(sourceWidth, sourceHeight);
  const sourceCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('The browser could not create an image source canvas.');
  const pixelCopy = new Uint8ClampedArray(pixels.length);
  pixelCopy.set(pixels);
  sourceContext.putImageData(new ImageData(pixelCopy, sourceWidth, sourceHeight), 0, 0);

  const canvas = new OffscreenCanvas(modelWidth, modelHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser could not create an image preprocessing canvas.');

  context.drawImage(sourceCanvas, 0, 0, modelWidth, modelHeight);
  const resizedPixels = context.getImageData(0, 0, modelWidth, modelHeight).data;
  const planeSize = modelWidth * modelHeight;
  const input = new Float32Array(planeSize * 3);
  const mean = [0.485, 0.456, 0.406];
  const standardDeviation = [0.229, 0.224, 0.225];

  for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    input[pixelIndex] = (resizedPixels[rgbaIndex] / 255 - mean[0]) / standardDeviation[0];
    input[planeSize + pixelIndex] = (resizedPixels[rgbaIndex + 1] / 255 - mean[1]) / standardDeviation[1];
    input[planeSize * 2 + pixelIndex] = (resizedPixels[rgbaIndex + 2] / 255 - mean[2]) / standardDeviation[2];
  }

  return {
    tensor: new ort.Tensor('float32', input, [1, 3, modelHeight, modelWidth]),
    modelWidth,
    modelHeight,
  };
}

async function estimateDepth(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  preferredBackend: InferenceBackend,
): Promise<void> {
  respond({ type: 'progress', message: `Loading ${MODEL_CONFIG.label}…` });
  const { backend, loadMs } = await ensureSession(preferredBackend);

  respond({ type: 'progress', message: 'Preparing image pixels for the model…' });
  const { tensor, modelWidth, modelHeight } = imageToTensor(pixels, sourceWidth, sourceHeight);

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
  const depth = depthNormalizer.normalize(output.data);

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
    const { pixels, width, height, preferredBackend } = event.data;
    void estimateDepth(pixels, width, height, preferredBackend).catch((error: unknown) => {
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
