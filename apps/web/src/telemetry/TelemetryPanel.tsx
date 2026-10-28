import { useState } from 'react';
import type { TelemetrySnapshot } from './TelemetryStore';

interface TelemetryPanelProps {
  snapshot: TelemetrySnapshot;
}

function milliseconds(value: number): string {
  return value > 0 ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : '—';
}

export function TelemetryPanel({ snapshot }: TelemetryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const recentEvents = snapshot.keyframeEvents.slice(-8).reverse();

  return (
    <section className={expanded ? 'telemetry-panel expanded' : 'telemetry-panel'} aria-label="Live telemetry">
      <div className="telemetry-strip">
        <div><dt>Camera</dt><dd>{snapshot.cameraFps} fps</dd></div>
        <div><dt>Depth display</dt><dd>{snapshot.depthFps} fps</dd></div>
        <div><dt>Inference</dt><dd>{milliseconds(snapshot.latest.inference)}</dd></div>
        <div><dt>Optical flow</dt><dd>{milliseconds(snapshot.latest.flow)}</dd></div>
        <div><dt>Motion</dt><dd>{snapshot.meanMotion.toFixed(2)} px</dd></div>
        <div><dt>Confidence</dt><dd>{Math.round(snapshot.confidenceMean * 100)}%</dd></div>
        <div><dt>Keyframe age</dt><dd>{snapshot.keyframeAge} frames</dd></div>
        <div><dt>Model calls</dt><dd>{snapshot.totalModelCalls}</dd></div>
        <button aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} type="button">{expanded ? 'Close' : 'Details'}</button>
      </div>

      {expanded && (
        <div className="telemetry-details">
          <div className="timing-table">
            <h3>Stage timing</h3>
            <div className="timing-head"><span>Stage</span><span>Latest</span><span>Median</span><span>P95</span></div>
            {(['flow', 'warp', 'fusion', 'inference', 'effect', 'total'] as const).map((stage) => (
              <div className="timing-row" key={stage}><strong>{stage}</strong><span>{milliseconds(snapshot.latest[stage])}</span><span>{milliseconds(snapshot.median[stage])}</span><span>{milliseconds(snapshot.p95[stage])}</span></div>
            ))}
          </div>
          <div className="event-timeline">
            <h3>Recent keyframes</h3>
            {recentEvents.length === 0 ? <p>No model calls yet.</p> : recentEvents.map((event) => (
              <div key={`${event.frameId}-${event.timestamp}`}><i /><span>Frame {event.frameId}</span><strong>{event.reason}</strong><small>{milliseconds(event.inferenceMs)}</small></div>
            ))}
          </div>
          <dl className="telemetry-meta">
            <div><dt>Depth backend</dt><dd>{snapshot.backend.toUpperCase()}</dd></div>
            <div><dt>Flow backend</dt><dd>{snapshot.flowBackend}</dd></div>
            <div><dt>Profile</dt><dd>{snapshot.profile}</dd></div>
            <div><dt>Depth flicker</dt><dd>{snapshot.flickerScore.toFixed(4)}</dd></div>
            <div><dt>Low confidence</dt><dd>{Math.round(snapshot.lowConfidenceFraction * 100)}%</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}
