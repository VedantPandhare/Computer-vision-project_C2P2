import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient, type DepthResult } from '../engine/inference/DepthInferenceClient';
import { createDepthImageData, type DepthPalette } from '../effects/depthColor';
import { PhotoStudio, type PhotoStudioView } from '../effects/PhotoStudio';

interface PhotoWorkspaceProps {
  preferredBackend: InferenceBackend;
}

type PhotoStatus = 'empty' | 'decoding' | 'running' | 'ready' | 'error';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function formatDuration(milliseconds: number): string {
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${Math.round(milliseconds)} ms`;
}

export function PhotoWorkspace({ preferredBackend }: PhotoWorkspaceProps) {
  const clientRef = useRef<DepthInferenceClient | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<PhotoStatus>('empty');
  const [message, setMessage] = useState('Drop a photo here, or choose one from your computer.');
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [result, setResult] = useState<DepthResult | null>(null);
  const [palette, setPalette] = useState<DepthPalette>('viridis');
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<PhotoStudioView>('depth');

  useEffect(() => {
    clientRef.current = new DepthInferenceClient();
    return () => {
      clientRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!result || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(createDepthImageData(result.depth, result.width, result.height, palette), 0, 0);
  }, [palette, result]);

  async function processFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      setStatus('error');
      setMessage('Please choose an image file such as JPEG, PNG, WebP, or AVIF.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus('error');
      setMessage('That image is larger than 20 MB. Please choose a smaller file.');
      return;
    }

    try {
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
        reader.addEventListener('error', () => reject(new Error('The selected image could not be read.')), { once: true });
        reader.readAsDataURL(file);
      });
      await processImageSource(source, file.name);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The photo could not be processed.');
    }
  }

  async function processImageSource(source: string, name: string): Promise<void> {
    setStatus('decoding');
    setMessage('Decoding image…');
    setResult(null);
    setFileName(name);

    try {
      const decodedImage = new Image();
      decodedImage.src = source;
      await decodedImage.decode();
      const pixelCanvas = document.createElement('canvas');
      pixelCanvas.width = decodedImage.naturalWidth;
      pixelCanvas.height = decodedImage.naturalHeight;
      const pixelContext = pixelCanvas.getContext('2d', { willReadFrequently: true });
      if (!pixelContext) throw new Error('The browser could not read the selected image.');
      pixelContext.drawImage(decodedImage, 0, 0);
      const pixels = pixelContext.getImageData(0, 0, pixelCanvas.width, pixelCanvas.height).data;
      setSourceUrl(source);
      setStatus('running');
      setMessage('Starting the inference worker…');

      const depth = await clientRef.current!.estimate(
        pixels,
        pixelCanvas.width,
        pixelCanvas.height,
        preferredBackend,
        (progress) => setMessage(progress),
      );

      setResult(depth);
      setStatus('ready');
      setMessage('Depth estimate ready. Bright colours are nearer to the camera.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The photo could not be processed.');
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void processFile(file);
  }

  async function loadSample(path: string, name: string): Promise<void> {
    setMessage('Loading bundled example…');
    await processImageSource(path, name);
  }

  if (!sourceUrl) {
    return (
      <div className="photo-empty">
        <div className="canvas-topline">
          <span>PHOTO / INPUT</span>
          <span>LOCAL PROCESSING</span>
        </div>
        <div
          className={dragging ? 'drop-zone dragging' : 'drop-zone'}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <div className="drop-icon" aria-hidden="true">↥</div>
          <span>PHOTO INPUT</span>
          <h2>Drop an image to reveal its depth.</h2>
          <p>{message}</p>
          <button className="primary-button compact" onClick={() => inputRef.current?.click()} type="button">
            Choose photo <b>+</b>
          </button>
          <input
            ref={inputRef}
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void processFile(file);
              event.currentTarget.value = '';
            }}
            type="file"
          />
          <small>JPEG · PNG · WEBP · AVIF · MAX 20 MB</small>
        </div>
        <div className="sample-row">
          <span>OR TRY A BUNDLED SCENE</span>
          <button onClick={() => void loadSample('/samples/terrace.png', 'terrace.png')} type="button">Terrace</button>
          <button onClick={() => void loadSample('/samples/studio.png', 'studio.png')} type="button">Studio</button>
        </div>
      </div>
    );
  }

  return (
    <div className="photo-results">
      <div className="result-toolbar">
        <div><small>PHOTO</small><strong>{fileName}</strong></div>
        <div className="palette-control">
          <label htmlFor="photo-view">VIEW</label>
          <select id="photo-view" onChange={(event) => setView(event.target.value as PhotoStudioView)} value={view}>
            <option value="depth">Depth</option>
            <option value="parallax">3D parallax</option>
            <option value="point-cloud">Point cloud</option>
          </select>
        </div>
        <div className="palette-control">
          <label htmlFor="palette">PALETTE</label>
          <select disabled={view !== 'depth'} id="palette" onChange={(event) => setPalette(event.target.value as DepthPalette)} value={palette}>
            <option value="viridis">Viridis</option>
            <option value="turbo">Turbo</option>
            <option value="luma">Greyscale</option>
          </select>
        </div>
        <button className="secondary-button" onClick={() => inputRef.current?.click()} type="button">Replace photo</button>
        <input
          ref={inputRef}
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void processFile(file);
            event.currentTarget.value = '';
          }}
          type="file"
        />
      </div>

      <div className="comparison-grid">
        <figure>
          <figcaption><span>01</span> ORIGINAL</figcaption>
          <img alt={`Uploaded source: ${fileName}`} src={sourceUrl} />
        </figure>
        <figure className="depth-result">
          <figcaption><span>02</span> {view === 'depth' ? 'RELATIVE DEPTH' : view === 'parallax' ? '3D PARALLAX' : 'RELATIVE POINT CLOUD'}</figcaption>
          {status === 'ready' ? <><canvas className={view === 'depth' ? 'photo-depth-canvas active' : 'photo-depth-canvas'} ref={canvasRef} aria-label="Estimated relative depth map" />{result && sourceUrl && <PhotoStudio result={result} sourceUrl={sourceUrl} view={view} />}</> : <div className="processing-plate"><i /><strong>{message}</strong><small>The interface remains responsive while inference runs.</small></div>}
        </figure>
      </div>

      <div className="result-footer">
        <div className={`result-status ${status}`}><i />{message}</div>
        {result && (
          <dl>
            <div><dt>Backend</dt><dd>{result.backend.toUpperCase()}</dd></div>
            <div><dt>Model load</dt><dd>{result.loadMs === 0 ? 'cached' : formatDuration(result.loadMs)}</dd></div>
            <div><dt>Inference</dt><dd>{formatDuration(result.inferenceMs)}</dd></div>
            <div><dt>Depth map</dt><dd>{result.width} × {result.height}</dd></div>
          </dl>
        )}
      </div>
    </div>
  );
}
