# ml-model/src/frame_extractor.py
#
# JuanSign V2.2 — Dual-Hand & Global Anchor Extraction
# Modal & Local Hybrid (matches train_main.py pattern)
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

# ── CONFIG (HYBRID PATHING) ──────────────────────────────────────────────────
# If "MODAL_RUN" is in environment, use Volume paths. Otherwise, use local.
IS_MODAL = "MODAL_RUN" in os.environ

if IS_MODAL:
    # All raw videos live in the Volume
    INPUT_BASE     = "/data/unprocessed_input/"
    OUTPUT_BASE    = "/data/processed_output/frame_extracted"
    PROGRESS_FILE  = "/data/extraction_progress.txt"
    # MediaPipe model files are mounted from your local dir → /root
    MODEL_PATH     = "/root/hand_landmarker.task"
    FACE_MODEL_PATH = "/root/blaze_face_short_range.tflite"
else:
    INPUT_BASE     = "./unprocessed_input/"
    OUTPUT_BASE    = "./processed_output/frame_extracted"
    PROGRESS_FILE  = "./extraction_progress.txt"
    MODEL_PATH     = "./hand_landmarker.task"
    FACE_MODEL_PATH = "./blaze_face_short_range.tflite"

# ── CONSTANTS ─────────────────────────────────────────────────────────────────
# JUANSIGN_FRAMES allows a 16/24-frame ablation without touching 3 files.
# NOTE: if changed, update fsl_datasets/cache/model TARGET_FRAMES to match.
TARGET_FRAMES     = int(os.environ.get("JUANSIGN_FRAMES", "32"))
TARGET_SIZE       = 224
HAND_PADDING      = 50
LANDMARK_FEATURES = 126  # 2 hands × 63 dims
# Flow backend: "farneback" (default, exact) or "dis" (~3x faster, thesis ablation).
FLOW_BACKEND      = os.environ.get("JUANSIGN_FLOW", "farneback").lower()
# Compute flow at this size then upsample to 224 (112 ≈ 4x faster, same contract).
FLOW_COMPUTE_SIZE = int(os.environ.get("JUANSIGN_FLOW_SIZE", "224"))
# Detection is scale-invariant: detect on downscaled copy, crop full-res.
DET_MAX_SIDE      = int(os.environ.get("JUANSIGN_DET_SIZE", "480"))
SPLITS = ["training", "testing", "validation"]
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
    
    face_center = [0.5, 0.5, 0.0]  # Default to screen center

    for i, detection in enumerate(result.detections):
        bb = detection.bounding_box
        x1, y1 = max(0, bb.origin_x), max(0, bb.origin_y)
        x2, y2 = min(w, bb.origin_x + bb.width), min(h, bb.origin_y + bb.height)
        
        if i == 0:  # Use primary face as anchor
            face_center = [(x1 + bb.width/2)/w, (y1 + bb.height/2)/h, 0.0]
            
        if x2 > x1 and y2 > y1:
            roi = frame_bgr[y1:y2, x1:x2]
            frame_bgr[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (51, 51), 0)

    return frame_bgr, face_center

def _det_resize(frame_bgr):
    """Downscale for detection only (bbox scaled back to full-res)."""
    h, w = frame_bgr.shape[:2]
    m = max(h, w)
    if m <= DET_MAX_SIDE:
        return frame_bgr, 1.0
    s = DET_MAX_SIDE / m
    return cv2.resize(frame_bgr, (int(w * s), int(h * s))), s


def _hand_crop(frame_bgr, hand_detector):
    """Crops a region encompassing ALL detected hands.

    Detection runs on a downscaled copy (DET_MAX_SIDE) for speed; the bbox
    is scaled back to full-res so the 224 crop is unchanged.
    """
    h, w = frame_bgr.shape[:2]
    small, s = _det_resize(frame_bgr)
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    result = hand_detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))

    if not result.hand_landmarks: return None

    xs, ys = [], []
    for hand in result.hand_landmarks:
        for lm in hand:
            xs.append(int(lm.x * small.shape[1] / s))
            ys.append(int(lm.y * small.shape[0] / s))

    x1, y1 = max(0, min(xs) - HAND_PADDING), max(0, min(ys) - HAND_PADDING)
    x2, y2 = min(w, max(xs) + HAND_PADDING), min(h, max(ys) + HAND_PADDING)
    return frame_bgr[y1:y2, x1:x2] if x2 > x1 and y2 > y1 else None

