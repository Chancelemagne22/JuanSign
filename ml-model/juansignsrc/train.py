# ml-model/src/train.py
#
# Training script for the enhanced JuanSign ResNet+BiLSTM pipeline.
#
# What changed from the original:
#   - TARGET_FRAMES  : 16  → 32
#   - Model input    : 3-ch frames → 5-ch frames + landmark stream
#   - Model          : ResNetLSTM (1-layer LSTM) → ResNetLSTM (BiLSTM ×2 + LandmarkEncoder)
#   - Batch unpacking: (frames, label) → (frames, landmarks, label)
#   - Freeze/unfreeze: inline loop logic → model.freeze_backbone() / unfreeze_backbone()
#   - num_classes    : hardcoded 27 → NUM_CLASSES constant at top of config block
#   - collate_fn     : imported from fsl_dataset.py (single source of truth)

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
# CONFIG — all tunable values live here
# ══════════════════════════════════════════════════════════════════════════════

# ── Class names — update this when you add more letters ──────────────────────
# Order MUST be alphabetical — matches sorted(os.listdir()) in FSLDataset.
# Set NUM_CLASSES to len(CLASS_NAMES).
CLASS_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", 
               "K", "L", "M", "N", "N~", "O", "P", "Q", "R", "S", 
               "T", "U", "V", "W", "X", "Y", "Z"]    # current 5-class checkpoint
NUM_CLASSES = len(CLASS_NAMES)              # 5

# ── Paths — swap comment blocks for Colab vs local ───────────────────────────
# Local:
FRAME_ROOT      = "./processed_output/frame_extracted"
MODEL_SAVE_PATH = "./ml-model/juansignmodel/juansign_model.pth"
LOG_DIR         = "./ml-model/runs"

# Colab:
# DRIVE_ROOT      = "/content/drive/MyDrive/JuanSign"
# FRAME_ROOT      = f"{DRIVE_ROOT}/processed_output/frame_extracted"
# MODEL_SAVE_PATH = f"{DRIVE_ROOT}/juansignmodel/juansign_model.pth"
# LOG_DIR         = f"{DRIVE_ROOT}/runs"

# ── Training hyperparameters ──────────────────────────────────────────────────
EPOCHS              = 30     # was 25 — extra epochs for the deeper architecture
BATCH_SIZE          = 4      # reduced from 8 — 32 frames × 5 channels is heavier
LEARNING_RATE       = 1e-4   # slightly higher than before — BiLSTM starts from scratch
FREEZE_EPOCHS       = 10     # ResNet18 frozen for first 10 epochs
EARLY_STOP_PATIENCE = 5      # stop if val_loss doesn't improve for 5 epochs
LR_PATIENCE         = 3      # halve LR after 3 epochs of no val_loss improvement
LR_FACTOR           = 0.5

# ── Landmark stream ───────────────────────────────────────────────────────────
# Set False only if MediaPipe is too slow for your hardware during development.
# Must be True for final training — the architecture expects landmarks.
USE_LANDMARKS = True

# ── Reproducibility ───────────────────────────────────────────────────────────
SEED = 42


# ══════════════════════════════════════════════════════════════════════════════
# SETUP
# ══════════════════════════════════════════════════════════════════════════════

