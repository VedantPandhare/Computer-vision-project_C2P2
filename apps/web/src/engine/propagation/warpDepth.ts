export interface WarpedDepth {
  depth: Float32Array;
  confidence: Float32Array;
}

function bilinear(values: Float32Array, width: number, height: number, x: number, y: number): number {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const top = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx;
  const bottom = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

export function warpDepth(
  anchorDepth: Float32Array,
  depthWidth: number,
  depthHeight: number,
  flow: Float32Array,
  flowConfidence: Float32Array,
  flowWidth: number,
  flowHeight: number,
): WarpedDepth {
  const depth = new Float32Array(depthWidth * depthHeight);
  const confidence = new Float32Array(depth.length);
  for (let index = 0; index < depth.length; index += 1) {
    const x = index % depthWidth;
    const y = Math.floor(index / depthWidth);
    const flowX = Math.min(flowWidth - 1, Math.floor((x / depthWidth) * flowWidth));
    const flowY = Math.min(flowHeight - 1, Math.floor((y / depthHeight) * flowHeight));
    const flowIndex = flowY * flowWidth + flowX;
    const sourceX = x + flow[flowIndex * 2] * depthWidth / flowWidth;
    const sourceY = y + flow[flowIndex * 2 + 1] * depthHeight / flowHeight;
    const outside = sourceX < 0 || sourceY < 0 || sourceX > depthWidth - 1 || sourceY > depthHeight - 1;
    depth[index] = bilinear(anchorDepth, depthWidth, depthHeight, sourceX, sourceY);
    confidence[index] = outside ? 0 : flowConfidence[flowIndex];
  }
  return { depth, confidence };
}
