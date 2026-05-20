# ml-model/src/train_main.py
# JuanSign V2.2 — ResNet50 + BiLSTM | Full Automated Testing Suite

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

# ── CONFIG ───────────────────────────────────────────────────────────────────
IS_MODAL = "MODAL_RUN" in os.environ

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
    print(f"  Layer table saved → {summary_path}")

    model.eval()
    with torch.no_grad():
        flops = FlopCountAnalysis(model, (dummy_frames, dummy_lms))
    print(f"\n  GFLOPs (per inference) : {flops.total() / 1e9:.2f}")
    print(parameter_count_table(model))
    print("═"*55 + "\n")

# ══════════════════════════════════════════════════════════════════════════════
# GRADIENT FLOW CHECKER
# ══════════════════════════════════════════════════════════════════════════════

def check_gradient_flow(model, epoch):
    issues = []
    for name, param in model.named_parameters():
        if param.grad is not None:
            grad_mean = param.grad.abs().mean().item()
            if grad_mean < 1e-7:
                issues.append(f"vanishing:{name}")
            elif grad_mean > 100:
                issues.append(f"exploding:{name}")
    if issues:
        print(f"  ⚠️  Epoch {epoch} gradient issues:")
        for i in issues: print(f"     {i}")

    grad_norms = {}
    for name, param in model.named_parameters():
        if param.grad is not None:
            group = name.split(".")[0]
            grad_norms.setdefault(group, []).append(param.grad.norm().item())

# ══════════════════════════════════════════════════════════════════════════════
# LSTM GATE ACTIVATION TEST
# ══════════════════════════════════════════════════════════════════════════════

def check_lstm_gates(model, sample_frames, sample_landmarks, epoch):
    model.eval()
    gate_stats, hooks = {}, []

    def make_hook(name):
        def fn(module, input, output):
            h = output[0].detach()
            gate_stats[name] = {
                "mean":  round(h.mean().item(), 4),
                "std":   round(h.std().item(), 4),
                "dead%": round((h.abs() < 0.01).float().mean().item() * 100, 2),
            }
        return fn

    for name, module in model.named_modules():
        if isinstance(module, nn.LSTM):
            hooks.append(module.register_forward_hook(make_hook(name)))
    with torch.no_grad():
        model(sample_frames, sample_landmarks)
    for h in hooks: h.remove()

    print(f"  LSTM Gate Stats (Epoch {epoch}):")
    for name, stats in gate_stats.items():
        print(f"    {name}: mean={stats['mean']:.4f} | std={stats['std']:.4f} | dead={stats['dead%']:.1f}%")
        if stats["dead%"] > 50:
            print(f"    ⚠️  {name} has >50% dead neurons!")

# ══════════════════════════════════════════════════════════════════════════════
# VRAM MONITOR
# ══════════════════════════════════════════════════════════════════════════════

def log_vram(epoch):
    allocated = torch.cuda.memory_allocated() / 1e9
    reserved  = torch.cuda.memory_reserved() / 1e9
    print(f"  VRAM: {allocated:.2f} GB allocated / {reserved:.2f} GB reserved")

# ══════════════════════════════════════════════════════════════════════════════
# CRITERION
# ══════════════════════════════════════════════════════════════════════════════

def get_criterion(train_dataset, device):
    labels       = [s[1] for s in train_dataset.samples]
    label_counts = Counter(labels)
    total        = len(labels)
    weights      = [total / (len(train_dataset.classes) * label_counts.get(i, 1))
                    for i in range(len(train_dataset.classes))]
    return nn.CrossEntropyLoss(
        weight=torch.FloatTensor(weights).to(device), label_smoothing=0.1)

# ══════════════════════════════════════════════════════════════════════════════
# TRAINING STEP
# ══════════════════════════════════════════════════════════════════════════════

def train_one_epoch(model, loader, criterion, optimizer, scaler, device, epoch,
                    acc_metric, f1_metric, run_profiler=False):
    model.train()
    acc_metric.reset()
    f1_metric.reset()
    total_loss, total_samples = 0.0, 0
    last_batch_frames = last_batch_lms = None

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
        preds = logits.argmax(dim=1)
        acc_metric.update(preds, labels)
        f1_metric.update(preds, labels)
        total_loss    += loss.item() * frames.size(0)
        total_samples += frames.size(0)
        return frames[:1].detach(), landmarks[:1].detach()

    if run_profiler:
        print("  🔍 Running torch.profiler on this epoch...")
        with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
                     record_shapes=True, with_flops=True) as prof:
            for frames, landmarks, labels in loader:
                with record_function("forward_backward"):
                    last_batch_frames, last_batch_lms = _run_batch(frames, landmarks, labels)
        profile_path = os.path.join(RESULTS_DIR, "profiler_report.txt")
        with open(profile_path, "w") as pf:
            pf.write(prof.key_averages().table(sort_by="cuda_time_total", row_limit=20))
        print(f"  Profiler report saved → {profile_path}")
    else:
        for frames, landmarks, labels in loader:
            last_batch_frames, last_batch_lms = _run_batch(frames, landmarks, labels)

    check_gradient_flow(model, epoch)
    return (total_loss / total_samples,
            acc_metric.compute().item() * 100,
            f1_metric.compute().item(),
            last_batch_frames, last_batch_lms)

