"""
forward_pass_viz.py
-------------------
Visualizes the complete CNN + LSTM forward pass for one video clip,
tracing the data from raw frames all the way to the final prediction.

Seven stages are produced as separate PNG files:
  Stage 1 — Raw Input          16 sampled frames (temporal grid)
  Stage 2 — Early CNN Features ResNet18 layer1 activations (64 ch, 56×56)
  Stage 3 — Deep CNN Features  ResNet18 layer4 activations (512 ch, 7×7)
  Stage 4 — Frame Features     16×512 temporal feature matrix (CNN → LSTM bridge)
  Stage 5 — LSTM Hidden States 16×256 hidden-state sequence across timesteps
  Stage 6 — Grad-CAM Saliency  Spatial attention overlaid on 4 representative frames
  Stage 7 — Classification     Softmax probability bar chart and final prediction

Run from ml-model/src/:
    python forward_pass_viz.py

Output PNGs are saved to ml-model/ (one file per stage).
"""

import os
import torch
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import cv2
from PIL import Image
from torchvision import transforms

from resnet_lstm_architecture import ResNetLSTM
from gradcam import GradCAM, build_overlay

# ── Configuration ──────────────────────────────────────────────────────────────
# Adjust these paths before running.

MODEL_PATH  = "./juansignmodel/juansign_model.pth"

# Path to any processed clip folder (must contain exactly 16 frame*.jpg files).
CLIP_DIR    = "./processed_output/frame_extracted/validation_data/J/clip027"

CLASS_NAMES = ["A", "B", "C", "J", "O"]   # must match training order (alphabetical)
OUTPUT_DIR  = "../model_visual"                          # saves PNGs to ml-model/

# Frames shown in Stage 6 Grad-CAM — four evenly spaced indices across the clip
GRADCAM_FRAMES = [0, 5, 10, 15]

# ── Device ─────────────────────────────────────────────────────────────────────
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")


# ── Eval transform (no augmentation) ──────────────────────────────────────────
# Identical to eval_transform in train.py — used for honest predictions.
eval_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])


# ── Helpers ────────────────────────────────────────────────────────────────────

def load_clip(clip_dir, transform):
    """
    Load all 16 frame*.jpg files from clip_dir.

    Returns:
        clip_tensor : Tensor [1, 16, 3, 224, 224] on device — model input
        pil_frames  : list of 16 raw PIL Images — used for display
        frame_paths : list of 16 absolute file paths — used for Grad-CAM overlay
    """
    frame_files = sorted(f for f in os.listdir(clip_dir) if f.endswith('.jpg'))[:16]
    if len(frame_files) < 16:
        raise ValueError(
            f"Clip '{clip_dir}' has only {len(frame_files)} frames — need exactly 16."
        )

    pil_frames  = []
    tensors     = []
    frame_paths = []

    for fname in frame_files:
        path = os.path.join(clip_dir, fname)
        img  = Image.open(path).convert("RGB")
        pil_frames.append(img)
        tensors.append(transform(img))
        frame_paths.append(path)

    clip_tensor = torch.stack(tensors).unsqueeze(0).to(device)  # [1, 16, 3, 224, 224]
    return clip_tensor, pil_frames, frame_paths


def denormalize(tensor):
    """
    Undo ImageNet normalization so tensors can be displayed as images.
    tensor : [3, H, W] CPU float
    Returns: [H, W, 3] uint8 numpy array
    """
    mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
    std  = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
    img  = (tensor.cpu() * std + mean).clamp(0, 1)
    return (img.permute(1, 2, 0).numpy() * 255).astype(np.uint8)


def save_fig(fig, filename):
    """Save figure to OUTPUT_DIR and print confirmation."""
    path = os.path.join(OUTPUT_DIR, filename)
    fig.savefig(path, dpi=150, bbox_inches="tight")
    print(f"  Saved → {path}")


# ── Forward-pass inspector (forward hooks) ─────────────────────────────────────

