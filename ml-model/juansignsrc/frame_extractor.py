# ml-model/src/frame_extractor.py
#
# JuanSign V2.1 — Dual-Hand & Global Anchor Extraction
#
# Output per clip folder:
#   frame0000.jpg … frame0031.jpg   — multi-hand crop, face-blurred
#   optical_flow.npy                — [32, 2, 224, 224]
#   landmarks.npy                   — [32, 126] (Hand 0 + Hand 1)

import os
import cv2
import numpy as np
from PIL import Image
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ── CONFIG ────────────────────────────────────────────────────────────────────
INPUT_BASE  = "./unprocessed_input/"
OUTPUT_BASE = "./processed_output/frame_extracted"
MODEL_PATH       = "./hand_landmarker.task"
FACE_MODEL_PATH  = "./blaze_face_short_range.tflite"
PROGRESS_FILE    = "./extraction_progress.txt"

# ── CONSTANTS ─────────────────────────────────────────────────────────────────
TARGET_FRAMES     = 32
TARGET_SIZE       = 224
HAND_PADDING      = 60
LANDMARK_FEATURES = 126  # 2 hands × 63 dims
SPLITS = ["training_data", "testing_data", "validation_data"]
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}

# ══════════════════════════════════════════════════════════════════════════════
# SAMPLING & UTILS
# ══════════════════════════════════════════════════════════════════════════════

def _sample_indices(total_frames, n=TARGET_FRAMES):
    """Return exactly n evenly-spaced frame indices from a clip."""
    if total_frames <= 0:
        return [0] * n
    if total_frames <= n:
        indices = list(range(total_frames))
        indices += [total_frames - 1] * (n - total_frames)
        return indices
    return np.linspace(0, total_frames - 1, n, dtype=int).tolist()

def _center_crop(frame_bgr):
    """Square center crop fallback."""
    h, w = frame_bgr.shape[:2]
    side = min(h, w)
    top  = (h - side) // 2
    left = (w - side) // 2
    return frame_bgr[top:top+side, left:left+side]

# ══════════════════════════════════════════════════════════════════════════════
# MEDIAPIPE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _build_face_detector():
    base_options = mp_python.BaseOptions(model_asset_path=FACE_MODEL_PATH)
    options = mp_vision.FaceDetectorOptions(base_options=base_options, min_detection_confidence=0.4)
    return mp_vision.FaceDetector.create_from_options(options)

def _build_hand_detector():
    base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=base_options,
        num_hands=2,
        min_hand_detection_confidence=0.3,
        min_hand_presence_confidence=0.3
    )
    return mp_vision.HandLandmarker.create_from_options(options)

def _anonymize_face(frame_bgr, face_detector):
    """Blurs faces and returns the center of the first detected face as an anchor."""
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = face_detector.detect(mp_image)
    h, w = frame_bgr.shape[:2]
    
    face_center = [0.5, 0.5, 0.0] # Default to screen center

    for i, detection in enumerate(result.detections):
        bb = detection.bounding_box
        x1, y1 = max(0, bb.origin_x), max(0, bb.origin_y)
        x2, y2 = min(w, bb.origin_x + bb.width), min(h, bb.origin_y + bb.height)
        
        if i == 0: # Use primary face as anchor
            face_center = [(x1 + bb.width/2)/w, (y1 + bb.height/2)/h, 0.0]
            
        if x2 > x1 and y2 > y1:
            roi = frame_bgr[y1:y2, x1:x2]
            frame_bgr[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (51, 51), 0)

    return frame_bgr, face_center

def _hand_crop(frame_bgr, hand_detector):
    """Crops a region encompassing ALL detected hands."""
    h, w = frame_bgr.shape[:2]
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    result = hand_detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))

    if not result.hand_landmarks: return None

    xs, ys = [], []
    for hand in result.hand_landmarks:
        for lm in hand:
            xs.append(int(lm.x * w))
            ys.append(int(lm.y * h))

    x1, y1 = max(0, min(xs) - HAND_PADDING), max(0, min(ys) - HAND_PADDING)
    x2, y2 = min(w, max(xs) + HAND_PADDING), min(h, max(ys) + HAND_PADDING)
    return frame_bgr[y1:y2, x1:x2] if x2 > x1 and y2 > y1 else None

# ══════════════════════════════════════════════════════════════════════════════
# OPTICAL FLOW
# ══════════════════════════════════════════════════════════════════════════════

def _compute_optical_flow(frames_bgr):
    """Compute dense optical flow between 32 frames."""
    n = len(frames_bgr)
    flow_array = np.zeros((n, 2, TARGET_SIZE, TARGET_SIZE), dtype=np.float32)
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]
    for i in range(1, n):
        flow = cv2.calcOpticalFlowFarneback(grays[i-1], grays[i], None, 0.5, 3, 15, 3, 5, 1.2, 0)
        flow_array[i, 0], flow_array[i, 1] = flow[:,:,0], flow[:,:,1]
    return flow_array

# ══════════════════════════════════════════════════════════════════════════════
# LANDMARK EXTRACTION
# ══════════════════════════════════════════════════════════════════════════════

