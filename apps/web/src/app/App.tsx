import { useEffect, useMemo, useState } from 'react';
import { choosePreferredBackend, detectCapabilities } from './capabilities';
import type { AppMode, CapabilityReport, FeasibilityResult } from './types';
import { MODEL_CONFIG } from '../engine/inference/modelConfig';
import { runFeasibilityProbe } from '../engine/inference/runFeasibilityProbe';
import { PhotoWorkspace } from '../capture/PhotoWorkspace';
import { LiveWorkspace } from '../capture/LiveWorkspace';
import { CompareWorkspace } from '../compare/CompareWorkspace';
import { InspectWorkspace } from '../inspect/InspectWorkspace';
import { BenchmarkWorkspace } from '../benchmark/BenchmarkWorkspace';
import { AboutWorkspace } from '../about/AboutWorkspace';

const MODES: AppMode[] = ['Live', 'Photo', 'Inspect', 'Compare', 'Benchmark', 'About'];

const initialCapabilities: CapabilityReport = {
  webgpu: { label: 'WebGPU', state: 'checking', detail: 'Checking GPU support…' },
  wasm: { label: 'WebAssembly', state: 'checking', detail: 'Checking CPU fallback…' },
  camera: { label: 'Camera API', state: 'checking', detail: 'Checking media support…' },
  isolation: { label: 'Worker isolation', state: 'checking', detail: 'Checking security headers…' },
};

