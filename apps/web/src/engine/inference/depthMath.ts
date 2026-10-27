export interface Size {
  width: number;
  height: number;
}

export function calculateModelSize(
  sourceWidth: number,
  sourceHeight: number,
  targetSize = 518,
  multiple = 14,
): Size {
  const scale = Math.max(targetSize / sourceWidth, targetSize / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;

  return {
    width: Math.max(multiple, Math.round(scaledWidth / multiple) * multiple),
    height: Math.max(multiple, Math.round(scaledHeight / multiple) * multiple),
  };
}

function percentile(sorted: Float32Array, fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

export class RunningDepthNormalizer {
  private low: number | null = null;
  private high: number | null = null;

  constructor(private readonly smoothing = 0.18) {}

  normalize(values: Float32Array, lowPercentile = 0.02, highPercentile = 0.98): Float32Array {
    if (values.length === 0) return new Float32Array();
    const finite = Float32Array.from(values.filter(Number.isFinite));
    if (finite.length === 0) return new Float32Array(values.length);
    finite.sort();
    const measuredLow = percentile(finite, lowPercentile);
    const measuredHigh = percentile(finite, highPercentile);
    this.low = this.low === null ? measuredLow : this.low * (1 - this.smoothing) + measuredLow * this.smoothing;
    this.high = this.high === null ? measuredHigh : this.high * (1 - this.smoothing) + measuredHigh * this.smoothing;
    const range = this.high - this.low;
    if (range <= Number.EPSILON) return new Float32Array(values.length);
    const low = this.low;
    return Float32Array.from(values, (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, (value - low) / range)) : 0);
  }
}

export function normalizeDepth(
  values: Float32Array,
  lowPercentile = 0.02,
  highPercentile = 0.98,
): Float32Array {
  if (values.length === 0) return new Float32Array();

  const finite = Float32Array.from(values.filter(Number.isFinite));
  if (finite.length === 0) return new Float32Array(values.length);

  finite.sort();
  const low = percentile(finite, lowPercentile);
  const high = percentile(finite, highPercentile);
  const range = high - low;

  if (range <= Number.EPSILON) return new Float32Array(values.length);

  return Float32Array.from(values, (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, (value - low) / range));
  });
}