def set_seed(seed):
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    import numpy as np, random
    np.random.seed(seed)
    random.seed(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark     = False


def get_device():
    if torch.cuda.is_available():
        device = torch.device("cuda")
        print(f"[Device] GPU: {torch.cuda.get_device_name(0)}")
    else:
        device = torch.device("cpu")
        print("[Device] CPU — training will be slow")
    return device


# ══════════════════════════════════════════════════════════════════════════════
# DATA
# ══════════════════════════════════════════════════════════════════════════════

def build_dataloaders():
    train_ds = FSLDataset(
        root_dir      = os.path.join(FRAME_ROOT, "training_data"),
        augment       = True,
        use_landmarks = USE_LANDMARKS,
    )
    val_ds = FSLDataset(
        root_dir      = os.path.join(FRAME_ROOT, "validation_data"),
        augment       = False,
        use_landmarks = USE_LANDMARKS,
    )
    test_ds = FSLDataset(
        root_dir      = os.path.join(FRAME_ROOT, "testing_data"),
        augment       = False,
        use_landmarks = USE_LANDMARKS,
    )

    # Verify class alignment — FSLDataset derives classes from sorted folder names.
    # If this assertion fails, CLASS_NAMES in this file doesn't match your data.
    assert train_ds.classes == CLASS_NAMES, (
        f"Class mismatch!\n"
        f"  Expected : {CLASS_NAMES}\n"
        f"  Got      : {train_ds.classes}\n"
        f"  Fix      : update CLASS_NAMES in train.py to match your data folders."
    )

    train_loader = DataLoader(
        train_ds,
        batch_size  = BATCH_SIZE,
        shuffle     = True,
        collate_fn  = collate_fn,
        num_workers = 2,
        pin_memory  = True,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size  = BATCH_SIZE,
        shuffle     = False,
        collate_fn  = collate_fn,
        num_workers = 2,
        pin_memory  = True,
    )
    test_loader = DataLoader(
        test_ds,
        batch_size  = BATCH_SIZE,
        shuffle     = False,
        collate_fn  = collate_fn,
        num_workers = 2,
        pin_memory  = True,
    )

    print(f"\n── Dataset sizes ────────────────────────────────")
    print(f"  Train      : {len(train_ds)} clips")
    print(f"  Validation : {len(val_ds)} clips")
    print(f"  Test       : {len(test_ds)} clips")
    print(f"  Classes    : {CLASS_NAMES}")
    print()

    return train_loader, val_loader, test_loader


# ══════════════════════════════════════════════════════════════════════════════
# ONE EPOCH — TRAIN
# ══════════════════════════════════════════════════════════════════════════════

def train_one_epoch(model, loader, criterion, optimizer, device, epoch):
    model.train()
    total_loss  = 0.0
    total_correct = 0
    total_samples = 0

    for batch_idx, (frames, landmarks, labels) in enumerate(loader):
        frames    = frames.to(device, non_blocking=True)      # [B, 32, 5, 224, 224]
        landmarks = landmarks.to(device, non_blocking=True)   # [B, 32, 63]
        labels    = labels.to(device, non_blocking=True)      # [B]

        optimizer.zero_grad()

        logits = model(frames, landmarks)                     # [B, num_classes]
        loss   = criterion(logits, labels)

        loss.backward()

        # Gradient clipping — important for LSTM stability
        # Without this, large gradients can cause the hidden state to explode,
        # especially in the first few epochs before the backbone is unfrozen.
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)

        optimizer.step()

        # Accumulate metrics
        preds          = logits.argmax(dim=1)
        total_correct += (preds == labels).sum().item()
        total_loss    += loss.item() * frames.size(0)
        total_samples += frames.size(0)

        # Progress print every 10 batches
        if (batch_idx + 1) % 10 == 0:
            running_acc = total_correct / total_samples * 100
            print(
                f"  Epoch {epoch:02d} | Batch {batch_idx+1:03d}/{len(loader):03d} "
                f"| Loss: {loss.item():.4f} | Acc: {running_acc:.1f}%"
            )

    avg_loss = total_loss / total_samples
    avg_acc  = total_correct / total_samples * 100
    return avg_loss, avg_acc


# ══════════════════════════════════════════════════════════════════════════════
# ONE EPOCH — EVALUATE
# ══════════════════════════════════════════════════════════════════════════════

def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss    = 0.0
    total_correct = 0
    total_samples = 0

    with torch.no_grad():
        for frames, landmarks, labels in loader:
            frames    = frames.to(device, non_blocking=True)
            landmarks = landmarks.to(device, non_blocking=True)
            labels    = labels.to(device, non_blocking=True)

            logits = model(frames, landmarks)
            loss   = criterion(logits, labels)

            preds          = logits.argmax(dim=1)
            total_correct += (preds == labels).sum().item()
            total_loss    += loss.item() * frames.size(0)
            total_samples += frames.size(0)

    avg_loss = total_loss / total_samples
    avg_acc  = total_correct / total_samples * 100
    return avg_loss, avg_acc


# ══════════════════════════════════════════════════════════════════════════════
# MAIN TRAINING LOOP
# ══════════════════════════════════════════════════════════════════════════════

