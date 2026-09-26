# ml-model/src/train_main.py
# JuanSign V2.2 — ResNet50 + LSTM | Full Automated Testing Suite

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

from fsl_datasets import FSLDataset, load_dataset, collate_fn

from resnet_lstm_architecture import ResNetLSTM

from contextlib import nullcontext


def _make_grad_scaler(device):
    """Version-compatible GradScaler (torch<=2.2 vs torch>=2.3)."""
    if device.type != "cuda":
        return None
    try:
        # torch >= 2.3: torch.amp.GradScaler("cuda")
        return torch.amp.GradScaler("cuda")
    except (AttributeError, TypeError):
        # torch <= 2.2: torch.cuda.amp.GradScaler()
        return torch.cuda.amp.GradScaler()


def _autocast_ctx(device, enabled=True):
    """Version-compatible autocast context (torch<=2.2 vs torch>=2.3)."""
    if device.type != "cuda" or not enabled:
        return nullcontext()
    try:
        return torch.amp.autocast("cuda", enabled=True)
    except Exception:
        return torch.cuda.amp.autocast(enabled=True)

# ── CONFIG ───────────────────────────────────────────────────────────────────
IS_MODAL = "MODAL_RUN" in os.environ

CLASS_NAMES = ["good_afternoon","good_evening","good_midday","good_morning","good_night"]
NUM_CLASSES = len(CLASS_NAMES)

def _num_workers_default():
    # Modal CPU jobs have 4 vCPU — 4 workers + prefetch saturates the A10G
    # without thrashing. Local/Windows defaults to 0 (multiprocessing guard).
    if not IS_MODAL:
        return 0
    try:
        import multiprocessing
        return min(4, max(2, (multiprocessing.cpu_count() or 4) - 1))
    except Exception:
        return 4


if IS_MODAL:
    FRAME_ROOT          = "/data/processed_output/frame_extracted"
    MODEL_SAVE_PATH     = "/data/models/juansign_v2_2.pth"
    LAST_CKPT_PATH      = "/data/models/last.ckpt"
    LOG_DIR             = "/data/runs/v2_2_pilot"
    RESULTS_DIR         = "/data/results"
    BATCH_SIZE_FROZEN   = 24  # backbone frozen: no backbone grads, higher occupancy
    BATCH_SIZE          = 16  # kept for compat (unused while frozen)
    BATCH_SIZE_UNFREEZE = 6
else:
    FRAME_ROOT          = "./processed_output/frame_extracted"
    MODEL_SAVE_PATH     = "./juansignmodel/juansign_model_v2_2.pth"
    LAST_CKPT_PATH      = "./juansignmodel/last.ckpt"
    LOG_DIR             = "./runs/v2_2_pilot"
    RESULTS_DIR         = "./results"
    BATCH_SIZE_FROZEN   = 4
    BATCH_SIZE          = 4
    BATCH_SIZE_UNFREEZE = 2

NUM_WORKERS = _num_workers_default()
PREFETCH_FACTOR = 4 if IS_MODAL else 2
USE_TORCH_COMPILE = os.environ.get("JUANSIGN_COMPILE", "0") == "1"

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
    if not torch.cuda.is_available():
        return
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

    use_amp = scaler is not None
    non_block = device.type == "cuda"

    def _run_batch(frames, landmarks, labels):
        nonlocal total_loss, total_samples
        frames = frames.to(device, non_blocking=non_block)
        landmarks = landmarks.to(device, non_blocking=non_block)
        labels = labels.to(device, non_blocking=non_block)
        optimizer.zero_grad(set_to_none=True)
        with _autocast_ctx(device, enabled=use_amp):
            logits = model(frames, landmarks)
            loss   = criterion(logits, labels)
        if use_amp:
            scaler.scale(loss).backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            scaler.step(optimizer)
            scaler.update()
        else:
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            optimizer.step()
        preds = logits.argmax(dim=1)
        acc_metric.update(preds, labels)
        f1_metric.update(preds, labels)
        total_loss    += loss.item() * frames.size(0)
        total_samples += frames.size(0)
        return frames[:1].detach(), landmarks[:1].detach()

    if run_profiler and not IS_MODAL:
        # Profiler only runs locally — CUPTI unavailable on Modal causes OOM
        print("  🔍 Running torch.profiler (local only)...")
        with profile(activities=[ProfilerActivity.CPU],
                     record_shapes=False, with_flops=False) as prof:
            for frames, landmarks, labels in loader:
                with record_function("forward_backward"):
                    last_batch_frames, last_batch_lms = _run_batch(frames, landmarks, labels)
        profile_path = os.path.join(RESULTS_DIR, "profiler_report.txt")
        with open(profile_path, "w") as pf:
            pf.write(prof.key_averages().table(sort_by="cpu_time_total", row_limit=20))
        print(f"  Profiler report saved -> {profile_path}")
    else:
        if run_profiler and IS_MODAL:
            print("  Profiler skipped on Modal (CUPTI unavailable - would cause OOM).")
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
            frames = frames.to(device, non_blocking=(device.type == "cuda"))
            landmarks = landmarks.to(device, non_blocking=(device.type == "cuda"))
            labels = labels.to(device, non_blocking=(device.type == "cuda"))
            with _autocast_ctx(device, enabled=(device.type == "cuda")):
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

    test_ds     = load_dataset(FRAME_ROOT, "testing", augment=False)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE_UNFREEZE, shuffle=False,
                             collate_fn=collate_fn, num_workers=NUM_WORKERS,
                             persistent_workers=(NUM_WORKERS > 0),
                             pin_memory=(torch.cuda.is_available()))

    model.eval()
    all_preds, all_labels, all_probs = [], [], []
    total_loss, total_samples = 0.0, 0

    with torch.no_grad():
        for frames, landmarks, labels in test_loader:
            frames = frames.to(device, non_blocking=(device.type == "cuda"))
            landmarks = landmarks.to(device, non_blocking=(device.type == "cuda"))
            labels = labels.to(device, non_blocking=(device.type == "cuda"))
            with _autocast_ctx(device, enabled=(device.type == "cuda")):
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

