# ml-model/src/resnet_lstm_architecture.py
#
# Enhanced JuanSign architecture — full pipeline:
#
#   Stream A (visual)   : 5-ch frames → ResNet18 → [B, 32, 512]
#   Stream B (geometric): landmarks   → MLP + LSTM → [B, 32, 64]
#   Fusion              : concat      → [B, 32, 576]
#   Temporal            : BiLSTM ×2  → last hidden [B, 512]
#   Classifier          : Dropout + FC + Softmax → [B, num_classes]
#
# Input shapes expected from FSLDataset / collate_fn:
#   frames    : [B, 32, 5, 224, 224]   float32
#   landmarks : [B, 32, 63]            float32
#
# Constants that must stay in sync across the project:
#   TARGET_FRAMES    = 32
#   RESNET_OUT       = 512   (ResNet18 AdaptiveAvgPool output)
#   LANDMARK_FEATURE = 63    (21 landmarks × 3 coords)
#   LANDMARK_HIDDEN  = 64    (MLP + landmark LSTM output size)
#   LSTM_HIDDEN      = 256   (per direction — 512 total after bidirectional)

import torch
import torch.nn as nn
from torchvision import models

# ── Constants ─────────────────────────────────────────────────────────────────
TARGET_FRAMES    = 32
RESNET_OUT       = 512
LANDMARK_FEATURE = 63    # 21 landmarks × (x, y, z)
LANDMARK_HIDDEN  = 64
LSTM_HIDDEN      = 256   # per direction
LSTM_LAYERS      = 2
LSTM_TOTAL_OUT   = LSTM_HIDDEN * 2   # 512 — bidirectional doubles the output
DROPOUT_P        = 0.5


# ══════════════════════════════════════════════════════════════════════════════
# STREAM A — VISUAL ENCODER  (5-channel ResNet18)
# ══════════════════════════════════════════════════════════════════════════════

class VisualEncoder(nn.Module):
    """
    ResNet18 backbone modified to accept 5-channel input instead of 3-channel.

    Why we can't just pass in 5-channel frames to a standard ResNet18:
        ResNet18's first Conv layer (Conv1) has weight shape [64, 3, 7, 7].
        A 5-channel input needs [64, 5, 7, 7]. We can't change in_channels
        after loading pretrained weights — the shapes don't match.

    Solution — transfer the pretrained weights carefully:
        1. Load ResNet18 with pretrained ImageNet weights (3-channel).
        2. Replace Conv1 with a new [64, 5, 7, 7] conv layer.
        3. Copy the original RGB weights [64, 3, 7, 7] into channels 0–2.
        4. Initialise the new flow channels (3–4) with the mean of the RGB
           weights — a good starting point so flow isn't pure noise at epoch 0.
        5. Remove the final FC layer — we only want the 512-d feature vector.

    This is called "weight inflation" and is standard practice when expanding
    the input channels of a pretrained network.
    """

    def __init__(self):
        super().__init__()

        # Load pretrained ResNet18
        resnet = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)

        # ── Inflate Conv1 from 3 → 5 channels ────────────────────────────────
        old_conv   = resnet.conv1              # weight shape: [64, 3, 7, 7]
        new_conv   = nn.Conv2d(
            in_channels  = 5,
            out_channels = 64,
            kernel_size  = 7,
            stride       = 2,
            padding      = 3,
            bias         = False,
        )

        with torch.no_grad():
            # Copy RGB weights into channels 0–2 (unchanged)
            new_conv.weight[:, :3, :, :] = old_conv.weight

            # Initialise flow channels (3, 4) with the mean of RGB weights
            # Mean across channel dim → [64, 1, 7, 7] → broadcast to 2 channels
            mean_rgb = old_conv.weight.mean(dim=1, keepdim=True)
            new_conv.weight[:, 3:, :, :] = mean_rgb.expand(-1, 2, -1, -1)

        resnet.conv1 = new_conv

        # ── Remove final FC — keep everything up to AdaptiveAvgPool ──────────
        # resnet.children() order:
        #   [0] conv1  [1] bn1    [2] relu   [3] maxpool
        #   [4] layer1 [5] layer2 [6] layer3 [7] layer4
        #   [8] avgpool [9] flatten [10] fc
        # We keep [0]–[8] → output shape [B*T, 512, 1, 1]
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-2])
        self.pool = nn.AdaptiveAvgPool2d((1, 1))

    def forward(self, x):
        """
        x : [B, T, 5, H, W]   (T = TARGET_FRAMES = 32)
        Returns : [B, T, 512]
        """
        B, T, C, H, W = x.size()

        # Flatten time into batch for ResNet: [B*T, 5, H, W]
        x = x.view(B * T, C, H, W)

        # ResNet forward (up to layer4): [B*T, 512, 7, 7]
        x = self.feature_extractor(x)

        # Pool to [B*T, 512, 1, 1] → squeeze → [B*T, 512]
        x = self.pool(x)
        x = x.view(B * T, RESNET_OUT)

        # Reshape back to sequence: [B, T, 512]
        x = x.view(B, T, RESNET_OUT)
        return x


