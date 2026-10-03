// KnoxRPG Admin portal client.
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let ws = null;
  let busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  async function api(path, opts) {
    const res = await fetch('/api/admin' + path, opts);
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    return res;
  }
  async function post(path, body) {
    const res = await api(path, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => ({}));
  }
  async function get(path) { return (await api(path)).json(); }

  function fmtDuration(sec) {
    if (sec == null) return '—';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }

  // ---- Auth ----
  function showLogin() { $('#login').style.display = 'flex'; $('#dash').hidden = true; if (ws) { ws.close(); ws = null; } }
  function showDash(username) {
    $('#login').style.display = 'none';
    $('#dash').hidden = false;
    $('#whoami').textContent = username ? `@${username}` : '';
    connectWs();
    loadGames();
    loadSystem();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#username').value.trim();
    const password = $('#password').value;
    $('#login-msg').textContent = 'Signing in…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) { $('#login-msg').textContent = ''; $('#password').value = ''; showDash(body.username); }
      else { $('#login-msg').textContent = body.error || 'Login failed'; }
    } catch (e) { $('#login-msg').textContent = 'Error: ' + e.message; }
  });

  $('#logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    showLogin();
  });

  // ---- Tabs ----
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.getAttribute('data-tab');
    $$('.panel').forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === name));
    if (name === 'network') loadNetwork();
    if (name === 'logs') loadLogFiles();
    if (name === 'events') loadEvents();
    if (name === 'system') loadSystem();
  }));

  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-refresh]');
    if (r) {
      const k = r.getAttribute('data-refresh');
      ({ games: loadGames, system: loadSystem, network: loadNetwork, logs: loadLogs, events: loadEvents }[k] || (() => {}))();
    }
  });

  // ---- Games ----
  function gameCard(g) {
    const stateClass = g.active === 'active' ? 'active' : g.active === 'failed' ? 'failed' : 'inactive';
    const update = g.updateAvailable && g.latest ? `
      <div class="update-note">Update available: <span class="tag">${esc(g.latest.tag)}</span>
        <span class="meta">${esc(g.latest.message || '')}${g.latest.date ? ' · ' + esc(g.latest.date) : ''}</span></div>` : '';
    return `<div class="card" data-id="${esc(g.id)}">
      <h2>${esc(g.name)}</h2>
      <div class="state-row">
        <span class="pill ${stateClass}">${esc(g.active)}</span>
        ${g.onKiosk ? '<span class="pill kiosk">On kiosk</span>' : ''}
        <span>Uptime: ${fmtDuration(g.uptime)}</span>
        <span>Version: ${esc(g.localVersion || (g.installed ? 'untagged' : 'none'))}</span>
      </div>
      ${update}
      <div class="row-actions">
        <button class="btn small play" data-game="launch" ${g.installed ? '' : 'disabled'}>Launch</button>
        <button class="btn small" data-game="restart">Restart</button>
        <button class="btn small stop" data-game="stop">Stop</button>
        ${g.updateAvailable ? '<button class="btn small update" data-game="update">Update</button>' : ''}
        <button class="btn small" data-game="logs">Logs</button>
      </div>
      <div class="row-actions">
        <label class="toggle"><input type="checkbox" data-game="autostart" ${g.enabled === 'enabled' ? 'checked' : ''}> Auto-start on boot</label>
      </div>
    </div>`;
  }

  async function loadGames() {
    try {
      const data = await get('/games');
      $('#games-list').innerHTML = (data.games || []).map(gameCard).join('') || '<div class="muted">No games configured.</div>';
    } catch (e) { /* handled */ }
  }

  $('#games-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-game]');
    if (!btn || busy) return;
    const card = e.target.closest('.card');
    const id = card.getAttribute('data-id');
    const act = btn.getAttribute('data-game');
    if (act === 'logs') return openGameLogs(id);
    if (act === 'stop' && !confirm(`Stop ${id}?`)) return;
    busy = true; toast(`${act} ${id}…`);
    try {
      const body = await post(`/games/${encodeURIComponent(id)}/${act}`);
      toast(body.ok === false ? `Error: ${body.error}` : `${act} ok${body.version ? ' → ' + body.version : ''}`);
    } catch (e) { /* handled */ }
    finally { busy = false; loadGames(); }
  });

  $('#games-list').addEventListener('change', async (e) => {
    const cb = e.target.closest('input[data-game="autostart"]');
    if (!cb) return;
    const id = e.target.closest('.card').getAttribute('data-id');
    const body = await post(`/games/${encodeURIComponent(id)}/autostart`, { enabled: cb.checked });
    toast(body.ok === false ? `Error: ${body.error}` : `${id} autostart ${cb.checked ? 'on' : 'off'}`);
  });

  async function openGameLogs(id) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === 'logs'));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === 'logs'));
    await loadLogFiles();
    $('#log-source').value = 'svc:' + id;
    loadLogs();
  }

  // ---- System ----
  async function loadSystem() {
    try {
      const h = await get('/system/health');
      const tempWarn = h.cpuTemp != null && h.cpuTemp >= 75;
      const throttled = h.throttled && (h.throttled.throttledNow || h.throttled.underVoltageNow);
      $('#health').innerHTML = [
        metric('CPU Temp', h.cpuTemp != null ? h.cpuTemp + ' °C' : '—', tempWarn),
        metric('Load (1m)', h.load ? h.load['1m'].toFixed(2) : '—'),
        metric('Memory', `${fmtBytes(h.memory.used)} / ${fmtBytes(h.memory.total)}`),
        metric('Disk free', h.disk ? `${fmtBytes(h.disk.avail)} (${h.disk.pcent} used)` : '—'),
        metric('Uptime', fmtDuration(h.uptime)),
        metric('Throttling', throttled ? 'YES' : (h.throttled ? 'OK' : '—'), throttled),
      ].join('');

      const v = await get('/launcher/version');
      $('#launcher-version').innerHTML = `Version <b>${esc(v.localVersion || 'untagged')}</b>` +
        (v.updateAvailable && v.latest ? ` — update to <b>${esc(v.latest.tag)}</b> (${esc(v.latest.date || '')})` : '');
      $('[data-act="launcher-update"]').hidden = !v.updateAvailable;
    } catch (e) { /* handled */ }
  }
  function metric(label, value, warn) {
    return `<div class="metric"><div class="label">${esc(label)}</div><div class="value ${warn ? 'warn' : ''}">${esc(value)}</div></div>`;
  }

  const SYS_ACTIONS = {
    'launcher-restart': { path: '/launcher/restart', confirm: 'Restart the launcher service?' },
    'launcher-update': { path: '/launcher/update', confirm: 'Update the launcher to the latest tag and restart?' },
    'kiosk-return': { path: '/kiosk/return' },
    'kiosk-relaunch': { path: '/kiosk/relaunch' },
    'kiosk-kill': { path: '/kiosk/kill', confirm: 'Kill the Firefox kiosk?' },
    'reboot': { path: '/system/reboot', confirm: 'Reboot the Raspberry Pi now?' },
    'shutdown': { path: '/system/shutdown', confirm: 'Shut down the Raspberry Pi now?' },
  };
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const def = SYS_ACTIONS[btn.getAttribute('data-act')];
    if (!def) return;
    if (def.confirm && !confirm(def.confirm)) return;
    toast('Working…');
    const body = await post(def.path);
    toast(body.ok === false ? `Error: ${body.error}` : 'Done');
    loadSystem();
  });

  // ---- Network ----
  async function loadNetwork() {
    const n = await get('/network');
    $('#net-summary').innerHTML = `<b>${esc(n.status)}</b>${n.ssid ? ' · ' + esc(n.ssid) : ''} · IP ${esc(n.ip)} · ${esc(n.hostname)}`;
    const scan = await get('/wifi/scan');
    const nets = (scan && scan.networks) || [];
    $('#wifi-list').innerHTML = nets.length ? nets.map((net) => `
      <div class="wifi-row ${net.inUse ? 'active' : ''}" data-ssid="${esc(net.ssid)}" data-secured="${net.secured ? 1 : 0}">
        <span class="name">${esc(net.ssid)}${net.inUse ? ' ✓' : ''}</span>
        <span class="meta"><span>${net.secured ? '🔒 ' + esc(net.security) : 'Open'}</span><span>${net.signal}%</span></span>
      </div>`).join('') : '<div class="muted">No networks found.</div>';
  }

  $('#wifi-list').addEventListener('click', async (e) => {
    const row = e.target.closest('.wifi-row');
    if (!row) return;
    const ssid = row.getAttribute('data-ssid');
    const secured = row.getAttribute('data-secured') === '1';
    const password = secured ? prompt(`Password for ${ssid}:`) : '';
    if (secured && password == null) return;
    toast(`Connecting to ${ssid}…`);
    const body = await post('/wifi/connect', { ssid, password });
    toast(body.ok ? 'Connected' : `Failed: ${body.error || ''}`);
    loadNetwork();
  });

  // ---- Logs ----
  async function loadLogFiles() {
    const [files, games] = await Promise.all([get('/logs/files'), get('/games')]);
    const sel = $('#log-source');
    const launcherOpts = (files.files || []).map((f) => `<option value="file:${esc(f.name)}">launcher: ${esc(f.name)}${f.current ? ' (current)' : ''}</option>`).join('');
    const svcOpts = (games.games || []).filter((g) => g.service).map((g) => `<option value="svc:${esc(g.id)}">service: ${esc(g.name)}</option>`).join('');
    sel.innerHTML = launcherOpts + svcOpts;
  }

  async function loadLogs() {
    const src = $('#log-source').value || '';
    const q = encodeURIComponent($('#log-search').value || '');
    let data;
    if (src.startsWith('svc:')) {
      data = await get(`/games/${encodeURIComponent(src.slice(4))}/logs?lines=400&q=${q}`);
      renderPlainLog(data.lines || []);
    } else if (src.startsWith('file:')) {
      data = await get(`/logs?file=${encodeURIComponent(src.slice(5))}&limit=500&q=${q}`);
      renderJsonLog(data.lines || []);
    }
  }
  function renderJsonLog(lines) {
    const view = $('#log-view');
    view.innerHTML = lines.map((l) =>
      `<span class="lv-t">${esc((l.t || '').replace('T', ' ').slice(0, 19))}</span> ` +
      `<span class="lv-${esc(l.level)}">[${esc(l.level)}]</span> ` +
      `<span class="lv-scope">${esc(l.scope || '')}</span> ${esc(l.message || '')}`
    ).join('\n');
    if ($('#log-follow').checked) view.scrollTop = view.scrollHeight;
  }
  function renderPlainLog(lines) {
    const view = $('#log-view');
    view.textContent = lines.join('\n');
    if ($('#log-follow').checked) view.scrollTop = view.scrollHeight;
  }
  $('#log-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadLogs(); });
  $('#log-source').addEventListener('change', loadLogs);

  // ---- Events ----
  async function loadEvents() {
    const data = await get('/events?limit=100');
    renderEvents(data.events || []);
  }
  function renderEvents(events) {
    $('#event-view').textContent = events.map((e) =>
      `${(e.created_at || '').replace('T', ' ').slice(0, 19)}  ${e.topic}  ${JSON.stringify(e.payload)}`
    ).join('\n');
    const v = $('#event-view'); v.scrollTop = v.scrollHeight;
  }

  // ---- WebSocket live stream ----
  function connectWs() {
    if (ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => $('#conn-indicator').classList.add('live');
    ws.onclose = () => { $('#conn-indicator').classList.remove('live'); ws = null; setTimeout(() => { if (!$('#dash').hidden) connectWs(); }, 3000); };
    ws.onerror = () => {};
    ws.onmessage = (msg) => {
      let ev; try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.topic === 'hello') return;
      // Live refresh relevant panels on state-changing events.
      if (/^game\.|^launcher\./.test(ev.topic)) loadGames();
      const evPanel = $('[data-panel="events"]');
      if (evPanel && evPanel.classList.contains('active')) loadEvents();
      toast(`${ev.topic}`);
    };
  }

  // ---- Boot ----
  (async function init() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) { const b = await res.json(); showDash(b.username); }
      else showLogin();
    } catch (e) { showLogin(); }
  })();
})();