def _make_loader(ds, batch_size, shuffle):
    return DataLoader(ds, batch_size=batch_size, shuffle=shuffle,
                      collate_fn=collate_fn,
                      pin_memory=torch.cuda.is_available(),
                      num_workers=NUM_WORKERS,
                      persistent_workers=(NUM_WORKERS > 0),
                      prefetch_factor=PREFETCH_FACTOR if NUM_WORKERS > 0 else None)


def _build_optimizer(model, unfrozen):
    if not unfrozen:
        return optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()),
                           lr=LEARNING_RATE, weight_decay=1e-4)
    return optim.AdamW([
        {"params": model.visual_encoder.parameters(),   "lr": 1e-6},
        {"params": model.landmark_encoder.parameters(), "lr": 1e-4},
        {"params": model.bilstm.parameters(),           "lr": 1e-4},
        {"params": model.fc.parameters(),               "lr": 1e-4},
    ], weight_decay=1e-4)


def _save_last_ckpt(path, model, optimizer, scheduler, scaler, epoch,
                    history, best_val_acc, epochs_no_improve):
    raw_model = getattr(model, "_orig_mod", model)
    torch.save({
        "epoch": epoch,  # last COMPLETED epoch
        "model_state": raw_model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "scheduler_state": scheduler.state_dict(),
        "scaler_state": scaler.state_dict() if scaler is not None else None,
        "history": history,
        "best_val_acc": best_val_acc,
        "epochs_no_improve": epochs_no_improve,
        "class_names": CLASS_NAMES,
        "num_classes": NUM_CLASSES,
    }, path)


