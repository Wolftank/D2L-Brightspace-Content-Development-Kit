import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type RequestHandler } from 'express';
import { BACK_END_DIR } from '../config.js';
import type { Deps } from '../deps.js';
import { BuildNotFound } from '../errors.js';
import { KIT_DIR } from '../kit.js';

/** Where previews are served, and the one origin allowed to frame them. */
export interface PreviewSettings {
  /** The preview origin, `http://preview.localhost:<port>`. */
  origin: string;
  appOrigin: string;
}

const PLAYER_DIR = join(BACK_END_DIR, 'preview');
const QA_DIR = join(KIT_DIR, 'qa');

/** The player page and the files it loads, by the name each is requested under `/preview/`. */
const PLAYER_FILES = new Map([
  ['player.html', join(PLAYER_DIR, 'player.html')],
  ['player.js', join(PLAYER_DIR, 'player.js')],
  ['player.css', join(PLAYER_DIR, 'player.css')],
  ['topic.js', join(PLAYER_DIR, 'topic.js')],
  ['d2l-emulator.js', join(QA_DIR, 'd2l-emulator.js')],
  ['tenant-profile.json', join(QA_DIR, 'tenant-profile.json')],
]);

/**
 * The scripts a topic page gets at the start of its `<head>`, as D2L adds its
 * own scripts to a topic: the emulator, and `topic.js`, which installs it as
 * the viewer the player was asked for before the page's own scripts run.
 */
const TOPIC_EMULATOR_TAGS = '<script src="/preview/d2l-emulator.js"></script><script src="/preview/topic.js"></script>';

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

  router.get('/content/:term/:unit/*path', async (req, res) => {
    const unit = /^\d+-(.+)$/.exec(req.params.unit);
    if (!/^\d+$/.test(req.params.term) || !unit) {
      res.sendStatus(404);
      return;
    }
    const buildId = unit[1]!;
    if (deps.builds.get(req.user.id, buildId).avenue !== 'topic') {
      throw new BuildNotFound();
    }
    const file = await deps.builds.previewFile(req.user.id, buildId, req.params.path);
    if (/\.html?$/i.test(file)) {
      res.type('html').send(withTopicEmulator(await readFile(file, 'utf8')));
    } else {
      res.sendFile(file, SEND_OPTIONS);
    }
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

/** `html` with the topic emulator's scripts first in its `<head>`, or after its doctype when it has no `<head>`. */
function withTopicEmulator(html: string): string {
  const anchor = /<head\b[^>]*>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
  const at = anchor ? anchor.index + anchor[0].length : 0;
  return html.slice(0, at) + TOPIC_EMULATOR_TAGS + html.slice(at);
}
