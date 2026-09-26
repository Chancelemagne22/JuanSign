# ml-model/src/fsl_dataset.py
# JuanSign V2.2 — Robust Multimodal Dataset Loader
# Supports both cached (.pt) and raw folder loading

import math
import os
import numpy as np
from PIL import Image

import torch
from torch.utils.data import Dataset
import torchvision.transforms as transforms
import torchvision.transforms.functional as TF

# ── CONSTANTS ─────────────────────────────────────────────────────────────────
# JUANSIGN_FRAMES must match frame_extractor (32 default; 16/24 for ablation).
TARGET_FRAMES    = int(os.environ.get("JUANSIGN_FRAMES", "32"))
TARGET_SIZE      = 224
LANDMARK_FEATURE = 126
FLOW_NORM_SCALE  = 30.0

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

IS_MODAL = "MODAL_RUN" in os.environ
CACHE_DIR = "/data/cache" if IS_MODAL else "./cache"

# ══════════════════════════════════════════════════════════════════════════════
# TRANSFORMS
# ══════════════════════════════════════════════════════════════════════════════

def _build_rgb_transform(augment=False):
    if augment:
        return transforms.Compose([
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.1),
            transforms.ToTensor(),
            transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ])
    return transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
    ])

def _normalize_flow(flow_hw2):
    flow_tensor = torch.from_numpy(flow_hw2.copy()).float()
    return torch.clamp(flow_tensor / FLOW_NORM_SCALE, -1.0, 1.0)


_MEAN_T = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
_STD_T = torch.tensor(IMAGENET_STD).view(3, 1, 1)


def _denorm_rgb_to_01(normed_rgb):
    """Inverse ImageNet norm: [3,H,W] normalized -> [3,H,W] 0-1 (for PIL)."""
    return torch.clamp(normed_rgb * _STD_T + _MEAN_T, 0.0, 1.0)


def _renorm_rgb_from_01(rgb_01):
    """ImageNet norm: [3,H,W] 0-1 -> normalized."""
    return (rgb_01 - _MEAN_T) / _STD_T


