const LIMITATIONS = [
  ['Relative, not metric', 'The numbers describe near-to-far ordering. They are not metres and cannot measure real-world distance.'],
  ['Difficult materials', 'Glass, mirrors, reflective metal, thin objects and textureless surfaces can produce incorrect depth.'],
  ['Lighting and motion', 'Low light, fast camera movement and newly revealed areas reduce optical-flow confidence.'],
  ['Not a safety system', 'DepthGuide must not be used for mobility, navigation or any other safety-critical decision.'],
] as const;

export function AboutWorkspace() {
  return (
    <div className="about-workspace">
      <section className="about-intro"><div><small>ABOUT DEPTHGUIDE</small><h2>A browser application that estimates how a scene is layered in depth.</h2><p>It combines a pretrained monocular depth model with classical optical flow. The model creates accurate anchor frames; optical flow moves those depth values with the scene between expensive model calls.</p></div><div className="about-badge"><span>LOCAL-FIRST</span><strong>Frames stay on your device</strong><small>No camera image or telemetry is uploaded by this application.</small></div></section>

      <section className="about-pipeline"><article><span>01</span><strong>Capture</strong><p>Read a camera, photo or local video inside the browser.</p></article><i>→</i><article><span>02</span><strong>Estimate</strong><p>A pretrained Depth Anything V2 Small graph predicts relative inverse depth.</p></article><i>→</i><article><span>03</span><strong>Propagate</strong><p>Farneback flow tracks the anchor depth through later frames.</p></article><i>→</i><article><span>04</span><strong>Create</strong><p>Confidence-aware depth drives colour, bokeh and fog effects.</p></article></section>

      <section className="about-section"><div className="about-heading"><small>HONEST LIMITS</small><h3>What the result does—and does not—mean</h3></div><div className="limitation-grid">{LIMITATIONS.map(([title, detail], index) => <article key={title}><span>0{index + 1}</span><strong>{title}</strong><p>{detail}</p></article>)}</div></section>

      <section className="about-columns">
        <article><small>PROJECT SCOPE</small><h3>Application engineering, not model research</h3><ul><li>Uses an existing pretrained model.</li><li>No training or fine-tuning.</li><li>No model-compression objective.</li><li>No edge-hardware deployment target.</li><li>No face, hand or body analysis.</li></ul></article>
        <article><small>EXPLAINABILITY</small><h3>Attention is only one partial view</h3><p>Inspect mode will show transformer attention only after the separate explain graph matches reference outputs. Attention does not prove why the model made a prediction, and a colourful heatmap must not be treated as a complete explanation.</p></article>
        <article><small>EXTENSION POINT</small><h3>Future features stay outside the engine</h3><p>A typed plug-in registry receives RGB, depth, confidence and read-only telemetry. New visual applications can produce overlays and messages without changing inference, flow or fusion.</p></article>
      </section>

      <section className="attribution-section"><div className="about-heading"><small>CORE ATTRIBUTION</small><h3>Models and browser libraries</h3></div><dl><div><dt>Depth model</dt><dd>Depth Anything V2 Small · Apache-2.0</dd></div><div><dt>Inference runtime</dt><dd>ONNX Runtime Web · MIT</dd></div><div><dt>Optical flow</dt><dd>OpenCV.js / Farneback · Apache-2.0</dd></div><div><dt>Interface</dt><dd>React, TypeScript and Vite</dd></div></dl><p>Before public release, the repository will include the exact dependency versions, model source, licence texts and any sample-media attribution.</p></section>

      <aside className="safety-banner"><strong>Responsible-use notice</strong><p>Depth is estimated, not measured. Failures can be silent. This application is a visual demonstration and creative tool—not a safety device.</p></aside>
    </div>
  );
}
