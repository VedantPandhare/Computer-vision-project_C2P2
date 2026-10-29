---
title: DepthGuide
emoji: 🧭
colorFrom: green
colorTo: indigo
sdk: static
app_file: index.html
fullWidth: true
header: mini
pinned: false
short_description: Local-first monocular depth, propagation, inspection.
models:
  - onnx-community/depth-anything-v2-small
tags:
  - computer-vision
  - depth-estimation
  - webgpu
  - onnx
  - optical-flow
---

# DepthGuide

### See how an ordinary image is arranged in depth—directly inside your browser.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-Web-005CED?logo=onnx&logoColor=white)](https://onnxruntime.ai/)
[![WebGPU](https://img.shields.io/badge/Acceleration-WebGPU-B8F532)](https://www.w3.org/TR/webgpu/)
[![Privacy](https://img.shields.io/badge/Frames-Stay_on_Device-53E8A8)](#privacy)

> **Hugging Face Space:** [Launch DepthGuide](https://huggingface.co/spaces/YOUR_USERNAME/depthguide)  
> Replace `YOUR_USERNAME` after creating the Space. Direct application placeholder: `https://YOUR_USERNAME-depthguide.hf.space`

DepthGuide is a local-first computer-vision application that estimates **relative depth** from a camera or still image. It combines a pretrained Depth Anything V2 Small model with optical flow, confidence-aware propagation and browser-native rendering.

The expensive neural network does not need to run on every camera frame. DepthGuide creates accurate model **keyframes**, follows scene motion between them, and continuously exposes the decisions and performance of that pipeline.

No camera frame is uploaded by this application. Inference, optical flow, inspection and effects run on the visitor's device.

---

## What you can do

### Live depth orchestration

- Capture a live camera stream and select an available camera.
- Run Depth Anything V2 Small through ONNX Runtime Web.
- Prefer WebGPU acceleration with a WebAssembly fallback.
- Schedule model keyframes from interval, motion, confidence and scene-change signals.
- Propagate anchor depth between keyframes with Farneback optical flow.
- Stabilise new keyframes with scale-and-shift alignment and fusion.
- Inspect live FPS, stage timings, keyframe reasons, confidence and flicker telemetry.

### Photo workspace and creative depth effects

- Upload a local image or use a bundled synthetic example.
- Visualise relative depth with multiple colour palettes.
- Apply depth-driven bokeh with tap-to-refocus.
- Add depth fog and atmosphere.
- Explore a depth-displaced 3D parallax surface.
- Orbit a single-view point cloud and export it as PLY.

### Interactive Inspect mode

Freeze a camera frame or choose a photo, then click either panel to explore its depth structure.

- **Relative depth + probe** links the selected patch across both panels and reports its relative depth.
- **Selected-patch depth similarity** highlights regions at a similar scene depth.
- **Near / same / far** separates regions relative to the selected patch.
- **Selected depth layer** groups the scene into depth bands and highlights the chosen band.
- Palette and match-range controls update immediately without rerunning the model.

These views explain the estimated depth structure. They are not claims about causal model reasoning. A separately validated experimental attention graph is retained in the development codebase but is not loaded by the current classic Inspect interface.

### A/B Compare and deterministic Benchmark

- Compare model-only keyframes with DepthGuide propagation on the same camera stream.
- Observe effective depth FPS, inference time, flow time and update jump.
- Upload a local video for repeatable interval experiments.
- Export benchmark results as JSON or CSV.

---

## How DepthGuide works

```text
Camera / photo
      │
      ├──► Depth model worker ──► accurate depth keyframe
      │                                  │
      └──► Optical-flow worker ──► warp anchor depth to the current frame
                                         │
                              confidence + alignment + fusion
                                         │
                         stable relative-depth stream (0 to 1)
                                         │
                  colour · bokeh · fog · parallax · point cloud
```

The display loop does not wait for the neural network. It renders the best available depth while the next keyframe is processed in a worker.

### Depth convention

DepthGuide uses normalised **relative inverse depth**:

- `1` means relatively nearer.
- `0` means relatively farther.
- Values are meaningful only within the current scene.
- Values are not metres and cannot be used to measure physical distance.

---

## Application modes

| Mode | Purpose |
| --- | --- |
| **Live** | Camera depth, keyframe propagation, confidence, effects and telemetry |
| **Photo** | Still-image depth, bokeh, fog, parallax and point cloud |
| **Inspect** | Interactive patch-based depth relationships and scene layers |
| **Compare** | Side-by-side model-only and propagated depth behaviour |
| **Benchmark** | Repeatable local-video tests with JSON and CSV export |
| **About** | Scope, architecture, attribution, privacy and responsible-use limits |

---

## Technology

| Layer | Technology |
| --- | --- |
| Interface | React 19, TypeScript and Vite |
| Depth model | Depth Anything V2 Small |
| Browser inference | ONNX Runtime Web |
| Preferred acceleration | WebGPU |
| CPU fallback | WebAssembly |
| Dense optical flow | OpenCV.js Farneback |
| Effects | Canvas 2D and WebGL2 |
| State and telemetry | Typed in-browser stores |
| Hosting target | Hugging Face Static Space |

Workers isolate model inference and optical flow from the main rendering thread. Transferable typed arrays are used where practical to reduce copying.

---

## Run locally

### Requirements

- Node.js `22.12` or newer.
- npm.
- A recent Chromium-based browser is recommended for WebGPU.
- Camera access requires `localhost` or another secure context.

### Install and start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`.

### Production build

```bash
npm run build
```

The deployable application is written to `apps/web/dist`.

### Focused project commands

```bash
npm run typecheck
npm test
```

---

## Deploy to Hugging Face Spaces

This README is configured for a prebuilt Hugging Face **Static Space**. Hugging Face serves the compiled files directly, so the deployment does not use the credit-gated Static build job.

1. Create a new Hugging Face Space and select **Static** as the SDK.
2. Use the repository name `depthguide`, or update the placeholder links in this README if you choose another name.
3. Run `npm run build` locally.
4. Upload this `README.md` and the selected contents of `apps/web/dist/` to the Space root.
5. Keep `index.html`, `assets/` and `samples/` at the Space root.
6. Do not add `app_build_command` to the README metadata.
7. Wait until the Space reports **Running**, then open the direct `*.hf.space` URL and run the checks in [Deployment smoke test](#deployment-smoke-test).

Do not upload local development or generated directories such as:

```text
node_modules/
src/
models/
*.map
package.json
package-lock.json
vite.config.ts
tsconfig*.json
```

The Space root only needs `README.md`, the built `index.html`, the five runtime files inside `assets/`, and the bundled files inside `samples/`. The local `dist/models/` files belong to the dormant advanced-inspection experiment and must not be uploaded. The production depth model is fetched at runtime from the public `onnx-community/depth-anything-v2-small` repository.

### Deployment smoke test

After the files are uploaded:

- Confirm that the landing page and all six modes open.
- Run **Model feasibility** and verify that a non-empty depth output is returned.
- Start Live mode and grant camera access on the direct Space URL.
- Confirm whether the readiness panel selects WebGPU or WebAssembly.
- Process one bundled Photo example.
- Process one bundled Inspect example and click both panels.
- Start and stop Compare mode.
- Upload a short local video in Benchmark mode and export one result.

The initial model and runtime downloads are large. A first run can take noticeably longer than later browser-cached visits.

---

## Project structure

```text
apps/web/src/
├── app/                 application shell and capability detection
├── capture/             Live and Photo workflows
├── compare/             A/B comparison workspace
├── benchmark/           deterministic video benchmark and exports
├── inspect/             interactive depth inspection
├── engine/
│   ├── inference/       ONNX Runtime model worker
│   ├── flow/            optical-flow worker
│   ├── propagation/     depth warping
│   ├── fusion/          scale/shift alignment and stabilisation
│   ├── scheduler/       fixed and adaptive keyframe logic
│   └── explain/         dormant validated attention experiment
├── effects/             colour, bokeh, fog, parallax and point cloud
└── telemetry/           timing, FPS, flicker and keyframe events

docs/
├── decisions/           product and engineering decisions
└── spikes/              browser model, flow and explain-graph findings
```

The full original requirements and acceptance criteria are in [`DepthGuide_Build_Specification.md`](./DepthGuide_Build_Specification.md).

---

## Privacy

- Camera, photo and video pixels are processed locally in the browser.
- Input media is not intentionally uploaded to an application server.
- Telemetry remains in browser memory unless the user explicitly exports benchmark results.
- Model and JavaScript assets are downloaded over HTTPS from the hosting platform and model repository.

Browser developer tools and installed extensions remain outside the application's control.

---

## Limitations and responsible use

DepthGuide is an engineering demonstration and creative visual tool.

- It estimates relative depth, not physical distance.
- Glass, mirrors, reflective metal, thin structures and textureless surfaces can be incorrect.
- Low light, motion blur, rapid camera movement and newly revealed regions reduce confidence.
- Optical-flow propagation may temporarily stretch or blur depth around occlusions.
- Performance varies substantially by browser, GPU, memory and power settings.
- WebAssembly fallback is expected to be slower than WebGPU.
- First-visit downloads are currently larger than the final optimisation target.

> **DepthGuide is not a safety system.** Do not use it for navigation, mobility, collision avoidance, measurement or any safety-critical decision.

---

## Scope

This is an application-engineering project:

- It uses an existing pretrained model.
- It does not train or fine-tune the model.
- Model compression is not a project objective.
- Dedicated edge-hardware deployment is out of scope.
- It does not perform face, hand or body analysis.
- It does not perform SLAM or multi-view 3D reconstruction.

---

## Current status

**Public-beta candidate.** The production build passes locally and the main application workflows are implemented. Hosted camera permissions, remote model loading, WebGPU/WebAssembly fallback and cold-start behaviour still need to be verified on the final Hugging Face Space URL.

Remaining release improvements include percentage-based model-download progress, an accessibility and compatibility pass, CI deployment, bundle-size optimisation, expanded benchmark reporting and optional media exports.

---

## Attribution and licences

- **Depth Anything V2 Small** — pretrained depth model, Apache-2.0.
- **ONNX Runtime Web** — browser inference runtime, MIT.
- **OpenCV / OpenCV.js** — Farneback optical flow, Apache-2.0.
- **React, TypeScript and Vite** — application framework and toolchain under their respective licences.

The larger Depth Anything V2 model variants have different licensing conditions and are not used here. A root licence for the DepthGuide application source must be selected before presenting the repository as reusable open-source software.

---

## Acknowledgement

DepthGuide is built around the idea that useful browser vision is not only about running a model—it is also about scheduling expensive work, tracking uncertainty, exposing system behaviour and communicating limitations honestly.
