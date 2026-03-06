import os
import torch
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import seaborn as sns
from torch.utils.data import DataLoader
from torchvision import transforms
from sklearn.metrics import confusion_matrix, classification_report, accuracy_score
from torch.nn.utils.rnn import pad_sequence

from resnet_lstm_architecture import ResNetLSTM
from fsl_dataset import FSLDataset

# ── Path resolution (same pattern as train.py) ────────────────────────────────
_SRC_DIR = os.path.dirname(os.path.abspath(__file__))   # ml-model/src/
_ML_DIR  = os.path.abspath(os.path.join(_SRC_DIR, '..'))  # ml-model/

TEST_DATA_PATH = os.path.join(_ML_DIR, 'processed_output', 'frame_extracted', 'testing_data')
MODEL_PATH     = os.path.join(_ML_DIR, 'juansignmodel', 'juansign_model.pth')
OUTPUT_DIR     = os.path.join(_ML_DIR, 'visualization_output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

NUM_CLASSES = 27
CLASSES     = ["A","B","C","D","E","F","G","H","I","J","K","L","M",
               "N","N~","O","P","Q","R","S","T","U","V","W","X","Y","Z"]
BATCH_SIZE  = 8

# Must match train.py's eval_transform exactly — no augmentation, same normalization
eval_transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225]),
])


def collate_fn(batch):
    videos = [item[0] for item in batch]
    labels = [item[1] for item in batch]
    videos_padded = pad_sequence(videos, batch_first=True, padding_value=0)
    return videos_padded, torch.tensor(labels)


# ── 1. Load model & run inference ─────────────────────────────────────────────

def load_model_and_predict():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device : {device}")

    test_ds = FSLDataset(TEST_DATA_PATH, transform=eval_transform)
    print(f"Samples: {len(test_ds)}  |  Classes: {test_ds.classes}")

    if len(test_ds.classes) != NUM_CLASSES:
        print(f"  Warning: expected {NUM_CLASSES} classes, found {len(test_ds.classes)}")

    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE,
                             shuffle=False, collate_fn=collate_fn)

    model = ResNetLSTM(num_classes=NUM_CLASSES).to(device)
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("Model loaded.\n")

    y_true, y_pred = [], []
    with torch.no_grad():
        for inputs, labels in test_loader:
            outputs    = model(inputs.to(device))
            _, predicted = torch.max(outputs, 1)
            y_true.extend(labels.numpy())
            y_pred.extend(predicted.cpu().numpy())

    return np.array(y_true), np.array(y_pred)


# ── 2. Console summary ────────────────────────────────────────────────────────

def print_summary(y_true, y_pred):
    overall = accuracy_score(y_true, y_pred) * 100
    report  = classification_report(y_true, y_pred,
                                    target_names=CLASSES, zero_division=0)
    print("=" * 62)
    print("  JUANSIGN FSL MODEL — PERFORMANCE REPORT")
    print("=" * 62)
    print(f"  Overall Accuracy : {overall:.2f}%")
    print(f"  Test Samples     : {len(y_true)}")
    print("-" * 62)
    print(report)
    print("=" * 62)


# ── 3. Raw confusion matrix ───────────────────────────────────────────────────

def plot_raw_confusion_matrix(cm):
    fig, ax = plt.subplots(figsize=(18, 15))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=CLASSES, yticklabels=CLASSES,
                linewidths=0.4, linecolor='#CCCCCC',
                annot_kws={"size": 8}, ax=ax)
    ax.set_title('JuanSign — Confusion Matrix (Sample Counts)',
                 fontsize=16, fontweight='bold', pad=16)
    ax.set_ylabel('True Sign', fontsize=12)
    ax.set_xlabel('Predicted Sign', fontsize=12)
    plt.tight_layout()
    out = os.path.join(OUTPUT_DIR, '1_confusion_matrix_raw.png')
    plt.savefig(out, dpi=200)
    print(f"Saved: {out}")
    plt.show()


# ── 4. Normalized confusion matrix (recall %) ─────────────────────────────────

def plot_normalized_confusion_matrix(cm):
    row_sums = cm.sum(axis=1, keepdims=True)
    cm_pct   = np.where(row_sums > 0, cm / row_sums * 100, 0)

    fig, ax = plt.subplots(figsize=(18, 15))
    sns.heatmap(cm_pct, annot=True, fmt='.1f', cmap='YlOrRd',
                xticklabels=CLASSES, yticklabels=CLASSES,
                vmin=0, vmax=100,
                linewidths=0.4, linecolor='#CCCCCC',
                annot_kws={"size": 7}, ax=ax)
    ax.set_title('JuanSign — Normalized Confusion Matrix  (Recall %, row-wise)',
                 fontsize=16, fontweight='bold', pad=16)
    ax.set_ylabel('True Sign', fontsize=12)
    ax.set_xlabel('Predicted Sign', fontsize=12)
    plt.tight_layout()
    out = os.path.join(OUTPUT_DIR, '2_confusion_matrix_normalized.png')
    plt.savefig(out, dpi=200)
    print(f"Saved: {out}")
    plt.show()


# ── 5. Per-class accuracy bar chart ──────────────────────────────────────────

