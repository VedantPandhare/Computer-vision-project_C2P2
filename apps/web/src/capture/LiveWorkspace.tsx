import { useEffect, useRef, useState } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient, type DepthResult } from '../engine/inference/DepthInferenceClient';
import { FlowClient } from '../engine/flow/FlowClient';
import { KeyframeScheduler, type KeyframeReason } from '../engine/scheduler/KeyframeScheduler';
import { warpDepth } from '../engine/propagation/warpDepth';
import { createDepthImageData, type DepthPalette } from '../effects/depthColor';
import { CAMERA_HEIGHT, CAMERA_WIDTH, describeCameraError, listVideoInputs, startCamera, stopMediaStream } from './camera';

interface LiveWorkspaceProps { preferredBackend: InferenceBackend }

interface Telemetry {
  cameraFps: number;
  depthFps: number;
  inferenceMs: number;
  flowMs: number;
  motion: number;
  lowConfidence: number;
  calls: number;
  reason: KeyframeReason | null;
}

const FLOW_WIDTH = 160;
const FLOW_HEIGHT = 120;

function formatMs(value: number): string {
  return value ? `${Math.round(value)} ms` : '—';
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
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const flowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inferenceRef = useRef<DepthInferenceClient | null>(null);
  const flowRef = useRef<FlowClient | null>(null);
  const schedulerRef = useRef(new KeyframeScheduler());
  const anchorRef = useRef<{ result: DepthResult; gray: Uint8Array } | null>(null);
  const previousGrayRef = useRef<Uint8Array | null>(null);
  const paletteRef = useRef<DepthPalette>('viridis');
  const manualRefreshRef = useRef(false);
  const activeRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const cameraFramesRef = useRef<number[]>([]);
  const depthFramesRef = useRef<number[]>([]);
  const latestSignalsRef = useRef({ motion: 0, lowConfidenceFraction: 0, sceneDifference: 0 });

  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState('Start the camera when you are ready. Permission is requested only after you click.');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [interval, setIntervalValue] = useState(5);
  const [palette, setPalette] = useState<DepthPalette>('viridis');
  const [hasDepth, setHasDepth] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>({ cameraFps: 0, depthFps: 0, inferenceMs: 0, flowMs: 0, motion: 0, lowConfidence: 0, calls: 0, reason: null });

  useEffect(() => {
    inferenceRef.current = new DepthInferenceClient();
    flowRef.current = new FlowClient();
    return () => {
      activeRef.current = false;
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      stopMediaStream(streamRef.current);
      inferenceRef.current?.dispose();
      flowRef.current?.dispose();
    };
  }, []);

  useEffect(() => { paletteRef.current = palette; }, [palette]);

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
        context.drawImage(video, 0, 0, FLOW_WIDTH, FLOW_HEIGHT);
        const gray = toGray(context.getImageData(0, 0, FLOW_WIDTH, FLOW_HEIGHT).data);
        const sceneDifference = frameDifference(previousGrayRef.current, gray);
        previousGrayRef.current = gray.slice();
        cameraFramesRef.current.push(timestamp);
        cameraFramesRef.current = cameraFramesRef.current.filter((time) => timestamp - time <= 1000);
        const signals = { ...latestSignalsRef.current, sceneDifference };
        const reason = schedulerRef.current.beginFrame(signals, manualRefreshRef.current);
        manualRefreshRef.current = false;
        if (reason) void runKeyframe(video, gray.slice(), reason);
        if (anchorRef.current && flowRef.current && !flowRef.current.busy) {
          void runFlow(gray.slice(), timestamp);
        }
        setTelemetry((current) => ({ ...current, cameraFps: cameraFramesRef.current.length }));
      }
    }
    scheduleFrame();
  }

  async function runKeyframe(video: HTMLVideoElement, gray: Uint8Array, reason: KeyframeReason): Promise<void> {
    const canvas = captureCanvasRef.current;
    const client = inferenceRef.current;
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
      anchorRef.current = { result, gray };
      schedulerRef.current.complete();
      setTelemetry((current) => ({ ...current, inferenceMs: result.inferenceMs, calls: current.calls + 1, reason }));
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
      const warped = warpDepth(anchor.result.depth, anchor.result.width, anchor.result.height, flow.flow, flow.confidence, flow.width, flow.height);
      const canvas = depthCanvasRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context) {
        canvas.width = anchor.result.width;
        canvas.height = anchor.result.height;
        context.putImageData(createDepthImageData(warped.depth, canvas.width, canvas.height, paletteRef.current), 0, 0);
        setHasDepth(true);
      }
      latestSignalsRef.current = { ...latestSignalsRef.current, motion: flow.meanMagnitude, lowConfidenceFraction: flow.lowConfidenceFraction };
      depthFramesRef.current.push(timestamp);
      depthFramesRef.current = depthFramesRef.current.filter((time) => timestamp - time <= 1000);
      setTelemetry((current) => ({ ...current, depthFps: depthFramesRef.current.length, flowMs: flow.elapsedMs, motion: flow.meanMagnitude, lowConfidence: flow.lowConfidenceFraction }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Optical-flow propagation failed.');
    }
  }

  function saveSnapshot(): void {
    const canvas = depthCanvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const link = document.createElement('a');
    link.download = `depthguide-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return (
    <div className="live-workspace">
      <div className="live-toolbar">
        <div><small>LIVE CAMERA</small><strong>{status === 'running' ? 'Local stream active' : 'Camera is off'}</strong></div>
        <label>CAMERA<select disabled={status === 'starting'} value={deviceId} onChange={(event) => { setDeviceId(event.target.value); if (status === 'running') void beginCamera(event.target.value); }}><option value="">Default camera</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
        <label>KEYFRAME<select value={interval} onChange={(event) => { const value = Number(event.target.value); setIntervalValue(value); schedulerRef.current.setInterval(value); }}>{[2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>Every {value} frames</option>)}</select></label>
        <label>PALETTE<select value={palette} onChange={(event) => setPalette(event.target.value as DepthPalette)}><option value="viridis">Viridis</option><option value="turbo">Turbo</option><option value="luma">Greyscale</option></select></label>
        {status === 'running' ? <button className="secondary-button" type="button" onClick={stopCamera}>Stop</button> : <button className="primary-button compact" disabled={status === 'starting'} type="button" onClick={() => void beginCamera()}>Start camera <b>→</b></button>}
      </div>
      <div className="live-grid">
        <figure><figcaption><span>01</span> CAMERA</figcaption><video ref={videoRef} autoPlay muted playsInline /></figure>
        <figure><figcaption><span>02</span> PROPAGATED DEPTH</figcaption><canvas ref={depthCanvasRef} />{!hasDepth && <div className={status === 'running' ? 'live-placeholder running' : 'live-placeholder'}><span>{status === 'running' ? 'DEPTH INITIALIZING' : 'CAMERA WAITING'}</span></div>}</figure>
      </div>
      <div className="live-footer">
        <div className={`result-status ${status === 'error' ? 'error' : status === 'running' ? 'ready' : ''}`}><i />{message}</div>
        <div className="live-actions"><button className="secondary-button" disabled={status !== 'running'} onClick={() => { manualRefreshRef.current = true; }} type="button">Refresh depth</button><button className="secondary-button" onClick={saveSnapshot} type="button">Save depth PNG</button></div>
      </div>
      <dl className="telemetry-strip">
        <div><dt>Camera</dt><dd>{telemetry.cameraFps} fps</dd></div><div><dt>Depth display</dt><dd>{telemetry.depthFps} fps</dd></div><div><dt>Inference</dt><dd>{formatMs(telemetry.inferenceMs)}</dd></div><div><dt>Optical flow</dt><dd>{formatMs(telemetry.flowMs)}</dd></div><div><dt>Motion</dt><dd>{telemetry.motion.toFixed(2)} px</dd></div><div><dt>Low confidence</dt><dd>{Math.round(telemetry.lowConfidence * 100)}%</dd></div><div><dt>Keyframe age</dt><dd>{schedulerRef.current.age} frames</dd></div><div><dt>Model calls</dt><dd>{telemetry.calls}</dd></div>
      </dl>
      <canvas ref={captureCanvasRef} className="sr-only" /><canvas ref={flowCanvasRef} width={FLOW_WIDTH} height={FLOW_HEIGHT} className="sr-only" />
    </div>
  );
}
