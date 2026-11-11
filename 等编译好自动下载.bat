@echo off
chcp 65001 >nul
cd /d "%~dp0"
title WenMaiZaiZi - wait for cloud build and auto-fetch IPA

set "PY="
for /f "delims=" %%A in ('where python 2^>nul') do if not defined PY set "PY=%%A"
if not defined PY (
  for /f "delims=" %%A in ('dir /b /s "%USERPROFILE%\.workbuddy\binaries\python\versions\python.exe" 2^>nul') do if not defined PY set "PY=%%A"
)
if not defined PY (
  echo.
  echo   Python 3 not found. Install it from https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

echo.
echo   Waiting for the GitHub cloud build. This window stays open.
echo   It checks every 30 seconds, downloads the IPA automatically,
echo   verifies it, and writes OK-TO-SHUTDOWN.txt when done.
echo   You can close this window any time - the IPA stays on GitHub Release.
echo.
"%PY%" -u "%~dp0wait_and_fetch.py"
echo.
pause
