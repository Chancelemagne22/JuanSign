import torch
import torch.optim as optim
import torch.nn as nn
from resnet_lstm_architecture import ResNetLSTM
from fsl_dataset import FSLDataset
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms



train_ds = FSLDataset("../processed_output", transform=transforms)
train_loader = DataLoader(train_ds, batch_size=8, shuffle=True)



device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = ResNetLSTM(num_classes=5).to(device) # Start with your 5 


criterion = nn.CrossEntropyLoss()
optimizer = optim.Adam(model.parameters(), lr=0.0001)

epochs = 20 # Start with 20 epochs

for epoch in range(epochs):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    for inputs, labels in train_loader:
        inputs, labels = inputs.to(device), labels.to(device)

        optimizer.zero_grad()
        outputs = model(inputs)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        running_loss += loss.item()
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

    print(f"Epoch {epoch+1}/{epochs} - Loss: {running_loss/len(train_loader):.4f} - Acc: {100.*correct/total:.2f}%")

# Save the model weights
torch.save(model.state_dict(), "juansign_model.pth")