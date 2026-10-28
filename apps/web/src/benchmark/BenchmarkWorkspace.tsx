import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { InferenceBackend } from '../engine/inference/messages';
import { DepthInferenceClient, type DepthResult } from '../engine/inference/DepthInferenceClient';
import { FlowClient } from '../engine/flow/FlowClient';
import { warpDepth } from '../engine/propagation/warpDepth';

interface BenchmarkWorkspaceProps { preferredBackend: InferenceBackend }

export interface BenchmarkResult {
  interval: number;
  sampledFrames: number;
  modelCalls: number;
  inferredPercent: number;
  processingFps: number;
  meanInferenceMs: number;
  meanFlowMs: number;
  meanDepthJump: number;
  totalMs: number;
}

const FLOW_WIDTH = 160;
const FLOW_HEIGHT = 120;
const INTERVALS = [1, 2, 4, 6, 8];

function toGray(pixels: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(pixels.length / 4);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    gray[target] = Math.round(pixels[source] * 0.299 + pixels[source + 1] * 0.587 + pixels[source + 2] * 0.114);
  }
  return gray;
}

function meanJump(current: Float32Array, previous: Float32Array | null): number {
  if (!previous || previous.length !== current.length) return 0;
  const stride = Math.max(1, Math.floor(current.length / 5000));
  let total = 0;
  let count = 0;
  for (let index = 0; index < current.length; index += stride) { total += Math.abs(current[index] - previous[index]); count += 1; }
  return count ? total / count : 0;
}

export function benchmarkRowsToCsv(results: readonly BenchmarkResult[]): string {
  const header = 'interval,sampled_frames,model_calls,inferred_percent,processing_fps,mean_inference_ms,mean_flow_ms,mean_depth_jump,total_ms';
  const rows = results.map((row) => [row.interval, row.sampledFrames, row.modelCalls, row.inferredPercent, row.processingFps, row.meanInferenceMs, row.meanFlowMs, row.meanDepthJump, row.totalMs].join(','));
  return [header, ...rows].join('\n');
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { video.removeEventListener('seeked', onSeeked); video.removeEventListener('error', onError); };
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('The video could not seek to the requested frame.')); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = time;
  });
}

