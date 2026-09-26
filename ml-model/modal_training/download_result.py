
import subprocess
import os

files = [
    "calibration_plot.png",
    "confusion_matrix.png",
    "training_curves.png",
    "model_summary.txt",
    "test_results.json",
    "training_history.json",
    # profiler_report.txt is local-only (CUPTI OOM on Modal) — pulled best-effort.
    "profiler_report.txt",
]

os.makedirs("./results", exist_ok=True)
os.makedirs("./juansignmodel", exist_ok=True)

for f in files:
    print(f"Downloading {f}...")
    r = subprocess.run([
        "modal", "volume", "get",
        "juansign-model-vol",
        f"/results/{f}",
        f"./results/{f}"
    ])
    print(f"{'✅' if r.returncode == 0 else '⚠️ (missing on volume)'} {f} done")

# V2.2 weights — the file integration actually needs.
print("Downloading juansign_v2_2.pth...")
r = subprocess.run([
    "modal", "volume", "get",
    "juansign-model-vol",
    "/models/juansign_v2_2.pth",
    "./juansignmodel/juansign_model_v2_2.pth"
])
print(f"{'✅' if r.returncode == 0 else '⚠️ (train first)'} juansign_v2_2.pth done")

# Resumable checkpoint — lets you inspect/continue interrupted training.
print("Downloading last.ckpt (best-effort)...")
r = subprocess.run([
    "modal", "volume", "get",
    "juansign-model-vol",
    "/models/last.ckpt",
    "./juansignmodel/last.ckpt"
])
print(f"{'✅' if r.returncode == 0 else '⚠️ (no checkpoint yet)'} last.ckpt done")