# ══════════════════════════════════════════════════════════════════════════════
# OPTICAL FLOW
# ══════════════════════════════════════════════════════════════════════════════

def _flow_pair(g0, g1):
    if FLOW_BACKEND == "dis":
        dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)
        return dis.calc(g0, g1, None)
    return cv2.calcOpticalFlowFarneback(g0, g1, None, 0.5, 3, 15, 3, 5, 1.2, 0)


def _compute_optical_flow(frames_bgr, dup_mask=None):
    """Dense flow between sampled frames. Same [T,2,224,224] contract.

    - FLOW_COMPUTE_SIZE<224: compute small then upsample (motion scales linearly).
    - dup_mask[i]=True: frame i is a fallback duplicate of i-1 → zeros, no compute.
    - JUANSIGN_FLOW=dis: DIS flow (~3x faster) for ablation.
    """
    n = len(frames_bgr)
    flow_array = np.zeros((n, 2, TARGET_SIZE, TARGET_SIZE), dtype=np.float32)
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]
    cs = FLOW_COMPUTE_SIZE if FLOW_COMPUTE_SIZE in (112, 224) else 224
    for i in range(1, n):
        if dup_mask is not None and dup_mask[i]:
            continue  # identical frames → flow stays zero
        if cs == TARGET_SIZE:
            flow = _flow_pair(grays[i-1], grays[i])
            flow_array[i, 0], flow_array[i, 1] = flow[:, :, 0], flow[:, :, 1]
        else:
            g0 = cv2.resize(grays[i-1], (cs, cs))
            g1 = cv2.resize(grays[i], (cs, cs))
            flow = _flow_pair(g0, g1)
            k = TARGET_SIZE / cs
            flow = cv2.resize(flow, (TARGET_SIZE, TARGET_SIZE)) * k
            flow_array[i, 0], flow_array[i, 1] = flow[:, :, 0], flow[:, :, 1]
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

def _landmarks_for_crop(frame_resized, face_center, hand_detector):
    """126-D landmarks for a 224 crop (reuses face-center anchor on miss)."""
    rgb = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2RGB)
    res = hand_detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    current_lms = []
    for i in range(2):
        if res.hand_landmarks and len(res.hand_landmarks) > i:
            pts = np.array([[p.x, p.y, p.z] for p in res.hand_landmarks[i]]).flatten()
            current_lms.extend(pts)
        else:
            current_lms.extend(np.tile(face_center, 21))
    return np.array(current_lms, dtype=np.float32)


def _get_first_valid_frame(sampled, face_detector, hand_detector):
    """Pre-scan in-memory samples for the first frame with a hand."""
    for frame in sampled:
        frame_anonymized, face_center = _anonymize_face(frame, face_detector)
        cropped = _hand_crop(frame_anonymized, hand_detector)
        if cropped is not None:
            frame_resized = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE))
            lms = _landmarks_for_crop(frame_resized, face_center, hand_detector)
            return frame_resized, lms
    return None, None


def _read_all_frames(video_path):
    """Sequential decode (no per-frame seeks — H.264 seeks are expensive)."""
    cap = cv2.VideoCapture(video_path)
    frames = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    return frames


