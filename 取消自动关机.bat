@echo off
chcp 65001 >nul
echo ============================================================
echo   WenMaiZaiZi - cancel the scheduled auto shutdown
echo ============================================================
echo.
shutdown /a
if errorlevel 1 (
  echo   No shutdown is pending right now. Nothing to cancel.
) else (
  echo   Auto shutdown CANCELLED. This PC will stay on.
  echo   Your downloaded IPA file is safe and untouched.
)
echo.
echo   You can close this window now.
timeout /t 8 >nul
