# DepthGuide

<div align="center">

### Real-time monocular depth estimation, inspection and propagation — entirely inside the browser

[![Live Demo](https://img.shields.io/badge/Live_Demo-Hugging_Face-FFD21E?logo=huggingface&logoColor=111)](https://huggingface.co/spaces/Vedant117/DepthGuide)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-Web-005CED?logo=onnx&logoColor=white)](https://onnxruntime.ai/docs/tutorials/web/)
[![WebGPU](https://img.shields.io/badge/Acceleration-WebGPU-B8F532)](https://www.w3.org/TR/webgpu/)
[![Privacy](https://img.shields.io/badge/Processing-Local_First-53E8A8)](#privacy)

**[Launch the public DepthGuide Space](https://huggingface.co/spaces/Vedant117/DepthGuide)**

</div>

DepthGuide turns an ordinary camera or photograph into an interactive **relative-depth representation**. A pretrained Depth Anything V2 Small model estimates which regions are nearer or farther away; a browser pipeline then visualises, propagates, inspects and measures that depth without sending camera frames to an application server.

This is an **application-engineering project**, not a new model-training research project. It deliberately uses the full pretrained model: there is no pruning, quantisation, model compression or edge-hardware target. The engineering challenge is making a large vision model usable, understandable and responsive in a local web application.

---

## Contents

- [What is depth estimation?](#what-is-depth-estimation)
- [Why depth matters](#why-depth-matters)
- [LiDAR and the depth revolution](#lidar-and-the-depth-revolution)
- [What DepthGuide contributes](#what-depthguide-contributes)
- [How the browser pipeline works](#how-the-browser-pipeline-works)
- [Keyframes: the central optimisation](#keyframes-the-central-optimisation)
- [Inspect mode](#inspect-mode)
- [Application modes](#application-modes)
- [Architecture and technology](#architecture-and-technology)
- [Run locally](#run-locally)
- [Engineering validation](#engineering-validation)
- [Privacy, limitations and responsible use](#privacy-limitations-and-responsible-use)
- [References and visual attribution](#references-and-visual-attribution)

---

## What is depth estimation?

A normal RGB image tells us the colour and brightness observed at every pixel. It does **not** directly tell us how far the visible surface is from the camera. Depth estimation adds that missing geometric dimension by assigning a depth value to every pixel.

The result is a **depth map**: an image-sized field in which pixels with similar values are interpreted as lying at similar distances from the viewpoint. A depth map makes scene structure computationally useful. Foreground people can be separated from distant buildings, a floor can be distinguished from a wall, and a flat photograph can drive focus effects, fog, parallax or approximate 3D geometry.

### Monocular depth estimation

**Monocular** means that only one camera view is available. There is no second stereo camera, no laser range sensor and no known baseline from which distance can be triangulated.

This is a fundamentally ambiguous problem. A small nearby object can create the same image footprint as a large distant object. Modern depth models solve the practical version of this problem by learning visual priors from large and diverse datasets: perspective, occlusion, familiar object shapes, texture gradients, horizons and scene layout all provide clues.

DepthGuide uses **Depth Anything V2 Small**, a 24.8-million-parameter model from the official Depth Anything V2 family. The model produces affine-invariant inverse depth: it is excellent for understanding the ordering and layering of a scene, but its default output is not a calibrated distance in metres.

### Relative depth versus metric depth

| Property | Relative depth — used by DepthGuide | Metric depth |
| --- | --- | --- |
| Main question | “What is nearer or farther?” | “How many metres away is it?” |
| Scale | Normalised within a scene | Calibrated physical units |
| Typical source | Monocular foundation model | LiDAR, stereo, RGB-D sensor or metric model |
| Strength | Dense structure from one ordinary image | Physical measurement and geometry |
| Limitation | Cannot safely measure real distance | Requires calibration, suitable training or specialised sensing |

DepthGuide normalises its display as **relative inverse depth**:

- `1` means relatively nearer.
- `0` means relatively farther.
- The scale is meaningful within the current scene, not across unrelated scenes.
- A displayed value such as `0.78` must not be interpreted as metres.

### A real image and its predicted depth

<table>
  <tr>
    <td width="50%"><img src="docs/assets/readme/depth-anything-input.jpg" alt="Real London street photograph used by the Depth Anything V2 project" /></td>
    <td width="50%"><img src="docs/assets/readme/depth-anything-v2-output.jpg" alt="Depth Anything V2 relative-depth prediction for the street photograph" /></td>
  </tr>
  <tr>
    <td align="center"><strong>RGB input</strong></td>
    <td align="center"><strong>Depth Anything V2 prediction</strong></td>
  </tr>
</table>

In this palette, the nearby road users and foreground surfaces are brighter and warmer, while distant buildings and sky move toward cooler colours. More importantly, the prediction preserves object boundaries: cars, people, trees, lamp posts and the street form separate depth layers.

*Visual source: [official Depth Anything V2 project page](https://depth-anything-v2.github.io/). Used here to explain the model family integrated by DepthGuide.*

---

## Why depth matters

Depth changes an image from a flat colour grid into a representation that can support spatial reasoning.

### Robotics and autonomous systems

Robots need geometry to move through the world, avoid obstacles, manipulate objects and determine which surfaces are reachable. Autonomous systems combine multiple sensors because each one fails differently: cameras provide dense semantics and colour, while range sensors provide direct geometry.

### Computational photography

Depth enables portrait blur, synthetic aperture effects, selective refocusing, depth fog, relighting and foreground/background separation. These effects become editable because the application knows more than object colour—it has an estimate of spatial order.

### Augmented reality and 3D content

Virtual objects should disappear behind real objects, sit on plausible surfaces and respond to the camera. Even approximate depth can support occlusion masks, parallax, point clouds and single-image 3D previews.

### Mapping, inspection and accessibility

Depth supports terrain mapping, construction inspection, measurement workflows, assistive scene understanding and environment modelling. Safety-critical use requires calibrated sensors and validated systems; nevertheless, dense monocular depth is valuable for prototyping and for filling spatial gaps where a dedicated range sensor is unavailable.

---

## LiDAR and the depth revolution

**LiDAR**—light detection and ranging—is an active sensor. It emits laser pulses and measures how long their reflections take to return. Combined with the direction of each pulse, those measurements become 3D coordinates. Millions of coordinates form a **point cloud**.

<p align="center">
  <img src="docs/assets/readme/usgs-lidar-point-cloud.png" alt="USGS terrestrial LiDAR point cloud of a forest" width="900" />
</p>

<p align="center"><em>A terrestrial LiDAR point cloud makes the three-dimensional structure of trees directly visible. Source: USGS / Emily Link.</em></p>

LiDAR was transformative because it moved many depth tasks from indirect visual inference to direct range measurement at scale:

- Autonomous vehicles can build a 3D representation of roads, vehicles and obstacles around the sensor.
- Surveyors can map terrain, buildings and infrastructure with dense georeferenced elevation samples.
- Scientists can derive terrain models, canopy structure, flood models and landslide-risk maps.
- Robotics systems can use point clouds for localisation, navigation and collision checking.
- Depth datasets such as KITTI use laser measurements to evaluate or supervise camera-based depth methods.

LiDAR is not magic. Returns are discrete rather than a dense value for every camera pixel; sensors add cost, power, calibration and mechanical/optical constraints; reflective, transparent or absorptive materials can be difficult; and rain, fog or occlusion can affect measurements. Cameras have the opposite strengths: they are inexpensive and semantically rich, but physical scale is ambiguous.

### LiDAR and monocular depth are complementary

| LiDAR | Monocular depth estimation |
| --- | --- |
| Measures range from emitted light pulses | Infers depth from one RGB image |
| Naturally metric when calibrated | Usually relative unless trained/calibrated for metric depth |
| Produces a sparse or semi-dense point cloud | Produces a dense value at image resolution |
| Requires specialised hardware | Works with an ordinary camera |
| Strong geometric evidence | Strong learned visual and semantic priors |

DepthGuide does **not** claim to replace LiDAR. Its goal is to make dense relative depth accessible on hardware people already own, and to expose both the usefulness and uncertainty of that estimate.

---

## What DepthGuide contributes

Running a model on one photograph is straightforward. Running a roughly 99 MB FP32 ONNX graph repeatedly, keeping the interface responsive, following motion between results and explaining the output to a user is a systems problem.

DepthGuide focuses on that application layer:

1. **Local inference** — model execution happens in a Web Worker using ONNX Runtime Web.
2. **GPU acceleration** — WebGPU is preferred when supported; WebAssembly is the CPU fallback.
3. **Keyframe scheduling** — the expensive neural network is not blindly called for every camera frame.
4. **Optical-flow propagation** — reduced-resolution Farneback flow moves an anchor depth map with the scene between keyframes.
5. **Confidence-aware fusion** — low-confidence motion, scale changes and new keyframes are handled explicitly.
6. **Interactive inspection** — users can query a patch and explore depth similarity, ordering and layers.
7. **Observable performance** — FPS, model time, flow time, update jumps, keyframe reasons and confidence are visible instead of hidden.
8. **Graceful degradation** — if optical flow is unavailable, model keyframes continue to produce usable depth.

The application never trains the model and does not compress it for edge deployment. The optimisation is **orchestration**: deciding when expensive inference is valuable and how to reuse its result between calls.

---

## How the browser pipeline works

```mermaid
flowchart LR
    A[Camera / photo / video] --> B[Frame preparation]
    B --> C{Keyframe scheduler}
    C -->|keyframe requested| D[Depth inference worker]
    D -->|Depth Anything V2| E[Anchor depth]
    B -->|downscaled grayscale frames| F[Optical-flow worker]
    E --> G[Depth warping]
    F -->|motion field + confidence| G
    G --> H[Scale/shift alignment + temporal fusion]
    H --> I[Stable relative-depth stream]
    I --> J[Depth colour]
    I --> K[Bokeh / fog]
    I --> L[Telemetry]
    I --> M[Inspection and exports]
```

### 1. Frame preparation

The camera remains responsive on the main thread. A model-sized RGB frame is prepared only when inference is requested. A separate low-resolution greyscale representation is maintained for motion estimation.

### 2. Depth inference worker

The worker loads the ONNX model and selects the preferred execution backend:

- **WebGPU** maps tensor operations to the local GPU through the browser.
- **WebAssembly** provides a CPU-compatible fallback.

Inference is isolated from React and the camera loop, so loading or running the model does not intentionally block interface rendering.

### 3. Optical-flow worker

OpenCV.js computes dense Farneback optical flow on downscaled greyscale frames. The flow describes how pixels moved relative to the anchor frame. DepthGuide uses that field to warp the anchor depth into the current camera view.

A photometric reconstruction score becomes an initial confidence estimate. Areas that no longer match—motion boundaries, newly revealed surfaces or large appearance changes—receive lower confidence.

### 4. Alignment and temporal fusion

Monocular relative depth can change scale and offset between independent inferences. At a new keyframe, DepthGuide fits a robust affine alignment against the current propagated depth over reliable pixels. It then blends the transition rather than abruptly replacing the displayed map.

This does not make the estimate metrically calibrated. It improves visual continuity.

---

## Keyframes: the central optimisation

Imagine asking a skilled artist to redraw the complete depth map for every video frame. Most adjacent frames are nearly identical, so that work is wasteful. DepthGuide instead asks the model for an accurate **anchor** occasionally, then follows how the scene moves until another anchor is needed.

The scheduler can request a keyframe for six reasons:

| Reason | Meaning |
| --- | --- |
| `initial` | No depth anchor exists yet |
| `interval` | The configured number of frames has elapsed |
| `motion` | Optical flow reports enough movement to justify a refresh |
| `confidence` | Too much of the propagated map has become unreliable |
| `scene-change` | The current frame differs substantially from the previous scene |
| `manual` | The user explicitly requests a new keyframe |

If the model is already running, the scheduler remembers the most urgent pending reason rather than launching overlapping model calls.

### Quality profiles

| Profile | Approximate model target | Flow resolution | Suggested interval |
| --- | ---: | ---: | ---: |
| Fast | 336 px | 128 × 96 | Every 7 frames |
| Balanced | 448 px | 160 × 120 | Every 5 frames |
| Quality | 518 px | 224 × 168 | Every 3 frames |

These profiles change workload and refresh policy; they do not swap in a compressed model. The same pretrained model remains the source of every keyframe.

### Why this helps

- The camera preview and UI can continue while inference runs.
- The same model result can support multiple intermediate frames.
- Expensive inference is concentrated where scene change or uncertainty makes it useful.
- Flow confidence tells the scheduler when reuse is no longer trustworthy.
- A model-only fallback still works if flow cannot initialise on a browser/device.

---

## Inspect mode

Inspect is one of DepthGuide’s most important explanatory features. It turns a depth map from a colourful output into something the user can question directly.

Start a camera, freeze a useful frame, or choose a local photograph. DepthGuide estimates depth once and overlays a model-aligned patch grid. Clicking a patch links the same location across the frozen RGB frame and the depth view.

### Available inspection views

#### Relative depth + probe

Shows the normal depth map and reports the selected patch’s normalised value. The label explains whether that value falls in a nearer, middle or farther part of the current scene.

#### Selected-patch depth similarity

Compares every predicted pixel with the selected patch’s depth. Brighter regions have a closer relative-depth value. The tight, balanced and wide match ranges control how strict that comparison is.

This is deliberately labelled **depth similarity, not attention**. It explains a relationship in the model output; it does not claim to reveal why the neural network made its decision.

#### Near / same / far

Partitions the scene relative to the selected patch:

- orange regions are nearer;
- lime regions are at a similar depth;
- blue regions are farther away.

#### Selected depth layer

Divides the continuous prediction into six scene layers and highlights the band containing the selected patch. This is useful for understanding large spatial groupings such as foreground, subject, room and background.

### Why Inspect is useful

An attractive depth map can hide errors. Inspect makes it easier to see whether two disconnected objects have been grouped at the same depth, whether a boundary is sharp, or whether a mirror, window or thin object has confused the estimate. Palette and match-range changes are computed from the existing tensor, so exploration does not rerun the model.

> An advanced transformer-attention export was separately implemented and numerically validated during development. After interface review, it was intentionally left dormant in favour of this simpler depth-native interaction. The validation notes remain in [`docs/spikes/0003-explain-graph.md`](docs/spikes/0003-explain-graph.md).

---

## Application modes

| Mode | What it provides |
| --- | --- |
| **Live** | Camera depth, profiles, adaptive/fixed keyframes, depth/confidence views, bokeh, fog and detailed telemetry |
| **Photo** | Still-image inference, multiple palettes, tap-to-refocus bokeh, fog, parallax, point cloud and PLY export |
| **Inspect** | Patch-linked relative depth, similarity, near/same/far relationships and selected depth layers |
| **Compare** | Same camera frames shown as model-only hold versus DepthGuide propagation, with timing and update-jump metrics |
| **Benchmark** | Repeatable local-video experiments across keyframe intervals, with JSON and CSV exports |
| **About** | Scope, pipeline, attribution, limitations, privacy and responsible-use guidance |

### Readiness and model-feasibility panel

Every mode shares a capability panel that reports WebGPU, WebAssembly, camera access and worker-isolation support. The model-feasibility check loads the complete graph, executes a real tensor and reports backend, load time, inference time and output shape. A successful frontend build alone is not treated as proof that a particular browser can run the model.

---

## Architecture and technology

| Layer | Implementation |
| --- | --- |
| UI | React 19, TypeScript, Vite |
| Depth model | Depth Anything V2 Small, FP32 ONNX |
| Browser inference | ONNX Runtime Web |
| Preferred execution | WebGPU |
| CPU fallback | WebAssembly |
| Optical flow | OpenCV.js Farneback |
| Propagation | Backward depth warping with confidence |
| Stabilisation | Robust affine alignment and temporal fusion |
| Effects | Canvas 2D and WebGL2 |
| Concurrency | Dedicated inference and flow workers |
| Telemetry | Typed in-browser timing, FPS, scheduler and flicker stores |
| Deployment | Prebuilt static application on Hugging Face Spaces |

### Project structure

```text
apps/web/src/
├── app/                 application shell and browser capability detection
├── capture/             Live and Photo workflows
├── compare/             shared-input A/B comparison
├── benchmark/           repeatable video benchmark and exports
├── inspect/             interactive patch-based depth inspection
├── engine/
│   ├── inference/       ONNX Runtime worker and depth preprocessing
│   ├── flow/            OpenCV.js optical-flow worker
│   ├── propagation/     flow-based depth warping
│   ├── fusion/          alignment and temporal stabilisation
│   ├── scheduler/       fixed and adaptive keyframe decisions
│   └── explain/         dormant validated advanced-inspection engine
├── effects/             colour, bokeh, fog, parallax and point-cloud views
└── telemetry/           timings, FPS, flicker and keyframe events

docs/
├── decisions/           product and engineering decisions
├── spikes/              browser model, optical flow and explain-graph evidence
└── assets/readme/       attributed README visuals
```

The complete original product requirements and acceptance criteria are documented in [`DepthGuide_Build_Specification.md`](DepthGuide_Build_Specification.md).

---

## Run locally

### Requirements

- [Node.js](https://nodejs.org/) `22.12` or newer
- npm
- A current Chromium-based browser is recommended for WebGPU
- Camera access requires `localhost` or another secure context
- Sufficient memory for the browser, ONNX runtime and the approximately 99 MB model

### Clone and install

```bash
git clone https://github.com/VedantPandhare/Computer-vision-project_C2P2.git
cd Computer-vision-project_C2P2
npm install
```

### Start the development server

```bash
npm run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173`.

The model is downloaded from the public [`onnx-community/depth-anything-v2-small`](https://huggingface.co/onnx-community/depth-anything-v2-small) repository when it is first required. The initial visit is therefore substantially slower than a cached revisit.

### Build for production

```bash
npm run build
```

The static deployment output is written to `apps/web/dist`.

### Focused validation commands

```bash
npm run typecheck
npm test
```

### Suggested first run

1. Open the app and run **Model feasibility**.
2. Confirm whether the selected backend is `WEBGPU` or `WASM`.
3. Try a bundled sample in **Photo** or **Inspect** before enabling the camera.
4. In **Live**, begin with the Balanced profile and Depth view.
5. Open telemetry only when you need timing or scheduler details.

### Browser troubleshooting

- If WebGPU is unavailable, DepthGuide uses WebAssembly. It will usually be slower.
- If camera access fails, verify that the page is running on `localhost` or HTTPS and that browser permission was granted.
- A first model load can take tens of seconds depending on connection, storage cache, CPU and GPU-driver compilation.
- The OpenCV worker is also a large cold-start bundle. Depth keyframes remain usable if optical flow times out.
- If a deployment appears unchanged, clear the site cache or perform a hard refresh.

---

## Engineering validation

The project records engineering spikes rather than relying on a successful build as evidence.

| Question | Result | Evidence |
| --- | --- | --- |
| Can the full uncompressed model run in a browser worker? | Passed on the development environment with WebGPU; target-device timing remains device-specific | [`0001-browser-model.md`](docs/spikes/0001-browser-model.md) |
| Can dense flow produce a warped depth frame without blocking the camera loop? | Baseline passed at 160 × 120; the measured development run was 193 ms and remains an optimisation target | [`0002-browser-flow.md`](docs/spikes/0002-browser-flow.md) |
| Can a genuine attention export reproduce the source model? | Depth, attention, tokens and rollout were numerically compared against PyTorch; the advanced UI is currently dormant | [`0003-explain-graph.md`](docs/spikes/0003-explain-graph.md) |

These are feasibility results from recorded environments, not universal performance claims. Browser, operating system, GPU, driver, thermal state and cache condition can materially change timings.

---

## Privacy, limitations and responsible use

### Privacy

- Camera, photo and local-video pixels are processed in the browser.
- DepthGuide does not intentionally upload input media to an application server.
- Telemetry remains in memory unless the user explicitly exports benchmark results.
- The browser still downloads application assets and the model over HTTPS.
- Browser extensions, developer tools and hosting-platform behaviour are outside the application’s control.

### Known limitations

- Relative depth is not physical measurement.
- Mirrors, glass, reflective metal, thin structures and textureless surfaces can be wrong.
- Low light, motion blur and rapid movement reduce both model and optical-flow reliability.
- Newly revealed regions have no valid correspondence in the anchor frame.
- Optical-flow warping can stretch depth around occlusions and motion boundaries.
- First-visit downloads are large because model compression is intentionally out of scope.
- WebGPU availability and performance vary across browsers and devices.
- The application is not SLAM, multi-view reconstruction or calibrated 3D scanning.

> **DepthGuide is not a safety system.** Do not use it for navigation, collision avoidance, mobility assistance, surveying, physical measurement or any safety-critical decision. Use calibrated and independently validated sensing for those tasks.

---

## Scope

DepthGuide intentionally focuses on browser application engineering:

- pretrained model inference, not model training or fine-tuning;
- local GPU/CPU execution, not a cloud inference API;
- scheduling and propagation, not model compression;
- ordinary computers and browsers, not dedicated edge hardware;
- relative scene structure, not metric ranging;
- interpretable output relationships, not unqualified claims of causal explainability.

---

## References and visual attribution

### Core technical references

1. Yang et al., **Depth Anything V2**, NeurIPS 2024 — [paper](https://arxiv.org/abs/2406.09414), [official project page](https://depth-anything-v2.github.io/), [official repository](https://github.com/DepthAnything/Depth-Anything-V2).
2. Microsoft, **ONNX Runtime Web** — [web documentation](https://onnxruntime.ai/docs/tutorials/web/) and [WebGPU execution-provider guide](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).
3. W3C GPU for the Web Working Group, **WebGPU** — [specification](https://www.w3.org/TR/webgpu/).
4. OpenCV, **Farneback dense optical flow** — [`calcOpticalFlowFarneback`](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html).
5. KITTI Vision Benchmark Suite, **Depth Completion and Prediction** — [official benchmark](https://www.cvlibs.net/datasets/kitti/eval_depth.php?benchmark=depth_completion).
6. NOAA, **What Is Lidar?** — [LiDAR fundamentals](https://coast.noaa.gov/data/digitalcoast/pdf/lidar-101.pdf).
7. U.S. Geological Survey, **What is LiDAR?** — [active sensing and point clouds](https://dmsdata.cr.usgs.gov/lidar-monitoring/what-is-lidar).
8. U.S. Geological Survey, **3D Elevation Program** — [LiDAR-derived mapping and applications](https://www.usgs.gov/3d-elevation-program).

### Visual attribution

- Street RGB image and Depth Anything V2 prediction: [official Depth Anything V2 project page](https://depth-anything-v2.github.io/), presented as an attributed model example.
- Terrestrial forest LiDAR point cloud: [U.S. Geological Survey / Interagency Lidar Monitoring & Research Applications](https://dmsdata.cr.usgs.gov/lidar-monitoring/what-is-lidar), image credited on the source page to Emily Link.

### Software and model attribution

- **Depth Anything V2 Small** — pretrained depth model; official Small checkpoint listed under Apache-2.0.
- **ONNX Runtime Web** — browser inference runtime; MIT.
- **OpenCV / OpenCV.js** — Farneback optical flow; Apache-2.0.
- **React, TypeScript and Vite** — application framework and toolchain under their respective licences.

The larger Depth Anything V2 variants have different licensing conditions and are not used by this application. Consult every upstream project and visual source before redistributing assets or using the system commercially.

---

## Acknowledgement

DepthGuide was built around a simple observation: putting a model in a browser is only the beginning. A useful vision application also has to manage expensive work, preserve responsiveness, communicate uncertainty, expose failure modes, make outputs inspectable and respect the user’s data.

That application layer—workers, WebGPU, keyframes, flow, confidence, fusion, telemetry, interaction and honest limitations—is the core of this project.
