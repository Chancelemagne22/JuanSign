"""
Real-Time Model Debugger and Visualizer for JuanSign v2

A multi-pane interactive visualization tool that shows the ResNetLSTM model's 
decision-making process in real time as you sign to the webcam.

Features:
  • Quadrant 1: Live webcam feed with MediaPipe hand skeleton
  • Quadrant 2: 224×224 hand-cropped RGB image (model input)
  • Quadrant 3: Optical flow visualization (HSV coloring)
  • Quadrant 4: Grad-CAM heatmap overlay (VisualEncoder.feature_extractor[7])
  • Side panel: Top-5 confidence scores bar chart

Controls:
  SPACE  → Start/stop recording
  R      → Reset buffer
  Q      → Quit

Usage (from juansignsrc/):
  python real_time_debugger.py
"""

import os
import sys
import time
from collections import deque

import cv2
import numpy as np
import torch
import torch.nn as nn
from typing import Optional, Tuple, List

from resnet_lstm_architecture import ResNetLSTM, TARGET_FRAMES, LANDMARK_FEATURE

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

MODEL_PATH           = "./juansignmodel/juansign_model.pth"
HAND_MODEL_PATH      = "./hand_landmarker.task"
FACE_MODEL_PATH      = "./blaze_face_short_range.tflite"

TARGET_SIZE          = 224
HAND_PADDING         = 60
FLOW_NORM_SCALE      = 30.0
WINDOW_STRIDE        = 8
CONFIDENCE_THRESHOLD = 0.70
IMAGENET_MEAN        = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD         = np.array([0.229, 0.224, 0.225], dtype=np.float32)

CAMERA_INDEX         = 0
OUTPUT_FPS           = 20

# Window dimensions (for 4-pane layout + side panel)
PANE_SIZE            = 360  # Each quadrant is 360×360
SIDE_PANEL_WIDTH     = 180
WINDOW_HEIGHT        = PANE_SIZE * 2
WINDOW_WIDTH         = PANE_SIZE * 2 + SIDE_PANEL_WIDTH

# Hand skeleton connections (21 landmarks from MediaPipe)
HAND_CONNECTIONS = [
    (0,1),(1,2),(2,3),(3,4),
    (0,5),(5,6),(6,7),(7,8),
    (0,9),(9,10),(10,11),(11,12),
    (0,13),(13,14),(14,15),(15,16),
    (0,17),(17,18),(18,19),(19,20),
    (5,9),(9,13),(13,17),
]

KEY_SPACE = 32
KEY_R = ord("r")
KEY_Q = ord("q")

# ══════════════════════════════════════════════════════════════════════════════
# GRAD-CAM IMPLEMENTATION (Real-time compatible)
# ══════════════════════════════════════════════════════════════════════════════

class RealtimeGradCAM:
    """
    Lightweight Grad-CAM implementation for real-time inference.
    Targets visual_encoder.feature_extractor[7] (ResNet18's layer4).
    """

    def __init__(self, model):
        self.model = model
        self._activations = None
        self._gradients = None
        
        target_layer = model.visual_encoder.feature_extractor[7]
        self._fwd_hook = target_layer.register_forward_hook(self._save_activation)
        self._bwd_hook = target_layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(self, module, input, output):
        self._activations = output.detach()

    def _save_gradient(self, module, grad_input, grad_output):
        self._gradients = grad_output[0].detach()

    def compute(self, frames, landmarks, class_idx=None):
        """
        Compute Grad-CAM for a single frame sequence.
        
        Args:
            frames: [1, 32, 5, 224, 224] on correct device
            landmarks: [1, 32, 63] on correct device
            class_idx: target class index (uses predicted if None)
        
        Returns:
            cam: [7, 7] numpy array in [0, 1], averaged over 32 frames
            class_idx: predicted or specified class index
        """
        self.model.eval()
        
        output = self.model(frames, landmarks)
        
        if class_idx is None:
            class_idx = output.argmax(dim=1).item()
        
        self.model.zero_grad()
        output[0, class_idx].backward()
        
        gradients = self._gradients  # [32, 512, 7, 7]
        activations = self._activations  # [32, 512, 7, 7]
        
        # Global average pool gradients over spatial dims
        weights = gradients.mean(dim=(2, 3), keepdim=True)  # [32, 512, 1, 1]
        
        # Weighted sum → average over 32 frames
        cam = (weights * activations).sum(dim=1)  # [32, 7, 7]
        cam = cam.mean(dim=0)  # [7, 7]
        
        cam = torch.relu(cam).cpu().numpy()
        
        if cam.max() > 0:
            cam = cam / cam.max()
        
        return cam, class_idx

    def remove_hooks(self):
        self._fwd_hook.remove()
        self._bwd_hook.remove()


