# ml-model/juansignsrc/model_visualization.py
#
# Generates 5 evaluation charts for the v2.0 JuanSign model:
#   1. Confusion matrix (raw counts)
#   2. Confusion matrix (normalized %)
#   3. Per-class accuracy bar chart
#   4. Precision / Recall / F1 per class
#   5. Top confusion pairs (most common misclassifications)
#
# Usage (from juansignsrc/):
#   python model_visualization.py
#
# Outputs go to: visualization_output/

import os
import torch
import numpy as np
import matplotlib
matplotlib.use("Agg")   # headless — no display required
import matplotlib.pyplot as plt
import seaborn as sns
from collections import Counter
from torch.utils.data import DataLoader
from sklearn.metrics import precision_recall_fscore_support

from resnet_lstm_architecture import ResNetLSTM
from fsl_datasets import FSLDataset, collate_fn

# ── Paths ─────────────────────────────────────────────────────────────────────
MODEL_PATH = "./juansignmodel/juansign_model.pth"
TEST_ROOT  = "./processed_output/frame_extracted/testing_data"
OUTPUT_DIR = "visual_output_v2"

# ── Hyperparams ───────────────────────────────────────────────────────────────
BATCH_SIZE    = 8
NUM_WORKERS   = 0   # set 0 on Windows to avoid multiprocessing issues
TOP_N_CONFUSIONS = 10


# ══════════════════════════════════════════════════════════════════════════════
# SETUP
# ══════════════════════════════════════════════════════════════════════════════

def load_model_and_classes(model_path, device):
    checkpoint  = torch.load(model_path, map_location=device, weights_only=False)
    class_names = checkpoint["class_names"]
    num_classes = checkpoint["num_classes"]

    model = ResNetLSTM(num_classes=num_classes)
    model.load_state_dict(checkpoint["model_state"])
    model.to(device)
    model.eval()

    print(f"[Checkpoint] epoch={checkpoint['epoch']}  "
          f"val_acc={checkpoint['val_acc']:.4f}  "
          f"val_loss={checkpoint['val_loss']:.4f}")
    print(f"[Checkpoint] num_classes={num_classes}  classes={class_names}")

    return model, class_names, num_classes


def build_loader(test_root):
    dataset = FSLDataset(test_root, augment=False)
    loader  = DataLoader(
        dataset,
        batch_size  = BATCH_SIZE,
        shuffle     = False,
        num_workers = NUM_WORKERS,
        collate_fn  = collate_fn,
    )
    return loader


# ══════════════════════════════════════════════════════════════════════════════
# INFERENCE
# ══════════════════════════════════════════════════════════════════════════════

def run_inference(model, loader, device):
    """Returns (all_preds, all_labels) as numpy int arrays."""
    all_preds  = []
    all_labels = []

    with torch.no_grad():
        for frames, landmarks, labels in loader:
            frames    = frames.to(device)
            landmarks = landmarks.to(device)
            labels    = labels.to(device)

            logits = model(frames, landmarks)
            preds  = torch.argmax(logits, dim=1)

            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())

    return np.array(all_preds), np.array(all_labels)


# ══════════════════════════════════════════════════════════════════════════════
# CHART 1 & 2 — CONFUSION MATRICES
# ══════════════════════════════════════════════════════════════════════════════

def _build_confusion_matrix(preds, labels, num_classes):
    cm = np.zeros((num_classes, num_classes), dtype=int)
    for true, pred in zip(labels, preds):
        cm[true][pred] += 1
    return cm


def plot_confusion_raw(cm, class_names, output_dir):
    fig, ax = plt.subplots(figsize=(max(8, len(class_names)), max(6, len(class_names) - 1)))
    sns.heatmap(
        cm,
        annot   = True,
        fmt     = "d",
        cmap    = "Blues",
        xticklabels = class_names,
        yticklabels = class_names,
        ax      = ax,
    )
    ax.set_xlabel("Predicted", fontsize=12)
    ax.set_ylabel("True",      fontsize=12)
    ax.set_title("Confusion Matrix (Raw Counts)", fontsize=14)
    plt.tight_layout()
    path = os.path.join(output_dir, "confusion_matrix_raw.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[Saved] {path}")


def plot_confusion_normalized(cm, class_names, output_dir):
    row_sums = cm.sum(axis=1, keepdims=True)
    cm_norm  = np.where(row_sums > 0, cm / row_sums, 0.0)

    fig, ax = plt.subplots(figsize=(max(8, len(class_names)), max(6, len(class_names) - 1)))
    sns.heatmap(
        cm_norm,
        annot   = True,
        fmt     = ".2f",
        cmap    = "Blues",
        vmin    = 0.0,
        vmax    = 1.0,
        xticklabels = class_names,
        yticklabels = class_names,
        ax      = ax,
    )
    ax.set_xlabel("Predicted", fontsize=12)
    ax.set_ylabel("True",      fontsize=12)
    ax.set_title("Confusion Matrix (Normalized by True Class)", fontsize=14)
    plt.tight_layout()
    path = os.path.join(output_dir, "confusion_matrix_normalized.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[Saved] {path}")


# ══════════════════════════════════════════════════════════════════════════════
# CHART 3 — PER-CLASS ACCURACY
# ══════════════════════════════════════════════════════════════════════════════

