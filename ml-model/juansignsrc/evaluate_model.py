# ml-model/src/evaluate_model.py
#
# Evaluation script for JuanSign V2.1 (Pilot: A-E)
#
# Generates:
#   1. Overall Accuracy
#   2. Confusion Matrix (Visual Grid of mismatches)
#   3. Classification Report (Precision, Recall, F1-Score)
#   4. List of "Hardest" samples (where the model was most wrong)

import os
import torch
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import confusion_matrix, classification_report
from torch.utils.data import DataLoader

# Import your custom modules
from fsl_datasets import FSLDataset, collate_fn
from resnet_lstm_architecture import ResNetLSTM

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

# REMINDER: When moving to 28 classes, update this list exactly like in train.py
CLASS_NAMES     = ["A", "B", "C", "D", "E"] 
NUM_CLASSES     = len(CLASS_NAMES)

# PATHS
MODEL_PATH      = "./juansignmodel/juansign_model.pth"
TEST_DATA_ROOT  = "./processed_output/frame_extracted/testing_data"
SAVE_PLOT_PATH  = "./evaluation_results.png"

# MODEL CONSTANTS (Must match V2.1 architecture)
LANDMARK_FEATURE = 126  # 2 hands
BATCH_SIZE       = 8
DEVICE           = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# ══════════════════════════════════════════════════════════════════════════════
# EVALUATION ENGINE
# ══════════════════════════════════════════════════════════════════════════════

def run_evaluation():
    print(f"[Init] Starting Evaluation on {DEVICE}...")

    # 1. Load Dataset
    test_ds = FSLDataset(root_dir=TEST_DATA_ROOT, augment=False)
    test_loader = DataLoader(
        test_ds, 
        batch_size=BATCH_SIZE, 
        shuffle=False, 
        collate_fn=collate_fn
    )

    # 2. Load Model
    # REMINDER: For 28 classes, the model init will automatically use len(CLASS_NAMES)
    model = ResNetLSTM(num_classes=NUM_CLASSES).to(DEVICE)
    
    if not os.path.exists(MODEL_PATH):
        print(f"[Error] Model file not found at {MODEL_PATH}")
        return

    checkpoint = torch.load(MODEL_PATH, map_location=DEVICE)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    print(f"[Model] Successfully loaded weights for {NUM_CLASSES} classes.")

    all_preds = []
    all_labels = []

    # 3. Inference Loop
    print(f"[Eval] Processing {len(test_ds)} samples...")
    with torch.no_grad():
        for frames, landmarks, labels in test_loader:
            frames = frames.to(DEVICE)
            landmarks = landmarks.to(DEVICE) # Should be [B, 32, 126]
            
            logits = model(frames, landmarks)
            preds = torch.argmax(logits, dim=1)
            
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())
                # Add this inside the 'with torch.no_grad():' loop in evaluate_model.py
        for i in range(len(all_preds)):
            if all_preds[i] != all_labels[i]:
                true_name = CLASS_NAMES[all_labels[i]]
                pred_name = CLASS_NAMES[all_preds[i]]
                # This assumes your dataset stores the path. 
                # If not, we can find them by index in test_ds.samples
                sample_path = test_ds.samples[i][0] 
                print(f"❌ MISCLASSIFIED: True={true_name}, Pred={pred_name}")
                print(f"   Path: {sample_path}\n")
    # ══════════════════════════════════════════════════════════════════════════
    # METRICS CALCULATION
    # ══════════════════════════════════════════════════════════════════════════

    # A. Accuracy & Classification Report
    report = classification_report(
        all_labels, 
        all_preds, 
        target_names=CLASS_NAMES,
        digits=4
    )
    print("\n--- CLASSIFICATION REPORT ---")
    print(report)

    # B. Confusion Matrix
    cm = confusion_matrix(all_labels, all_preds)
    
    # Visualization
    plt.figure(figsize=(10, 8))
    sns.heatmap(
        cm, 
        annot=True, 
        fmt='d', 
        cmap='Blues', 
        xticklabels=CLASS_NAMES, 
        yticklabels=CLASS_NAMES
    )
    plt.xlabel('Predicted Label')
    plt.ylabel('True Label')
    plt.title(f'JuanSign V2.1 Confusion Matrix ({NUM_CLASSES} Classes)')
    
    # Save the plot
    plt.savefig(SAVE_PLOT_PATH)
    print(f"[Done] Confusion Matrix saved to {SAVE_PLOT_PATH}")
    
    # C. Specific Bias Check (The "C-Bias" Detector)
    if "C" in CLASS_NAMES:
        c_idx = CLASS_NAMES.index("C")
        c_preds = all_preds.count(c_idx)
        total = len(all_preds)
        print(f"\n--- BIAS CHECK ---")
        print(f"Percentage of samples predicted as 'C': {(c_preds/total)*100:.2f}%")
        if (c_preds/total) > (1.5 / NUM_CLASSES):
            print("⚠️ WARNING: Your model is still showing a bias toward class 'C'.")
        else:
            print("✅ SUCCESS: Prediction distribution looks balanced.")

    plt.show()

if __name__ == "__main__":
    run_evaluation()