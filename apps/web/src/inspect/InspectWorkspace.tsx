import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient, type DepthResult } from '../engine/inference/DepthInferenceClient';
import { calculateModelSize } from '../engine/inference/depthMath';
import { QUALITY_PROFILES } from '../engine/inference/modelConfig';
import { createDepthImageData, depthToRgb, type DepthPalette } from '../effects/depthColor';
import { describeCameraError, startCamera, stopMediaStream } from '../capture/camera';

interface InspectWorkspaceProps { preferredBackend: InferenceBackend }
export interface SelectedPatch { column: number; row: number; index: number }
type InspectView = 'depth' | 'similarity' | 'relationship' | 'bands';
type MatchRange = 'tight' | 'balanced' | 'wide';

const MATCH_STRENGTH: Record<MatchRange, number> = { tight: 18, balanced: 10, wide: 5 };
const MATCH_THRESHOLD: Record<MatchRange, number> = { tight: 0.035, balanced: 0.07, wide: 0.14 };
const VIEW_LABELS: Record<InspectView, string> = {
  depth: 'RELATIVE DEPTH · CLICK TO INSPECT',
  similarity: 'DEPTH SIMILARITY · NOT ATTENTION',
  relationship: 'NEAR / SAME / FAR FROM SELECTED PATCH',
  bands: 'DEPTH LAYERS · SELECTED BAND HIGHLIGHTED',
};
const VIEW_NOTES: Record<InspectView, string> = {
  depth: 'Click either image to link a patch across both panels. The selected value is relative within this image: higher values are nearer and lower values are farther.',
  similarity: 'Brighter areas have a relative depth closer to the selected patch. Match range controls how strictly nearby depths are grouped.',
  relationship: 'Orange is nearer than the selected patch, lime is at a similar depth, and blue is farther away. Match range changes the size of the similar-depth zone.',
  bands: 'The continuous depth map is divided into six scene layers. The selected patch’s layer is brightened so similarly placed regions are easy to identify.',
};

export function pixelToPatch(x: number, y: number, width: number, height: number, columns: number, rows: number): SelectedPatch {
  const column = Math.min(columns - 1, Math.max(0, Math.floor((x / width) * columns)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y / height) * rows)));
  return { column, row, index: row * columns + column };
}

export function patchDepth(depth: Float32Array, width: number, height: number, patch: SelectedPatch, columns: number, rows: number): number {
  const centerX = Math.min(width - 1, Math.floor(((patch.column + 0.5) / columns) * width));
  const centerY = Math.min(height - 1, Math.floor(((patch.row + 0.5) / rows) * height));
  return depth[centerY * width + centerX];
}

