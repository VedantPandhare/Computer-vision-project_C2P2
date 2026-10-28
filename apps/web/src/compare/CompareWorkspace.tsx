import { useEffect, useRef, useState } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient, type DepthResult } from '../engine/inference/DepthInferenceClient';
import { FlowClient } from '../engine/flow/FlowClient';
import { warpDepth } from '../engine/propagation/warpDepth';
import { stabilizeDepth } from '../engine/fusion/depthFusion';
import { createDepthImageData } from '../effects/depthColor';
import { describeCameraError, listVideoInputs, startCamera, stopMediaStream } from '../capture/camera';

interface CompareWorkspaceProps { preferredBackend: InferenceBackend }

interface CompareMetrics {
  cameraFps: number;
  naiveFps: number;
  guideFps: number;
  modelCalls: number;
  inferenceMs: number;
  flowMs: number;
  naiveJump: number;
  guideJump: number;
}

const FLOW_WIDTH = 160;
const FLOW_HEIGHT = 120;

function grayscale(pixels: Uint8ClampedArray): Uint8Array {
  const output = new Uint8Array(pixels.length / 4);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    output[target] = Math.round(pixels[source] * 0.299 + pixels[source + 1] * 0.587 + pixels[source + 2] * 0.114);
  }
  return output;
}

export function depthJump(current: Float32Array, previous: Float32Array | null): number {
  if (!previous || previous.length !== current.length) return 0;
  const stride = Math.max(1, Math.floor(current.length / 8000));
  let sum = 0;
  let count = 0;
  for (let index = 0; index < current.length; index += stride) {
    sum += Math.abs(current[index] - previous[index]);
    count += 1;
  }
  return count ? sum / count : 0;
}

function drawDepth(canvas: HTMLCanvasElement | null, result: Float32Array, width: number, height: number): void {
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  canvas.width = width;
  canvas.height = height;
  context.putImageData(createDepthImageData(result, width, height, 'viridis'), 0, 0);
}