def plot_per_class_accuracy(cm, class_names, output_dir):
    row_sums    = cm.sum(axis=1)
    correct     = np.diag(cm)
    per_class   = np.where(row_sums > 0, correct / row_sums, 0.0)
    overall_acc = correct.sum() / row_sums.sum() if row_sums.sum() > 0 else 0.0

    colors = ["#4CAF50" if a >= 0.8 else "#FFC107" if a >= 0.5 else "#F44336"
              for a in per_class]

    fig, ax = plt.subplots(figsize=(max(8, len(class_names) * 0.9), 5))
    bars = ax.bar(class_names, per_class, color=colors, edgecolor="white")

    for bar, acc in zip(bars, per_class):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.01,
            f"{acc:.2f}",
            ha="center", va="bottom", fontsize=9,
        )

    ax.axhline(overall_acc, color="steelblue", linestyle="--", linewidth=1.5,
               label=f"Overall acc = {overall_acc:.3f}")
    ax.set_ylim(0, 1.12)
    ax.set_xlabel("Class", fontsize=12)
    ax.set_ylabel("Accuracy", fontsize=12)
    ax.set_title("Per-Class Accuracy", fontsize=14)
    ax.legend()
    plt.tight_layout()
    path = os.path.join(output_dir, "per_class_accuracy.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[Saved] {path}")


# ══════════════════════════════════════════════════════════════════════════════
# CHART 4 — PRECISION / RECALL / F1
# ══════════════════════════════════════════════════════════════════════════════

def plot_precision_recall_f1(preds, labels, class_names, output_dir):
    precision, recall, f1, _ = precision_recall_fscore_support(
        labels, preds,
        labels    = list(range(len(class_names))),
        zero_division = 0,
    )

    x      = np.arange(len(class_names))
    width  = 0.27

    fig, ax = plt.subplots(figsize=(max(10, len(class_names) * 1.1), 5))
    ax.bar(x - width, precision, width, label="Precision", color="#2196F3", alpha=0.85)
    ax.bar(x,         recall,    width, label="Recall",    color="#4CAF50", alpha=0.85)
    ax.bar(x + width, f1,        width, label="F1",        color="#FF9800", alpha=0.85)

    ax.set_xticks(x)
    ax.set_xticklabels(class_names)
    ax.set_ylim(0, 1.12)
    ax.set_xlabel("Class", fontsize=12)
    ax.set_ylabel("Score", fontsize=12)
    ax.set_title("Precision / Recall / F1 per Class", fontsize=14)
    ax.legend()
    plt.tight_layout()
    path = os.path.join(output_dir, "precision_recall_f1.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[Saved] {path}")


# ══════════════════════════════════════════════════════════════════════════════
# CHART 5 — TOP CONFUSIONS
# ══════════════════════════════════════════════════════════════════════════════

def plot_top_confusions(preds, labels, class_names, output_dir, top_n=TOP_N_CONFUSIONS):
    confusion_pairs = [
        (class_names[t], class_names[p])
        for t, p in zip(labels, preds)
        if t != p
    ]

    if not confusion_pairs:
        print("[Info] No misclassifications found — skipping top confusions chart.")
        return

    counter = Counter(confusion_pairs)
    top     = counter.most_common(top_n)

    pair_labels = [f"{true} → {pred}" for (true, pred), _ in top]
    counts      = [cnt for _, cnt in top]

    fig, ax = plt.subplots(figsize=(10, max(4, len(top) * 0.55)))
    bars = ax.barh(pair_labels[::-1], counts[::-1], color="#E53935", alpha=0.85)

    for bar, cnt in zip(bars, counts[::-1]):
        ax.text(
            bar.get_width() + 0.2,
            bar.get_y() + bar.get_height() / 2,
            str(cnt),
            va="center", fontsize=9,
        )

    ax.set_xlabel("Count", fontsize=12)
    ax.set_title(f"Top {len(top)} Confusion Pairs (True → Predicted)", fontsize=14)
    plt.tight_layout()
    path = os.path.join(output_dir, "top_confusions.png")
    fig.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[Saved] {path}")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[Device] {device}\n")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── Load model ────────────────────────────────────────────────────────────
    model, class_names, num_classes = load_model_and_classes(MODEL_PATH, device)

    # ── Load test data ────────────────────────────────────────────────────────
    loader = build_loader(TEST_ROOT)
    if len(loader.dataset) == 0:
        print(f"[Error] No test samples found at: {TEST_ROOT}")
        return

    # ── Run inference ─────────────────────────────────────────────────────────
    print(f"\nRunning inference on {len(loader.dataset)} test samples…")
    preds, labels = run_inference(model, loader, device)

    overall_acc = (preds == labels).mean()
    print(f"Overall accuracy : {overall_acc:.4f}  ({(preds == labels).sum()}/{len(labels)})\n")

    # ── Build confusion matrix ────────────────────────────────────────────────
    cm = _build_confusion_matrix(preds, labels, num_classes)

    # ── Generate charts ───────────────────────────────────────────────────────
    print("Generating charts…")
    plot_confusion_raw(cm, class_names, OUTPUT_DIR)
    plot_confusion_normalized(cm, class_names, OUTPUT_DIR)
    plot_per_class_accuracy(cm, class_names, OUTPUT_DIR)
    plot_precision_recall_f1(preds, labels, class_names, OUTPUT_DIR)
    plot_top_confusions(preds, labels, class_names, OUTPUT_DIR)

    print(f"\nDone. All charts saved to ./{OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
