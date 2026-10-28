import { createProgram } from './glUtils';

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aColor;
out vec3 vColor;
uniform float uYaw;
uniform float uPitch;
uniform float uAspect;
uniform float uPointSize;
void main() {
  float cy = cos(uYaw); float sy = sin(uYaw);
  float cp = cos(uPitch); float sp = sin(uPitch);
  vec3 yRotated = vec3(cy * aPosition.x + sy * aPosition.z, aPosition.y, -sy * aPosition.x + cy * aPosition.z);
  vec3 rotated = vec3(yRotated.x, cp * yRotated.y - sp * yRotated.z, sp * yRotated.y + cp * yRotated.z);
  rotated.z -= 4.0;
  float w = max(0.2, -rotated.z);
  gl_Position = vec4(rotated.x / uAspect, rotated.y, w - 0.2, w);
  gl_PointSize = uPointSize * (4.0 / w);
  vColor = aColor;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  if (dot(point, point) > 1.0) discard;
  outColor = vec4(vColor, 1.0);
}`;

export interface PointCloudData {
  positions: Float32Array;
  colors: Uint8Array;
  count: number;
}

export function buildPointCloud(depth: Float32Array, width: number, height: number, rgba: Uint8ClampedArray, stride: number, fovDegrees: number): PointCloudData {
  const safeStride = Math.max(1, Math.round(stride));
  const pointsAcross = Math.ceil(width / safeStride);
  const pointsDown = Math.ceil(height / safeStride);
  const positions = new Float32Array(pointsAcross * pointsDown * 3);
  const colors = new Uint8Array(pointsAcross * pointsDown * 3);
  const focalScale = Math.tan(fovDegrees * Math.PI / 360);
  const aspect = width / height;
  let target = 0;
  for (let y = 0; y < height; y += safeStride) {
    for (let x = 0; x < width; x += safeStride) {
      const index = y * width + x;
      const z = 0.55 + (1 - depth[index]) * 1.45;
      positions[target * 3] = ((x / (width - 1)) * 2 - 1) * z * focalScale * aspect;
      positions[target * 3 + 1] = (1 - (y / (height - 1)) * 2) * z * focalScale;
      positions[target * 3 + 2] = 1.3 - z;
      colors[target * 3] = rgba[index * 4];
      colors[target * 3 + 1] = rgba[index * 4 + 1];
      colors[target * 3 + 2] = rgba[index * 4 + 2];
      target += 1;
    }
  }
  return { positions: positions.slice(0, target * 3), colors: colors.slice(0, target * 3), count: target };
}

export function pointCloudToPly(data: PointCloudData): string {
  const lines = ['ply', 'format ascii 1.0', `element vertex ${data.count}`, 'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', 'end_header'];
  for (let index = 0; index < data.count; index += 1) {
    lines.push(`${data.positions[index * 3].toFixed(6)} ${data.positions[index * 3 + 1].toFixed(6)} ${data.positions[index * 3 + 2].toFixed(6)} ${data.colors[index * 3]} ${data.colors[index * 3 + 1]} ${data.colors[index * 3 + 2]}`);
  }
  return lines.join('\n');
}

export class PointCloudRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly positionBuffer: WebGLBuffer;
  private readonly colorBuffer: WebGLBuffer;
  private count = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is required for the point cloud.');
    this.gl = gl;
    this.program = createProgram(gl, VERTEX, FRAGMENT);
    const positionBuffer = gl.createBuffer();
    const colorBuffer = gl.createBuffer();
    if (!positionBuffer || !colorBuffer) throw new Error('Could not create point-cloud buffers.');
    this.positionBuffer = positionBuffer;
    this.colorBuffer = colorBuffer;
    gl.enable(gl.DEPTH_TEST);
  }

  setData(data: PointCloudData, width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.count = data.count;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
  }

  render(yaw: number, pitch: number, pointSize: number): void {
    if (!this.count) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.02, 0.05, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uYaw'), yaw);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uPitch'), pitch);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uAspect'), this.canvas.width / this.canvas.height);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uPointSize'), pointSize);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.positionBuffer);
    this.gl.deleteBuffer(this.colorBuffer);
    this.gl.deleteProgram(this.program);
  }
}
