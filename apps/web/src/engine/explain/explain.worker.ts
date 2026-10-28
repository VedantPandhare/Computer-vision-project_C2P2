/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/webgpu';
import ortWasmUrl from '../../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { InferenceBackend } from '../inference/messages';
import { normalizeMap, pcaColors } from './explainMath';
import type { ExplainWorkerRequest, ExplainWorkerResponse } from './messages';

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const MODEL_SIZE = 280;
const GRID_SIZE = 20;
const TOKEN_COUNT = GRID_SIZE * GRID_SIZE + 1;
const MODEL_URL = import.meta.env.VITE_EXPLAIN_MODEL_URL || '/models/depth-anything-v2-small-explain.onnx';
const MODEL_DATA_URL = import.meta.env.VITE_EXPLAIN_MODEL_DATA_URL || `${MODEL_URL}.data`;
const MODEL_DATA_PATH = 'depth-anything-v2-small-explain.onnx.data';

ort.env.wasm.numThreads = workerScope.crossOriginIsolated ? Math.min(4, workerScope.navigator.hardwareConcurrency || 1) : 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, workerScope.location.href).href };

let session: ort.InferenceSession | null = null;
let sessionBackend: InferenceBackend | null = null;
let lastAttentions: Float32Array | null = null;

function respond(message: ExplainWorkerResponse, transfers: Transferable[] = []): void {
  workerScope.postMessage(message, transfers);
}

async function createSession(backend: InferenceBackend): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(MODEL_URL, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
    externalData: [{ path: MODEL_DATA_PATH, data: MODEL_DATA_URL }],
  });
}

async function ensureSession(preferredBackend: InferenceBackend): Promise<{ backend: InferenceBackend; loadMs: number }> {
  if (session && sessionBackend) return { backend: sessionBackend, loadMs: 0 };
  const started = performance.now();
  let backend = preferredBackend;
  try {
    session = await createSession(backend);
  } catch (preferredError) {
    if (preferredBackend === 'wasm') throw preferredError;
    backend = 'wasm';
    respond({ type: 'progress', message: 'WebGPU could not load the explain graph. Trying WebAssembly…' });
    try {
      session = await createSession(backend);
    } catch (fallbackError) {
      const webGpuMessage = preferredError instanceof Error ? preferredError.message : String(preferredError);
      const wasmMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`WebGPU failed: ${webGpuMessage} | WebAssembly failed: ${wasmMessage}`);
    }
  }
  sessionBackend = backend;
  return { backend, loadMs: performance.now() - started };
}

function imageToTensor(pixels: Uint8ClampedArray, width: number, height: number): ort.Tensor {
  const source = new OffscreenCanvas(width, height);
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('The browser could not create the image source.');
  const copy = new Uint8ClampedArray(pixels.length);
  copy.set(pixels);
  sourceContext.putImageData(new ImageData(copy, width, height), 0, 0);
  const resized = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const context = resized.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser could not resize the inspection image.');
  context.drawImage(source, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const rgba = context.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const plane = MODEL_SIZE * MODEL_SIZE;
  const input = new Float32Array(plane * 3);
  const mean = [0.485, 0.456, 0.406];
  const deviation = [0.229, 0.224, 0.225];
  for (let index = 0; index < plane; index += 1) {
    const rgbaIndex = index * 4;
    input[index] = (rgba[rgbaIndex] / 255 - mean[0]) / deviation[0];
    input[plane + index] = (rgba[rgbaIndex + 1] / 255 - mean[1]) / deviation[1];
    input[plane * 2 + index] = (rgba[rgbaIndex + 2] / 255 - mean[2]) / deviation[2];
  }
  return new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
}

function floatingOutput(results: ort.InferenceSession.OnnxValueMapType, name: string): Float32Array {
  const value = results[name];
  if (!value || !(value.data instanceof Float32Array)) throw new Error(`The explain graph did not return ${name}.`);
  return value.data;
}

async function inspect(pixels: Uint8ClampedArray, width: number, height: number, preferredBackend: InferenceBackend): Promise<void> {
  respond({ type: 'progress', message: 'Loading the 99 MB explainability model on demand…' });
  const { backend, loadMs } = await ensureSession(preferredBackend);
  if (!session) throw new Error('The explainability session was not created.');
  respond({ type: 'progress', message: 'Running depth, 12 attention layers, and patch embeddings…' });
  const tensor = imageToTensor(pixels, width, height);
  const started = performance.now();
  const results = await session.run({ [session.inputNames[0]]: tensor });
  const inferenceMs = performance.now() - started;
  const depth = normalizeMap(floatingOutput(results, 'depth'));
  const rollout = normalizeMap(floatingOutput(results, 'rollout'));
  const tokens = floatingOutput(results, 'tokens');
  const colors = pcaColors(tokens, GRID_SIZE * GRID_SIZE, 384);
  lastAttentions = floatingOutput(results, 'attentions');
  respond({
    type: 'inspect-result', backend, depth, rollout, pcaColors: colors,
    width: MODEL_SIZE, height: MODEL_SIZE, gridColumns: GRID_SIZE, gridRows: GRID_SIZE,
    layers: 12, heads: 6, loadMs, inferenceMs,
  }, [depth.buffer, rollout.buffer, colors.buffer]);
}

function attentionMap(requestId: number, layer: number, head: number | null, queryPatch: number): void {
  if (!lastAttentions) throw new Error('Run an inspection before requesting an attention map.');
  if (layer < 0 || layer >= 12 || queryPatch < 0 || queryPatch >= GRID_SIZE * GRID_SIZE) throw new Error('The requested attention location is out of range.');
  const values = new Float32Array(GRID_SIZE * GRID_SIZE);
  const queryToken = queryPatch + 1;
  const layerStride = 6 * TOKEN_COUNT * TOKEN_COUNT;
  const headStride = TOKEN_COUNT * TOKEN_COUNT;
  for (let keyPatch = 0; keyPatch < values.length; keyPatch += 1) {
    const keyToken = keyPatch + 1;
    if (head === null) {
      let total = 0;
      for (let headIndex = 0; headIndex < 6; headIndex += 1) total += lastAttentions[layer * layerStride + headIndex * headStride + queryToken * TOKEN_COUNT + keyToken];
      values[keyPatch] = total / 6;
    } else {
      values[keyPatch] = lastAttentions[layer * layerStride + head * headStride + queryToken * TOKEN_COUNT + keyToken];
    }
  }
  const normalized = normalizeMap(values);
  respond({ type: 'attention-map-result', requestId, values: normalized }, [normalized.buffer]);
}

workerScope.addEventListener('message', (event: MessageEvent<ExplainWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'dispose') {
    lastAttentions = null;
    void session?.release();
    session = null;
    workerScope.close();
    return;
  }
  if (request.type === 'attention-map') {
    try {
      attentionMap(request.requestId, request.layer, request.head, request.queryPatch);
    } catch (error) {
      respond({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : 'The attention map failed.' });
    }
    return;
  }
  void inspect(request.pixels, request.width, request.height, request.preferredBackend).catch((error: unknown) => {
    respond({ type: 'error', message: error instanceof Error ? error.message : 'The explainability model failed.' });
  });
});