# ══════════════════════════════════════════════════════════════════════════════
# MODEL UTILITIES
# ══════════════════════════════════════════════════════════════════════════════

def load_model(device):
    """Load ResNetLSTM from checkpoint, returning model and class names."""
    checkpoint = torch.load(MODEL_PATH, map_location=device, weights_only=False)
    class_names = checkpoint["class_names"]
    num_classes = checkpoint["num_classes"]
    
    model = ResNetLSTM(num_classes=num_classes).to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    
    print(f"[Model] Loaded — {num_classes} classes: {class_names}")
    return model, class_names, num_classes


# ══════════════════════════════════════════════════════════════════════════════
# MEDIAPIPE HAND DETECTION
# ══════════════════════════════════════════════════════════════════════════════

def build_mediapipe():
    """Initialize MediaPipe hand detector."""
    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision
        
        hand_opts = mp_vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=HAND_MODEL_PATH),
            num_hands=1,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        detector = mp_vision.HandLandmarker.create_from_options(hand_opts)
        return detector, mp
    except Exception as e:
        print(f"[Error] Failed to load MediaPipe: {e}")
        return None, None


def detect_hand(detector, frame_rgb, mp):
    """
    Detect hand landmarks in frame.
    
    Returns:
        landmarks: [21, 3] numpy array (x, y, z) or None if not detected
        hand_rect: (x_min, y_min, x_max, y_max) or None
    """
    if detector is None or mp is None:
        return None, None
    
    h, w = frame_rgb.shape[:2]
    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=frame_rgb
    )
    
    result = detector.detect(mp_image)
    
    if not result.hand_landmarks:
        return None, None
    
    landmarks = result.hand_landmarks[0]
    lm_array = np.array([(lm.x, lm.y, lm.z) for lm in landmarks], dtype=np.float32)
    
    xs = lm_array[:, 0] * w
    ys = lm_array[:, 1] * h
    
    x_min = int(max(0, xs.min() - HAND_PADDING))
    y_min = int(max(0, ys.min() - HAND_PADDING))
    x_max = int(min(w, xs.max() + HAND_PADDING))
    y_max = int(min(h, ys.max() + HAND_PADDING))
    
    hand_rect = (x_min, y_min, x_max, y_max)
    
    return lm_array, hand_rect


def draw_hand_skeleton(frame, landmarks, color=(0, 255, 0), thickness=2):
    """Draw hand skeleton on frame."""
    if landmarks is None:
        return frame
    
    h, w = frame.shape[:2]
    
    # Draw connections
    for start_idx, end_idx in HAND_CONNECTIONS:
        start = landmarks[start_idx]
        end = landmarks[end_idx]
        
        start_pt = (int(start[0] * w), int(start[1] * h))
        end_pt = (int(end[0] * w), int(end[1] * h))
        
        cv2.line(frame, start_pt, end_pt, color, thickness)
    
    # Draw landmarks
    for lm in landmarks:
        pt = (int(lm[0] * w), int(lm[1] * h))
        cv2.circle(frame, pt, 3, (255, 0, 0), -1)
    
    return frame


# ══════════════════════════════════════════════════════════════════════════════
# FRAME PROCESSING & PREPROCESSING
# ══════════════════════════════════════════════════════════════════════════════

def crop_hand(frame, hand_rect):
    """
    Crop hand region from frame and resize to 224×224.
    
    Returns:
        cropped: [224, 224, 3] uint8 BGR image
        or None if rect is invalid
    """
    if hand_rect is None:
        return None
    
    x_min, y_min, x_max, y_max = hand_rect
    
    # Ensure rect is valid
    if x_min >= x_max or y_min >= y_max:
        return None
    
    cropped = frame[y_min:y_max, x_min:x_max]
    
    if cropped.size == 0:
        return None
    
    cropped = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE))
    return cropped


def compute_optical_flow(prev_gray, curr_gray):
    """
    Compute optical flow between two frames.
    
    Returns:
        flow: [H, W, 2] numpy array with (u, v) motion vectors
    """
    flow = cv2.calcOpticalFlowFarneback(
        prev_gray, curr_gray,
        flow=None,
        pyr_scale=0.5,
        levels=3,
        winsize=15,
        iterations=3,
        poly_n=5,
        poly_sigma=1.2,
        flags=0
    )
    return flow


