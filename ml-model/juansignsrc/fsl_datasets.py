# ml-model/src/fsl_dataset.py
#
# JuanSign V2.2 — Robust Multimodal Dataset Loader
#
# Key Features:
#   1. Relative Normalization: Subtracts wrist from all landmarks (Location Invariant)
#   2. Symmetric Mirroring: Correctly flips RGB, Flow DX, and Swaps Hands
#   3. Temporal Coherence: Ensures augmentations apply identically across 32 frames
#   4. 5-Channel Support: RGB + Dense Optical Flow (Δx, Δy)

import os
import numpy as np
from PIL import Image

import torch
from torch.utils.data import Dataset
import torchvision.transforms as transforms
import torchvision.transforms.functional as TF

# ── CONSTANTS ─────────────────────────────────────────────────────────────────
TARGET_FRAMES    = 32
TARGET_SIZE      = 224
LANDMARK_FEATURE = 126  # 2 hands * 21 points * 3 coords
FLOW_NORM_SCALE  = 30.0

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

# ══════════════════════════════════════════════════════════════════════════════
# TRANSFORMS
# ══════════════════════════════════════════════════════════════════════════════

def _build_rgb_transform(augment=False):
    """Handles RGB normalization and training jitter."""
    if augment:
        return transforms.Compose([
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
            transforms.ToTensor(),
            transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ])
    else:
        return transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ])

def _normalize_flow(flow_hw2):
    """Normalizes raw pixel displacement to [-1, 1]."""
    flow_tensor = torch.from_numpy(flow_hw2.copy()).float()
    flow_tensor = flow_tensor / FLOW_NORM_SCALE
    flow_tensor = torch.clamp(flow_tensor, -1.0, 1.0)
    return flow_tensor

# ══════════════════════════════════════════════════════════════════════════════
# DATASET CLASS
# ══════════════════════════════════════════════════════════════════════════════

class FSLDataset(Dataset):
    def __init__(self, root_dir, augment=False):
        self.root_dir      = root_dir
        self.augment       = augment
        self.rgb_transform = _build_rgb_transform(augment)

        # Build Class List (Alphabetical)
        self.classes = sorted([
            d for d in os.listdir(root_dir)
            if os.path.isdir(os.path.join(root_dir, d))
        ])
        self.class_to_idx = {c: i for i, c in enumerate(self.classes)}

        # Load Samples
        self.samples = []
        for letter in self.classes:
            letter_dir = os.path.join(root_dir, letter)
            for clip_name in sorted(os.listdir(letter_dir)):
                clip_path = os.path.join(letter_dir, clip_name)
                if os.path.isdir(clip_path):
                    self.samples.append((clip_path, self.class_to_idx[letter]))

        print(f"[Dataset] Loaded {len(self.samples)} clips across {len(self.classes)} classes.")

    def _normalize_landmarks_relative(self, lm_raw):
        """
        THE SILVER BULLET:
        Subtracts the Wrist (Landmark 0) from all points in the hand.
        This makes the model care about the SHAPE, not the LOCATION in the room.
        """
        # lm_raw shape: [32, 126]
        lm_tensor = torch.from_numpy(lm_raw.copy()).float()
        
        # Process Hand 0 (0-62) and Hand 1 (63-125)
        for hand_offset in [0, 63]:
            # Wrist is the first 3 coordinates of each hand block
            # Shape: [32, 3] (x, y, z for all frames)
            wrists = lm_tensor[:, hand_offset : hand_offset + 3].clone()
            
            # Subtract wrist from every one of the 21 landmarks
            for i in range(21):
                start = hand_offset + (i * 3)
                # landmark[i] = landmark[i] - wrist
                lm_tensor[:, start : start + 3] -= wrists
        
        return lm_tensor

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        clip_path, label = self.samples[idx]

        # 1. Load 32 RGB Frames
        frame_files = sorted([f for f in os.listdir(clip_path) if f.endswith(".jpg")])[:TARGET_FRAMES]
        pil_frames = [Image.open(os.path.join(clip_path, f)).convert("RGB") for f in frame_files]

        # 2. Synchronized Rotation (Temporal Coherence)
        if self.augment:
            angle = transforms.RandomRotation.get_params([-10, 10])
            pil_frames = [TF.rotate(f, angle) for f in pil_frames]

        # 3. Process RGB Tensors
        rgb_tensors = torch.stack([self.rgb_transform(f) for f in pil_frames])

        # 4. Load & Normalize Optical Flow
        flow_raw = np.load(os.path.join(clip_path, "optical_flow.npy"))
        flow_tensors = torch.stack([_normalize_flow(flow_raw[i]) for i in range(TARGET_FRAMES)])
        
        # Combine: [32, 5, 224, 224]
        frames = torch.cat([rgb_tensors, flow_tensors], dim=1)

        # 5. Load & Normalize Landmarks (Wrist-Relative)
        lm_raw = np.load(os.path.join(clip_path, "landmarks.npy"))
        landmarks = self._normalize_landmarks_relative(lm_raw)

        # 6. SYMMETRIC MIRRORING AUGMENTATION (The "Bias-Killer")
        if self.augment and torch.rand(1) < 0.5:
            # A. Flip pixels horizontally
            frames = torch.flip(frames, dims=[3]) # width dim
            
            # B. Invert Flow Δx (Channel 3)
            # Right movement becomes Left movement
            frames[:, 3, :, :] *= -1.0
            
            # C. Invert Landmark X-axis & Swap Hands
            # x_new = -x_old (since they are now relative to the wrist)
            landmarks[:, 0::3] *= -1.0 
            
            # Since the video flipped, Hand 0 and Hand 1 must swap roles
            h0 = landmarks[:, :63].clone()
            h1 = landmarks[:, 63:].clone()
            landmarks = torch.cat([h1, h0], dim=1)

        return frames, landmarks, torch.tensor(label, dtype=torch.long)

# ══════════════════════════════════════════════════════════════════════════════
# COLLATE FUNCTION
# ══════════════════════════════════════════════════════════════════════════════

def collate_fn(batch):
    frames    = torch.stack([item[0] for item in batch])
    landmarks = torch.stack([item[1] for item in batch])
    labels    = torch.stack([item[2] for item in batch])
    return frames, landmarks, labels

if __name__ == "__main__":
    ds = FSLDataset("./processed_output/frame_extracted/training_data", augment=True)
    f, l, lbl = ds[0]
    print(f"Frames: {f.shape}, Landmarks: {l.shape}, Label: {lbl}")