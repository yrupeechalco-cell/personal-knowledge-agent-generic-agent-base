@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NITRO_HOST=127.0.0.1"
set "NITRO_PORT=5567"

echo 正在启动 TypeWords...
echo 浏览器地址：http://127.0.0.1:5567
echo 关闭本窗口即可停止 TypeWords。
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:5567'"
node ".output\server\index.mjs"

echo.
echo TypeWords 已停止。
pause
