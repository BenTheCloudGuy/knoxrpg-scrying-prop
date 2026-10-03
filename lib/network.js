'use strict';

const os = require('os');
const { run } = require('./exec');
const mq = require('./mq');

function primaryIp() {
  try {
    const ifaces = os.networkInterfaces();
    const order = Object.keys(ifaces).sort((a, b) => (b.startsWith('wl') ? 1 : 0) - (a.startsWith('wl') ? 1 : 0));
    for (const name of order) {
      for (const i of ifaces[name] || []) {
        if (i.family === 'IPv4' && !i.internal) return i.address;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

function allIps() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ iface: name, address: i.address });
    }
  }
  return out;
}

async function status() {
  const ip = primaryIp();
  const active = await run('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active']);
  let ssid = null;
  if (active.ok) {
    for (const line of active.stdout.split('\n')) {
      if (!line) continue;
      const [name, type] = line.split(':');
      if (type && type.includes('wireless')) { ssid = name; break; }
    }
  }
  const connected = !!ip && ip !== '127.0.0.1';
  return {
    connected,
    status: connected ? 'Connected' : 'Not Connected',
    ssid,
    ip: ip || 'unknown',
    ips: allIps(),
    hostname: os.hostname(),
  };
}

function splitNmcli(line) {
  // nmcli -t escapes ':' within fields as '\:'. Split on unescaped ':' only.
  return line.split(/(?<!\\):/).map((p) => p.replace(/\\:/g, ':'));
}

async function scan() {
  await run('nmcli', ['device', 'wifi', 'rescan'], { timeout: 15000 });
  const res = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list']);
  if (!res.ok) return { ok: false, error: res.stderr.trim() || 'nmcli scan failed', networks: [] };
  const seen = new Set();
  const networks = [];
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = splitNmcli(line);
    const inUse = (parts[0] || '').trim() === '*';
    const ssid = (parts[1] || '').trim();
    const signal = parseInt((parts[2] || '0').trim(), 10) || 0;
    const security = (parts[3] || '').trim();
    if (!ssid || seen.has(ssid)) continue;
    seen.add(ssid);
    networks.push({ ssid, signal, security: security || 'Open', secured: !!security, inUse });
  }
  networks.sort((a, b) => b.signal - a.signal);
  return { ok: true, networks };
}

async function connect(ssid, password) {
  const args = ['device', 'wifi', 'connect', ssid];
  if (password) args.push('password', password);
  const res = await run('nmcli', args, { timeout: 45000 });
  // Never log the password.
  mq.publish('wifi.connect', { ssid, ok: res.ok });
  return { ok: res.ok, error: res.ok ? null : (res.stderr.trim() || res.stdout.trim() || 'connection failed') };
}

module.exports = { status, scan, connect, primaryIp };
