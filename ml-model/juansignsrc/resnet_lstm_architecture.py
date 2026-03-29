# ml-model/src/resnet_lstm_architecture.py
#
# Enhanced JuanSign architecture — Phrase-Ready (V2.1):
#
#   Stream A (visual)   : 5-ch frames → ResNet18 → [B, 32, 512]
#   Stream B (geometric): landmarks   → MLP + LSTM → [B, 32, 128]  <-- UPDATED
#   Fusion              : concat      → [B, 32, 640]               <-- UPDATED
#   Temporal            : BiLSTM ×2  → last hidden [B, 512]
#   Classifier          : Dropout + FC + Softmax → [B, num_classes]

import torch
import torch.nn as nn
from torchvision import models

# ── Constants ─────────────────────────────────────────────────────────────────
TARGET_FRAMES    = 32
RESNET_OUT       = 512
LANDMARK_FEATURE = 126   # UPDATED: 2 hands × 21 landmarks × (x, y, z)
LANDMARK_HIDDEN  = 128   # UPDATED: More capacity for two-hand coordination
LSTM_HIDDEN      = 256   # per direction
LSTM_LAYERS      = 2
LSTM_TOTAL_OUT   = LSTM_HIDDEN * 2   # 512 total
DROPOUT_P        = 0.5

# ══════════════════════════════════════════════════════════════════════════════
# STREAM A — VISUAL ENCODER (5-channel ResNet18)
# ══════════════════════════════════════════════════════════════════════════════

class VisualEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        resnet = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)

        # Inflate Conv1 from 3 → 5 channels
        old_conv = resnet.conv1
        new_conv = nn.Conv2d(5, 64, kernel_size=7, stride=2, padding=3, bias=False)

        with torch.no_grad():
            new_conv.weight[:, :3, :, :] = old_conv.weight
            mean_rgb = old_conv.weight.mean(dim=1, keepdim=True)
            new_conv.weight[:, 3:, :, :] = mean_rgb.expand(-1, 2, -1, -1)

        resnet.conv1 = new_conv
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-2])
        self.pool = nn.AdaptiveAvgPool2d((1, 1))

    def forward(self, x):
        B, T, C, H, W = x.size()
        x = x.view(B * T, C, H, W)
        x = self.feature_extractor(x)
        x = self.pool(x)
        x = x.view(B * T, RESNET_OUT)
        return x.view(B, T, RESNET_OUT)

# ══════════════════════════════════════════════════════════════════════════════
# STREAM B — LANDMARK ENCODER (MLP + LSTM)
# ══════════════════════════════════════════════════════════════════════════════

class LandmarkEncoder(nn.Module):
    """
    V2.1: Handles 126-d input. The wider MLP helps the model calculate
    the spatial relationship between the two hands.
    """
    def __init__(self):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(LANDMARK_FEATURE, 256), # Wider first layer for dual-hand
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(p=0.2),

            nn.Linear(256, LANDMARK_HIDDEN),
            nn.BatchNorm1d(LANDMARK_HIDDEN),
            nn.ReLU(inplace=True),
        )

        self.lstm = nn.LSTM(
            input_size  = LANDMARK_HIDDEN,
            hidden_size = LANDMARK_HIDDEN,
            num_layers  = 1,
            batch_first = True,
        )

    def forward(self, landmarks):
        B, T, _ = landmarks.size()
        lm = landmarks.view(B * T, LANDMARK_FEATURE)
        lm = self.mlp(lm)
        lm = lm.view(B, T, LANDMARK_HIDDEN)
        lm, _ = self.lstm(lm)
        return lm

# ══════════════════════════════════════════════════════════════════════════════
# FUSION + TEMPORAL CLASSIFIER
# ══════════════════════════════════════════════════════════════════════════════

class ResNetLSTM(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.visual_encoder   = VisualEncoder()
        self.landmark_encoder = LandmarkEncoder()

        # Fusion: 512 (Visual) + 128 (Landmark) = 640
        fusion_size = RESNET_OUT + LANDMARK_HIDDEN 

        self.bilstm = nn.LSTM(
            input_size    = fusion_size,
            hidden_size   = LSTM_HIDDEN,
            num_layers    = LSTM_LAYERS,
            batch_first   = True,
            bidirectional = True,
            dropout       = 0.4, # Slightly higher dropout for phrase complexity
        )

        self.dropout = nn.Dropout(p=DROPOUT_P)
        self.fc      = nn.Linear(LSTM_TOTAL_OUT, num_classes)

    def forward(self, frames, landmarks):
        visual_feat   = self.visual_encoder(frames)         # [B, T, 512]
        landmark_feat = self.landmark_encoder(landmarks)    # [B, T, 128]

        fused = torch.cat([visual_feat, landmark_feat], dim=2) # [B, T, 640]

        lstm_out, _ = self.bilstm(fused)
        last_hidden = lstm_out[:, -1, :] # Summary of entire 32-frame sequence
        
        out = self.dropout(last_hidden)
        return self.fc(out)

    def freeze_backbone(self):
        for param in self.visual_encoder.parameters():
            param.requires_grad = False

    def unfreeze_backbone(self):
        for param in self.visual_encoder.parameters():
            param.requires_grad = True

    def count_parameters(self):
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        print(f"Total Trainable Parameters: {trainable:,}")

# ══════════════════════════════════════════════════════════════════════════════
# SANITY CHECK
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = ResNetLSTM(num_classes=28).to(device) # Testing for 28 classes
    model.count_parameters()

    dummy_frames = torch.randn(2, 32, 5, 224, 224).to(device)
    dummy_lms    = torch.randn(2, 32, 126).to(device)

    logits = model(dummy_frames, dummy_lms)
    print(f"Output Shape: {logits.shape}") # Expected: [2, 28]