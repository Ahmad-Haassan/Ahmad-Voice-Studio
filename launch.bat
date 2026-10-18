@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

REM Get current directory
set "CURRENT_DIR=%cd%"

echo.
echo [*] Launching F5-TTS Gradio App from:
echo     %CURRENT_DIR%
echo.

REM Step 1: Activate environment
if exist "D:\F5-TTS-CPU\venv\Scripts\activate.bat" (
    call "D:\F5-TTS-CPU\venv\Scripts\activate.bat"
) else if exist "%CURRENT_DIR%\venv\Scripts\activate.bat" (
    call "%CURRENT_DIR%\venv\Scripts\activate.bat"
) else (
    call conda activate F5-TTS-CPU_ONLY 2>nul
)

REM Step 2: Navigate to current directory
cd /d "%CURRENT_DIR%"

REM Step 3: Launch Gradio app
f5-tts_infer-gradio

echo.
echo [✓] App has exited.
pause

