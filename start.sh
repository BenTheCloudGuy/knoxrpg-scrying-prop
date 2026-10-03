#!/bin/bash
# Start the KnoxRPG Scrying Prop Launcher + Firefox kiosk pointed at it.

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${LAUNCHER_PORT:-80}"
URL="http://localhost:${PORT}"
PID_FILE="/tmp/knoxrpg-launcher.pid"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Launcher already running (PID $(cat "$PID_FILE"))"
  exit 1
fi

cd "$APP_DIR"
node server.js &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Wait for the launcher to answer.
for _ in {1..30}; do
  curl -s -o /dev/null "$URL" 2>/dev/null && break
  sleep 0.5
done

DISPLAY=:0 firefox --kiosk "$URL" --new-instance --no-remote 2>/dev/null &
FIREFOX_PID=$!

echo "KnoxRPG Launcher started"
echo "  Server PID:  $SERVER_PID  ($URL)"
echo "  Firefox PID: $FIREFOX_PID"
echo "Run ./stop.sh to quit."
