import modal
import os

app = modal.App("juansign-volume-test")

model_volume = modal.Volume.from_name("juansign-model-vol")

@app.function(volumes={"/model-weights": model_volume})
def check_volume():
    print("=== Volume contents ===")
    
    # Walk entire volume mount recursively
    for root, dirs, files in os.walk("/model-weights"):
        print(f"\nDirectory: {root}")
        for d in dirs:
            print(f"  [DIR]  {os.path.join(root, d)}")
        for f in files:
            full_path = os.path.join(root, f)
            size = os.path.getsize(full_path)
            print(f"  [FILE] {full_path}  ({size / 1e6:.1f} MB)")
    
    print("\n=== Done ===")

@app.local_entrypoint()
def main():
    check_volume.remote()