# ml-model/src/train.py
# JuanSign V2.2 — ResNet50 + Modal & Local Hybrid Optimized

import os
import json
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from torch.utils.tensorboard import SummaryWriter
from collections import Counter

import numpy as np
from sklearn.metrics import confusion_matrix, classification_report
import matplotlib
matplotlib.use("Agg")  # No display needed on server
import matplotlib.pyplot as plt
import seaborn as sns

from fsl_datasets import FSLDataset, collate_fn
from resnet_lstm_architecture import ResNetLSTM

# ── CONFIG (HYBRID PATHING) ──────────────────────────────────────────────────
IS_MODAL = "MODAL_RUN" in os.environ

CLASS_NAMES = ["what", "when", "where", "who", "why"]
NUM_CLASSES = len(CLASS_NAMES)

if IS_MODAL:
    FRAME_ROOT      = "/data/processed_output/frame_extracted"
    MODEL_SAVE_PATH = "/data/models/juansign_v2_2.pth"
    LOG_DIR         = "/data/runs/v2_2_pilot"
    RESULTS_DIR     = "/data/results"
    BATCH_SIZE          = 16   # Frozen phase
    BATCH_SIZE_UNFREEZE = 6    # Reduced after ResNet50 unfreezes (VRAM spike)
else:
    FRAME_ROOT      = "./processed_output/frame_extracted"
    MODEL_SAVE_PATH = "./juansignmodel/juansign_model_v2_2.pth"
    LOG_DIR         = "./runs/v2_2_pilot"
    RESULTS_DIR     = "./results"
    BATCH_SIZE      = 4

EPOCHS              = 50
LEARNING_RATE       = 1e-4
FREEZE_EPOCHS       = 3
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
        weights.append(total_samples / (len(train_dataset.classes) * count))
    weights_tensor = torch.FloatTensor(weights).to(device)
    return nn.CrossEntropyLoss(weight=weights_tensor, label_smoothing=0.1)

# ══════════════════════════════════════════════════════════════════════════════
# TRAINING & EVAL STEPS (AMP Enabled)
# ══════════════════════════════════════════════════════════════════════════════

def train_one_epoch(model, loader, criterion, optimizer, scaler, device):
    model.train()
    total_loss, total_correct, total_samples = 0.0, 0, 0
    for frames, landmarks, labels in loader:
        frames, landmarks, labels = frames.to(device), landmarks.to(device), labels.to(device)
        optimizer.zero_grad()
        with torch.cuda.amp.autocast():
            logits = model(frames, landmarks)
            loss   = criterion(logits, labels)
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
            preds          = logits.argmax(dim=1)
            total_correct += (preds == labels).sum().item()
            total_loss    += loss.item() * frames.size(0)
            total_samples += frames.size(0)
    return total_loss / total_samples, total_correct / total_samples * 100

# ══════════════════════════════════════════════════════════════════════════════
# AUTOMATED TESTING — Full Report on Test Set
# ══════════════════════════════════════════════════════════════════════════════

