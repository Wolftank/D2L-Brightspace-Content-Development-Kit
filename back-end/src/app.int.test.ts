import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Deps } from './deps.js';
import type { User } from './db/schema.js';
import { captureLog } from './test/log.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const fakeUser: User = {
  id: 'user-1',
  displayName: 'Test Instructor',
  email: null,
  role: 'instructor',
};

function fakeDeps(): Deps {
  return {
    users: {
      ensureLocalUser: () => fakeUser,
      get: (id) => (id === fakeUser.id ? fakeUser : undefined),
    },
    projects: {
      create: async () => {
        throw new Error('not used by these tests');
      },
      get: () => {
        throw new Error('not used by these tests');
      },
      list: () => {
        throw new Error('not used by these tests');
      },
    },
    builds: {
      get: () => {
        throw new Error('not used by these tests');
      },
      download: async () => {
        throw new Error('not used by these tests');
      },
      previewFile: async () => {
        throw new Error('not used by these tests');
      },
    },
    events: {
      append: (input) => ({
        seq: 1,
        projectId: input.projectId,
        turnId: input.turnId ?? null,
        kind: input.kind,
        payload: input.payload,
        ts: Date.now(),
      }),
      after: () => [],
      subscribe: () => () => {},
    },
    turns: {
      start: () => {
        throw new Error('not used by these tests');
      },
    },
    messages: {
      list: () => {
        throw new Error('not used by these tests');
      },
    },
    driver: {
      name: 'claude',
      probe: async () => ({ ok: true, version: '0.0.0' }),
    },
    preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
  };
}

describe('createApp', () => {
  it('returns the stub user, mode, and agent probe from /api/me', async () => {
    const app = createApp(fakeDeps());

    const res = await request(app).get('/api/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: fakeUser,
      mode: 'local',
      agent: { name: 'claude', ok: true, version: '0.0.0' },
    });
  });

  it('returns 200 from /api/health', async () => {
    const app = createApp(fakeDeps());

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
  });

  it('returns 400 and the error envelope for an invalid JSON body', async () => {
    const app = createApp(fakeDeps());

    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{not valid json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('returns 413 and the error envelope for a body over the JSON limit', async () => {
    const app = createApp(fakeDeps());

    const res = await request(app)
      .post('/api/health')
      .send({ content: [{ type: 'text', text: 'x'.repeat(150_000) }] });

    expect(res.status).toBe(413);
    expect(res.body.error).toEqual({ code: 'payload_too_large', message: 'The request is too large.', nextStep: 'smaller_request' });
  });

  it('returns 404 and the error envelope for an unknown /api route', async () => {
    const app = createApp(fakeDeps());

    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('request IDs and the request log', () => {
  it('gives every response its own X-Request-Id: API, unknown route, unreadable body, preview origin, and the built app', async () => {
    const appDir = await mkdtemp(join(tmpdir(), 'cdk-request-id-'));
    try {
      await writeFile(join(appDir, 'index.html'), '<!doctype html>');
      const app = createApp({ ...fakeDeps(), appDir });

      const responses = await Promise.all([
        request(app).get('/api/health'),
        request(app).get('/api/does-not-exist'),
        request(app).post('/api/health').set('Content-Type', 'application/json').send('{not valid json'),
        request(app).get(`/preview/player.html?buildId=b&attempt=1&parentOrigin=${encodeURIComponent('http://127.0.0.1:5173')}`).set('Host', 'preview.localhost:3000'),
        request(app).get('/'),
      ]);

      expect(responses.map((res) => res.status)).toEqual([200, 404, 400, 200, 200]);
      const ids = responses.map((res) => res.headers['x-request-id']);
      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await rm(appDir, { recursive: true, force: true });
    }
  });

  it('ignores an X-Request-Id sent by the client', async () => {
    const res = await request(createApp(fakeDeps())).get('/api/health').set('X-Request-Id', 'chosen-by-the-client');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('logs each response once with its request ID, method, path without the query, status, and duration', async () => {
    const records = captureLog();
    const app = createApp(fakeDeps());

    const ok = await request(app).get('/api/health?probe=1');
    const missing = await request(app).get('/api/does-not-exist');

    expect(records.filter((record) => record.reqId === ok.headers['x-request-id'])).toEqual([
      expect.objectContaining({ level: 30, msg: 'Request completed', method: 'GET', path: '/api/health', status: 200, responseTime: expect.any(Number) }),
    ]);
    expect(records.filter((record) => record.reqId === missing.headers['x-request-id'])).toEqual([
      expect.objectContaining({ level: 40, msg: 'Request completed', path: '/api/does-not-exist', status: 404 }),
    ]);
  });

  it('never logs authorization, cookie, or token headers', async () => {
    const records = captureLog();

    await request(createApp(fakeDeps()))
      .get('/api/health')
      .set('Authorization', 'Bearer secret-bearer-token')
      .set('Cookie', 'session=secret-session-cookie')
      .set('X-CDK-Token', 'secret-launch-token');

    const logText = JSON.stringify(records);
    expect(records.length).toBeGreaterThan(0);
    for (const secret of ['secret-bearer-token', 'secret-session-cookie', 'secret-launch-token']) expect(logText).not.toContain(secret);
  });

  it('answers an unexpected error with a 500 carrying the request ID, and logs the error under that ID', async () => {
    const records = captureLog();
    const deps = fakeDeps();
    deps.driver = { ...deps.driver, probe: async () => Promise.reject(new Error('spawn claude ENOENT')) };

    const res = await request(createApp(deps)).get('/api/me');

    const requestId = res.headers['x-request-id'];
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'internal_error', message: 'Something went wrong.', nextStep: 'try_later', requestId });
    expect(records.filter((record) => record.reqId === requestId)).toEqual([
      expect.objectContaining({ level: 50, msg: 'Unexpected error', err: expect.objectContaining({ message: 'spawn claude ENOENT' }) }),
      expect.objectContaining({ level: 50, msg: 'Request completed', status: 500 }),
    ]);
  });
});