function formatDuration(value?: number): string {
  if (value === undefined) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export function App() {
  const [mode, setMode] = useState<AppMode>('Live');
  const [capabilities, setCapabilities] = useState<CapabilityReport>(initialCapabilities);
  const [probe, setProbe] = useState<FeasibilityResult>({
    status: 'idle',
    message: 'Run this once to prove the full browser model can load and return a depth tensor.',
  });

  useEffect(() => {
    void detectCapabilities().then(setCapabilities);
  }, []);

  const preferredBackend = choosePreferredBackend(capabilities);
  const capabilityList = useMemo(() => Object.values(capabilities), [capabilities]);

  async function handleProbe(): Promise<void> {
    setProbe({ status: 'loading', message: 'Preparing the inference worker…' });
    const result = await runFeasibilityProbe(preferredBackend, (message) => {
      setProbe({ status: 'running', message });
    });
    setProbe(result);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DepthGuide home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>DepthGuide</span>
          <small>RELATIVE DEPTH LAB</small>
        </a>

        <nav className="mode-tabs" aria-label="Application modes">
          {MODES.map((item) => (
            <button
              className={mode === item ? 'mode-tab active' : 'mode-tab'}
              key={item}
              onClick={() => setMode(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="backend-chip">
          <span className={preferredBackend === 'webgpu' ? 'pulse-dot' : 'pulse-dot amber'} />
          {preferredBackend.toUpperCase()}
          <b>BASE</b>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="eyebrow"><span /> STEP 01 · FOUNDATION</div>
          <h1>See the space<br /><em>inside an image.</em></h1>
          <p>
            One camera. One pretrained model. A live relative-depth stream that stays private in
            your browser.
          </p>
          <div className="hero-actions">
            <button
              className="primary-button"
              disabled={probe.status === 'loading' || probe.status === 'running'}
              onClick={() => void handleProbe()}
              type="button"
            >
              {probe.status === 'loading' || probe.status === 'running'
                ? 'Checking model…'
                : 'Run model check'}
              <span aria-hidden="true">↗</span>
            </button>
            <div className="privacy-note">
              <span>●</span>
              Camera frames stay on this device
            </div>
          </div>
        </section>

        <section className={mode === 'Photo' ? 'workspace photo-mode' : mode === 'Live' ? 'workspace live-mode' : mode === 'Compare' ? 'workspace compare-mode' : mode === 'Inspect' ? 'workspace inspect-mode' : mode === 'Benchmark' ? 'workspace benchmark-mode' : mode === 'About' ? 'workspace about-mode' : 'workspace'} aria-label={`${mode} workspace`}>
          <div className="canvas-card">
            {mode === 'Live' ? (
              <LiveWorkspace preferredBackend={preferredBackend} />
            ) : mode === 'Photo' ? (
              <PhotoWorkspace preferredBackend={preferredBackend} />
            ) : mode === 'Compare' ? (
              <CompareWorkspace preferredBackend={preferredBackend} />
            ) : mode === 'Inspect' ? (
              <InspectWorkspace preferredBackend={preferredBackend} />
            ) : mode === 'Benchmark' ? (
              <BenchmarkWorkspace preferredBackend={preferredBackend} />
            ) : mode === 'About' ? (
              <AboutWorkspace />
            ) : (
              <>
                <div className="canvas-topline">
                  <span>MODE / PREVIEW</span>
                  <span>DEPTH 0.00—1.00</span>
                </div>
                <div className="depth-stage">
                  <div className="depth-orb far" />
                  <div className="depth-orb middle" />
                  <div className="depth-orb near" />
                  <div className="depth-grid" />
                  <div className="stage-label label-far">FAR</div>
                  <div className="stage-label label-near">NEAR</div>
                  <div className="stage-copy">
                    <span>INPUT WAITING</span>
                    <strong>Mode foundation is ready.</strong>
                    <small>This mode will be activated in a later step.</small>
                  </div>
                </div>
                <div className="depth-scale" aria-label="Depth scale from far to near">
                  <span>FAR · 0</span><i /><span>1 · NEAR</span>
                </div>
              </>
            )}
          </div>

          <aside className="side-panel">
            <div className="panel-heading">
              <span>01</span>
              <div><small>SYSTEM</small><h2>Readiness</h2></div>
            </div>

            <div className="capability-list">
              {capabilityList.map((capability) => (
                <div className="capability-row" key={capability.label}>
                  <span className={`state-dot ${capability.state}`} />
                  <div><strong>{capability.label}</strong><small>{capability.detail}</small></div>
                </div>
              ))}
            </div>

            <div className={`probe-card ${probe.status}`}>
              <div className="probe-title">
                <span>MODEL FEASIBILITY</span>
                <b>{probe.status.toUpperCase()}</b>
              </div>
              <p>{probe.message}</p>
              <dl>
                <div><dt>Model</dt><dd>{MODEL_CONFIG.label}</dd></div>
                <div><dt>Runtime</dt><dd>{probe.backend?.toUpperCase() ?? preferredBackend.toUpperCase()}</dd></div>
                <div><dt>Load</dt><dd>{formatDuration(probe.loadMs)}</dd></div>
                <div><dt>Inference</dt><dd>{formatDuration(probe.inferenceMs)}</dd></div>
                <div><dt>Output</dt><dd>{probe.outputShape?.join(' × ') ?? '—'}</dd></div>
              </dl>
            </div>

            <div className="scope-note">
              <span>APPLICATION SCOPE</span>
              <p>Pretrained model, no training, no model compression, and no edge-device target.</p>
            </div>
          </aside>
        </section>

        <section className="pipeline-strip" aria-label="DepthGuide pipeline">
          <article><span>01</span><div><small>CAPTURE</small><strong>Camera or photo</strong></div></article>
          <i>→</i>
          <article><span>02</span><div><small>ESTIMATE</small><strong>Relative depth</strong></div></article>
          <i>→</i>
          <article><span>03</span><div><small>PROPAGATE</small><strong>Follow movement</strong></div></article>
          <i>→</i>
          <article><span>04</span><div><small>CREATE</small><strong>Depth effects</strong></div></article>
        </section>
      </main>

      <footer>
        <span>DEPTHGUIDE / LOCAL-FIRST COMPUTER VISION</span>
        <span>DEPTH IS ESTIMATED · NOT METRIC</span>
      </footer>
    </div>
  );
}
