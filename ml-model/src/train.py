import torch
import torch.optim as optim
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from torch.utils.tensorboard import SummaryWriter  # ✅ Priority 11 — wired up below
from torch.nn.utils.rnn import pad_sequence
from fsl_dataset import FSLDataset
from resnet_lstm_architecture import ResNetLSTM

import os

# ── Resolve paths relative to THIS FILE ───────────────────────────────────────
# Using __file__ means the script works regardless of which directory it is
# launched from (repo root, ml-model/, ml-model/src/, etc.).
_SRC_DIR   = os.path.dirname(os.path.abspath(__file__))          # ml-model/src/
_ML_DIR    = os.path.abspath(os.path.join(_SRC_DIR, '..'))       # ml-model/
_REPO_ROOT = os.path.abspath(os.path.join(_SRC_DIR, '../..'))    # repo root

_PROCESSED = os.path.join(_ML_DIR, 'processed_output', 'frame_extracted')

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")


def collate_fn(batch):
    """
    Pads variable-length video sequences in a batch with zeros so all clips
    share the same temporal length. Since frame_extractor.py guarantees exactly
    16 frames per clip this rarely activates, but keeps the loader safe against
    any edge-case short clips.

    Args:
        batch: list of (video_tensor [T, C, H, W], label) tuples
    Returns:
        videos_padded: Tensor [B, T_max, C, H, W]
        labels:        Tensor [B]
    """
    videos = [item[0] for item in batch]
    labels = [item[1] for item in batch]

    videos_padded = pad_sequence(videos, batch_first=True, padding_value=0)
    labels = torch.tensor(labels)

    return videos_padded, labels


# ── Priority 3: Separate transforms for train vs. eval ✅ ─────────────────────
# Augmentation (ColorJitter, RandomRotation) is applied ONLY to training data.
# Validation and test sets use a clean, deterministic pass so their accuracy
# scores reflect true model performance — not luck from random transforms.

train_transform = transforms.Compose([
    transforms.ColorJitter(brightness=0.2, contrast=0.2),  # Random brightness/contrast shift
    transforms.RandomRotation(10),                          # Small random rotation ±10°
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225])        # ImageNet mean/std
])

eval_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225])        # ImageNet mean/std — no augmentation
])


# ── Priority 1: Correct dataset paths ✅ ──────────────────────────────────────
# frame_extractor.py writes to <repo_root>/processed_output/frame_extracted/<split>/
# train.py runs from ml-model/src/, so ../../ navigates up to the repo root.

train_ds      = FSLDataset(os.path.join(_PROCESSED, 'training_data'),
                           transform=train_transform)
testing_ds    = FSLDataset(os.path.join(_PROCESSED, 'testing_data'),
                           transform=eval_transform)
validation_ds = FSLDataset(os.path.join(_PROCESSED, 'validation_data'),
                           transform=eval_transform)


train_loader = DataLoader(
    train_ds,
    batch_size=8,
    shuffle=True,       # Shuffle training data so each epoch sees a different batch order
    collate_fn=collate_fn
)

# ── Priority 6: No shuffle on eval loaders ✅ ─────────────────────────────────
# Shuffling eval sets does not affect accuracy but is incorrect practice —
# it makes per-batch results non-reproducible and is misleading to readers.

testing_loader = DataLoader(
    testing_ds,
    batch_size=8,
    shuffle=False,      # Test set must not be shuffled — deterministic evaluation only
    collate_fn=collate_fn
)

validation_loader = DataLoader(
    validation_ds,
    batch_size=8,
    shuffle=False,      # Validation set must not be shuffled — deterministic evaluation only
    collate_fn=collate_fn
)


model = ResNetLSTM(num_classes=5).to(device)  # 5 classes: A=0, B=1, C=2, G=3, H=4