export function CompareWorkspace({ preferredBackend }: CompareWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureRef = useRef<HTMLCanvasElement | null>(null);
  const flowCaptureRef = useRef<HTMLCanvasElement | null>(null);
  const naiveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const guideCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inferenceRef = useRef<DepthInferenceClient | null>(null);
  const flowRef = useRef<FlowClient | null>(null);
  const anchorRef = useRef<{ result: DepthResult; gray: Uint8Array } | null>(null);
  const previousNaiveRef = useRef<Float32Array | null>(null);
  const previousGuideRef = useRef<Float32Array | null>(null);
  const activeRef = useRef(false);
  const inferenceBusyRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const cameraTicksRef = useRef<number[]>([]);
  const naiveTicksRef = useRef<number[]>([]);
  const guideTicksRef = useRef<number[]>([]);
  const lastUiUpdateRef = useRef(0);
  const metricsRef = useRef<CompareMetrics>({ cameraFps: 0, naiveFps: 0, guideFps: 0, modelCalls: 0, inferenceMs: 0, flowMs: 0, naiveJump: 0, guideJump: 0 });

  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState('Start one shared camera stream to compare both approaches fairly.');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [metrics, setMetrics] = useState(metricsRef.current);

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

  async function beginCamera(selectedDeviceId = deviceId): Promise<void> {
    activeRef.current = false;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    stopMediaStream(streamRef.current);
    setStatus('starting');
    setMessage('Requesting camera access…');
    try {
      const stream = await startCamera(selectedDeviceId || undefined);
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('The comparison preview is unavailable.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const available = await listVideoInputs();
      setDevices(available);
      const activeDevice = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeDevice) setDeviceId(activeDevice);
      activeRef.current = true;
      setStatus('running');
      setMessage('Comparison running. Both sides share the same camera frames and model worker.');
      scheduleFrame();
    } catch (error) {
      setStatus('error');
      setMessage(describeCameraError(error));
    }
  }

  function stop(): void {
    activeRef.current = false;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
    setMessage('Comparison stopped. The last results remain visible.');
  }

  function scheduleFrame(): void { animationRef.current = requestAnimationFrame(processFrame); }

  function processFrame(timestamp: number): void {
    if (!activeRef.current) return;
    const video = videoRef.current;
    const canvas = flowCaptureRef.current;
    if (video?.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA && canvas) {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(video, 0, 0, FLOW_WIDTH, FLOW_HEIGHT);
        const gray = grayscale(context.getImageData(0, 0, FLOW_WIDTH, FLOW_HEIGHT).data);
        cameraTicksRef.current.push(timestamp);
        cameraTicksRef.current = cameraTicksRef.current.filter((value) => timestamp - value <= 1000);
        if (!inferenceBusyRef.current) void runNaiveInference(video, gray.slice());
        if (anchorRef.current && flowRef.current && !flowRef.current.busy) void runGuideFlow(gray.slice(), timestamp);
        if (timestamp - lastUiUpdateRef.current > 500) {
          lastUiUpdateRef.current = timestamp;
          metricsRef.current.cameraFps = cameraTicksRef.current.length;
          metricsRef.current.naiveFps = naiveTicksRef.current.length;
          metricsRef.current.guideFps = guideTicksRef.current.length;
          setMetrics({ ...metricsRef.current });
        }
      }
    }
    scheduleFrame();
  }

  async function runNaiveInference(video: HTMLVideoElement, gray: Uint8Array): Promise<void> {
    const client = inferenceRef.current;
    const canvas = captureRef.current;
    if (!client || !canvas) return;
    inferenceBusyRef.current = true;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) { inferenceBusyRef.current = false; return; }
    context.drawImage(video, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    try {
      const result = await client.estimate(pixels, width, height, preferredBackend, (progress) => setMessage(progress));
      const jump = depthJump(result.depth, previousNaiveRef.current);
      previousNaiveRef.current = result.depth.slice();
      anchorRef.current = { result, gray };
      drawDepth(naiveCanvasRef.current, result.depth, result.width, result.height);
      const completedAt = performance.now();
      naiveTicksRef.current.push(completedAt);
      naiveTicksRef.current = naiveTicksRef.current.filter((value) => completedAt - value <= 1000);
      metricsRef.current = { ...metricsRef.current, modelCalls: metricsRef.current.modelCalls + 1, inferenceMs: result.inferenceMs, naiveJump: jump };
      setMessage('Naive updates only when the model finishes; DepthGuide keeps propagating between calls.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Comparison inference failed.');
    } finally {
      inferenceBusyRef.current = false;
    }
  }

  async function runGuideFlow(gray: Uint8Array, timestamp: number): Promise<void> {
    const anchor = anchorRef.current;
    const client = flowRef.current;
    if (!anchor || !client) return;
    try {
      const flow = await client.compute(gray, anchor.gray.slice(), FLOW_WIDTH, FLOW_HEIGHT);
      const warped = warpDepth(anchor.result.depth, anchor.result.width, anchor.result.height, flow.flow, flow.confidence, flow.width, flow.height);
      const stable = stabilizeDepth(warped.depth, previousGuideRef.current, warped.confidence, 1, flow.meanMagnitude);
      const jump = depthJump(stable, previousGuideRef.current);
      previousGuideRef.current = stable;
      drawDepth(guideCanvasRef.current, stable, anchor.result.width, anchor.result.height);
      guideTicksRef.current.push(timestamp);
      guideTicksRef.current = guideTicksRef.current.filter((value) => timestamp - value <= 1000);
      metricsRef.current = { ...metricsRef.current, flowMs: flow.elapsedMs, guideJump: jump };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Depth propagation failed.');
    }
  }

  return (
    <div className="compare-workspace">
      <div className="compare-toolbar">
        <div><small>A/B COMPARISON</small><strong>Same frames, two update strategies</strong></div>
        <label>CAMERA<select value={deviceId} onChange={(event) => { setDeviceId(event.target.value); if (status === 'running') void beginCamera(event.target.value); }}><option value="">Default camera</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
        {status === 'running' ? <button className="secondary-button" onClick={stop} type="button">Stop</button> : <button className="primary-button compact" disabled={status === 'starting'} onClick={() => void beginCamera()} type="button">Start comparison <b>→</b></button>}
      </div>
      <div className="compare-source"><video ref={videoRef} autoPlay muted playsInline /><p><strong>Shared input</strong><span>Both outputs receive frames from this exact stream. Model computation is shared so the comparison does not secretly double the workload.</span></p></div>
      <div className="compare-grid">
        <figure><figcaption><span>A</span> NAIVE MODEL-ONLY <b>{metrics.naiveFps} depth fps</b></figcaption><canvas ref={naiveCanvasRef} /><div className="compare-metrics"><span>Inference {metrics.inferenceMs ? `${Math.round(metrics.inferenceMs)} ms` : '—'}</span><span>Update jump {metrics.naiveJump.toFixed(4)}</span></div></figure>
        <figure><figcaption><span>B</span> DEPTHGUIDE PROPAGATION <b>{metrics.guideFps} depth fps</b></figcaption><canvas ref={guideCanvasRef} /><div className="compare-metrics"><span>Flow {metrics.flowMs ? `${Math.round(metrics.flowMs)} ms` : '—'}</span><span>Update jump {metrics.guideJump.toFixed(4)}</span></div></figure>
      </div>
      <div className={`compare-status ${status}`}><i />{message}<span>Camera {metrics.cameraFps} fps · Model calls {metrics.modelCalls}</span></div>
      <canvas className="sr-only" ref={captureRef} /><canvas className="sr-only" height={FLOW_HEIGHT} ref={flowCaptureRef} width={FLOW_WIDTH} />
    </div>
  );
}
