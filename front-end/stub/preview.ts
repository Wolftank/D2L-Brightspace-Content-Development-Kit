import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { Build } from '@cdk/contract';

const fixture = new URL('./fixtures/preview/', import.meta.url);
const files = new Map(['index.html', 'imsmanifest.xml', 'sample.css'].map((name) => [name, readFileSync(new URL(name, fixture))]));
export const previewZip = readFileSync(new URL('./fixtures/preview.zip', import.meta.url));
const player = new URL('../../back-end/preview/', import.meta.url);
const qaDir = new URL('../../back-end/kit/qa/', import.meta.url);
const playerFiles = new Map([
  ...['player.html', 'player.js', 'player.css', 'topic.js'].map((name) => [name, readFileSync(new URL(name, player))] as const),
  ...['d2l-emulator.js', 'tenant-profile.json'].map((name) => [name, readFileSync(new URL(name, qaDir))] as const),
]);
const contentTypes: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', xml: 'application/xml' };
const TOPIC_EMULATOR_TAGS = '<script src="/preview/d2l-emulator.js"></script><script src="/preview/topic.js"></script>';

/** Serves the saved starter fixture and player on a separate loopback origin. */
export function startPreviewServer(findBuild: (id: string) => Build | undefined) {
  const appOrigin = new URL(process.env.STUB_APP_ORIGIN ?? 'http://127.0.0.1:5173').origin;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${appOrigin} 'self'; form-action 'none'; base-uri 'none'`);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }

    const wrapper = /^\/preview\/([^/]+)$/.exec(url.pathname);
    if (wrapper) {
      if (wrapper[1] === 'player.html' && url.searchParams.get('parentOrigin') !== appOrigin) {
        res.writeHead(403).end(); return;
      }
      sendFile(res, wrapper[1]!, playerFiles.get(wrapper[1]!));
      return;
    }

    const asset = /^\/api\/builds\/([^/]+)\/preview\/([^/]+)$/.exec(url.pathname);
    if (asset) {
      let id: string;
      try { id = decodeURIComponent(asset[1]!); } catch { res.writeHead(400).end(); return; }
      const build = findBuild(id);
      if (build?.status === 'ready' && build.avenue === 'scorm') {
        sendFile(res, asset[2]!, files.get(asset[2]!));
        return;
      }
    }

    const topic = /^\/content\/(\d+)\/(\d+)-([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (topic) {
      let id: string;
      try { id = decodeURIComponent(topic[3]!); } catch { res.writeHead(400).end(); return; }
      const build = findBuild(id);
      const name = topic[4]!;
      const data = files.get(name);

      if (build?.status === 'ready' && build.avenue === 'topic' && data) {
        if (/\.html?$/i.test(name)) {
          sendHtml(res, withTopicEmulator(data.toString('utf8')));
        } else {
          sendFile(res, name, data);
        }
        return;
      }
    }

    res.writeHead(404).end('Saved build unavailable');
  });

  server.listen(Number(process.env.STUB_PREVIEW_PORT ?? 3002), '127.0.0.1');
  return server;
}

function withTopicEmulator(html: string): string {
  const anchor = /<head\b[^>]*>/i.exec(html) ?? /^\s*<!doctype[^>]*>/i.exec(html);
  const at = anchor ? anchor.index + anchor[0].length : 0;
  return html.slice(0, at) + TOPIC_EMULATOR_TAGS + html.slice(at);
}

function sendHtml(res: ServerResponse, html: string) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendFile(res: ServerResponse, name: string, data: Buffer | undefined) {
  if (!data) { res.writeHead(404).end('File unavailable'); return; }
  res.writeHead(200, { 'Content-Type': `${contentTypes[name.split('.').pop()!] ?? 'application/octet-stream'}; charset=utf-8` });
  res.end(data);
}