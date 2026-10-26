# Spike 0001: Browser model feasibility

**Status:** implementation ready; device measurement pending

## Question

Can an uncompressed Depth Anything V2 Small ONNX graph be loaded and executed
without blocking the browser interface?

## Implementation

- The application loads the 99.1 MB FP32 graph from the Hugging Face ONNX
  Community repository.
- Inference runs in a dedicated Web Worker.
- WebGPU is preferred when a browser adapter is available.
- WebAssembly is the functional fallback.
- The readiness panel exposes a manual probe that creates a session and runs a
  zero-filled `1 × 3 × 518 × 518` tensor through the full graph.
- Load time, inference time, selected backend, and output shape are reported.

## Go/no-go rule

The spike passes on a device when the readiness panel reports `PASSED` and a
non-empty output shape. Actual timings must be recorded on the target machines;
production performance is not inferred from the build succeeding.

