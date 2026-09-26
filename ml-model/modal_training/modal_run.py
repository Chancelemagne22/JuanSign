import modal
import os
import sys
import subprocess

# ── CLOUD ENVIRONMENT ─────────────────────────────────────────────────────────
# Pins mirror ml-model/requirements.txt so local + Modal stay in sync.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.2.0",
        "torchvision==0.17.0",
        "opencv-python-headless==4.9.0.80",
        "mediapipe==0.10.11",
        "numpy==1.26.4",
        "Pillow==10.2.0",
        "tensorboard==2.16.2",
        "scikit-learn==1.4.1.post1",
        "matplotlib==3.8.3",
        "seaborn==0.13.2",
        "torchmetrics==1.4.0",
        "fvcore==0.1.5.post20221221",
        "torchinfo==1.8.0",
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
    # Skip venv/caches/datasets — they bloat the image build for no benefit.
    .add_local_dir("./", remote_path="/root", ignore=[
        "venv", "__pycache__", ".venv", "cache", "processed_output",
        "runs", "results", "*.pt", "*.pth", "*.zip",
    ])
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
    try:
        run_extraction(on_progress=lambda: vol.commit(), commit_every=25)
    finally:
        vol.commit()
    print("✅ Extraction complete.")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1.5 — DATASET CACHING (run once after extraction)
# Converts 42,500 individual file reads per epoch → 1 file read per clip
# ══════════════════════════════════════════════════════════════════════════════

@app.function(
    image=image,
    cpu=4,
    memory=16384,   # 16 GB RAM — holds all tensors during build
    volumes={"/data": vol},
    timeout=10800,
)
def cache_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    if not os.path.exists("/data/processed_output"):
        print("❌ ERROR: Run extraction first.")
        return

    from cache_dataset import run_cache
    try:
        run_cache(on_split_done=lambda: vol.commit())
    finally:
        vol.commit()
    print("✅ Cache saved to Volume.")

# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — TRAINING
# ══════════════════════════════════════════════════════════════════════════════

@app.function(
    image=image,
    gpu="A10G",
    volumes={"/data": vol},
    timeout=21600,   # ← 6 hours (was 2 hours — too short for 50 epochs)
    retries=modal.Retries(initial_delay=0.0, max_retries=10),
    single_use_containers=True,
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
    print("   (resumable via /data/models/last.ckpt — safe to re-run)")
    from train_main import train

    try:
        train(on_epoch_end=lambda: vol.commit())
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
# FULL PIPELINE — Cache + Train in one cloud function
# This is the recommended way to run long jobs — no local client needed
# ══════════════════════════════════════════════════════════════════════════════

@app.function(
    image=image,
    gpu="A10G",
    memory=16384,
    volumes={"/data": vol},
    timeout=28800,   # 8 hours total
    retries=modal.Retries(initial_delay=0.0, max_retries=10),
    single_use_containers=True,
)
def pipeline_on_cloud():
    os.chdir("/root")
    sys.path.insert(0, "/root")
    os.environ["MODAL_RUN"] = "1"

    if not os.path.exists("/data/processed_output"):
        print("❌ ERROR: Run extraction first.")
        return

    # Step 1 — Cache (if not already done)
    cache_path = "/data/cache/training.pt"
    if not os.path.exists(cache_path):
        print("📦 Building dataset cache...")
        from cache_dataset import run_cache
        try:
            run_cache(on_split_done=lambda: vol.commit())
        finally:
            vol.commit()
        print("✅ Cache complete.")
    else:
        print("✅ Cache already exists, skipping.")

    # Step 2 — Train
    print("🚀 Starting training...")
    print("   (resumable via /data/models/last.ckpt — safe to re-run)")
    from train_main import train
    try:
        train(on_epoch_end=lambda: vol.commit())
    except Exception as e:
        print(f"💥 Training crashed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print("💾 Committing results...")
        vol.commit()
        print("✅ Done.")

# ══════════════════════════════════════════════════════════════════════════════
# LOCAL ENTRYPOINTS — fire-and-forget via spawn() so the local command
# returns in seconds. With --detach the job survives terminal/VSCode close.
# Use --detach flag when running: modal run --detach modal_run.py::train
# Safe-to-close = you see the function-call ID + App URL below.
# ══════════════════════════════════════════════════════════════════════════════

@app.local_entrypoint()
def pipeline():
    """Cache + Train in one shot  →  modal run --detach modal_run.py::pipeline"""
    handle = pipeline_on_cloud.spawn()
    print(f"🚀 Spawned pipeline: {handle.object_id}")
    print("✅ Safe to close this terminal now — watch logs in Modal dashboard")
    print("   or: modal app logs juansign-v2-2-training --follow")

@app.local_entrypoint()
def extract():
    """Extraction only  →  modal run --detach modal_run.py::extract"""
    handle = extract_on_cloud.spawn()
    print(f"🚀 Spawned extract: {handle.object_id}")
    print("✅ Safe to close this terminal now — watch logs in Modal dashboard")

@app.local_entrypoint()
def cache():
    """Cache dataset  →  modal run --detach modal_run.py::cache"""
    handle = cache_on_cloud.spawn()
    print(f"🚀 Spawned cache: {handle.object_id}")
    print("✅ Safe to close this terminal now — watch logs in Modal dashboard")

@app.local_entrypoint()
def train():
    """Training only  →  modal run --detach modal_run.py::train"""
    handle = train_on_cloud.spawn()
    print(f"🚀 Spawned train: {handle.object_id}")
    print("✅ Safe to close this terminal now — watch logs in Modal dashboard")
    print("   or: modal app logs juansign-v2-2-training --follow")

@app.local_entrypoint()
def main():
    """Full pipeline  →  modal run --detach modal_run.py"""
    h1 = extract_on_cloud.spawn()
    print(f"🚀 Spawned extract: {h1.object_id} (train must be run after it finishes)")
    print("✅ Safe to close this terminal now.")