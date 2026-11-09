@echo off
title Evo Media Agent - Pasang
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Install dulu dari https://nodejs.org ^(versi LTS^), lalu jalankan file ini lagi.
  pause
  exit /b 1
)
echo Mengecek koneksi database dan R2...
node evo-media-agent.js --once
if errorlevel 1 (
  echo.
  echo Ada yang gagal. Lihat pesan di atas atau file media.log.
  pause
  exit /b 1
)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo Set sh = CreateObject^("WScript.Shell"^)
  echo sh.CurrentDirectory = "%~dp0"
  echo sh.Run "cmd /c node ""%~dp0evo-media-supervisor.js""", 0, False
) > "%STARTUP%\Evo Media Agent.vbs"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*evo-media-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
del "%~dp0supervisor.pid" >nul 2>nul
wscript "%STARTUP%\Evo Media Agent.vbs"
echo.
echo Selesai. Evo Media Agent sekarang jalan di background, dijaga otomatis
echo ^(kalau mati, menyala lagi sendiri^), dan aktif setiap Windows menyala.
echo Log: %~dp0media.log
pause
