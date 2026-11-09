@echo off
title Evo Media Agent - Cek sekarang
cd /d "%~dp0"
node evo-media-agent.js --once
pause
