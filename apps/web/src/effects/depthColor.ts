export type DepthPalette = 'luma' | 'viridis' | 'turbo';

type Rgb = readonly [number, number, number];

const VIRIDIS_STOPS: readonly Rgb[] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

const TURBO_STOPS: readonly Rgb[] = [
  [48, 18, 59],
  [50, 93, 177],
  [31, 184, 164],
  [173, 232, 50],
  [250, 142, 9],
  [180, 4, 38],
];

function interpolate(stops: readonly Rgb[], value: number): Rgb {
  const position = Math.min(1, Math.max(0, value)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const amount = position - index;
  const from = stops[index];
  const to = stops[index + 1];
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

export function depthToRgb(value: number, palette: DepthPalette): Rgb {
  const clamped = Math.min(1, Math.max(0, value));
  if (palette === 'luma') {
    const channel = Math.round(clamped * 255);
    return [channel, channel, channel];
  }
  return interpolate(palette === 'viridis' ? VIRIDIS_STOPS : TURBO_STOPS, clamped);
}

export function createDepthImageData(
  depth: Float32Array,
  width: number,
  height: number,
  palette: DepthPalette,
): ImageData {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < depth.length; index += 1) {
    const [red, green, blue] = depthToRgb(depth[index], palette);
    const pixelIndex = index * 4;
    pixels[pixelIndex] = red;
    pixels[pixelIndex + 1] = green;
    pixels[pixelIndex + 2] = blue;
    pixels[pixelIndex + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}

export function createConfidenceImageData(confidence: Float32Array, width: number, height: number): ImageData {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < confidence.length; index += 1) {
    const value = Math.min(1, Math.max(0, confidence[index]));
    const pixelIndex = index * 4;
    pixels[pixelIndex] = Math.round((1 - value) * 232);
    pixels[pixelIndex + 1] = Math.round(value * 232);
    pixels[pixelIndex + 2] = 82;
    pixels[pixelIndex + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}
