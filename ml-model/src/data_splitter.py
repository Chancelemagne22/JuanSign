"""
data_splitter.py
----------------
Organizes raw video clips from raw_data/<letter>/ into three split folders:

  training_data/<letter>/   — first 100 clips
  testing_data/<letter>/    — next 12 clips
  validation_data/<letter>/ — remaining clips

Run from the repo root:
    python ml-model/src/data_splitter.py

Clips are COPIED (originals in raw_data/ are untouched).
Files are sorted alphabetically before splitting for reproducibility.
"""

import os
import shutil

# ── Split configuration ────────────────────────────────────────────────────────
SOURCE_DIR   = "./processed_output/raw_data"
TRAIN_DIR    = "./unprocessed_input/training_data"
TEST_DIR     = "./unprocessed_input/testing_data"
VAL_DIR      = "./unprocessed_input/validation_data"

TRAIN_COUNT  = 100
TEST_COUNT   = 12

VIDEO_EXTS   = {".mp4", ".avi", ".mov", ".mkv"}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _is_video(filename):
    return os.path.splitext(filename)[1].lower() in VIDEO_EXTS


def _copy_clips(clips, src_letter_path, dest_letter_path):
    """Copy a list of filenames from src to dest, creating dest if needed."""
    os.makedirs(dest_letter_path, exist_ok=True)
    for filename in clips:
        src  = os.path.join(src_letter_path, filename)
        dest = os.path.join(dest_letter_path, filename)
        shutil.copy2(src, dest)


# ── Core split logic ───────────────────────────────────────────────────────────

def split_raw_data(source_dir, train_dir, test_dir, val_dir,
                   train_count, test_count):
    """
    Walk source_dir/<letter>/ for each letter subfolder, sort the video files
    alphabetically, then copy them into train/test/val destinations.

    Raises FileNotFoundError if source_dir does not exist.
    Warns (and skips the letter) if there are not enough clips to fill
    training + testing slots.
    """
    if not os.path.isdir(source_dir):
        raise FileNotFoundError(
            f"Source folder '{source_dir}' not found. "
            f"Run this script from the repo root."
        )

    letter_folders = sorted(
        d for d in os.listdir(source_dir)
        if os.path.isdir(os.path.join(source_dir, d))
    )

    if not letter_folders:
        print(f"⚠️  No letter subfolders found inside '{source_dir}'.")
        return

    total_train = total_test = total_val = 0

    for letter in letter_folders:
        src_letter_path = os.path.join(source_dir, letter)

        # Collect and sort all video files in this letter folder
        clips = sorted(
            f for f in os.listdir(src_letter_path)
            if os.path.isfile(os.path.join(src_letter_path, f)) and _is_video(f)
        )
        n = len(clips)

        print(f"\n📁 {letter}  ({n} clips found)")

        if n < train_count + test_count:
            print(
                f"  ⚠️  Only {n} clips — need at least {train_count + test_count} "
                f"(train={train_count} + test={test_count}). Skipping."
            )
            continue

        train_clips = clips[:train_count]
        test_clips  = clips[train_count : train_count + test_count]
        val_clips   = clips[train_count + test_count :]

        _copy_clips(train_clips, src_letter_path, os.path.join(train_dir, letter))
        _copy_clips(test_clips,  src_letter_path, os.path.join(test_dir,  letter))
        _copy_clips(val_clips,   src_letter_path, os.path.join(val_dir,   letter))

        print(f"  ✅ train={len(train_clips)}  test={len(test_clips)}  val={len(val_clips)}")

        total_train += len(train_clips)
        total_test  += len(test_clips)
        total_val   += len(val_clips)

    print(f"\n{'─' * 48}")
    print(f"  Done.")
    print(f"  training_data   → {total_train} clips")
    print(f"  testing_data    → {total_test} clips")
    print(f"  validation_data → {total_val} clips")
    print(f"  Total copied    : {total_train + total_test + total_val}")
    print(f"{'─' * 48}")
    print(
        f"\nNext step: run frame_extractor.py against each split folder, e.g.\n"
        f"  python ml-model/src/frame_extractor.py  (update SOURCE/OUTPUT paths per split)"
    )


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    split_raw_data(
        source_dir  = SOURCE_DIR,
        train_dir   = TRAIN_DIR,
        test_dir    = TEST_DIR,
        val_dir     = VAL_DIR,
        train_count = TRAIN_COUNT,
        test_count  = TEST_COUNT,
    )
    print("\n✅ ALL DONE!")
