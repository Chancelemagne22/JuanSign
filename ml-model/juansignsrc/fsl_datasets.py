# ml-model/src/fsl_dataset.py
#
# FSLDataset — loads extracted clip folders for the enhanced JuanSign pipeline.
#
# Each __getitem__ returns THREE tensors:
#   frames   : float32  [32, 5, 224, 224]
#                         channels 0-2 = RGB (ImageNet-normalized)
#                         channel  3   = Δx optical flow (normalized)
#                         channel  4   = Δy optical flow (normalized)
#   landmarks: float32  [32, 63]
#                         21 hand landmarks × (x, y, z) per frame
#                         zeros when no hand detected
#   label    : int64    scalar — class index from sorted class list
#
# Depends on frame_extractor.py having already produced:
#   <clip_folder>/frame0000.jpg … frame0031.jpg
#   <clip_folder>/optical_flow.npy   shape [32, 2, 224, 224]

import os
import numpy as np
from PIL import Image

import torch
from torch.utils.data import Dataset
import torchvision.transforms as transforms
import torchvision.transforms.functional as TF

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ── CONSTANTS — must match frame_extractor.py and resnet_lstm_architecture.py ─
TARGET_FRAMES    = 32
TARGET_SIZE      = 224
NUM_LANDMARKS    = 21
LANDMARK_DIMS    = 3    # x, y, z per landmark
LANDMARK_FEATURE = NUM_LANDMARKS * LANDMARK_DIMS   # 63

# ── MediaPipe model path — update if different on your machine / Colab ─────────
# Local:
HAND_MODEL_PATH = "./hand_landmarker.task"
# Colab:
# HAND_MODEL_PATH = "/content/drive/MyDrive/JuanSign/hand_landmarker.task"

# ── ImageNet normalisation stats — must match all transform definitions ────────
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

# ── Optical flow normalisation ─────────────────────────────────────────────────
# Flow values are pixel displacements (roughly -30 to +30 at 224px resolution).
# We normalise them to approximately [-1, 1] using a fixed scale factor.
# This keeps flow on a similar scale to the RGB channels after ImageNet norm.
FLOW_NORM_SCALE = 30.0


# ══════════════════════════════════════════════════════════════════════════════
# LANDMARK EXTRACTOR  (one shared instance per dataset)
# ══════════════════════════════════════════════════════════════════════════════

def _build_hand_detector():
    """
    Builds a MediaPipe HandLandmarker for landmark extraction at dataset load
    time. Using num_hands=1 here because we only need the signing hand and
    speed matters more than completeness when loading batches.
    """
    base_options = mp_python.BaseOptions(model_asset_path=HAND_MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=base_options,
        num_hands=1,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    return mp_vision.HandLandmarker.create_from_options(options)


def _extract_landmarks_from_frame(pil_image, hand_detector):
    """
    Run MediaPipe HandLandmarker on a single PIL image.

    Returns:
        numpy array of shape [63] — flattened (x, y, z) for 21 landmarks.
        All zeros if no hand is detected.

    Note:
        Coordinates are normalised to [0, 1] by MediaPipe relative to the
        image dimensions. z is relative depth — negative means closer to
        the camera than the wrist.
    """
    rgb_array = np.array(pil_image.convert("RGB"), dtype=np.uint8)
    mp_image  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_array)
    result    = hand_detector.detect(mp_image)

    if not result.hand_landmarks:
        return np.zeros(LANDMARK_FEATURE, dtype=np.float32)

    # Take the first detected hand only
    landmarks = result.hand_landmarks[0]
    coords = []
    for lm in landmarks:
        coords.extend([lm.x, lm.y, lm.z])

    return np.array(coords, dtype=np.float32)   # shape [63]


# ══════════════════════════════════════════════════════════════════════════════
# TRANSFORMS
# ══════════════════════════════════════════════════════════════════════════════

