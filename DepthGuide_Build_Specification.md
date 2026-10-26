# DepthGuide: Technical Specification and Build Brief

**Audience:** the coding agent that will build this application.
**Format of this document:** requirements, methods, architecture and acceptance criteria. It deliberately contains **no source code**. Choose idiomatic implementations that satisfy the specification.

**Working title:** DepthGuide, a real-time, explainable monocular depth engine with keyframe and optical-flow orchestration, running entirely in the browser.

---

## 0. How to Use This Document

- Requirements are tagged **P0** (must ship), **P1** (should ship), **P2** (stretch). Build in that order.
- Requirement IDs (FR-x, NFR-x) are referenced by the milestones and the test plan.
- Section 17 lists **feasibility spikes** that must be run first, because several choices depend on whether specific browser and library capabilities actually work. If a spike fails, use the fallback stated next to it and note the decision in a decision log.
- Anything marked **"verify"** is a fact the author could not confirm and may have changed (library APIs, model IDs, hosting features). Confirm it against current documentation before relying on it.
- Targets in this document are **hypotheses to validate by measurement**, not guarantees.

---

## 1. Project Summary

DepthGuide estimates a per-pixel depth map from an ordinary single camera, in real time, on consumer hardware with no dedicated GPU, and makes the process visible.

It has three pillars:

1. **Orchestration (primary technical contribution).** The depth neural network is expensive, so it is run only on *keyframes*. For every frame in between, the previous depth map is *propagated* using dense optical flow. A scheduler decides when a new keyframe is needed. This multiplies effective depth refresh rate, reduces frame-to-frame flicker, and lets the system adapt to the device.
2. **Explainability.** A freeze-frame inspection mode visualises what the depth model's transformer encoder attends to (attention rollout, click-to-query attention, per-layer and per-head views, and a feature-PCA view).
3. **Showcase application layer (Studio).** Depth-driven creative effects: cinematic bokeh with tap-to-refocus, depth fog, 3D parallax, and a live 3D point cloud viewer.

The whole system runs **client-side in the browser** (TypeScript, WebGPU, WebAssembly), so it can be hosted free as a static Hugging Face Space, costs nothing to scale, and keeps camera frames on the user's device.

> Scope note: only the effects named in Section 4.5 are in scope. Other depth applications (relighting, physics, navigation) are deliberately excluded now. The architecture provides hooks for them (Section 13).

---

## 2. Goals and Non-Goals

### 2.1 Primary goals (in priority order)

| ID | Goal | Success indicator |
|---|---|---|
| **G1** | Deliver smooth real-time depth-driven visuals on a laptop **without a dedicated GPU** by decoupling model inference rate from display rate | Render loop holds near the camera frame rate while the depth model runs at a much lower rate; measured effective-FPS gain vs. running the model on every frame |
| **G2** | Make the keyframe + optical-flow orchestration robust and *observable* | Scheduler triggers sensibly (fixed interval, scene change, motion, low flow confidence); a live telemetry view shows every decision |
| **G3** | Provide an explainability mode for the depth model's encoder | Rollout, click-to-query, layer/head selection and feature-PCA views work on a frozen frame |
| **G4** | Provide visually convincing depth-driven effects as the showcase | Bokeh with tap-to-refocus, fog, parallax and point cloud run live on the propagated depth |
| **G5** | Zero-cost, privacy-preserving deployment | Public static Hugging Face Space; no frames sent to any server |
| **G6** | Leave clean extension points for a later navigation module | A plug-in interface consumes the depth + confidence stream without engine changes |

### 2.2 Non-goals (state these in the About page)

- Metric (real-metre) depth. Output is **relative inverse depth** (see Section 3).
- Training or fine-tuning depth models.
- Multi-frame 3D reconstruction or SLAM. The point cloud is single-view.
- Any safety-critical or assistive-navigation claim.
- Face, hand or body analysis features.
- Mobile-native apps (mobile *browsers* are a P2 compatibility target).

---

## 3. Key Concepts the Agent Must Respect

- **Relative inverse depth (disparity).** The model returns values where **larger means nearer**, correct only up to an unknown per-image scale and shift. All internal depth maps use one convention: floating-point, normalised to the range 0 to 1, **1 = nearest**. Every module must document and preserve this.
- **Keyframe.** A frame on which the full depth network is run.
- **Propagated frame.** A frame whose depth is derived by warping an earlier depth map with optical flow.
- **Anchor.** The keyframe whose depth (and source image) the current propagated depth is derived from.
- **Latency compensation.** Network inference takes longer than one frame period. When a keyframe result arrives, the live frame has already advanced, so the result must be re-aligned to the *current* frame before use.
- **Flow confidence.** A per-pixel reliability estimate for the flow, used to decide how much to trust warped depth.
- **Patch grid.** The encoder (DINOv2-style Vision Transformer, patch size 14) splits the input into a grid of 14×14-pixel patches. Attention is defined over the patch tokens plus one global (CLS) token.

---

## 4. Functional Requirements

### 4.1 Input and capture
- **FR-1 (P0)** Live camera input via the browser camera API, with device selection and resolution request (target about 640×480 capture).
- **FR-2 (P0)** Still-image input by upload or drag-and-drop, plus a small bundled gallery of example images.
- **FR-3 (P1)** Video-file input for deterministic benchmarking and demonstration (same frames every run).
- **FR-4 (P1)** Record a short camera clip (about 10 seconds) into memory for replay through the benchmark harness.

