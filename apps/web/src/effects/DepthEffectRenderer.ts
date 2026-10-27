export type LiveEffect = 'depth' | 'confidence' | 'bokeh' | 'fog';

export interface EffectOptions {
  effect: LiveEffect;
  focusDepth: number;
  aperture: number;
  fogDensity: number;
  fogColor: readonly [number, number, number];
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = vec2(position.x, 1.0 - position.y);
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uRgb;
uniform sampler2D uDepth;
uniform int uMode;
uniform float uFocus;
uniform float uAperture;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform vec2 uTexel;

vec2 disc(int index) {
  const vec2 samples[12] = vec2[12](
    vec2(1.0, 0.0), vec2(0.866, 0.5), vec2(0.5, 0.866), vec2(0.0, 1.0),
    vec2(-0.5, 0.866), vec2(-0.866, 0.5), vec2(-1.0, 0.0), vec2(-0.866, -0.5),
    vec2(-0.5, -0.866), vec2(0.0, -1.0), vec2(0.5, -0.866), vec2(0.866, -0.5)
  );
  return samples[index];
}

void main() {
  float depth = texture(uDepth, vUv).r;
  vec3 original = texture(uRgb, vUv).rgb;
  if (uMode == 2) {
    float distance = 1.0 - depth;
    float fog = 1.0 - exp(-uFogDensity * distance * 3.2);
    outColor = vec4(mix(original, uFogColor, clamp(fog, 0.0, 0.92)), 1.0);
    return;
  }
  float blurPixels = min(18.0, abs(depth - uFocus) * uAperture * 18.0);
  if (blurPixels < 0.6) { outColor = vec4(original, 1.0); return; }
  vec3 sum = original;
  float weights = 1.0;
  for (int index = 0; index < 12; index++) {
    vec2 uv = clamp(vUv + disc(index) * uTexel * blurPixels, vec2(0.0), vec2(1.0));
    float sampleDepth = texture(uDepth, uv).r;
    float depthWeight = exp(-abs(sampleDepth - depth) * 18.0);
    vec3 sampleColor = texture(uRgb, uv).rgb;
    sum += sampleColor * depthWeight;
    weights += depthWeight;
  }
  outColor = vec4(sum / weights, 1.0);
}`;

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create an effect shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Effect shader compilation failed.');
  return shader;
}

export class DepthEffectRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly rgbTexture: WebGLTexture;
  private readonly depthTexture: WebGLTexture;
  private depthBytes = new Uint8Array();
  private currentFocus = 0.5;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 is required for live depth effects.');
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create the effects program.');
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Effects program linking failed.');
    this.program = program;
    this.rgbTexture = this.createTexture(0);
    this.depthTexture = this.createTexture(1);
  }

  render(source: HTMLVideoElement, depth: Float32Array, depthWidth: number, depthHeight: number, options: EffectOptions): void {
    if (!source.videoWidth || !source.videoHeight) return;
    const gl = this.gl;
    if (this.canvas.width !== source.videoWidth || this.canvas.height !== source.videoHeight) {
      this.canvas.width = source.videoWidth;
      this.canvas.height = source.videoHeight;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rgbTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (this.depthBytes.length !== depth.length) this.depthBytes = new Uint8Array(depth.length);
    for (let index = 0; index < depth.length; index += 1) this.depthBytes[index] = Math.round(Math.min(1, Math.max(0, depth[index])) * 255);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, depthWidth, depthHeight, 0, gl.RED, gl.UNSIGNED_BYTE, this.depthBytes);
    this.currentFocus += (options.focusDepth - this.currentFocus) * 0.12;
    gl.uniform1i(gl.getUniformLocation(this.program, 'uRgb'), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uDepth'), 1);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uMode'), options.effect === 'fog' ? 2 : 1);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uFocus'), this.currentFocus);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uAperture'), options.aperture);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uFogDensity'), options.fogDensity);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uFogColor'), ...options.fogColor);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uTexel'), 1 / this.canvas.width, 1 / this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.gl.deleteTexture(this.rgbTexture);
    this.gl.deleteTexture(this.depthTexture);
    this.gl.deleteProgram(this.program);
  }

  private createTexture(unit: number): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) throw new Error('Could not create an effect texture.');
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    return texture;
  }
}