def plot_per_class_accuracy(cm):
    row_sums = cm.sum(axis=1)
    acc      = np.where(row_sums > 0, cm.diagonal() / row_sums * 100, 0)
    colors   = ['#4CAF50' if a >= 80 else '#FF9800' if a >= 50 else '#F44336'
                for a in acc]

    fig, ax = plt.subplots(figsize=(15, 6))
    bars = ax.bar(CLASSES, acc, color=colors, edgecolor='white', linewidth=0.8)

    for bar, val in zip(bars, acc):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.8,
                f'{val:.0f}%', ha='center', va='bottom',
                fontsize=8, fontweight='bold')

    ax.axhline(80, color='green',  linestyle='--', linewidth=1.2,
               alpha=0.6, label='80% threshold')
    ax.axhline(50, color='orange', linestyle='--', linewidth=1.2,
               alpha=0.6, label='50% threshold')
    ax.set_ylim(0, 118)
    ax.set_xlabel('Sign Class', fontsize=12)
    ax.set_ylabel('Accuracy (%)', fontsize=12)
    ax.set_title('JuanSign — Per-Class Accuracy', fontsize=14, fontweight='bold')

    legend_handles = [
        mpatches.Patch(color='#4CAF50', label='≥ 80%  Good'),
        mpatches.Patch(color='#FF9800', label='50–79%  Fair'),
        mpatches.Patch(color='#F44336', label='< 50%   Needs Work'),
    ]
    ax.legend(handles=legend_handles, loc='lower right', fontsize=9)

    plt.tight_layout()
    out = os.path.join(OUTPUT_DIR, '3_per_class_accuracy.png')
    plt.savefig(out, dpi=200)
    print(f"Saved: {out}")
    plt.show()


# ── 6. Precision / Recall / F1 grouped bar chart ─────────────────────────────

def plot_precision_recall_f1(y_true, y_pred):
    report    = classification_report(y_true, y_pred,
                                      target_names=CLASSES,
                                      output_dict=True, zero_division=0)
    precision = [report[c]['precision'] * 100 for c in CLASSES]
    recall    = [report[c]['recall']    * 100 for c in CLASSES]
    f1        = [report[c]['f1-score']  * 100 for c in CLASSES]

    x, w = np.arange(len(CLASSES)), 0.27
    fig, ax = plt.subplots(figsize=(17, 6))
    ax.bar(x - w, precision, w, label='Precision', color='#2196F3', alpha=0.88)
    ax.bar(x,     recall,    w, label='Recall',    color='#4CAF50', alpha=0.88)
    ax.bar(x + w, f1,        w, label='F1-Score',  color='#FF9800', alpha=0.88)

    ax.set_xticks(x)
    ax.set_xticklabels(CLASSES, fontsize=9)
    ax.set_ylim(0, 112)
    ax.axhline(80, color='gray', linestyle='--', linewidth=0.8, alpha=0.5)
    ax.set_ylabel('Score (%)', fontsize=12)
    ax.set_xlabel('Sign Class', fontsize=12)
    ax.set_title('JuanSign — Precision, Recall & F1-Score per Class',
                 fontsize=14, fontweight='bold')
    ax.legend(fontsize=11)

    plt.tight_layout()
    out = os.path.join(OUTPUT_DIR, '4_precision_recall_f1.png')
    plt.savefig(out, dpi=200)
    print(f"Saved: {out}")
    plt.show()


# ── 7. Top-N most confused pairs ─────────────────────────────────────────────

def plot_top_confusions(cm, top_n=10):
    pairs = [
        (cm[i, j], CLASSES[i], CLASSES[j])
        for i in range(len(CLASSES))
        for j in range(len(CLASSES))
        if i != j and cm[i, j] > 0
    ]
    pairs.sort(reverse=True)
    top    = pairs[:top_n]
    labels = [f'"{true}" predicted as "{pred}"' for _, true, pred in top]
    counts = [c for c, _, _ in top]

    fig, ax = plt.subplots(figsize=(11, 5))
    pal = plt.cm.Reds(np.linspace(0.35, 0.85, len(counts)))
    ax.barh(labels[::-1], counts[::-1], color=pal, edgecolor='white')
    for i, v in enumerate(counts[::-1]):
        ax.text(v + 0.05, i, str(v), va='center', fontsize=10, fontweight='bold')
    ax.set_xlabel('Number of Misclassifications', fontsize=12)
    ax.set_title(f'JuanSign — Top {top_n} Most Confused Sign Pairs',
                 fontsize=14, fontweight='bold')
    ax.set_xlim(0, max(counts) * 1.22 if counts else 1)
    plt.tight_layout()
    out = os.path.join(OUTPUT_DIR, '5_top_confusions.png')
    plt.savefig(out, dpi=200)
    print(f"Saved: {out}")
    plt.show()


# ── Entry point ───────────────────────────────────────────────────────────────

def run_visualization():
    y_true, y_pred = load_model_and_predict()
    cm = confusion_matrix(y_true, y_pred)

    print_summary(y_true, y_pred)

    print("\nGenerating visualizations ...")
    plot_raw_confusion_matrix(cm)
    plot_normalized_confusion_matrix(cm)
    plot_per_class_accuracy(cm)
    plot_precision_recall_f1(y_true, y_pred)
    plot_top_confusions(cm, top_n=10)

    print(f"\nAll figures saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    run_visualization()