# ── Priority 9: Freeze ResNet18 backbone for the first FREEZE_EPOCHS ✅ ────────
# The dataset is small (~500 training clips). Letting the LSTM and classifier
# head stabilise first — before back-propagating through all ResNet18 layers —
# preserves the pretrained ImageNet features that would otherwise be overwritten
# too early. After FREEZE_EPOCHS, everything is unfrozen for full fine-tuning.

FREEZE_EPOCHS = 10
for param in model.feature_extractor.parameters():
    param.requires_grad = False
print(f"ResNet18 backbone frozen for first {FREEZE_EPOCHS} epochs.")


criterion = nn.CrossEntropyLoss()  # Standard multi-class classification loss

# ── Priority 5 (comment fix): Learning rate is 1e-5 ✅ ────────────────────────
# 0.00001 == 1e-5. The previous comment incorrectly said 0.0001 (1e-4).
optimizer = optim.Adam(model.parameters(), lr=0.00001)  # Learning Rate: 1e-5


# ── Priority 8: Learning rate scheduler ✅ ────────────────────────────────────
# ReduceLROnPlateau halves the LR when validation loss stops improving for
# 3 consecutive epochs. This allows larger steps early in training and
# finer adjustments later — without manually designing a schedule.

scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
    optimizer, mode='min', factor=0.5, patience=3, 
)


epochs = 25


# ── Priority 11: TensorBoard SummaryWriter ✅ ──────────────────────────────────
# Logs train/val loss and accuracy after every epoch for live monitoring.
# Launch the dashboard with: tensorboard --logdir ml-model/runs  (from repo root)

writer = SummaryWriter(log_dir=os.path.join(_ML_DIR, 'runs', 'juansign'))


history = {
    'train_loss': [],
    'val_loss':   [],
    'train_acc':  [],
    'val_acc':    []
}


# ── Priority 4 & 10: Tracking variables for best-model saving + early stopping ✅
# best_val_acc        — checkpoint is written whenever this is beaten.
# best_val_loss       — used by early stopping; no improvement for
#                       EARLY_STOP_PATIENCE consecutive epochs halts training.

best_val_acc        = 0.0
best_val_loss       = float('inf')
EARLY_STOP_PATIENCE = 5
epochs_no_improve   = 0

# ── Priority 2: Correct model save path ✅ ────────────────────────────────────
# Old code saved to ml-model/src/juansign_model.pth but model.py and
# predict_sign.py both load from ml-model/juansignmodel/juansign_model.pth.

MODEL_SAVE_PATH = os.path.join(_ML_DIR, 'juansignmodel', 'juansign_model.pth')


def evaluate_model(model, loader, criterion, device):
    """
    Runs the model over a DataLoader in evaluation mode.

    IMPORTANT — this does NOT train the model:
      - model.eval() disables dropout and batchnorm running-stat updates.
      - torch.no_grad() prevents any gradient computation or graph building.
      - optimizer.step() is never called here.
    The validation/test set is purely READ to compute loss and accuracy.

    Returns:
        avg_loss (float): mean loss over all batches
        accuracy (float): percentage of correct predictions (0–100)
    """
    model.eval()
    total_loss = 0
    correct    = 0
    total      = 0

    with torch.no_grad():  # No gradient tracking — model weights are not changed
        for inputs, labels in loader:
            inputs, labels = inputs.to(device), labels.to(device)
            outputs = model(inputs)
            loss    = criterion(outputs, labels)

            total_loss += loss.item()
            _, predicted = outputs.max(1)
            total   += labels.size(0)
            correct += predicted.eq(labels).sum().item()

    return total_loss / len(loader), 100. * correct / total


# ── Training loop ──────────────────────────────────────────────────────────────