# ══════════════════════════════════════════════════════════════════════════════
# EVALUATION STEP
# ══════════════════════════════════════════════════════════════════════════════

def evaluate(model, loader, criterion, device,
             acc_metric, f1_metric, precision_metric, recall_metric, calib_metric):
    model.eval()
    for m in [acc_metric, f1_metric, precision_metric, recall_metric, calib_metric]:
        m.reset()
    total_loss, total_samples = 0.0, 0
    with torch.no_grad():
        for frames, landmarks, labels in loader:
            frames, landmarks, labels = frames.to(device), landmarks.to(device), labels.to(device)
            with torch.cuda.amp.autocast():
                logits = model(frames, landmarks)
                loss   = criterion(logits, labels)
            probs = torch.softmax(logits, dim=1)
            preds = probs.argmax(dim=1)
            acc_metric.update(preds, labels)
            f1_metric.update(preds, labels)
            precision_metric.update(preds, labels)
            recall_metric.update(preds, labels)
            calib_metric.update(probs, labels)
            total_loss    += loss.item() * frames.size(0)
            total_samples += frames.size(0)
    return (total_loss / total_samples,
            acc_metric.compute().item() * 100,
            f1_metric.compute().item(),
            precision_metric.compute().item(),
            recall_metric.compute().item(),
            calib_metric.compute().item())

# ══════════════════════════════════════════════════════════════════════════════
# AUTOMATED TEST EVALUATION
# ══════════════════════════════════════════════════════════════════════════════