### 4.2 Depth engine (the core)
- **FR-5 (P0)** Depth estimation using Depth Anything V2 Small, exported to ONNX and run in the browser (Section 6.1).
- **FR-6 (P0)** Keyframe scheduler with fixed interval and scene-change triggers (Section 6.3).
- **FR-7 (P0)** Dense optical flow between frames, computed at reduced resolution (Section 6.4).
- **FR-8 (P0)** Depth propagation by flow-based warping with latency compensation (Section 6.5).
- **FR-9 (P0)** A flow-confidence map and occlusion handling (Section 6.6).
- **FR-10 (P0)** Keyframe fusion with scale-and-shift alignment and a stable normalisation scheme so depth does not "pop" at keyframes (Section 6.7).
- **FR-11 (P1)** Adaptive keyframe interval driven by motion and confidence (Section 6.3).
- **FR-12 (P1)** Selectable quality profiles (Fast / Balanced / Quality) that change model input size and flow resolution.
- **FR-13 (P2)** Edge-aware refinement of the propagated depth using the current RGB frame as guidance (Section 6.8).
- **FR-14 (P2)** Automatic controller that selects a profile and interval to hold a target FPS on the current device.

### 4.3 Explainability (Inspect mode)
- **FR-15 (P0)** "Inspect" freezes the current frame and runs a special model variant that also returns encoder attention data (Section 6.10).
- **FR-16 (P0)** Attention-rollout heatmap overlaid on the frame.
- **FR-17 (P0)** Click-to-query: clicking a point shows where that patch attends.
- **FR-18 (P1)** Layer selector and head selector (single head or head-averaged); a grid view comparing layers or heads.
- **FR-19 (P1)** Feature-PCA view: encoder tokens reduced to three components and shown as an RGB map.
- **FR-20 (P1)** Side-by-side view with the depth map, plus an always-visible interpretation note explaining the limits of attention maps.

### 4.4 Telemetry and benchmarking
- **FR-21 (P0)** Live telemetry overlay and panel (Section 6.11).
- **FR-22 (P0)** **A/B comparison mode:** naive per-frame inference vs. DepthGuide propagation, same input, side by side.
- **FR-23 (P1)** Benchmark harness on recorded or uploaded video that exports a results file (JSON and CSV) with the metrics in Section 11.
- **FR-24 (P1)** Settings panel exposing key parameters (interval, thresholds, flow resolution, smoothing) with presets and a reset.

### 4.5 Studio effects (consume the propagated depth live, or a single depth map on stills)
- **FR-25 (P0)** Depth colourmap view with selectable palettes, and an optional confidence overlay.
- **FR-26 (P0)** **Cinematic bokeh:** depth-driven variable blur, adjustable focus depth and aperture, with **tap-to-refocus** (click sets focus to the depth at that pixel) and an animated focus transition.
- **FR-27 (P1)** Depth fog/atmosphere: blend toward a fog colour with distance, adjustable density and colour.
- **FR-28 (P1)** 3D parallax: the image rendered as a depth-displaced surface viewed from a virtual camera that the user orbits with pointer or arrow keys, with an auto-orbit mode. Export as a short looping video or GIF.
- **FR-29 (P1)** Live 3D point cloud: back-projection with an adjustable assumed field of view, point size and depth range, orbit controls, and export as a PLY file.
- **FR-30 (P2)** Rack-focus preset animations and a fog-plus-bokeh "cinematic" preset.

### 4.6 Application shell
- **FR-31 (P0)** Modes: Live, Photo, Inspect, Compare (A/B), Benchmark, About.
- **FR-32 (P0)** Capability detection at start-up (WebGPU, WebAssembly threads, camera access, cross-origin isolation) with a clear status panel and graceful fallback messages.
- **FR-33 (P0)** First-run model download with a progress bar, then local caching so repeat visits start fast.
- **FR-34 (P1)** Keyboard shortcuts, responsive layout, light and dark themes, and an accessibility pass (labels, focus order, contrast, reduced-motion respect).

---

## 5. System Architecture

### 5.1 Concurrency model
The browser main thread must stay free for rendering and UI. Work is split into isolated workers communicating by message passing with transferable buffers:

| Unit | Responsibility |
|---|---|
| **Main thread** | UI, camera capture, frame clock, GPU rendering of effects, telemetry display |
| **Inference worker** | Loads and runs the depth model (WebGPU, with WebAssembly fallback). Handles depth requests and explain requests |
| **Flow worker** | Computes optical flow and confidence on downscaled frames (and applies warping if done on the CPU side) |
| **Scheduler (logic on the main thread)** | Decides keyframes, manages the anchor, buffers, and in-flight requests |

Design principle: **the display loop never waits for the model.** Rendering always uses the best available depth for the current frame, and keyframe results are folded in whenever they arrive.

### 5.2 Data flow (live mode)

```
 Camera frame t
      │
      ├─► downscale ─► Flow worker ─► flow(t→anchor) + confidence
      │                                        │
      │                              Warp anchor depth to frame t
      │                                        │
      │      ┌──────────────────────────► propagated depth D_t (+ confidence C_t)
      │      │                                 │
      ├─► Keyframe scheduler ──(trigger)──► Inference worker ──► new depth for frame t_k
      │      ▲                                                          │
      │      └── telemetry, motion, confidence                          │
      │                                                                 ▼
      │                                  latency compensation + scale/shift alignment
      │                                  + fusion ─► becomes new anchor state
      │
      └─► Effects renderer (bokeh / fog / parallax / point cloud) using RGB frame t + D_t
                                   │
                              Display + telemetry overlay
```

