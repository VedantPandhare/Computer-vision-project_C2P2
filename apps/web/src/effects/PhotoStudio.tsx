import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { DepthResult } from '../engine/inference/DepthInferenceClient';
import { ParallaxRenderer } from './ParallaxRenderer';
import { buildPointCloud, pointCloudToPly, PointCloudRenderer, type PointCloudData } from './PointCloudRenderer';

export type PhotoStudioView = 'depth' | 'parallax' | 'point-cloud';

interface PhotoStudioProps {
  sourceUrl: string;
  result: DepthResult;
  view: PhotoStudioView;
}

function downloadPly(data: PointCloudData): void {
  const url = URL.createObjectURL(new Blob([pointCloudToPly(data)], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.download = 'depthguide-point-cloud.ply';
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function PhotoStudio({ sourceUrl, result, view }: PhotoStudioProps) {
  const parallaxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cloudCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const parallaxRef = useRef<ParallaxRenderer | null>(null);
  const cloudRef = useRef<PointCloudRenderer | null>(null);
  const cloudDataRef = useRef<PointCloudData | null>(null);
  const viewRef = useRef(view);
  const autoOrbitRef = useRef(true);
  const orbitRef = useRef({ x: 0, y: 0, yaw: 0, pitch: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const strengthRef = useRef(0.09);
  const pointSizeRef = useRef(2.5);
  const animationRef = useRef<number | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [strength, setStrength] = useState(0.09);
  const [pointSize, setPointSize] = useState(2.5);
  const [fov, setFov] = useState(55);
  const [stride, setStride] = useState(5);
  const [message, setMessage] = useState('Preparing the 3D view…');

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { autoOrbitRef.current = autoOrbit; }, [autoOrbit]);
  useEffect(() => { strengthRef.current = strength; }, [strength]);
  useEffect(() => { pointSizeRef.current = pointSize; }, [pointSize]);

  useEffect(() => {
    try {
      if (parallaxCanvasRef.current) parallaxRef.current = new ParallaxRenderer(parallaxCanvasRef.current);
      if (cloudCanvasRef.current) cloudRef.current = new PointCloudRenderer(cloudCanvasRef.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The 3D renderer could not start.');
    }
    const animate = (timestamp: number) => {
      if (autoOrbitRef.current) {
        orbitRef.current.x = Math.sin(timestamp / 1800) * 0.75;
        orbitRef.current.y = Math.cos(timestamp / 2400) * 0.3;
        orbitRef.current.yaw = Math.sin(timestamp / 2200) * 0.35;
      }
      if (viewRef.current === 'parallax') parallaxRef.current?.render(orbitRef.current.x, orbitRef.current.y, strengthRef.current);
      if (viewRef.current === 'point-cloud') cloudRef.current?.render(orbitRef.current.yaw, orbitRef.current.pitch, pointSizeRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      parallaxRef.current?.dispose();
      cloudRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const image = new Image();
        image.src = sourceUrl;
        await image.decode();
        if (cancelled) return;
        const source = document.createElement('canvas');
        source.width = result.width;
        source.height = result.height;
        const context = source.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('The source image could not be prepared for 3D.');
        context.drawImage(image, 0, 0, result.width, result.height);
        const rgba = context.getImageData(0, 0, result.width, result.height).data;
        parallaxRef.current?.setScene(image, image.naturalWidth, image.naturalHeight, result.depth, result.width, result.height);
        const cloud = buildPointCloud(result.depth, result.width, result.height, rgba, stride, fov);
        cloudDataRef.current = cloud;
        cloudRef.current?.setData(cloud, image.naturalWidth, image.naturalHeight);
        setMessage(`${cloud.count.toLocaleString()} relative 3D points`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'The 3D scene could not be prepared.');
      }
    })();
    return () => { cancelled = true; };
  }, [fov, result, sourceUrl, stride]);

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    autoOrbitRef.current = false;
    setAutoOrbit(false);
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    orbitRef.current.x = Math.max(-1, Math.min(1, orbitRef.current.x + dx / 180));
    orbitRef.current.y = Math.max(-1, Math.min(1, orbitRef.current.y - dy / 180));
    orbitRef.current.yaw += dx / 180;
    orbitRef.current.pitch = Math.max(-0.7, Math.min(0.7, orbitRef.current.pitch + dy / 220));
  }

  return (
    <div className="photo-studio" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragRef.current = null; }}>
      <canvas className={view === 'parallax' ? 'studio-canvas active' : 'studio-canvas'} ref={parallaxCanvasRef} />
      <canvas className={view === 'point-cloud' ? 'studio-canvas active' : 'studio-canvas'} ref={cloudCanvasRef} />
      {view !== 'depth' && <div className="studio-controls" onPointerDown={(event) => event.stopPropagation()}>
        {view === 'parallax' ? <label>DEPTH STRENGTH<input max="0.18" min="0.02" onChange={(event) => setStrength(Number(event.target.value))} step="0.01" type="range" value={strength} /></label> : <><label>FIELD OF VIEW<input max="90" min="30" onChange={(event) => setFov(Number(event.target.value))} step="5" type="range" value={fov} /></label><label>POINT SIZE<input max="6" min="1" onChange={(event) => setPointSize(Number(event.target.value))} step="0.5" type="range" value={pointSize} /></label><label>DETAIL<input max="10" min="3" onChange={(event) => setStride(Number(event.target.value))} step="1" type="range" value={stride} /></label></>}
        <label className="studio-check"><input checked={autoOrbit} onChange={(event) => setAutoOrbit(event.target.checked)} type="checkbox" /> AUTO ORBIT</label>
        {view === 'point-cloud' && <button className="secondary-button" disabled={!cloudDataRef.current} onClick={() => { if (cloudDataRef.current) downloadPly(cloudDataRef.current); }} type="button">Export PLY</button>}
      </div>}
      {view !== 'depth' && <span className="studio-hint">{message} · drag to orbit · relative scale</span>}
    </div>
  );
}
