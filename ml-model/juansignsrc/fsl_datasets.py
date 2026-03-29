# ml-model/src/fsl_dataset.py
#
# FSLDataset V2.1 — Dual-Hand & Symmetric Augmentation
#
# Returns per item:
#   frames    : [32, 5, 224, 224]  (RGB + Δx + Δy)
#   landmarks : [32, 126]          (Hand 0 + Hand 1)
#   label     : int64 scalar

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
NUM_LANDMARKS    = 21
LANDMARK_DIMS    = 3    
LANDMARK_FEATURE = 126  # UPDATED: 2 hands × 21 landmarks × 3 coords

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]
FLOW_NORM_SCALE = 30.0

def _build_rgb_transform(augment=False):
    if augment:
        return transforms.Compose([
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
            transforms.RandomRotation(10),
            transforms.ToTensor(),
            transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ])
    else:
        return transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ])

def _normalize_flow(flow_hw2):
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

        self.classes = sorted([
            d for d in os.listdir(root_dir)
            if os.path.isdir(os.path.join(root_dir, d))
        ])
        self.class_to_idx = {c: i for i, c in enumerate(self.classes)}

        self.samples = []
        for letter in self.classes:
            letter_dir = os.path.join(root_dir, letter)
            label_idx  = self.class_to_idx[letter]
            for clip_name in sorted(os.listdir(letter_dir)):
                clip_path = os.path.join(letter_dir, clip_name)
                if os.path.isdir(clip_path) and self._is_valid_clip(clip_path):
                    self.samples.append((clip_path, label_idx))

    def _is_valid_clip(self, clip_path):
        # Check for 32 frames
        jpgs = [f for f in os.listdir(clip_path) if f.endswith(".jpg")]
        if len(jpgs) < TARGET_FRAMES: return False

        # Check for flow and 126-dim landmarks
        try:
            flow = np.load(os.path.join(clip_path, "optical_flow.npy"), mmap_mode="r")
            lm   = np.load(os.path.join(clip_path, "landmarks.npy"), mmap_mode="r")
            return flow.shape == (32, 2, 224, 224) and lm.shape == (32, 126)
        except:
            return False

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        clip_path, label = self.samples[idx]

        # 1. Load Frames
        frame_files = sorted([f for f in os.listdir(clip_path) if f.endswith(".jpg")])[:TARGET_FRAMES]
        pil_frames = [Image.open(os.path.join(clip_path, f)).convert("RGB") for f in frame_files]

        # 2. Consistent Rotation Augmentation
        if self.augment:
            angle = transforms.RandomRotation.get_params([-10, 10])
            pil_frames = [TF.rotate(f, angle) for f in pil_frames]

        # 3. Prepare Frames Tensor (RGB + Flow)
        rgb_tensors = torch.stack([self.rgb_transform(f) for f in pil_frames])
        flow_raw    = np.load(os.path.join(clip_path, "optical_flow.npy"))
        flow_tensors = torch.stack([_normalize_flow(flow_raw[i]) for i in range(TARGET_FRAMES)])
        frames = torch.cat([rgb_tensors, flow_tensors], dim=1) # [32, 5, 224, 224]

        # 4. Load 126-dim Landmarks
        landmarks = torch.from_numpy(np.load(os.path.join(clip_path, "landmarks.npy"))).float()

        # 5. SYMMETRIC MIRRORING AUGMENTATION
        # Effectively doubles the dataset to solve prediction bias.
        if self.augment and torch.rand(1) < 0.5:
            # A. Flip frames horizontally (Width is last dim)
            frames = torch.flip(frames, dims=[3])
            
            # B. Invert Optical Flow DX (Channel 3)
            # A rightward movement (+) becomes a leftward movement (-) when mirrored
            frames[:, 3, :, :] *= -1.0
            
            # C. Invert and Swap Landmarks
            # Invert X coordinates: landmark[x] = 1.0 - landmark[x]
            landmarks[:, 0::3] = 1.0 - landmarks[:, 0::3]
            
            # Swap Hand 0 (0:63) and Hand 1 (63:126)
            h0_data = landmarks[:, :63].clone()
            h1_data = landmarks[:, 63:].clone()
            landmarks = torch.cat([h1_data, h0_data], dim=1)

        return frames, landmarks, torch.tensor(label, dtype=torch.long)

# ══════════════════════════════════════════════════════════════════════════════
# COLLATE & CHECK
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