### 5.3 Core data contracts (conceptual)
- **Frame:** RGB image data, a monotonically increasing frame ID, and a capture timestamp.
- **DepthMap:** single-channel float array (0 to 1, 1 = near), width, height, and the frame ID it corresponds to.
- **ConfidenceMap:** single-channel float array (0 to 1) aligned with a DepthMap.
- **FlowField:** two-channel float array (horizontal and vertical displacement in pixels) at flow resolution, with the direction convention documented (current frame → reference frame, used for backward sampling).
- **KeyframeRecord:** the source RGB frame (downscaled copy), its DepthMap, its frame ID and timestamp. At least the current anchor record must be retained.
- **Telemetry event:** type, timestamp, frame ID, and numeric payload.

### 5.4 Memory and transfer rules
- Reuse preallocated buffers and avoid per-frame allocations.
- Use transferable objects when passing frames between threads. Use shared memory only if cross-origin isolation is available.
- Keep GPU-resident textures for the renderer. Upload depth as a texture whenever it changes.

---

## 6. Methodology

### 6.1 Depth model and ONNX export (one-time offline step, done in Python)
- **Model:** Depth Anything V2 **Small** (about 25M parameters, Apache-2.0). The larger variants are non-commercial-licensed and are out of scope unless the user opts in.
- **Why export:** the browser runtime consumes ONNX. Produce and host **two graph variants**:
  1. **Inference variant (default):** input preprocessed RGB tensor, output depth map. Optimised graph, no attention outputs.
  2. **Explain variant:** same weights, exported with **explicit (non-fused) attention** so attention probabilities exist as real tensors, and with extra outputs (Section 6.10).
- **Input profiles:** several fixed, **aspect-preserving** shapes whose sides are multiples of 14 (for example Fast about 18×14 patches, Balanced about 22×17, Quality about 26×20; tune from measurements). Fixed shapes are preferred for WebGPU compatibility and speed; export one graph per profile.
- **Precision variants:** FP16 for the WebGPU path (verify numerical stability, since transformers can misbehave in FP16, and fall back to FP32 if outputs are wrong) and INT8 or dynamic quantisation for the WebAssembly path.
- **Validation:** compare exported-graph outputs against the original PyTorch model on a fixed set of images. Record the maximum error in the decision log. Do not ship a variant that visibly degrades depth.
- **Hosting:** upload exported graphs to a Hugging Face **model repository** (free). The app downloads them at runtime and caches them locally.

### 6.2 Preprocessing
- Resize the frame to the profile's shape with high-quality interpolation, convert to float, and apply the model's mean and standard-deviation normalisation (ImageNet statistics). Do this on the GPU or in the worker, not on the main thread.
- Maintain a **separate low-resolution grayscale copy** of each frame for optical flow (Section 6.4).
- After inference, resize the depth output back to the display resolution (bilinear or bicubic) and normalise (Section 6.7).

### 6.3 Keyframe scheduler

**Purpose:** decide, for every frame, whether to request a new model inference.

**Inputs per frame:** frame ID, current keyframe age (frames since anchor), mean flow magnitude, fraction of low-confidence pixels, frame-difference or histogram-change score, whether an inference is already in flight, recent inference latency.

**Triggers (any one requests a keyframe, subject to "no request already in flight"):**
1. **Interval:** keyframe age reaches the current interval (default 5; allowed range 2 to 8).
2. **Motion:** mean (or high-percentile) flow magnitude exceeds a threshold, meaning the camera or scene moved a lot.
3. **Low confidence:** fraction of pixels failing the flow consistency check exceeds a threshold.
4. **Scene change or exposure jump:** large global change in frame difference or colour histogram (cut, lighting change, auto-exposure shift).
5. **Manual:** user presses a refresh control (useful for demos).

**Adaptive interval (P1):** shorten the interval when motion is high or confidence is low, and lengthen it when the scene is static. Clamp to the allowed range. Add hysteresis so the interval does not oscillate.

**Rules:**
- At most one inference in flight. If a trigger fires while busy, mark a "pending" flag and fire when the worker is free, using the *newest* frame at that time.
- Never block the render loop.
- Log every trigger with its reason as a telemetry event.
- All thresholds are configurable and defaults are tuned empirically on recorded clips. Do not hard-code magic numbers without recording how they were chosen.

### 6.4 Optical flow module

**Role:** estimate dense motion between the current frame and the anchor (or previous) frame.

**Implementation options (build behind one interface so they are swappable):**
- **Option A (baseline, P0): OpenCV.js** compiled to WebAssembly, running in the flow worker. Use a dense classical algorithm: **Farneback** as the baseline, and **DIS (Dense Inverse Search)** if the build exposes it (verify). Use a *custom, trimmed* OpenCV.js build containing only the needed modules to keep download size small, if feasible.
- **Option B (optimisation, P1/P2): GPU flow** implemented in WebGPU compute shaders (or WebGL2 fragment shaders as a fallback): a coarse-to-fine pyramidal method (Lucas-Kanade or Horn-Schunck style) with warm starting. This should be faster than the WebAssembly route and is a strong engineering differentiator, but it is more work. Only attempt after Option A is working end-to-end and benchmarked.

**Settings:**
- Compute flow at **reduced resolution** (default about 160×120 to 240×180) on grayscale, then upsample the flow field to depth resolution, scaling the displacement values by the same factor.
- **Warm start:** initialise each flow computation from the previous frame's flow to improve convergence and temporal smoothness (OpenCV's Farneback supports an initial-flow option; verify for the exposed build).
- Use a pyramid with enough levels to handle expected inter-frame motion for an interval of up to 8 frames.

