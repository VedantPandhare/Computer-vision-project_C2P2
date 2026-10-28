export type QualityProfileId = 'fast' | 'balanced' | 'quality';

export interface QualityProfile {
  id: QualityProfileId;
  label: string;
  modelTarget: number;
  flowWidth: number;
  flowHeight: number;
  suggestedInterval: number;
}

export const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile> = {
  fast: { id: 'fast', label: 'Fast', modelTarget: 336, flowWidth: 128, flowHeight: 96, suggestedInterval: 7 },
  balanced: { id: 'balanced', label: 'Balanced', modelTarget: 448, flowWidth: 160, flowHeight: 120, suggestedInterval: 5 },
  quality: { id: 'quality', label: 'Quality', modelTarget: 518, flowWidth: 224, flowHeight: 168, suggestedInterval: 3 },
};

export const MODEL_CONFIG = {
  id: 'depth-anything-v2-small',
  label: 'Depth Anything V2 Small',
  url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx',
  inputWidth: 518,
  inputHeight: 518,
  channels: 3,
} as const;

