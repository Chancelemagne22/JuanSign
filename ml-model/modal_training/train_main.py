# ml-model/src/train_main.py
# JuanSign V2.2 — ResNet50 + BiLSTM | Pure Local Logging (WandB Removed)

import os
import json
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from torch.utils.tensorboard import SummaryWriter
from torch.profiler import profile, record_function, ProfilerActivity
from collections import Counter

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from torchmetrics.classification import (
    MulticlassAccuracy,
    MulticlassF1Score,
    MulticlassPrecision,
    MulticlassRecall,
    MulticlassConfusionMatrix,
    MulticlassCalibrationError,
)
from sklearn.metrics import classification_report
from fvcore.nn import FlopCountAnalysis, parameter_count_table
from torchinfo import summary as torchinfo_summary

from fsl_datasets import FSLDataset, collate_fn
from resnet_lstm_architecture import ResNetLSTM

# ── CONFIG (HYBRID PATHING) ──────────────────────────────────────────────────
IS_MODAL = "MODAL_RUN" in os.environ

# Ensure these match your extraction folders exactly
CLASS_NAMES = ["what", "when", "where", "who", "why"]
NUM_CLASSES = len(CLASS_NAMES)

if IS_MODAL:
    FRAME_ROOT          = "/data/processed_output/frame_extracted"
    MODEL_SAVE_PATH     = "/data/models/juansign_v2_2.pth"
    LOG_DIR             = "/data/runs/v2_2_pilot"
    RESULTS_DIR         = "/data/results"
    BATCH_SIZE          = 16   
    BATCH_SIZE_UNFREEZE = 6    
else:
    FRAME_ROOT          = "./processed_output/frame_extracted"
    MODEL_SAVE_PATH     = "./juansignmodel/juansign_model_v2_2.pth"
    LOG_DIR             = "./runs/v2_2_pilot"
    RESULTS_DIR         = "./results"
    BATCH_SIZE          = 4
    BATCH_SIZE_UNFREEZE = 2

EPOCHS              = 50
LEARNING_RATE       = 1e-4
FREEZE_EPOCHS       = 5
EARLY_STOP_PATIENCE = 15
SEED                = 42

# ══════════════════════════════════════════════════════════════════════════════
# MODEL ANALYSIS
# ══════════════════════════════════════════════════════════════════════════════

def log_model_analysis(model, device):
    print("\n" + "═"*55)
    print("  MODEL ANALYSIS")
    print("═"*55)
    dummy_frames = torch.randn(1, 32, 5, 224, 224).to(device)
    dummy_lms    = torch.randn(1, 32, 126).to(device)

    model_summary = torchinfo_summary(
        model,
        input_data=[dummy_frames, dummy_lms],
        col_names=["input_size", "output_size", "num_params", "trainable"],
        depth=4,
        verbose=0,
    )
    summary_str = str(model_summary)
    print(summary_str)

    os.makedirs(RESULTS_DIR, exist_ok=True)
    summary_path = os.path.join(RESULTS_DIR, "model_summary.txt")
    with open(summary_path, "w") as f:
        f.write(summary_str)
    
    model.eval()
    with torch.no_grad():
        flops = FlopCountAnalysis(model, (dummy_frames, dummy_lms))
    print(f"\n  GFLOPs (per inference) : {flops.total() / 1e9:.2f}")
    print(parameter_count_table(model))
    print("═"*55 + "\n")

# ══════════════════════════════════════════════════════════════════════════════
# MONITORING HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def check_gradient_flow(model, epoch):
    for name, param in model.named_parameters():
        if param.grad is not None:
            grad_mean = param.grad.abs().mean().item()
            if grad_mean < 1e-7:
                print(f"  ⚠️ Vanishing gradient: {name}")
            elif grad_mean > 100:
                print(f"  ⚠️ Exploding gradient: {name}")

def check_lstm_gates(model, sample_frames, sample_landmarks, epoch):
    model.eval()
    hooks = []
    def make_hook(name):
        def fn(module, input, output):
            h = output[0].detach()
            dead = (h.abs() < 0.01).float().mean().item() * 100
            if dead > 50: print(f"  ⚠️ LSTM {name} has {dead:.1f}% dead neurons")
        return fn

    for name, module in model.named_modules():
        if isinstance(module, nn.LSTM):
            hooks.append(module.register_forward_hook(make_hook(name)))
    with torch.no_grad():
        model(sample_frames, sample_landmarks)
    for h in hooks: h.remove()

def log_vram():
    allocated = torch.cuda.memory_allocated() / 1e9
    print(f"  VRAM: {allocated:.2f} GB allocated")
# ══════════════════════════════════════════════════════════════════════════════
# LOSS FUNCTION (AUTOMATED WEIGHTING)
# ══════════════════════════════════════════════════════════════════════════════