for epoch in range(epochs):

    # ── Priority 9: Unfreeze backbone after FREEZE_EPOCHS ✅ ──────────────────
    # Once the LSTM and classifier head have had FREEZE_EPOCHS epochs to warm up,
    # open the full ResNet18 for end-to-end gradient updates.
    if epoch == FREEZE_EPOCHS:
        for param in model.feature_extractor.parameters():
            param.requires_grad = True
        print(f"\nEpoch {epoch + 1}: ResNet18 backbone unfrozen — fine-tuning end-to-end.")

    model.train()
    running_loss = 0.0
    correct      = 0
    total        = 0

    for inputs, labels in train_loader:
        inputs, labels = inputs.to(device), labels.to(device)

        optimizer.zero_grad()            # Clear gradients from the previous step
        outputs = model(inputs)          # Forward pass → (B, 5) class logits
        loss    = criterion(outputs, labels)
        loss.backward()                  # Backprop: compute gradients w.r.t. weights
        optimizer.step()                 # Update weights — ONLY done on training batches

        running_loss += loss.item()
        _, predicted  = outputs.max(1)
        total        += labels.size(0)
        correct      += predicted.eq(labels).sum().item()

    train_loss = running_loss / len(train_loader)
    train_acc  = 100. * correct / total

    # evaluate_model reads validation data without updating any weights
    val_loss, val_acc = evaluate_model(model, validation_loader, criterion, device)

    history['train_loss'].append(train_loss)
    history['val_loss'].append(val_loss)
    history['train_acc'].append(train_acc)
    history['val_acc'].append(val_acc)

    # ── Priority 11: Log scalars to TensorBoard ✅ ────────────────────────────
    writer.add_scalar("Loss/train", train_loss, epoch)
    writer.add_scalar("Loss/val",   val_loss,   epoch)
    writer.add_scalar("Acc/train",  train_acc,  epoch)
    writer.add_scalar("Acc/val",    val_acc,    epoch)

    print(f"Epoch {epoch + 1}/{epochs}")
    print(f"  Train Loss: {train_loss:.4f}  |  Train Acc: {train_acc:.2f}%")
    print(f"  Val Loss:   {val_loss:.4f}  |  Val Acc:   {val_acc:.2f}%")
    print()

    # ── Priority 4: Save checkpoint only when val accuracy improves ✅ ─────────
    # Ensures the saved weights are from the best-generalising epoch,
    # not just whatever the model looks like at the final epoch.
    if val_acc > best_val_acc:
        best_val_acc = val_acc
        os.makedirs(os.path.join(_ML_DIR, 'juansignmodel'), exist_ok=True)
        torch.save(model.state_dict(), MODEL_SAVE_PATH)
        print(f"  ✅ Best model saved (val_acc={val_acc:.2f}%)")

    # ── Priority 8: Step the LR scheduler on validation loss ✅ ───────────────
    scheduler.step(val_loss)

    # ── Priority 10: Early stopping ✅ ────────────────────────────────────────
    # If validation loss has not improved for EARLY_STOP_PATIENCE consecutive
    # epochs the model has stopped learning — continuing only risks overfitting.
    if val_loss < best_val_loss:
        best_val_loss     = val_loss
        epochs_no_improve = 0
    else:
        epochs_no_improve += 1
        if epochs_no_improve >= EARLY_STOP_PATIENCE:
            print(f"Early stopping at epoch {epoch + 1} "
                  f"(no val loss improvement for {EARLY_STOP_PATIENCE} consecutive epochs).")
            break


# ── Priority 5: Final test set evaluation ✅ ──────────────────────────────────
# Load the BEST saved weights (not the last epoch's weights) before testing.
# The test set is evaluated exactly once — its score is the model's final,
# unbiased performance report. Never use this score to change anything.
model.load_state_dict(torch.load(MODEL_SAVE_PATH, map_location=device))
test_loss, test_acc = evaluate_model(model, testing_loader, criterion, device)

print(f"\n{'─' * 44}")
print(f"  Final Test Results  (best checkpoint)")
print(f"  Test Loss: {test_loss:.4f}  |  Test Acc: {test_acc:.2f}%")
print(f"{'─' * 44}")

writer.close()  # ✅ Flush and close TensorBoard writer
