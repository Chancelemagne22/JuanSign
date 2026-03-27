"""
Verification script for Real-Time Model Debugger setup.
Checks all dependencies and file paths before running the debugger.

Usage:
  python verify_debugger_setup.py
"""

import os
import sys

def check_file(path, description):
    """Check if a file exists."""
    if os.path.exists(path):
        size_mb = os.path.getsize(path) / (1024 * 1024)
        print(f"✓ {description}")
        print(f"  Path: {path}")
        print(f"  Size: {size_mb:.1f} MB")
        return True
    else:
        print(f"✗ {description} NOT FOUND")
        print(f"  Expected: {path}")
        return False

def check_module(module_name):
    """Check if a Python module is installed."""
    try:
        __import__(module_name)
        print(f"✓ {module_name} installed")
        return True
    except ImportError:
        print(f"✗ {module_name} NOT installed")
        return False

def main():
    print("=" * 70)
    print("JuanSign Real-Time Model Debugger - Setup Verification")
    print("=" * 70)
    
    all_ok = True
    
    # Check Python version
    print("\n[Python Version]")
    py_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    print(f"✓ Python {py_version}")
    if sys.version_info < (3, 8):
        print("✗ WARNING: Python 3.8+ recommended")
        all_ok = False
    
    # Check required files
    print("\n[Required Files]")
    
    files_to_check = [
        ("./juansignmodel/juansign_model.pth", "Model checkpoint (juansign_model.pth)"),
        ("./hand_landmarker.task", "MediaPipe Hand Landmarker task"),
        ("./resnet_lstm_architecture.py", "ResNetLSTM architecture module"),
        ("./real_time_debugger.py", "Real-Time Debugger script"),
    ]
    
    for file_path, description in files_to_check:
        if not check_file(file_path, description):
            all_ok = False
        print()
    
    # Check optional files
    print("\n[Optional Files (nice-to-have)]")
    
    optional_files = [
        ("./blaze_face_short_range.tflite", "Face detection model (optional)"),
        ("./REAL_TIME_DEBUGGER_README.md", "Debugger documentation"),
    ]
    
    for file_path, description in optional_files:
        if os.path.exists(file_path):
            print(f"✓ {description}")
        else:
            print(f"~ {description} (optional, not found)")
        print()
    
    # Check Python dependencies
    print("\n[Python Dependencies]")
    
    modules_to_check = [
        "torch",
        "torchvision",
        "cv2",
        "numpy",
        "mediapipe",
    ]
    
    for module in modules_to_check:
        if not check_module(module):
            all_ok = False
    
    # Summary
    print("\n" + "=" * 70)
    if all_ok:
        print("✓ ALL CHECKS PASSED - Ready to run real_time_debugger.py!")
        print("\nQuick start:")
        print("  python real_time_debugger.py")
        return 0
    else:
        print("✗ SOME CHECKS FAILED - Please fix issues above")
        print("\nCommon fixes:")
        print("  • pip install torch torchvision opencv-python numpy mediapipe")
        print("  • Ensure model checkpoint exists in ./juansignmodel/")
        print("  • Ensure MediaPipe task file exists: ./hand_landmarker.task")
        return 1

if __name__ == "__main__":
    sys.exit(main())
