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
    driver: {
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
      agent: { ok: true, version: '0.0.0' },
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

  it('returns 404 and the error envelope for an unknown /api route', async () => {
    const app = createApp(fakeDeps());

    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
