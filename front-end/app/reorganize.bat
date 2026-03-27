@echo off
cd /d "C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app"
mkdir reset-password 2>nul
move reset-password.tsx reset-password\page.tsx
echo === Verification ===
echo.
if exist "reset-password\page.tsx" (
    echo [OK] reset-password\page.tsx exists
    dir /b reset-password\page.tsx
) else (
    echo [FAIL] reset-password\page.tsx NOT found
    exit /b 1
)
if not exist "reset-password.tsx" (
    echo [OK] reset-password.tsx no longer exists at root
) else (
    echo [FAIL] reset-password.tsx still exists at root
    exit /b 1
)
echo.
echo SUCCESS: File reorganized successfully