def _extract_and_save_landmarks(clip_folder, hand_detector, face_detector):
    """Extracts 126-dim landmarks (Hand 0 + Hand 1)."""
    image_files = sorted([f for f in os.listdir(clip_folder) if f.endswith(".jpg")])
    if not image_files:
        print(f"  [CRITICAL ERROR] No JPEGs found in {clip_folder}.")
        return 

    image_files = image_files[:TARGET_FRAMES]
    landmarks_seq = []

    for fname in image_files:
        img_path = os.path.join(clip_folder, fname)
        frame_bgr = cv2.imread(img_path)
        
        if frame_bgr is None:
            face_center = [0.5, 0.5, 0.0]
            hand_result = None
        else:
            _, face_center = _anonymize_face(frame_bgr, face_detector)
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            hand_result = hand_detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        
        frame_lms = []
        for i in range(2): 
            if hand_result and hand_result.hand_landmarks and len(hand_result.hand_landmarks) > i:
                lm = hand_result.hand_landmarks[i]
                pts = np.array([[p.x, p.y, p.z] for p in lm], dtype=np.float32).flatten()
                frame_lms.extend(pts)
            else:
                anchor = np.tile(face_center, 21).astype(np.float32)
                frame_lms.extend(anchor)
        
        landmarks_seq.append(frame_lms)

    np.save(os.path.join(clip_folder, "landmarks.npy"), np.array(landmarks_seq, dtype=np.float32))

# ══════════════════════════════════════════════════════════════════════════════
# MAIN EXTRACTION ENGINE
# ══════════════════════════════════════════════════════════════════════════════

def extract_and_resize_frames(video_path, output_folder, face_detector, hand_detector):
    """Handles folder creation, frame extraction, flow, and landmarks."""
    os.makedirs(output_folder, exist_ok=True)
    
    if not os.path.exists(output_folder):
        print(f"  [ERROR] Directory failed: {output_folder}")
        return False

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  [ERROR] OpenCV failed to open: {video_path}")
        return False

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = _sample_indices(total_frames)

    extracted_bgr = []
    
    for out_idx, frame_idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()

        if not ret:
            frame_bgr = extracted_bgr[-1].copy() if extracted_bgr else np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8)
        else:
            frame, _ = _anonymize_face(frame, face_detector)
            cropped = _hand_crop(frame, hand_detector)
            
            if cropped is not None:
                frame_bgr = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE))
            else:
                frame_bgr = cv2.resize(_center_crop(frame), (TARGET_SIZE, TARGET_SIZE))

        extracted_bgr.append(frame_bgr)
        frame_path = os.path.join(output_folder, f"frame{out_idx:04d}.jpg")
        cv2.imwrite(frame_path, frame_bgr)

    cap.release()

    # Save Optical Flow
    flow_array = _compute_optical_flow(extracted_bgr)
    np.save(os.path.join(output_folder, "optical_flow.npy"), flow_array)

    # Save Landmarks
    _extract_and_save_landmarks(output_folder, hand_detector, face_detector)

    return True

# ══════════════════════════════════════════════════════════════════════════════
# PROGRESS TRACKING
# ══════════════════════════════════════════════════════════════════════════════

def _load_progress():
    if not os.path.exists(PROGRESS_FILE): return set()
    with open(PROGRESS_FILE, "r") as f:
        return set(line.strip() for line in f if line.strip())

def _mark_done(clip_key):
    with open(PROGRESS_FILE, "a") as f:
        f.write(clip_key + "\n")

def _is_valid_clip_folder(folder_path):
    jpgs = [f for f in os.listdir(folder_path) if f.endswith(".jpg")]
    if len(jpgs) != TARGET_FRAMES: return False
    try:
        flow = np.load(os.path.join(folder_path, "optical_flow.npy"), mmap_mode="r")
        lm   = np.load(os.path.join(folder_path, "landmarks.npy"), mmap_mode="r")
        return flow.shape == (32, 2, 224, 224) and lm.shape == (32, 126)
    except:
        return False

# ══════════════════════════════════════════════════════════════════════════════
# RUNNER
# ══════════════════════════════════════════════════════════════════════════════

def run_extraction():
    completed = _load_progress()
    face_detector = _build_face_detector()
    hand_detector = _build_hand_detector()

    print(f"\n--- Batch Extraction Started (126-dim) ---")

    for split in SPLITS:
        split_input  = os.path.join(INPUT_BASE, split)
        split_output = os.path.join(OUTPUT_BASE, split)
        if not os.path.exists(split_input): continue

        letters = [d for d in os.listdir(split_input) if d in ["A", "B", "C", "D", "E"]]
        
        for letter in sorted(letters):
            letter_in  = os.path.join(split_input, letter)
            letter_out = os.path.join(split_output, letter)
            os.makedirs(letter_out, exist_ok=True)

            videos = [v for v in os.listdir(letter_in) if os.path.splitext(v)[1].lower() in VIDEO_EXTS]
            
            for v_file in sorted(videos):
                clip_name = os.path.splitext(v_file)[0]
                clip_key  = f"{split}/{letter}/{clip_name}"
                out_path  = os.path.join(letter_out, clip_name)

                if clip_key in completed: continue
                if os.path.exists(out_path) and _is_valid_clip_folder(out_path):
                    _mark_done(clip_key)
                    continue

                print(f"  [{letter}] Processing: {clip_name}...")
                success = extract_and_resize_frames(
                    os.path.join(letter_in, v_file),
                    out_path,
                    face_detector,
                    hand_detector
                )
                if success: _mark_done(clip_key)

    print("\n--- Extraction Phase Complete ---")

if __name__ == "__main__":
    run_extraction()