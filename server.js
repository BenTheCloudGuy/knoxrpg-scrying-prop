'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const log = require('./lib/logger');
const auth = require('./lib/auth');
const games = require('./lib/games');
const system = require('./lib/system');
const network = require('./lib/network');
const mq = require('./lib/mq');

const PORT = Number(process.env.LAUNCHER_PORT) || 80;
const ROOT = __dirname;
const APERTURE_FILE = path.join(ROOT, 'config', 'screen-aperture.json');

const app = express();
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

function sendResult(res, result) {
  if (result && result.ok === false) {
    return res.status(result.error === 'unknown game' ? 404 : 500).json(result);
  }
  res.json(result);
}

// ---------------------------------------------------------------------------
// Public (kiosk) endpoints
// ---------------------------------------------------------------------------
app.get('/api/aperture', (_req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(APERTURE_FILE, 'utf8')));
  } catch (e) {
    res.json({ designWidth: 1920, designHeight: 1080, safe: { top: 150, right: 195, bottom: 165, left: 165 }, polygon: [] });
  }
});

app.get('/api/network', async (_req, res) => res.json(await network.status()));
app.get('/api/wifi/scan', async (_req, res) => res.json(await network.scan()));
app.post('/api/wifi/connect', async (req, res) => {
  const ssid = req.body && typeof req.body.ssid === 'string' ? req.body.ssid.trim() : '';
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!ssid) return res.status(400).json({ ok: false, error: 'ssid required' });
  const result = await network.connect(ssid, password);
  res.status(result.ok ? 200 : 502).json({ ...result, network: await network.status() });
});

app.get('/api/games', async (_req, res) => {
  res.json({ prop: 'KnoxRPG Scrying Prop', games: await games.listGames() });
});

// Players launch a game from the kiosk landing page. Stop/update/system controls
// are admin-only (see /api/admin). Launch is allowed on the trusted prop LAN.
app.post('/api/games/:id/launch', async (req, res) => sendResult(res, await games.launchGame(req.params.id)));

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'username and password required' });
  const session = auth.login(String(username), String(password));
  if (!session) {
    log.warn('auth', 'failed login attempt', { username: String(username) });
    return res.status(401).json({ ok: false, error: 'invalid credentials' });
  }
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=${session.token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(session.maxAge / 1000)}`);
  log.info('auth', `login ok: ${session.username}`);
  res.json({ ok: true, username: session.username });
});

app.post('/api/auth/logout', (req, res) => {
  auth.logout(auth.tokenFromReq(req));
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = auth.validate(auth.tokenFromReq(req));
  if (!session) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: session.username });
});

// ---------------------------------------------------------------------------
// Admin API (all protected)
// ---------------------------------------------------------------------------
const admin = express.Router();
admin.use(auth.requireAuth);

// Games
admin.get('/games', async (_req, res) => res.json({ games: await games.listGames() }));
admin.post('/games/:id/launch', async (req, res) => sendResult(res, await games.launchGame(req.params.id)));
admin.post('/games/:id/stop', async (req, res) => sendResult(res, await games.stopGame(req.params.id)));
admin.post('/games/:id/restart', async (req, res) => sendResult(res, await games.restartGame(req.params.id)));
admin.post('/games/:id/update', async (req, res) => sendResult(res, await games.updateGame(req.params.id)));
admin.post('/games/:id/autostart', async (req, res) => {
  const enable = !!(req.body && req.body.enabled);
  sendResult(res, await games.setAutostart(req.params.id, enable));
});
admin.get('/games/:id/logs', async (req, res) => {
  const g = games.findGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'unknown game' });
  const lines = Math.min(1000, Number(req.query.lines) || 200);
  res.json(await system.serviceLogs(g.service, { lines, q: String(req.query.q || '') }));
});

// Launcher + kiosk
admin.get('/launcher/version', async (_req, res) => res.json(await system.launcherVersion()));
admin.post('/launcher/restart', async (_req, res) => sendResult(res, await system.restartLauncher()));
admin.post('/launcher/update', async (_req, res) => sendResult(res, await system.updateLauncher()));
admin.post('/kiosk/relaunch', async (req, res) => sendResult(res, await system.relaunchKiosk(req.body && req.body.url)));
admin.post('/kiosk/kill', async (_req, res) => sendResult(res, await system.killKiosk()));
admin.post('/kiosk/return', async (_req, res) => sendResult(res, await system.returnToLauncher()));

// System
admin.get('/system/health', async (_req, res) => res.json(await system.health()));
admin.post('/system/reboot', async (_req, res) => sendResult(res, await system.reboot()));
admin.post('/system/shutdown', async (_req, res) => sendResult(res, await system.shutdown()));

// Launcher log files
admin.get('/logs/files', (_req, res) => res.json({ files: log.listFiles() }));
admin.get('/logs', (req, res) => {
  res.json(log.read({
    file: req.query.file ? String(req.query.file) : undefined,
    q: String(req.query.q || ''),
    limit: Math.min(1000, Number(req.query.limit) || 200),
    offset: Math.max(0, Number(req.query.offset) || 0),
  }));
});

// Network
admin.get('/network', async (_req, res) => res.json(await network.status()));
admin.get('/wifi/scan', async (_req, res) => res.json(await network.scan()));
admin.post('/wifi/connect', async (req, res) => {
  const ssid = req.body && typeof req.body.ssid === 'string' ? req.body.ssid.trim() : '';
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  if (!ssid) return res.status(400).json({ ok: false, error: 'ssid required' });
  const result = await network.connect(ssid, password);
  res.status(result.ok ? 200 : 502).json({ ...result, network: await network.status() });
});

// Events from the message queue
admin.get('/events', (req, res) => {
  res.json({ events: mq.recent({ topic: String(req.query.topic || ''), limit: Math.min(500, Number(req.query.limit) || 100) }) });
});

app.use('/api/admin', admin);

// ---------------------------------------------------------------------------
// WebSocket bridge — streams live MQ events to authenticated admin clients.
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url || !req.url.startsWith('/ws')) { socket.destroy(); return; }
  const session = auth.validate(auth.tokenFromReq(req));
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, session));
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ topic: 'hello', payload: { recent: mq.recent({ limit: 25 }) } }));
  ws.on('error', (e) => log.error('ws', e.message));
});

const unsubscribe = mq.subscribe((event) => {
  const data = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch (e) { /* ignore */ }
    }
  }
});

server.listen(PORT, () => {
  log.info('server', `KnoxRPG launcher listening on port ${PORT}`);
  console.log(`KnoxRPG Scrying Prop launcher on ${system.launcherUrl()} (admin at /admin.html)`);
});

function shutdownGracefully() {
  unsubscribe();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdownGracefully);
process.on('SIGINT', shutdownGracefully);