def get_criterion(train_dataset, device):
    """Calculates inverse frequency weights to handle class imbalance."""
    labels = [s[1] for s in train_dataset.samples]
    label_counts = Counter(labels)
    total = len(labels)
    
    # Formula: total_samples / (num_classes * class_samples)
    weights = [total / (len(train_dataset.classes) * label_counts.get(i, 1))
               for i in range(len(train_dataset.classes))]
    
    weights_tensor = torch.FloatTensor(weights).to(device)
    print(f"  [Loss] Automated Weights: {np.round(weights, 2).tolist()}")
    
    return nn.CrossEntropyLoss(
        weight=weights_tensor,
        label_smoothing=0.1
    )
# ══════════════════════════════════════════════════════════════════════════════
# TRAINING & EVALUATION
# ══════════════════════════════════════════════════════════════════════════════

def train_one_epoch(model, loader, criterion, optimizer, scaler, device, epoch, acc_metric, f1_metric, run_profiler=False):
    model.train()
    acc_metric.reset(); f1_metric.reset()
    total_loss, total_samples = 0.0, 0
    
    def _run_batch(frames, landmarks, labels):
        nonlocal total_loss, total_samples
        frames, landmarks, labels = frames.to(device), landmarks.to(device), labels.to(device)
        optimizer.zero_grad()
        with torch.cuda.amp.autocast():
            logits = model(frames, landmarks)
            loss   = criterion(logits, labels)
        scaler.scale(loss).backward()
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
        scaler.step(optimizer)
        scaler.update()
        acc_metric.update(logits.argmax(dim=1), labels)
        f1_metric.update(logits.argmax(dim=1), labels)
        total_loss += loss.item() * frames.size(0)
        total_samples += frames.size(0)
        return frames[:1].detach(), landmarks[:1].detach()

    if run_profiler:
        with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
            for f, l, lbl in loader: _run_batch(f, l, lbl)
        with open(os.path.join(RESULTS_DIR, "profiler_report.txt"), "w") as pf:
            pf.write(prof.key_averages().table(sort_by="cuda_time_total", row_limit=10))
    else:
        for f, l, lbl in loader: last_f, last_l = _run_batch(f, l, lbl)

    check_gradient_flow(model, epoch)
    return total_loss / total_samples, acc_metric.compute().item() * 100, f1_metric.compute().item(), last_f, last_l

def evaluate(model, loader, criterion, device, acc_m, f1_m, prec_m, rec_m, cal_m):
    model.eval()
    acc_m.reset(); f1_m.reset(); prec_m.reset(); rec_m.reset(); cal_m.reset()
    total_loss, total_samples = 0.0, 0
    with torch.no_grad():
        for f, l, lbl in loader:
            f, l, lbl = f.to(device), l.to(device), lbl.to(device)
            with torch.cuda.amp.autocast():
                logits = model(f, l)
                loss   = criterion(logits, lbl)
            probs = torch.softmax(logits, dim=1)
            preds = probs.argmax(dim=1)
            acc_m.update(preds, lbl); f1_m.update(preds, lbl)
            prec_m.update(preds, lbl); rec_m.update(preds, lbl)
            cal_m.update(probs, lbl)
            total_loss += loss.item() * f.size(0)
            total_samples += f.size(0)
    return total_loss/total_samples, acc_m.compute().item()*100, f1_m.compute().item(), prec_m.compute().item(), rec_m.compute().item(), cal_m.compute().item()

# ══════════════════════════════════════════════════════════════════════════════
# AUTOMATED TEST EVALUATION (FIXED PATHS)
# ══════════════════════════════════════════════════════════════════════════════

def run_test_evaluation(model, criterion, device, class_names):
    print("\n" + "═"*55 + "\n  TEST EVALUATION\n" + "═"*55)
    test_path = os.path.join(FRAME_ROOT, "testing") # Corrected path
    if not os.path.exists(test_path):
        print(f"  ⚠️ Error: {test_path} not found. Skipping test.")
        return

    test_ds = FSLDataset(test_path, augment=False)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)
    
    model.eval()
    all_preds, all_labels, all_probs = [], [], []
    total_loss, total_samples = 0.0, 0

    with torch.no_grad():
        for f, l, lbl in test_loader:
            f, l, lbl = f.to(device), l.to(device), lbl.to(device)
            logits = model(f, l)
            probs  = torch.softmax(logits, dim=1)
            all_preds.extend(probs.argmax(dim=1).cpu().numpy())
            all_labels.extend(lbl.cpu().numpy())
            all_probs.extend(probs.cpu().numpy())
            total_loss += criterion(logits, lbl).item() * f.size(0)
            total_samples += f.size(0)

    # Classification Report
    report = classification_report(all_labels, all_preds, target_names=class_names, output_dict=True)
    print(classification_report(all_labels, all_preds, target_names=class_names))

    # Confusion Matrix
    cm_metric = MulticlassConfusionMatrix(num_classes=NUM_CLASSES).to(device)
    cm = cm_metric(torch.tensor(all_preds).to(device), torch.tensor(all_labels).to(device)).cpu().numpy()
    plt.figure(figsize=(8,6))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Greens", xticklabels=class_names, yticklabels=class_names)
    plt.title("Confusion Matrix")
    plt.savefig(os.path.join(RESULTS_DIR, "confusion_matrix.png"))
    plt.close()

    # Calibration Plot
    max_probs = np.array(all_probs).max(axis=1)
    correct   = (np.array(all_preds) == np.array(all_labels)).astype(float)
    plt.figure(figsize=(6,5))
    bins = np.linspace(0, 1, 11)
    bin_ids = np.digitize(max_probs, bins) - 1
    bin_acc = [correct[bin_ids == i].mean() if (bin_ids == i).sum() > 0 else 0 for i in range(10)]
    plt.bar(np.linspace(0.05, 0.95, 10), bin_acc, width=0.08, color='green', alpha=0.6)
    plt.plot([0, 1], [0, 1], "k--")
    plt.title("Confidence Calibration")
    plt.savefig(os.path.join(RESULTS_DIR, "calibration_plot.png"))
    plt.close()

    # JSON Summary
    summary = {"test_acc": np.mean(correct), "per_class": report}
    with open(os.path.join(RESULTS_DIR, "test_results.json"), "w") as f:
        json.dump(summary, f, indent=2)

