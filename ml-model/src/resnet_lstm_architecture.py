
import torch
import torch.nn as nn
from torchvision import models

class ResNetLSTM(nn.Module):
    def __init__(self, num_classes):
        super(ResNetLSTM, self).__init__()
        # ── Priority 7: Use explicit weights enum instead of deprecated weights=True ✅
        # weights=True was deprecated in PyTorch 0.13 and raises a UserWarning.
        # IMAGENET1K_V1 is the same checkpoint — this just makes the intent explicit.
        resnet = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)

        # Feature Extractor (Chop off the last layer)
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])

        # LSTM Layer
        self.lstm = nn.LSTM(input_size=512, hidden_size=256, num_layers=1, batch_first=True)

        # Classification Head
        self.fc = nn.Linear(256, num_classes)
        self.dropout = nn.Dropout(p=0.5)

    def forward(self, x):
        batch_size, timesteps, C, H, W = x.size()

        # Shape frames for ResNet: (Batch*16, 3, 224, 224)
        c_in = x.view(batch_size * timesteps, C, H, W)
        features = self.feature_extractor(c_in)

        # Shape for LSTM: (Batch, 16, 512)
        features = features.view(batch_size, timesteps, -1)

        # LSTM Process
        lstm_out, _ = self.lstm(features)
        drop_out = self.dropout(lstm_out[:, -1, :]) # Add dropout here

        # Predict based on the last frame's hidden state
        out = self.fc(drop_out)
        return out


