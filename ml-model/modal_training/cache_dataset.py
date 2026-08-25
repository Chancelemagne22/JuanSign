# cache_dataset.py
# Pre-loads all clips from Volume into a single .pt file
# Run this ONCE before training: modal run --detach modal_run.py::cache

import os
import sys
import torch
import numpy as np
from PIL import Image
import torchvision.transforms as transforms

IS_MODAL = "MODAL_RUN" in os.environ

if IS_MODAL:
    FRAME_ROOT  = "/data/processed_output/frame_extracted"
    CACHE_DIR   = "/data/cache"
else:
    FRAME_ROOT  = "./processed_output/frame_extracted"
    CACHE_DIR   = "./cache"

TARGET_FRAMES    = 32
TARGET_SIZE      = 224
IMAGENET_MEAN    = [0.485, 0.456, 0.406]
IMAGENET_STD     = [0.229, 0.224, 0.225]
FLOW_NORM_SCALE  = 30.0
SPLITS           = ["training", "validation", "testing"]

rgb_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

def load_clip(clip_path):
    # Load 32 RGB frames
    frame_files = sorted([f for f in os.listdir(clip_path) if f.endswith(".jpg")])[:TARGET_FRAMES]
    pil_frames  = [Image.open(os.path.join(clip_path, f)).convert("RGB") for f in frame_files]
    rgb_tensors = torch.stack([rgb_transform(f) for f in pil_frames])

    # Load optical flow
    flow_raw    = np.load(os.path.join(clip_path, "optical_flow.npy"))
    flow_tensor = torch.from_numpy(flow_raw.copy()).float()
    flow_tensor = torch.clamp(flow_tensor / FLOW_NORM_SCALE, -1.0, 1.0)

    # Combine: [32, 5, 224, 224]
    frames = torch.cat([rgb_tensors, flow_tensor], dim=1)

    # Load landmarks
    lm_raw = np.load(os.path.join(clip_path, "landmarks.npy"))
    return frames, torch.from_numpy(lm_raw.copy()).float()

def build_cache(split):
    split_dir  = os.path.join(FRAME_ROOT, split)
    cache_path = os.path.join(CACHE_DIR, f"{split}.pt")

    if os.path.exists(cache_path):
        print(f"  [{split}] Cache already exists → {cache_path}")
        return

    if not os.path.exists(split_dir):
        print(f"  [{split}] Not found, skipping.")
        return

    os.makedirs(CACHE_DIR, exist_ok=True)

    classes = sorted([d for d in os.listdir(split_dir)
                      if os.path.isdir(os.path.join(split_dir, d))])
    class_to_idx = {c: i for i, c in enumerate(classes)}

    all_frames, all_landmarks, all_labels = [], [], []
    total = sum(
        len(os.listdir(os.path.join(split_dir, cls)))
        for cls in classes
    )
    done = 0

    for cls in classes:
        cls_dir = os.path.join(split_dir, cls)
        label   = class_to_idx[cls]
        for clip_name in sorted(os.listdir(cls_dir)):
            clip_path = os.path.join(cls_dir, clip_name)
            if not os.path.isdir(clip_path):
                continue
            try:
                frames, landmarks = load_clip(clip_path)
                all_frames.append(frames)
                all_landmarks.append(landmarks)
                all_labels.append(label)
                done += 1
                if done % 50 == 0:
                    print(f"  [{split}] {done}/{total} clips cached...")
            except Exception as e:
                print(f"  [{split}] Skipping {clip_name}: {e}")

    torch.save({
        "frames":    torch.stack(all_frames),     # [N, 32, 5, 224, 224]
        "landmarks": torch.stack(all_landmarks),  # [N, 32, 126]
        "labels":    torch.tensor(all_labels),    # [N]
        "classes":   classes,
    }, cache_path)
    print(f"  [{split}] ✅ Saved {done} clips → {cache_path}")

def run_cache():
    print("--- Building dataset cache ---")
    for split in SPLITS:
        print(f"\nProcessing {split}...")
        build_cache(split)
    print("\n--- Cache complete ---")

if __name__ == "__main__":
    run_cache()