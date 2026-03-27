# Real-Time Model Debugger & Visualizer for JuanSign v2

## Overview

The **Real-Time Model Debugger** is an interactive visualization tool that shows exactly what the ResNetLSTM model "sees" and how it makes predictions as you sign to the webcam in real time.

This tool is essential for:
- **Debugging model behavior**: Understanding why the model predicts what it does
- **Exploring the decision process**: Visualizing which hand parts the model focuses on
- **Developing intuition**: Seeing motion patterns and feature activations
- **Quality assurance**: Validating that preprocessing is correct

---

## What You See: 4-Pane Dashboard

### Layout
```
┌──────────────────┬──────────────────┬────────────┐
│                  │                  │            │
│  Live Feed       │  Model Input     │ Top-5      │
│  + Skeleton      │  (224×224 crop)  │ Scores     │
│                  │                  │            │
├──────────────────┼──────────────────┤            │
│                  │                  │ Bar Chart  │
│  Optical Flow    │  Grad-CAM Heat   │            │
│  (HSV colored)   │  (Layer4 focus)  │            │
│                  │                  │            │
└──────────────────┴──────────────────┴────────────┘
```

### Quadrant Details

#### 1. **Live Feed** (Top Left)
- Raw webcam frame at 640×480
- **Green skeleton**: 21 hand landmarks from MediaPipe
- Shows hand detection quality and skeleton accuracy
- **Use this to**: Verify hand is being detected and skeleton overlay is correct

#### 2. **Model Input** (Top Right)
- The exact 224×224 RGB crop that enters the ResNet18
- Extracted by bounding box around hand landmarks + 60px padding
- **Use this to**: Verify the hand cropping is centered and appropriately scaled
- Dark = good contrast; blurry = motion blur in input

#### 3. **Optical Flow** (Bottom Left)
- Visualization of motion between consecutive frames
- **HSV coloring**:
  - **Hue** (color): Direction of motion (Red=right, Cyan=left, etc.)
  - **Saturation**: Always full (255)
  - **Value** (brightness): Magnitude of motion (bright=fast, dark=slow)
- **Use this to**: Verify the gesture motion is being captured, ensure optical flow is smooth
- Red/cyan vertical lines = hand moving up/down; Green lines = sideways motion

#### 4. **Grad-CAM Heatmap** (Bottom Right)
- Class Activation Map from ResNet18's **Layer 4** (7×7 feature maps)
- Upsampled to 224×224 with **Jet colormap** (blue→green→red = low→high importance)
- Overlaid semi-transparently on the 224×224 hand crop
- **Red "glow"**: Regions the model focuses on for the prediction
- **Use this to**: Understand which fingers/hand parts are most important for the decision
- Correlate red regions with actual sign hand shape

### Side Panel: Top-5 Confidence Scores

- **Before buffer is full (< 32 frames)**: Shows "Waiting for buffer..."
- **After buffer fills**: Displays bar chart with top 5 predicted letters
- Each bar shows: `Letter: 0.XX` confidence
- **Green bar** = confidence > 0.70 (prediction is confident)
- **Orange bar** = confidence ≤ 0.70 (prediction is uncertain)

---

## Usage

### Prerequisites
```bash
# From the juansignsrc/ directory, ensure these are installed:
pip install torch torchvision opencv-python numpy mediapipe
```

### Running the Debugger

```bash
cd ml-model/juansignsrc/
python real_time_debugger.py
```

Expected startup output:
```
[Init] Using device: cuda  (or cpu)
[Init] Webcam opened
[Init] Dashboard window size: 900×720
[Controls] SPACE=start/stop, R=reset, Q=quit
```

### Controls

| Key | Action |
|-----|--------|
| **SPACE** | Start/stop recording (buffering frames) |
| **R** | Reset buffer (clear all frames, start over) |
| **Q** | Quit the application |

### Typical Workflow

1. **Launch** the script
2. **Position** your hand in front of the webcam (Live Feed quadrant)
3. **Press SPACE** to start recording
   - Status: `RECORDING — Buffer: 0/32`
   - Skeleton should overlay on your hand
4. **Hold/sign** for 1-2 seconds (about 30-40 frames at 30 FPS)
5. **Watch the Dashboard**:
   - Model Input: Hand should be centered and 224×224
   - Optical Flow: You should see colored motion lines
   - Grad-CAM: Red glow should appear over relevant fingers
   - Top-5 Scores: Should update with predictions when buffer fills
6. **Press SPACE again** to stop recording (buffer stays full, keeps predicting)
7. **Press R** to clear buffer and try a new sign
8. **Press Q** to quit

---

## Technical Details

### Architecture Integration

The debugger hooks into the ResNetLSTM model:

```
Frames [B, 32, 5, 224, 224]  ──┐
                                ├──→ VisualEncoder (ResNet18)
Landmarks [B, 32, 63]  ────────┤         ↓
                                │   feature_extractor[7] ← Grad-CAM hooks here
                                │   (Layer 4: 7×7×512 features)
                                │
                          LandmarkEncoder
                                │
                          Fusion + BiLSTM
                                │
                            Classifier
                                ↓
                        Predictions [B, num_classes]
```

### 5-Channel Input Preprocessing

Each frame is converted to 5 channels:
1. **Channel 0-2**: RGB (ImageNet normalized)
2. **Channel 3-4**: Optical Flow (Farneback, normalized to [-1, 1])

