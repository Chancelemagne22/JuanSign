import torch
from resnet_lstm_architecture import ResNetLSTM

# 1. Define the device
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 2. Recreate the architecture (The "Shell")
# Crucial: The parameters (num_classes) must match exactly what you used during training!
model = ResNetLSTM(num_classes=5) 

# 3. Load the weights (The "Brain")
model.load_state_dict(torch.load('./juansignmodel/juansign_model.pth', map_location=device))
# 4. Move to device and set to Evaluation Mode
model.to(device)
model.eval() 

print("Model loaded successfully and ready for inference!")