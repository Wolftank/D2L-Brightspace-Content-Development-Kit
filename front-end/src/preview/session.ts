/**
 * The preview origin: `VITE_PREVIEW_ORIGIN` when the dev server sets it,
 * otherwise `preview.localhost` on the app's own port, where the back end that
 * serves the app also serves previews.
 */
function previewOrigin(): URL {
  const configured = import.meta.env.VITE_PREVIEW_ORIGIN;
  if (configured) return new URL(configured);
  const origin = new URL(window.location.origin);
  origin.hostname = 'preview.localhost';
  return origin;
}

/** Creates a fresh attempt on the isolated preview origin. */
export function previewSession(buildId: string) {
  const origin = previewOrigin();
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin === window.location.origin || origin.username || origin.password) {
    throw new Error('Preview is unavailable. It requires a separate preview origin.');
  }
  const attempt = crypto.randomUUID();
  const url = new URL('/preview/player.html', origin);
  url.search = new URLSearchParams({ buildId, attempt, parentOrigin: window.location.origin }).toString();
  return { url: url.href, origin: origin.origin, attempt };
}