def train(on_epoch_end=None):
    """Train with resumable last.ckpt.

    on_epoch_end: optional callback invoked AFTER each epoch's files
        (history/curves/best/last.ckpt) are flushed to disk. Modal passes
        vol.commit() here so closing the terminal / preemption never loses
        more than the in-flight epoch.
    """
    torch.manual_seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.backends.cudnn.benchmark = True
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
    os.makedirs(LOG_DIR, exist_ok=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)

    dev_name = torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU"
    print(f"--- Training JuanSign V2.2 on {dev_name} ---")
    print(f"--- Dataset: {FRAME_ROOT} | Frozen batch: {BATCH_SIZE_FROZEN} | "
          f"Unfreeze batch: {BATCH_SIZE_UNFREEZE} | workers={NUM_WORKERS} ---")

    # ── Data ──────────────────────────────────────────────────────────────────
    train_ds = load_dataset(FRAME_ROOT, "training",   augment=True)
    val_ds   = load_dataset(FRAME_ROOT, "validation", augment=False)

    train_loader = _make_loader(train_ds, BATCH_SIZE_FROZEN, True)
    val_loader   = _make_loader(val_ds, BATCH_SIZE_FROZEN, False)

    # ── Model ─────────────────────────────────────────────────────────────────
    model  = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    if USE_TORCH_COMPILE and device.type == "cuda":
        try:
            model = torch.compile(model, mode="max-autotune")
            print("  torch.compile enabled (max-autotune).")
        except Exception as e:
            print(f"  torch.compile skipped: {e}")
    scaler = _make_grad_scaler(device)
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
    # AdamW (decoupled decay, head/LSTM only while frozen) — same thesis
    # topology, faster/more stable convergence than Adam.
    criterion = get_criterion(train_ds, device)
    optimizer = _build_optimizer(model, unfrozen=False)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
    writer    = SummaryWriter(log_dir=LOG_DIR)

    best_val_acc      = 0.0
    epochs_no_improve = 0
    start_epoch       = 1
    sample_frames = sample_lms = None
    history = {
        "train_loss": [], "val_loss": [],
        "train_acc":  [], "val_acc":  [],
        "train_f1":   [], "val_f1":   [],
        "val_precision": [], "val_recall": [], "val_calibration": [],
    }

    # ── Resume from last.ckpt (cancel-safe) ───────────────────────────────
    if os.path.exists(LAST_CKPT_PATH):
        try:
            ckpt = torch.load(LAST_CKPT_PATH, map_location=device)
            raw_model = getattr(model, "_orig_mod", model)
            raw_model.load_state_dict(ckpt["model_state"])
            history = ckpt.get("history", history)
            best_val_acc = ckpt.get("best_val_acc", 0.0)
            epochs_no_improve = ckpt.get("epochs_no_improve", 0)
            start_epoch = int(ckpt.get("epoch", 0)) + 1
            print(f"  ⚡️ Resuming from {LAST_CKPT_PATH} at epoch {start_epoch} "
                  f"(best val {best_val_acc:.2f}%)")
            if start_epoch > EPOCHS:
                print("  ✅ Checkpoint already reached max epochs, skipping train loop.")
        except Exception as e:
            print(f"  ⚠️ Resume failed ({e}), starting from scratch.")
            start_epoch = 1

    if start_epoch > FREEZE_EPOCHS:
        # Re-apply unfrozen state when resuming past the freeze point.
        try:
            model.unfreeze_backbone()
        except Exception:
            pass
        optimizer = _build_optimizer(model, unfrozen=True)
        try:
            optimizer.load_state_dict(ckpt.get("optimizer_state", {}))
        except Exception as e:
            print(f"  ⚠️ optimizer resume skipped: {e}")
        try:
            scheduler.load_state_dict(ckpt.get("scheduler_state", {}))
        except Exception:
            pass
        if scaler is not None and ckpt.get("scaler_state"):
            try:
                scaler.load_state_dict(ckpt["scaler_state"])
            except Exception:
                pass
        train_loader = _make_loader(train_ds, BATCH_SIZE_UNFREEZE, True)
        val_loader   = _make_loader(val_ds, BATCH_SIZE_UNFREEZE, False)
    elif start_epoch > 1:
        try:
            optimizer.load_state_dict(ckpt.get("optimizer_state", {}))
            scheduler.load_state_dict(ckpt.get("scheduler_state", {}))
            if scaler is not None and ckpt.get("scaler_state"):
                scaler.load_state_dict(ckpt["scaler_state"])
        except Exception as e:
            print(f"  ⚠️ optimizer resume skipped: {e}")

    for epoch in range(start_epoch, EPOCHS + 1):

        # ── Unfreeze ──────────────────────────────────────────────────────────
        if epoch == FREEZE_EPOCHS + 1 and start_epoch <= FREEZE_EPOCHS:
            model.unfreeze_backbone()
            optimizer = _build_optimizer(model, unfrozen=True)
            scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=3)
            train_loader = _make_loader(train_ds, BATCH_SIZE_UNFREEZE, True)
            val_loader   = _make_loader(val_ds, BATCH_SIZE_UNFREEZE, False)
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

        # ── Save Best Model (test eval deferred to end for speed) ─────────────
        if val_acc > best_val_acc:
            best_val_acc      = val_acc
            epochs_no_improve = 0
            # Unwrap torch.compile (_orig_mod) so checkpoints stay loadable.
            raw_model = getattr(model, "_orig_mod", model)
            torch.save({
                "model_state": raw_model.state_dict(),
                "class_names": CLASS_NAMES,
                "num_classes": NUM_CLASSES,
            }, MODEL_SAVE_PATH)
            print(f"  ✓ Best model saved → {MODEL_SAVE_PATH} (Val Acc: {best_val_acc:.2f}%)")

        else:
            epochs_no_improve += 1
            print(f"  No improvement ({epochs_no_improve}/{EARLY_STOP_PATIENCE})")
            if epochs_no_improve >= EARLY_STOP_PATIENCE:
                print("Early stopping triggered.")
                _save_last_ckpt(LAST_CKPT_PATH, model, optimizer, scheduler,
                                scaler, epoch, history, best_val_acc,
                                epochs_no_improve)
                if on_epoch_end is not None:
                    try:
                        on_epoch_end()
                    except Exception as e:
                        print(f"  [warn] volume commit failed: {e}")
                break

        # ── Resumable checkpoint every epoch (cancel-safe) ────────────────
        _save_last_ckpt(LAST_CKPT_PATH, model, optimizer, scheduler,
                        scaler, epoch, history, best_val_acc,
                        epochs_no_improve)
        print(f"  💾 last.ckpt saved (epoch {epoch})")
        if on_epoch_end is not None:
            try:
                on_epoch_end()
            except Exception as e:
                print(f"  [warn] volume commit failed: {e}")

    writer.close()
    print(f"\nDone! Best Val Acc: {best_val_acc:.2f}%")

    # ── Final test evaluation on the BEST checkpoint (once, not per-epoch) ──
    if os.path.exists(MODEL_SAVE_PATH):
        try:
            raw_model = getattr(model, "_orig_mod", model)
            ckpt = torch.load(MODEL_SAVE_PATH, map_location=device)
            raw_model.load_state_dict(ckpt["model_state"])
            print("  🧪 Running final test evaluation on best checkpoint...")
            run_test_evaluation(raw_model, criterion, device, CLASS_NAMES)
        except Exception as e:
            print(f"  ⚠️ Final test eval skipped: {e}")


if __name__ == "__main__":
    train()