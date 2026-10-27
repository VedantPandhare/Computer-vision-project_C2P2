# Spike 0002: Browser optical flow

**Status:** baseline passed; custom bundle optimisation remains

## Question

Can dense optical flow run in a browser worker quickly enough to propagate an
anchor depth map while model inference continues independently?

## Decision

- Use OpenCV.js Farneback as the P0 baseline behind `FlowClient`.
- Compute current-to-anchor flow on 160 × 120 greyscale frames.
- Use photometric reconstruction error as the initial confidence proxy.
- Keep GPU flow and forward-backward confidence as later optimisations.

The installed OpenCV 5 browser build exposes Farneback and its initial-flow
flag. It does not expose DIS in its shipped TypeScript surface. The production
worker bundle is currently about 15.5 MB, so a trimmed OpenCV build remains a
download-size task before deployment.

## First measured run

| Environment | Flow resolution | Algorithm | Observed flow time |
| --- | ---: | --- | ---: |
| Headless Chrome 155, Windows development machine, fake camera | 160 × 120 | Farneback | 193 ms |

The run produced a warped depth frame, a mean-motion value, and a confidence
map while the camera loop remained active. This is a functional feasibility
pass, not a performance pass: 193 ms is below the eventual real-time target.

## Follow-up

1. Benchmark a trimmed OpenCV build and warm-started Farneback.
2. Compare 128 × 96 and 160 × 120 flow resolutions on recorded clips.
3. Add forward-backward consistency if its measured cost is acceptable.
4. Attempt GPU flow only after the CPU baseline and benchmark harness are stable.
