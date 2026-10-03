// Launcher landing logic: network strip + game cards with a single Launch action.
// Admin controls (stop/update/system) live in /admin.html.
(function () {
  const gamesEl = document.getElementById('games');
  const toastEl = document.getElementById('toast');
  let busy = false;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function refreshNetwork() {
    try {
      const n = await fetch('/api/network').then((r) => r.json());
      document.getElementById('netstatus').textContent = n.status;
      document.getElementById('netdot').className = 'dot ' + (n.connected ? 'on' : 'off');
      document.getElementById('ssid').textContent = n.ssid || '—';
      document.getElementById('ip').textContent = n.ip || '—';
    } catch (e) { /* ignore */ }
  }

  function gameCard(g) {
    const badge = !g.installed
      ? '<span class="badge missing">Not Installed</span>'
      : g.active === 'active' ? '<span class="badge running">Running</span>'
                              : '<span class="badge idle">Idle</span>';
    const verLine = g.localVersion ? `Version <b>${esc(g.localVersion)}</b>` : (g.installed ? 'Untagged build' : 'Not installed');
    const playLabel = g.active === 'active' ? 'Relaunch' : 'Launch';
    return `<div class="card">
      <h2>${esc(g.name)} ${badge}</h2>
      <div class="ver">${verLine}</div>
      <div class="actions">
        <button class="btn play" data-id="${esc(g.id)}" ${g.installed ? '' : 'disabled'}>${playLabel}</button>
      </div>
    </div>`;
  }

  async function refreshGames() {
    try {
      const data = await fetch('/api/games').then((r) => r.json());
      const list = data.games || [];
      gamesEl.innerHTML = list.length
        ? list.map(gameCard).join('')
        : '<div class="empty">No games configured. Edit game_config.yml.</div>';
    } catch (e) {
      gamesEl.innerHTML = '<div class="empty">Failed to load games.</div>';
    }
  }

  async function launch(id) {
    if (busy) return;
    busy = true;
    toast(`Launching ${id}…`);
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(id)}/launch`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      toast(res.ok && body.ok !== false ? `${id} launched` : `Error: ${body.error || res.status}`);
    } catch (e) {
      toast(`Error: ${e.message}`);
    } finally {
      busy = false;
      refreshGames();
    }
  }

  gamesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (btn) launch(btn.getAttribute('data-id'));
  });

  refreshNetwork();
  refreshGames();
  setInterval(refreshNetwork, 8000);
  setInterval(() => { if (!busy) refreshGames(); }, 30000);
})();
