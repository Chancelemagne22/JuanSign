import modal
import os
import sys
import subprocess

# ── CLOUD ENVIRONMENT ─────────────────────────────────────────────────────────
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
        "torchmetrics",
        "fvcore",
        "torchinfo"
        # wandb removed
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
)
def extract_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    if not os.path.exists("/data/unprocessed_input/training_data"):
        zip_path = "/data/dataset.zip"
        if os.path.exists(zip_path):
            print("📦 Extracting dataset.zip...")
            subprocess.run(["unzip", "-q", zip_path, "-d", "/data"])
            vol.commit()
            print("✅ Unzip complete.")
        else:
            print("❌ ERROR: /data/dataset.zip not found.")
            return

    print("🔍 Starting JuanSign Frame Extraction...")
    from frame_extractor import run_extraction
    run_extraction()

    vol.commit()
    print("✅ Extraction complete.")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — TRAINING (With Force-Commit Logic)
# ══════════════════════════════════════════════════════════════════════════════

@app.function(
    image=image,
    gpu="A10G",
    volumes={"/data": vol},
    timeout=7200,
)
def train_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    if not os.path.exists("/data/processed_output"):
        print("❌ ERROR: /data/processed_output not found.")
        return

    print("🚀 Starting JuanSign V2.2 Training...")
    from train_main import train
    
    try:
        train()
    except Exception as e:
        print(f"💥 Training crashed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # GUARANTEE: Even if the code crashes, we save the results folder
        print("💾 Force-committing results to Volume...")
        vol.commit()
        print("✅ Results saved.")

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
    """Run extraction then training"""
    extract_on_cloud.remote()
    train_on_cloud.remote()