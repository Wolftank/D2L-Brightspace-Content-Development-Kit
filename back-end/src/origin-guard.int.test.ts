import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { originGuard, type OriginGuardSettings } from './origin-guard.js';

const APP_ORIGIN = 'http://127.0.0.1:5173';
const PREVIEW_ORIGIN = 'http://preview.localhost:3000';

function app(overrides?: Partial<OriginGuardSettings>) {
  const settings: OriginGuardSettings = {
    appOrigin: APP_ORIGIN,
    previewOrigin: PREVIEW_ORIGIN,
    ...overrides,
  };
  const a = express();
  a.use('/api', originGuard(settings));
  a.use('/api', (_req, res) => res.json({ ok: true }));
  return a;
}

describe('origin guard', () => {
  describe('without launch token (dev mode)', () => {
    it('allows a request with the app origin', async () => {
      const res = await request(app()).get('/api/health').set('Origin', APP_ORIGIN);
      expect(res.status).toBe(200);
    });

    it('allows a request with no Origin header (same-origin or curl)', async () => {
      const res = await request(app()).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('rejects a request from a foreign origin', async () => {
      const res = await request(app()).get('/api/health').set('Origin', 'https://evil.example.com');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } });
    });

    it('rejects a request from the preview origin', async () => {
      const res = await request(app()).get('/api/health').set('Origin', PREVIEW_ORIGIN);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('rejects a request whose Host is the preview hostname', async () => {
      const res = await request(app()).get('/api/health').set('Host', 'preview.localhost:3000');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('gives no detail in the 403 response', async () => {
      const res = await request(app()).get('/api/health').set('Origin', 'https://evil.example.com');
      expect(Object.keys(res.body.error)).toEqual(['code', 'message']);
    });
  });

  describe('with launch token (packaged app)', () => {
    const TOKEN = 'secret-launch-token-abc123';
    const tokenApp = () => app({ launchToken: TOKEN });

    it('allows a request with the correct token and app origin', async () => {
      const res = await request(tokenApp())
        .get('/api/health')
        .set('Origin', APP_ORIGIN)
        .set('X-CDK-Token', TOKEN);
      expect(res.status).toBe(200);
    });

    it('allows a request with the correct token and no origin (same-origin)', async () => {
      const res = await request(tokenApp()).get('/api/health').set('X-CDK-Token', TOKEN);
      expect(res.status).toBe(200);
    });

    it('rejects a request with no token', async () => {
      const res = await request(tokenApp()).get('/api/health').set('Origin', APP_ORIGIN);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('rejects a request with the wrong token', async () => {
      const res = await request(tokenApp())
        .get('/api/health')
        .set('Origin', APP_ORIGIN)
        .set('X-CDK-Token', 'wrong-token');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('rejects a request with the correct token but a foreign origin', async () => {
      const res = await request(tokenApp())
        .get('/api/health')
        .set('Origin', 'https://evil.example.com')
        .set('X-CDK-Token', TOKEN);
      expect(res.status).toBe(403);
    });

    it('rejects a request with the correct token from the preview origin', async () => {
      const res = await request(tokenApp())
        .get('/api/health')
        .set('Origin', PREVIEW_ORIGIN)
        .set('X-CDK-Token', TOKEN);
      expect(res.status).toBe(403);
    });
  });

  describe('does not affect non-API routes', () => {
    it('the guard is mounted on /api and does not touch other paths', async () => {
      const a = express();
      a.use('/api', originGuard({ appOrigin: APP_ORIGIN, previewOrigin: PREVIEW_ORIGIN }));
      a.use('/other', (_req, res) => res.json({ ok: true }));

      const res = await request(a).get('/other').set('Origin', 'https://evil.example.com');
      expect(res.status).toBe(200);
    });
  });

  describe('POST and other methods', () => {
    it('rejects a POST from a foreign origin', async () => {
      const res = await request(app())
        .post('/api/projects')
        .set('Origin', 'https://evil.example.com')
        .send({ title: 'Test' });
      expect(res.status).toBe(403);
    });

    it('allows a POST from the app origin', async () => {
      const res = await request(app())
        .post('/api/projects')
        .set('Origin', APP_ORIGIN)
        .send({ title: 'Test' });
      expect(res.status).toBe(200);
    });
  });
});
