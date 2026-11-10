@echo off
chcp 65001 >nul
title 文脉在兹 · 离线版本地预览
cd /d "%~dp0web"
echo.
echo   本地预览地址： http://127.0.0.1:8768/
echo   localhost 下 Service Worker 会注册，可验证「断网后仍可打开」。
echo   这只是开发预览，正式使用请把本目录 push 到 GitHub 云构建 IPA。
echo.
start "" "http://127.0.0.1:8768/"
python -m http.server 8768 --bind 127.0.0.1
pause