class ForwardPassInspector:
    """
    Attaches forward hooks to four checkpoints inside ResNetLSTM and records
    the intermediate tensors produced during one forward call.

    Captured tensors (set after calling model(clip_tensor)):
        layer1_fmaps  [B*T, 64,  56, 56]  ResNet layer1 output  (early spatial)
        layer4_fmaps  [B*T, 512,  7,  7]  ResNet layer4 output  (deep semantic)
        frame_feats   [T,  512]            Per-frame 512-d vectors (CNN → LSTM)
        lstm_states   [T,  256]            LSTM output sequence    (temporal context)

    All tensors are detached and moved to CPU immediately.
    B=1, T=16 for single-clip inference.
    """

    def __init__(self, model):
        self.model        = model
        self.layer1_fmaps = None   # [B*T, 64,  56, 56]
        self.layer4_fmaps = None   # [B*T, 512,  7,  7]
        self.frame_feats  = None   # [T,   512]
        self.lstm_states  = None   # [T,   256]
        self._hooks       = []

        # feature_extractor index map (ResNet18 children, last FC removed):
        #   [0] Conv1  7×7, 64, stride 2
        #   [1] BN1
        #   [2] ReLU
        #   [3] MaxPool
        #   [4] layer1 — 2 BasicBlocks, 64 ch  ← Stage 2 hook
        #   [5] layer2 — 2 BasicBlocks, 128 ch
        #   [6] layer3 — 2 BasicBlocks, 256 ch
        #   [7] layer4 — 2 BasicBlocks, 512 ch  ← Stage 3 hook
        #   [8] AdaptiveAvgPool(1,1)             ← Stage 4 hook (frame vectors)

        self._hooks.append(
            model.feature_extractor[4].register_forward_hook(self._hook_layer1)
        )
        self._hooks.append(
            model.feature_extractor[7].register_forward_hook(self._hook_layer4)
        )
        self._hooks.append(
            model.feature_extractor[8].register_forward_hook(self._hook_frame_feats)
        )
        self._hooks.append(
            model.lstm.register_forward_hook(self._hook_lstm)
        )

    # ── Hook callbacks ──────────────────────────────────────────────────────

    def _hook_layer1(self, module, inp, out):
        # out: [B*T, 64, 56, 56]
        self.layer1_fmaps = out.detach().cpu()

    def _hook_layer4(self, module, inp, out):
        # out: [B*T, 512, 7, 7]
        self.layer4_fmaps = out.detach().cpu()

    def _hook_frame_feats(self, module, inp, out):
        # AdaptiveAvgPool output: [B*T, 512, 1, 1]
        # Squeeze spatial dims → [B*T, 512] then take first B → [T, 512]
        self.frame_feats = out.detach().cpu().squeeze(-1).squeeze(-1)  # [B*T, 512]

    def _hook_lstm(self, module, inp, out):
        # LSTM returns (output, (h_n, c_n))
        # output: [B, T, hidden_size=256]
        lstm_output = out[0].detach().cpu()  # [B, T, 256]
        self.lstm_states = lstm_output[0]    # take first item in batch → [T, 256]

    def remove_hooks(self):
        for h in self._hooks:
            h.remove()


# ── Stage functions ────────────────────────────────────────────────────────────

def stage1_raw_input(pil_frames, predicted_class, confidence):
    """
    Stage 1: display all 16 raw input frames as a 2×8 temporal grid.
    Shows the clip exactly as it was loaded from disk (no normalization).
    """
    fig, axes = plt.subplots(2, 8, figsize=(22, 6))
    fig.patch.set_facecolor("#1a1a2e")

    for t, (frame, ax) in enumerate(zip(pil_frames, axes.flat)):
        ax.imshow(frame)
        ax.set_title(f"t = {t}", fontsize=8, color="white")
        ax.axis("off")

    fig.suptitle(
        f"Stage 1 — Raw Input  |  16-Frame Clip  [B=1, T=16, C=3, H=224, W=224]\n"
        f"Prediction: {predicted_class}  ({confidence:.1f}% confidence)",
        fontsize=11, color="white", y=1.01
    )
    plt.tight_layout()
    save_fig(fig, "forward_pass_stage1_raw_input.png")
    plt.show()


