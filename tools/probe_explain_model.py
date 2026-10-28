"""Verify that the official HF Depth Anything V2 Small exposes genuine attentions."""

from __future__ import annotations

import json

import torch
from transformers import AutoModelForDepthEstimation


MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
INPUT_SIZE = 280


def main() -> None:
    model = AutoModelForDepthEstimation.from_pretrained(
        MODEL_ID,
        attn_implementation="eager",
    ).eval()
    sample = torch.zeros(1, 3, INPUT_SIZE, INPUT_SIZE, dtype=torch.float32)
    with torch.inference_mode():
        outputs = model(
            pixel_values=sample,
            output_attentions=True,
            output_hidden_states=True,
            return_dict=True,
        )

    attentions = outputs.attentions or ()
    hidden_states = outputs.hidden_states or ()
    report = {
        "model": MODEL_ID,
        "depth_shape": list(outputs.predicted_depth.shape),
        "attention_layers": len(attentions),
        "attention_shapes": [list(tensor.shape) for tensor in attentions],
        "hidden_state_count": len(hidden_states),
        "hidden_state_shapes": [list(tensor.shape) for tensor in hidden_states],
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
