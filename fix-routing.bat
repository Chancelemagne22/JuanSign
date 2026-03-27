@echo off
REM Move reset-password.tsx to reset-password/page.tsx for Next.js 14 App Router

setlocal enabledelayedexpansion

set "APP_DIR=C:\Users\Lenovo©\Desktop\4th Year Files\JuanSign\Thesis\front-end\app"
set "OLD_FILE=%APP_DIR%\reset-password.tsx"
set "NEW_DIR=%APP_DIR%\reset-password"
set "NEW_FILE=%NEW_DIR%\page.tsx"

echo [1] Creating directory...
if not exist "%NEW_DIR%" (
    mkdir "%NEW_DIR%"
    echo ✓ Directory created
) else (
    echo ✓ Directory already exists
)

echo [2] Moving file...
if exist "%OLD_FILE%" (
    move /Y "%OLD_FILE%" "%NEW_FILE%"
    echo ✓ File moved
) else (
    echo ✗ Source file not found
)

echo [3] Verifying new location...
if exist "%NEW_FILE%" (
    echo ✓ New file exists at: %NEW_FILE%
) else (
    echo ✗ New file not found
)

echo [4] Verifying old location removed...
if not exist "%OLD_FILE%" (
    echo ✓ Old file successfully removed
) else (
    echo ✗ Old file still exists
)

echo.
if exist "%NEW_FILE%" if not exist "%OLD_FILE%" (
    echo SUCCESS: File structure fixed for Next.js 14 App Router
    echo Route /reset-password will now resolve to: reset-password/page.tsx
) else (
    echo FAILED: Operation incomplete
)

endlocal