def stage2_early_features(layer1_fmaps):
    """
    Stage 2: show 16 feature map channels from ResNet18 layer1 (the first
    residual block). At this depth the network detects low-level cues —
    edges, colour gradients, and simple textures.

    layer1_fmaps: [B*T, 64, 56, 56] — uses frame t=0.
    Displays a 4×4 grid of the first 16 channels.
    """
    frame0_fmaps = layer1_fmaps[0]  # [64, 56, 56] — first frame

    fig, axes = plt.subplots(4, 4, figsize=(12, 12))
    fig.patch.set_facecolor("#1a1a2e")
    fig.suptitle(
        "Stage 2 — Early CNN Feature Maps  |  ResNet18 layer1  "
        "[B*T=16, C=64, H=56, W=56]\n"
        "Showing 16 of 64 channels from frame t=0 — low-level edges and textures",
        fontsize=10, color="white"
    )

    for i, ax in enumerate(axes.flat):
        fmap = frame0_fmaps[i].numpy()
        im   = ax.imshow(fmap, cmap="viridis",
                         vmin=fmap.min(), vmax=fmap.max())
        ax.set_title(f"ch {i}", fontsize=8, color="white")
        ax.axis("off")

    plt.tight_layout()
    save_fig(fig, "forward_pass_stage2_early_features.png")
    plt.show()


def stage3_deep_features(layer4_fmaps):
    """
    Stage 3: show 16 feature map channels from ResNet18 layer4 (the last
    residual block). At 7×7 spatial resolution each activation region covers
    roughly 32×32 pixels of the original image. These detectors respond to
    high-level semantic concepts — hand shapes, finger configurations.

    layer4_fmaps: [B*T, 512, 7, 7] — uses frame t=0.
    Displays a 4×4 grid of the first 16 channels.
    """
    frame0_fmaps = layer4_fmaps[0]  # [512, 7, 7] — first frame

    fig, axes = plt.subplots(4, 4, figsize=(10, 10))
    fig.patch.set_facecolor("#1a1a2e")
    fig.suptitle(
        "Stage 3 — Deep CNN Feature Maps  |  ResNet18 layer4  "
        "[B*T=16, C=512, H=7, W=7]\n"
        "Showing 16 of 512 channels from frame t=0 — high-level semantic detectors",
        fontsize=10, color="white"
    )

    for i, ax in enumerate(axes.flat):
        fmap = frame0_fmaps[i].numpy()
        im   = ax.imshow(fmap, cmap="plasma",
                         vmin=fmap.min(), vmax=fmap.max())
        ax.set_title(f"ch {i}", fontsize=8, color="white")
        ax.axis("off")

    plt.tight_layout()
    save_fig(fig, "forward_pass_stage3_deep_features.png")
    plt.show()


def stage4_frame_features(frame_feats):
    """
    Stage 4: visualize the 16×512 temporal feature matrix — the bridge
    between the CNN and the LSTM.

    Each row is the 512-d feature vector produced by ResNet18 for one frame.
    Patterns across rows reveal how the hand-sign's CNN representation
    changes over time (stable sign → uniform rows; transition → row variation).

    frame_feats: [B*T, 512] — squeezed from [B*T, 512, 1, 1].
    Takes the first 16 rows (one batch item, T=16).
    """
    feats = frame_feats[:16].numpy()  # [16, 512]

    fig, ax = plt.subplots(figsize=(18, 5))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#1a1a2e")

    im = ax.imshow(feats, aspect="auto", cmap="viridis",
                   interpolation="nearest")
    ax.set_xlabel("Feature Dimension  (0 – 511)", color="white", fontsize=11)
    ax.set_ylabel("Time Step  (frame index)", color="white", fontsize=11)
    ax.set_yticks(range(16))
    ax.set_yticklabels([f"t={i}" for i in range(16)], color="white", fontsize=8)
    ax.tick_params(colors="white")
    for spine in ax.spines.values():
        spine.set_edgecolor("white")

    cbar = fig.colorbar(im, ax=ax, fraction=0.02, pad=0.01)
    cbar.ax.yaxis.set_tick_params(color="white")
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color="white")

    ax.set_title(
        "Stage 4 — Frame Feature Sequence  |  CNN → LSTM Bridge  [T=16, D=512]\n"
        "Each row = 512-d ResNet18 representation of one frame after AdaptiveAvgPool",
        color="white", fontsize=11
    )

    plt.tight_layout()
    save_fig(fig, "forward_pass_stage4_frame_features.png")
    plt.show()


