# Spike 0003: Explainability graph readiness

**Status:** Passed and integrated (2026-10-28)

## Decision

Inspect uses a separate, on-demand ONNX graph exported from the official
`depth-anything/Depth-Anything-V2-Small-hf` checkpoint. It uses the same
pretrained weights as the depth model, with eager/non-fused attention enabled;
there is no training, pruning, quantisation, or model compression.

The graph has a fixed 280 × 280 input. DINOv2's 14-pixel patches therefore form
a 20 × 20 grid with 400 image tokens plus one CLS token. The graph returns:

- relative depth: `280 × 280`;
- genuine attention: `12 × 6 × 401 × 401` (all layers and all heads);
- final patch embeddings: `400 × 384`;
- residual-aware CLS attention rollout: `400`.

## Validation result

The ONNX graph was compared once against PyTorch on the same fixed synthetic
input. This is the required export validation, not a recurring browser test.

| Output | Mean absolute error | Maximum absolute error |
| --- | ---: | ---: |
| Depth | 0.0000023 | 0.0000122 |
| Attention | 0.0000000 | 0.0000166 |
| Patch tokens | 0.0000018 | 0.0000597 |
| Rollout | 0.0000000 | 0.0000000 |

The ONNX shell is 1,718,009 bytes and the external weight file is 99,000,421
bytes (100,718,430 bytes / about 96.1 MiB together). The full attention tensor
is about 44.2 MiB in float32. To avoid copying that large tensor into React, the
worker retains it and returns only the requested 400-value attention row when
the selected patch, layer, or head changes.

## Implemented views

- Attention rollout across all 12 layers and 6 heads.
- Click-to-query attention for any patch.
- Layer 1–12 and head 1–6 selection, plus a head-average option.
- RGB PCA view of the final 384-dimensional patch embeddings.
- Relative-depth view from the same explain graph.
- Persistent plain-language interpretation and limitation text.

The model loads only after the user runs Inspect. Live and Photo modes continue
using the normal depth-only graph and do not pay this memory or download cost.

## Reproduction

Create the isolated environment from `tools/explain-requirements.txt`, then run
`tools/probe_explain_model.py` and `tools/export_explain_model.py`. Generated
ONNX binaries and the Hugging Face cache are deliberately ignored by Git. For a
deployed build, host both model files together or set `VITE_EXPLAIN_MODEL_URL`
and `VITE_EXPLAIN_MODEL_DATA_URL` to their public URLs.
