import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.metrics import confusion_matrix, classification_report
import seaborn as sns
import matplotlib.pyplot as plt
import numpy as np

# Import your custom classes
from resnet_lstm_architecture import ResNetLSTM
from fsl_dataset import FSLDataset
from torch.nn.utils.rnn import pad_sequence

def collate_fn(batch):
    """
    Pads videos to the same length
    batch: list of tuples (video_tensor, label)
    """
    videos = [item[0] for item in batch]  # Get all videos
    labels = [item[1] for item in batch]  # Get all labels

    # Pad videos to max length in batch
    videos_padded = pad_sequence(videos, batch_first=True, padding_value=0)
    labels = torch.tensor(labels)

    return videos_padded, labels

def run_visualization():
    # 1. Setup Device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # 2. Load Dataset
    # We use the testing_data folder for the final exam
    test_ds = FSLDataset(r"C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\ml-model\processed_output\model_check") # Change to DB 
    classes = ['A', 'B', 'C', 'G', 'H'] # Change or Add new Values 
    test_loader = DataLoader(test_ds, batch_size=4, shuffle=False, collate_fn=collate_fn)


    model = ResNetLSTM(num_classes=5).to(device)

    # 3. Initialize and Load Model
    if len(test_ds.classes) != 5:
        print(f"Warning: Dataset found {len(test_ds.classes)} classes, but model needs 4.")
    
    # Load the weights
    # map_location ensures it works even if you trained on GPU but are testing on CPU
    model.load_state_dict(torch.load("./juansignmodel/juansign_model.pth", map_location=device))
    model.eval()
    print("Model weights loaded successfully.")

    # 4. Gather Predictions
    y_true = []
    y_pred = []
    print(f"Dataset classes: {test_ds.classes}")
    print(f"Number of classes: {len(test_ds.classes)}")
    print("Running final test on unseen data...")
    with torch.no_grad():
        for inputs, labels in test_loader:
            inputs = inputs.to(device)
            outputs = model(inputs)
            _, predicted = torch.max(outputs, 1)
            
            y_true.extend(labels.numpy())
            y_pred.extend(predicted.cpu().numpy())

    # 5. Show Classification Report
    print("\n--- PERFORMANCE REPORT ---")
    print(classification_report(y_true, y_pred, target_names=classes))

    # 6. Plot Confusion Matrix
    cm = confusion_matrix(y_true, y_pred)
    plt.figure(figsize=(10, 8))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
                xticklabels=classes, yticklabels=classes)
    plt.title('JuanSign: Final Test Confusion Matrix')
    plt.ylabel('Actual Letter')
    plt.xlabel('AI Prediction')
    
    # Save the image for your Word document
    plt.savefig('final_confusion_matrix.png', dpi=300)
    print("Graph saved as final_confusion_matrix.png")
    plt.show()

if __name__ == "__main__":
    run_visualization()
    test_ds = FSLDataset('./processed_output/model_check')
    print(len(test_ds))