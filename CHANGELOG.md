# Changelog

All notable changes to the KnoxRPG Scrying Prop launcher are recorded here. The
top-most version under `##` is the current release; the CI workflow reads it to
create the matching git tag after tests pass.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-03

### Added
- Admin portal (`/admin.html`) with username/password auth backed by SQLite.
- Game service control: start, stop, restart, enable/disable auto-start.
- Per-game status (active/inactive/failed, uptime, on-kiosk indicator) and journald log viewer with search.
- Per-game update flow using the newest semver git tag, with current-vs-available display.
- Launcher self-management: restart and self-update from its own repo.
- Kiosk control: relaunch Firefox, kill Firefox, return to launcher.
- System panel: CPU temperature, load, memory, disk, throttling, uptime; reboot and shutdown.
- WiFi management inside the admin portal (status, scan, connect).
- SQLite storage for settings, users, sessions, and events.
- In-process message queue (`lib/mq.js`) with a WebSocket bridge streaming live events to the admin portal.
- Rotating launcher log files (new file per start) with a searchable viewer.
- YAML-driven, idempotent deployment (`deploy/deploy.sh` + `deploy/deploy.yaml`).
- Unit tests for version comparison, auth, message queue, and settings.

### Changed
- Launcher now serves on port 80 (systemd uses `CAP_NET_BIND_SERVICE`).
- Server refactored into `lib/` modules (db, auth, games, system, network, mq, logger).
- Landing page reduced to player actions (launch + WiFi); control moved to the admin portal.

## [1.0.0] - 2026-10-03

### Added
- Initial launcher: game registry (`game_config.yml`), landing page, WiFi page, screen-aperture handling.
