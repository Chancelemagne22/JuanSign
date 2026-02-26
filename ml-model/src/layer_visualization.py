import matplotlib.pyplot as plt

def visualize_resnet_features(model, loader):
    model.eval()
    # Get one batch from the test loader
    inputs, labels = next(iter(loader))
    single_video = inputs[0].to(device) # Shape: [16, 3, 224, 224]

    # Let's look at the first frame of that video
    first_frame = single_video[0].unsqueeze(0)

    # Access the first layer of ResNet
    # In ResNet18, 'layer1' is a good place to look
    with torch.no_grad():
        # Pass the frame through just the first few parts of ResNet
        x = model.feature_extractor[0](first_frame) # Conv1
        x = model.feature_extractor[1](x) # BN
        x = model.feature_extractor[2](x) # ReLU
        feature_maps = model.feature_extractor[4](x) # MaxPool

    # Plot the first 16 "filters" the AI uses
    plt.figure(figsize=(12, 6))
    for i in range(16):
        plt.subplot(4, 4, i+1)
        plt.imshow(feature_maps[0, i].cpu().numpy(), cmap='gray')
        plt.axis('off')
    plt.suptitle("Layer 1 Feature Maps (What ResNet Sees)")
    plt.show()

visualize_resnet_features(model, validation_loader)
visualize_resnet_features(model, testing_loader)
visualize_resnet_features(model, train_loader)