**Confidence from flow (used in 6.6):** prefer **forward-backward consistency** (compute flow in both directions and measure disagreement). If the cost is too high, use a cheaper proxy: photometric warping error (difference between the current frame and the anchor frame warped by the flow), optionally combined with local flow gradient magnitude.

### 6.5 Depth propagation (warping)

**Anchored mode (default):**
- Compute flow from the **current frame to the anchor frame** (so each output pixel knows where to sample in the anchor).
- Produce the current depth by **backward warping** the anchor depth with that flow (bilinear sampling).
- Benefits: no error accumulation across frames and no repeated resampling blur, because depth is always sampled once from the original keyframe depth. Using a keyframe interval of at most 8 limits the displacement magnitudes the flow must handle.

**Chained mode (alternative, for ablation):**
- Compute flow between consecutive frames and warp the previous propagated depth. Cheaper flow per step but accumulates blur and drift.

**Both modes must be implemented and selectable**, because comparing them is an evaluation item (Section 11).

**Latency compensation (required):**
- When a keyframe is requested for frame *t_k*, retain that frame's downscaled image and the frame ID.
- Keyframe inference returns some frames later (current frame *t_now* > *t_k*). Do **not** display the stale result directly.
- Instead, treat frame *t_k* as the new anchor candidate, compute flow from the current frame to *t_k*, and warp the new depth to *t_now*. This makes fresh model output immediately usable.
- Until the new result arrives, continue propagating from the previous anchor.

**Border handling:** where the flow points outside the image, clamp to the nearest valid sample and set confidence to a low value.

### 6.6 Confidence and occlusion handling
- Per-pixel confidence (0 to 1) combines: forward-backward consistency, photometric warping error, out-of-bounds flag, and optionally flow-gradient magnitude.
- Low-confidence regions occur at **disocclusions** (newly revealed regions), fast motion, and texture-less areas.
- **Fallback policy for low-confidence pixels:** blend toward the previous output depth (temporal hold) rather than toward the warped value, so no holes or garbage appear. If a region stays low-confidence for several frames, it feeds into the keyframe trigger (Section 6.3, trigger 3).
- Expose confidence to the renderer, so effects can soften artefacts, and to the telemetry overlay as a viewable map.

### 6.7 Keyframe fusion and normalisation (prevents "popping")

Raw model outputs differ in scale and shift between keyframes (and per-frame min-max normalisation makes values change when objects enter or leave). To avoid visible jumps:

1. **Stable normalisation:** do not min-max each frame independently. Normalise using **running robust percentiles** (for example low and high percentiles smoothed over time with exponential averaging), so the mapping to 0..1 changes slowly.
2. **Scale-and-shift alignment at keyframes:** when a new keyframe depth arrives (and has been latency-compensated to the live frame), fit a **robust affine map** (least squares with outlier rejection, weighted by confidence) that aligns the new depth to the **currently displayed propagated depth** over high-confidence pixels. Apply it so the new depth continues smoothly from what the user was seeing.
3. **Blend, don't switch:** cross-fade from the old propagated depth to the aligned new depth over a short window (a few frames), with the blend weight also modulated by per-pixel confidence. Where the old propagated depth was unreliable, favour the new keyframe depth.
4. **Light temporal smoothing:** optional exponential smoothing of the final depth with a strength that is reduced where motion is high (to avoid ghosting).

### 6.8 Optional edge refinement (P2)
Because warped and upsampled depth is soft at object boundaries, apply an **edge-aware refinement** (guided filter or joint bilateral filter on the GPU) using the **current RGB frame** as the guide. This re-sharpens depth edges every frame at modest cost and directly reduces halo artefacts in bokeh and parallax. Make it a toggle, and measure its cost.

### 6.9 Effects (Studio)

All effects read the RGB frame, the depth map, and optionally the confidence map, and run on the GPU.

- **Bokeh (depth of field):** compute a per-pixel circle of confusion from the difference between pixel depth and the focus depth, scaled by aperture. Render with a **depth-aware gather blur** (sample a disc pattern; weight samples so that sharp foreground does not bleed into blurred background, and avoid sharp-over-blur halos). Use a small number of samples with a pass structure that fits the frame-time budget. Add optional highlight emphasis for a cinematic look. **Tap-to-refocus** reads the depth at the clicked position (averaging a small neighbourhood for robustness) and animates the focus depth toward it.
- **Fog:** exponential or linear blend toward a fog colour as a function of distance (far = lower depth value).
- **Parallax:** build a regular mesh covering the image and displace it by depth along the viewing axis, drawn with the RGB frame as the texture. Orbit the virtual camera by a small angle. Mitigate rubber-sheet stretching at depth discontinuities by discarding or fading triangles whose depth difference is large, and by limiting the maximum orbit angle. For stills, offer video export of an automatic orbit.
- **Point cloud:** back-project each pixel (sampled with a stride) into 3D using an assumed pinhole camera with an adjustable field of view and a mapped pseudo-distance range, coloured from the RGB frame. Render as points with size attenuation. State in the UI that scale is relative. Provide PLY export.
- **Depth view:** perceptually uniform colour maps and a legend ("near" to "far").

### 6.10 Explainability module (Inspect mode)

**Trigger and scope:** only on a **frozen frame** (Inspect button or a still image). It is never part of the live loop.

