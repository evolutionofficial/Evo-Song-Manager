#!/bin/bash
# Evo Song Manager — pasang First Club Sync + Evo Media Agent di MacBook.
# Jalankan dari Terminal:  bash ~/Documents/First\ Club/_First\ Club\ Manager/install-mac.sh
# Aman dijalankan ulang (mis. setelah update). Program jalan di background & menyala sendiri saat login.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC="$DIR/sync"; MEDIA="$DIR/drive"
LA="$HOME/Library/LaunchAgents"
UIDN="$(id -u)"

NODE="$(command -v node || true)"
for c in /usr/local/bin/node /opt/homebrew/bin/node; do [ -z "$NODE" ] && [ -x "$c" ] && NODE="$c"; done
if [ -z "$NODE" ]; then
  echo "Node.js belum terpasang. Unduh versi LTS (macOS Installer .pkg) dari https://nodejs.org, pasang, lalu jalankan perintah ini lagi."
  exit 1
fi
echo "Node.js: $NODE ($("$NODE" -v))"

missing=0
[ -f "$SYNC/config.json" ] || { echo "BELUM ADA: sync/config.json — salin dari PC (D:\\FIRST CLUB\\_First Club Manager\\sync\\config.json)."; missing=1; }
[ -f "$MEDIA/r2.txt" ] || { echo "BELUM ADA: drive/r2.txt — salin dari PC (D:\\FIRST CLUB\\_First Club Manager\\drive\\r2.txt)."; missing=1; }
[ "$missing" = 1 ] && exit 1

echo
echo "== Cek First Club Sync =="
( cd "$SYNC" && "$NODE" first-club-sync.js --once ) || { echo; echo "Sync gagal. Lihat pesan di atas atau sync/sync.log."; exit 1; }
echo
echo "== Cek Evo Media Agent =="
( cd "$MEDIA" && "$NODE" evo-media-agent.js --once ) || { echo; echo "Media Agent gagal. Lihat pesan di atas atau drive/media.log."; exit 1; }

mkdir -p "$LA"
install_agent () { # label folder script
  local label="$1" wd="$2" script="$3" plist="$LA/$1.plist"
  launchctl bootout "gui/$UIDN/$label" >/dev/null 2>&1 && sleep 1
  rm -f "$wd/supervisor.pid"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$wd/$script</string></array>
  <key>WorkingDirectory</key><string>$wd</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>$wd/launchd-error.log</string>
</dict></plist>
PLIST
  # launchd kadang butuh sebentar setelah bootout; coba beberapa kali.
  for i in 1 2 3 4 5; do
    launchctl bootstrap "gui/$UIDN" "$plist" 2>/dev/null && return 0
    sleep 1
  done
  launchctl kickstart -k "gui/$UIDN/$label" >/dev/null 2>&1 && return 0
  echo "Peringatan: $label belum bisa dijalankan otomatis. Jalankan perintah ini sekali lagi."
}
install_agent id.evolution.firstclub.sync "$SYNC" first-club-supervisor.js
install_agent id.evolution.firstclub.media "$MEDIA" evo-media-supervisor.js

echo
echo "Selesai. First Club Sync dan Evo Media Agent sekarang jalan di background,"
echo "dijaga otomatis, dan aktif setiap kali kamu login ke MacBook."
echo "Kalau muncul pertanyaan \"node ingin mengakses folder Documents\", klik Allow."
echo "Log: $SYNC/sync.log  dan  $MEDIA/media.log"
