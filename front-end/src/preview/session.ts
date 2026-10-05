/** Creates a fresh attempt on the configured, isolated preview origin. */
export function previewSession(buildId: string) {
  const configured = import.meta.env.VITE_PREVIEW_ORIGIN;
  if (!configured) throw new Error('Preview is unavailable. The preview service has not been configured.');
  const origin = new URL(configured);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin === window.location.origin || origin.username || origin.password) {
    throw new Error('Preview is unavailable. It requires a separate preview origin.');
  }
  const attempt = crypto.randomUUID();
  const url = new URL('/preview/player.html', origin);
  url.search = new URLSearchParams({ buildId, attempt, parentOrigin: window.location.origin }).toString();
  return { url: url.href, origin: origin.origin, attempt };
}
