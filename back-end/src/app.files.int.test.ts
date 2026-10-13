import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Deps } from './deps.js';

const PREVIEW_HOST = 'preview.localhost:3000';

function deps(appDir: string | undefined): Deps {
  return {
    users: { ensureLocalUser: () => ({ id: 'user-1', displayName: 'Test Instructor', email: null, role: 'instructor' }) },
    preview: { origin: `http://${PREVIEW_HOST}`, appOrigin: 'http://127.0.0.1:3000' },
    appDir,
  } as unknown as Deps;
}

describe('the built front end', () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await mkdtemp(join(tmpdir(), 'cdk-app-'));
    await writeFile(join(appDir, 'index.html'), '<!doctype html><title>CDK</title>');
    await writeFile(join(appDir, 'app.js'), 'console.log("cdk")');
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  it('is served on the app origin from APP_DIR, with index.html at the root', async () => {
    const app = createApp(deps(appDir));

    const page = await request(app).get('/?project=project-1');
    const script = await request(app).get('/app.js');

    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>CDK</title>');
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toMatch(/javascript/);
  });

  it('is not served on the preview origin', async () => {
    const app = createApp(deps(appDir));

    const res = await request(app).get('/').set('Host', PREVIEW_HOST);

    expect(res.status).toBe(404);
  });

  it('leaves unknown /api routes to the API error envelope', async () => {
    const app = createApp(deps(appDir));

    const res = await request(app).get('/api/index.html');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('is not served without APP_DIR', async () => {
    const app = createApp(deps(undefined));

    const res = await request(app).get('/');

    expect(res.status).toBe(404);
  });
});
