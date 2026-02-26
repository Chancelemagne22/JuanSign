# Architectural Guide — JuanSign ML Pipeline

> Covers the ResNet18 + LSTM model architecture, the complete forward pass with tensor shapes at every step, and the `forward_pass_viz.py` visualization script that traces all seven stages.

---

## Architecture Overview

JuanSign uses a **CNN + LSTM hybrid** to classify Filipino Sign Language (FSL) hand signs from short video clips.

```
Video Clip  [B, T=16, C=3, H=224, W=224]
       │
       ▼
┌─────────────────────────────────────────┐
│  ResNet18  (pretrained, last FC removed) │  ← feature_extractor
│  Processes all T frames simultaneously   │
│  Input  : [B×T,   3, 224, 224]          │
│  Output : [B×T, 512,   1,   1]          │
└─────────────────────────────────────────┘
       │  reshape → [B, T=16, 512]
       ▼
┌─────────────────────────────────────────┐
│  LSTM  (input=512, hidden=256, layers=1) │
│  Reads the 16-frame feature sequence     │
│  Output : [B, T=16, 256]                │
└─────────────────────────────────────────┘
       │  take last timestep → [B, 256]
       ▼
   Dropout (p=0.5)
       │
       ▼
┌─────────────────────────────────────────┐
│  Linear (256 → 5)                        │  ← classifier head
│  Output : [B, 5]  raw logits            │
└─────────────────────────────────────────┘
       │
       ▼
  CrossEntropyLoss / Softmax → class prediction
```

**Model file:** `resnet_lstm_architecture.py` — `class ResNetLSTM`

---

## Forward Pass — Full Tensor Shape Trace

| Step | Operation | Input Shape | Output Shape | Notes |
|---|---|---|---|---|
| 0 | Raw clip | — | `[B, 16, 3, 224, 224]` | B clips, 16 frames each, 3-channel 224×224 |
| 1 | `view` flatten time | `[B, 16, 3, 224, 224]` | `[B×16, 3, 224, 224]` | All frames batched for ResNet |
| 2 | ResNet Conv1 + BN + ReLU + MaxPool | `[B×16, 3, 224, 224]` | `[B×16, 64, 56, 56]` | 7×7 conv, stride 2 + 3×3 pool stride 2 |
| 3 | ResNet layer1 (2 blocks) | `[B×16, 64, 56, 56]` | `[B×16, 64, 56, 56]` | **Stage 2 hook** — early edge/texture features |
| 4 | ResNet layer2 (2 blocks) | `[B×16, 64, 56, 56]` | `[B×16, 128, 28, 28]` | Stride 2 downsampling |
| 5 | ResNet layer3 (2 blocks) | `[B×16, 128, 28, 28]` | `[B×16, 256, 14, 14]` | Stride 2 downsampling |
| 6 | ResNet layer4 (2 blocks) | `[B×16, 256, 14, 14]` | `[B×16, 512, 7, 7]` | **Stage 3 hook** — semantic 7×7 features |
| 7 | AdaptiveAvgPool(1,1) | `[B×16, 512, 7, 7]` | `[B×16, 512, 1, 1]` | **Stage 4 hook** — one vector per frame |
| 8 | `view` reshape time | `[B×16, 512, 1, 1]` | `[B, 16, 512]` | 16 feature vectors fed to LSTM |
| 9 | LSTM (hidden=256) | `[B, 16, 512]` | `[B, 16, 256]` | **Stage 5 hook** — full hidden-state sequence |
| 10 | Take last timestep `[:, -1, :]` | `[B, 16, 256]` | `[B, 256]` | Only the final state drives prediction |
| 11 | Dropout (p=0.5) | `[B, 256]` | `[B, 256]` | Applied during training only |
| 12 | Linear (256 → 5) | `[B, 256]` | `[B, 5]` | Raw logits (one per class) |
| 13 | Softmax / argmax | `[B, 5]` | class index | **Stage 7** — final prediction |

---

## Component Details

### ResNet18 as Feature Extractor

ResNet18 is loaded with ImageNet pretrained weights (`IMAGENET1K_V1`) and the final `Linear(512, 1000)` layer is removed. The remaining 8 children form `self.feature_extractor`:

```
feature_extractor[0]  Conv2d(3, 64, kernel=7, stride=2, pad=3)
feature_extractor[1]  BatchNorm2d(64)
feature_extractor[2]  ReLU
feature_extractor[3]  MaxPool2d(kernel=3, stride=2, pad=1)
feature_extractor[4]  Sequential — layer1  (2× BasicBlock, 64 ch)
feature_extractor[5]  Sequential — layer2  (2× BasicBlock, 128 ch, stride 2)
feature_extractor[6]  Sequential — layer3  (2× BasicBlock, 256 ch, stride 2)
feature_extractor[7]  Sequential — layer4  (2× BasicBlock, 512 ch, stride 2)
feature_extractor[8]  AdaptiveAvgPool2d(output_size=1)
```

Each `BasicBlock` contains two `Conv2d → BN → ReLU` stacks plus a residual skip connection.

The backbone is **frozen for the first 10 epochs** of training (`FREEZE_EPOCHS = 10`) to let the LSTM and classifier head stabilise before fine-tuning the full network end-to-end.

---

### LSTM — Temporal Modelling

