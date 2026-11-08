/* global D2LEmulator */
(async function () {
  /** The org unit a previewed topic sits in, in D2L's content path `/content/<term>/<ou>-<course>/`. */
  const TOPIC_ORG_UNIT = '1000';
  const LEARNERS = {
    Student: { name: 'Simulated Learner', idPrefix: 'preview-' },
    Instructor: { name: 'Simulated Instructor', idPrefix: 'preview-instructor-' },
  };

  const params = new URLSearchParams(window.location.search);
  const buildId = params.get('buildId');
  const attempt = params.get('attempt');
  const parentOrigin = params.get('parentOrigin');
  const avenue = params.get('avenue') ?? 'scorm';
  const role = params.get('role') ?? 'Student';
  const frame = document.getElementById('activity');
  let emulator;
  function report(status, reason) {
    window.parent.postMessage({ type: 'cdk-preview', buildId, attempt, status, reason }, parentOrigin);
  }
  if (!buildId || !attempt || !parentOrigin || new URL(parentOrigin).origin === window.location.origin) return;
  if (!['scorm', 'topic'].includes(avenue) || !Object.hasOwn(LEARNERS, role)) return;
  window.addEventListener('pagehide', () => emulator?.uninstall(), { once: true });
  try {
    const launch = avenue === 'topic'
      ? `/content/0/${TOPIC_ORG_UNIT}-${encodeURIComponent(buildId)}/index.html`
      : `/api/builds/${encodeURIComponent(buildId)}/preview/index.html`;
    const response = await fetch(launch, { cache: 'no-store' });
    if (!response.ok) { report('error', 'unavailable'); return; }
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Invalid launch page');
    const profile = await fetch('/preview/tenant-profile.json');
    if (!profile.ok) throw new Error('Profile unavailable');
    const learner = { id: `${LEARNERS[role].idPrefix}${attempt}`, name: LEARNERS[role].name, role };
    if (avenue === 'topic') {
      window.cdkPreview = { profile: await profile.json(), learner };
    } else {
      emulator = D2LEmulator.install({ profile: await profile.json(), learner, attempt: 1 });
    }
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
