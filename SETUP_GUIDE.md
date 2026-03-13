# JuanSign — Setup Guide

Two ways to run the project: Google Colab (training with GPU) or a classmate's Windows PC (preprocessing).

---

## Option A: Google Colab (Training)

### What you need first
1. Your PC has the full repo folder (`Thesis/`)
2. A Google account with Google Drive access

### Steps

#### 1. Zip and upload the repo
- On your PC: right-click the `Thesis` folder → **Send to > Compressed (zipped) folder**
- Rename it to something simple like `JuanSign_Thesis.zip`
- Upload the zip to your **Google Drive root** (not inside any subfolder)

> **Tip:** If your `processed_output/frame_extracted/` folder is large (many GBs), you can exclude it from the zip if you only plan to train using Colab's frame extraction. But if you already have extracted frames, include them to skip the extraction step.

#### 2. Open the notebook in Colab
- Go to [colab.research.google.com](https://colab.research.google.com)
- Click **File > Upload notebook**
- Upload `ml-model/colab_juansign.ipynb` from your PC

#### 3. Set GPU runtime
- **Runtime > Change runtime type > Hardware accelerator: T4 GPU**
- Click Save

#### 4. Run the cells in order
| Cell | What it does | Required? |
|------|-------------|-----------|
| Cell 1 | Check GPU | Yes |
| Cell 2 | Mount Google Drive | Yes |
| Cell 3 | Copy + unzip repo from Drive | Yes (or use Cell 3b for GitHub) |
| Cell 4 | Set working directory | Yes |
| Cell 5 | Install packages | Yes |
| Cell 6 | Split raw videos | Only if no `unprocessed_input/` folder |
| Cell 7 | Extract frames | Only if no `frame_extracted/` folder |
| Cell 8 | Verify dataset | Yes |
| Cell 9 | Train model (up to 25 epochs) | Yes |
| Cell 10 | TensorBoard monitoring | Optional |
| Cell 11 | Download trained weights | Yes — download `juansign_model.pth` |
| Cell 12 | Save weights to Drive | Optional backup |

#### 5. After training
- Cell 11 downloads `juansign_model.pth` to your browser
- Copy it to `ml-model/juansignmodel/juansign_model.pth` on your PC to replace the old weights

> **Free Colab note:** Sessions disconnect after ~1.5 hours of inactivity. Training has early stopping (5-epoch patience) so it usually finishes in time. If it disconnects, re-run from Cell 9 — it will overwrite with the best checkpoint found so far.

---

## Option B: Classmate's Windows PC (Preprocessing Only)

Use this to extract frames from raw video clips on another machine.

### What the classmate needs
- Windows 10 or 11
- Python 3.10 or 3.11 installed ([python.org/downloads](https://www.python.org/downloads/))
  - **Must check "Add Python to PATH"** during installation
- The repo folder (copy via USB, shared drive, or GitHub)
- Raw video files placed in the correct folder (see below)

### Folder structure for raw videos
Before running, the raw `.mp4` clips must be organized like this:
```
Thesis/
  processed_output/
    raw_data/
      A/    ← all .mp4 clips for sign A
      B/    ← all .mp4 clips for sign B
      C/
      G/
      H/
```
Each letter needs at least **102 clips** (90 train + 12 test + rest for validation).

### Run the 1-hit script
1. Open the `Thesis` folder
2. Double-click **`preprocess_classmate.bat`**
3. Follow the on-screen steps — it does everything automatically:
   - Creates a virtual environment
   - Installs all packages (PyTorch, OpenCV, MediaPipe, etc.)
   - Splits videos into train/test/val
   - Extracts 16 frames per clip with hand detection + face blurring

### Output
```
Thesis/
  unprocessed_input/          ← split videos (don't touch)
  processed_output/
    frame_extracted/
      training_data/<letter>/clipXXX/frame0000.jpg ... frame0015.jpg
      testing_data/...
      validation_data/...
  extraction_progress.txt     ← resume file (delete to restart from scratch)
```

### If the script is interrupted
Just double-click `preprocess_classmate.bat` again. The frame extractor automatically resumes from where it left off (skips completed clips).

### If PyTorch CUDA install fails
The script falls back to CPU-only PyTorch. Preprocessing doesn't need a GPU, so this is fine.

---

## Package Versions Reference

| Package | Version |
|---------|---------|
| torch | 2.2.0 |
| torchvision | 0.17.0 |
| opencv-python-headless | 4.9.0.80 |
| mediapipe | 0.10.11 |
| numpy | 1.26.4 |
| Pillow | 10.2.0 |
| matplotlib | 3.8.3 |
| seaborn | 0.13.2 |
| scikit-learn | 1.4.1.post1 |
| tensorboard | 2.16.2 |
