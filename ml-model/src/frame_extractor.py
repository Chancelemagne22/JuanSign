import os
import shutil
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import urllib.request
# ── Constants ─────────────────────────────────────────────────────────────────
TARGET_FRAMES   = 16
TARGET_SIZE     = 224   # must match fsl_dataset.py transforms and predict_sign.py
HAND_PADDING    = 60    # pixels added on each side of the hand bounding box
PROGRESS_FILE   = "extraction_progress.txt"  # written next to processed_output/


# ── Progress / resume helpers ─────────────────────────────────────────────────

def _load_progress(progress_path):
    """Return set of clip keys (split/letter/clipXXX) already completed."""
    if not os.path.exists(progress_path):
        return set()
    with open(progress_path, "r") as f:
        return {line.strip() for line in f if line.strip()}


def _save_progress(progress_path, key):
    """Append one completed clip key to the progress file."""
    with open(progress_path, "a") as f:
        f.write(key + "\n")


def _is_clip_complete(folder):
    """True when folder exists and already holds TARGET_FRAMES jpg files."""
    if not os.path.isdir(folder):
        return False
    frames = [n for n in os.listdir(folder) if n.lower().endswith(".jpg")]
    return len(frames) >= TARGET_FRAMES


def _count_videos(letter_path):
    """Count video files (not subdirs) in a letter input folder."""
    return sum(
        1 for f in os.listdir(letter_path)
        if not os.path.isdir(os.path.join(letter_path, f))
        and f.lower().endswith(('.mp4', '.avi', '.mov', '.mkv'))
    )


def _is_letter_complete(output_letter_path, num_expected):
    """
    True only when all num_expected clip folders each hold TARGET_FRAMES jpgs.
    Returns False if the folder is missing or any single clip is incomplete,
    so partial letters are never skipped.
    """
    if num_expected == 0 or not os.path.isdir(output_letter_path):
        return False
    return all(
        _is_clip_complete(os.path.join(output_letter_path, f"clip{i:03d}"))
        for i in range(1, num_expected + 1)
    )


# ── MediaPipe helpers ──────────────────────────────────────────────────────────

model_url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
if not os.path.exists("hand_landmarker.task"):
    print("Downloading model... please wait.")
    urllib.request.urlretrieve(model_url, "hand_landmarker.task")
    print("Download complete!")

def _anonymize_face(frame, face_detector):
    """Blur all detected face regions in-place for signer privacy."""  
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    results = face_detector.detect(mp_image)
    for det in results.detections:
        bb = det.bounding_box          # pixel coordinates in new Task API
        x1 = max(0, bb.origin_x)
        y1 = max(0, bb.origin_y)
        x2 = min(w, bb.origin_x + bb.width)
        y2 = min(h, bb.origin_y + bb.height)
        if x2 > x1 and y2 > y1:
            frame[y1:y2, x1:x2] = cv2.GaussianBlur(
                frame[y1:y2, x1:x2], (51, 51), 0
            )
    return frame


def _hand_crop(frame, hand_detector):
    """
    Detect the first hand via 21 landmarks and return a padded crop.
    Returns None when no hand is found.
    """
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    results = hand_detector.detect(mp_image)
    if not results.hand_landmarks:
        return None

    lm = results.hand_landmarks[0]     # list of NormalizedLandmark (x, y normalized 0-1)
    xs = [pt.x * w for pt in lm]
    ys = [pt.y * h for pt in lm]

    x1 = max(0, int(min(xs)) - HAND_PADDING)
    y1 = max(0, int(min(ys)) - HAND_PADDING)
    x2 = min(w, int(max(xs)) + HAND_PADDING)
    y2 = min(h, int(max(ys)) + HAND_PADDING)

    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2]


def _center_crop(frame):
    """Square center crop — fallback when no hand landmark is detected."""
    h, w = frame.shape[:2]
    s = min(h, w)
    y0, x0 = (h - s) // 2, (w - s) // 2
    return frame[y0:y0 + s, x0:x0 + s]


