# ml-model/src/train.py
# JuanSign V2.2 — ResNet50 + RTX 2070 Optimized + Automated Weighting

import os
import time
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from torch.utils.tensorboard import SummaryWriter
from collections import Counter

from fsl_datasets import FSLDataset, collate_fn
from resnet_lstm_architecture import ResNetLSTM

# ── CONFIG ────────────────────────────────────────────────────────────────────
CLASS_NAMES = ["A", "B", "C", "D", "E"] # Start with Pilot
NUM_CLASSES = len(CLASS_NAMES)

FRAME_ROOT      = "./processed_output/frame_extracted"
MODEL_SAVE_PATH = "./juansignmodel/juansign_model_v2_2.pth"
LOG_DIR         = "./runs/v2_2_pilot"

# RTX 2070 Optimizations
BATCH_SIZE          = 4      # ResNet50 is heavy; start with 4 (or 2 if it crashes)
EPOCHS              = 50
LEARNING_RATE       = 1e-4   
FREEZE_EPOCHS       = 3      # Early unfreeze for better visual alignment
EARLY_STOP_PATIENCE = 7      
SEED                = 42

# ══════════════════════════════════════════════════════════════════════════════
# AUTOMATED WEIGHTING & CRITERION
# ══════════════════════════════════════════════════════════════════════════════

def get_criterion(train_dataset, device):
    labels = [s[1] for s in train_dataset.samples]
    label_counts = Counter(labels)
    total_samples = len(labels)
    
    weights = []
    for i in range(len(train_dataset.classes)):
        count = label_counts.get(i, 1)
        # Formula: total / (classes * count)
        weights.append(total_samples / (len(train_dataset.classes) * count))
        
    weights_tensor = torch.FloatTensor(weights).to(device)
    print(f"\n[Loss] Automated Weights: {dict(zip(train_dataset.classes, [round(w,2) for w in weights]))}")
    
    return nn.CrossEntropyLoss(weight=weights_tensor, label_smoothing=0.1)

# ══════════════════════════════════════════════════════════════════════════════
# TRAINING STEP WITH MIXED PRECISION (AMP)
# ══════════════════════════════════════════════════════════════════════════════

def train_one_epoch(model, loader, criterion, optimizer, scaler, device):
    model.train()
    total_loss, total_correct, total_samples = 0.0, 0, 0

    for frames, landmarks, labels in loader:
        frames, landmarks, labels = frames.to(device), landmarks.to(device), labels.to(device)

        optimizer.zero_grad()
        
        # Runs the forward pass with mixed precision
        with torch.cuda.amp.autocast():
            logits = model(frames, landmarks)
            loss   = criterion(logits, labels)
        
        # Scaled backward pass
        scaler.scale(loss).backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
        scaler.step(optimizer)
        scaler.update()

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
            with torch.cuda.amp.autocast():
                logits = model(frames, landmarks)
                loss   = criterion(logits, labels)
            
            preds  = logits.argmax(dim=1)
            total_correct += (preds == labels).sum().item()
            total_loss    += loss.item() * frames.size(0)
            total_samples += frames.size(0)
    return total_loss / total_samples, total_correct / total_samples * 100

# ══════════════════════════════════════════════════════════════════════════════
# MAIN RUNNER
# ══════════════════════════════════════════════════════════════════════════════

def train():
    torch.manual_seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"--- Training JuanSign V2.2 on {torch.cuda.get_device_name(0)} ---")
    
    # 1. Data
    train_ds = FSLDataset(os.path.join(FRAME_ROOT, "training_data"), augment=True)
    val_ds   = FSLDataset(os.path.join(FRAME_ROOT, "validation_data"), augment=False)
    
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate_fn, pin_memory=True)
    val_loader   = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)

    # 2. Model & AMP Scaler
    model = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    scaler = torch.cuda.amp.GradScaler() # Prevents gradient underflow in Float16
    model.freeze_backbone()
    
    # 3. Loss & Initial Optimizer
    criterion = get_criterion(train_ds, device)
    optimizer = optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=LEARNING_RATE)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
    writer    = SummaryWriter(log_dir=LOG_DIR)

    best_val_acc = 0.0
    epochs_no_improve = 0

    for epoch in range(1, EPOCHS + 1):
        # Differential LR Unfreeze
        if epoch == FREEZE_EPOCHS + 1:
            model.unfreeze_backbone()
            optimizer = optim.Adam([
                {'params': model.visual_encoder.parameters(),   'lr': 1e-6},
                {'params': model.landmark_encoder.parameters(), 'lr': 1e-4},
                {'params': model.bilstm.parameters(),           'lr': 1e-4},
                {'params': model.fc.parameters(),               'lr': 1e-4}
            ])
            scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
            print(f"\n--- ResNet50 Unfrozen (Differential LR) ---")

        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, scaler, device)
        val_loss, val_acc     = evaluate(model, val_loader, criterion, device)
        
        scheduler.step(val_loss)
        writer.add_scalars("Accuracy", {"train": train_acc, "val": val_acc}, epoch)
        print(f"Epoch {epoch:02d} | Train: {train_acc:.1f}% | Val: {val_acc:.1f}% | Loss: {val_loss:.4f}")

        # Save Best
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            epochs_no_improve = 0
            torch.save({"model_state": model.state_dict(), "class_names": CLASS_NAMES, "num_classes": NUM_CLASSES}, MODEL_SAVE_PATH)
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= EARLY_STOP_PATIENCE:
                print("Early stopping.")
                break
        
        torch.cuda.empty_cache() # Keeps VRAM clean

    writer.close()
    print(f"Done! Best Val Acc: {best_val_acc:.2f}%")

if __name__ == "__main__":
    train()