import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './errors.js';
import { LAUNCH_COOKIE, originGuard, type OriginGuardSettings } from './origin-guard.js';

const APP_ORIGIN = 'http://127.0.0.1:5173';
const FORBIDDEN = { error: { code: 'forbidden', message: "This request isn't allowed.", nextStep: 'try_later' } };

function app(overrides: Partial<OriginGuardSettings> = {}) {
  const a = express();
  a.use('/api', originGuard({ appOrigin: APP_ORIGIN, ...overrides }));
  a.use('/api', (_req, res) => res.json({ ok: true }));
  a.use('/other', (_req, res) => res.json({ ok: true }));
  a.use(errorHandler);
  return a;
}

describe('origin guard', () => {
  describe('without a launch token, as in development', () => {
    it('allows the app origin, and a request with no Origin such as the app on its own origin', async () => {
      expect((await request(app()).post('/api/projects').set('Origin', APP_ORIGIN)).status).toBe(200);
      expect((await request(app()).get('/api/health')).status).toBe(200);
    });

    it("allows every loopback name for the back end's host, and the app origin's host", async () => {
      for (const host of ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000', 'LOCALHOST:3000']) {
        expect((await request(app()).get('/api/health').set('Host', host)).status).toBe(200);
      }
      const custom = app({ appOrigin: 'http://cdk.test:5173' });
      expect((await request(custom).get('/api/health').set('Host', 'cdk.test:5173')).status).toBe(200);
    });

    it('rejects another website by its Origin, with the standard 403 and no detail', async () => {
      const res = await request(app()).post('/api/projects').set('Origin', 'https://evil.example.com').send({ title: 'x' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('rejects a build preview by its Origin and by its Host', async () => {
      expect((await request(app()).get('/api/health').set('Origin', 'http://preview.localhost:3000')).body).toEqual(FORBIDDEN);
      expect((await request(app()).get('/api/health').set('Host', 'preview.localhost:3000')).body).toEqual(FORBIDDEN);
    });

    it('rejects a DNS-rebinding request: a foreign Host with no Origin', async () => {
      const res = await request(app()).get('/api/projects/p1').set('Host', 'attacker.example:3000');

      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it("leaves routes outside /api alone", async () => {
      expect((await request(app()).get('/other').set('Origin', 'https://evil.example.com')).status).toBe(200);
    });
  });

  describe('with a launch token, as in the desktop app', () => {
    const TOKEN = 'secret-launch-token-abc123';
    const COOKIE = `${LAUNCH_COOKIE}=${TOKEN}`;
    const tokenApp = () => app({ launchToken: TOKEN });

    it('allows a request carrying the token in its cookie, among other cookies, with or without the app origin', async () => {
      expect((await request(tokenApp()).get('/api/health').set('Origin', APP_ORIGIN).set('Cookie', COOKIE)).status).toBe(200);
      expect((await request(tokenApp()).get('/api/health').set('Cookie', `theme=dark; ${COOKIE}; lang=en`)).status).toBe(200);
    });

    it('rejects a request with no token, the wrong one, or the token anywhere but its cookie', async () => {
      expect((await request(tokenApp()).get('/api/health').set('Origin', APP_ORIGIN)).body).toEqual(FORBIDDEN);
      expect((await request(tokenApp()).get('/api/health').set('Cookie', `${LAUNCH_COOKIE}=wrong-token`)).body).toEqual(FORBIDDEN);
      expect((await request(tokenApp()).get('/api/health').set('Cookie', `other=${TOKEN}`)).body).toEqual(FORBIDDEN);
      expect((await request(tokenApp()).get('/api/health').set('X-CDK-Token', TOKEN)).body).toEqual(FORBIDDEN);
    });

    it('rejects a request with the token from a foreign origin or host', async () => {
      expect((await request(tokenApp()).get('/api/health').set('Origin', 'https://evil.example.com').set('Cookie', COOKIE)).status).toBe(403);
      expect((await request(tokenApp()).get('/api/health').set('Host', 'attacker.example:3000').set('Cookie', COOKIE)).status).toBe(403);
    });
  });
});
