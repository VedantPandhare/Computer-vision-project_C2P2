# Decision 0001: Application scope

**Status:** accepted

DepthGuide is an application engineering project. It is not a model-training,
model-compression, edge-deployment, or research project.

## Consequences

- Use the pretrained Depth Anything V2 Small weights without quantisation.
- ONNX is an application runtime format, not a compression deliverable.
- Fast, Balanced, and Quality profiles may adjust input and flow resolution;
  they do not alter the model weights.
- Benchmarks exist for quality assurance and product performance reporting.
- The browser is the deployment target. Dedicated edge devices are out of scope.

