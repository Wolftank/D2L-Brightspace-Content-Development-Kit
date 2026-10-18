import { describe, expect, it } from 'vitest';
import { appOrigin, backEndEnv, launchCookie } from './back-end.js';

describe('appOrigin', () => {
  it('is the back end on 127.0.0.1 at its port', () => {
    expect(appOrigin(51234)).toBe('http://127.0.0.1:51234');
  });
});

describe('backEndEnv', () => {
  it("runs the app's executable as Node, serves the built front end as the app origin, requires the launch token, and logs the app's version", () => {
    expect(backEndEnv({ PATH: 'C:\Windows', USERPROFILE: 'C:\Users\pat' }, 51234, 'C:\CDK\resources\front-end', 'token-1', '0.2.0')).toEqual({
      PATH: 'C:\Windows',
      USERPROFILE: 'C:\Users\pat',
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '51234',
      APP_ORIGIN: 'http://127.0.0.1:51234',
      APP_DIR: 'C:\CDK\resources\front-end',
      LAUNCH_TOKEN: 'token-1',
      APP_VERSION: '0.2.0',
    });
  });

  it('replaces a port and origin already set in the environment', () => {
    const env = backEndEnv(
      { PORT: '3000', APP_ORIGIN: 'http://127.0.0.1:5173', APP_DIR: 'elsewhere', LAUNCH_TOKEN: 'old', APP_VERSION: '0.1.0' },
      51234,
      'front-end',
      'token-1',
      '0.2.0',
    );

    expect(env).toMatchObject({ PORT: '51234', APP_ORIGIN: 'http://127.0.0.1:51234', APP_DIR: 'front-end', LAUNCH_TOKEN: 'token-1', APP_VERSION: '0.2.0' });
  });
});

describe('launchCookie', () => {
  it('names the cookie the back end reads the launch token from', () => {
    expect(launchCookie('token-1')).toBe('cdk_launch=token-1');
  });
});
