/* global D2LEmulator */
(async function () {
  const params = new URLSearchParams(window.location.search);
  const buildId = params.get('buildId');
  const attempt = params.get('attempt');
  const parentOrigin = params.get('parentOrigin');
  const frame = document.getElementById('activity');
  let emulator;
  function report(status, reason) {
    window.parent.postMessage({ type: 'cdk-preview', buildId, attempt, status, reason }, parentOrigin);
  }
  if (!buildId || !attempt || !parentOrigin || new URL(parentOrigin).origin === window.location.origin) return;
  window.addEventListener('pagehide', () => emulator?.uninstall(), { once: true });
  try {
    const launch = `/api/builds/${encodeURIComponent(buildId)}/preview/index.html`;
    const response = await fetch(launch, { cache: 'no-store' });
    if (!response.ok) { report('error', 'unavailable'); return; }
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Invalid launch page');
    const profile = await fetch('/preview/tenant-profile.json');
    if (!profile.ok) throw new Error('Profile unavailable');
    emulator = D2LEmulator.install({
      profile: await profile.json(),
      learner: { id: `preview-${attempt}`, name: 'Simulated Learner', role: 'Student' },
      attempt: 1,
    });
    frame.addEventListener('load', () => {
      try {
        const document = frame.contentDocument;
        if (!document?.body || frame.contentWindow.location.pathname !== launch) throw new Error('Launch failed');
        report('ready');
      } catch { report('error', 'launch'); }
    }, { once: true });
    frame.addEventListener('error', () => report('error', 'launch'), { once: true });
    frame.src = launch;
  } catch { report('error', 'launch'); }
})();
