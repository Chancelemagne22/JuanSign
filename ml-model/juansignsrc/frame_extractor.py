# ml-model/src/frame_extractor.py
#
# Extracts 32 frames per clip + optical flow channels.
#
# Output per clip folder:
#   frame0000.jpg … frame0031.jpg   — hand-cropped, face-blurred, 224×224 RGB
#   optical_flow.npy                — float32 array, shape [32, 2, 224, 224]
#                                     flow[0] is zeros (no previous frame)
#                                     flow[i] = (Δx, Δy) between frame i-1 and i
#
# Constants that must stay in sync across the project:
#   TARGET_FRAMES = 32
#   TARGET_SIZE   = 224
#   HAND_PADDING  = 60

import os
import cv2
import numpy as np
from PIL import Image
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ── CONFIG — swap paths here for Colab vs local ───────────────────────────────
# Local:
INPUT_BASE  = "./unprocessed_input"
OUTPUT_BASE = "./processed_output/frame_extracted"
MODEL_PATH       = "./hand_landmarker.task"    # path to MediaPipe HandLandmarker .task file
FACE_MODEL_PATH  = "./blaze_face_short_range.tflite"   # path to MediaPipe FaceDetector model

# Colab (comment out the block above and uncomment below):
# DRIVE_ROOT       = "/content/drive/MyDrive/JuanSign"
# INPUT_BASE       = f"{DRIVE_ROOT}/unprocessed_input"
# OUTPUT_BASE      = f"{DRIVE_ROOT}/processed_output/frame_extracted"
# MODEL_PATH       = f"{DRIVE_ROOT}/hand_landmarker.task"
# FACE_MODEL_PATH  = f"{DRIVE_ROOT}/face_detector.tflite"

PROGRESS_FILE = "./extraction_progress.txt"

# ── CONSTANTS — do NOT change without updating all dependent files ─────────────
TARGET_FRAMES = 32     # was 16 — must match fsl_dataset.py, train.py, main.py
TARGET_SIZE   = 224    # pixels — must match all transform definitions
HAND_PADDING  = 60     # pixels around detected hand bounding box

SPLITS = ["training_data", "testing_data", "validation_data"]
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


# ══════════════════════════════════════════════════════════════════════════════
# FRAME SAMPLING
# ══════════════════════════════════════════════════════════════════════════════

def _sample_indices(total_frames, n=TARGET_FRAMES):
    """
    Return exactly n evenly-spaced frame indices from a clip.
    - If total_frames <= 0 : repeat index 0
    - If total_frames < n  : pad by repeating the last frame
    - Otherwise            : np.linspace across the full range
    """
    if total_frames <= 0:
        return [0] * n
    if total_frames <= n:
        indices = list(range(total_frames))
        indices += [total_frames - 1] * (n - total_frames)
        return indices
    return np.linspace(0, total_frames - 1, n, dtype=int).tolist()


# ══════════════════════════════════════════════════════════════════════════════
# MEDIAPIPE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _build_face_detector():
    """Return a MediaPipe FaceDetector (short-range model)."""
    base_options = mp_python.BaseOptions(model_asset_path=FACE_MODEL_PATH)
    options = mp_vision.FaceDetectorOptions(
        base_options=base_options,
        min_detection_confidence=0.4,
    )
    return mp_vision.FaceDetector.create_from_options(options)


