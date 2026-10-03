// Scales the fixed 1920x1080 stage to fit the viewport, and draws the aperture outline.
// Toggle the aperture overlay with Alt+A for physical alignment.
(function () {
  const stage = document.getElementById('stage');
  function fit() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.setProperty('--stage-scale', scale);
  }
  window.addEventListener('resize', fit);
  fit();

  fetch('/api/aperture').then((r) => r.json()).then((ap) => {
    if (ap && ap.safe) {
      const root = document.documentElement;
      root.style.setProperty('--safe-top', ap.safe.top + 'px');
      root.style.setProperty('--safe-right', ap.safe.right + 'px');
      root.style.setProperty('--safe-bottom', ap.safe.bottom + 'px');
      root.style.setProperty('--safe-left', ap.safe.left + 'px');
    }
    const poly = document.querySelector('#aperture polygon');
    if (poly && Array.isArray(ap.polygon)) {
      poly.setAttribute('points', ap.polygon.map((p) => `${p.x},${p.y}`).join(' '));
    }
  }).catch(() => {});

  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      document.getElementById('aperture').classList.toggle('show');
    }
  });
})();