**Explain-variant outputs (from the export in 6.1):**
- The depth map.
- **Attention tensors** over the encoder's patch grid plus the global token: for every encoder layer, a **head-averaged** attention matrix; and for a configurable subset of layers (at least the last layer), **per-head** matrices. Note that storing all layers and heads in full precision is large (tens of megabytes), so head-averaged-for-all-layers plus per-head-for-few-layers is the specified compromise. Document the final choice and the measured size.
- The **final encoder tokens** (for the PCA view).

**Visualisations:**
1. **Attention rollout:** combine attention across layers by repeated multiplication with the identity added to account for residual connections, with rows renormalised. Take the global-token row, drop the global token, reshape onto the patch grid (which can be rectangular), upsample to image size and overlay as a heatmap with adjustable opacity.
2. **Click-to-query:** map the clicked pixel to its patch token and show that token's attention row (for the selected layer and head) as a heatmap over the image, with the queried patch outlined.
3. **Layer and head exploration:** a layer slider, a head selector (including "average"), and a grid mode that tiles several layers or heads for comparison.
4. **Feature PCA:** run PCA (computed in the browser via a small linear-algebra routine) on the encoder tokens, keep three components, normalise each, and show as an RGB image over the patch grid, upsampled. Optionally mask to the foreground via the first component.
5. **Side-by-side:** depth map next to the selected attention view with linked cursors.

**Honesty requirements (must be visible in the UI):**
- Attention shows where the encoder mixes information; it is **not** a complete explanation of the predicted depth.
- Only the **encoder** is covered; the convolutional decoder is not.
- Some transformers show a few high-attention artefact tokens in background regions; mention this near the views.

### 6.11 Telemetry
Collect locally, display live, and export:
- Camera FPS, render FPS, and **effective depth refresh rate** (how often the displayed depth is updated).
- Per-stage timings: preprocessing, inference, flow, warp, fusion, effect rendering, and total frame time (with a short rolling history and percentile summary).
- **Keyframe timeline:** a strip showing keyframe events, their reasons, and the inference latency of each.
- Scheduler state: current interval, keyframe age, mean flow magnitude, low-confidence fraction.
- Quality indicators: a **flicker score** (temporal change of depth after compensating for motion, or measured on regions with near-zero flow) and a confidence summary.
- Backend in use (WebGPU or WebAssembly, flow backend) and the active profile.
- No network telemetry of any kind. Everything stays on the device.

---

## 7. Technology Stack

| Layer | Choice | Rationale and alternatives |
|---|---|---|
| Language | **TypeScript** (strict mode) | Safety across worker boundaries and data contracts |
| Build tool | **Vite** | Fast dev server, simple static build, good worker and WebAssembly support |
| UI framework | **React** (or Svelte if the agent prefers; keep it lightweight) | Component model for the multi-mode UI. Keep the render loop outside the framework's state updates |
| State management | A small store (for example Zustand) | Settings and telemetry; avoid putting per-frame data in UI state |
| Styling | Tailwind CSS or plain CSS modules | Dark and light themes, responsive |
| Model runtime | **ONNX Runtime Web** with the **WebGPU** execution provider and **WebAssembly** fallback | Direct control of custom exported graphs (needed for the Explain variant and fixed profiles). Transformers.js is a convenient alternative only for the plain inference path (verify) |
| Optical flow | **OpenCV.js** (WebAssembly) baseline; **custom WebGPU compute shaders** as the optimised path | See 6.4. Verify which flow functions the available OpenCV.js build exposes |
| Rendering | **WebGL2** (or WebGPU where convenient) via **three.js** for 3D views (parallax, point cloud); custom shader passes for bokeh and fog | three.js handles scene, camera and controls. Full-screen effects are simple custom passes |
| Charts and telemetry UI | Lightweight canvas charts or uPlot | Keep dependencies small |
| Video and GIF export | MediaRecorder / WebCodecs for video; a small GIF encoder library if GIF is required | Export of parallax orbits |
| Linear algebra (PCA) | A small library or a minimal custom implementation | Only a tiny matrix (tokens by channels) is involved |
| Testing | Vitest (unit), Playwright (end-to-end, using a fake camera feed), image-snapshot tests for effects | See Section 14 |
| Lint and format | ESLint and Prettier; type-check in CI | |
| Offline tooling | Python with PyTorch, `transformers` and ONNX export tools | One-time model export and validation scripts, kept in a separate `tools/` directory |
| Hosting | **Hugging Face Spaces, Static SDK**, plus a **model repository** for ONNX weights | See Section 12 |
| CI | GitHub Actions (lint, test, build, optional deploy) | Free tier |

---

## 8. Repository Structure and Module Responsibilities

```
depthguide/
├── apps/web/                 # the TypeScript application
│   ├── src/
│   │   ├── app/              # shell, routing between modes, settings, capability detection
│   │   ├── capture/          # camera, still image and video-file sources; frame clock
│   │   ├── engine/
│   │   │   ├── scheduler/    # keyframe scheduler and triggers
│   │   │   ├── inference/    # worker host, model loading, profiles, pre/post-processing
│   │   │   ├── flow/         # flow interface + OpenCV.js backend + GPU backend
│   │   │   ├── propagation/  # warping, latency compensation, confidence, fusion, normalisation
│   │   │   └── refine/       # optional edge-aware refinement
│   │   ├── effects/          # bokeh, fog, parallax, point cloud, depth view, exporters
│   │   ├── explain/          # attention data handling, rollout, click-to-query, PCA, views
│   │   ├── telemetry/        # metric collection, rolling stats, timeline, exporters
│   │   ├── benchmark/        # clip playback, metrics, results export, A/B harness
│   │   ├── plugins/          # plug-in interface and registry (Phase 2 hook)
│   │   └── ui/               # components, layouts, themes
│   ├── public/               # example images, sample clip, icons
│   └── tests/
├── tools/                    # Python: model export, validation, quantisation, dataset helpers
├── docs/                     # decision log, spike reports, benchmark reports
└── README.md                 # includes the Hugging Face Space configuration header
```

