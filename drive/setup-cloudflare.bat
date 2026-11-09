@echo off
title Evo Song Manager - Kunci Google ke Cloudflare
cd /d "%~dp0"
where npx >nul 2>nul
if errorlevel 1 (
  echo npx tidak ditemukan. Pasang ulang Node.js LTS dari https://nodejs.org lalu coba lagi.
  pause
  exit /b 1
)
node setup-cloudflare.js
pause
