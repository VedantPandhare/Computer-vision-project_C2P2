import { createLinearTexture, createProgram } from './glUtils';

const VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = vec2(position.x, 1.0 - position.y);
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uOrbit;
uniform float uStrength;
void main() {
  float depth = texture(uDepth, vUv).r;
  vec2 displacement = uOrbit * (depth - 0.5) * uStrength;
  vec2 sampleUv = clamp(vUv + displacement, vec2(0.003), vec2(0.997));
  vec3 color = texture(uImage, sampleUv).rgb;
  float edge = smoothstep(0.0, 0.04, sampleUv.x) * smoothstep(0.0, 0.04, sampleUv.y) * smoothstep(0.0, 0.04, 1.0 - sampleUv.x) * smoothstep(0.0, 0.04, 1.0 - sampleUv.y);
  outColor = vec4(color * mix(0.8, 1.0, edge), 1.0);
}`;

export class ParallaxRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly imageTexture: WebGLTexture;
  private readonly depthTexture: WebGLTexture;
  private depthBytes = new Uint8Array();
  private ready = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) throw new Error('WebGL2 is required for parallax.');
    this.gl = gl;
    this.program = createProgram(gl, VERTEX, FRAGMENT);
    this.imageTexture = createLinearTexture(gl, 0);
    this.depthTexture = createLinearTexture(gl, 1);
  }

  setScene(source: TexImageSource, sourceWidth: number, sourceHeight: number, depth: Float32Array, depthWidth: number, depthHeight: number): void {
    const gl = this.gl;
    this.canvas.width = sourceWidth;
    this.canvas.height = sourceHeight;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (this.depthBytes.length !== depth.length) this.depthBytes = new Uint8Array(depth.length);
    for (let index = 0; index < depth.length; index += 1) this.depthBytes[index] = Math.round(Math.min(1, Math.max(0, depth[index])) * 255);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, depthWidth, depthHeight, 0, gl.RED, gl.UNSIGNED_BYTE, this.depthBytes);
    this.ready = true;
  }

  render(orbitX: number, orbitY: number, strength: number): void {
    if (!this.ready) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uImage'), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uDepth'), 1);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uOrbit'), orbitX, orbitY);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uStrength'), strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.gl.deleteTexture(this.imageTexture);
    this.gl.deleteTexture(this.depthTexture);
    this.gl.deleteProgram(this.program);
  }
}
