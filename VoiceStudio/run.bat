@echo off
setlocal
cd /d "%~dp0"

echo.
echo ====================================================
echo        Starting Ahmad Voice Studio (Desktop App)    
echo ====================================================
echo.

if exist "D:\F5-TTS-CPU\venv\Scripts\python.exe" (
    "D:\F5-TTS-CPU\venv\Scripts\python.exe" app.py
) else if exist "..\venv\Scripts\python.exe" (
    "..\venv\Scripts\python.exe" app.py
) else (
    python app.py
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Application exited with an error.
    pause
)
