@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo =====================================================
echo   JuanSign - 1-Hit Preprocessing Setup and Run
echo =====================================================
echo.
echo This script will:
echo   1. Check Python 3.10+
echo   2. Create a virtual environment
echo   3. Install all required packages
echo   4. Split raw videos into train/test/val
echo   5. Extract 16 frames per clip
echo.
echo Make sure your raw videos are in:
echo   processed_output\raw_data\<LETTER>\*.mp4
echo   (e.g. processed_output\raw_data\A\clip_001.mp4)
echo.
pause

:: ─── Step 1: Check Python ────────────────────────────────────────────────────
echo [1/5] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Python not found.
    echo Download Python 3.11 from: https://www.python.org/downloads/
    echo IMPORTANT: Check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)
python --version
echo [OK]

:: ─── Step 2: Create virtual environment ─────────────────────────────────────
echo.
echo [2/5] Creating virtual environment in ml-model\venv ...
if exist "ml-model\venv\" (
    echo [SKIP] venv already exists.
) else (
    python -m venv ml-model\venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause & exit /b 1
    )
    echo [OK] venv created.
)

:: ─── Step 3: Install packages ────────────────────────────────────────────────
echo.
echo [3/5] Installing packages (first run takes 5-10 min)...
call ml-model\venv\Scripts\activate.bat

python -m pip install --upgrade pip --quiet

:: Install PyTorch with CUDA 12.1 support (GPU)
echo   Installing PyTorch (CUDA 12.1)...
pip install torch==2.2.0 torchvision==0.17.0 --index-url https://download.pytorch.org/whl/cu121 --quiet
if errorlevel 1 (
    echo   PyTorch CUDA install failed. Trying CPU-only fallback...
    pip install torch==2.2.0 torchvision==0.17.0 --quiet
)

:: Install remaining packages
echo   Installing OpenCV, MediaPipe, and utilities...
pip install opencv-python-headless==4.9.0.80 mediapipe==0.10.11 numpy==1.26.4 Pillow==10.2.0 matplotlib==3.8.3 seaborn==0.13.2 scikit-learn==1.4.1.post1 tensorboard==2.16.2 --quiet
if errorlevel 1 (
    echo [ERROR] Package installation failed. Check your internet connection.
    pause & exit /b 1
)
echo [OK] All packages installed.

:: ─── Step 4: Check raw data exists ──────────────────────────────────────────
echo.
echo [4/5] Checking raw data...
if not exist "processed_output\raw_data\" (
    echo [ERROR] Folder not found: processed_output\raw_data\
    echo.
    echo Create it and add subfolders for each letter:
    echo   processed_output\raw_data\A\   (put all A clips here)
    echo   processed_output\raw_data\B\   (put all B clips here)
    echo   ...etc
    echo.
    pause & exit /b 1
)
echo [OK] raw_data folder found.

:: Run data splitter
python ml-model\src\data_splitter.py
if errorlevel 1 (
    echo [ERROR] data_splitter.py failed. See error above.
    pause & exit /b 1
)
echo [OK] Data split into train/test/val.

:: ─── Step 5: Frame extraction ────────────────────────────────────────────────
echo.
echo [5/5] Extracting frames (this takes a while - grab a coffee)...
echo   - Downloads hand_landmarker.task (~30 MB) on first run
echo   - Resumes automatically if interrupted
echo   - Output: processed_output\frame_extracted\
echo.
python ml-model\src\frame_extractor.py
if errorlevel 1 (
    echo [ERROR] frame_extractor.py failed. See error above.
    pause & exit /b 1
)

:: ─── Done ────────────────────────────────────────────────────────────────────
echo.
echo =====================================================
echo   DONE! Extracted frames are in:
echo   processed_output\frame_extracted\
echo.
echo   training_data\<letter>\clipXXX\frame####.jpg
echo   testing_data\<letter>\clipXXX\frame####.jpg
echo   validation_data\<letter>\clipXXX\frame####.jpg
echo =====================================================
echo.
pause