def _rotate_clip_and_flow(frames, angle_deg):
    """Spatially rotate [T,5,H,W] clip and rotate (dx,dy) vectors to match.

    Thesis-safe: RGB/flow stay geometrically consistent. Image y-axis points
    down, so for a CCW (PIL-positive) angle: dx' = cos*dx + sin*dy,
    dy' = -sin*dx + cos*dy. Error at +-10deg is tiny but keeps flow honest.
    """
    if angle_deg == 0:
        return frames
    for t in range(frames.shape[0]):
        frames[t] = TF.rotate(frames[t], angle_deg)
    rad = math.radians(angle_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    dx = frames[:, 3].clone()
    dy = frames[:, 4].clone()
    frames[:, 3] = cos_a * dx + sin_a * dy
    frames[:, 4] = -sin_a * dx + cos_a * dy
    return frames


def _mirror_clip_and_landmarks(frames, landmarks):
    """Horizontal flip: negate flow-dx, mirror landmark-x, swap hands."""
    frames = torch.flip(frames, dims=[3])
    frames[:, 3, :, :] *= -1.0
    landmarks[:, 0::3] *= -1.0
    h0 = landmarks[:, :63].clone()
    h1 = landmarks[:, 63:].clone()
    landmarks = torch.cat([h1, h0], dim=1)
    return frames, landmarks

# ══════════════════════════════════════════════════════════════════════════════
# CACHED DATASET — 1 file read per clip (fast)
# ══════════════════════════════════════════════════════════════════════════════

class CachedFSLDataset(Dataset):
    """
    Loads from a pre-built .pt cache file.
    42,500 file reads per epoch → 1 file read total.
    Augmentation is applied on-the-fly from cached tensors.
    """
    def __init__(self, cache_path, augment=False):
        self.augment = augment
        data = torch.load(cache_path, map_location="cpu")
        self.frames    = data["frames"]     # [N, 32, 5, 224, 224]
        self.landmarks = data["landmarks"]  # [N, 32, 126]
        self.labels    = data["labels"]     # [N]
        self.classes   = data["classes"]
        self.samples   = list(zip(range(len(self.labels)), self.labels.tolist()))
        print(f"[CachedDataset] Loaded {len(self.labels)} clips across {len(self.classes)} classes from cache.")

    def _normalize_landmarks_relative(self, lm):
        lm = lm.clone()
        for hand_offset in [0, 63]:
            wrists = lm[:, hand_offset:hand_offset + 3].clone()
            for i in range(21):
                start = hand_offset + (i * 3)
                lm[:, start:start + 3] -= wrists
        return lm

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        frames    = self.frames[idx].clone()     # [32, 5, 224, 224]
        landmarks = self.landmarks[idx].clone()  # [32, 126]
        label     = self.labels[idx]

        landmarks = self._normalize_landmarks_relative(landmarks)

        if self.augment:
            # Color jitter on RGB only (denorm -> PIL -> jitter -> renorm).
            # Cache stores normalized tensors, so we must invert the norm first.
            jitter = transforms.ColorJitter(
                brightness=0.2, contrast=0.2, saturation=0.1)
            for t in range(TARGET_FRAMES):
                rgb01 = _denorm_rgb_to_01(frames[t, :3])
                pil = transforms.ToPILImage()(rgb01)
                pil = jitter(pil)
                frames[t, :3] = _renorm_rgb_from_01(transforms.ToTensor()(pil))

            # Synchronized rotation (RGB + flow spatial + flow vectors)
            angle = transforms.RandomRotation.get_params([-10, 10])
            frames = _rotate_clip_and_flow(frames, angle)

            # Symmetric mirroring
            if torch.rand(1) < 0.5:
                frames, landmarks = _mirror_clip_and_landmarks(frames, landmarks)

        return frames, landmarks, torch.tensor(label, dtype=torch.long)


# ══════════════════════════════════════════════════════════════════════════════
# RAW DATASET — reads from folder (fallback if no cache)
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
            for clip_name in sorted(os.listdir(letter_dir)):
                clip_path = os.path.join(letter_dir, clip_name)
                if os.path.isdir(clip_path):
                    self.samples.append((clip_path, self.class_to_idx[letter]))

        print(f"[Dataset] Loaded {len(self.samples)} clips across {len(self.classes)} classes.")

    def _normalize_landmarks_relative(self, lm_raw):
        lm_tensor = torch.from_numpy(lm_raw.copy()).float()
        for hand_offset in [0, 63]:
            wrists = lm_tensor[:, hand_offset:hand_offset + 3].clone()
            for i in range(21):
                start = hand_offset + (i * 3)
                lm_tensor[:, start:start + 3] -= wrists
        return lm_tensor

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        clip_path, label = self.samples[idx]

        frame_files = sorted([f for f in os.listdir(clip_path) if f.endswith(".jpg")])[:TARGET_FRAMES]
        pil_frames  = [Image.open(os.path.join(clip_path, f)).convert("RGB") for f in frame_files]

        # NOTE: no early PIL rotation here — rotation is applied after RGB+flow
        # fusion so flow vectors stay consistent (see _rotate_clip_and_flow).
        rgb_tensors  = torch.stack([self.rgb_transform(f) for f in pil_frames])
        flow_raw     = np.load(os.path.join(clip_path, "optical_flow.npy"))
        flow_tensors = torch.stack([_normalize_flow(flow_raw[i]) for i in range(TARGET_FRAMES)])
        frames       = torch.cat([rgb_tensors, flow_tensors], dim=1)

        lm_raw    = np.load(os.path.join(clip_path, "landmarks.npy"))
        landmarks = self._normalize_landmarks_relative(lm_raw)

        if self.augment:
            angle = transforms.RandomRotation.get_params([-10, 10])
            frames = _rotate_clip_and_flow(frames, angle)
            if torch.rand(1) < 0.5:
                frames, landmarks = _mirror_clip_and_landmarks(frames, landmarks)

        return frames, landmarks, torch.tensor(label, dtype=torch.long)


# ══════════════════════════════════════════════════════════════════════════════
# SMART LOADER — auto-picks cache if available
# ══════════════════════════════════════════════════════════════════════════════

def load_dataset(root_dir, split, augment=False):
    """
    Automatically uses cache if available, otherwise falls back to raw loading.
    Usage: train_ds = load_dataset(FRAME_ROOT, "training", augment=True)
    """
    cache_path = os.path.join(CACHE_DIR, f"{split}.pt")
    if os.path.exists(cache_path):
        print(f"[Dataset] Using cache for '{split}' → {cache_path}")
        return CachedFSLDataset(cache_path, augment=augment)
    else:
        print(f"[Dataset] No cache found for '{split}', loading from disk...")
        return FSLDataset(os.path.join(root_dir, split), augment=augment)


# ══════════════════════════════════════════════════════════════════════════════
# COLLATE FUNCTION
# ══════════════════════════════════════════════════════════════════════════════

def collate_fn(batch):
    frames    = torch.stack([item[0] for item in batch])
    landmarks = torch.stack([item[1] for item in batch])
    labels    = torch.stack([item[2] for item in batch])
    return frames, landmarks, labels