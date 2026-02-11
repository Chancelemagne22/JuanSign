import torch
import os
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image

class FSLDataset(Dataset):
    def __init__(self, root_dir, transform=None):
        self.root_dir = root_dir
        self.transform = transform

        self.classes = sorted(os.listdir(root_dir))
        self.data = []

        for label, letter in enumerate(self.classes):
            letter_path = os.path.join(root_dir, letter)
            for clip_folder in os.listdir(letter_path):
                clip_path = os.path.join(letter_path, clip_folder)
                self.data.append((clip_path,label))

    def __len__(self):
        return len(self.data)
    
    def __getitem__(self, idx):
        clip_path, label = self.data[idx]
        frames = []

        frame_names = sorted(os.listdir(clip_path))
        
        for frame_name in frame_names:
            img_path = os.path.join(clip_path, frame_name)
            image = Image.open(img_path).convert('RGB')
            if self.transform:
                image = self.transform(image)
            frames.append(image)

        return torch.stack(frames), label
    

transforms = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

