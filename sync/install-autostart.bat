@echo off
title First Club Sync - Pasang
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Install dulu dari https://nodejs.org ^(versi LTS^), lalu jalankan file ini lagi.
  pause
  exit /b 1
)
echo Mengecek koneksi dan folder...
node first-club-sync.js --once
if errorlevel 1 (
  echo.
  echo Sync gagal. Lihat pesan di atas atau file sync.log.
  pause
  exit /b 1
)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
(
  echo Set sh = CreateObject^("WScript.Shell"^)
  echo sh.CurrentDirectory = "%~dp0"
  echo sh.Run "cmd /c node ""%~dp0first-club-sync.js""", 0, False
) > "%STARTUP%\First Club Sync.vbs"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*first-club-sync.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
wscript "%STARTUP%\First Club Sync.vbs"
echo.
echo Selesai. First Club Sync sekarang jalan di background dan otomatis aktif setiap Windows menyala.
echo Log: %~dp0sync.log
pause
