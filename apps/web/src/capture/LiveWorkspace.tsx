import { useEffect, useRef, useState } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient, type DepthResult } from '../engine/inference/DepthInferenceClient';
import { FlowClient } from '../engine/flow/FlowClient';
import { KeyframeScheduler, type KeyframeReason } from '../engine/scheduler/KeyframeScheduler';
import { warpDepth } from '../engine/propagation/warpDepth';
import { applyAffine, fitRobustAffine, stabilizeDepth } from '../engine/fusion/depthFusion';
import { DepthEffectRenderer, type EffectOptions, type LiveEffect } from '../effects/DepthEffectRenderer';
import { createConfidenceImageData, createDepthImageData, type DepthPalette } from '../effects/depthColor';
import { CAMERA_HEIGHT, CAMERA_WIDTH, describeCameraError, listVideoInputs, startCamera, stopMediaStream } from './camera';
import { TelemetryStore } from '../telemetry/TelemetryStore';
import { TelemetryPanel } from '../telemetry/TelemetryPanel';

interface LiveWorkspaceProps { preferredBackend: InferenceBackend }

const FLOW_WIDTH = 160;
const FLOW_HEIGHT = 120;

interface LatestDepth {
  depth: Float32Array;
  confidence: Float32Array;
  width: number;
  height: number;
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function toGray(data: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(data.length / 4);
  for (let source = 0, target = 0; source < data.length; source += 4, target += 1) {
    gray[target] = Math.round(data[source] * 0.299 + data[source + 1] * 0.587 + data[source + 2] * 0.114);
  }
  return gray;
}

export function frameDifference(left: Uint8Array | null, right: Uint8Array): number {
  if (!left || left.length !== right.length) return 0;
  let difference = 0;
  for (let index = 0; index < right.length; index += 4) difference += Math.abs(left[index] - right[index]);
  return difference / (Math.ceil(right.length / 4) * 255);
}

export function LiveWorkspace({ preferredBackend }: LiveWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const depthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const flowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inferenceRef = useRef<DepthInferenceClient | null>(null);
  const flowRef = useRef<FlowClient | null>(null);
  const effectRendererRef = useRef<DepthEffectRenderer | null>(null);
  const schedulerRef = useRef(new KeyframeScheduler());
  const anchorRef = useRef<{ result: DepthResult; gray: Uint8Array; needsAlignment: boolean } | null>(null);
  const latestDepthRef = useRef<LatestDepth | null>(null);
  const transitionFrameRef = useRef(4);
  const previousGrayRef = useRef<Uint8Array | null>(null);
  const paletteRef = useRef<DepthPalette>('viridis');
  const manualRefreshRef = useRef(false);
  const activeRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const lastCameraTelemetryRef = useRef(0);
  const latestSignalsRef = useRef({ motion: 0, lowConfidenceFraction: 0, sceneDifference: 0 });
  const effectOptionsRef = useRef<EffectOptions>({ effect: 'depth', focusDepth: 0.55, aperture: 0.7, fogDensity: 0.55, fogColor: [0.55, 0.68, 0.67] });
  const telemetryStoreRef = useRef(new TelemetryStore());
  const frameIdRef = useRef(0);
  const latestInferenceMsRef = useRef(0);
  const intervalRef = useRef(5);

  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState('Start the camera when you are ready. Permission is requested only after you click.');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [interval, setIntervalValue] = useState(5);
  const [palette, setPalette] = useState<DepthPalette>('viridis');
  const [hasDepth, setHasDepth] = useState(false);
  const [effect, setEffect] = useState<LiveEffect>('depth');
  const [focusDepth, setFocusDepth] = useState(0.55);
  const [aperture, setAperture] = useState(0.7);
  const [fogDensity, setFogDensity] = useState(0.55);
  const [fogColor, setFogColor] = useState('#8badaa');
  const [telemetrySnapshot, setTelemetrySnapshot] = useState(() => telemetryStoreRef.current.snapshot());

  useEffect(() => {
    inferenceRef.current = new DepthInferenceClient();
    flowRef.current = new FlowClient();
    try {
      if (effectCanvasRef.current) effectRendererRef.current = new DepthEffectRenderer(effectCanvasRef.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Live effects could not be initialized.');
    }
    return () => {
      activeRef.current = false;
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      stopMediaStream(streamRef.current);
      inferenceRef.current?.dispose();
      flowRef.current?.dispose();
      effectRendererRef.current?.dispose();
    };
  }, []);

  useEffect(() => { paletteRef.current = palette; }, [palette]);
  useEffect(() => {
    effectOptionsRef.current = { effect, focusDepth, aperture, fogDensity, fogColor: hexToRgb(fogColor) };
  }, [aperture, effect, focusDepth, fogColor, fogDensity]);

  async function beginCamera(selectedDeviceId = deviceId): Promise<void> {
    setStatus('starting');
    setMessage('Requesting camera access…');
    activeRef.current = false;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    try {
      const stream = await startCamera(selectedDeviceId || undefined);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('The video preview is not available.');
      video.srcObject = stream;
      await video.play();
      const inputs = await listVideoInputs();
      setDevices(inputs);
      const activeDevice = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeDevice) setDeviceId(activeDevice);
      activeRef.current = true;
      setStatus('running');
      setMessage('Live camera is running. The first depth keyframe is being prepared.');
      scheduleFrame();
    } catch (error) {
      setStatus('error');
      setMessage(describeCameraError(error));
    }
  }

  function stopCamera(): void {
    activeRef.current = false;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
    setMessage('Camera stopped. The last depth frame remains visible.');
  }

  function scheduleFrame(): void {
    animationRef.current = requestAnimationFrame(processFrame);
  }

  function processFrame(timestamp: number): void {
    if (!activeRef.current) return;
    const video = videoRef.current;
    const flowCanvas = flowCanvasRef.current;
    if (video?.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA && flowCanvas) {
      const context = flowCanvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        frameIdRef.current += 1;
        telemetryStoreRef.current.recordCameraFrame(timestamp);
        context.drawImage(video, 0, 0, FLOW_WIDTH, FLOW_HEIGHT);
        const gray = toGray(context.getImageData(0, 0, FLOW_WIDTH, FLOW_HEIGHT).data);
        const sceneDifference = frameDifference(previousGrayRef.current, gray);
        previousGrayRef.current = gray.slice();
        const signals = { ...latestSignalsRef.current, sceneDifference };
        const reason = schedulerRef.current.beginFrame(signals, manualRefreshRef.current);
        manualRefreshRef.current = false;
        if (reason) void runKeyframe(video, gray.slice(), reason);
        if (anchorRef.current && flowRef.current && !flowRef.current.busy) {
          void runFlow(gray.slice(), timestamp);
        }
        const latest = latestDepthRef.current;
        if (latest && effectOptionsRef.current.effect !== 'depth' && effectOptionsRef.current.effect !== 'confidence') {
          effectRendererRef.current?.render(video, latest.depth, latest.width, latest.height, effectOptionsRef.current);
        }
        if (timestamp - lastCameraTelemetryRef.current >= 500) {
          lastCameraTelemetryRef.current = timestamp;
          telemetryStoreRef.current.recordSchedulerState(intervalRef.current, schedulerRef.current.age, latestSignalsRef.current.motion, latestSignalsRef.current.lowConfidenceFraction);
          telemetryStoreRef.current.recordBackendInfo(preferredBackend, 'base');
          setTelemetrySnapshot(telemetryStoreRef.current.snapshot());
        }
      }
    }
    scheduleFrame();
  }