def _build_hand_detector():
    """Return a MediaPipe HandLandmarker (detects up to 2 hands)."""
    base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    options = mp_vision.HandLandmarkerOptions(
        base_options=base_options,
        num_hands=2,
        min_hand_detection_confidence=0.4,
        min_hand_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    return mp_vision.HandLandmarker.create_from_options(options)


def _anonymize_face(frame_bgr, face_detector):
    """
    Blur any detected face regions in-place.
    frame_bgr : H×W×3 numpy array (BGR, uint8)
    Returns the modified array (same object).
    """
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = face_detector.detect(mp_image)

    h, w = frame_bgr.shape[:2]
    for detection in result.detections:
        bb = detection.bounding_box
        x1 = max(0, bb.origin_x)
        y1 = max(0, bb.origin_y)
        x2 = min(w, bb.origin_x + bb.width)
        y2 = min(h, bb.origin_y + bb.height)
        if x2 > x1 and y2 > y1:
            roi = frame_bgr[y1:y2, x1:x2]
            blurred = cv2.GaussianBlur(roi, (51, 51), 0)
            frame_bgr[y1:y2, x1:x2] = blurred

    return frame_bgr


def _hand_crop(frame_bgr, hand_detector):
    """
    Detect hand landmarks, compute bounding box + HAND_PADDING, crop.
    Returns cropped numpy array, or None if no hand detected.
    """
    h, w = frame_bgr.shape[:2]
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = hand_detector.detect(mp_image)

    if not result.hand_landmarks:
        return None

    # Gather all landmark pixel coordinates across all detected hands
    xs, ys = [], []
    for hand in result.hand_landmarks:
        for lm in hand:
            xs.append(int(lm.x * w))
            ys.append(int(lm.y * h))

    x1 = max(0, min(xs) - HAND_PADDING)
    y1 = max(0, min(ys) - HAND_PADDING)
    x2 = min(w, max(xs) + HAND_PADDING)
    y2 = min(h, max(ys) + HAND_PADDING)

    if x2 <= x1 or y2 <= y1:
        return None

    return frame_bgr[y1:y2, x1:x2]


def _center_crop(frame_bgr):
    """
    Square center crop — fallback when no hand is detected.
    Uses the smaller dimension as the crop size.
    """
    h, w = frame_bgr.shape[:2]
    side = min(h, w)
    top  = (h - side) // 2
    left = (w - side) // 2
    return frame_bgr[top:top+side, left:left+side]


# ══════════════════════════════════════════════════════════════════════════════
# OPTICAL FLOW
# ══════════════════════════════════════════════════════════════════════════════

def _compute_optical_flow(frames_bgr):
    """
    Given a list of TARGET_FRAMES BGR numpy arrays (each already 224×224),
    compute dense optical flow between consecutive frames using Farneback.

    Returns:
        flow_array : float32 numpy array, shape [TARGET_FRAMES, 2, 224, 224]
                     flow_array[0]     = zeros (no previous frame)
                     flow_array[i,0]   = Δx  (horizontal displacement)
                     flow_array[i,1]   = Δy  (vertical displacement)

    Why Farneback?
        - Pure OpenCV, no extra dependencies
        - Works on CPU — important for Colab free tier
        - Dense (every pixel gets a flow vector, not just keypoints)
        - Fast enough for our 224×224 resolution
    """
    n = len(frames_bgr)
    flow_array = np.zeros((n, 2, TARGET_SIZE, TARGET_SIZE), dtype=np.float32)

    # Convert all frames to grayscale once
    grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames_bgr]

    for i in range(1, n):
        flow = cv2.calcOpticalFlowFarneback(
            prev=grays[i - 1],
            next=grays[i],
            flow=None,
            pyr_scale=0.5,    # pyramid scale — 0.5 = each layer is half resolution
            levels=3,          # number of pyramid levels
            winsize=15,        # averaging window size — larger = blurrier but more stable
            iterations=3,      # iterations per pyramid level
            poly_n=5,          # pixel neighbourhood size for polynomial expansion
            poly_sigma=1.2,    # std dev of Gaussian for polynomial expansion
            flags=0,
        )
        # flow shape is [H, W, 2]; transpose to [2, H, W] to match PyTorch convention
        flow_array[i, 0] = flow[:, :, 0]   # Δx
        flow_array[i, 1] = flow[:, :, 1]   # Δy

    return flow_array


# ══════════════════════════════════════════════════════════════════════════════
# MAIN EXTRACTION FUNCTION
# ══════════════════════════════════════════════════════════════════════════════

