"""
inspect_volume.py — List all files in the juansign-model-vol Modal Volume.

Usage:
    modal run juansignsrc/inspect_volume.py
"""

import os
import modal

app = modal.App("juansign-volume-inspector")

model_volume = modal.Volume.from_name("juansign-model-vol")

MOUNT_PATH = "/model-weights"


@app.function(
    image=modal.Image.debian_slim(),
    volumes={MOUNT_PATH: model_volume},
)
def list_volume():
    model_volume.reload()

    print(f"\n=== Contents of volume mounted at {MOUNT_PATH} ===\n")

    found_any = False
    for dirpath, dirnames, filenames in os.walk(MOUNT_PATH):
        level = dirpath.replace(MOUNT_PATH, "").count(os.sep)
        indent = "  " * level
        print(f"{indent}{dirpath}/")
        sub_indent = "  " * (level + 1)
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            size_mb = os.path.getsize(filepath) / (1024 * 1024)
            print(f"{sub_indent}{filename}  ({size_mb:.2f} MB)")
            found_any = True

    if not found_any:
        print("  (volume is empty or no files found)")

    print("\n=== Done ===")


@app.local_entrypoint()
def main():
    list_volume.remote()