  async function runKeyframe(video: HTMLVideoElement, gray: Uint8Array, reason: KeyframeReason): Promise<void> {
    const canvas = captureCanvasRef.current;
    const client = inferenceRef.current;
    const requestFrameId = frameIdRef.current;
    if (!canvas || !client) { schedulerRef.current.fail(); return; }
    const width = video.videoWidth || CAMERA_WIDTH;
    const height = video.videoHeight || CAMERA_HEIGHT;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { schedulerRef.current.fail(); return; }
    context.drawImage(video, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    setMessage(`Depth refresh (${reason}) is running in the background…`);
    try {
      const result = await client.estimate(pixels, width, height, preferredBackend, setMessage);
      latestInferenceMsRef.current = result.inferenceMs;
      anchorRef.current = { result, gray, needsAlignment: latestDepthRef.current !== null };
      transitionFrameRef.current = 0;
      schedulerRef.current.complete();
      telemetryStoreRef.current.recordKeyframe({ timestamp: performance.now(), frameId: requestFrameId, reason, inferenceMs: result.inferenceMs });
      setMessage('Live depth is tracking the camera between model refreshes.');
    } catch (error) {
      schedulerRef.current.fail();
      setMessage(error instanceof Error ? error.message : 'Depth inference failed.');
    }
  }

  async function runFlow(gray: Uint8Array, timestamp: number): Promise<void> {
    const anchor = anchorRef.current;
    const client = flowRef.current;
    if (!anchor || !client) return;
    try {
      const flow = await client.compute(gray, anchor.gray.slice(), FLOW_WIDTH, FLOW_HEIGHT);
      const warpStarted = performance.now();
      const warped = warpDepth(anchor.result.depth, anchor.result.width, anchor.result.height, flow.flow, flow.confidence, flow.width, flow.height);
      const warpMs = performance.now() - warpStarted;
      const fusionStarted = performance.now();
      let candidateDepth = warped.depth;
      const previous = latestDepthRef.current;
      if (anchor.needsAlignment && previous && previous.depth.length === candidateDepth.length) {
        const fit = fitRobustAffine(candidateDepth, previous.depth, warped.confidence);
        anchor.result.depth = applyAffine(anchor.result.depth, fit);
        candidateDepth = applyAffine(candidateDepth, fit);
        anchor.needsAlignment = false;
      } else if (anchor.needsAlignment) {
        anchor.needsAlignment = false;
      }
      transitionFrameRef.current = Math.min(4, transitionFrameRef.current + 1);
      const stabilized = stabilizeDepth(candidateDepth, previous?.depth ?? null, warped.confidence, transitionFrameRef.current / 4, flow.meanMagnitude);
      const fusionMs = performance.now() - fusionStarted;
      latestDepthRef.current = { depth: stabilized, confidence: warped.confidence, width: anchor.result.width, height: anchor.result.height };
      const canvas = depthCanvasRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context) {
        canvas.width = anchor.result.width;
        canvas.height = anchor.result.height;
        const image = effectOptionsRef.current.effect === 'confidence'
          ? createConfidenceImageData(warped.confidence, canvas.width, canvas.height)
          : createDepthImageData(stabilized, canvas.width, canvas.height, paletteRef.current);
        context.putImageData(image, 0, 0);
        setHasDepth(true);
      }
      latestSignalsRef.current = { ...latestSignalsRef.current, motion: flow.meanMagnitude, lowConfidenceFraction: flow.lowConfidenceFraction };
      telemetryStoreRef.current.recordDepthFrame(timestamp);
      telemetryStoreRef.current.recordRenderFrame(timestamp);
      telemetryStoreRef.current.recordFlicker(stabilized, warped.confidence);
      telemetryStoreRef.current.recordTimings({ flow: flow.elapsedMs, warp: warpMs, fusion: fusionMs, inference: latestInferenceMsRef.current, total: flow.elapsedMs + warpMs + fusionMs }, timestamp);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Optical-flow propagation failed.');
    }
  }

