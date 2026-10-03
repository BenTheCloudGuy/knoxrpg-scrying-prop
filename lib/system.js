'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { run } = require('./exec');
const { getSetting } = require('./db');
const mq = require('./mq');
const log = require('./logger');

const ROOT = path.join(__dirname, '..');

// Kiosk environment — a systemd service has no display by default.
function kioskEnv() {
  return {
    ...process.env,
    DISPLAY: process.env.KIOSK_DISPLAY || getSetting('kiosk_display', ':0'),
    XAUTHORITY: process.env.KIOSK_XAUTHORITY || getSetting('kiosk_xauthority', `${os.homedir()}/.Xauthority`),
  };
}

function launcherUrl() {
  const port = Number(process.env.LAUNCHER_PORT) || 80;
  return port === 80 ? 'http://localhost/' : `http://localhost:${port}/`;
}

async function health() {
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let cpuTemp = null;
  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
    cpuTemp = Math.round((parseInt(raw, 10) / 1000) * 10) / 10;
  } catch (e) { /* not a Pi / no sensor */ }

  let throttled = null;
  const vc = await run('vcgencmd', ['get_throttled']);
  if (vc.ok) {
    const m = vc.stdout.trim().match(/throttled=(0x[0-9a-fA-F]+)/);
    if (m) {
      const bits = parseInt(m[1], 16);
      throttled = {
        raw: m[1],
        underVoltageNow: !!(bits & 0x1),
        throttledNow: !!(bits & 0x4),
        underVoltageOccurred: !!(bits & 0x10000),
        throttledOccurred: !!(bits & 0x40000),
      };
    }
  }

  let disk = null;
  const df = await run('df', ['-B1', '--output=size,used,avail,pcent', '/']);
  if (df.ok) {
    const line = df.stdout.trim().split('\n').pop().trim().split(/\s+/);
    if (line.length >= 4) {
      disk = { size: Number(line[0]), used: Number(line[1]), avail: Number(line[2]), pcent: line[3] };
    }
  }

  return {
    hostname: os.hostname(),
    uptime: Math.floor(os.uptime()),
    load: { '1m': load[0], '5m': load[1], '15m': load[2] },
    cpus: os.cpus().length,
    cpuTemp,
    throttled,
    memory: { total: totalMem, free: freeMem, used: totalMem - freeMem },
    disk,
    time: new Date().toISOString(),
  };
}

// journald logs for a service, with optional search.
async function serviceLogs(service, { lines = 200, q = '' } = {}) {
  if (!service) return { service, lines: [] };
  const res = await run('journalctl', ['-u', service, '-n', String(lines), '--no-pager', '-o', 'short-iso'], { timeout: 15000 });
  let out = res.ok ? res.stdout.split('\n').filter(Boolean) : [];
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((l) => l.toLowerCase().includes(needle));
  }
  return { service, count: out.length, lines: out, error: res.ok ? null : (res.stderr.trim() || null) };
}

async function reboot() {
  mq.publish('system.reboot', {});
  log.warn('system', 'reboot requested');
  const res = await run('sudo', ['-n', 'systemctl', 'reboot'], { timeout: 10000 });
  return { ok: res.ok, error: res.ok ? null : (res.stderr.trim() || 'reboot failed') };
}

async function shutdown() {
  mq.publish('system.shutdown', {});
  log.warn('system', 'shutdown requested');
  const res = await run('sudo', ['-n', 'systemctl', 'poweroff'], { timeout: 10000 });
  return { ok: res.ok, error: res.ok ? null : (res.stderr.trim() || 'shutdown failed') };
}

// Restart the launcher's own systemd service (if managed by systemd).
async function restartLauncher() {
  mq.publish('launcher.restart', {});
  const unit = process.env.LAUNCHER_SERVICE || getSetting('launcher_service', 'knoxrpg-launcher');
  const res = await run('sudo', ['-n', 'systemctl', 'restart', unit], { timeout: 10000 });
  return { ok: res.ok, error: res.ok ? null : (res.stderr.trim() || 'restart failed') };
}

// Update the launcher from its own git repo to the newest tag, then restart.
async function updateLauncher() {
  const games = require('./games');
  const latest = await games.remoteLatest(ROOT);
  if (!latest || !latest.tag) return { ok: false, error: 'no version tags found for launcher' };
  const checkout = await run('git', ['-C', ROOT, 'checkout', '--force', `tags/${latest.tag}`], { timeout: 30000 });
  if (!checkout.ok) return { ok: false, error: checkout.stderr.trim() || 'git checkout failed' };
  await run('npm', ['--prefix', ROOT, 'install', '--omit=dev', '--no-audit', '--no-fund'], { timeout: 300000 });
  mq.publish('launcher.updated', { version: latest.tag });
  const restart = await restartLauncher();
  return { ok: true, version: latest.tag, restarted: restart.ok };
}

async function launcherVersion() {
  const games = require('./games');
  const local = await games.localVersion(ROOT);
  const latest = await games.remoteLatest(ROOT);
  const updateAvailable = latest && latest.tag ? (local ? games.compareTags(latest.tag, local) > 0 : true) : false;
  return { localVersion: local, latest, updateAvailable };
}

// --- Firefox kiosk control ---
function killKiosk() {
  return run('pkill', ['-f', 'firefox.*--kiosk']);
}

async function relaunchKiosk(url) {
  const target = url || launcherUrl();
  await killKiosk();
  // Detach so the browser outlives this request.
  const { spawn } = require('child_process');
  try {
    const child = spawn('firefox', ['--kiosk', target, '--new-instance', '--no-remote'], {
      env: kioskEnv(), detached: true, stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    return { ok: false, error: e.message };
  }
  mq.publish('kiosk.relaunch', { url: target });
  return { ok: true, url: target };
}

async function returnToLauncher() {
  const games = require('./games');
  const { setSetting } = require('./db');
  // Stop whatever game is active, then point the kiosk at the launcher.
  const active = games.activeGame();
  if (active) {
    const g = games.findGame(active);
    if (g && g.service) await run('sudo', ['-n', 'systemctl', 'stop', g.service]);
    setSetting('active_game', '');
  }
  return relaunchKiosk(launcherUrl());
}

module.exports = {
  health,
  serviceLogs,
  reboot,
  shutdown,
  restartLauncher,
  updateLauncher,
  launcherVersion,
  killKiosk,
  relaunchKiosk,
  returnToLauncher,
  launcherUrl,
};