def _build_rgb_transform(augment=False):
    """
    Returns a transform for RGB channels only (3-channel PIL Image → tensor).

    augment=True  : used for training data
    augment=False : used for validation / test data
    """
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
    """
    Normalize optical flow from pixel displacement to approximately [-1, 1].

    flow_hw2 : numpy array [2, H, W] — (Δx, Δy) channels
    Returns  : float32 tensor [2, H, W]
    """
    flow_tensor = torch.from_numpy(flow_hw2.copy()).float()
    flow_tensor = flow_tensor / FLOW_NORM_SCALE
    flow_tensor = torch.clamp(flow_tensor, -1.0, 1.0)
    return flow_tensor


# ══════════════════════════════════════════════════════════════════════════════
# DATASET
# ══════════════════════════════════════════════════════════════════════════════

class FSLDataset(Dataset):
    """
    Loads JuanSign clip folders produced by frame_extractor.py.

    Arguments:
        root_dir   : path to a split folder, e.g.
                     "processed_output/frame_extracted/training_data"
                     Expected structure:
                       root_dir/<letter>/<clip_name>/frame0000.jpg
                       root_dir/<letter>/<clip_name>/optical_flow.npy
        augment    : apply training augmentations to RGB channels
        use_landmarks : whether to extract landmarks on the fly
                        Set False to disable for speed if you're not using
                        the landmark stream yet.

    Returns per item:
        frames    : [32, 5, 224, 224]  float32  (channels: RGB + Δx + Δy)
        landmarks : [32, 63]           float32  (zeros if use_landmarks=False)
        label     : int64 scalar
    """

    def __init__(self, root_dir, augment=False, use_landmarks=True):
        self.root_dir      = root_dir
        self.augment       = augment
        self.use_landmarks = use_landmarks
        self.rgb_transform = _build_rgb_transform(augment)

        # Class list — always sorted so indices are deterministic
        # A=0, B=1, C=2, ... matches fsl_dataset.py original behaviour
        self.classes = sorted([
            d for d in os.listdir(root_dir)
            if os.path.isdir(os.path.join(root_dir, d))
        ])
        self.class_to_idx = {c: i for i, c in enumerate(self.classes)}

        # Build list of (clip_path, label_index) tuples
        self.samples = []
        for letter in self.classes:
            letter_dir = os.path.join(root_dir, letter)
            label_idx  = self.class_to_idx[letter]

            for clip_name in sorted(os.listdir(letter_dir)):
                clip_path = os.path.join(letter_dir, clip_name)
                if not os.path.isdir(clip_path):
                    continue

                # Validate clip has required files before adding
                if self._is_valid_clip(clip_path):
                    self.samples.append((clip_path, label_idx))
                else:
                    print(f"[WARN] Skipping incomplete clip: {clip_path}")

        # Build MediaPipe hand detector once (shared across all __getitem__ calls)
        if self.use_landmarks:
            self._hand_detector = _build_hand_detector()

        print(f"FSLDataset loaded: {root_dir}")
        print(f"  Classes  : {self.classes}")
        print(f"  Samples  : {len(self.samples)}")
        print(f"  Augment  : {augment}")
        print(f"  Landmarks: {use_landmarks}")

    # ── Validation ────────────────────────────────────────────────────────────

    def _is_valid_clip(self, clip_path):
        """Check clip has TARGET_FRAMES jpgs and a correctly shaped flow file."""
        jpgs = [
            f for f in os.listdir(clip_path)
            if f.startswith("frame") and f.endswith(".jpg")
        ]
        if len(jpgs) != TARGET_FRAMES:
            return False

        npy_path = os.path.join(clip_path, "optical_flow.npy")
        if not os.path.exists(npy_path):
            return False

        try:
            flow = np.load(npy_path, mmap_mode="r")
            return flow.shape == (TARGET_FRAMES, 2, TARGET_SIZE, TARGET_SIZE)
        except Exception:
            return False

    # ── Dataset interface ─────────────────────────────────────────────────────

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        clip_path, label = self.samples[idx]

        # 1. Load sorted frame JPEGs as PIL images
        frame_files = sorted([
            f for f in os.listdir(clip_path)
            if f.startswith("frame") and f.endswith(".jpg")
        ])[:TARGET_FRAMES]

        pil_frames = [
            Image.open(os.path.join(clip_path, f)).convert("RGB")
            for f in frame_files
        ]

        # 2. Apply consistent random augmentation across all frames
        #    RandomRotation must use the same angle for every frame in a clip
        #    so the clip stays temporally coherent.
        if self.augment:
            angle = transforms.RandomRotation.get_params([-10, 10])
            pil_frames = [TF.rotate(f, angle) for f in pil_frames]

        # 3. Build RGB tensors — shape [32, 3, 224, 224]
        rgb_tensors = torch.stack([
            self.rgb_transform(f) for f in pil_frames
        ])   # [32, 3, 224, 224]

        # 4. Load optical flow — shape [32, 2, 224, 224]
        flow_raw  = np.load(os.path.join(clip_path, "optical_flow.npy"))
        flow_tensors = torch.stack([
            _normalize_flow(flow_raw[i]) for i in range(TARGET_FRAMES)
        ])   # [32, 2, 224, 224]

        # 5. Concatenate RGB + flow along channel dimension → [32, 5, 224, 224]
        frames = torch.cat([rgb_tensors, flow_tensors], dim=1)

        # 6. Extract landmarks per frame → [32, 63]
        if self.use_landmarks:
            landmark_list = [
                _extract_landmarks_from_frame(pil_frames[i], self._hand_detector)
                for i in range(TARGET_FRAMES)
            ]
            landmarks = torch.from_numpy(
                np.stack(landmark_list, axis=0)
            ).float()   # [32, 63]
        else:
            landmarks = torch.zeros(TARGET_FRAMES, LANDMARK_FEATURE)

        return frames, landmarks, torch.tensor(label, dtype=torch.long)

    # ── Utility ───────────────────────────────────────────────────────────────

    def get_class_names(self):
        """Returns the ordered list of class names matching label indices."""
        return self.classes


