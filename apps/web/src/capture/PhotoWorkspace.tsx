import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient, type DepthResult } from '../engine/inference/DepthInferenceClient';
import { createDepthImageData, type DepthPalette } from '../effects/depthColor';

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
  const objectUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PhotoStatus>('empty');
  const [message, setMessage] = useState('Drop a photo here, or choose one from your computer.');
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [result, setResult] = useState<DepthResult | null>(null);
  const [palette, setPalette] = useState<DepthPalette>('viridis');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    clientRef.current = new DepthInferenceClient();
    return () => {
      clientRef.current?.dispose();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
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

    setStatus('decoding');
    setMessage('Decoding image…');
    setResult(null);
    setFileName(file.name);

    try {
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(file);
      setSourceUrl(objectUrlRef.current);
      setStatus('running');

      const depth = await clientRef.current!.estimate(image, preferredBackend, (progress) => {
        setMessage(progress);
      });

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
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error('The bundled example could not be loaded.');
      const blob = await response.blob();
      await processFile(new File([blob], name, { type: blob.type || 'image/svg+xml' }));
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The bundled example could not be loaded.');
    }
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
          <button onClick={() => void loadSample('/samples/terrace.svg', 'terrace.svg')} type="button">Terrace</button>
          <button onClick={() => void loadSample('/samples/studio.svg', 'studio.svg')} type="button">Studio</button>
        </div>
      </div>
    );
  }

  return (
    <div className="photo-results">
      <div className="result-toolbar">
        <div><small>PHOTO</small><strong>{fileName}</strong></div>
        <div className="palette-control">
          <label htmlFor="palette">PALETTE</label>
          <select id="palette" onChange={(event) => setPalette(event.target.value as DepthPalette)} value={palette}>
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
          <figcaption><span>02</span> RELATIVE DEPTH</figcaption>
          {status === 'ready' ? <canvas ref={canvasRef} aria-label="Estimated relative depth map" /> : <div className="processing-plate"><i /><strong>{message}</strong><small>The interface remains responsive while inference runs.</small></div>}
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