def stage5_lstm_states(lstm_states):
    """
    Stage 5: visualize the 16×256 LSTM hidden-state sequence.

    Each row is the 256-d hidden state the LSTM holds after processing
    frame t. The final row (t=15) is the state passed to the classifier head.
    Vertical stripes indicate 'memory units' that activate across timesteps;
    changes across rows show how the temporal context is refined.

    lstm_states: [T=16, H=256]
    """
    states = lstm_states.numpy()  # [16, 256]

    fig, ax = plt.subplots(figsize=(15, 5))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#1a1a2e")

    im = ax.imshow(states, aspect="auto", cmap="plasma",
                   interpolation="nearest")
    ax.set_xlabel("Hidden Dimension  (0 – 255)", color="white", fontsize=11)
    ax.set_ylabel("Time Step  (frame index)", color="white", fontsize=11)
    ax.set_yticks(range(16))
    ax.set_yticklabels([f"t={i}" for i in range(16)], color="white", fontsize=8)
    ax.tick_params(colors="white")
    for spine in ax.spines.values():
        spine.set_edgecolor("white")

    # Highlight the final timestep — its hidden state drives the prediction
    ax.axhline(15.5, color="yellow", linewidth=1.5, linestyle="--")
    ax.text(258, 15, "→ classifier", color="yellow", fontsize=8,
            va="center", clip_on=False)

    cbar = fig.colorbar(im, ax=ax, fraction=0.02, pad=0.01)
    cbar.ax.yaxis.set_tick_params(color="white")
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color="white")

    ax.set_title(
        "Stage 5 — LSTM Hidden States  [T=16, H=256]\n"
        "Each row = hidden state after processing one frame  |  "
        "Last row (dashed) feeds the Linear classifier",
        color="white", fontsize=11
    )

    plt.tight_layout()
    save_fig(fig, "forward_pass_stage5_lstm_states.png")
    plt.show()


def stage6_gradcam(model, clip_tensor, pil_frames, frame_paths,
                   predicted_class, confidence):
    """
    Stage 6: compute Grad-CAM on the full clip tensor and overlay the
    resulting heatmap on four representative frames.

    Grad-CAM back-propagates through layer4 to find which 7×7 spatial
    regions were most influential for the predicted class.
    The heatmap is averaged over all 16 timesteps then resized to 224×224.

    GRADCAM_FRAMES controls which four frame indices (0, 5, 10, 15) are shown.
    """
    gradcam = GradCAM(model)
    cam, class_idx = gradcam.compute(clip_tensor)  # cam: float32 [7, 7] in [0,1]
    gradcam.remove_hooks()

    fig, axes = plt.subplots(3, 4, figsize=(18, 12))
    fig.patch.set_facecolor("#1a1a2e")
    fig.suptitle(
        f"Stage 6 — Grad-CAM Saliency  |  Target layer: feature_extractor[7] (layer4)\n"
        f"Predicted: {predicted_class}  ({confidence:.1f}%)  —  "
        f"Heatmap averaged over T=16 timesteps, shown on frames {GRADCAM_FRAMES}",
        fontsize=11, color="white"
    )

    for col, t in enumerate(GRADCAM_FRAMES):
        original_rgb = np.array(pil_frames[t].resize((224, 224)))

        # Resize cam (7×7) to display resolution (224×224)
        cam_resized = cv2.resize(cam, (224, 224))
        heatmap_norm = np.uint8(255 * cam_resized)
        heatmap_bgr  = cv2.applyColorMap(heatmap_norm, cv2.COLORMAP_JET)
        heatmap_rgb  = cv2.cvtColor(heatmap_bgr, cv2.COLOR_BGR2RGB)

        # Blend with alpha=0.45
        overlay = cv2.addWeighted(original_rgb, 0.55, heatmap_rgb, 0.45, 0)

        row_labels = ["Original", "Heatmap", "Overlay"]
        images     = [original_rgb, heatmap_rgb, overlay]

        for row, (img, label) in enumerate(zip(images, row_labels)):
            ax = axes[row, col]
            ax.imshow(img)
            ax.set_title(
                f"{label}  t={t}" if row == 0 else label,
                fontsize=9, color="white"
            )
            ax.axis("off")

    plt.tight_layout()
    save_fig(fig, "forward_pass_stage6_gradcam.png")
    plt.show()