def train():
    set_seed(SEED)
    device = get_device()

    # ── Data ──────────────────────────────────────────────────────────────────
    train_loader, val_loader, test_loader = build_dataloaders()

    # ── Model ─────────────────────────────────────────────────────────────────
    model = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    model.count_parameters()

    # Freeze ResNet backbone for the first FREEZE_EPOCHS epochs.
    # BiLSTM, LandmarkEncoder, and FC train freely from epoch 0.
    model.freeze_backbone()

    # ── Loss, optimizer, scheduler ────────────────────────────────────────────
    criterion = nn.CrossEntropyLoss()

    # Adam with a moderate LR — BiLSTM and LandmarkEncoder start from scratch
    # so they need a higher LR than the fine-tuning phase.
    optimizer = optim.Adam(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr           = LEARNING_RATE,
        weight_decay = 1e-4,   # mild L2 regularisation
    )

    scheduler = optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode    = "min",
        factor  = LR_FACTOR,
        patience= LR_PATIENCE,
    )

    # ── TensorBoard ───────────────────────────────────────────────────────────
    writer = SummaryWriter(log_dir=LOG_DIR)

    # ── Checkpointing state ───────────────────────────────────────────────────
    os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
    best_val_acc  = 0.0
    best_val_loss = float("inf")
    epochs_no_improve = 0

    print(f"\n── Training starts ──────────────────────────────")
    print(f"  Epochs     : {EPOCHS}")
    print(f"  Batch size : {BATCH_SIZE}")
    print(f"  Freeze for : {FREEZE_EPOCHS} epochs")
    print(f"  LR         : {LEARNING_RATE}")
    print()

    for epoch in range(1, EPOCHS + 1):
        epoch_start = time.time()

        # ── Unfreeze backbone at FREEZE_EPOCHS ────────────────────────────────
        if epoch == FREEZE_EPOCHS + 1:
            model.unfreeze_backbone()

            # After unfreezing, rebuild the optimizer to include ResNet params.
            # If we don't do this, the new params won't have optimizer state
            # and will be updated at the wrong LR.
            current_lr = optimizer.param_groups[0]["lr"]
            optimizer = optim.Adam(
                model.parameters(),
                lr           = current_lr * 0.1,   # lower LR for fine-tuning
                weight_decay = 1e-4,
            )
            scheduler = optim.lr_scheduler.ReduceLROnPlateau(
                optimizer,
                mode    = "min",
                factor  = LR_FACTOR,
                patience= LR_PATIENCE,
            )
            print(f"  [Epoch {epoch}] Backbone unfrozen. Fine-tuning LR: {current_lr * 0.1:.2e}")

        # ── Train ─────────────────────────────────────────────────────────────
        train_loss, train_acc = train_one_epoch(
            model, train_loader, criterion, optimizer, device, epoch
        )

        # ── Validate ──────────────────────────────────────────────────────────
        val_loss, val_acc = evaluate(model, val_loader, criterion, device)

        # ── LR scheduler step ─────────────────────────────────────────────────
        scheduler.step(val_loss)
        current_lr = optimizer.param_groups[0]["lr"]

        # ── Epoch summary ─────────────────────────────────────────────────────
        elapsed = time.time() - epoch_start
        print(
            f"\nEpoch {epoch:02d}/{EPOCHS} ({elapsed:.0f}s) | "
            f"LR: {current_lr:.2e}\n"
            f"  Train → Loss: {train_loss:.4f}  Acc: {train_acc:.2f}%\n"
            f"  Val   → Loss: {val_loss:.4f}  Acc: {val_acc:.2f}%"
        )

        # ── TensorBoard logging ───────────────────────────────────────────────
        writer.add_scalars("Loss", {"train": train_loss, "val": val_loss}, epoch)
        writer.add_scalars("Acc",  {"train": train_acc,  "val": val_acc},  epoch)
        writer.add_scalar("LR", current_lr, epoch)

        # ── Save best checkpoint ──────────────────────────────────────────────
        if val_acc > best_val_acc:
            best_val_acc  = val_acc
            best_val_loss = val_loss
            epochs_no_improve = 0

            torch.save(
                {
                    "epoch"         : epoch,
                    "model_state"   : model.state_dict(),
                    "optimizer_state": optimizer.state_dict(),
                    "val_acc"       : val_acc,
                    "val_loss"      : val_loss,
                    "class_names"   : CLASS_NAMES,
                    "num_classes"   : NUM_CLASSES,
                },
                MODEL_SAVE_PATH,
            )
            print(f"  ✓ Saved best checkpoint — val_acc: {val_acc:.2f}%")
        else:
            epochs_no_improve += 1
            print(
                f"  No improvement ({epochs_no_improve}/{EARLY_STOP_PATIENCE}) "
                f"— best val_acc: {best_val_acc:.2f}%"
            )

        # ── Early stopping ────────────────────────────────────────────────────
        if epochs_no_improve >= EARLY_STOP_PATIENCE:
            print(f"\n[Early stop] No improvement for {EARLY_STOP_PATIENCE} epochs.")
            break

        print()

    # ── Final test evaluation ─────────────────────────────────────────────────
    print("\n── Loading best checkpoint for test evaluation ──")
    checkpoint = torch.load(MODEL_SAVE_PATH, map_location=device)
    model.load_state_dict(checkpoint["model_state"])

    test_loss, test_acc = evaluate(model, test_loader, criterion, device)

    print(f"\n── Final test results ───────────────────────────")
    print(f"  Test Loss : {test_loss:.4f}")
    print(f"  Test Acc  : {test_acc:.2f}%")
    print(f"  Best Val Acc  : {best_val_acc:.2f}%")
    print(f"  Classes   : {CLASS_NAMES}")
    print()

    writer.add_hparams(
        {
            "lr"            : LEARNING_RATE,
            "batch_size"    : BATCH_SIZE,
            "epochs"        : EPOCHS,
            "freeze_epochs" : FREEZE_EPOCHS,
            "num_classes"   : NUM_CLASSES,
        },
        {
            "hparam/test_acc"  : test_acc,
            "hparam/test_loss" : test_loss,
        },
    )
    writer.close()

    print(f"  Checkpoint saved at: {MODEL_SAVE_PATH}")
    print("── Training complete ────────────────────────────\n")


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    train()