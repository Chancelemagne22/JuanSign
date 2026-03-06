# Architectural Patterns

Patterns observed across multiple files in the JuanSign ML pipeline.

---

## 1. Device-Agnostic Execution

Every script that runs the model follows the same three-step device pattern. Never hardcode `"cuda"` or `"cpu"`.

- `train.py:13` — `device = torch.device("cuda" if torch.cuda.is_available() else "cpu")`
- `model.py:5`, `predict_sign.py:9`, `model_visualization.py:30` — same one-liner
- `predict_sign.py:14`, `model_visualization.py:48` — `map_location=device` on every `torch.load()` call

---

## 2. Model Load Pattern

Inference always reconstructs the architecture shell before loading weights. The architecture class and `num_classes` must match exactly what was used during training.

```
ResNetLSTM(num_classes=5)          # reconstruct shell
model.load_state_dict(torch.load(path, map_location=device))
model.to(device)
model.eval()
```

- `model.py:9–15`
- `predict_sign.py:12–15`
- `model_visualization.py:40,48–49`

---

## 3. Inference Guard (eval + no_grad)

All prediction and evaluation code wraps the forward pass with both `model.eval()` and `torch.no_grad()`. These always appear together — one without the other is a bug.

- `train.py:71–84` — `evaluate_model()` function
- `predict_sign.py:15,43–47`
- `model_visualization.py:49,58–65`
- `confidence_prediction.py:3,7–9`
- `confusionmatix.py:6,10–16`
- `fc_cluster.py:5,10–23`
- `layer_visualization.py:4,14–19`

---

## 4. Collate Function for Variable-Length Clips

`DataLoader` uses a custom `collate_fn` to pad clips to the longest sequence in the batch. This pattern is duplicated in both training and evaluation — if changed in one place, update the other.

- `train.py:17–29`
- `model_visualization.py:14–26`

Both are identical: unzip batch → `pad_sequence(..., batch_first=True, padding_value=0)` → `torch.tensor(labels)`.

---

## 5. Softmax Probability Extraction

Logits are converted to probabilities via `softmax`, then `torch.max` extracts the prediction. This pattern appears in every file that reports a confidence score.

- `predict_sign.py:46–47`
- `confidence_prediction.py:9`

---

## 6. Hardcoded Constants (No Central Config)

Several constants are replicated across files rather than imported from a shared config. When changing any of these, update **all** listed locations:

| Constant | Value | Files |
|---|---|---|
| Frame count | `16` | `frame_extractor.py:8` (`TARGET_FRAMES`), `predict_sign.py:28` |
| Image size | `224` | `frame_extractor.py:9` (`TARGET_SIZE`), `predict_sign.py:20`, `fsl_dataset.py` transforms |
| Num classes | `5` | `train.py:54`, `model.py:9`, `predict_sign.py:60`, `model_visualization.py:40` |
| Class list | `["A","B","C","G","H"]` | `predict_sign.py:60`, `model_visualization.py:36` |
| ImageNet mean/std | `[0.485,0.456,0.406]` / `[0.229,0.224,0.225]` | `fsl_dataset.py:14`, `predict_sign.py:22` |

Class-to-index mapping is determined by `sorted(os.listdir(root_dir))` in `fsl_dataset.py:17`. The class list in inference scripts **must** match this alphabetical order.

---

## 7. Visualization as Standalone Scripts

Every analysis tool (confusion matrix, t-SNE, feature maps, training curves) is a standalone script with its own `if __name__ == "__main__"` block. None are importable utilities. They share the same dependency chain: import `ResNetLSTM` and `FSLDataset`, load the saved `.pth` weights, run inference, plot.

- `confusionmatix.py`, `model_visualization.py` — confusion matrix via `sklearn` + `seaborn.heatmap`
- `fc_cluster.py` — t-SNE on FC layer activations
- `layer_visualization.py` — ResNet intermediate feature maps
- `train_val_visuals.py` — loss/accuracy curves from `history` dict
- `confidence_prediction.py` — per-class probability bars

---

## 8. FSLDataset Folder Contract

`FSLDataset` (`fsl_dataset.py:7–41`) expects exactly this layout:

```
root_dir/
  <class_label>/       ← directory name becomes the class label
    clip001/
      frame0000.jpg
      frame0001.jpg
      ...
```

The `frame_extractor.py` output must conform to this structure. Augmentation (ColorJitter, RandomRotation) is applied at dataset construction time, not in the training loop — inference scripts use a separate `inference_transform` with no augmentation (`predict_sign.py:19–23`).

---

## 9. Module Dependency Hierarchy

`resnet_lstm_architecture.py` and `fsl_dataset.py` are the base modules. All other scripts import from them; they never import from each other. No circular imports.

```
resnet_lstm_architecture.py  ←─ train.py
fsl_dataset.py               ←─ train.py
                             ←─ model_visualization.py
                             ←─ confidence_prediction.py
                             ←─ confusionmatix.py
                             ←─ fc_cluster.py
                             ←─ layer_visualization.py
gradcam.py                   ←─ forward_pass_viz.py
                             ←─ realtime_gradcam.py
```

---

## 10. Real-Time Inference Pattern (`realtime_gradcam.py`)

Two-thread design: main thread handles capture + display; a daemon `InferenceWorker` handles model inference.

- **Buffer**: `collections.deque(maxlen=16)` — rolling window of raw BGR webcam frames.
- **Two forward passes per inference cycle**:
  1. `torch.no_grad()` pass → softmax probabilities + predicted class index.
  2. `gradcam.compute(clip, class_idx=class_idx)` pass → spatial heatmap (forward + backward).
  Both target the same `class_idx` so they are consistent.  The second pass overwrites the GradCAM hooks' cached activations/gradients, so they always reflect the gradient-enabled computation graph.
- **Throttle**: `INFERENCE_INTERVAL = 0.5 s` sleep between inference runs to avoid saturating GPU/CPU.
- **Display**: two 480×480 panels — live feed (left) + Grad-CAM overlay + prob bars (right).
- **Controls**: `q` quit, `r` reset buffer, `s` save PNG to `../realtime_captures/`.
