# KnoxRPG Scrying Prop — Launcher

This repository is the **LauncherApp** for the KnoxRPG scrying-stone prop: a Raspberry Pi
touchscreen "boot menu" that selects, launches, and updates individual prop *games*
(e.g. Dungeon Runner). It runs full-screen in a Firefox kiosk.

## Golden rules

- **If an instruction is vague or unclear, ASK before implementing.** Do not guess at
  destructive behaviour (git checkout/reset, systemctl, nmcli changes).
- Keep changes minimal and scoped. Don't add features that weren't requested.
- Never introduce shell-injection: always invoke `git`, `nmcli`, and `systemctl` with
  `execFile`/`spawn` **argument arrays**, never string-interpolated shell commands.

## What this app does

1. **Game selection** — reads `game_config.yml`, shows each game, its locally checked-out
   version (git tag), and launches it.
2. **Updates** — compares the local checked-out tag against the newest semver tag in the
   game's GitHub repo. If newer, shows the tag + commit message + release date and an
   Update button that fetches/checks out the tag and restarts the game's service.
3. **WiFi** — shows connection status + IP, lists available networks, and connects to a
   chosen SSID (touchscreen-friendly). Uses NetworkManager (`nmcli`).

## Architecture

- `server.js` — Express server on port **80** (dev: set `LAUNCHER_PORT`). REST API + a
  WebSocket at `/ws`. No build step.
- `lib/` — `db` (SQLite), `auth` (scrypt + sessions), `games` (registry + service
  control + version/update), `system` (health, journald logs, reboot, kiosk), `network`
  (nmcli), `mq` (pub/sub event bus persisted to SQLite), `logger` (rotating logs),
  `exec` (safe command runner).
- `game_config.yml` — the single source of truth for games (id, name, repo, path, service).
- `public/` — static UI: `index.html` (kiosk landing), `admin.html` (admin portal),
  `wifi.html`. Vanilla JS, no framework.
- `config/screen-aperture.json` — physical foam-aperture polygon + safe insets. **All
  kiosk UI must stay inside these bounds** (see Screen constraints).
- `data/` (SQLite) and `logs/` are runtime state and git-ignored.

### Admin portal

- `/admin.html` is protected by username/password (scrypt hash in SQLite `users`).
  Sessions are random tokens in the `sessions` table, carried in an httpOnly cookie.
- All `/api/admin/*` routes and the `/ws` stream require a valid session.
- The kiosk landing may launch games (trusted LAN); everything else is admin-only.


### Games model

- Each game lives in **its own repo directory** (the `path` in `game_config.yml`), not a
  subfolder of this launcher. Dungeon Runner = `/home/benthebuilder/knoxrpg-netheril-prop`.
- Launch / stop / restart is done via **systemd** (`systemctl <action> <service>`).
- Update = `git fetch --tags` in the game's `path`, checkout the latest tag, then
  `systemctl restart <service>`.

## Screen constraints (CRITICAL)

Display is **1920×1080**, shown through an irregular foam aperture. Only content inside the
aperture polygon is visible. Honour the safe insets from `config/screen-aperture.json`:

- top 150px, right 195px, bottom 165px, left 165px.

Design in a 1920×1080 space, keep all interactive/important content within the safe box, and
scale/letterbox to fit. Source of truth: `hardware_info.md` → `## Screen` section.

## Privileges

- `nmcli` and `systemctl` calls generally require root. The deployment expects passwordless
  sudo for the specific commands, or the launcher runs as a root systemd service.
- SSH auth to GitHub is pre-configured via `~/.ssh/config`; `auth` in `game_config.yml` is
  optional and usually omitted.

## Conventions

- Node 18+, CommonJS, 2-space indent, `'use strict'`.
- No secrets in the repo. WiFi passwords are passed straight to `nmcli` and never logged.
