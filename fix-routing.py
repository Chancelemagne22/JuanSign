#!/usr/bin/env python3
import os
import shutil
from pathlib import Path

# Define paths
base_dir = r"C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app"
old_file = os.path.join(base_dir, "reset-password.tsx")
new_dir = os.path.join(base_dir, "reset-password")
new_file = os.path.join(new_dir, "page.tsx")

print(f"Base directory: {base_dir}")
print(f"Old file: {old_file}")
print(f"New directory: {new_dir}")
print(f"New file: {new_file}")
print()

# 1. Create the directory
print("[1] Creating directory...")
try:
    os.makedirs(new_dir, exist_ok=True)
    print("✓ Directory created")
except Exception as e:
    print(f"✗ Failed to create directory: {e}")
    exit(1)

# 2. Move the file
print("[2] Moving file...")
try:
    if os.path.exists(old_file):
        shutil.move(old_file, new_file)
        print("✓ File moved")
    else:
        print("✗ Source file not found")
        exit(1)
except Exception as e:
    print(f"✗ Failed to move file: {e}")
    exit(1)

# 3. Verify new file exists
print("[3] Verifying new location...")
new_exists = os.path.exists(new_file)
if new_exists:
    print(f"✓ File exists at: {new_file}")
else:
    print(f"✗ File NOT found at: {new_file}")

# 4. Verify old file no longer exists
print("[4] Verifying old location removed...")
old_exists = os.path.exists(old_file)
if not old_exists:
    print(f"✓ Old file successfully removed: {old_file}")
else:
    print(f"✗ Old file still exists: {old_file}")

print()
print("=== RESULT ===")
if new_exists and not old_exists:
    print("SUCCESS: File structure fixed for Next.js 14 App Router")
    print("Route /reset-password will now resolve to: reset-password/page.tsx")
else:
    print("FAILED: Operation incomplete")
    exit(1)
