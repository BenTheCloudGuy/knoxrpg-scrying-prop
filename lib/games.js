'use strict';

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { run } = require('./exec');
const { getSetting, setSetting } = require('./db');
const mq = require('./mq');
const log = require('./logger');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = process.env.GAME_CONFIG || path.join(ROOT, 'game_config.yml');

function loadGames() {
  try {
    const doc = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
    const list = Array.isArray(doc.games) ? doc.games : [];
    return list.filter((g) => g && g.id && g.path);
  } catch (e) {
    log.error('games', 'failed to read game_config.yml', { error: e.message });
    return [];
  }
}

function findGame(id) {
  return loadGames().find((g) => g.id === id) || null;
}

// --- Version / tag comparison ---
const SEMVER_RE = /^v?\d+(\.\d+)*$/;

function compareTags(a, b) {
  const norm = (t) => String(t).replace(/^v/i, '').split(/[.\-+]/).map((n) => parseInt(n, 10));
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function pickLatest(tags) {
  const valid = tags.filter((t) => SEMVER_RE.test(t));
  if (!valid.length) return null;
  valid.sort(compareTags);
  return valid[valid.length - 1];
}

async function localVersion(gamePath) {
  const exact = await run('git', ['-C', gamePath, 'describe', '--tags', '--exact-match']);
  if (exact.ok && exact.stdout.trim()) return exact.stdout.trim();
  const nearest = await run('git', ['-C', gamePath, 'describe', '--tags', '--abbrev=0']);
  if (nearest.ok && nearest.stdout.trim()) return nearest.stdout.trim();
  return null;
}

async function remoteLatest(gamePath) {
  await run('git', ['-C', gamePath, 'fetch', '--tags', '--force', '--quiet'], { timeout: 30000 });
  const tagsRes = await run('git', ['-C', gamePath, 'tag', '--list']);
  if (!tagsRes.ok) return null;
  const latest = pickLatest(tagsRes.stdout.split('\n').map((t) => t.trim()).filter(Boolean));
  if (!latest) return null;
  const meta = await run('git', ['-C', gamePath, 'log', '-1', '--format=%ci%n%s', `${latest}^{commit}`]);
  let date = null;
  let message = null;
  if (meta.ok) {
    const lines = meta.stdout.split('\n');
    date = (lines[0] || '').trim() || null;
    message = lines.slice(1).join('\n').trim() || null;
  }
  return { tag: latest, date, message };
}

// --- systemd service control ---
async function serviceState(service) {
  if (!service) return { active: 'unknown', enabled: 'unknown', uptime: null };
  const active = await run('systemctl', ['is-active', service]);
  const enabled = await run('systemctl', ['is-enabled', service]);
  const prop = await run('systemctl', ['show', service, '--property=ActiveEnterTimestamp', '--value']);
  let uptime = null;
  if (prop.ok && prop.stdout.trim()) {
    const since = Date.parse(prop.stdout.trim());
    if (Number.isFinite(since)) uptime = Math.max(0, Math.floor((Date.now() - since) / 1000));
  }
  return { active: active.stdout.trim() || 'inactive', enabled: enabled.stdout.trim() || 'disabled', uptime };
}

async function systemctl(action, service) {
  return run('sudo', ['-n', 'systemctl', action, service], { timeout: 30000 });
}

const ACTIVE_GAME_KEY = 'active_game';
function activeGame() { return getSetting(ACTIVE_GAME_KEY, null); }

async function describeGame(g) {
  const installed = fs.existsSync(path.join(g.path, '.git'));
  const state = await serviceState(g.service);
  let local = null;
  let latest = null;
  let updateAvailable = false;
  if (installed) {
    local = await localVersion(g.path);
    latest = await remoteLatest(g.path);
    if (latest && latest.tag) updateAvailable = local ? compareTags(latest.tag, local) > 0 : true;
  }
  return {
    id: g.id,
    name: g.name || g.id,
    repo: g.repo || null,
    path: g.path,
    service: g.service || null,
    installed,
    active: state.active,
    enabled: state.enabled,
    uptime: state.uptime,
    onKiosk: activeGame() === g.id,
    localVersion: local,
    latest,
    updateAvailable,
  };
}

async function listGames() {
  return Promise.all(loadGames().map(describeGame));
}

// Start a game: stop other game services, start this one, mark it active.
async function launchGame(id) {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'unknown game' };
  if (!g.service) return { ok: false, error: 'no service configured' };
  for (const other of loadGames()) {
    if (other.id !== g.id && other.service) await systemctl('stop', other.service);
  }
  const res = await systemctl('restart', g.service);
  if (!res.ok) return { ok: false, error: res.stderr.trim() || 'failed to start service' };
  setSetting(ACTIVE_GAME_KEY, g.id);
  mq.publish('game.launched', { id: g.id, service: g.service });
  log.info('games', `launched ${g.id}`);
  return { ok: true, service: g.service };
}

async function stopGame(id) {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'unknown game' };
  if (!g.service) return { ok: false, error: 'no service configured' };
  const res = await systemctl('stop', g.service);
  if (activeGame() === g.id) setSetting(ACTIVE_GAME_KEY, '');
  mq.publish('game.stopped', { id: g.id, service: g.service });
  return { ok: res.ok, error: res.ok ? null : (res.stderr.trim() || 'failed to stop') };
}

async function restartGame(id) {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'unknown game' };
  if (!g.service) return { ok: false, error: 'no service configured' };
  const res = await systemctl('restart', g.service);
  mq.publish('game.restarted', { id: g.id, service: g.service });
  return { ok: res.ok, error: res.ok ? null : (res.stderr.trim() || 'failed to restart') };
}

async function setAutostart(id, enable) {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'unknown game' };
  if (!g.service) return { ok: false, error: 'no service configured' };
  const res = await systemctl(enable ? 'enable' : 'disable', g.service);
  mq.publish('game.autostart', { id: g.id, enabled: !!enable });
  return { ok: res.ok, enabled: !!enable, error: res.ok ? null : (res.stderr.trim() || 'failed') };
}

async function updateGame(id) {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'unknown game' };
  if (!fs.existsSync(path.join(g.path, '.git'))) return { ok: false, error: 'game repo not present at ' + g.path };

  const latest = await remoteLatest(g.path);
  if (!latest || !latest.tag) return { ok: false, error: 'no version tags found on remote' };

  const checkout = await run('git', ['-C', g.path, 'checkout', '--force', `tags/${latest.tag}`], { timeout: 30000 });
  if (!checkout.ok) return { ok: false, error: checkout.stderr.trim() || 'git checkout failed' };

  if (fs.existsSync(path.join(g.path, 'package.json'))) {
    await run('npm', ['--prefix', g.path, 'install', '--omit=dev', '--no-audit', '--no-fund'], { timeout: 300000 });
  }

  let restarted = false;
  if (g.service) restarted = (await systemctl('restart', g.service)).ok;
  mq.publish('game.updated', { id: g.id, version: latest.tag });
  log.info('games', `updated ${g.id} -> ${latest.tag}`);
  return { ok: true, version: latest.tag, restarted };
}

module.exports = {
  loadGames,
  findGame,
  compareTags,
  pickLatest,
  localVersion,
  remoteLatest,
  serviceState,
  listGames,
  describeGame,
  launchGame,
  stopGame,
  restartGame,
  setAutostart,
  updateGame,
  activeGame,
};
