// WiFi page: scan networks, connect with an on-screen keyboard (touchscreen friendly).
window.WiFi = (function () {
  const listEl = document.getElementById('wifi-list');
  const statusEl = document.getElementById('wifi-status');
  const overlay = document.getElementById('overlay');
  const pwInput = document.getElementById('pw');
  const dlgTitle = document.getElementById('dlg-title');
  const dlgMsg = document.getElementById('dlg-msg');
  const connectBtn = document.getElementById('connect-btn');
  let target = null;
  let shift = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function signalBars(sig) {
    const n = sig >= 75 ? 4 : sig >= 50 ? 3 : sig >= 25 ? 2 : 1;
    return '▂▄▆█'.slice(0, n).padEnd(4, '·');
  }

  async function refreshStatus() {
    try {
      const n = await fetch('/api/network').then((r) => r.json());
      statusEl.textContent = `${n.status}${n.ssid ? ' · ' + n.ssid : ''} · ${n.ip}`;
    } catch (e) { /* ignore */ }
  }

  async function scan() {
    listEl.innerHTML = '<div class="empty">Scanning…</div>';
    try {
      const data = await fetch('/api/wifi/scan').then((r) => r.json());
      const nets = (data && data.networks) || [];
      if (!data.ok) { listEl.innerHTML = `<div class="empty">Scan failed: ${esc(data.error || '')}</div>`; return; }
      if (!nets.length) { listEl.innerHTML = '<div class="empty">No networks found.</div>'; return; }
      listEl.innerHTML = nets.map((net) => `
        <div class="wifi-row ${net.inUse ? 'active' : ''}" data-ssid="${esc(net.ssid)}" data-secured="${net.secured ? 1 : 0}">
          <span class="name">${esc(net.ssid)}${net.inUse ? ' ✓' : ''}</span>
          <span class="meta">
            <span class="lock">${net.secured ? '🔒 ' + esc(net.security) : 'Open'}</span>
            <span class="bars">${signalBars(net.signal)}</span>
          </span>
        </div>`).join('');
    } catch (e) {
      listEl.innerHTML = `<div class="empty">Scan error: ${esc(e.message)}</div>`;
    }
  }

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.wifi-row');
    if (!row) return;
    openDialog(row.getAttribute('data-ssid'), row.getAttribute('data-secured') === '1');
  });

  function openDialog(ssid, secured) {
    target = { ssid, secured };
    dlgTitle.textContent = `Connect to ${ssid}`;
    pwInput.value = '';
    dlgMsg.textContent = '';
    dlgMsg.className = 'msg';
    pwInput.style.display = secured ? 'block' : 'none';
    document.getElementById('kbd').style.display = secured ? 'flex' : 'none';
    overlay.classList.add('show');
  }

  function closeDialog() {
    overlay.classList.remove('show');
    target = null;
  }

  async function connect() {
    if (!target) return;
    connectBtn.disabled = true;
    dlgMsg.className = 'msg';
    dlgMsg.textContent = 'Connecting…';
    try {
      const res = await fetch('/api/wifi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: target.ssid, password: target.secured ? pwInput.value : '' }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        dlgMsg.className = 'msg ok';
        dlgMsg.textContent = 'Connected!';
        await refreshStatus();
        setTimeout(() => { closeDialog(); scan(); }, 900);
      } else {
        dlgMsg.className = 'msg err';
        dlgMsg.textContent = 'Failed: ' + (body.error || res.status);
      }
    } catch (e) {
      dlgMsg.className = 'msg err';
      dlgMsg.textContent = 'Error: ' + e.message;
    } finally {
      connectBtn.disabled = false;
    }
  }

  // ---- On-screen keyboard ----
  const ROWS = [
    '1234567890',
    'qwertyuiop',
    'asdfghjkl',
    'zxcvbnm',
  ];
  function buildKeyboard() {
    const kbd = document.getElementById('kbd');
    let html = '';
    for (const row of ROWS) {
      html += '<div class="kbd-row">' + row.split('').map((ch) => `<div class="key" data-k="${ch}">${ch}</div>`).join('') + '</div>';
    }
    html += `<div class="kbd-row">
      <div class="key wide" data-act="shift">⇧</div>
      <div class="key" data-k="@">@</div>
      <div class="key" data-k=".">.</div>
      <div class="key" data-k="-">-</div>
      <div class="key" data-k="_">_</div>
      <div class="key space" data-k=" ">space</div>
      <div class="key wide" data-act="back">⌫</div>
    </div>`;
    kbd.innerHTML = html;
    kbd.addEventListener('click', (e) => {
      const key = e.target.closest('.key');
      if (!key) return;
      const act = key.getAttribute('data-act');
      if (act === 'back') { pwInput.value = pwInput.value.slice(0, -1); return; }
      if (act === 'shift') { shift = !shift; updateShift(); return; }
      let ch = key.getAttribute('data-k');
      if (ch == null) return;
      if (shift && /[a-z]/.test(ch)) ch = ch.toUpperCase();
      pwInput.value += ch;
    });
  }
  function updateShift() {
    document.querySelectorAll('#kbd .key[data-k]').forEach((k) => {
      const base = k.getAttribute('data-k');
      if (/[a-zA-Z]/.test(base)) k.textContent = shift ? base.toUpperCase() : base.toLowerCase();
    });
  }

  buildKeyboard();
  refreshStatus();
  scan();

  return { connect, closeDialog, scan };
})();