# ══════════════════════════════════════════════════════════════════════════════
# MAIN RUNNER
# ══════════════════════════════════════════════════════════════════════════════

def save_training_curves(history):
    epochs = range(1, len(history["train_acc"]) + 1)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 5))
    ax1.plot(epochs, history["train_loss"], 'b', label='Train Loss')
    ax1.plot(epochs, history["val_loss"], 'r', label='Val Loss')
    ax1.set_title('Loss Curve'); ax1.legend()
    ax2.plot(epochs, history["train_acc"], 'b', label='Train Acc')
    ax2.plot(epochs, history["val_acc"], 'r', label='Val Acc')
    ax2.set_title('Accuracy Curve'); ax2.legend()
    plt.savefig(os.path.join(RESULTS_DIR, "training_curves.png"))
    plt.close()

def train():
    torch.manual_seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    os.makedirs(RESULTS_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)

    print(f"--- Training JuanSign V2.2 (Local Logging Mode) ---")

    # Data (Using corrected _data suffixes)
    train_ds = FSLDataset(os.path.join(FRAME_ROOT, "training"),   augment=True)
    val_ds   = FSLDataset(os.path.join(FRAME_ROOT, "validation"), augment=False)
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, collate_fn=collate_fn, pin_memory=True)
    val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)

    model = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    log_model_analysis(model, device)
    
    scaler = torch.cuda.amp.GradScaler()
    model.freeze_backbone()

    # Metrics
    def m(): return MulticlassAccuracy(NUM_CLASSES).to(device), MulticlassF1Score(NUM_CLASSES).to(device), MulticlassPrecision(NUM_CLASSES).to(device), MulticlassRecall(NUM_CLASSES).to(device), MulticlassCalibrationError(NUM_CLASSES).to(device)
    t_acc, t_f1, _, _, _ = m()
    v_acc, v_f1, v_prec, v_rec, v_cal = m()

    criterion = get_criterion(train_ds, device)
    optimizer = optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=LEARNING_RATE)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
    writer    = SummaryWriter(log_dir=LOG_DIR)

    best_val_acc = 0.0
    history = {"train_loss":[], "val_loss":[], "train_acc":[], "val_acc":[]}
    
    for epoch in range(1, EPOCHS + 1):
        if epoch == FREEZE_EPOCHS + 1:
            model.unfreeze_backbone()
            optimizer = optim.Adam([{'params': model.visual_encoder.parameters(), 'lr': 1e-6}, {'params': model.landmark_encoder.parameters(), 'lr': 1e-4}, {'params': model.bilstm.parameters(), 'lr': 1e-4}, {'params': model.fc.parameters(), 'lr': 1e-4}])
            train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE_UNFREEZE, shuffle=True, collate_fn=collate_fn)
            print("--- Backbone Unfrozen ---")

        loss, acc, f1, last_f, last_l = train_one_epoch(model, train_loader, criterion, optimizer, scaler, device, epoch, t_acc, t_f1, run_profiler=False)
        v_loss, v_acc_val, v_f1_val, v_p, v_r, v_c = evaluate(model, val_loader, criterion, device, v_acc, v_f1, v_prec, v_rec, v_cal)

        history["train_loss"].append(loss); history["val_loss"].append(v_loss)
        history["train_acc"].append(acc); history["val_acc"].append(v_acc_val)
        
        # Save curves and history EVERY epoch so we don't lose them on crash
        save_training_curves(history)
        with open(os.path.join(RESULTS_DIR, "training_history.json"), "w") as f: json.dump(history, f)

        print(f"Epoch {epoch:02d} | Train Acc: {acc:.1f}% | Val Acc: {v_acc_val:.1f}%")
        if v_acc_val > best_val_acc:
            best_val_acc = v_acc_val
            torch.save({"model_state": model.state_dict(), "class_names": CLASS_NAMES, "num_classes": NUM_CLASSES}, MODEL_SAVE_PATH)
        
        scheduler.step(v_loss)
        torch.cuda.empty_cache()

    # Final Automated Test
    run_test_evaluation(model, criterion, device, CLASS_NAMES)
    writer.close()

if __name__ == "__main__":
    train()