  function saveSnapshot(): void {
    const liveEffect = effectOptionsRef.current.effect;
    const canvas = liveEffect === 'bokeh' || liveEffect === 'fog' ? effectCanvasRef.current : depthCanvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const link = document.createElement('a');
    link.download = `depthguide-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function refocus(event: React.PointerEvent<HTMLCanvasElement>): void {
    const latest = latestDepthRef.current;
    if (!latest) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const centerX = Math.floor(((event.clientX - bounds.left) / bounds.width) * latest.width);
    const centerY = Math.floor(((event.clientY - bounds.top) / bounds.height) * latest.height);
    let sum = 0;
    let samples = 0;
    for (let y = centerY - 2; y <= centerY + 2; y += 1) {
      for (let x = centerX - 2; x <= centerX + 2; x += 1) {
        if (x >= 0 && y >= 0 && x < latest.width && y < latest.height) { sum += latest.depth[y * latest.width + x]; samples += 1; }
      }
    }
    if (samples) setFocusDepth(sum / samples);
  }

  return (
    <div className="live-workspace">
      <div className="live-toolbar">
        <div><small>LIVE CAMERA</small><strong>{status === 'running' ? 'Local stream active' : 'Camera is off'}</strong></div>
        <label>CAMERA<select disabled={status === 'starting'} value={deviceId} onChange={(event) => { setDeviceId(event.target.value); if (status === 'running') void beginCamera(event.target.value); }}><option value="">Default camera</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
        <label>KEYFRAME<select value={interval} onChange={(event) => { const value = Number(event.target.value); setIntervalValue(value); intervalRef.current = value; schedulerRef.current.setInterval(value); }}>{[2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>Every {value} frames</option>)}</select></label>
        <label>VIEW<select value={effect} onChange={(event) => setEffect(event.target.value as LiveEffect)}><option value="depth">Depth</option><option value="confidence">Confidence</option><option value="bokeh">Cinematic bokeh</option><option value="fog">Depth fog</option></select></label>
        <label>PALETTE<select value={palette} onChange={(event) => setPalette(event.target.value as DepthPalette)}><option value="viridis">Viridis</option><option value="turbo">Turbo</option><option value="luma">Greyscale</option></select></label>
        {status === 'running' ? <button className="secondary-button" type="button" onClick={stopCamera}>Stop</button> : <button className="primary-button compact" disabled={status === 'starting'} type="button" onClick={() => void beginCamera()}>Start camera <b>→</b></button>}
      </div>
      {(effect === 'bokeh' || effect === 'fog') && <div className="effect-controls">
        {effect === 'bokeh' ? <><label>FOCUS <input aria-label="Focus depth" max="1" min="0" onChange={(event) => setFocusDepth(Number(event.target.value))} step="0.01" type="range" value={focusDepth} /><output>{focusDepth.toFixed(2)}</output></label><label>APERTURE <input aria-label="Aperture" max="1" min="0.1" onChange={(event) => setAperture(Number(event.target.value))} step="0.05" type="range" value={aperture} /><output>{aperture.toFixed(2)}</output></label><span>Click the effect to refocus</span></> : <><label>DENSITY <input aria-label="Fog density" max="1" min="0" onChange={(event) => setFogDensity(Number(event.target.value))} step="0.05" type="range" value={fogDensity} /><output>{fogDensity.toFixed(2)}</output></label><label>COLOUR <input aria-label="Fog colour" onChange={(event) => setFogColor(event.target.value)} type="color" value={fogColor} /></label></>}
      </div>}
      <div className="live-grid">
        <figure><figcaption><span>01</span> CAMERA</figcaption><video ref={videoRef} autoPlay muted playsInline /></figure>
        <figure><figcaption><span>02</span> {effect === 'depth' ? 'STABLE DEPTH' : effect === 'confidence' ? 'FLOW CONFIDENCE' : effect.toUpperCase()}</figcaption><canvas className={effect === 'depth' || effect === 'confidence' ? 'active-output' : 'hidden-output'} ref={depthCanvasRef} /><canvas aria-label="Live depth effect" className={effect === 'bokeh' || effect === 'fog' ? 'active-output effect-output' : 'hidden-output'} onPointerDown={refocus} ref={effectCanvasRef} />{!hasDepth && <div className={status === 'running' ? 'live-placeholder running' : 'live-placeholder'}><span>{status === 'running' ? 'DEPTH INITIALIZING' : 'CAMERA WAITING'}</span></div>}</figure>
      </div>
      <div className="live-footer">
        <div className={`result-status ${status === 'error' ? 'error' : status === 'running' ? 'ready' : ''}`}><i />{message}</div>
        <div className="live-actions"><button className="secondary-button" disabled={status !== 'running'} onClick={() => { manualRefreshRef.current = true; }} type="button">Refresh depth</button><button className="secondary-button" onClick={saveSnapshot} type="button">Save depth PNG</button></div>
      </div>
      <TelemetryPanel snapshot={telemetrySnapshot} />
      <canvas ref={captureCanvasRef} className="sr-only" /><canvas ref={flowCanvasRef} width={FLOW_WIDTH} height={FLOW_HEIGHT} className="sr-only" />
    </div>
  );
}
