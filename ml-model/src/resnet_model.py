import torch
import torch.nn as nn
from torchvision import models

class ResNetLSTM(nn.Module):
    def __init__(self, num_classes):
        super(ResNetLSTM, self).__init__()

        # Loading the pretrained ResNet
        resnet = models.resnet18(pretrained=True)

        # Removing last layer of ResNet for the LSTM
        # ResNet18 output before fc is 512 features
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])

        # Freezing some layers

        for param in self.feature_extractor.parameters():
            param.requires_grad = False

        # LSTM LAYER

        self.lstm = nn.LSTM(input_size=512, hidden_size=256, num_layers=1,batch_first=True)

        self.fc = nn.Linear(256, num_classes)

    def forward(self, x):
        # x shape: [Batch, 16_Frames, 3_Channels, 128_H, 128_W]
        batch_size, timesteps, C, H, W = x.size()
        
        # This is where people get stuck: How to loop through 16 frames?
        c_in = x.view(batch_size * timesteps, C, H, W) 
        
        # Pass all frames through ResNet at once
        features = self.feature_extractor(c_in) # Shape: [Batch*16, 512, 1, 1]
        features = features.view(batch_size, timesteps, -1) # Shape: [Batch, 16, 512]
        
        # Pass the sequence of 16 vectors to LSTM
        lstm_out, (hidden, cell) = self.lstm(features)
        
        # We only care about the LSTM's "summary" at the 16th frame
        last_time_step = lstm_out[:, -1, :] # Shape: [Batch, 256]
        
        # Final prediction
        out = self.fc(last_time_step)
        return out