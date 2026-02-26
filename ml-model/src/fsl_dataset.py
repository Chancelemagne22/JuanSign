import torch
import os
from torch.utils.data import Dataset
from PIL import Image


class FSLDataset(Dataset):
    """
    Loads pre-extracted frame sequences from processed_output/<split>/<letter>/clip###/.

    Expected folder layout:
        root_dir/
            A/  clip001/  frame0000.jpg ... frame0015.jpg
                clip002/  ...
            B/  ...

    Args:
        root_dir  (str):              Path to the split folder (e.g. training_data/).
        transform (callable, optional): Transform applied to each frame image.
                                        Pass train_transform for training data and
                                        eval_transform for validation/test data.
                                        If None, frames are returned as raw PIL Images
                                        (not recommended — ToTensor is needed at minimum).
    """

    def __init__(self, root_dir, transform=None):
        self.root_dir = root_dir

        # ── Priority 3: Use the transform passed in, not a hardcoded one ✅ ────
        # Previously this always applied ColorJitter + RandomRotation regardless
        # of split, making val/test accuracy scores unreliable.
        # Now train.py controls which transform each split receives.
        self.transform = transform

        # Classes are derived from sorted subfolder names so the label index is
        # always alphabetical and consistent: A=0, B=1, C=2, G=3, H=4.
        self.classes = sorted(os.listdir(root_dir))
        self.data    = []

        for label, letter in enumerate(self.classes):
            letter_path = os.path.join(root_dir, letter)
            if not os.path.isdir(letter_path):
                continue
            for clip_folder in sorted(os.listdir(letter_path)):
                clip_path = os.path.join(letter_path, clip_folder)
                if os.path.isdir(clip_path):
                    self.data.append((clip_path, label))

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        clip_path, label = self.data[idx]
        frames = []

        # Load frames in sorted order so the temporal sequence is preserved.
        for frame_name in sorted(os.listdir(clip_path)):
            img_path = os.path.join(clip_path, frame_name)
            image    = Image.open(img_path).convert('RGB')

            # Apply the transform that was passed in at construction time.
            # train_transform → augmented (ColorJitter, RandomRotation, Normalize)
            # eval_transform  → clean      (ToTensor + Normalize only)
            if self.transform:
                image = self.transform(image)

            frames.append(image)

        return torch.stack(frames), label
