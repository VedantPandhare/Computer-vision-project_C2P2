"""Export the official Depth Anything V2 Small with genuine explainability outputs.

The browser graph is intentionally fixed at 280 x 280. That produces a 20 x 20
patch grid (plus the DINOv2 CLS token) while keeping the attention payload small
enough for an on-demand inspection workflow.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from transformers import AutoModelForDepthEstimation


MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
INPUT_SIZE = 280
PATCH_COUNT = (INPUT_SIZE // 14) ** 2
TOKEN_COUNT = PATCH_COUNT + 1


class ExplainableDepthAnything(torch.nn.Module):
    """Expose depth, per-head attention, patch embeddings, and CLS rollout."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(
        self,
        pixel_values: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        outputs = self.model(
            pixel_values=pixel_values,
            output_attentions=True,
            output_hidden_states=True,
            return_dict=True,
        )
        attentions = torch.stack(outputs.attentions, dim=1)[0]
        patch_tokens = outputs.hidden_states[-1][0, 1:, :]

        # Attention rollout with residual connections. Only the CLS row is
        # required, so vector-matrix products replace twelve full 401^3 matrix
        # multiplications without changing the result.
        mean_attention = attentions.mean(dim=1)
        identity = torch.eye(TOKEN_COUNT, device=pixel_values.device, dtype=mean_attention.dtype)
        augmented = mean_attention + identity.unsqueeze(0)
        augmented = augmented / augmented.sum(dim=-1, keepdim=True)
        cls_rollout = torch.zeros(TOKEN_COUNT, device=pixel_values.device, dtype=mean_attention.dtype)
        cls_rollout[0] = 1
        for layer in range(augmented.shape[0] - 1, -1, -1):
            cls_rollout = torch.matmul(cls_rollout, augmented[layer])

        return outputs.predicted_depth[0], attentions, patch_tokens, cls_rollout[1:]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("apps/web/public/models/depth-anything-v2-small-explain.onnx"),
    )
    parser.add_argument("--skip-validation", action="store_true")
    return parser.parse_args()


def load_wrapper() -> ExplainableDepthAnything:
    model = AutoModelForDepthEstimation.from_pretrained(
        MODEL_ID,
        attn_implementation="eager",
    ).eval()
    return ExplainableDepthAnything(model).eval()


def export_model(wrapper: ExplainableDepthAnything, sample: torch.Tensor, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        (sample,),
        output,
        input_names=["pixel_values"],
        output_names=["depth", "attentions", "tokens", "rollout"],
        opset_version=18,
        dynamo=True,
        external_data=True,
        optimize=True,
    )
    onnx.checker.check_model(str(output))


def validate_model(wrapper: ExplainableDepthAnything, sample: torch.Tensor, output: Path) -> None:
    with torch.inference_mode():
        reference = [value.detach().cpu().numpy() for value in wrapper(sample)]

    session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
    actual = session.run(None, {"pixel_values": sample.numpy()})
    expected_shapes = [(INPUT_SIZE, INPUT_SIZE), (12, 6, TOKEN_COUNT, TOKEN_COUNT), (PATCH_COUNT, 384), (PATCH_COUNT,)]
    for name, expected, observed, shape in zip(
        ("depth", "attentions", "tokens", "rollout"),
        reference,
        actual,
        expected_shapes,
        strict=True,
    ):
        if tuple(observed.shape) != shape:
            raise RuntimeError(f"{name} shape {observed.shape} does not match {shape}")
        difference = np.abs(expected - observed)
        print(f"{name}: shape={observed.shape}, mean_abs_error={difference.mean():.7f}, max_abs_error={difference.max():.7f}")


def main() -> None:
    args = parse_args()
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    wrapper = load_wrapper()
    sample = torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE, dtype=torch.float32)
    export_model(wrapper, sample, args.output)
    size_mib = args.output.stat().st_size / (1024 * 1024)
    print(f"Exported {args.output} ({size_mib:.1f} MiB ONNX shell; external weights may be separate).")
    if not args.skip_validation:
        validate_model(wrapper, sample, args.output)


if __name__ == "__main__":
    main()
