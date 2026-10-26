export type AppMode = 'Live' | 'Photo' | 'Inspect' | 'Compare' | 'Benchmark' | 'About';

export type CapabilityState = 'checking' | 'available' | 'limited' | 'unavailable';

export interface Capability {
  label: string;
  detail: string;
  state: CapabilityState;
}

export interface CapabilityReport {
  webgpu: Capability;
  wasm: Capability;
  camera: Capability;
  isolation: Capability;
}

export type FeasibilityStatus = 'idle' | 'loading' | 'running' | 'passed' | 'failed';

export interface FeasibilityResult {
  status: FeasibilityStatus;
  message: string;
  backend?: 'webgpu' | 'wasm';
  loadMs?: number;
  inferenceMs?: number;
  outputShape?: readonly number[];
}