def run_test_evaluation(model, criterion, device, class_names):
    print("\n" + "═"*55)
    print("  AUTOMATED TEST EVALUATION")
    print("═"*55)

    test_path = os.path.join(FRAME_ROOT, "testing")
    if not os.path.exists(test_path):
        print(f"  ⚠️ {test_path} not found. Skipping test evaluation.")
        return

    test_ds     = FSLDataset(test_path, augment=False)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False, collate_fn=collate_fn)

    model.eval()
    all_preds, all_labels, all_probs = [], [], []
    total_loss, total_samples = 0.0, 0

    with torch.no_grad():
        for frames, landmarks, labels in test_loader:
            frames, landmarks, labels = frames.to(device), landmarks.to(device), labels.to(device)
            with torch.cuda.amp.autocast():
                logits = model(frames, landmarks)
                loss   = criterion(logits, labels)
            probs = torch.softmax(logits, dim=1)
            preds = probs.argmax(dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())
            all_probs.extend(probs.cpu().numpy())
            total_loss    += loss.item() * frames.size(0)
            total_samples += frames.size(0)

    test_loss = total_loss / total_samples
    test_acc  = np.mean(np.array(all_preds) == np.array(all_labels)) * 100

    report = classification_report(all_labels, all_preds, target_names=class_names, output_dict=True)
    print(f"\n  Test Loss     : {test_loss:.4f}")
    print(f"  Test Accuracy : {test_acc:.2f}%\n")
    print(classification_report(all_labels, all_preds, target_names=class_names))

    # ── Confusion Matrix ──────────────────────────────────────────────────────
    cm_metric = MulticlassConfusionMatrix(num_classes=NUM_CLASSES).to(device)
    cm_metric.update(torch.tensor(all_preds).to(device), torch.tensor(all_labels).to(device))
    cm = cm_metric.compute().cpu().numpy()
    fig, ax = plt.subplots(figsize=(max(6, len(class_names)), max(5, len(class_names) - 1)))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=class_names, yticklabels=class_names, ax=ax)
    ax.set_title("JuanSign V2.2 — Confusion Matrix (Test Set)")
    ax.set_ylabel("True Label")
    ax.set_xlabel("Predicted Label")
    plt.tight_layout()
    cm_path = os.path.join(RESULTS_DIR, "confusion_matrix.png")
    plt.savefig(cm_path, dpi=150)
    plt.close()
    print(f"  Confusion matrix → {cm_path}")

    # ── Calibration Plot ──────────────────────────────────────────────────────
    all_probs_np  = np.array(all_probs)
    all_labels_np = np.array(all_labels)
    max_probs     = all_probs_np.max(axis=1)
    correct       = (np.array(all_preds) == all_labels_np).astype(float)
    fig, ax = plt.subplots(figsize=(6, 5))
    bins    = np.linspace(0, 1, 11)
    bin_ids = np.digitize(max_probs, bins) - 1
    bin_acc  = [correct[bin_ids == i].mean() if (bin_ids == i).sum() > 0 else 0 for i in range(10)]
    bin_conf = [(bins[i] + bins[i+1]) / 2 for i in range(10)]
    ax.bar(bin_conf, bin_acc, width=0.09, alpha=0.7, label="Model")
    ax.plot([0, 1], [0, 1], "k--", label="Perfect calibration")
    ax.set_title("Confidence Calibration (Test Set)")
    ax.set_xlabel("Confidence")
    ax.set_ylabel("Accuracy")
    ax.legend()
    plt.tight_layout()
    calib_path = os.path.join(RESULTS_DIR, "calibration_plot.png")
    plt.savefig(calib_path, dpi=150)
    plt.close()
    print(f"  Calibration plot → {calib_path}")

    # ── JSON Summary ──────────────────────────────────────────────────────────
    summary = {
        "test_accuracy": round(test_acc, 4),
        "test_loss":     round(test_loss, 6),
        "per_class": {
            cls: {
                "precision": round(report[cls]["precision"], 4),
                "recall":    round(report[cls]["recall"], 4),
                "f1_score":  round(report[cls]["f1-score"], 4),
                "support":   report[cls]["support"],
            } for cls in class_names
        }
    }
    results_path = os.path.join(RESULTS_DIR, "test_results.json")
    with open(results_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  Results JSON → {results_path}")

    print("═"*55 + "\n")
    return test_acc

# ══════════════════════════════════════════════════════════════════════════════
# TRAINING CURVES
# ══════════════════════════════════════════════════════════════════════════════

def save_training_curves(history):
    epochs = range(1, len(history["train_acc"]) + 1)
    keys   = list(history.keys())

    # Always plot at minimum: acc + loss
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    axes[0].plot(epochs, history["train_acc"],  label="Train Acc",  marker="o", markersize=3)
    axes[0].plot(epochs, history["val_acc"],    label="Val Acc",    marker="o", markersize=3)
    axes[0].set_title("Accuracy"); axes[0].set_xlabel("Epoch")
    axes[0].set_ylabel("Accuracy (%)"); axes[0].legend(); axes[0].grid(True, alpha=0.3)

    axes[1].plot(epochs, history["train_loss"], label="Train Loss", marker="o", markersize=3)
    axes[1].plot(epochs, history["val_loss"],   label="Val Loss",   marker="o", markersize=3)
    axes[1].set_title("Loss"); axes[1].set_xlabel("Epoch")
    axes[1].set_ylabel("Loss"); axes[1].legend(); axes[1].grid(True, alpha=0.3)

    fig.suptitle("JuanSign V2.2 — Training Curves", fontsize=14)
    plt.tight_layout()
    path = os.path.join(RESULTS_DIR, "training_curves.png")
    plt.savefig(path, dpi=150)
    plt.close()

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

    # ── Data ──────────────────────────────────────────────────────────────────
    train_ds = FSLDataset(os.path.join(FRAME_ROOT, "training"),   augment=True)
    val_ds   = FSLDataset(os.path.join(FRAME_ROOT, "validation"), augment=False)

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,
                              collate_fn=collate_fn, pin_memory=True)
    val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False,
                              collate_fn=collate_fn)

    # ── Model ─────────────────────────────────────────────────────────────────
    model  = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    scaler = torch.cuda.amp.GradScaler()
    model.freeze_backbone()
    log_model_analysis(model, device)

    # ── Metrics ───────────────────────────────────────────────────────────────
    def make_metrics():
        return (
            MulticlassAccuracy(num_classes=NUM_CLASSES, average="macro").to(device),
            MulticlassF1Score(num_classes=NUM_CLASSES, average="macro").to(device),
            MulticlassPrecision(num_classes=NUM_CLASSES, average="macro").to(device),
            MulticlassRecall(num_classes=NUM_CLASSES, average="macro").to(device),
            MulticlassCalibrationError(num_classes=NUM_CLASSES).to(device),
        )

    t_acc, t_f1, _, _, _              = make_metrics()
    v_acc, v_f1, v_prec, v_rec, v_cal = make_metrics()

    # ── Loss, Optimizer, Scheduler ────────────────────────────────────────────
    criterion = get_criterion(train_ds, device)
    optimizer = optim.Adam(filter(lambda p: p.requires_grad, model.parameters()), lr=LEARNING_RATE)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
    writer    = SummaryWriter(log_dir=LOG_DIR)

    best_val_acc      = 0.0
    epochs_no_improve = 0
    sample_frames = sample_lms = None
    history = {
        "train_loss": [], "val_loss": [],
        "train_acc":  [], "val_acc":  [],
        "train_f1":   [], "val_f1":   [],
        "val_precision": [], "val_recall": [], "val_calibration": [],
    }

    for epoch in range(1, EPOCHS + 1):

        # ── Unfreeze ──────────────────────────────────────────────────────────
        if epoch == FREEZE_EPOCHS + 1:
            model.unfreeze_backbone()
            optimizer = optim.Adam([
                {"params": model.visual_encoder.parameters(),   "lr": 1e-6},
                {"params": model.landmark_encoder.parameters(), "lr": 1e-4},
                {"params": model.bilstm.parameters(),           "lr": 1e-4},
                {"params": model.fc.parameters(),               "lr": 1e-4},
            ])
            scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
            train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE_UNFREEZE, shuffle=True,
                                      collate_fn=collate_fn, pin_memory=True)
            val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE_UNFREEZE, shuffle=False,
                                      collate_fn=collate_fn)
            print(f"\n--- ResNet50 Unfrozen | Batch size → {BATCH_SIZE_UNFREEZE} ---")

        # ── Train ─────────────────────────────────────────────────────────────
        run_profiler = (epoch == 1)
        train_loss, train_acc, train_f1, last_frames, last_lms = train_one_epoch(
            model, train_loader, criterion, optimizer, scaler, device,
            epoch, t_acc, t_f1, run_profiler=run_profiler
        )
        if sample_frames is None:
            sample_frames, sample_lms = last_frames, last_lms

        # ── Validate ──────────────────────────────────────────────────────────
        val_loss, val_acc, val_f1, val_prec, val_rec, val_cal = evaluate(
            model, val_loader, criterion, device,
            v_acc, v_f1, v_prec, v_rec, v_cal
        )

        # ── LSTM Gate Check (every 5 epochs) ──────────────────────────────────
        if epoch % 5 == 0 and sample_frames is not None:
            check_lstm_gates(model, sample_frames, sample_lms, epoch)

        # ── VRAM Monitor ──────────────────────────────────────────────────────
        log_vram(epoch)

        scheduler.step(val_loss)

        # ── TensorBoard ───────────────────────────────────────────────────────
        writer.add_scalars("Accuracy", {"train": train_acc,  "val": val_acc},  epoch)
        writer.add_scalars("Loss",     {"train": train_loss, "val": val_loss}, epoch)
        writer.add_scalars("F1",       {"train": train_f1,   "val": val_f1},   epoch)

        # ── History ───────────────────────────────────────────────────────────
        history["train_loss"].append(round(train_loss, 6))
        history["val_loss"].append(round(val_loss, 6))
        history["train_acc"].append(round(train_acc, 4))
        history["val_acc"].append(round(val_acc, 4))
        history["train_f1"].append(round(train_f1, 4))
        history["val_f1"].append(round(val_f1, 4))
        history["val_precision"].append(round(val_prec, 4))
        history["val_recall"].append(round(val_rec, 4))
        history["val_calibration"].append(round(val_cal, 4))

        print(f"Epoch {epoch:02d} | "
              f"Train Loss: {train_loss:.4f} Acc: {train_acc:.1f}% F1: {train_f1:.3f} | "
              f"Val Loss: {val_loss:.4f} Acc: {val_acc:.1f}% F1: {val_f1:.3f} | "
              f"Prec: {val_prec:.3f} Rec: {val_rec:.3f} | Cal: {val_cal:.4f}")

        # ── Save training curves + history every epoch ─────────────────────────
        # This guarantees they exist even if training is interrupted
        save_training_curves(history)
        with open(os.path.join(RESULTS_DIR, "training_history.json"), "w") as hf:
            json.dump(history, hf, indent=2)

        # ── Save Best Model + run test evaluation immediately ──────────────────
        if val_acc > best_val_acc:
            best_val_acc      = val_acc
            epochs_no_improve = 0
            torch.save({
                "model_state": model.state_dict(),
                "class_names": CLASS_NAMES,
                "num_classes": NUM_CLASSES,
            }, MODEL_SAVE_PATH)
            print(f"  ✓ Best model saved → {MODEL_SAVE_PATH} (Val Acc: {best_val_acc:.2f}%)")

            # ── Run test evaluation every time a better model is found ─────────
            # This ensures test results are always from the best checkpoint
            print(f"  🧪 Running test evaluation on new best model...")
            run_test_evaluation(model, criterion, device, CLASS_NAMES)

        else:
            epochs_no_improve += 1
            print(f"  No improvement ({epochs_no_improve}/{EARLY_STOP_PATIENCE})")
            if epochs_no_improve >= EARLY_STOP_PATIENCE:
                print("Early stopping triggered.")
                break

        torch.cuda.empty_cache()

    writer.close()
    print(f"\nDone! Best Val Acc: {best_val_acc:.2f}%")


if __name__ == "__main__":
    train()