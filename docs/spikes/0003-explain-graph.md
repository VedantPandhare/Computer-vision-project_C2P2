# Spike 0003: Explainability graph readiness

**Status:** UI foundation complete; attention graph is a no-go until separately exported and validated

## Finding

The production browser model integration currently consumes a single relative-depth output. It does not provide validated per-layer or per-head attention tensors to the application. Ordinary image saliency, contrast, or a depth gradient is not a substitute for transformer attention and will not be labelled as such.

## Implemented now

- Camera freeze-frame workflow.
- Visible 14-pixel patch grid and click-to-query coordinate mapping.
- Frozen-frame depth output beside the source.
- Reserved layer/head controls and a persistent interpretation notice.

## Required before attention views are enabled

1. Export the pretrained Small encoder with explicit, non-fused attention outputs.
2. Compare those outputs against the original framework on fixed images.
3. Record tensor shapes, numerical error, graph size, load time, and memory use.
4. Enable rollout and click-to-query only after that validation passes.

This is an engineering export and validation task, not model training or a claim of new research.
