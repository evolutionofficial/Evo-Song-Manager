@echo off
title First Club Sync - Lepas
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\First Club Sync.vbs" >nul 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*first-club-s*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
del "%~dp0supervisor.pid" >nul 2>nul
echo First Club Sync dimatikan dan tidak jalan otomatis lagi.
pause