# ══════════════════════════════════════════════════════════════════════════════
# COLLATE FUNCTION  (import this in train.py)
# ══════════════════════════════════════════════════════════════════════════════

def collate_fn(batch):
    """
    Custom collate for DataLoader.

    Handles variable-length sequences safely via pad_sequence, though
    frame_extractor.py guarantees TARGET_FRAMES=32 for every clip.

    batch : list of (frames, landmarks, label) tuples

    Returns:
        frames    : [B, 32, 5, 224, 224]
        landmarks : [B, 32, 63]
        labels    : [B]
    """
    frames_list    = [item[0] for item in batch]   # each [32, 5, 224, 224]
    landmarks_list = [item[1] for item in batch]   # each [32, 63]
    labels_list    = [item[2] for item in batch]   # each scalar

    from torch.nn.utils.rnn import pad_sequence

    # pad_sequence expects [T, *] — frames are [T, 5, H, W], already consistent
    frames_padded    = pad_sequence(frames_list,    batch_first=True, padding_value=0.0)
    landmarks_padded = pad_sequence(landmarks_list, batch_first=True, padding_value=0.0)

    return (
        frames_padded,                          # [B, 32, 5, 224, 224]
        landmarks_padded,                       # [B, 32, 63]
        torch.stack(labels_list),               # [B]
    )


# ══════════════════════════════════════════════════════════════════════════════
# QUICK SANITY CHECK
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys

    root = sys.argv[1] if len(sys.argv) > 1 else \
        "./processed_output/frame_extracted/training_data"

    print(f"\nRunning sanity check on: {root}\n")
    ds = FSLDataset(root, augment=False, use_landmarks=True)

    if len(ds) == 0:
        print("Dataset is empty — check your root_dir path.")
        sys.exit(1)

    frames, landmarks, label = ds[0]

    print(f"\nSample 0:")
    print(f"  frames    shape : {frames.shape}")       # [32, 5, 224, 224]
    print(f"  landmarks shape : {landmarks.shape}")    # [32, 63]
    print(f"  label           : {label.item()} ({ds.classes[label.item()]})")
    print(f"  frames    dtype : {frames.dtype}")
    print(f"  landmarks dtype : {landmarks.dtype}")
    print(f"  frames    min/max: {frames.min():.3f} / {frames.max():.3f}")
    print(f"  flow channels   : {frames[:, 3:, :, :].abs().mean():.4f} mean abs")
    print(f"  landmark zeros  : {(landmarks == 0).all(dim=1).sum().item()} / {TARGET_FRAMES} frames")