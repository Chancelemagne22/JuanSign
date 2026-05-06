# ml-model/src/resnet_lstm_architecture.py
#
# JuanSign V2.2 — High-Capacity Architecture
# Backbone: ResNet50 (2048-dim spatial features)
# Geometric: Dual-Hand Landmark Encoder (126-dim)
# Temporal: 2-Layer Bidirectional LSTM
#
# Optimized for: Local GPU (RTX 2070 8GB) and 200+ Phrase Expansion.

import torch
import torch.nn as nn
from torchvision import models

# ── CONSTANTS ─────────────────────────────────────────────────────────────────
# These must match your frame_extractor.py and fsl_dataset.py
TARGET_FRAMES    = 32
RESNET_OUT       = 2048  # ResNet50 feature dimension (ResNet18 was 512)
LANDMARK_FEATURE = 126   # 2 hands × 21 points × (x, y, z)
LANDMARK_HIDDEN  = 128   # Capacity for complex bi-manual coordination
LSTM_HIDDEN      = 256   # 256 per direction = 512 total output
LSTM_LAYERS      = 2
DROPOUT_P        = 0.7   # High dropout to prevent ResNet50 from memorizing background

# ══════════════════════════════════════════════════════════════════════════════
# STREAM A — VISUAL ENCODER (ResNet50)
# ══════════════════════════════════════════════════════════════════════════════

class VisualEncoder(nn.Module):
    """
    Upgraded Backbone: ResNet50.
    Uses 'Weight Inflation' to accept 5-channel input (RGB + 2-ch Optical Flow).
    """
    def __init__(self):
        super().__init__()
        # Load pretrained ResNet50 weights
        resnet = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)

        # ── Inflate Conv1 from 3 → 5 channels ────────────────────────────────
        old_conv = resnet.conv1
        new_conv = nn.Conv2d(
            in_channels  = 5,
            out_channels = old_conv.out_channels,
            kernel_size  = old_conv.kernel_size,
            stride       = old_conv.stride,
            padding      = old_conv.padding,
            bias         = False,
        )

        with torch.no_grad():
            # Copy RGB weights (Channels 0, 1, 2)
            new_conv.weight[:, :3, :, :] = old_conv.weight
            
            # Initialize Flow weights (Channels 3, 4) with the mean of RGB
            # This provides a stable starting point for motion detection.
            mean_rgb = old_conv.weight.mean(dim=1, keepdim=True)
            new_conv.weight[:, 3:, :, :] = mean_rgb.expand(-1, 2, -1, -1)

        resnet.conv1 = new_conv

        # ── Remove the final FC and Pooling ──────────────────────────────────
        # We keep everything up to the layer4 output
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-2])
        self.pool = nn.AdaptiveAvgPool2d((1, 1))

    def forward(self, x):
        """
        Input:  [Batch, Time, 5, 224, 224]
        Output: [Batch, Time, 2048]
        """
        B, T, C, H, W = x.size()
        
        # Flatten Time into Batch for ResNet processing: [B*T, 5, 224, 224]
        x = x.view(B * T, C, H, W)
        
        # Extract features
        x = self.feature_extractor(x)  # Shape: [B*T, 2048, 7, 7]
        x = self.pool(x)               # Shape: [B*T, 2048, 1, 1]
        x = x.view(B * T, RESNET_OUT)  # Shape: [B*T, 2048]
        
        # Reshape back to sequence: [B, T, 2048]
        return x.view(B, T, RESNET_OUT)


# ══════════════════════════════════════════════════════════════════════════════
# STREAM B — LANDMARK ENCODER
# ══════════════════════════════════════════════════════════════════════════════

