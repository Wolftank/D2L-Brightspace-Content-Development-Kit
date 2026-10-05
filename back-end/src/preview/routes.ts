import { join } from 'node:path';
import { Router, type RequestHandler } from 'express';
import { BACK_END_DIR } from '../config.js';
import type { Deps } from '../deps.js';
import { KIT_DIR } from '../kit.js';

/** Where previews are served, and the one origin allowed to frame them. */
export interface PreviewSettings {
  /** The preview origin, `http://preview.localhost:<port>`. */
  origin: string;
  appOrigin: string;
}

const PLAYER_DIR = join(BACK_END_DIR, 'preview');
const HARNESS_DIR = join(KIT_DIR, 'harness');

/** The player page and the files it loads, by the name each is requested under `/preview/`. */
const PLAYER_FILES = new Map([
  ['player.html', join(PLAYER_DIR, 'player.html')],
  ['player.js', join(PLAYER_DIR, 'player.js')],
  ['player.css', join(PLAYER_DIR, 'player.css')],
  ['d2l-emulator.js', join(HARNESS_DIR, 'd2l-emulator.js')],
  ['tenant-profile.json', join(HARNESS_DIR, 'tenant-profile.json')],
]);

/** Absolute paths may sit under a dot folder, such as the default `~/.cdk`; every path served is already checked. */
const SEND_OPTIONS = { dotfiles: 'allow' } as const;

/**
 * Serves every request addressed to the preview origin: the emulator player,
 * and the files of ready builds. Requests to any other host go on to the app,
 * which serves none of these paths, so a build's scripts never run on the
 * app's origin.
 */
export function previewOrigin(deps: Deps): RequestHandler {
  const host = new URL(deps.preview.origin).host;
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    `frame-ancestors ${deps.preview.appOrigin} 'self'`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');

  const router = Router();

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': policy });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD').sendStatus(405);
      return;
    }
    next();
  });

  router.get('/preview/:file', (req, res) => {
    const path = PLAYER_FILES.get(req.params.file);
    if (!path) {
      res.sendStatus(404);
      return;
    }
    if (req.params.file === 'player.html' && req.query.parentOrigin !== deps.preview.appOrigin) {
      res.sendStatus(403);
      return;
    }
    res.sendFile(path, SEND_OPTIONS);
  });

  router.get('/api/builds/:buildId/preview/*path', async (req, res) => {
    res.sendFile(await deps.builds.previewFile(req.user.id, req.params.buildId, req.params.path), SEND_OPTIONS);
  });

  router.use((_req, res) => {
    res.sendStatus(404);
  });

  return (req, res, next) => {
    if (req.headers.host?.toLowerCase() === host) {
      router(req, res, next);
    } else {
      next();
    }
  };
}