# ══════════════════════════════════════════════════════════════════════════════
# STREAM B — LANDMARK ENCODER  (MLP + LSTM)
# ══════════════════════════════════════════════════════════════════════════════

class LandmarkEncoder(nn.Module):
    """
    Processes the 63-d landmark vector per frame through two stages:

    Stage 1 — MLP (per frame, no temporal reasoning yet):
        63 → 128 → 64
        Compresses raw coordinates into a compact geometric representation.
        BatchNorm + ReLU for stability. Applied identically to each frame
        by flattening time into batch (same trick as VisualEncoder).

    Stage 2 — LSTM (temporal reasoning over landmark sequences):
        64 → LANDMARK_HIDDEN (64)
        Learns how the hand geometry *changes over time* — trajectories,
        speed of joint movement, which fingers open or close across frames.
        This is what makes J and Z distinguishable from static letters even
        when the cropped frame looks similar at a single timestep.
    """

    def __init__(self):
        super().__init__()

        # Per-frame MLP — projects 63-d coords to 64-d geometric features
        self.mlp = nn.Sequential(
            nn.Linear(LANDMARK_FEATURE, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(inplace=True),
            nn.Dropout(p=0.2),

            nn.Linear(128, LANDMARK_HIDDEN),
            nn.BatchNorm1d(LANDMARK_HIDDEN),
            nn.ReLU(inplace=True),
        )

        # Temporal LSTM over landmark sequences
        # Not bidirectional here — we keep it lightweight since landmark
        # features are already compact. The main BiLSTM handles full context.
        self.lstm = nn.LSTM(
            input_size  = LANDMARK_HIDDEN,
            hidden_size = LANDMARK_HIDDEN,
            num_layers  = 1,
            batch_first = True,
            dropout     = 0.0,
        )

    def forward(self, landmarks):
        """
        landmarks : [B, T, 63]
        Returns   : [B, T, 64]
        """
        B, T, _ = landmarks.size()

        # Flatten time for MLP: [B*T, 63]
        lm = landmarks.view(B * T, LANDMARK_FEATURE)

        # MLP forward: [B*T, 64]
        lm = self.mlp(lm)

        # Reshape back to sequence: [B, T, 64]
        lm = lm.view(B, T, LANDMARK_HIDDEN)

        # LSTM forward: [B, T, 64]
        lm, _ = self.lstm(lm)

        return lm


# ══════════════════════════════════════════════════════════════════════════════
# FUSION + TEMPORAL CLASSIFIER
# ══════════════════════════════════════════════════════════════════════════════

class ResNetLSTM(nn.Module):
    """
    Full JuanSign enhanced architecture.

    Forward pass summary:
        frames    [B, 32, 5, 224, 224] → VisualEncoder   → [B, 32, 512]
        landmarks [B, 32, 63]          → LandmarkEncoder → [B, 32,  64]
                                                  concat → [B, 32, 576]
                                               BiLSTM ×2 → [B, 32, 512]
                                          last timestep  → [B, 512]
                                               Dropout   → [B, 512]
                                                     FC  → [B, num_classes]

    Arguments:
        num_classes : int — number of FSL signs to classify.
                      Set to match len(CLASS_NAMES) in train.py and main.py.

    Layer index map (for GradCAM — target is still visual_encoder.feature_extractor[7]):
        visual_encoder.feature_extractor[0]  Conv1 (7×7, 64ch, stride 2) ← now 5-channel
        visual_encoder.feature_extractor[1]  BN1
        visual_encoder.feature_extractor[2]  ReLU
        visual_encoder.feature_extractor[3]  MaxPool
        visual_encoder.feature_extractor[4]  layer1 — 64ch,  56×56
        visual_encoder.feature_extractor[5]  layer2 — 128ch, 28×28
        visual_encoder.feature_extractor[6]  layer3 — 256ch, 14×14
        visual_encoder.feature_extractor[7]  layer4 — 512ch,  7×7   ← GradCAM target
    """

    def __init__(self, num_classes):
        super().__init__()

        self.num_classes = num_classes

        # ── Stream A ──────────────────────────────────────────────────────────
        self.visual_encoder   = VisualEncoder()

        # ── Stream B ──────────────────────────────────────────────────────────
        self.landmark_encoder = LandmarkEncoder()

        # ── Fusion input size ─────────────────────────────────────────────────
        # 512 (ResNet) + 64 (landmarks) = 576
        fusion_size = RESNET_OUT + LANDMARK_HIDDEN   # 576

        # ── Main BiLSTM ───────────────────────────────────────────────────────
        # bidirectional=True  → reads sequence forward AND backward
        # num_layers=2        → layer 1 learns low-level motion patterns,
        #                        layer 2 learns high-level sign structure
        # dropout between layers (only applies when num_layers > 1)
        self.bilstm = nn.LSTM(
            input_size  = fusion_size,
            hidden_size = LSTM_HIDDEN,        # 256 per direction
            num_layers  = LSTM_LAYERS,        # 2
            batch_first = True,
            bidirectional = True,
            dropout     = 0.3,                # between layer 1 and layer 2
        )

        # ── Classifier head ───────────────────────────────────────────────────
        self.dropout = nn.Dropout(p=DROPOUT_P)
        self.fc      = nn.Linear(LSTM_TOTAL_OUT, num_classes)  # 512 → num_classes

    def forward(self, frames, landmarks):
        """
        frames    : [B, T, 5, 224, 224]
        landmarks : [B, T, 63]

        Returns   : [B, num_classes]  raw logits (no softmax — use CrossEntropyLoss)
        """

        # ── Stream A: visual features ─────────────────────────────────────────
        visual_feat = self.visual_encoder(frames)         # [B, T, 512]

        # ── Stream B: geometric features ─────────────────────────────────────
        landmark_feat = self.landmark_encoder(landmarks)  # [B, T, 64]

        # ── Fusion: concatenate along feature dimension ───────────────────────
        fused = torch.cat([visual_feat, landmark_feat], dim=2)  # [B, T, 576]

        # ── BiLSTM: temporal reasoning over fused sequence ───────────────────
        lstm_out, _ = self.bilstm(fused)    # [B, T, 512]  (256 fwd + 256 bwd)

        # Take only the last timestep — the LSTM's final summary of the clip
        last_hidden = lstm_out[:, -1, :]    # [B, 512]

        # ── Classifier head ───────────────────────────────────────────────────
        out = self.dropout(last_hidden)     # [B, 512]
        out = self.fc(out)                  # [B, num_classes]

        return out

    # ── Convenience utilities ─────────────────────────────────────────────────

    def freeze_backbone(self):
        """
        Freeze all ResNet18 parameters.
        Call this before training starts (epochs 0–FREEZE_EPOCHS).
        Only the LandmarkEncoder, BiLSTM, and FC will train.
        """
        for param in self.visual_encoder.parameters():
            param.requires_grad = False
        print("[Model] ResNet18 backbone FROZEN")

    def unfreeze_backbone(self):
        """
        Unfreeze all ResNet18 parameters for end-to-end fine-tuning.
        Call this at epoch == FREEZE_EPOCHS in train.py.
        """
        for param in self.visual_encoder.parameters():
            param.requires_grad = True
        print("[Model] ResNet18 backbone UNFROZEN — full fine-tuning")

    def count_parameters(self):
        """Print a breakdown of trainable parameter counts per sub-module."""
        def count(module):
            return sum(p.numel() for p in module.parameters() if p.requires_grad)

        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)

        print(f"\n── Parameter count ──────────────────────────────")
        print(f"  VisualEncoder    : {count(self.visual_encoder):>10,}")
        print(f"  LandmarkEncoder  : {count(self.landmark_encoder):>10,}")
        print(f"  BiLSTM           : {count(self.bilstm):>10,}")
        print(f"  FC + Dropout     : {count(self.fc):>10,}")
        print(f"  ─────────────────────────────────────────────")
        print(f"  Trainable        : {trainable:>10,}")
        print(f"  Total            : {total:>10,}")
        print()


# ══════════════════════════════════════════════════════════════════════════════
# SANITY CHECK
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys

    num_classes = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    device      = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    print(f"\nBuilding ResNetLSTM with num_classes={num_classes} on {device}\n")
    model = ResNetLSTM(num_classes=num_classes).to(device)
    model.count_parameters()

    # Dummy forward pass — shapes must match FSLDataset output
    B, T = 2, TARGET_FRAMES
    dummy_frames    = torch.randn(B, T, 5, 224, 224).to(device)
    dummy_landmarks = torch.randn(B, T, LANDMARK_FEATURE).to(device)

    print(f"Input  — frames    : {list(dummy_frames.shape)}")
    print(f"Input  — landmarks : {list(dummy_landmarks.shape)}")

    model.eval()
    with torch.no_grad():
        logits = model(dummy_frames, dummy_landmarks)

    print(f"Output — logits    : {list(logits.shape)}")    # [2, num_classes]
    print(f"Output — probs     : {torch.softmax(logits, dim=1)}")

    # Test freeze / unfreeze
    print()
    model.freeze_backbone()
    frozen_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Trainable when frozen  : {frozen_trainable:,}")

    model.unfreeze_backbone()
    full_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Trainable when unfrozen: {full_trainable:,}")