```python
nn.LSTM(input_size=512, hidden_size=256, num_layers=1, batch_first=True)
```

- Reads the 16-frame feature sequence `[B, 16, 512]` left-to-right
- Produces a hidden state at every timestep `[B, 16, 256]`
- Only the **final hidden state** `lstm_out[:, -1, :]` is used for classification — it carries temporal context accumulated across all 16 frames
- Single layer; no bidirectionality

---

### Classifier Head

```python
Dropout(p=0.5)  →  Linear(256, num_classes=5)
```

- Dropout is active **only during training** (`model.train()`); disabled during `model.eval()`
- The 5 output logits correspond to classes in alphabetical order: A=0, B=1, C=2, G=3, H=4
- `CrossEntropyLoss` applies softmax internally during training; `torch.softmax` is used explicitly at inference time

---

## Grad-CAM — Spatial Attention

Grad-CAM (`gradcam.py`) hooks `feature_extractor[7]` (layer4) to answer:
**"Which 7×7 spatial regions drove the classification decision?"**

```
Forward pass  → save layer4 activations [B×T, 512, 7, 7]
Backward pass → save layer4 gradients   [B×T, 512, 7, 7]
             → global average pool gradients per channel
             → weighted sum of activations → ReLU → normalize
             → cam: float32 [7, 7] in [0, 1]
             → resize to 224×224, apply Jet colormap, blend with original
```

The heatmap is averaged over all 16 timesteps, giving the model's aggregate spatial attention for the entire clip.

---

## Visualization Script — `forward_pass_viz.py`

### What It Covers

The script traces one clip through the full pipeline and produces **seven PNG files**, one per stage:

| File | Stage | What It Shows |
|---|---|---|
| `forward_pass_stage1_raw_input.png` | Raw Input | 16 frames in a 2×8 temporal grid |
| `forward_pass_stage2_early_features.png` | Early CNN | 16 of 64 layer1 channels at 56×56 — edges and textures |
| `forward_pass_stage3_deep_features.png` | Deep CNN | 16 of 512 layer4 channels at 7×7 — semantic detectors |
| `forward_pass_stage4_frame_features.png` | CNN→LSTM | 16×512 heatmap — how each frame's vector differs over time |
| `forward_pass_stage5_lstm_states.png` | LSTM | 16×256 heatmap — how temporal context evolves; last row feeds classifier |
| `forward_pass_stage6_gradcam.png` | Grad-CAM | Spatial saliency overlaid on frames t=0, 5, 10, 15 |
| `forward_pass_stage7_classification.png` | Output | Softmax bar chart; predicted class highlighted in gold |

### How the Hooks Work

```
ForwardPassInspector registers four forward hooks:

  feature_extractor[4]  →  layer1_fmaps  [B×T, 64,  56, 56]   Stage 2
  feature_extractor[7]  →  layer4_fmaps  [B×T, 512,  7,  7]   Stage 3
  feature_extractor[8]  →  frame_feats   [B×T, 512]            Stage 4
  model.lstm            →  lstm_states   [T,   256]             Stage 5
```

Two separate forward passes are made:
- **Pass 1** (`torch.no_grad`): captures stages 2–5 via hooks, returns logits for stages 1 and 7
- **Pass 2** (with gradients): GradCAM backward pass for stage 6

### How to Run

```bash
# From repo root
cd ml-model/src
python forward_pass_viz.py
```

Configure the two paths at the top of the file before running:

```python
MODEL_PATH = "../juansignmodel/juansign_model.pth"
CLIP_DIR   = "../../processed_output/frame_extracted/testing_data/A/clip001"
```

Output PNGs are saved to `ml-model/`.

---

## ML Source File Index

| File | Role |
|---|---|
| `resnet_lstm_architecture.py` | Model definition — `ResNetLSTM` class |
| `fsl_dataset.py` | `FSLDataset` — loads 16-frame clip folders |
| `train.py` | Training loop with scheduler, early stopping, TensorBoard |
| `frame_extractor.py` | Extracts 16 frames per clip from raw video |
| `data_splitter.py` | Splits `raw_data/` into train / test / val folders |
| `predict_sign.py` | Single-clip inference returning class + confidence |
| `forward_pass_viz.py` | **Full pipeline visualization — 7 stages** |
| `gradcam.py` | Grad-CAM class + overlay builder |
| `model_visualization.py` | Confusion matrix and classification report |
| `layer_visualization.py` | Standalone layer1 feature map viewer |

---

## Constants Shared Across Files

These values are hardcoded in multiple files and must stay in sync:

| Constant | Value | Files |
|---|---|---|
| Frame count | `16` | `frame_extractor.py`, `predict_sign.py`, `gradcam.py` |
| Image size | `224 × 224` | `frame_extractor.py`, `fsl_dataset.py`, `predict_sign.py` |
| Classes | `["A","B","C","G","H"]` | `train.py`, `predict_sign.py`, `gradcam.py`, `forward_pass_viz.py` |
| ImageNet mean | `[0.485, 0.456, 0.406]` | `fsl_dataset.py`, `predict_sign.py`, `gradcam.py`, `forward_pass_viz.py` |
| ImageNet std | `[0.229, 0.224, 0.225]` | same as above |
| LSTM hidden | `256` | `resnet_lstm_architecture.py` |
| ResNet output | `512` | `resnet_lstm_architecture.py` |
