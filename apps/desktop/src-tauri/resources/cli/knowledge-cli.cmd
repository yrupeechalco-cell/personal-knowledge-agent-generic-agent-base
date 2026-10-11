@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0knowledge-cli.ps1" %*
exit /b %errorlevel%
