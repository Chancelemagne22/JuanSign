# ml-model/src/train.py
#
# JuanSign V2.1 — Phrase-Ready Training Script
#
# Changes:
#   - Fixed "C-Bias" using Weighted Cross-Entropy + Label Smoothing.
#   - Upgraded to 126-dim landmarks for dual-hand phrases.
#   - Added Sample mirroring support through FSLDataset.

import os
import time
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from torch.utils.tensorboard import SummaryWriter

from fsl_dataset import FSLDataset, collate_fn
from resnet_lstm_architecture import ResNetLSTM

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════════════

# UPDATE THIS: List your 28 phrase/letter classes here in alphabetical order
CLASS_NAMES = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", 
    "K", "L", "M", "N", "N~", "O", "P", "Q", "R", "S", 
    "T", "U", "V", "W", "X", "Y", "Z", "Ñ" # Example 28 classes
]
NUM_CLASSES = len(CLASS_NAMES)

# Paths
FRAME_ROOT      = "./processed_output/frame_extracted"
MODEL_SAVE_PATH = "./ml-model/juansignmodel/juansign_model.pth"
LOG_DIR         = "./ml-model/runs"

# Hyperparameters
EPOCHS              = 50     # Increased for phrase complexity
BATCH_SIZE          = 8      # Use 8 if GPU memory allows, otherwise stay at 4
LEARNING_RATE       = 1e-4   
FREEZE_EPOCHS       = 15     # More time for BiLSTM to learn motion before unfreezing ResNet
EARLY_STOP_PATIENCE = 7      
LR_PATIENCE         = 3      
LR_FACTOR           = 0.5
SEED                = 42

# ══════════════════════════════════════════════════════════════════════════════
# LOSS FUNCTION WITH "C-BIAS" FIX
# ══════════════════════════════════════════════════════════════════════════════

def get_criterion(device):
    """
    Creates a Weighted Cross Entropy Loss.
    We reduce the weight of class 'C' to force the model to prioritize 
    other letters/phrases.
    """
    weights = torch.ones(NUM_CLASSES).to(device)
    
    # Identify the index of 'C' (the over-predicted class)
    if "C" in CLASS_NAMES:
        c_idx = CLASS_NAMES.index("C")
        # Give 'C' only 40% of the weight of other classes
        weights[c_idx] = 0.4 
        print(f"[Loss] Applied weight 0.4 to class 'C' at index {c_idx}")

    # Label smoothing (0.1) makes the model less 'stubborn' and helps 
    # prevent it from defaulting to a majority class.
    return nn.CrossEntropyLoss(weight=weights, label_smoothing=0.1)

# ══════════════════════════════════════════════════════════════════════════════
# TRAINING LOGIC
# ══════════════════════════════════════════════════════════════════════════════

def train_one_epoch(model, loader, criterion, optimizer, device, epoch):
    model.train()
    total_loss, total_correct, total_samples = 0.0, 0, 0

    for batch_idx, (frames, landmarks, labels) in enumerate(loader):
        frames    = frames.to(device, non_blocking=True)
        landmarks = landmarks.to(device, non_blocking=True) # Now 126-dim
        labels    = labels.to(device, non_blocking=True)

        optimizer.zero_grad()
        logits = model(frames, landmarks)
        loss   = criterion(logits, labels)
        
        loss.backward()
        # Clip gradients to prevent BiLSTM from 'exploding'
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
        optimizer.step()

        preds          = logits.argmax(dim=1)
        total_correct += (preds == labels).sum().item()
        total_loss    += loss.item() * frames.size(0)
        total_samples += frames.size(0)

    return total_loss / total_samples, total_correct / total_samples * 100

def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss, total_correct, total_samples = 0.0, 0, 0
    with torch.no_grad():
        for frames, landmarks, labels in loader:
            frames, landmarks, labels = frames.to(device), landmarks.to(device), labels.to(device)
            logits = model(frames, landmarks)
            loss   = criterion(logits, labels)
            preds  = logits.argmax(dim=1)
            total_correct += (preds == labels).sum().item()
            total_loss    += loss.item() * frames.size(0)
            total_samples += frames.size(0)
    return total_loss / total_samples, total_correct / total_samples * 100

# ══════════════════════════════════════════════════════════════════════════════
# MAIN LOOP
# ══════════════════════════════════════════════════════════════════════════════

def train():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # 1. Load Data
    train_ds = FSLDataset(os.path.join(FRAME_ROOT, "training_data"), augment=True)
    val_ds   = FSLDataset(os.path.join(FRAME_ROOT, "validation_data"), augment=False)
    
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate_fn)
    val_loader   = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)

    # 2. Build Model
    model = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    model.freeze_backbone() # Start with frozen ResNet
    
    # 3. Loss & Optimizer
    criterion = get_criterion(device)
    optimizer = optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=LEARNING_RATE)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=LR_FACTOR, patience=LR_PATIENCE)
    writer    = SummaryWriter(log_dir=LOG_DIR)

    best_val_acc = 0.0
    epochs_no_improve = 0

    for epoch in range(1, EPOCHS + 1):
        # Unfreeze Backbone logic
        if epoch == FREEZE_EPOCHS + 1:
            model.unfreeze_backbone()
            # Lower LR for fine-tuning
            for param_group in optimizer.param_groups:
                param_group['lr'] = LEARNING_RATE * 0.1
            print(f"--- Backbone UNFROZEN at Epoch {epoch} ---")

        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, device, epoch)
        val_loss, val_acc     = evaluate(model, val_loader, criterion, device)
        
        scheduler.step(val_loss)
        
        print(f"Epoch {epoch:02d} | Train Acc: {train_acc:.1f}% | Val Acc: {val_acc:.1f}% | Loss: {val_loss:.4f}")

        # Logging & Saving
        writer.add_scalars("Accuracy", {"train": train_acc, "val": val_acc}, epoch)
        
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            epochs_no_improve = 0
            torch.save({
                "model_state": model.state_dict(),
                "class_names": CLASS_NAMES,
                "num_classes": NUM_CLASSES
            }, MODEL_SAVE_PATH)
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= EARLY_STOP_PATIENCE:
                print("Early stopping triggered.")
                break

    writer.close()
    print(f"Training Complete. Best Val Acc: {best_val_acc:.2f}%")

if __name__ == "__main__":
    train()