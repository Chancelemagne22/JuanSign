import modal
import os
import sys
import subprocess

# ── CLOUD ENVIRONMENT ─────────────────────────────────────────────────────────
# MediaPipe models are downloaded at image build time (same approach as main.py)
# so they are always available without needing local files.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.2.0",
        "torchvision==0.17.0",
        "opencv-python-headless",
        "mediapipe",
        "numpy==1.26.4",
        "Pillow",
        "tensorboard",
        "scikit-learn",
        "matplotlib",
        "seaborn",
        "wandb",
        "torchmetrics",
        "fvcore",
        "torchinfo"
    )
    .apt_install("unzip", "curl", "libgl1", "libglib2.0-0", "libegl1-mesa", "libgles2-mesa")
    .env({
        "EGL_PLATFORM": "surfaceless",
        "MEDIAPIPE_DISABLE_GPU": "1",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    })
    .run_commands(
        "curl -fsSL -o /root/hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        "curl -fsSL -o /root/blaze_face_short_range.tflite https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    )
    .add_local_dir("./", remote_path="/root")
)

app = modal.App("juansign-v2-2-training")
vol = modal.Volume.from_name("juansign-model-vol", create_if_missing=True)

# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — FRAME EXTRACTION
# ══════════════════════════════════════════════════════════════════════════════

@app.function(
    image=image,
    cpu=4,
    memory=8192,
    volumes={"/data": vol},
    timeout=10800,
    secrets=[modal.Secret.from_name("wandb-secret")],
)
def extract_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    # Step 1 — Unzip dataset.zip if unprocessed_input doesn't exist yet
    if not os.path.exists("/data/unprocessed_input/training"):
        zip_path = "/data/unprocessed_input/dataset.zip" if os.path.exists("/data/unprocessed_input/dataset.zip") else "/data/dataset.zip"
        if os.path.exists(zip_path):
            print("📦 Extracting dataset.zip...")
            result = subprocess.run(["unzip", "-q", zip_path, "-d", "/data/unprocessed_input"])
            print(f"Unzip exit code: {result.returncode}")
            print("Contents of /data after unzip:", os.listdir("/data"))
            vol.commit()
            print("✅ Unzip complete.")
        else:
            print("❌ ERROR: Neither /data/unprocessed_input nor /data/dataset.zip found in Volume.")
            print("   Upload your dataset first:")
            print("   modal volume put juansign-model-vol ./dataset.zip /dataset.zip")
            return

    # Step 2 — Run extraction
    print("🔍 Starting JuanSign Frame Extraction...")
    from frame_extractor import run_extraction
    run_extraction()

    vol.commit()
    print("✅ Extraction complete. Frames saved to Volume.")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — TRAINING
# ══════════════════════════════════════════════════════════════════════════════

@app.function(
    image=image,
    gpu="A10G",
    volumes={"/data": vol},
    timeout=7200,
    secrets=[modal.Secret.from_name("wandb-secret")],
)
def train_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    if not os.path.exists("/data/processed_output"):
        print("❌ ERROR: /data/processed_output not found in Volume.")
        print("   Run extraction first: modal run modal_run.py::extract")
        return

    print("🚀 Starting JuanSign V2.2 Training...")
    from train_main import train
    train()

    vol.commit()
    print("✅ Training complete. Model saved to /data/models/juansign_v2_2.pth")

# ══════════════════════════════════════════════════════════════════════════════
# LOCAL ENTRYPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.local_entrypoint()
def extract():
    """Extraction only  →  modal run modal_run.py::extract"""
    extract_on_cloud.remote()

@app.local_entrypoint()
def train():
    """Training only  →  modal run modal_run.py::train"""
    train_on_cloud.remote()

@app.local_entrypoint()
def main():
    """Full pipeline  →  modal run modal_run.py"""
    print("--- Step 1/2: Frame Extraction ---")
    extract_on_cloud.remote()
    print("--- Step 2/2: Training ---")
    train_on_cloud.remote()