def extract_and_resize_frames(video_path, output_folder, face_detector, hand_detector):
    """
    Extract TARGET_FRAMES from video_path, crop to hand region, blur faces,
    resize to TARGET_SIZE×TARGET_SIZE, save as JPEGs, then compute and save
    optical flow as optical_flow.npy.

    Returns True on success, False on failure.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  [WARN] Cannot open video: {video_path}")
        return False

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = _sample_indices(total_frames)

    os.makedirs(output_folder, exist_ok=True)

    extracted_bgr = []   # stores raw 224×224 BGR frames for optical flow
    hand_detected_count = 0

    for out_idx, frame_idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()

        if not ret:
            # If read fails, repeat the last successfully extracted frame
            if extracted_bgr:
                frame_bgr = extracted_bgr[-1].copy()
            else:
                frame_bgr = np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8)
        else:
            # 1. Anonymize face
            frame = _anonymize_face(frame, face_detector)

            # 2. Hand crop (with center-crop fallback)
            cropped = _hand_crop(frame, hand_detector)
            if cropped is not None:
                hand_detected_count += 1
                frame_bgr = cropped
            else:
                frame_bgr = _center_crop(frame)

            # 3. Resize to TARGET_SIZE × TARGET_SIZE
            frame_bgr = cv2.resize(
                frame_bgr,
                (TARGET_SIZE, TARGET_SIZE),
                interpolation=cv2.INTER_AREA,
            )

        extracted_bgr.append(frame_bgr)

        # 4. Save JPEG (convert BGR → RGB for PIL)
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(frame_rgb)
        pil_img.save(os.path.join(output_folder, f"frame{out_idx:04d}.jpg"), quality=95)

    cap.release()

    if hand_detected_count == 0:
        print(f"  [WARN] No hands detected in any frame: {video_path}")

    # 5. Compute and save optical flow
    flow_array = _compute_optical_flow(extracted_bgr)
    np.save(os.path.join(output_folder, "optical_flow.npy"), flow_array)

    return True


# ══════════════════════════════════════════════════════════════════════════════
# PROGRESS TRACKING
# ══════════════════════════════════════════════════════════════════════════════

def _load_progress():
    """Return a set of already-completed clip paths."""
    if not os.path.exists(PROGRESS_FILE):
        return set()
    with open(PROGRESS_FILE, "r") as f:
        return set(line.strip() for line in f if line.strip())


def _mark_done(clip_key):
    with open(PROGRESS_FILE, "a") as f:
        f.write(clip_key + "\n")


def _is_valid_clip_folder(folder_path):
    """
    A clip folder is valid if it contains:
      - exactly TARGET_FRAMES .jpg files named frame0000 … frame(N-1)
      - optical_flow.npy with shape [TARGET_FRAMES, 2, TARGET_SIZE, TARGET_SIZE]
    """
    jpgs = sorted([
        f for f in os.listdir(folder_path)
        if f.startswith("frame") and f.endswith(".jpg")
    ])
    if len(jpgs) != TARGET_FRAMES:
        return False

    npy_path = os.path.join(folder_path, "optical_flow.npy")
    if not os.path.exists(npy_path):
        return False

    try:
        flow = np.load(npy_path, mmap_mode="r")
        expected = (TARGET_FRAMES, 2, TARGET_SIZE, TARGET_SIZE)
        return flow.shape == expected
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════════════
# BATCH RUNNER
# ══════════════════════════════════════════════════════════════════════════════

def run_extraction():
    """
    Walk all splits → letters → clips and extract frames + optical flow.
    Skips clips already marked done. Deletes and re-extracts partial folders.
    """
    completed = _load_progress()

    # Build MediaPipe detectors once — expensive to initialise per clip
    face_detector = _build_face_detector()
    hand_detector  = _build_hand_detector()

    total_done = 0
    total_skipped = 0
    total_failed = 0

    for split in SPLITS:
        split_input  = os.path.join(INPUT_BASE,  split)
        split_output = os.path.join(OUTPUT_BASE, split)

        if not os.path.exists(split_input):
            print(f"[SKIP] Input split not found: {split_input}")
            continue

        letters = sorted(os.listdir(split_input))

        for letter in letters:
            letter_input  = os.path.join(split_input,  letter)
            letter_output = os.path.join(split_output, letter)

            if not os.path.isdir(letter_input):
                continue

            videos = sorted([
                v for v in os.listdir(letter_input)
                if os.path.splitext(v)[1].lower() in VIDEO_EXTS
            ])

            for video_file in videos:
                clip_name    = os.path.splitext(video_file)[0]
                clip_key     = f"{split}/{letter}/{clip_name}"
                output_folder = os.path.join(letter_output, clip_name)
                video_path   = os.path.join(letter_input, video_file)

                # Skip if already successfully completed
                if clip_key in completed:
                    total_skipped += 1
                    continue

                # Delete partial output folder from a previous crashed run
                if os.path.exists(output_folder):
                    if not _is_valid_clip_folder(output_folder):
                        import shutil
                        shutil.rmtree(output_folder)
                    else:
                        # Folder is already valid — mark done and skip
                        _mark_done(clip_key)
                        total_skipped += 1
                        continue

                print(f"  Extracting: {clip_key}")
                success = extract_and_resize_frames(
                    video_path, output_folder, face_detector, hand_detector
                )

                if success:
                    _mark_done(clip_key)
                    total_done += 1
                else:
                    total_failed += 1

    print(f"\n── Extraction complete ──")
    print(f"  Extracted : {total_done}")
    print(f"  Skipped   : {total_skipped}")
    print(f"  Failed    : {total_failed}")


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    run_extraction()