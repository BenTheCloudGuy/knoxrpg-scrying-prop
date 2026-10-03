#!/bin/bash
# Stop the KnoxRPG Scrying Prop Launcher + Firefox kiosk.

PID_FILE="/tmp/knoxrpg-launcher.pid"

if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    echo "Launcher stopped (PID $PID)"
  else
    echo "Launcher was not running"
  fi
  rm -f "$PID_FILE"
else
  pkill -f "node server.js" 2>/dev/null
  echo "Launcher stopped"
fi

pkill -f "firefox.*--kiosk" 2>/dev/null
echo "Firefox stopped"
