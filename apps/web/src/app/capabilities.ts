import type { CapabilityReport } from './types';
import type { InferenceBackend } from '../engine/inference/messages';

interface NavigatorWithGpu extends Navigator {
  gpu?: {
    requestAdapter: () => Promise<unknown | null>;
  };
}

export async function detectCapabilities(): Promise<CapabilityReport> {
  const browserNavigator = navigator as NavigatorWithGpu;
  const webGpuDeclared = Boolean(browserNavigator.gpu);
  let hasWebGpuAdapter = false;

  if (browserNavigator.gpu) {
    try {
      hasWebGpuAdapter = Boolean(await browserNavigator.gpu.requestAdapter());
    } catch {
      hasWebGpuAdapter = false;
    }
  }

  const hasCameraApi = Boolean(navigator.mediaDevices?.getUserMedia);
  const hasWasm = typeof WebAssembly === 'object';
  const isIsolated = window.crossOriginIsolated;

  return {
    webgpu: {
      label: 'WebGPU',
      state: hasWebGpuAdapter ? 'available' : 'unavailable',
      detail: hasWebGpuAdapter
        ? 'GPU acceleration is ready.'
        : webGpuDeclared
          ? 'The API exists, but no compatible adapter was returned.'
          : 'Unavailable; DepthGuide will use the CPU fallback.',
    },
    wasm: {
      label: 'WebAssembly',
      state: hasWasm ? 'available' : 'unavailable',
      detail: hasWasm ? 'CPU inference fallback is ready.' : 'This browser cannot run the fallback.',
    },
    camera: {
      label: 'Camera API',
      state: hasCameraApi ? 'available' : 'unavailable',
      detail: hasCameraApi
        ? 'Camera access can be requested in Live mode.'
        : 'Live capture is unavailable; Photo mode will still work.',
    },
    isolation: {
      label: 'Worker isolation',
      state: isIsolated ? 'available' : 'limited',
      detail: isIsolated
        ? 'Multi-threaded browser processing is available.'
        : 'Single-threaded fallback will be used until isolation headers are configured.',
    },
  };
}

export function choosePreferredBackend(report: CapabilityReport): InferenceBackend {
  return report.webgpu.state === 'available' ? 'webgpu' : 'wasm';
}