def _sample_indices(total, n=TARGET_FRAMES):
    """Return exactly n evenly-spaced frame indices; repeats last frame for short clips."""
    if total <= 0:
        return [0] * n
    if total <= n:
        return list(range(total)) + [total - 1] * (n - total)
    return np.linspace(0, total - 1, n, dtype=int).tolist()


# ── Core extraction ────────────────────────────────────────────────────────────

def extract_and_resize_frames(video_path, output_folder):
    """
    Clean extraction pipeline for a single video clip:
      1. Sample exactly TARGET_FRAMES positions uniformly across the video.
      2. For each sampled frame:
           a. Anonymize any detected face with Gaussian blur.
           b. Crop to the padded hand bounding box (Mediapipe 21-landmark).
           c. Fall back to a square center-crop when no hand is detected.
      3. Resize the crop to TARGET_SIZE × TARGET_SIZE and save.

    Every sequence is guaranteed to contain exactly TARGET_FRAMES images.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  ❌ Cannot open video: {video_path}")
        return

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total == 0:
        print(f"  ❌ Video has no frames: {video_path}")
        cap.release()
        return

    indices = _sample_indices(total)
    print(f"  🎬 {total} raw frames → sampling {TARGET_FRAMES} uniformly...")

    # STEP 1: Create HandLandmarker using the Task API.
    base_hand_options = python.BaseOptions(model_asset_path='hand_landmarker.task')
    hand_options = vision.HandLandmarkerOptions(
        base_options=base_hand_options,
        running_mode=vision.RunningMode.IMAGE,
        num_hands=1)
    hand_detector = vision.HandLandmarker.create_from_options(hand_options)

    # STEP 2: Create FaceDetector using the Task API.
    base_face_options = python.BaseOptions(model_asset_path='blaze_face_short_range.tflite')
    face_options = vision.FaceDetectorOptions(
        base_options=base_face_options,
        running_mode=vision.RunningMode.IMAGE,
        min_detection_confidence=0.5)
    face_detector = vision.FaceDetector.create_from_options(face_options)

    hand_hits = 0
    fallbacks = 0

    # STEP 3: Process each sampled frame through the detection pipeline.
    for i, idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()

        if not ret:
            # Keep sequence length intact with a blank frame
            blank = np.zeros((TARGET_SIZE, TARGET_SIZE, 3), dtype=np.uint8)
            cv2.imwrite(os.path.join(output_folder, f"frame{i:04d}.jpg"), blank)
            fallbacks += 1
            continue

        # Step 3a — anonymize face
        frame = _anonymize_face(frame, face_detector)

        # Step 3b — hand-centric crop (or center-crop fallback)
        crop = _hand_crop(frame, hand_detector)
        if crop is not None:
            hand_hits += 1
        else:
            crop = _center_crop(frame)
            fallbacks += 1

        # Step 3c — resize to target resolution
        final = cv2.resize(crop, (TARGET_SIZE, TARGET_SIZE),
                            interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(output_folder, f"frame{i:04d}.jpg"), final)

    cap.release()
    print(f"  ✅ {TARGET_FRAMES} frames saved "
          f"(hand crops: {hand_hits}, fallbacks: {fallbacks})")


# ── Folder walker ──────────────────────────────────────────────────────────────

def process_file(file_path, output_folder):
    """Dispatch a single video file to the extraction pipeline."""
    if file_path.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
        extract_and_resize_frames(file_path, output_folder)
    else:
        print(f"  ⚠️  Skipping non-video file: {file_path}")


def recreate_folder_structure_with_file_folders(input_dir, output_dir):
    """
    Walk input_dir/<split>/<letter>/<video> and write extracted clips to
    output_dir/<split>/<letter>/clip001/ … matching the FSLDataset folder contract.

    Expected input layout (produced by data_splitter.py):
        input_dir/
            training_data/   A/  clip001.mp4 ...
                             B/  ...
            testing_data/    A/  ...
            validation_data/ A/  ...

    Output layout:
        output_dir/
            training_data/   A/  clip001/  frame0000.jpg ... frame0015.jpg
            testing_data/    A/  clip001/  ...
            validation_data/ A/  clip001/  ...

    Resume behaviour:
        - Completed clips (final_folder already has TARGET_FRAMES jpgs) are skipped.
        - Partial tmp folders left by a crash are deleted and re-extracted.
        - Each completed clip is appended to PROGRESS_FILE for a human-readable log.
    """
    if not os.path.isdir(input_dir):
        print(f"❌ Input folder '{input_dir}' not found. Run from the repo root.")
        return

    progress_path = os.path.join(output_dir, PROGRESS_FILE)
    completed     = _load_progress(progress_path)
    if completed:
        print(f"📋 Resuming — {len(completed)} clip(s) already logged in {progress_path}")

    for split_folder in sorted(os.listdir(input_dir)):
        split_path = os.path.join(input_dir, split_folder)
        if not os.path.isdir(split_path):
            continue

        print(f"\n{'═' * 52}")
        print(f"📂 {split_folder}")
        print(f"{'═' * 52}")

        for letter_folder in sorted(os.listdir(split_path)):
            letter_path = os.path.join(split_path, letter_folder)
            if not os.path.isdir(letter_path):
                continue

            print(f"\n  📁 Class: {letter_folder}")
            output_letter_path = os.path.join(output_dir, split_folder, letter_folder)

            # ── Skip the whole letter if every clip is already complete ───────
            num_videos = _count_videos(letter_path)
            if _is_letter_complete(output_letter_path, num_videos):
                print(f"    ⏭️  All {num_videos} clip(s) already complete — skipping letter")
                continue

            os.makedirs(output_letter_path, exist_ok=True)

            clip_counter = 1
            for filename in sorted(os.listdir(letter_path)):
                file_path = os.path.join(letter_path, filename)
                if os.path.isdir(file_path):
                    continue

                file_name_without_ext = os.path.splitext(filename)[0]
                tmp_folder   = os.path.join(output_letter_path, file_name_without_ext)
                final_folder = os.path.join(output_letter_path, f"clip{clip_counter:03d}")
                clip_key     = f"{split_folder}/{letter_folder}/clip{clip_counter:03d}"

                # ── Skip if already fully extracted ──────────────────────────
                if _is_clip_complete(final_folder):
                    print(f"    ⏭️  Skipping {filename} → already complete ({final_folder})")
                    clip_counter += 1
                    continue

                # ── Remove any partial folders left by a previous crash ───────
                if os.path.exists(tmp_folder):
                    print(f"    🧹 Removing partial tmp folder: {tmp_folder}")
                    shutil.rmtree(tmp_folder)
                if os.path.exists(final_folder):
                    print(f"    🧹 Removing incomplete clip folder: {final_folder}")
                    shutil.rmtree(final_folder)

                os.makedirs(tmp_folder, exist_ok=True)
                print(f"    📄 {filename}")

                process_file(file_path, tmp_folder)
                os.rename(tmp_folder, final_folder)
                print(f"    📂 → {final_folder}")

                # ── Log completion ────────────────────────────────────────────
                _save_progress(progress_path, clip_key)

                clip_counter += 1


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _src_dir = os.path.dirname(os.path.abspath(__file__))
    _ml_dir  = os.path.abspath(os.path.join(_src_dir, '..'))

    recreate_folder_structure_with_file_folders(
        input_dir  = os.path.join(_ml_dir, 'unprocessed_input'),
        output_dir = os.path.join(_ml_dir, 'processed_output', 'frame_extracted'),
    )
    print("\n✅ ALL DONE!")
