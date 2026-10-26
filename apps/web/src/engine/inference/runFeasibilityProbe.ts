import type { FeasibilityResult } from '../../app/types';
import type { InferenceBackend, InferenceWorkerResponse } from './messages';

export function runFeasibilityProbe(
  preferredBackend: InferenceBackend,
  onProgress: (message: string) => void,
): Promise<FeasibilityResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });

    worker.addEventListener('message', (event: MessageEvent<InferenceWorkerResponse>) => {
      const response = event.data;

      if (response.type === 'progress') {
        onProgress(response.message);
        return;
      }

      if (response.type === 'error') {
        resolve({ status: 'failed', message: response.message });
        worker.terminate();
        return;
      }

      resolve({
        status: 'passed',
        message: 'The browser loaded the complete model and produced a depth tensor.',
        backend: response.backend,
        loadMs: response.loadMs,
        inferenceMs: response.inferenceMs,
        outputShape: response.outputShape,
      });
      worker.terminate();
    });

    worker.addEventListener('error', (event) => {
      resolve({ status: 'failed', message: event.message || 'The inference worker crashed.' });
      worker.terminate();
    });

    worker.postMessage({ type: 'probe', preferredBackend });
  });
}