function download(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function BenchmarkWorkspace({ preferredBackend }: BenchmarkWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureRef = useRef<HTMLCanvasElement | null>(null);
  const flowCaptureRef = useRef<HTMLCanvasElement | null>(null);
  const inferenceRef = useRef<DepthInferenceClient | null>(null);
  const flowRef = useRef<FlowClient | null>(null);
  const cancelRef = useRef(false);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [duration, setDuration] = useState(0);
  const [sampleFrames, setSampleFrames] = useState(6);
  const [intervals, setIntervals] = useState<number[]>([4]);
  const [status, setStatus] = useState<'idle' | 'ready' | 'running' | 'complete' | 'error'>('idle');
  const [message, setMessage] = useState('Choose a short local video. Nothing is uploaded.');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BenchmarkResult[]>([]);

  useEffect(() => {
    inferenceRef.current = new DepthInferenceClient();
    flowRef.current = new FlowClient();
    return () => {
      cancelRef.current = true;
      inferenceRef.current?.dispose();
      flowRef.current?.dispose();
    };
  }, []);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  function chooseVideo(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) { setStatus('error'); setMessage('Please choose a browser-readable video file.'); return; }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setFileName(file.name);
    setResults([]);
    setStatus('ready');
    setMessage('Video loaded. Select intervals and start when ready.');
  }

  function toggleInterval(interval: number): void {
    setIntervals((current) => current.includes(interval) ? current.filter((value) => value !== interval) : [...current, interval].sort((a, b) => a - b));
  }

  async function runBenchmark(): Promise<void> {
    const video = videoRef.current;
    const inference = inferenceRef.current;
    const flowClient = flowRef.current;
    const capture = captureRef.current;
    const flowCapture = flowCaptureRef.current;
    if (!video || !inference || !flowClient || !capture || !flowCapture || !duration || intervals.length === 0) return;
    cancelRef.current = false;
    setStatus('running');
    setResults([]);
    const benchmarkResults: BenchmarkResult[] = [];
    const totalSteps = sampleFrames * intervals.length;
    let completedSteps = 0;

    try {
      for (const interval of intervals) {
        let anchor: { result: DepthResult; gray: Uint8Array } | null = null;
        let previousDepth: Float32Array | null = null;
        let modelCalls = 0;
        let inferenceTotal = 0;
        let flowTotal = 0;
        let flowCalls = 0;
        let jumpTotal = 0;
        const started = performance.now();

        for (let frame = 0; frame < sampleFrames; frame += 1) {
          if (cancelRef.current) throw new Error('Benchmark cancelled.');
          const time = sampleFrames === 1 ? 0 : (duration - Math.min(0.05, duration / 10)) * frame / (sampleFrames - 1);
          await seekVideo(video, time);
          capture.width = video.videoWidth;
          capture.height = video.videoHeight;
          const context = capture.getContext('2d', { willReadFrequently: true });
          const flowContext = flowCapture.getContext('2d', { willReadFrequently: true });
          if (!context || !flowContext) throw new Error('The benchmark canvas is unavailable.');
          context.drawImage(video, 0, 0, capture.width, capture.height);
          flowContext.drawImage(video, 0, 0, FLOW_WIDTH, FLOW_HEIGHT);
          const gray = toGray(flowContext.getImageData(0, 0, FLOW_WIDTH, FLOW_HEIGHT).data);
          let displayedDepth: Float32Array;

          if (!anchor || frame % interval === 0) {
            const pixels = context.getImageData(0, 0, capture.width, capture.height).data;
            const result = await inference.estimate(pixels, capture.width, capture.height, preferredBackend, (update) => setMessage(`Interval ${interval}: ${update}`));
            anchor = { result, gray };
            displayedDepth = result.depth;
            modelCalls += 1;
            inferenceTotal += result.inferenceMs;
          } else {
            const flow = await flowClient.compute(gray, anchor.gray.slice(), FLOW_WIDTH, FLOW_HEIGHT);
            displayedDepth = warpDepth(anchor.result.depth, anchor.result.width, anchor.result.height, flow.flow, flow.confidence, flow.width, flow.height).depth;
            flowTotal += flow.elapsedMs;
            flowCalls += 1;
          }

          jumpTotal += meanJump(displayedDepth, previousDepth);
          previousDepth = displayedDepth.slice();
          completedSteps += 1;
          setProgress(completedSteps / totalSteps);
          setMessage(`Interval ${interval}: sampled frame ${frame + 1} of ${sampleFrames}.`);
        }

        const totalMs = performance.now() - started;
        benchmarkResults.push({
          interval,
          sampledFrames: sampleFrames,
          modelCalls,
          inferredPercent: modelCalls / sampleFrames * 100,
          processingFps: sampleFrames / (totalMs / 1000),
          meanInferenceMs: modelCalls ? inferenceTotal / modelCalls : 0,
          meanFlowMs: flowCalls ? flowTotal / flowCalls : 0,
          meanDepthJump: sampleFrames > 1 ? jumpTotal / (sampleFrames - 1) : 0,
          totalMs,
        });
        setResults([...benchmarkResults]);
      }
      setStatus('complete');
      setMessage('Benchmark complete. Results are ready to export.');
    } catch (error) {
      setStatus(cancelRef.current ? 'ready' : 'error');
      setMessage(error instanceof Error ? error.message : 'The benchmark failed.');
    }
  }

  function exportJson(): void {
    const report = { generatedAt: new Date().toISOString(), fileName, duration, backend: preferredBackend, browser: navigator.userAgent, results };
    download('depthguide-benchmark.json', JSON.stringify(report, null, 2), 'application/json');
  }

  return (
    <div className="benchmark-workspace">
      <div className="benchmark-toolbar"><div><small>DETERMINISTIC BENCHMARK</small><strong>{fileName || 'No video selected'}</strong></div><button className="secondary-button" disabled={status === 'running'} onClick={() => inputRef.current?.click()} type="button">Choose video</button><input accept="video/*" className="sr-only" onChange={chooseVideo} ref={inputRef} type="file" /></div>
      <div className="benchmark-layout">
        <section className="benchmark-preview"><video controls={status !== 'running'} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} ref={videoRef} src={videoUrl ?? undefined} /><div className="benchmark-progress"><i style={{ width: `${progress * 100}%` }} /></div><p>{message}</p></section>
        <aside className="benchmark-config">
          <div><small>SAMPLED FRAMES</small><label><input max="20" min="3" onChange={(event) => setSampleFrames(Number(event.target.value))} type="range" value={sampleFrames} /><output>{sampleFrames}</output></label></div>
          <div><small>KEYFRAME INTERVALS</small><div className="interval-options">{INTERVALS.map((interval) => <label key={interval}><input checked={intervals.includes(interval)} disabled={status === 'running'} onChange={() => toggleInterval(interval)} type="checkbox" />{interval === 1 ? '1 · oracle' : interval}</label>)}</div></div>
          <div className="workload-note"><strong>Expected model calls</strong><span>{intervals.reduce((total, interval) => total + Math.ceil(sampleFrames / interval), 0)}</span><p>Model inference is intentionally expensive. Start with one interval and six frames.</p></div>
          {status === 'running' ? <button className="secondary-button" onClick={() => { cancelRef.current = true; }} type="button">Cancel after current operation</button> : <button className="primary-button compact" disabled={!videoUrl || intervals.length === 0} onClick={() => void runBenchmark()} type="button">Run benchmark <b>→</b></button>}
        </aside>
      </div>
      <div className="benchmark-results">
        <div className="benchmark-result-head"><span>Interval</span><span>Frames</span><span>Model calls</span><span>Inferred</span><span>Processing</span><span>Inference</span><span>Flow</span><span>Depth jump</span></div>
        {results.length === 0 ? <p>No results yet.</p> : results.map((row) => <div className="benchmark-result-row" key={row.interval}><strong>{row.interval}</strong><span>{row.sampledFrames}</span><span>{row.modelCalls}</span><span>{row.inferredPercent.toFixed(0)}%</span><span>{row.processingFps.toFixed(2)} fps</span><span>{row.meanInferenceMs.toFixed(0)} ms</span><span>{row.meanFlowMs.toFixed(0)} ms</span><span>{row.meanDepthJump.toFixed(4)}</span></div>)}
      </div>
      <div className="benchmark-footer"><span>Local processing · relative depth · sampled offline</span><div><button className="secondary-button" disabled={!results.length} onClick={exportJson} type="button">Export JSON</button><button className="secondary-button" disabled={!results.length} onClick={() => download('depthguide-benchmark.csv', benchmarkRowsToCsv(results), 'text/csv')} type="button">Export CSV</button></div></div>
      <canvas className="sr-only" ref={captureRef} /><canvas className="sr-only" height={FLOW_HEIGHT} ref={flowCaptureRef} width={FLOW_WIDTH} />
    </div>
  );
}
