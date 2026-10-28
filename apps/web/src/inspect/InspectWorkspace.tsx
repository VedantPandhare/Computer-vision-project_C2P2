import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent } from 'react';
import { describeCameraError, startCamera, stopMediaStream } from '../capture/camera';
import { createDepthImageData } from '../effects/depthColor';
import { ExplainClient, type ExplainResult } from '../engine/explain/ExplainClient';
import type { InferenceBackend } from '../engine/inference/messages';

interface InspectWorkspaceProps { preferredBackend: InferenceBackend }
export interface SelectedPatch { column: number; row: number; index: number }
type InspectView = 'depth' | 'rollout' | 'query' | 'pca';

const VIEW_COPY: Record<InspectView, { title: string; note: string }> = {
  depth: { title: 'RELATIVE DEPTH', note: 'The model predicts which regions are relatively nearer or farther. The colours are relative within this image, not real-world metres.' },
  rollout: { title: 'GLOBAL ATTENTION ROLLOUT', note: 'Rollout combines all 12 layers and 6 heads, including residual paths, to show which patches feed the model’s global CLS representation. Bright areas had stronger information flow.' },
  query: { title: 'SELECTED-PATCH ATTENTION', note: 'This map asks: “When processing the selected patch, which other patches did this layer and head look at?” Change the layer or head to inspect different relationships.' },
  pca: { title: 'PATCH FEATURE CLUSTERS', note: 'PCA compresses each patch’s 384 internal features into RGB. Similar colours mean the model represents those regions similarly; the colours are not object labels.' },
};

export function pixelToPatch(x: number, y: number, width: number, height: number, columns: number, rows: number): SelectedPatch {
  const column = Math.min(columns - 1, Math.max(0, Math.floor((x / width) * columns)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y / height) * rows)));
  return { column, row, index: row * columns + column };
}

export function attentionHeatPixels(values: Float32Array): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    const value = Math.min(1, Math.max(0, values[index]));
    pixels[index * 4] = Math.round(44 + value * 211);
    pixels[index * 4 + 1] = Math.round(18 + Math.pow(value, 1.4) * 225);
    pixels[index * 4 + 2] = Math.round(92 - value * 68);
    pixels[index * 4 + 3] = Math.round(75 + value * 180);
  }
  return pixels;
}

function drawScaledImageData(context: CanvasRenderingContext2D, imageData: ImageData, width: number, height: number, smoothing: boolean): void {
  const temporary = document.createElement('canvas');
  temporary.width = imageData.width;
  temporary.height = imageData.height;
  temporary.getContext('2d')?.putImageData(imageData, 0, 0);
  context.imageSmoothingEnabled = smoothing;
  context.drawImage(temporary, 0, 0, width, height);
}

