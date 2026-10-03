# knoxrpg-scrying-prop

Launcher for the KnoxRPG scrying-stone prop — a Raspberry Pi touchscreen that boots
into a full-screen menu for selecting, launching, and updating prop *games*, with an
admin portal for service control, system health, logs, and WiFi.

The display sits behind a foam aperture, so the UI is laid out in a fixed 1920×1080
space and kept inside a measured safe area. See `hardware_info.md`.

## Features

- **Game selection** — lists games from `game_config.yml`, shows the installed version
  (git tag), and launches the selected game as a systemd service.
- **Updates** — compares the local tag against the newest semver tag in each game's
  GitHub repo and offers a one-click update (checkout tag → `npm install` → restart).
- **Admin portal** (`/admin.html`) — username/password login, then:
  - start / stop / restart games and toggle auto-start on boot
  - per-game status (active/inactive/failed, uptime, which game is on the kiosk)
  - journald log viewer with search, plus the launcher's own rotating log files
  - launcher restart and self-update
  - kiosk control (return to launcher, relaunch or kill Firefox)
  - system health (CPU temp, load, memory, disk, throttling, uptime) and reboot/shutdown
  - WiFi status, scan, and connect
- **Live events** — a WebSocket stream pushes activity to the admin portal in real time.

## Requirements

- Raspberry Pi OS (arm64), Raspberry Pi 4/5
- Node.js 18+
- NetworkManager (`nmcli`) for WiFi
- Firefox (kiosk mode)
- A C toolchain is only needed if `better-sqlite3` has no prebuilt binary for your
  platform (`sudo apt install build-essential python3`).

## Install

```bash
npm install
```

To run as a boot service on the Pi:

```bash
sudo ./install-service.sh
```

This installs the systemd unit, grants a narrow passwordless-sudo rule for service and
power control, enables the service, and starts it on port 80.

Alternatively, use the idempotent deployment (installs apt packages, dependencies, unit,
sudoers, and settings):

```bash
sudo deploy/deploy.sh
```

## Run

```bash
# Production: served on port 80 (needs the systemd capability or root)
sudo ./start.sh

# Development on a high port
LAUNCHER_PORT=8080 npm start
```

- Kiosk landing: `http://localhost/`
- Admin portal: `http://localhost/admin.html`

## Admin credentials

A default admin user is seeded on first run. Override before first start with
environment variables:

```bash
ADMIN_USER=Admin ADMIN_PASSWORD='change-me' npm start
```

Passwords are stored as scrypt hashes in SQLite (`data/launcher.db`). The database and
logs are git-ignored. Change the default password after deployment.

## Games

Games are declared in `game_config.yml`. Each entry points at an existing checkout of
the game's own repo; the launcher controls it by systemd service and updates it in place.

```yaml
games:
  - id: dungeon-runner
    name: Dungeon Runner
    repo: https://github.com/BenTheCloudGuy/knoxrpg-netheril-prop
    path: /home/benthebuilder/knoxrpg-netheril-prop
    service: netheril
    start: ./start.sh
```

| Field | Purpose |
|---|---|
| `id` | stable identifier used in the API and URLs |
| `name` | label shown in the launcher |
| `repo` | GitHub repo checked for newer version tags |
| `path` | local checkout the launcher controls and updates |
| `service` | systemd unit for start/stop/restart |
| `start` | start script in the repo (reference) |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LAUNCHER_PORT` | `80` | HTTP port |
| `LAUNCHER_DB` | `data/launcher.db` | SQLite database path |
| `GAME_CONFIG` | `game_config.yml` | game registry path |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `Admin` / seeded | initial admin account |
| `KIOSK_DISPLAY` | `:0` | X display for Firefox control |
| `KIOSK_XAUTHORITY` | `~/.Xauthority` | X authority for Firefox control |
| `LAUNCHER_SERVICE` | `knoxrpg-launcher` | systemd unit for self-restart |

Runtime settings (kiosk display, active game, etc.) are stored in the `settings` table
and can be seeded via `deploy/deploy.yaml`.

## Layout

```
server.js              HTTP + WebSocket server, route wiring
lib/
  db.js                SQLite schema and settings helpers
  auth.js              scrypt password hashing, sessions, auth middleware
  games.js             game registry, service control, version/update logic
  system.js            health, journald logs, reboot/shutdown, kiosk control
  network.js           nmcli status / scan / connect
  mq.js                in-process pub/sub + event persistence
  logger.js            rotating per-start log files + search
  exec.js              safe command runner (argument arrays only)
public/
  index.html           kiosk landing (game selection)
  admin.html           admin portal
  wifi.html            touchscreen WiFi page
config/
  screen-aperture.json foam aperture polygon + safe insets
game_config.yml        game registry
deploy/                YAML-driven idempotent deployment
test/                  unit tests (node --test)
```

## Tests

```bash
npm test
```
