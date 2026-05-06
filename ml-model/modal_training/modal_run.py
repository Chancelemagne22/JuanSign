import modal
import os
import subprocess

# Define the cloud environment
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.2.0",
        "torchvision==0.17.0",
        "opencv-python-headless",
        "mediapipe",
        "numpy==1.26.4",
        "Pillow",
        "tensorboard"
    )
    .apt_install("unzip")
)

app = modal.App("juansign-v2-2-training")
vol = modal.Volume.from_name("juansign-data-vol", create_if_missing=True)

@app.function(
    image=image,
    gpu="A10G", 
    volumes={"/data": vol},
    timeout=7200, # 2 hours
    # This mounts everything inside your modal_training folder to the cloud /root
    mounts=[modal.Mount.from_local_dir("./", remote_path="/root")]
)
def train_on_cloud():
    # 1. Prepare Environment
    os.chdir("/root")
    os.environ["MODAL_RUN"] = "1"
    
    # 2. Extract Data (Run only once)
    if not os.path.exists("/data/processed_output"):
        if os.path.exists("/data/dataset.zip"):
            print("📦 Extracting dataset in cloud...")
            subprocess.run(["unzip", "-q", "/data/dataset.zip", "-d", "/data"])
            vol.commit()
        else:
            print("❌ ERROR: dataset.zip not found in Volume. Upload it first!")
            return

    # 3. Start Training
    print("🚀 Starting JuanSign V2.2 Training...")
    from train_main import train # Matches your screenshot filename
    train()
    
    # 4. Save results back to volume
    vol.commit()
    print("✅ Training complete. Model saved to Volume.")

@app.local_entrypoint()
def main():
    train_on_cloud.remote()