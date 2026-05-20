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
        "torchinfo",
    )
    .apt_install("unzip", "curl", "libgl1", "libglib2.0-0", "libegl1-mesa", "libgles2-mesa")
    .env({
        "EGL_PLATFORM":           "surfaceless",
        "MEDIAPIPE_DISABLE_GPU":  "1",
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
    timeout=10800,  # 3 hours
)
def extract_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    if not os.path.exists("/data/unprocessed_input/training"):
        zip_path = "/data/unprocessed_input/dataset.zip" \
            if os.path.exists("/data/unprocessed_input/dataset.zip") \
            else "/data/dataset.zip"
        if os.path.exists(zip_path):
            print("📦 Extracting dataset.zip...")
            extract_dir = "/data/unprocessed_input" \
                if "unprocessed_input" in zip_path else "/data"
            result = subprocess.run(["unzip", "-q", zip_path, "-d", extract_dir])
            print(f"Unzip exit code: {result.returncode}")
            print("Contents of /data after unzip:", os.listdir("/data"))
            vol.commit()
            print("✅ Unzip complete.")
        else:
            print("❌ ERROR: No dataset.zip found in Volume.")
            print("   Upload first: modal volume put juansign-model-vol ./dataset.zip /dataset.zip")
            return

    print("🔍 Starting JuanSign Frame Extraction...")
    from frame_extractor import run_extraction
    run_extraction()
    vol.commit()
    print("✅ Extraction complete.")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — TRAINING
# ══════════════════════════════════════════════════════════════════════════════

@app.function(
    image=image,
    gpu="A10G",
    volumes={"/data": vol},
    timeout=21600,   # ← 6 hours (was 2 hours — too short for 50 epochs)
)
def train_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    if not os.path.exists("/data/processed_output"):
        print("❌ ERROR: /data/processed_output not found.")
        print("   Run extraction first: modal run modal_run.py::extract")
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
        # Commits whatever was saved — even on crash or timeout
        print("💾 Committing all results to Volume...")
        vol.commit()
        print("✅ Results committed.")

# ══════════════════════════════════════════════════════════════════════════════
# LOCAL ENTRYPOINTS
# Use .spawn() for detached/background work (per Modal best practices)
# Example: modal run modal_run.py::train --detach
# ══════════════════════════════════════════════════════════════════════════════

@app.local_entrypoint()
def extract():
    """
    Extraction only.
    Invoke with: modal run modal_run.py::extract --detach
    Monitor with: modal app logs juansign-v2-2-training
    """
    extract_on_cloud.spawn()
    print("✅ Extraction spawned in Modal cloud.")
    print("   Invoke with: modal run modal_run.py::extract --detach")
    print("   Monitor: modal app logs juansign-v2-2-training")

@app.local_entrypoint()
def train():
    """
    Training only.
    Invoke with: modal run modal_run.py::train --detach
    Monitor with: modal app logs juansign-v2-2-training
    """
    train_on_cloud.spawn()
    print("✅ Training spawned in Modal cloud.")
    print("   Invoke with: modal run modal_run.py::train --detach")
    print("   Monitor: modal app logs juansign-v2-2-training")

@app.local_entrypoint()
def main():
    """
    Full pipeline (extraction + training).
    Invoke with: modal run modal_run.py --detach
    Monitor with: modal app logs juansign-v2-2-training
    """
    extract_on_cloud.spawn()
    print("✅ Extraction spawned.")
    train_on_cloud.spawn()
    print("✅ Training spawned.")
    print("   Both jobs running in Modal cloud.")
    print("   Invoke with: modal run modal_run.py --detach")
    print("   Monitor: modal app logs juansign-v2-2-training")