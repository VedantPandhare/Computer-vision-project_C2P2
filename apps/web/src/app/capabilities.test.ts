import { describe, expect, it } from 'vitest';
import { choosePreferredBackend } from './capabilities';
import type { CapabilityReport, CapabilityState } from './types';

function reportWithWebGpu(state: CapabilityState): CapabilityReport {
  return {
    webgpu: { label: 'WebGPU', state, detail: '' },
    wasm: { label: 'WebAssembly', state: 'available', detail: '' },
    camera: { label: 'Camera API', state: 'available', detail: '' },
    isolation: { label: 'Worker isolation', state: 'limited', detail: '' },
  };
}

describe('choosePreferredBackend', () => {
  it('uses WebGPU only after an adapter has been confirmed', () => {
    expect(choosePreferredBackend(reportWithWebGpu('available'))).toBe('webgpu');
  });

  it.each(['checking', 'limited', 'unavailable'] as const)(
    'uses the portable WASM fallback when WebGPU is %s',
    (state) => {
      expect(choosePreferredBackend(reportWithWebGpu(state))).toBe('wasm');
    },
  );
});