def extract_and_resize_frames(video_path, output_folder, face_detector, hand_detector):
    os.makedirs(output_folder, exist_ok=True)
    # Sequential read once, then linspace-pick (pad-last for short clips).
    all_frames = _read_all_frames(video_path)
    total_frames = len(all_frames)
    indices = _sample_indices(total_frames, TARGET_FRAMES)
    sampled = [all_frames[i] if 0 <= i < total_frames else all_frames[-1]
               for i in indices] if total_frames else []

    extracted_bgr = []
    landmarks_list = []
    dup_mask = []  # True where output repeats previous frame (flow=0 shortcut)

    # PRE-SCAN: Find first valid frame to use as initial fallback
    last_valid_frame, last_valid_lms = _get_first_valid_frame(
        sampled, face_detector, hand_detector
    )

    if last_valid_frame is None:
        print(f"  [WARNING] No hand detected in entire clip: {video_path}")

    for out_idx, frame in enumerate(sampled):
        # 1. Handle Video Read Failure
        read_failed = frame is None
        if read_failed:
            if last_valid_frame is not None:
                frame = last_valid_frame.copy()
            else:
                frame = np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8)

        # 2. Process Face & Hand
        frame_anonymized, face_center = _anonymize_face(frame, face_detector)
        cropped = _hand_crop(frame_anonymized, hand_detector)

        # 3. THE "BLANK" FIX LOGIC
        is_dup = False
        if cropped is not None:
            # SUCCESS: We found a hand
            frame_resized = cv2.resize(cropped, (TARGET_SIZE, TARGET_SIZE))
            current_lms = _landmarks_for_crop(frame_resized, face_center, hand_detector)

            # Update "Last Valid" trackers
            last_valid_frame = frame_resized.copy()
            last_valid_lms = np.array(current_lms, dtype=np.float32)

        else:
            # FAILURE: Hand not found, replace with previous valid frame
            if last_valid_frame is not None:
                frame_resized = last_valid_frame.copy()
                current_lms_array = last_valid_lms.copy()
                is_dup = True
                print(f"  [Info] Frame {out_idx} was blank. Replaced with previous valid frame.")
            else:
                # Extreme fallback: If the VERY FIRST frame is blank
                frame_resized = cv2.resize(_center_crop(frame_anonymized), (TARGET_SIZE, TARGET_SIZE))
                current_lms_array = np.tile(face_center, 42).astype(np.float32)  # 126 dims

        # 4. Save to lists and disk
        extracted_bgr.append(frame_resized)
        landmarks_list.append(last_valid_lms if last_valid_lms is not None else current_lms_array)
        dup_mask.append(is_dup or read_failed)

        cv2.imwrite(os.path.join(output_folder, f"frame{out_idx:04d}.jpg"), frame_resized)

    # 5. Compute Optical Flow (skips duplicated frames)
    flow_array = _compute_optical_flow(extracted_bgr, dup_mask=dup_mask)
    np.save(os.path.join(output_folder, "optical_flow.npy"), flow_array)

    # 6. Save Landmarks
    np.save(os.path.join(output_folder, "landmarks.npy"), np.array(landmarks_list))

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
        f.flush()
        try:
            os.fsync(f.fileno())
        except Exception:
            pass

def _is_valid_clip_folder(folder_path):
    jpgs = [f for f in os.listdir(folder_path) if f.endswith(".jpg")]
    if len(jpgs) != TARGET_FRAMES: return False
    try:
        flow = np.load(os.path.join(folder_path, "optical_flow.npy"), mmap_mode="r")
        lm   = np.load(os.path.join(folder_path, "landmarks.npy"), mmap_mode="r")
        return (flow.shape == (TARGET_FRAMES, 2, TARGET_SIZE, TARGET_SIZE)
                and lm.shape == (TARGET_FRAMES, LANDMARK_FEATURES))
    except Exception:
        return False

# ══════════════════════════════════════════════════════════════════════════════
# RUNNER
# ══════════════════════════════════════════════════════════════════════════════

def run_extraction(on_progress=None, commit_every=25):
    completed = _load_progress()
    face_detector = _build_face_detector()
    hand_detector = _build_hand_detector()

    print(f"\n--- Batch Extraction Started (126-dim) ---")
    print(f"--- Input:  {INPUT_BASE} ---")
    print(f"--- Output: {OUTPUT_BASE} ---")
    print(f"--- Resuming: {len(completed)} clips already done ---")

    done_since_commit = 0

    for split in SPLITS:
        split_input  = os.path.join(INPUT_BASE, split)
        split_output = os.path.join(OUTPUT_BASE, split)
        if not os.path.exists(split_input): continue

        letters = [d for d in os.listdir(split_input) if d in ["good_afternoon", "good_evening", "good_midday", "good_morning", "good_night"]]
        
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
                if success:
                    _mark_done(clip_key)
                    completed.add(clip_key)
                    done_since_commit += 1
                    if on_progress is not None and done_since_commit >= commit_every:
                        try:
                            on_progress()
                        except Exception as e:
                            print(f"  [warn] progress commit failed: {e}")
                        done_since_commit = 0

    print("\n--- Extraction Phase Complete ---")

if __name__ == "__main__":
    run_extraction()