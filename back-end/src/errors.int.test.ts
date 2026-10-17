import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BuildFailed, BuildIncomplete, BuildNotFound, BuildNotReady, errorHandler } from './errors.js';

function appThrowing(err: Error) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('maps BuildNotFound to a 404 build_not_found envelope', async () => {
    const res = await request(appThrowing(new BuildNotFound())).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'build_not_found', message: "This build doesn't exist.", nextStep: 'send_again' },
    });
  });

  it('maps BuildNotReady to a 409 build_not_ready envelope', async () => {
    const res = await request(appThrowing(new BuildNotReady())).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'build_not_ready', message: "This build isn't ready to download.", nextStep: 'try_later' },
    });
  });

  it('maps BuildFailed to a 409 build_failed envelope', async () => {
    const res = await request(appThrowing(new BuildFailed())).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'build_failed', message: "This build failed, so it can't be downloaded.", nextStep: 'ask_for_fix' },
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