**Module boundary rules:**
- `effects/` and `explain/` never call the model directly. They consume depth and confidence through the engine's public interface.
- `engine/` knows nothing about the UI.
- `plugins/` defines the contract described in Section 13.
- Any backend choice (flow, model runtime) sits behind an interface and is selected by capability detection and settings.

---

## 9. UI/UX Specification

**Global layout:** a top bar with mode tabs and a status chip showing the active backend and profile. A main canvas area. A collapsible right-hand panel for controls, and a bottom telemetry strip that can be expanded.

**Live mode:** camera view with the selected effect applied; effect and parameter controls; keyframe interval and profile selectors; telemetry overlay toggle; snapshot button.

**Compare mode:** split view. **Left:** naive per-frame inference (will visibly lag on weak hardware). **Right:** DepthGuide propagation. Show each side's effective FPS and flicker score. A draggable divider. The frames must come from the same camera feed in the same instant. Note in the UI that both sides share the device's compute budget while the comparison runs.

**Photo mode:** upload, depth estimate, tap-to-refocus, parallax, point cloud, export buttons.

**Inspect mode:** freeze, then run explain model; attention views as in 6.10, with a persistent interpretation note.

**Benchmark mode:** choose a clip, choose configuration sets (interval, flow backend, anchored vs. chained, etc.), run, view result tables and charts, export.

**Onboarding:** first-run model download progress, a short explainer card describing keyframes and propagation, and a capability report. Handle errors clearly: camera denied, WebGPU unavailable, model download failed (with retry), and low-memory conditions.

---

## 10. Performance Budget and Targets (to validate by measurement)

These are design targets. Measure on at least two devices and report actual numbers.

| Item | Target |
|---|---|
| Render loop | Sustained near camera frame rate (about 30 FPS) on a recent laptop with integrated graphics, independent of model speed |
| Depth model inference (Fast profile) | A few updates per second on integrated graphics via WebGPU; slower but functional on the WebAssembly fallback |
| Flow (anchored, reduced resolution) | A small fraction of the frame budget, so that flow plus warp plus fusion plus effects fit within one frame period |
| Effective depth refresh | At or near the display frame rate through propagation |
| Added latency | Propagated depth should be derived from the current frame; keyframe results are latency-compensated |
| Start-up | Model download only on first run; cached start-up in a few seconds |
| Memory | Stay within a typical laptop browser tab budget; no unbounded buffer growth during long sessions |
| Download size | Minimise: quantised models, trimmed OpenCV.js build, code splitting, lazy-load the Explain graph and exporters |

If a target is missed, apply in order: lower the model profile, lower flow resolution, lengthen the keyframe interval, reduce bokeh samples, disable refinement.

---

## 11. Evaluation and Benchmarking Plan

The benchmark harness (FR-23) must make results reproducible and exportable.

### 11.1 Baselines and the "oracle"
- **Oracle:** the depth model run on **every frame** of a clip. This is slow but is the quality reference for propagation.
- **Naive:** the oracle with the display throttled by model speed (what a straightforward app would show).
- **DepthGuide:** keyframe plus flow propagation under various settings.

### 11.2 Metrics
| Metric | Definition | Purpose |
|---|---|---|
| **Effective depth FPS** | Rate at which a new depth is shown | G1 headline result |
| **Model calls per second and per cent of frames inferred** | Compute saved | Efficiency |
| **Fidelity to oracle** | After per-frame scale-and-shift alignment, error between propagated depth and oracle depth (mean relative error, RMSE, and fraction within a ratio threshold) | Measures what propagation costs in accuracy |
| **Flicker score** | Temporal instability of depth on motion-compensated or static regions | Stability benefit |
| **Edge sharpness** | Agreement of depth edges with RGB edges (optional) | Effect of refinement |
| **Keyframe statistics** | Trigger counts by reason, interval distribution | Scheduler behaviour |
| **Stage latency percentiles** | Median and 95th percentile per stage | Orchestration profile |
| **Memory and download size** | Peak and total | Practicality |

### 11.3 Ablations (each reported as a table or chart)
1. Keyframe interval (1, 2, 3, 4, 6, 8) vs. fidelity, FPS and flicker.
2. Fixed interval vs. adaptive scheduling.
3. Anchored vs. chained propagation.
4. Flow algorithm (Farneback, DIS if available, GPU flow if built) and flow resolution.
5. Confidence blending on vs. off.
6. Scale-and-shift alignment on vs. off (visible popping measured as the depth jump at keyframes).
7. Edge refinement on vs. off (if built).
8. Model profile and precision (FP16, FP32, INT8) vs. fidelity and speed.

### 11.4 Test clips
Record or collect about 8 short clips covering: static camera, slow pan, fast pan, a person moving, a hand-held walk, low light, and a scene with glass or reflective surfaces. Include a scene cut. Optionally evaluate against a public RGB-D video dataset with ground-truth depth (for example TUM RGB-D; verify its licence and suitability) to report an absolute error in addition to oracle fidelity.

### 11.5 Reporting
Produce a results report in `docs/` containing the tables, charts, example frame grids (before and after, oracle vs. propagated), and a **failure-case gallery** (fast motion, disocclusion, glass, thin structures, low light). Record hardware and browser versions for every result.

---

