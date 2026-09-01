@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if not errorlevel 1 (
  set "PY=py -3"
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo Python 3.11+ is required. Install Python from python.org and select "Add Python to PATH".
    pause
    exit /b 1
  )
  set "PY=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating local Python environment...
  %PY% -m venv .venv
  if errorlevel 1 goto :error
  echo Installing required packages...
  .venv\Scripts\python.exe -m pip install --upgrade pip
  .venv\Scripts\python.exe -m pip install -r requirements.txt
  if errorlevel 1 goto :error
)

echo Starting Quality Sample Randomizer...
.venv\Scripts\python.exe launcher.py
exit /b 0

:error
echo.
echo Setup failed. Review the messages above.
pause
exit /b 1
