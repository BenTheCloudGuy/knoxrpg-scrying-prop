#!/usr/bin/env bash
# KnoxRPG Scrying Prop — idempotent deployment.
# Reads deploy/deploy.yaml and brings the Pi to the desired state. Safe to re-run.
#
#   sudo deploy/deploy.sh [--no-restart]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
YAML="$HERE/deploy.yaml"
NO_RESTART=0
[[ "${1:-}" == "--no-restart" ]] && NO_RESTART=1

if [[ $EUID -ne 0 ]]; then
  echo "This script must run as root: sudo deploy/deploy.sh" >&2
  exit 1
fi

log()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
skip() { printf '    \033[90m•\033[0m %s (already current)\n' "$*"; }

# Read a scalar / list from deploy.yaml using the Node + js-yaml already vendored.
yget() {
  node -e '
    const y = require("js-yaml"); const fs = require("fs");
    const d = y.load(fs.readFileSync(process.argv[1], "utf8")) || {};
    const v = process.argv[2].split(".").reduce((a, k) => (a == null ? a : a[k]), d);
    if (Array.isArray(v)) console.log(v.join("\n"));
    else if (v && typeof v === "object") console.log(Object.entries(v).map(([k, val]) => k + "=" + val).join("\n"));
    else if (v != null) console.log(v);
  ' "$YAML" "$1"
}

SERVICE="$(yget launcher.service_name)"
RUN_USER="$(yget launcher.user)"
WORKDIR="$(yget launcher.workdir)"
PORT="$(yget launcher.port)"

# 1) APT packages — install only those missing.
log "APT packages"
MISSING=()
while IFS= read -r pkg; do
  [[ -z "$pkg" ]] && continue
  if dpkg -s "$pkg" >/dev/null 2>&1; then skip "$pkg"; else MISSING+=("$pkg"); fi
done < <(yget apt_packages)
if [[ ${#MISSING[@]} -gt 0 ]]; then
  apt-get update -qq
  apt-get install -y "${MISSING[@]}"
  ok "installed: ${MISSING[*]}"
fi

# 2) Node dependencies.
log "Node dependencies"
sudo -u "$RUN_USER" npm --prefix "$WORKDIR" install --omit=dev --no-audit --no-fund >/dev/null
ok "npm dependencies present"

# 3) systemd unit — copy only if changed.
log "systemd unit ($SERVICE)"
UNIT_SRC="$ROOT/${SERVICE}.service"
UNIT_DST="/etc/systemd/system/${SERVICE}.service"
if [[ ! -f "$UNIT_SRC" ]]; then
  echo "    missing unit file: $UNIT_SRC" >&2; exit 1
fi
if [[ ! -f "$UNIT_DST" ]] || ! cmp -s "$UNIT_SRC" "$UNIT_DST"; then
  install -m 0644 "$UNIT_SRC" "$UNIT_DST"
  systemctl daemon-reload
  ok "unit installed/updated"
else
  skip "unit"
fi

# 4) sudoers — managed block, validated before install.
log "sudoers"
SUDOERS_FILE="$(yget sudoers.file)"
TMP_SUDO="$(mktemp)"
cat > "$TMP_SUDO" <<EOF
# Managed by KnoxRPG deploy.sh — do not edit by hand.
# Launcher controls prop game services and Pi power state without a password.
$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start *, /usr/bin/systemctl stop *, /usr/bin/systemctl restart *, /usr/bin/systemctl enable *, /usr/bin/systemctl disable *, /usr/bin/systemctl is-active *, /usr/bin/systemctl is-enabled *, /usr/bin/systemctl show *, /usr/bin/systemctl reboot, /usr/bin/systemctl poweroff
EOF
chmod 0440 "$TMP_SUDO"
if visudo -cf "$TMP_SUDO" >/dev/null; then
  if [[ ! -f "$SUDOERS_FILE" ]] || ! cmp -s "$TMP_SUDO" "$SUDOERS_FILE"; then
    install -m 0440 "$TMP_SUDO" "$SUDOERS_FILE"
    ok "sudoers installed/updated"
  else
    skip "sudoers"
  fi
else
  rm -f "$TMP_SUDO"; echo "    sudoers validation failed" >&2; exit 1
fi
rm -f "$TMP_SUDO"

# 5) Settings — upsert into the launcher SQLite DB (idempotent).
log "settings"
SETTINGS="$(yget settings)"
if [[ -n "$SETTINGS" ]]; then
  while IFS= read -r kv; do
    [[ -z "$kv" ]] && continue
    key="${kv%%=*}"; val="${kv#*=}"
    sudo -u "$RUN_USER" node -e '
      const { setSetting } = require(process.argv[1] + "/lib/db");
      setSetting(process.argv[2], process.argv[3]);
    ' "$WORKDIR" "$key" "$val"
    ok "setting $key"
  done <<< "$SETTINGS"
fi

# 6) Enable + (re)start.
log "service state"
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
if [[ $NO_RESTART -eq 0 ]]; then
  systemctl restart "$SERVICE"
  ok "$SERVICE (re)started on port $PORT"
else
  skip "restart skipped (--no-restart)"
fi

log "Deployment complete."
