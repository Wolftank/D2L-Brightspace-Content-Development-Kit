import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BuildIncomplete, BuildNotReady, errorHandler } from './errors.js';

function appThrowing(err: Error) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('maps BuildNotReady to a 409 build_not_ready envelope', async () => {
    const res = await request(appThrowing(new BuildNotReady('failed'))).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'build_not_ready',
        message: 'Only a ready build can be downloaded; this build is failed',
        details: { status: 'failed' },
      },
    });
  });

  it('maps BuildIncomplete to a 409 build_incomplete envelope listing the missing files', async () => {
    const res = await request(appThrowing(new BuildIncomplete(['index.html']))).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'build_incomplete',
        message: 'The build is missing files its manifest needs: index.html',
        details: { missing: ['index.html'] },
      },
    });
  });
});
