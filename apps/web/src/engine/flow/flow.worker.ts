/// <reference lib="webworker" />
import cvModule from '@techstark/opencv-js';
import type { FlowWorkerRequest, FlowWorkerResponse } from './messages';

type OpenCvRuntime = typeof import('@techstark/opencv-js');

let runtimePromise: Promise<OpenCvRuntime> | null = null;

function getRuntime(): Promise<OpenCvRuntime> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const candidate = cvModule as unknown as OpenCvRuntime | Promise<OpenCvRuntime>;
    const cv = await Promise.resolve(candidate);
    if (cv.Mat) return cv;
    await new Promise<void>((resolve) => {
      (cv as OpenCvRuntime & { onRuntimeInitialized?: () => void }).onRuntimeInitialized = resolve;
    });
    return cv;
  })();
  return runtimePromise;
}

function sample(image: Uint8Array, width: number, height: number, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = image[y0 * width + x0] * (1 - tx) + image[y0 * width + x1] * tx;
  const bottom = image[y1 * width + x0] * (1 - tx) + image[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

self.addEventListener('message', (event: MessageEvent<FlowWorkerRequest>) => {
  if (event.data.type !== 'compute') return;
  void compute(event.data);
});

async function compute(request: FlowWorkerRequest): Promise<void> {
  const started = performance.now();
  let currentMat: import('@techstark/opencv-js').Mat | null = null;
  let anchorMat: import('@techstark/opencv-js').Mat | null = null;
  let flowMat: import('@techstark/opencv-js').Mat | null = null;
  try {
    const cv = await getRuntime();
    currentMat = cv.matFromArray(request.height, request.width, cv.CV_8UC1, request.current);
    anchorMat = cv.matFromArray(request.height, request.width, cv.CV_8UC1, request.anchor);
    flowMat = new cv.Mat();

    // Current-to-anchor flow gives the source coordinate used for backward depth warping.
    cv.calcOpticalFlowFarneback(currentMat, anchorMat, flowMat, 0.5, 3, 15, 3, 5, 1.2, 0);
    const flow = new Float32Array(flowMat.data32F);
    const confidence = new Float32Array(request.width * request.height);
    let magnitudeSum = 0;
    let lowConfidenceCount = 0;
    for (let index = 0; index < confidence.length; index += 1) {
      const x = index % request.width;
      const y = Math.floor(index / request.width);
      const dx = flow[index * 2];
      const dy = flow[index * 2 + 1];
      const anchorValue = sample(request.anchor, request.width, request.height, x + dx, y + dy);
      const score = anchorValue === null
        ? 0
        : Math.exp(-Math.abs(request.current[index] - anchorValue) / 24);
      confidence[index] = score;
      magnitudeSum += Math.hypot(dx, dy);
      if (score < 0.35) lowConfidenceCount += 1;
    }

    const response: FlowWorkerResponse = {
      type: 'result',
      requestId: request.requestId,
      flow,
      confidence,
      width: request.width,
      height: request.height,
      meanMagnitude: magnitudeSum / confidence.length,
      lowConfidenceFraction: lowConfidenceCount / confidence.length,
      elapsedMs: performance.now() - started,
    };
    self.postMessage(response, { transfer: [flow.buffer, confidence.buffer] });
  } catch (error) {
    const response: FlowWorkerResponse = {
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Optical flow failed.',
    };
    self.postMessage(response);
  } finally {
    currentMat?.delete();
    anchorMat?.delete();
    flowMat?.delete();
  }
}
