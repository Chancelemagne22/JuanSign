@echo off
REM Fix Next.js App Router structure for reset-password route
REM This script moves reset-password.tsx to reset-password/page.tsx

cd /d "C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app"

echo [1] Creating reset-password directory...
mkdir reset-password
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create directory
    exit /b 1
)
echo ✓ Directory created

echo [2] Moving reset-password.tsx to reset-password/page.tsx...
move reset-password.tsx reset-password\page.tsx
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to move file
    exit /b 1
)
echo ✓ File moved

echo [3] Verifying new location...
if exist "reset-password\page.tsx" (
    echo ✓ File exists at: reset-password\page.tsx
) else (
    echo ERROR: File not found at new location
    exit /b 1
)

echo [4] Verifying old file removed...
if not exist "reset-password.tsx" (
    echo ✓ Old file successfully removed
) else (
    echo ERROR: Old file still exists
    exit /b 1
)

echo.
echo ========================================
echo SUCCESS: Next.js routing structure fixed!
echo ========================================
echo.
echo The route /reset-password will now work correctly.
echo You may need to restart your dev server (npm run dev).
echo.
pause