def visualize_optical_flow(flow):
    """
    Convert optical flow to HSV visualization.
    
    Returns:
        flow_vis: [H, W, 3] uint8 BGR image
    """
    h, w = flow.shape[:2]
    
    fx, fy = flow[:, :, 0], flow[:, :, 1]
    
    rad = np.sqrt(fx**2 + fy**2)
    rad_max = np.max(rad) if rad.max() > 0 else 1.0
    
    u8 = np.uint8(255 * rad / rad_max)
    
    angle = np.arctan2(-fy, -fx) / np.pi
    hsv = np.dstack((
        np.uint8(180 * (angle + 1) / 2),
        np.full((h, w), 255, dtype=np.uint8),
        u8
    ))
    
    flow_vis = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    return flow_vis


def preprocess_frame_5ch(frame_bgr, flow, landmarks):
    """
    Preprocess frame into 5-channel tensor: RGB + 2 optical flow.
    
    Args:
        frame_bgr: [224, 224, 3] uint8 BGR
        flow: [224, 224, 2] float32 optical flow
        landmarks: [63] float32 normalized landmarks
    
    Returns:
        frame_tensor: [5, 224, 224] float32 normalized
        landmark_tensor: [63] float32
    """
    # RGB → float32, normalize
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD
    rgb_t = torch.from_numpy(rgb).permute(2, 0, 1)  # [3, 224, 224]
    
    # Optical flow → normalize to [-1, 1]
    flow_t = torch.from_numpy(flow).float() / FLOW_NORM_SCALE
    flow_t = torch.clamp(flow_t, -1.0, 1.0).permute(2, 0, 1)  # [2, 224, 224]
    
    # Combine channels
    frame_tensor = torch.cat([rgb_t, flow_t], dim=0)  # [5, 224, 224]
    
    landmark_tensor = torch.from_numpy(landmarks).float()  # [63]
    
    return frame_tensor, landmark_tensor


def normalize_landmarks(landmarks_abs, frame_shape):
    """
    Normalize absolute (x, y, z) coordinates to frame space.
    
    Args:
        landmarks_abs: [21, 3] with x, y in pixels (or normalized), z in [0, 1]
        frame_shape: (H, W, C)
    
    Returns:
        [63] normalized landmark vector
    """
    h, w = frame_shape[:2]
    
    # Normalize x, y to frame dimensions
    lm_norm = landmarks_abs.copy()
    lm_norm[:, 0] = landmarks_abs[:, 0] / w  # x
    lm_norm[:, 1] = landmarks_abs[:, 1] / h  # y
    # z already in [0, 1]
    
    return lm_norm.flatten()


# ══════════════════════════════════════════════════════════════════════════════
# VISUALIZATION
# ══════════════════════════════════════════════════════════════════════════════

def apply_gradcam_overlay(image, cam_7x7, alpha=0.5):
    """
    Resize 7×7 Grad-CAM to 224×224 and overlay on image with Jet colormap.
    
    Args:
        image: [224, 224, 3] uint8 BGR
        cam_7x7: [7, 7] float32 in [0, 1]
        alpha: blend factor
    
    Returns:
        overlaid: [224, 224, 3] uint8 BGR
    """
    # Resize CAM to 224×224
    cam_224 = cv2.resize(cam_7x7, (224, 224))
    cam_224 = np.uint8(255 * cam_224)
    
    # Apply Jet colormap
    heatmap = cv2.applyColorMap(cam_224, cv2.COLORMAP_JET)
    
    # Blend with original image
    overlaid = cv2.addWeighted(image, 1 - alpha, heatmap, alpha, 0)
    
    return overlaid


