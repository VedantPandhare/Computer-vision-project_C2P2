export interface DepthFramePacket {
  frameId: number;
  timestamp: number;
  rgb: CanvasImageSource;
  depth: Float32Array;
  confidence: Float32Array;
  width: number;
  height: number;
  telemetry: Readonly<Record<string, number | string>>;
}

export interface DepthPluginOutput {
  overlay?: ImageBitmap | OffscreenCanvas;
  events?: readonly { type: string; message: string; severity: 'info' | 'warning' }[];
}

export interface DepthPlugin {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly experimental?: boolean;
  process(packet: DepthFramePacket): DepthPluginOutput | Promise<DepthPluginOutput>;
  dispose?(): void;
}

export class DepthPluginRegistry {
  private readonly plugins = new Map<string, DepthPlugin>();

  register(plugin: DepthPlugin): void {
    if (this.plugins.has(plugin.id)) throw new Error(`A depth plug-in with id "${plugin.id}" is already registered.`);
    this.plugins.set(plugin.id, plugin);
  }

  unregister(id: string): void {
    this.plugins.get(id)?.dispose?.();
    this.plugins.delete(id);
  }

  get(id: string): DepthPlugin | undefined { return this.plugins.get(id); }
  list(): readonly DepthPlugin[] { return [...this.plugins.values()]; }
}
