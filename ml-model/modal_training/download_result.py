
import subprocess
import os

files = [
    "calibration_plot.png",
    "confusion_matrix.png",
    "training_curves.png",
    "model_summary.txt",
    "profiler_report.txt",
    "test_results.json",
    "training_history.json",
]

os.makedirs("./results", exist_ok=True)

for f in files:
    print(f"Downloading {f}...")
    subprocess.run([
        "modal", "volume", "get",
        "juansign-model-vol",
        f"/results/{f}",
        f"./results/{f}"
    ])
    print(f"✅ {f} done")