@echo off
chcp 65001 >nul
cd /d "%~dp0"
title WenMaiZaiZi - Step 2: download unsigned IPA

set "PY="
for /f "delims=" %%A in ('where python 2^>nul') do if not defined PY set "PY=%%A"
if not defined PY (
  for /f "delims=" %%A in ('dir /b /s "%USERPROFILE%\.workbuddy\binaries\python\versions\python.exe" 2^>nul') do if not defined PY set "PY=%%A"
)
if not defined PY (
  echo.
  echo   Python 3 not found. Install it from https://www.python.org/downloads/
  echo   Or just tell me the repo address and I will download the IPA for you.
  echo.
  pause
  exit /b 1
)
echo.
echo   Fetching IPA: GitHub direct first, then mirrors automatically.
echo   Tip: pass --check to see a full network channel report.
echo.
"%PY%" "%~dp0fetch_ipa.py" %1
if errorlevel 1 if /i not "%~1"=="--check" (
  echo.
  echo   Download did not finish. Running a network channel check ...
  echo.
  "%PY%" "%~dp0fetch_ipa.py" --check
)
echo.
pause
