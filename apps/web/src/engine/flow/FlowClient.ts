import type { FlowResult, FlowWorkerResponse } from './messages';

interface PendingFlow {
  resolve: (result: FlowResult) => void;
  reject: (error: Error) => void;
}

export class FlowClient {
  private readonly worker = new Worker(new URL('./flow.worker.ts', import.meta.url), { type: 'module' });
  private pending: PendingFlow | null = null;
  private requestId = 0;

  constructor() {
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  compute(current: Uint8Array, anchor: Uint8Array, width: number, height: number): Promise<FlowResult> {
    if (this.pending) return Promise.reject(new Error('Optical flow is already running.'));
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage({ type: 'compute', requestId, current, anchor, width, height }, [current.buffer, anchor.buffer]);
    });
  }

  get busy(): boolean { return this.pending !== null; }

  dispose(): void {
    this.pending?.reject(new Error('The optical-flow worker was disposed.'));
    this.pending = null;
    this.worker.terminate();
  }

  private handleMessage = (event: MessageEvent<FlowWorkerResponse>): void => {
    if (!this.pending) return;
    if (event.data.type === 'error') this.pending.reject(new Error(event.data.message));
    else this.pending.resolve(event.data);
    this.pending = null;
  };

  private handleError = (event: ErrorEvent): void => {
    this.pending?.reject(new Error(event.message || 'The optical-flow worker crashed.'));
    this.pending = null;
  };
}
