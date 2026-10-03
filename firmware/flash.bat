@echo off
rem Radar A one-click flasher: double-click this file.
rem Logic lives in flash.ps1 (PowerShell, built into Windows 10/11).
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0flash.ps1" %*
echo.
pause