def run_test_evaluation(model, criterion, device, class_names):
    """
    Runs after training completes on the held-out test set.
    Produces:
      - Per-class accuracy report (precision, recall, F1)
      - Confusion matrix image
      - JSON results file
    """
    print("\n" + "═"*55)
    print("  AUTOMATED TEST EVALUATION")
    print("═"*55)

    test_ds = FSLDataset(os.path.join(FRAME_ROOT, "testing"), augment=False)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)

    model.eval()
    all_preds, all_labels = [], []
    total_loss, total_samples = 0.0, 0

    with torch.no_grad():
        for frames, landmarks, labels in test_loader:
            frames, landmarks, labels = frames.to(device), landmarks.to(device), labels.to(device)
            with torch.cuda.amp.autocast():
                logits = model(frames, landmarks)
                loss   = criterion(logits, labels)
            preds = logits.argmax(dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())
            total_loss    += loss.item() * frames.size(0)
            total_samples += frames.size(0)

    test_loss = total_loss / total_samples
    test_acc  = np.mean(np.array(all_preds) == np.array(all_labels)) * 100

    # ── Classification Report ─────────────────────────────────────────────────
    report = classification_report(
        all_labels, all_preds,
        target_names=class_names,
        output_dict=True
    )
    print(f"\n  Test Loss     : {test_loss:.4f}")
    print(f"  Test Accuracy : {test_acc:.2f}%\n")
    print(classification_report(all_labels, all_preds, target_names=class_names))

    # ── Confusion Matrix ──────────────────────────────────────────────────────
    cm = confusion_matrix(all_labels, all_preds)
    fig, ax = plt.subplots(figsize=(max(6, len(class_names)), max(5, len(class_names) - 1)))
    sns.heatmap(
        cm, annot=True, fmt="d", cmap="Blues",
        xticklabels=class_names, yticklabels=class_names, ax=ax
    )
    ax.set_title("JuanSign V2.2 — Confusion Matrix (Test Set)")
    ax.set_ylabel("True Label")
    ax.set_xlabel("Predicted Label")
    plt.tight_layout()

    cm_path = os.path.join(RESULTS_DIR, "confusion_matrix.png")
    plt.savefig(cm_path, dpi=150)
    plt.close()
    print(f"  Confusion matrix saved → {cm_path}")

    # ── JSON Summary ──────────────────────────────────────────────────────────
    summary = {
        "test_accuracy": round(test_acc, 4),
        "test_loss":     round(test_loss, 6),
        "per_class":     {
            cls: {
                "precision": round(report[cls]["precision"], 4),
                "recall":    round(report[cls]["recall"], 4),
                "f1_score":  round(report[cls]["f1-score"], 4),
                "support":   report[cls]["support"],
            }
            for cls in class_names
        }
    }
    results_path = os.path.join(RESULTS_DIR, "test_results.json")
    with open(results_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  Results JSON saved    → {results_path}")
    print("═"*55 + "\n")

    return test_acc

# ══════════════════════════════════════════════════════════════════════════════
# MAIN RUNNER
# ══════════════════════════════════════════════════════════════════════════════

def train():
    torch.manual_seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)

    print(f"--- Training JuanSign V2.2 on {torch.cuda.get_device_name(0)} ---")
    print(f"--- Dataset: {FRAME_ROOT} | Batch Size: {BATCH_SIZE} ---")

    # 1. Data
    train_ds = FSLDataset(os.path.join(FRAME_ROOT, "training"), augment=True)
    val_ds   = FSLDataset(os.path.join(FRAME_ROOT, "validation"), augment=False)

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,  collate_fn=collate_fn, pin_memory=True)
    val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)

    # 2. Model & AMP Scaler
    model  = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    scaler = torch.cuda.amp.GradScaler()
    model.freeze_backbone()

    # 3. Loss, Optimizer, Scheduler
    criterion = get_criterion(train_ds, device)
    optimizer = optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=LEARNING_RATE)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
    writer    = SummaryWriter(log_dir=LOG_DIR)

    best_val_acc       = 0.0
    epochs_no_improve  = 0
    history            = {"train_loss": [], "val_loss": [], "train_acc": [], "val_acc": []}

    for epoch in range(1, EPOCHS + 1):
        if epoch == FREEZE_EPOCHS + 1:
            model.unfreeze_backbone()
            optimizer = optim.Adam([
                {"params": model.visual_encoder.parameters(),   "lr": 1e-6},
                {"params": model.landmark_encoder.parameters(), "lr": 1e-4},
                {"params": model.bilstm.parameters(),           "lr": 1e-4},
                {"params": model.fc.parameters(),               "lr": 1e-4},
            ])
            scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)

            # Recreate loaders with smaller batch to handle VRAM spike after unfreeze
            train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE_UNFREEZE, shuffle=True,  collate_fn=collate_fn, pin_memory=True)
            val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE_UNFREEZE, shuffle=False, collate_fn=collate_fn)
            print(f"\n--- ResNet50 Unfrozen | Batch size → {BATCH_SIZE_UNFREEZE} ---")

        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, scaler, device)
        val_loss,   val_acc   = evaluate(model, val_loader, criterion, device)

        scheduler.step(val_loss)

        # ── TensorBoard (Accuracy + Loss) ─────────────────────────────────────
        writer.add_scalars("Accuracy", {"train": train_acc, "val": val_acc}, epoch)
        writer.add_scalars("Loss",     {"train": train_loss, "val": val_loss}, epoch)

        # ── History tracking ──────────────────────────────────────────────────
        history["train_loss"].append(round(train_loss, 6))
        history["val_loss"].append(round(val_loss, 6))
        history["train_acc"].append(round(train_acc, 4))
        history["val_acc"].append(round(val_acc, 4))

        print(f"Epoch {epoch:02d} | "
              f"Train Loss: {train_loss:.4f} | Train Acc: {train_acc:.1f}% | "
              f"Val Loss: {val_loss:.4f} | Val Acc: {val_acc:.1f}%")

        if val_acc > best_val_acc:
            best_val_acc      = val_acc
            epochs_no_improve = 0
            torch.save({
                "model_state": model.state_dict(),
                "class_names": CLASS_NAMES,
                "num_classes": NUM_CLASSES,
            }, MODEL_SAVE_PATH)
            print(f"  ✓ Model saved → {MODEL_SAVE_PATH}")
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= EARLY_STOP_PATIENCE:
                print("Early stopping triggered.")
                break

        torch.cuda.empty_cache()

    writer.close()

    # ── Save training curves ──────────────────────────────────────────────────
    _save_training_curves(history)

    # ── Save history JSON ─────────────────────────────────────────────────────
    with open(os.path.join(RESULTS_DIR, "training_history.json"), "w") as f:
        json.dump(history, f, indent=2)

    print(f"\nDone! Best Val Acc: {best_val_acc:.2f}%")

    # ── Automated Test Evaluation ─────────────────────────────────────────────
    checkpoint = torch.load(MODEL_SAVE_PATH, map_location=device)
    model.load_state_dict(checkpoint["model_state"])
    run_test_evaluation(model, criterion, device, CLASS_NAMES)


def _save_training_curves(history):
    """Saves accuracy and loss curve plots to RESULTS_DIR."""
    epochs = range(1, len(history["train_acc"]) + 1)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    # Accuracy
    ax1.plot(epochs, history["train_acc"], label="Train Acc", marker="o", markersize=3)
    ax1.plot(epochs, history["val_acc"],   label="Val Acc",   marker="o", markersize=3)
    ax1.set_title("Accuracy")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Accuracy (%)")
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Loss
    ax2.plot(epochs, history["train_loss"], label="Train Loss", marker="o", markersize=3)
    ax2.plot(epochs, history["val_loss"],   label="Val Loss",   marker="o", markersize=3)
    ax2.set_title("Loss")
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Loss")
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    fig.suptitle("JuanSign V2.2 — Training Curves", fontsize=14)
    plt.tight_layout()
    path = os.path.join(RESULTS_DIR, "training_curves.png")
    plt.savefig(path, dpi=150)
    plt.close()
    print(f"  Training curves saved → {path}")


if __name__ == "__main__":
    train()