export function depthSimilarityPixels(depth: Float32Array, width: number, height: number, patch: SelectedPatch, columns: number, rows: number, strength = 10): Uint8ClampedArray {
  const targetDepth = patchDepth(depth, width, height, patch, columns, rows);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < depth.length; index += 1) {
    const similarity = Math.exp(-Math.abs(depth[index] - targetDepth) * strength);
    pixels[index * 4] = Math.round(184 * similarity);
    pixels[index * 4 + 1] = Math.round(245 * similarity);
    pixels[index * 4 + 2] = Math.round(50 + 100 * (1 - similarity));
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

export function depthRelationshipPixels(depth: Float32Array, width: number, height: number, patch: SelectedPatch, columns: number, rows: number, threshold: number): Uint8ClampedArray {
  const targetDepth = patchDepth(depth, width, height, patch, columns, rows);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < depth.length; index += 1) {
    const difference = depth[index] - targetDepth;
    const color = Math.abs(difference) <= threshold
      ? [184, 245, 50]
      : difference > 0 ? [239, 113, 92] : [55, 87, 190];
    pixels[index * 4] = color[0];
    pixels[index * 4 + 1] = color[1];
    pixels[index * 4 + 2] = color[2];
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

export function depthBandPixels(depth: Float32Array, selectedDepth: number, palette: DepthPalette, bandCount = 6): Uint8ClampedArray {
  const selectedBand = Math.min(bandCount - 1, Math.floor(selectedDepth * bandCount));
  const pixels = new Uint8ClampedArray(depth.length * 4);
  for (let index = 0; index < depth.length; index += 1) {
    const band = Math.min(bandCount - 1, Math.floor(depth[index] * bandCount));
    const midpoint = (band + 0.5) / bandCount;
    const [red, green, blue] = depthToRgb(midpoint, palette);
    const selected = band === selectedBand;
    pixels[index * 4] = selected ? 184 : Math.round(red * 0.25);
    pixels[index * 4 + 1] = selected ? 245 : Math.round(green * 0.25);
    pixels[index * 4 + 2] = selected ? 50 : Math.round(blue * 0.25);
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

export function describeRelativeDepth(value: number | null): string {
  if (value === null) return 'Click either panel';
  const zone = value >= 0.67 ? 'nearer region' : value <= 0.33 ? 'farther region' : 'middle region';
  return `${Math.round(value * 100)}% · ${zone}`;
}

export function InspectWorkspace({ preferredBackend }: InspectWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<DepthInferenceClient | null>(null);
  const frozenPixelsRef = useRef<ImageData | null>(null);
  const resultRef = useRef<DepthResult | null>(null);
  const gridRef = useRef({ columns: 32, rows: 24 });

  const [status, setStatus] = useState<'idle' | 'starting' | 'camera' | 'running' | 'ready' | 'error'>('idle');
  const [message, setMessage] = useState('Start the camera or choose a photo to inspect.');
  const [selectedPatch, setSelectedPatch] = useState<SelectedPatch | null>(null);
  const [selectedDepth, setSelectedDepth] = useState<number | null>(null);
  const [depthShape, setDepthShape] = useState('—');
  const [view, setView] = useState<InspectView>('depth');
  const [palette, setPalette] = useState<DepthPalette>('viridis');
  const [matchRange, setMatchRange] = useState<MatchRange>('balanced');
  const [hasResult, setHasResult] = useState(false);

  useEffect(() => {
    clientRef.current = new DepthInferenceClient();
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
      setMessage('Camera ready. Freeze a frame when the scene is useful.');
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
    setHasResult(false);
    setSelectedPatch(null);
    setSelectedDepth(null);
    setView('depth');
    const modelSize = calculateModelSize(frozen.width, frozen.height, QUALITY_PROFILES.balanced.modelTarget);
    gridRef.current = { columns: modelSize.width / 14, rows: modelSize.height / 14 };
    sourceCanvas.width = frozen.width;
    sourceCanvas.height = frozen.height;
    drawPatchGrid(null);
    setStatus('running');
    setMessage('Estimating depth for the frozen frame…');
    try {
      const result = await client.estimate(new Uint8ClampedArray(frozen.data), frozen.width, frozen.height, preferredBackend, setMessage, 'balanced');
      resultRef.current = result;
      setHasResult(true);
      setDepthShape(`${result.width} × ${result.height}`);
      renderResult('depth', null, palette, matchRange);
      setStatus('ready');
      setMessage('Depth inspection is ready. Select a patch, then compare its depth neighborhood.');
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
    const cellWidth = canvas.width / gridRef.current.columns;
    const cellHeight = canvas.height / gridRef.current.rows;
    context.strokeStyle = 'rgba(184, 245, 50, 0.18)';
    context.lineWidth = 1;
    for (let column = 1; column < gridRef.current.columns; column += 1) { const x = column * cellWidth; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
    for (let row = 1; row < gridRef.current.rows; row += 1) { const y = row * cellHeight; context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
    if (selection) {
      context.fillStyle = 'rgba(184, 245, 50, 0.3)';
      context.strokeStyle = '#b8f532';
      context.lineWidth = 2;
      context.fillRect(selection.column * cellWidth, selection.row * cellHeight, cellWidth, cellHeight);
      context.strokeRect(selection.column * cellWidth, selection.row * cellHeight, cellWidth, cellHeight);
    }
  }

  function drawResultSelection(context: CanvasRenderingContext2D, result: DepthResult, patch: SelectedPatch | null): void {
    if (!patch) return;
    const cellWidth = result.width / gridRef.current.columns;
    const cellHeight = result.height / gridRef.current.rows;
    context.fillStyle = 'rgba(184, 245, 50, 0.16)';
    context.strokeStyle = '#b8f532';
    context.lineWidth = Math.max(1, result.width / 320);
    context.fillRect(patch.column * cellWidth, patch.row * cellHeight, cellWidth, cellHeight);
    context.strokeRect(patch.column * cellWidth, patch.row * cellHeight, cellWidth, cellHeight);
  }

  function renderResult(nextView: InspectView, patch: SelectedPatch | null, nextPalette = palette, nextRange = matchRange): void {
    const result = resultRef.current;
    const canvas = resultCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!result || !canvas || !context) return;
    canvas.width = result.width;
    canvas.height = result.height;
    if (nextView === 'similarity' && patch) {
      const pixels = depthSimilarityPixels(result.depth, result.width, result.height, patch, gridRef.current.columns, gridRef.current.rows, MATCH_STRENGTH[nextRange]);
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), result.width, result.height), 0, 0);
    } else if (nextView === 'relationship' && patch) {
      const pixels = depthRelationshipPixels(result.depth, result.width, result.height, patch, gridRef.current.columns, gridRef.current.rows, MATCH_THRESHOLD[nextRange]);
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), result.width, result.height), 0, 0);
    } else if (nextView === 'bands' && patch) {
      const targetDepth = patchDepth(result.depth, result.width, result.height, patch, gridRef.current.columns, gridRef.current.rows);
      const pixels = depthBandPixels(result.depth, targetDepth, nextPalette);
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), result.width, result.height), 0, 0);
    } else {
      context.putImageData(createDepthImageData(result.depth, result.width, result.height, nextPalette), 0, 0);
    }
    drawResultSelection(context, result, patch);
  }

  function selectPatch(event: PointerEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    const result = resultRef.current;
    if (!frozenPixelsRef.current || !result) return;
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
    const displayedWidth = canvas.width * scale;
    const displayedHeight = canvas.height * scale;
    const x = Math.min(canvas.width, Math.max(0, (event.clientX - bounds.left - (bounds.width - displayedWidth) / 2) / scale));
    const y = Math.min(canvas.height, Math.max(0, (event.clientY - bounds.top - (bounds.height - displayedHeight) / 2) / scale));
    const patch = pixelToPatch(x, y, canvas.width, canvas.height, gridRef.current.columns, gridRef.current.rows);
    setSelectedPatch(patch);
    setSelectedDepth(patchDepth(result.depth, result.width, result.height, patch, gridRef.current.columns, gridRef.current.rows));
    drawPatchGrid(patch);
    renderResult(view, patch);
  }

  function changeView(nextView: InspectView): void {
    setView(nextView);
    renderResult(nextView, selectedPatch);
  }

  function changePalette(nextPalette: DepthPalette): void {
    setPalette(nextPalette);
    renderResult(view, selectedPatch, nextPalette, matchRange);
  }

  function changeMatchRange(nextRange: MatchRange): void {
    setMatchRange(nextRange);
    renderResult(view, selectedPatch, palette, nextRange);
  }

  function reset(): void {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    frozenPixelsRef.current = null;
    resultRef.current = null;
    setHasResult(false);
    setSelectedPatch(null);
    setSelectedDepth(null);
    setDepthShape('—');
    const sourceCanvas = sourceCanvasRef.current;
    const resultCanvas = resultCanvasRef.current;
    if (sourceCanvas) sourceCanvas.getContext('2d')?.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
    if (resultCanvas) resultCanvas.getContext('2d')?.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
    setStatus('idle');
    setMessage('Start the camera or choose a photo to inspect.');
  }

  return (
    <div className="inspect-workspace">
      <div className="inspect-toolbar">
        <div><small>INSPECT MODE</small><strong>Freeze → depth → patch relationships</strong></div>
        {status === 'camera' ? <><button className="primary-button compact" onClick={() => void freeze()} type="button">Freeze frame <b>◇</b></button><button className="secondary-button" onClick={reset} type="button">Cancel</button></> : <><button className="secondary-button" disabled={status === 'running' || status === 'starting'} onClick={() => fileInputRef.current?.click()} type="button">Choose photo</button><input accept="image/*" className="sr-only" onChange={(event) => void choosePhoto(event)} ref={fileInputRef} type="file" />{status === 'ready' ? <button className="secondary-button" onClick={reset} type="button">New input</button> : <button className="primary-button compact" disabled={status === 'running' || status === 'starting'} onClick={() => void start()} type="button">Start camera <b>→</b></button>}</>}
      </div>
      <div className="inspect-samples"><span>QUICK INPUT</span><button disabled={status === 'running'} onClick={() => void inspectImage('/samples/terrace.png')} type="button">Terrace</button><button disabled={status === 'running'} onClick={() => void inspectImage('/samples/studio.png')} type="button">Studio</button><strong>{gridRef.current.columns} × {gridRef.current.rows} patch grid</strong></div>
      <div className="inspect-grid">
        <figure><figcaption><span>01</span> {status === 'camera' ? 'LIVE CAMERA' : 'FROZEN FRAME / MODEL PATCH GRID'}</figcaption><video className={status === 'camera' ? 'visible' : ''} ref={videoRef} autoPlay muted playsInline /><canvas className={status !== 'camera' ? 'visible' : ''} onPointerDown={selectPatch} ref={sourceCanvasRef} /></figure>
        <figure><figcaption><span>02</span> {VIEW_LABELS[view]}</figcaption><canvas className="visible" onPointerDown={selectPatch} ref={resultCanvasRef} /><div className={status === 'running' || status === 'starting' ? 'inspect-loading visible' : 'inspect-loading'}><i /><span>{message}</span></div></figure>
      </div>
      <div className="inspect-controls">
        <label>VIEW<select disabled={!hasResult} onChange={(event) => changeView(event.target.value as InspectView)} value={view}><option value="depth">Relative depth + probe</option><option disabled={!selectedPatch} value="similarity">Selected-patch depth similarity</option><option disabled={!selectedPatch} value="relationship">Near / same / far</option><option disabled={!selectedPatch} value="bands">Selected depth layer</option></select></label>
        <label>PALETTE<select disabled={!hasResult || view === 'similarity' || view === 'relationship'} onChange={(event) => changePalette(event.target.value as DepthPalette)} value={palette}><option value="viridis">Viridis</option><option value="turbo">Turbo</option><option value="luma">Grayscale</option></select></label>
        <label>MATCH RANGE<select disabled={!hasResult || (view !== 'similarity' && view !== 'relationship')} onChange={(event) => changeMatchRange(event.target.value as MatchRange)} value={matchRange}><option value="tight">Tight</option><option value="balanced">Balanced</option><option value="wide">Wide</option></select></label>
        <div><small>SELECTED MODEL PATCH</small><strong>{selectedPatch ? `#${selectedPatch.index} · row ${selectedPatch.row}, column ${selectedPatch.column}` : 'Click the frozen frame'}</strong></div>
        <div><small>RELATIVE DEPTH</small><strong>{describeRelativeDepth(selectedDepth)}</strong></div>
        <div className="inspect-capability"><small>OUTPUT</small><strong>{depthShape}</strong></div>
      </div>
      <div className={`inspect-status ${status}`}><i />{message}</div>
      <aside className="interpretation-note"><strong>{view === 'depth' ? 'Interactive relative-depth probe' : 'Depth relationships, not transformer attention'}</strong><p>{VIEW_NOTES[view]} These views explain the estimated depth structure, not the model’s reasoning.</p></aside>
    </div>
  );
}
