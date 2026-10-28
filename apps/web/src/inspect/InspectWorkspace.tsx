import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient } from '../engine/inference/DepthInferenceClient';
import { createDepthImageData } from '../effects/depthColor';
import { describeCameraError, startCamera, stopMediaStream } from '../capture/camera';

interface InspectWorkspaceProps { preferredBackend: InferenceBackend }

interface SelectedPatch { column: number; row: number; index: number }

const PATCH_SIZE = 14;

export function pixelToPatch(x: number, y: number, width: number): SelectedPatch {
  const columns = Math.ceil(width / PATCH_SIZE);
  const column = Math.max(0, Math.floor(x / PATCH_SIZE));
  const row = Math.max(0, Math.floor(y / PATCH_SIZE));
  return { column, row, index: row * columns + column };
}

export function InspectWorkspace({ preferredBackend }: InspectWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const depthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<DepthInferenceClient | null>(null);
  const frozenPixelsRef = useRef<ImageData | null>(null);

  const [status, setStatus] = useState<'idle' | 'camera' | 'running' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('Start the camera, then freeze a frame for inspection.');
  const [selectedPatch, setSelectedPatch] = useState<SelectedPatch | null>(null);
  const [depthShape, setDepthShape] = useState('—');

  useEffect(() => {
    clientRef.current = new DepthInferenceClient();
    return () => {
      stopMediaStream(streamRef.current);
      clientRef.current?.dispose();
    };
  }, []);

  async function start(): Promise<void> {
    setMessage('Requesting camera access…');
    try {
      const stream = await startCamera();
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('The inspection preview is unavailable.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus('camera');
      setMessage('Camera ready. Freeze a frame when the scene is useful.');
    } catch (error) {
      setStatus('error');
      setMessage(describeCameraError(error));
    }
  }

  async function freeze(): Promise<void> {
    const video = videoRef.current;
    const canvas = sourceCanvasRef.current;
    const client = clientRef.current;
    if (!video || !canvas || !client || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frozen = context.getImageData(0, 0, canvas.width, canvas.height);
    frozenPixelsRef.current = frozen;
    drawPatchGrid(null);
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    video.srcObject = null;
    setStatus('running');
    setMessage('Estimating depth for the frozen frame…');
    try {
      const result = await client.estimate(new Uint8ClampedArray(frozen.data), frozen.width, frozen.height, preferredBackend, setMessage);
      const depthCanvas = depthCanvasRef.current;
      const depthContext = depthCanvas?.getContext('2d');
      if (depthCanvas && depthContext) {
        depthCanvas.width = result.width;
        depthCanvas.height = result.height;
        depthContext.putImageData(createDepthImageData(result.depth, result.width, result.height, 'viridis'), 0, 0);
      }
      setDepthShape(`${result.width} × ${result.height}`);
      setStatus('ready');
      setMessage('Frozen depth is ready. Select an image patch to prepare an attention query.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The frozen frame could not be inspected.');
    }
  }

  function drawPatchGrid(selection: SelectedPatch | null): void {
    const canvas = sourceCanvasRef.current;
    const frozen = frozenPixelsRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !frozen) return;
    context.putImageData(frozen, 0, 0);
    context.strokeStyle = 'rgba(184, 245, 50, 0.2)';
    context.lineWidth = 1;
    for (let x = PATCH_SIZE; x < canvas.width; x += PATCH_SIZE) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
    for (let y = PATCH_SIZE; y < canvas.height; y += PATCH_SIZE) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
    if (selection) {
      context.fillStyle = 'rgba(184, 245, 50, 0.28)';
      context.strokeStyle = '#b8f532';
      context.lineWidth = 2;
      context.fillRect(selection.column * PATCH_SIZE, selection.row * PATCH_SIZE, PATCH_SIZE, PATCH_SIZE);
      context.strokeRect(selection.column * PATCH_SIZE, selection.row * PATCH_SIZE, PATCH_SIZE, PATCH_SIZE);
    }
  }

  function selectPatch(event: PointerEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    if (!frozenPixelsRef.current) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * canvas.height;
    const patch = pixelToPatch(x, y, canvas.width);
    setSelectedPatch(patch);
    drawPatchGrid(patch);
  }

  function reset(): void {
    frozenPixelsRef.current = null;
    setSelectedPatch(null);
    setDepthShape('—');
    setStatus('idle');
    setMessage('Start the camera, then freeze a frame for inspection.');
  }

  return (
    <div className="inspect-workspace">
      <div className="inspect-toolbar">
        <div><small>INSPECT MODE</small><strong>Freeze → depth → transformer query</strong></div>
        {status === 'idle' || status === 'error' ? <button className="primary-button compact" onClick={() => void start()} type="button">Start camera <b>→</b></button> : status === 'camera' ? <button className="primary-button compact" onClick={() => void freeze()} type="button">Freeze frame <b>◇</b></button> : <button className="secondary-button" disabled={status === 'running'} onClick={reset} type="button">New frame</button>}
      </div>
      <div className="inspect-grid">
        <figure><figcaption><span>01</span> FROZEN FRAME / PATCH GRID</figcaption><video className={status === 'camera' ? 'visible' : ''} ref={videoRef} autoPlay muted playsInline /><canvas className={status !== 'camera' ? 'visible' : ''} onPointerDown={selectPatch} ref={sourceCanvasRef} /></figure>
        <figure><figcaption><span>02</span> RELATIVE DEPTH</figcaption><canvas className="visible" ref={depthCanvasRef} /><div className={status === 'running' ? 'inspect-loading visible' : 'inspect-loading'}><i /><span>{message}</span></div></figure>
      </div>
      <div className="inspect-controls">
        <label>LAYER<select disabled><option>Explain graph required</option></select></label>
        <label>HEAD<select disabled><option>Head averaged</option></select></label>
        <div><small>SELECTED PATCH</small><strong>{selectedPatch ? `#${selectedPatch.index} · row ${selectedPatch.row}, column ${selectedPatch.column}` : 'Click the frozen frame'}</strong></div>
        <div><small>DEPTH OUTPUT</small><strong>{depthShape}</strong></div>
      </div>
      <div className={`inspect-status ${status}`}><i />{message}</div>
      <aside className="interpretation-note"><strong>Why attention is not shown yet</strong><p>The current production ONNX graph returns depth only. Attention rollout needs a separately exported graph with explicit attention outputs. DepthGuide will not present image contrast or saliency as model attention, because that would be misleading. Attention maps will be enabled only after the explain graph passes numerical validation.</p></aside>
    </div>
  );
}
