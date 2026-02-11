import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms

model = models.resnet18(weights= None)

model.eval()

print(model)