The Grad-CAM heatmap is computed from **Layer 4** of ResNet18:
- Input to layer4: 256-channel features at 14×14 spatial resolution
- Output of layer4: 512-channel features at 7×7 spatial resolution
- Grad-CAM averages across the 512 channels, weighted by gradient importance

### Real-Time Performance

- **Frame rate**: 20-30 FPS on GPU (depends on inference speed)
- **Latency**: ~100-200ms from capture to prediction
- **Inference time**: ~50-100ms per 32-frame sequence on T4 GPU
- **Model inference is disabled** when buffer is not full (just visualization)

---

## Interpreting the Visualizations

### When Grad-CAM Looks Good
- ✅ Red glow is concentrated over relevant fingers (e.g., for "A", glow over fist)
- ✅ Glow follows the hand's motion trajectory
- ✅ Different letters show different activation patterns

### When Something Looks Wrong

| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| Skeleton is missing/jumpy | Hand not detected or low contrast | Improve lighting, move hand toward camera |
| Model Input crop is off-center | Hand bounding box too small/large | Adjust HAND_PADDING constant (default 60) |
| Optical flow is sparse/missing | Motion too slow or lighting issues | Make faster/larger gestures |
| Grad-CAM is all blue | Model is uncertain (low gradients) | Try a more distinct/clearer gesture |
| Top-5 predictions are all ~0.20 | Model is confused | May indicate ambiguous input or undertrained class |

---

## Configuration

### Adjustable Parameters (in script header)

```python
TARGET_SIZE          = 224           # Hand crop size (must match model training)
HAND_PADDING         = 60            # Extra pixels around hand bbox
FLOW_NORM_SCALE      = 30.0          # Optical flow normalization
CONFIDENCE_THRESHOLD = 0.70          # Green bar threshold in top-5 chart
PANE_SIZE            = 360           # Dashboard quadrant size
CAMERA_INDEX         = 0             # Webcam index (0 = default)
```

### Model Paths

These must point to your trained model and MediaPipe task files:
```python
MODEL_PATH           = "./juansignmodel/juansign_model.pth"
HAND_MODEL_PATH      = "./hand_landmarker.task"
FACE_MODEL_PATH      = "./blaze_face_short_range.tflite"  # (not used in debugger)
```

---

## Troubleshooting

### Error: "Could not initialize MediaPipe hand detector"
**Solution**: Ensure `hand_landmarker.task` exists in the working directory:
```bash
ls -la hand_landmarker.task
```

### Error: "Could not open camera"
**Solution**: 
- Check camera is connected and not in use by another app
- Try changing `CAMERA_INDEX` (e.g., 1 instead of 0)

### Error: "Model loading failed"
**Solution**: Verify checkpoint path:
```bash
ls -la ./juansignmodel/juansign_model.pth
```

### Grad-CAM shows all black/blue
**Causes**:
- Model prediction is very uncertain (gradient=0)
- Only happens on first frame of buffer (normal)
- **Fix**: Complete a full gesture (all 32 frames)

### Predictions are always wrong
**Possible issues**:
- Hand crop is not centered (check Model Input quadrant)
- Gesture is unclear or ambiguous
- Model was trained on different hand position/lighting
- **Fix**: Try clearer/slower gestures; improve lighting

---

## Performance Tips

### Faster Execution
- Use GPU (CUDA): Script auto-detects; verify with `[Init] Using device: cuda`
- Reduce `PANE_SIZE` if rendering is slow (currently 360px)

### Better Visualizations
- Improve lighting (front-facing light source, no shadows)
- Move hand to center of frame for best skeleton detection
- Use slow, deliberate gestures for clear optical flow
- Make signs at roughly arm's length from camera

---

## For Researchers/Developers

### Extending the Debugger

The script is modular. You can easily add:

1. **Save predictions to disk**:
   - Hook `confidence_scores` to write CSV
   - Add frame to output video

2. **Add attention visualizations**:
   - Layer activation heatmaps from other layers
   - Landmark importance using SHAP/LIME

3. **Record training data**:
   - Capture hand crop + landmarks + predictions
   - Build dataset for annotation

### Key Functions

| Function | Purpose |
|----------|---------|
| `RealtimeGradCAM` | Computes Grad-CAM on the fly |
| `detect_hand()` | MediaPipe hand landmark extraction |
| `compute_optical_flow()` | Farneback optical flow |
| `preprocess_frame_5ch()` | Builds 5-channel input tensor |
| `visualize_optical_flow()` | HSV motion visualization |
| `compose_dashboard()` | Stitches 4 panes into single window |

### Adding New Visualizations

Example: Add attention from another ResNet layer

```python
# In RealtimeGradCAM.__init__:
target_layer_2 = model.visual_encoder.feature_extractor[5]  # layer3
self._fwd_hook_2 = target_layer_2.register_forward_hook(...)

# In main loop:
cam_layer3, _ = gradcam_2.compute(...)
# Add to dashboard in new pane
```

---

## Citation & References

This debugger is built for JuanSign v2 research:
- **Model**: ResNetLSTM with dual-stream architecture (visual + geometric)
- **Hand detection**: MediaPipe Hand Landmarker
- **Explainability**: Grad-CAM (Selvaraju et al., 2017)
- **Optical flow**: Farneback algorithm (Farneback, 2003)

---

## License & Acknowledgments

Developed as part of the JuanSign thesis project.
Incorporates open-source libraries: PyTorch, OpenCV, MediaPipe, NumPy.

---

## Questions?

For issues or feature requests, refer to the main JuanSign documentation or modify the script as needed. The code is heavily commented for easy customization.

**Happy debugging! 🎥🤖🟢**
