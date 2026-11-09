@echo off
title Evo Media Agent - Login Google
cd /d "%~dp0"
node login-google.js
if errorlevel 1 ( pause & exit /b 1 )
echo.
echo Menyalakan ulang Evo Media Agent supaya upload WAV aktif...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*evo-media-agent*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Selesai. (Penjaga otomatis menyalakannya lagi dalam beberapa detik.)
pause