export function InspectWorkspace({ preferredBackend }: InspectWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<ExplainClient | null>(null);
  const frozenPixelsRef = useRef<ImageData | null>(null);
  const resultRef = useRef<ExplainResult | null>(null);
  const queryMapRef = useRef<Float32Array | null>(null);
  const querySerialRef = useRef(0);
  const gridRef = useRef({ columns: 20, rows: 20 });

  const [status, setStatus] = useState<'idle' | 'starting' | 'camera' | 'running' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('Start the camera or choose a photo to explain.');
  const [selectedPatch, setSelectedPatch] = useState<SelectedPatch | null>(null);
  const [view, setView] = useState<InspectView>('rollout');
  const [layer, setLayer] = useState(11);
  const [head, setHead] = useState<number | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [runDetails, setRunDetails] = useState('—');

  useEffect(() => {
    clientRef.current = new ExplainClient();
    return () => {
      stopMediaStream(streamRef.current);
      clientRef.current?.dispose();
    };
  }, []);

  async function start(): Promise<void> {
    stopMediaStream(streamRef.current);
    setStatus('starting');
    setMessage('Requesting camera access…');
    try {
      const stream = await startCamera();
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('The inspection preview is unavailable.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus('camera');
      setMessage('Camera ready. Freeze one useful frame to explain it.');
    } catch (error) {
      setStatus('error');
      setMessage(describeCameraError(error));
    }
  }

  async function freeze(): Promise<void> {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0);
    const frozen = context.getImageData(0, 0, canvas.width, canvas.height);
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    video.srcObject = null;
    await inspectPixels(frozen);
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setStatus('error'); setMessage('Please choose an image file.'); return; }
    const url = URL.createObjectURL(file);
    try { await inspectImage(url); } finally { URL.revokeObjectURL(url); }
  }

  async function inspectImage(source: string): Promise<void> {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('running');
    setMessage('Decoding the inspection image…');
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('The image could not be decoded.');
      context.drawImage(image, 0, 0);
      await inspectPixels(context.getImageData(0, 0, canvas.width, canvas.height));
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The image could not be inspected.');
    }
  }

  async function inspectPixels(frozen: ImageData): Promise<void> {
    const client = clientRef.current;
    const sourceCanvas = sourceCanvasRef.current;
    if (!client || !sourceCanvas) return;
    frozenPixelsRef.current = frozen;
    resultRef.current = null;
    queryMapRef.current = null;
    querySerialRef.current += 1;
    setHasResult(false);
    setSelectedPatch(null);
    setView('rollout');
    sourceCanvas.width = frozen.width;
    sourceCanvas.height = frozen.height;
    drawPatchGrid(null);
    setStatus('running');
    setMessage('Preparing the explainability model…');
    try {
      const result = await client.inspect(new Uint8ClampedArray(frozen.data), frozen.width, frozen.height, preferredBackend, setMessage);
      resultRef.current = result;
      gridRef.current = { columns: result.gridColumns, rows: result.gridRows };
      const center = pixelToPatch(frozen.width / 2, frozen.height / 2, frozen.width, frozen.height, result.gridColumns, result.gridRows);
      setSelectedPatch(center);
      setHasResult(true);
      setRunDetails(`${result.backend.toUpperCase()} · ${(result.inferenceMs / 1000).toFixed(1)} s`);
      drawPatchGrid(center);
      renderResult('rollout');
      setStatus('ready');
      setMessage('Real model explanations are ready. Select a patch or switch views.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The frame could not be explained.');
    }
  }

  function drawPatchGrid(selection: SelectedPatch | null): void {
    const canvas = sourceCanvasRef.current;
    const frozen = frozenPixelsRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !frozen) return;
    context.putImageData(frozen, 0, 0);
    const cellWidth = canvas.width / gridRef.current.columns;
    const cellHeight = canvas.height / gridRef.current.rows;
    context.strokeStyle = 'rgba(184, 245, 50, 0.2)';
    context.lineWidth = 1;
    for (let column = 1; column < gridRef.current.columns; column += 1) { const x = column * cellWidth; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
    for (let row = 1; row < gridRef.current.rows; row += 1) { const y = row * cellHeight; context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
    if (selection) {
      context.fillStyle = 'rgba(184, 245, 50, 0.32)';
      context.strokeStyle = '#b8f532';
      context.lineWidth = 2;
      context.fillRect(selection.column * cellWidth, selection.row * cellHeight, cellWidth, cellHeight);
      context.strokeRect(selection.column * cellWidth, selection.row * cellHeight, cellWidth, cellHeight);
    }
  }

  function renderResult(nextView: InspectView): void {
    const result = resultRef.current;
    const frozen = frozenPixelsRef.current;
    const canvas = resultCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!result || !frozen || !canvas || !context) return;
    canvas.width = frozen.width;
    canvas.height = frozen.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (nextView === 'depth') {
      drawScaledImageData(context, createDepthImageData(result.depth, result.width, result.height, 'viridis'), canvas.width, canvas.height, true);
      return;
    }
    context.putImageData(frozen, 0, 0);
    context.fillStyle = 'rgba(2, 8, 7, 0.52)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (nextView === 'pca') {
      context.globalAlpha = 0.78;
      drawScaledImageData(context, new ImageData(new Uint8ClampedArray(result.pcaColors), result.gridColumns, result.gridRows), canvas.width, canvas.height, false);
      context.globalAlpha = 1;
      return;
    }
    const values = nextView === 'rollout' ? result.rollout : queryMapRef.current;
    if (!values) return;
    const heatmap = new ImageData(new Uint8ClampedArray(attentionHeatPixels(values)), result.gridColumns, result.gridRows);
    context.globalAlpha = 0.88;
    drawScaledImageData(context, heatmap, canvas.width, canvas.height, true);
    context.globalAlpha = 1;
  }

  async function requestQueryMap(nextLayer: number, nextHead: number | null, patch: SelectedPatch): Promise<void> {
    const client = clientRef.current;
    if (!client || !resultRef.current) return;
    const serial = ++querySerialRef.current;
    setQueryLoading(true);
    try {
      const values = await client.attentionMap(nextLayer, nextHead, patch.index);
      if (serial !== querySerialRef.current) return;
      queryMapRef.current = values;
      renderResult('query');
    } catch (error) {
      if (serial === querySerialRef.current) setMessage(error instanceof Error ? error.message : 'The attention map failed.');
    } finally {
      if (serial === querySerialRef.current) setQueryLoading(false);
    }
  }

  function selectPatch(event: PointerEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    if (!frozenPixelsRef.current) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * canvas.height;
    const patch = pixelToPatch(x, y, canvas.width, canvas.height, gridRef.current.columns, gridRef.current.rows);
    setSelectedPatch(patch);
    drawPatchGrid(patch);
    if (view === 'query') void requestQueryMap(layer, head, patch);
  }

  function changeView(nextView: InspectView): void {
    setView(nextView);
    if (nextView === 'query' && selectedPatch) void requestQueryMap(layer, head, selectedPatch);
    else renderResult(nextView);
  }

  function changeLayer(nextLayer: number): void {
    setLayer(nextLayer);
    if (view === 'query' && selectedPatch) void requestQueryMap(nextLayer, head, selectedPatch);
  }

  function changeHead(nextHead: number | null): void {
    setHead(nextHead);
    if (view === 'query' && selectedPatch) void requestQueryMap(layer, nextHead, selectedPatch);
  }

  function reset(): void {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    frozenPixelsRef.current = null;
    resultRef.current = null;
    queryMapRef.current = null;
    querySerialRef.current += 1;
    setHasResult(false);
    setSelectedPatch(null);
    setRunDetails('—');
    const sourceCanvas = sourceCanvasRef.current;
    const resultCanvas = resultCanvasRef.current;
    if (sourceCanvas) sourceCanvas.getContext('2d')?.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    if (resultCanvas) resultCanvas.getContext('2d')?.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
    setStatus('idle');
    setMessage('Start the camera or choose a photo to explain.');
  }

  return (
    <div className="inspect-workspace">
      <div className="inspect-toolbar">
        <div><small>INSPECT MODE · GENUINE MODEL SIGNALS</small><strong>Freeze → attention → patch explanations</strong></div>
        {status === 'camera' ? <><button className="primary-button compact" onClick={() => void freeze()} type="button">Freeze frame <b>◇</b></button><button className="secondary-button" onClick={reset} type="button">Cancel</button></> : <><button className="secondary-button" disabled={status === 'running' || status === 'starting'} onClick={() => fileInputRef.current?.click()} type="button">Choose photo</button><input accept="image/*" className="sr-only" onChange={(event) => void choosePhoto(event)} ref={fileInputRef} type="file" />{status === 'ready' ? <button className="secondary-button" onClick={reset} type="button">New input</button> : <button className="primary-button compact" disabled={status === 'running' || status === 'starting'} onClick={() => void start()} type="button">Start camera <b>→</b></button>}</>}
      </div>
      <div className="inspect-samples"><span>QUICK INPUT</span><button disabled={status === 'running'} onClick={() => void inspectImage('/samples/terrace.png')} type="button">Terrace</button><button disabled={status === 'running'} onClick={() => void inspectImage('/samples/studio.png')} type="button">Studio</button><strong>{gridRef.current.columns} × {gridRef.current.rows} genuine patch grid</strong></div>
      <div className="inspect-grid">
        <figure><figcaption><span>01</span> {status === 'camera' ? 'LIVE CAMERA' : 'MODEL INPUT · CLICK A PATCH'}</figcaption><video className={status === 'camera' ? 'visible' : ''} ref={videoRef} autoPlay muted playsInline /><canvas className={status !== 'camera' ? 'visible' : ''} onPointerDown={selectPatch} ref={sourceCanvasRef} /></figure>
        <figure><figcaption><span>02</span> {VIEW_COPY[view].title}{view === 'query' ? ` · L${layer + 1} · ${head === null ? 'HEAD AVG' : `H${head + 1}`}` : ''}</figcaption><canvas className="visible" ref={resultCanvasRef} /><div className={status === 'running' || status === 'starting' || queryLoading ? 'inspect-loading visible' : 'inspect-loading'}><i /><span>{queryLoading ? 'Reading the selected attention row…' : message}</span></div></figure>
      </div>
      <div className="inspect-controls">
        <label>EXPLANATION<select disabled={!hasResult} onChange={(event) => changeView(event.target.value as InspectView)} value={view}><option value="rollout">Global attention rollout</option><option value="query">Selected-patch attention</option><option value="pca">Patch feature clusters (PCA)</option><option value="depth">Relative depth</option></select></label>
        <label>LAYER<select disabled={!hasResult || view !== 'query'} onChange={(event) => changeLayer(Number(event.target.value))} value={layer}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>Layer {index + 1}</option>)}</select></label>
        <label>HEAD<select disabled={!hasResult || view !== 'query'} onChange={(event) => changeHead(event.target.value === 'average' ? null : Number(event.target.value))} value={head === null ? 'average' : head}><option value="average">Average of 6</option>{Array.from({ length: 6 }, (_, index) => <option key={index} value={index}>Head {index + 1}</option>)}</select></label>
        <div><small>SELECTED PATCH</small><strong>{selectedPatch ? `#${selectedPatch.index} · row ${selectedPatch.row}, column ${selectedPatch.column}` : 'Click the model input'}</strong></div>
        <div className="inspect-capability"><small>MODEL RUN</small><strong>{runDetails}</strong></div>
      </div>
      <div className={`inspect-status ${status}`}><i />{message}</div>
      <aside className="interpretation-note genuine"><strong>How to read this view</strong><p>{VIEW_COPY[view].note} Attention and PCA are faithful internal model signals, but neither alone proves the cause of a prediction.</p></aside>
    </div>
  );
}