def stage7_classification(logits, predicted_class, confidence):
    """
    Stage 7: display softmax probabilities as a horizontal bar chart.

    The predicted class bar is highlighted in gold; all others are steel-blue.
    Shows the full probability distribution so over-confidence or close
    second-choice classes are immediately visible.

    logits: Tensor [1, num_classes] — raw model output before softmax.
    """
    probs = torch.softmax(logits, dim=1)[0].detach().cpu().numpy()  # [5]

    colours = [
        "#FFD700" if c == predicted_class else "#4a90d9"
        for c in CLASS_NAMES
    ]

    fig, ax = plt.subplots(figsize=(9, 5))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#1a1a2e")

    bars = ax.barh(CLASS_NAMES, probs * 100, color=colours, edgecolor="white",
                   linewidth=0.6, height=0.55)

    # Probability labels at bar ends
    for bar, prob in zip(bars, probs):
        ax.text(
            bar.get_width() + 0.8, bar.get_y() + bar.get_height() / 2,
            f"{prob * 100:.1f}%",
            va="center", ha="left", color="white", fontsize=10
        )

    ax.set_xlim(0, 115)
    ax.set_xlabel("Softmax Probability (%)", color="white", fontsize=11)
    ax.tick_params(colors="white", labelsize=11)
    for spine in ax.spines.values():
        spine.set_edgecolor("white")

    legend_patches = [
        mpatches.Patch(color="#FFD700", label=f"Predicted: {predicted_class}"),
        mpatches.Patch(color="#4a90d9",  label="Other classes"),
    ]
    ax.legend(handles=legend_patches, loc="lower right",
              facecolor="#1a1a2e", edgecolor="white",
              labelcolor="white", fontsize=9)

    ax.set_title(
        f"Stage 7 — Classification Output  |  "
        f"Linear(256→5) → Softmax\n"
        f"Predicted: {predicted_class}   Confidence: {confidence:.1f}%",
        color="white", fontsize=11
    )

    plt.tight_layout()
    save_fig(fig, "forward_pass_stage7_classification.png")
    plt.show()


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    # ── 1. Validate paths ──────────────────────────────────────────────────────
    if not os.path.isfile(MODEL_PATH):
        print(f"❌ Model not found: {MODEL_PATH}")
        print("   Train the model with train.py first.")
        return

    if not os.path.isdir(CLIP_DIR):
        print(f"❌ Clip folder not found: {CLIP_DIR}")
        print("   Run frame_extractor.py to generate processed clips.")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── 2. Load model ──────────────────────────────────────────────────────────
    model = ResNetLSTM(num_classes=len(CLASS_NAMES)).to(device)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("Model loaded successfully.")

    # ── 3. Load clip ───────────────────────────────────────────────────────────
    clip_tensor, pil_frames, frame_paths = load_clip(CLIP_DIR, eval_transform)
    print(f"Clip loaded: {CLIP_DIR}")
    print(f"  Tensor shape: {list(clip_tensor.shape)}")  # [1, 16, 3, 224, 224]

    # ── 4. Forward pass with hooks (no gradient needed) ───────────────────────
    inspector = ForwardPassInspector(model)

    with torch.no_grad():
        logits = model(clip_tensor)  # [1, 5]

    inspector.remove_hooks()

    # Prediction info used by multiple stages
    probs          = torch.softmax(logits, dim=1)[0]
    pred_idx       = probs.argmax().item()
    predicted_class = CLASS_NAMES[pred_idx]
    confidence     = probs[pred_idx].item() * 100

    print(f"\nPrediction: {predicted_class}  ({confidence:.1f}%)")
    print(f"All probabilities: { {c: f'{p*100:.1f}%' for c, p in zip(CLASS_NAMES, probs.tolist())} }")

    # ── 5. Plot all stages ─────────────────────────────────────────────────────
    print("\n── Generating stage plots ──")

    print("Stage 1: Raw input frames...")
    stage1_raw_input(pil_frames, predicted_class, confidence)

    print("Stage 2: Early CNN feature maps (layer1)...")
    stage2_early_features(inspector.layer1_fmaps)

    print("Stage 3: Deep CNN feature maps (layer4)...")
    stage3_deep_features(inspector.layer4_fmaps)

    print("Stage 4: Frame feature sequence [T=16, D=512]...")
    stage4_frame_features(inspector.frame_feats)

    print("Stage 5: LSTM hidden states [T=16, H=256]...")
    stage5_lstm_states(inspector.lstm_states)

    print("Stage 6: Grad-CAM saliency (requires gradient pass)...")
    # Grad-CAM runs its own forward+backward — separate from the no_grad pass above
    stage6_gradcam(model, clip_tensor, pil_frames, frame_paths,
                   predicted_class, confidence)

    print("Stage 7: Classification output...")
    stage7_classification(logits, predicted_class, confidence)

    print(f"\n✅ All stages saved to '{OUTPUT_DIR}/'")


if __name__ == "__main__":
    main()
