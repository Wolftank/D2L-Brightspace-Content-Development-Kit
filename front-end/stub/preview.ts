import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { Build } from '../src/api/types';

const fixture = new URL('./fixtures/preview/', import.meta.url);
const files = new Map(['index.html', 'imsmanifest.xml', 'sample.css'].map((name) => [name, readFileSync(new URL(name, fixture))]));
export const previewZip = readFileSync(new URL('./fixtures/preview.zip', import.meta.url));
const player = new URL('../preview/', import.meta.url);
const harness = new URL('../../back-end/kit/harness/', import.meta.url);
const playerFiles = new Map([
  ...['player.html', 'player.js', 'player.css'].map((name) => [name, readFileSync(new URL(name, player))] as const),
  ...['d2l-emulator.js', 'tenant-profile.json'].map((name) => [name, readFileSync(new URL(name, harness))] as const),
]);
const contentTypes: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', xml: 'application/xml' };

/** Serves only the saved starter fixture and player on a separate loopback origin. */
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
      if (findBuild(id)?.status === 'ready') { sendFile(res, asset[2]!, files.get(asset[2]!)); return; }
    }
    res.writeHead(404).end('Saved build unavailable');
  });
  server.listen(Number(process.env.STUB_PREVIEW_PORT ?? 3002), '127.0.0.1');
  return server;
}

function sendFile(res: ServerResponse, name: string, data: Buffer | undefined) {
  if (!data) { res.writeHead(404).end('File unavailable'); return; }
  res.writeHead(200, { 'Content-Type': `${contentTypes[name.split('.').pop()!] ?? 'application/octet-stream'}; charset=utf-8` });
  res.end(data);
}
