@echo off
title Evo Media Agent - Lepas
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Evo Media Agent.vbs" >nul 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*evo-media-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
del "%~dp0supervisor.pid" >nul 2>nul
echo Evo Media Agent dimatikan dan tidak jalan otomatis lagi.
pause