class LandmarkEncoder(nn.Module):
    """
    Processes 126-dimensional landmarks (Hand 0 + Hand 1).
    Distills geometric relationships before temporal fusion.
    """
    def __init__(self):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(LANDMARK_FEATURE, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(inplace=True),
            nn.Dropout(p=0.3),

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
        """
        Input:  [Batch, Time, 126]
        Output: [Batch, Time, 128]
        """
        B, T, _ = landmarks.size()
        
        # Process per-frame geometric features
        lm = landmarks.view(B * T, LANDMARK_FEATURE)
        lm = self.mlp(lm)
        lm = lm.view(B, T, LANDMARK_HIDDEN)
        
        # Learn geometric trajectories
        lm, _ = self.lstm(lm)
        return lm


# ══════════════════════════════════════════════════════════════════════════════
# FUSION + TEMPORAL CLASSIFIER (ResNet50 + BiLSTM)
# ══════════════════════════════════════════════════════════════════════════════

class ResNetLSTM(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.num_classes = num_classes

        # Visual and Geometric Streams
        self.visual_encoder   = VisualEncoder()
        self.landmark_encoder = LandmarkEncoder()

        # Concatenation size: 2048 (Visual) + 128 (Geometric) = 2176
        fusion_size = RESNET_OUT + LANDMARK_HIDDEN 

        # Main Temporal Brain
        self.bilstm = nn.LSTM(
            input_size    = fusion_size,
            hidden_size   = LSTM_HIDDEN,
            num_layers    = LSTM_LAYERS,
            batch_first   = True,
            bidirectional = True,
            dropout       = 0.5, # Dropout between LSTM layers
        )

        # Classification Head
        self.dropout = nn.Dropout(p=DROPOUT_P)
        self.fc      = nn.Linear(LSTM_HIDDEN * 2, num_classes) # 512 -> num_classes

    def forward(self, frames, landmarks):
        """
        frames:    [B, 32, 5, 224, 224]
        landmarks: [B, 32, 126]
        """
        # 1. Spatial Stream
        v = self.visual_encoder(frames)    # [B, 32, 2048]
        
        # 2. Geometric Stream
        l = self.landmark_encoder(landmarks) # [B, 32, 128]

        # 3. Multimodal Fusion
        fused = torch.cat([v, l], dim=2)   # [B, 32, 2176]

        # 4. Temporal Reasoning
        lstm_out, _ = self.bilstm(fused)
        
        # 5. Global Summary (Use the last timestep)
        last_hidden = lstm_out[:, -1, :]   # [B, 512]
        
        # 6. Prediction
        out = self.dropout(last_hidden)
        return self.fc(out)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def freeze_backbone(self):
        """Freeze ResNet50 for initial training phase."""
        for param in self.visual_encoder.parameters():
            param.requires_grad = False
        print("[Model] ResNet50 backbone FROZEN")

    def unfreeze_backbone(self):
        """Unfreeze ResNet50 for fine-tuning."""
        for param in self.visual_encoder.parameters():
            param.requires_grad = True
        print("[Model] ResNet50 backbone UNFROZEN")

    def count_parameters(self):
        total = sum(p.numel() for p in self.parameters())
        trainable = sum(p.numel() for p in self.parameters() if p.requires_grad)
        print(f"\n── ResNet50-BiLSTM V2.2 Stats ───────────────────")
        print(f"   Total Parameters     : {total:,}")
        print(f"   Trainable Parameters : {trainable:,}")
        print(f"────────────────────────────────────────────────\n")


# ══════════════════════════════════════════════════════════════════════════════
# LOCAL TEST SCRIPT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Test for 28 classes
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = ResNetLSTM(num_classes=28).to(device)
    model.count_parameters()

    # Create dummy tensors to verify math
    # [Batch=2, Time=32, Channels=5, H=224, W=224]
    d_frames = torch.randn(2, 32, 5, 224, 224).to(device)
    d_lms    = torch.randn(2, 32, 126).to(device)

    model.eval()
    with torch.no_grad():
        logits = model(d_frames, d_lms)
    
    print(f"Inference Success!")
    print(f"Input  — Frames Shape    : {list(d_frames.shape)}")
    print(f"Input  — Landmarks Shape : {list(d_lms.shape)}")
    print(f"Output — Logits Shape    : {list(logits.shape)}") # Should be [2, 28]