## 12. Deployment

### 12.1 Primary plan: Hugging Face Static Space (client-side)
- **Yes, this can be deployed on Hugging Face for free.** A Static Space serves the built web app, and all computation runs in the visitor's browser.
- **Space configuration:** the Space's README header selects the Static SDK and names the entry file. Hugging Face also supports a build command for Static Spaces so the Vite build can run on their side (verify the current option names), or the built output can be committed directly.
- **Model weights:** store ONNX files in a Hugging Face **model repository**. The app fetches them over HTTPS at runtime (verify cross-origin access for the file URLs), caches them in the browser's storage, and shows download progress.
- **Camera:** the camera API requires a secure context; Spaces are served over HTTPS. Test the camera both in the embedded Space page and on the direct Space URL. Prefer linking to the direct URL, because iframes can restrict permissions.
- **WebGPU:** works only in browsers and operating systems that support it (verify the current support status). The capability detector must fall back to WebAssembly and explain the performance difference to the user.
- **Cross-origin isolation:** multi-threaded WebAssembly needs special response headers. Static Spaces support configuring some custom headers in the README header (verify). If not possible, the app must work single-threaded and note the speed impact.
- **Repository size:** keep large binaries out of the Space repository where possible (host them in the model repo). Use the platform's large-file mechanism if any asset must live in the Space.
- **Release process:** build in CI, run tests, deploy to the Space on tagged releases, and keep a "known good" tag for rollback.

### 12.2 Fallback plan: Docker Space with a server backend
Use only if client-side inference proves infeasible (spike failures in Section 17):
- A containerised Space serving the same TypeScript front end plus a small Python service (inference and optical flow with OpenCV) on the free CPU hardware, connected by WebSocket.
- The keyframe design still helps here: far fewer frames require inference, which reduces server load and bandwidth.
- Trade-offs: network latency, frames leave the device (privacy messaging must change), the free container may sleep after inactivity, and concurrency is limited.

### 12.3 Demonstration plan
- **Hosted Space** is the shareable link.
- **Local build** (run from the repository) for live demos where network and cold starts must not matter.
- A **recorded demo video** as an offline fallback.

---

## 13. Phase 2 Extension Hooks (design now, build later)

Requirements the architecture must satisfy so a navigation or other application can be added without engine changes:

- **Plug-in contract:** a plug-in receives the current RGB frame, depth map, confidence map, timestamps, and read-only telemetry, and returns an optional overlay layer plus optional event messages. Plug-ins are registered in a registry and appear in the effect list automatically.
- **Stable depth stream:** depth and confidence are exposed through a single subscription interface, so any module can consume them without knowing about keyframes or flow.
- **Model swap point:** the inference module supports additional model definitions (for example a metric-depth variant) selected by configuration.
- **Output channels:** plug-ins may emit events that the shell can route to the browser's built-in speech synthesis in the future.
- **Safety banner mechanism:** the shell can display a mandatory notice attached to any plug-in flagged as experimental.

Not implemented in this phase: zone analysis, metric calibration, speech output, haptics.

---

## 14. Testing and Quality Assurance

| Level | Scope |
|---|---|
| **Unit** | Scheduler logic (each trigger, hysteresis, in-flight handling); warping with synthetic known flows (pure translation, rotation, zoom) against analytic expectations; confidence computation; affine alignment (recover a known scale and shift under noise and outliers); attention rollout and PCA on small synthetic inputs; coordinate mapping between pixels and patches for rectangular grids |
| **Numerical** | Exported ONNX graphs vs. PyTorch reference; FP16 vs. FP32 differences; per-profile sanity checks |
| **Integration** | Full pipeline on a recorded clip: expected number of model calls, deterministic output hashes for fixed settings, latency compensation correctness (late keyframe results must align to the current frame) |
| **Visual** | Image-snapshot tests for each effect on fixed inputs with tolerance; no visible holes at borders; bokeh halo checks on a synthetic scene with a sharp foreground edge |
| **End-to-end** | Browser automation with a fake camera stream: start-up, model download, mode switching, tap-to-refocus, Inspect flow, benchmark run, export files |
| **Performance** | Automated timing runs that fail the build if a stage regresses beyond a threshold; memory-growth check over a long session |
| **Compatibility** | Latest Chrome or Edge (WebGPU path), at least one browser with WebAssembly-only fallback, and a manual pass on a recent phone browser (P2) |
| **Accessibility** | Keyboard operation, labels, contrast, reduced-motion handling |

Engineering standards: strict TypeScript, no unhandled promise rejections, errors surfaced to the user, no per-frame memory leaks, and a documented decision log for every deviation from this specification.

---

## 15. Milestones and Acceptance Criteria

