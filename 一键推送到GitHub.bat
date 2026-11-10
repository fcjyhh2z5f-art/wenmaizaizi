@echo off
chcp 65001 >nul
cd /d "%~dp0"
title WenMaiZaiZi - Step 1: push to GitHub

echo.
echo   WenMaiZaiZi / iOS cloud build - Step 1 of 2
echo   ------------------------------------------------------------
echo   First install AND later upgrades both use this same file.
echo   Upgrading? Just run it again after replacing the files; it will
echo   commit and push, and GitHub Actions will build a fresh IPA.
echo   To force a rebuild without changing any file, open the Actions
echo   tab and click "Run workflow" instead.
echo.
echo   [Network check] Testing GitHub connectivity ...
where curl.exe >nul 2>nul
if not errorlevel 1 (
  for %%U in (https://github.com https://api.github.com) do (
    curl.exe -s -o nul -w "    %%~U  :  %%{http_code}\n" --connect-timeout 6 --max-time 12 %%U
  )
) else (
  echo   curl.exe not found, skip quick check.
)
echo   A 000 / timeout here does not stop the script; push is still attempted.
echo   Full channel report: run "一键取回IPA.bat --check".
echo.
echo   A browser window opens at GitHub "Create a new repository".
echo     Repository name : wenmaizaizi-ios  (or any name you like)
echo     Visibility      : Public   (free macOS runner)
echo     Initialize      : DO NOT tick README / .gitignore / license
echo.
echo   Your repository is already created. Just press ENTER below.
echo     Default: https://github.com/fcjyhh2z5f-art/wenmaizaizi.git
echo.
echo   To create a DIFFERENT repository, open https://github.com/new manually.
echo   This script no longer pops up the "new repository" page automatically.
echo.
set "REPO="
set /p "REPO=Repository URL (Enter = use the default): "
if "%REPO%"=="" set "REPO=https://github.com/fcjyhh2z5f-art/wenmaizaizi.git"
set "REPO=%REPO:"=%"
set "REPO=%REPO: =%"
echo %REPO% | findstr /i /c:"github.com" >nul
if errorlevel 1 set "REPO=https://github.com/%REPO%"
echo %REPO% | findstr /i /c:".git" >nul
if errorlevel 1 set "REPO=%REPO%.git"
echo.
echo   Target: %REPO%

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo   Initialising local git repository (the unzipped package has no .git) ...
  git init -b main
  git config user.name "WenMaiZaiZi"
  git config user.email "wenmaizaizi@localhost"
  git add -A
  git commit -m "Initial import: WenMaiZaiZi iOS offline project"
)
git add -A
git diff --cached --quiet >nul 2>nul
if errorlevel 1 git commit -m "Update WenMaiZaiZi iOS project (rebuild unsigned IPA)"

git remote remove origin >nul 2>nul
git remote add origin "%REPO%"
echo.
echo   Pushing... A GitHub sign-in window may pop up.
echo   Please log in and click Authorize (only once, handled by Git Credential Manager).
echo.
git -c http.schannelCheckRevoke=false -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push -u origin main
if errorlevel 1 (
  echo.
  echo   PUSH FAILED. Common causes:
  echo     1) GitHub sign-in was not finished - just run this file again.
  echo     2) The repo was created WITH a README - recreate it empty, or run:
  echo          git pull --rebase origin main
  echo        and then run this file again.
  echo     3) Network blocked: git push MUST reach github.com directly.
  echo        GitHub mirrors only help DOWNLOADING / cloning, they cannot
  echo        replace your own GitHub sign-in. Retry later, or run the
  echo        accelerator check, then try again.
  echo        Channel report: run "一键取回IPA.bat --check".
  echo.
  pause
  exit /b 1
)
echo.
echo   PUSH OK. GitHub Actions is now building the unsigned IPA.
echo   It takes about 3-8 minutes. Open the Actions tab of your repository
echo   to watch "Build unsigned iOS IPA for WenMaiZaiZi".
echo.
echo   When it finishes, run the second .bat (download IPA) to fetch the file here.
echo   It tries GitHub directly first and falls back to mirrors automatically,
echo   and prints the build SHA / asset timestamp so you can confirm it is NEW.
echo.
echo   UPGRADING: export a snapshot inside the App first, then re-sign the new
echo   IPA with the SAME Apple ID and install over the old one. A 7-day
echo   signature expiry only needs re-signing, NOT a new IPA or a new build.
echo   See 升级和更新.txt for all three platforms.
echo.
pause
