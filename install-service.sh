#!/bin/bash
# Install the KnoxRPG Launcher as a systemd service and grant the narrow sudo
# permissions it needs to start/stop/restart game services.
#
# Run with: sudo ./install-service.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="${SUDO_USER:-benthebuilder}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo ./install-service.sh"
  exit 1
fi

echo "==> Installing npm dependencies"
sudo -u "$SERVICE_USER" npm --prefix "$APP_DIR" install --omit=dev --no-audit --no-fund

echo "==> Installing systemd unit (knoxrpg-launcher.service)"
install -m 0644 "$APP_DIR/knoxrpg-launcher.service" /etc/systemd/system/knoxrpg-launcher.service

# Narrow sudoers rule: the launcher only needs systemctl control of game services.
# nmcli scan/connect is handled by polkit for the console user and does NOT use sudo.
echo "==> Writing sudoers rule for game service + power control"
SUDOERS=/etc/sudoers.d/knoxrpg-launcher
cat > "$SUDOERS" <<EOF
# Allow the launcher user to control prop game services and Pi power state without a password.
$SERVICE_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start *, /usr/bin/systemctl stop *, /usr/bin/systemctl restart *, /usr/bin/systemctl enable *, /usr/bin/systemctl disable *, /usr/bin/systemctl is-active *, /usr/bin/systemctl is-enabled *, /usr/bin/systemctl show *, /usr/bin/systemctl reboot, /usr/bin/systemctl poweroff
EOF
chmod 0440 "$SUDOERS"
visudo -cf "$SUDOERS"

echo "==> Reloading systemd and enabling the launcher"
systemctl daemon-reload
systemctl enable knoxrpg-launcher.service
systemctl restart knoxrpg-launcher.service

echo "Done. Launcher on http://localhost (admin at /admin.html)"
echo "Check status: systemctl status knoxrpg-launcher.service"