def draw_confidence_bars(class_names, confidence_scores, height=WINDOW_HEIGHT, width=SIDE_PANEL_WIDTH):
    """
    Draw top-5 confidence scores as a bar chart.
    
    Returns:
        panel: [height, width, 3] uint8 BGR image
    """
    panel = np.full((height, width, 3), 255, dtype=np.uint8)
    
    if confidence_scores is None:
        # Show "Waiting for buffer..." message
        cv2.putText(panel, "Waiting for", (5, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
        cv2.putText(panel, "buffer...", (5, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
        return panel
    
    # Get top 5
    top_indices = np.argsort(-confidence_scores)[:5]
    top_scores = confidence_scores[top_indices]
    top_names = [class_names[i] for i in top_indices]
    
    bar_height = (height - 20) // 5
    start_y = 10
    
    for i, (idx, score, name) in enumerate(zip(top_indices, top_scores, top_names)):
        y = start_y + i * bar_height
        
        # Draw bar
        bar_width = int(150 * score)
        color = (0, 255, 0) if score > CONFIDENCE_THRESHOLD else (0, 165, 255)
        cv2.rectangle(panel, (10, y), (10 + bar_width, y + 20), color, -1)
        
        # Draw text
        label = f"{name}: {score:.2f}"
        cv2.putText(panel, label, (10, y + 15), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (0, 0, 0), 1)
    
    return panel


def compose_dashboard(frame_rgb, cropped_rgb, flow_viz, cam_overlaid, 
                     confidence_scores, class_names):
    """
    Compose 4-pane dashboard + side panel into single window.
    
    Returns:
        dashboard: [WINDOW_HEIGHT, WINDOW_WIDTH, 3] uint8 BGR
    """
    dashboard = np.full((WINDOW_HEIGHT, WINDOW_WIDTH, 3), 200, dtype=np.uint8)
    
    # Resize panes to PANE_SIZE × PANE_SIZE
    frame_rgb_resized = cv2.resize(frame_rgb, (PANE_SIZE, PANE_SIZE))
    cropped_resized = cv2.resize(cropped_rgb, (PANE_SIZE, PANE_SIZE))
    flow_resized = cv2.resize(flow_viz, (PANE_SIZE, PANE_SIZE))
    cam_resized = cv2.resize(cam_overlaid, (PANE_SIZE, PANE_SIZE))
    
    # Convert RGB to BGR for display
    frame_bgr = cv2.cvtColor(frame_rgb_resized, cv2.COLOR_RGB2BGR)
    cropped_bgr = cv2.cvtColor(cropped_resized, cv2.COLOR_RGB2BGR)
    cam_bgr = cv2.cvtColor(cam_resized, cv2.COLOR_RGB2BGR)
    
    # Place quadrants
    dashboard[0:PANE_SIZE, 0:PANE_SIZE] = frame_bgr
    dashboard[0:PANE_SIZE, PANE_SIZE:PANE_SIZE*2] = cropped_bgr
    dashboard[PANE_SIZE:PANE_SIZE*2, 0:PANE_SIZE] = flow_resized
    dashboard[PANE_SIZE:PANE_SIZE*2, PANE_SIZE:PANE_SIZE*2] = cam_bgr
    
    # Add labels
    cv2.putText(dashboard, "Live Feed", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(dashboard, "Model Input", (PANE_SIZE + 10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(dashboard, "Optical Flow", (10, PANE_SIZE + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    cv2.putText(dashboard, "Grad-CAM", (PANE_SIZE + 10, PANE_SIZE + 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    
    # Draw confidence panel
    confidence_panel = draw_confidence_bars(class_names, confidence_scores)
    dashboard[:, PANE_SIZE*2:] = confidence_panel
    
    return dashboard


# ══════════════════════════════════════════════════════════════════════════════
# MAIN DEBUGGER LOOP
# ══════════════════════════════════════════════════════════════════════════════

def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[Init] Using device: {device}")
    
    # Load model
    model, class_names, num_classes = load_model(device)
    gradcam = RealtimeGradCAM(model)
    
    # Initialize MediaPipe
    detector, mp = build_mediapipe()
    if detector is None:
        print("[Error] Could not initialize MediaPipe hand detector")
        return
    
    # Open webcam
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"[Error] Could not open camera {CAMERA_INDEX}")
        return
    
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    
    print("[Init] Webcam opened")
    print(f"[Init] Dashboard window size: {WINDOW_WIDTH}×{WINDOW_HEIGHT}")
    print("[Controls] SPACE=start/stop, R=reset, Q=quit")
    
    # State
    frame_buffer = deque(maxlen=TARGET_FRAMES)
    landmarks_buffer = deque(maxlen=TARGET_FRAMES)
    prev_gray = None
    recording = False
    confidence_scores = None
    last_prediction_idx = None
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("[Error] Failed to read frame")
                break
            
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            h, w = frame.shape[:2]
            
            # Detect hand
            landmarks, hand_rect = detect_hand(detector, frame_rgb, mp)
            
            # Draw skeleton on live feed
            frame_display = frame_rgb.copy()
            frame_display = draw_hand_skeleton(frame_display, landmarks)
            
            # Prepare visualization frames
            cropped_bgr = None
            flow_viz = None
            cam_overlaid = None
            
            if recording and landmarks is not None:
                # Crop hand region
                cropped_bgr = crop_hand(frame, hand_rect)
                
                if cropped_bgr is not None:
                    cropped_rgb = cv2.cvtColor(cropped_bgr, cv2.COLOR_BGR2RGB)
                    
                    # Compute optical flow
                    if prev_gray is not None:
                        flow_crop = compute_optical_flow(prev_gray, frame_gray)
                        # Only use flow in cropped region
                        if hand_rect is not None:
                            x_min, y_min, x_max, y_max = hand_rect
                            flow_region = flow_crop[y_min:y_max, x_min:x_max]
                            flow_crop = cv2.resize(flow_region, (TARGET_SIZE, TARGET_SIZE))
                        else:
                            flow_crop = cv2.resize(flow_crop, (TARGET_SIZE, TARGET_SIZE))
                    else:
                        flow_crop = np.zeros((TARGET_SIZE, TARGET_SIZE, 2), dtype=np.float32)
                    
                    flow_viz = visualize_optical_flow(flow_crop)
                    
                    # Normalize landmarks to frame space
                    lm_norm = normalize_landmarks(landmarks, (h, w))
                    
                    # Preprocess frame
                    frame_tensor, landmark_tensor = preprocess_frame_5ch(
                        cropped_bgr, flow_crop, lm_norm
                    )
                    
                    # Add to buffer
                    frame_buffer.append(frame_tensor)
                    landmarks_buffer.append(landmark_tensor)
                    
                    # Run inference when buffer is full
                    if len(frame_buffer) == TARGET_FRAMES:
                        frames_batch = torch.stack(list(frame_buffer)).unsqueeze(0).to(device)
                        landmarks_batch = torch.stack(list(landmarks_buffer)).unsqueeze(0).to(device)
                        
                        with torch.no_grad():
                            logits = model(frames_batch, landmarks_batch)
                        
                        confidence_scores = torch.softmax(logits, dim=1)[0].cpu().numpy()
                        last_prediction_idx = logits.argmax(dim=1).item()
                        
                        # Compute Grad-CAM
                        try:
                            cam_7x7, _ = gradcam.compute(frames_batch, landmarks_batch, last_prediction_idx)
                            cam_overlaid_bgr = apply_gradcam_overlay(cropped_bgr, cam_7x7, alpha=0.5)
                            cam_overlaid = cv2.cvtColor(cam_overlaid_bgr, cv2.COLOR_BGR2RGB)
                        except Exception as e:
                            print(f"[Grad-CAM Error] {e}")
                            cam_overlaid = cropped_rgb
                    else:
                        cam_overlaid = cropped_rgb
                    
                    prev_gray = frame_gray
            
            # Fallback for missing components
            if cropped_bgr is None:
                cropped_rgb = np.full((TARGET_SIZE, TARGET_SIZE, 3), 128, dtype=np.uint8)
            else:
                cropped_rgb = cv2.cvtColor(cropped_bgr, cv2.COLOR_BGR2RGB)
            
            if flow_viz is None:
                flow_viz = np.full((TARGET_SIZE, TARGET_SIZE, 3), 128, dtype=np.uint8)
            
            if cam_overlaid is None:
                cam_overlaid = cropped_rgb.copy()
            
            # Compose dashboard
            dashboard = compose_dashboard(
                frame_display, cropped_rgb, flow_viz, cam_overlaid,
                confidence_scores, class_names
            )
            
            # Display
            cv2.imshow("JuanSign Real-Time Debugger", dashboard)
            
            # Handle keyboard
            key = cv2.waitKey(1) & 0xFF
            
            if key == KEY_SPACE:
                recording = not recording
                status = "RECORDING" if recording else "PAUSED"
                print(f"[Status] {status} — Buffer: {len(frame_buffer)}/{TARGET_FRAMES}")
            
            elif key == KEY_R:
                frame_buffer.clear()
                landmarks_buffer.clear()
                confidence_scores = None
                prev_gray = None
                recording = False
                print("[Status] Buffer reset")
            
            elif key == KEY_Q:
                print("[Exit] Quitting...")
                break
    
    finally:
        cap.release()
        cv2.destroyAllWindows()
        gradcam.remove_hooks()
        print("[Exit] Cleanup complete")


if __name__ == "__main__":
    main()