| # | Milestone | Priority | Acceptance criteria |
|---|---|---|---|
| **M0** | **Feasibility spikes** (Section 17) | P0 | All spike questions answered in `docs/` with measurements; fallback decisions recorded |
| **M1** | **Depth in the browser** | P0 | Exported model runs on a still image and on live camera frames; depth view displays; profile switch works; first-run download and caching work |
| **M2** | **Flow and propagation (anchored)** | P0 | Flow computed at reduced resolution; warped depth visibly tracks camera motion; confidence map viewable; synthetic-flow unit tests pass |
| **M3** | **Keyframe scheduler and latency compensation** | P0 | Interval and scene-change triggers work; at most one inference in flight; late results are aligned to the current frame; telemetry shows trigger reasons |
| **M4** | **Fusion and stable normalisation** | P0 | No visible popping at keyframes in recorded clips; keyframe depth jump metric reported; flicker lower than naive baseline |
| **M5** | **Studio effects v1** | P0/P1 | Depth colourmap, bokeh with tap-to-refocus, fog running live on propagated depth within the frame budget |
| **M6** | **Telemetry and A/B Compare** | P0 | Live overlay and timeline; side-by-side naive vs. DepthGuide with FPS and flicker for each |
| **M7** | **Explainability (Inspect)** | P0/P1 | Rollout and click-to-query working on a frozen frame; layer/head controls; PCA view; interpretation note shown |
| **M8** | **Parallax, point cloud, exports** | P1 | Orbit viewer and point cloud with controls; video or GIF export; PLY export |
| **M9** | **Benchmark harness and ablations** | P1 | Reproducible runs on recorded clips; results export; report in `docs/` with ablation tables and failure gallery |
| **M10** | **Adaptive scheduling and controller** | P1/P2 | Adaptive interval with hysteresis; optional target-FPS controller |
| **M11** | **GPU flow and edge refinement** | P2 | GPU flow backend meets or beats the WebAssembly backend in measured time; refinement toggle with measured cost |
| **M12** | **Deployment and polish** | P0 | Public Static Space working camera, model download and fallbacks; README with usage and limitations; plug-in hook documented; accessibility pass |

Each milestone ends with a demo build, updated documentation, and test results.

---

## 16. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| ONNX export of the Explain variant fails or is too large | Medium | Reduce what is exported (head-averaged only, last layers only); run Explain through a separate smaller input profile; as a last resort, show only rollout and PCA |
| WebGPU operator gaps or FP16 instability for the transformer | Medium | Fall back to FP32 or WebAssembly INT8; use a smaller profile; record the limitation |
| OpenCV.js lacks the needed flow functions or is too large | Medium | Trim the build; use Farneback only; or implement the GPU flow path |
| Flow fails on fast motion or large disocclusions | High | Confidence-driven fallbacks; motion-triggered keyframes; limit the maximum interval; show failure cases honestly |
| Propagated depth blurs or ghosts | Medium | Anchored mode; confidence-weighted blending; optional edge refinement |
| Popping at keyframes | Medium | Affine alignment, running normalisation, cross-fade (Section 6.7) |
| Integrated-graphics performance below targets | Medium | Profile ladder, lower flow resolution, longer intervals, fewer bokeh samples |
| Hosted-platform limits (headers, iframe permissions, model file access) | Medium | Test early (spike); use the direct Space URL; keep the Docker fallback documented |
| Browser support gaps | Medium | Capability detection, explicit supported-browser list, graceful messages |
| Large first-run download hurts first impressions | Medium | Quantised models, progress UI, caching, lazy-loading of the Explain graph |
| Scope creep | High | Freeze P0 and P1 scope at M9; everything else is P2 |
| Misinterpretation of attention maps | Medium | Persistent interpretation note; careful wording in the UI and the report |

---

## 17. Feasibility Spikes (do these first, in this order)

For each spike, write a short report with measurements and a go/no-go decision.

1. **Model in the browser.** Export the Small model; run it with ONNX Runtime Web on WebGPU and on WebAssembly; record latency per profile and precision on at least two machines, including one with integrated graphics only; validate against PyTorch.
2. **Explain-graph export.** Export with explicit attention and the extra outputs; measure the size and the extraction time; confirm that rollout and click-to-query reproduce reference results computed in Python.
3. **Flow in the browser.** Determine which dense flow functions the OpenCV.js build exposes (Farneback, DIS, warm-start option); measure time at several resolutions; estimate the effort and likely speed of a GPU flow path.
4. **Threading and transfer costs.** Measure frame transfer and copying overhead between workers; check whether cross-origin isolation is available on the hosting platform.
5. **Hosting checks.** Deploy a minimal Static Space that requests the camera, loads a file from a model repo, and reports WebGPU availability, then test on the direct URL and in the embedded view.
6. **End-to-end toy pipeline.** Run keyframe plus anchored warp on a recorded clip with fixed settings; confirm the approach produces visibly stable depth before building the full scheduler.

---

## 18. Licences, Ethics and Privacy

- **Licences:** Depth Anything V2 Small is Apache-2.0; the larger variants are non-commercial. Check and record the licences of every model, library and dataset used, and ship an attribution page. Respect the licence of any evaluation dataset.
- **Privacy:** frames are processed locally and never uploaded; telemetry stays on the device; say so in the About page. If the fallback server architecture is ever used, privacy messaging and consent must change.
- **Responsible-use statement (About page):** depth is estimated, not measured; it can fail on glass, mirrors, low light and textureless surfaces; the system is not a safety device and must not be used for mobility or other safety-critical decisions.
- **Explainability honesty:** attention maps are one partial view of model behaviour.

---

## 19. Definition of Done

The project is complete when:

1. All P0 requirements and milestones M0 to M7 and M12 are met, with acceptance criteria demonstrated.
2. The public Static Hugging Face Space works end to end on a laptop without a dedicated GPU, with documented fallbacks.
3. The A/B Compare mode clearly shows the benefit of keyframe orchestration, and the benchmark report quantifies effective FPS, fidelity to the oracle, and flicker, with ablations and failure cases.
4. Inspect mode produces the specified attention and PCA views, with honest interpretation notes.
5. The Studio effects run live on the propagated depth within the frame budget.
6. The plug-in hook for a future navigation module is implemented and documented.
7. The decision log, spike reports, README (with limitations) and attribution page are complete.
8. Tests pass in CI, and the codebase meets the quality standards in Section 14.
