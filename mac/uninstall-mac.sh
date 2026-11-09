#!/bin/bash
# Matikan First Club Sync + Evo Media Agent di MacBook dan lepas dari login.
for l in id.evolution.firstclub.sync id.evolution.firstclub.media; do
  launchctl bootout "gui/$(id -u)/$l" >/dev/null 2>&1
  rm -f "$HOME/Library/LaunchAgents/$l.plist"
done
DIR="$(cd "$(dirname "$0")" && pwd)"
rm -f "$DIR/sync/supervisor.pid" "$DIR/drive/supervisor.pid"
echo "Dimatikan dan tidak jalan otomatis lagi."
