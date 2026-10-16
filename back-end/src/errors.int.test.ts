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
        message: "This build isn't ready to download.",
        nextStep: 'try_later',
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
        message: 'This build is missing files it needs.',
        nextStep: 'send_again',
        details: { missing: ['index.html'] },
      },
    });
  });
});
