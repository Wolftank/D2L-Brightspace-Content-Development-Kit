import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Deps } from './deps.js';
import type { User } from './db/schema.js';

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
    },
    builds: {
      get: () => {
        throw new Error('not used by these tests');
      },
      download: async () => {
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
    driver: {
      name: 'claude',
      probe: async () => ({ ok: true, version: '0.0.0' }),
    },
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
    expect(res.body.error).toEqual({ code: 'payload_too_large', message: 'The request is too large.' });
  });

  it('returns 404 and the error envelope for an unknown /api route', async () => {
    const app = createApp(fakeDeps());

    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
