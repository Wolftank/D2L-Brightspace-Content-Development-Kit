import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, ENV_FILE, loadConfig } from './config.js';

const BACK_END = fileURLToPath(new URL('..', import.meta.url));

describe('loadConfig', () => {
  it('applies the defaults when nothing is set', () => {
    expect(loadConfig({ LOCALAPPDATA: '/appdata' })).toEqual({
      port: 3000,
      dataDir: resolve('/appdata', 'CDK'),
      agent: { driver: 'claude', model: undefined, effort: undefined },
      appOrigin: 'http://127.0.0.1:5173',
      previewOrigin: 'http://preview.localhost:3000',
    });
  });

  it('stores data under the home directory when LOCALAPPDATA is unset', () => {
    expect(loadConfig({}).dataDir).toBe(join(homedir(), '.cdk'));
  });

  it('reads every setting from the environment', () => {
    const config = loadConfig({
      AGENT_DRIVER: 'claude',
      AGENT_MODEL: 'claude-sonnet-5',
      AGENT_EFFORT: 'medium',
      PORT: '4000',
      DATA_DIR: resolve('/data/cdk'),
      APP_ORIGIN: 'http://127.0.0.1:4000',
    });

    expect(config).toEqual({
      port: 4000,
      dataDir: resolve('/data/cdk'),
      agent: { driver: 'claude', model: 'claude-sonnet-5', effort: 'medium' },
      appOrigin: 'http://127.0.0.1:4000',
      previewOrigin: 'http://preview.localhost:4000',
    });
  });

  it.each([
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173'],
    ['  http://LOCALHOST:5173  ', 'http://localhost:5173'],
    ['https://cdk.example.edu', 'https://cdk.example.edu'],
  ])('reads APP_ORIGIN=%j as the origin %j', (value, origin) => {
    expect(loadConfig({ APP_ORIGIN: value }).appOrigin).toBe(origin);
  });

  it('resolves a relative DATA_DIR against back-end/', () => {
    expect(loadConfig({ DATA_DIR: 'local-data' }).dataDir).toBe(join(BACK_END, 'local-data'));
  });

  it.each([
    ['PORT', '0', 'must be a whole number from 1 to 65535'],
    ['PORT', '65536', 'must be a whole number from 1 to 65535'],
    ['PORT', '70000', 'must be a whole number from 1 to 65535'],
    ['PORT', 'notanumber', 'must be a whole number from 1 to 65535'],
    ['PORT', '3000.5', 'must be a whole number from 1 to 65535'],
    ['PORT', '0x10', 'must be a whole number from 1 to 65535'],
    ['PORT', ' 42 ', 'must be a whole number from 1 to 65535'],
    ['PORT', '', 'must be a whole number from 1 to 65535'],
    ['AGENT_DRIVER', 'copilot', 'must be one of claude'],
    ['AGENT_EFFORT', 'huge', 'must be one of low, medium, high, xhigh, max'],
    ['AGENT_MODEL', '   ', 'must not be blank'],
    ['DATA_DIR', '', 'must not be blank'],
    ['DATA_DIR', '   ', 'must not be blank'],
    ['APP_ORIGIN', '127.0.0.1:5173', 'must be an http or https origin with no path'],
    ['APP_ORIGIN', 'ftp://127.0.0.1:5173', 'must be an http or https origin with no path'],
    ['APP_ORIGIN', 'http://127.0.0.1:5173/app', 'must be an http or https origin with no path'],
    ['APP_ORIGIN', 'http://127.0.0.1:5173/?x=1', 'must be an http or https origin with no path'],
    ['APP_ORIGIN', 'http://user:pass@127.0.0.1:5173', 'must be an http or https origin with no path'],
    ['APP_ORIGIN', 'http://preview.localhost:3000', 'must not be the preview origin'],
  ])('rejects %s=%j, naming the setting and the rule', (name, value, rule) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [name]: value })).toThrow(`${name}: ${rule}`);
  });

  it('lists every invalid setting at once', () => {
    const load = () => loadConfig({ PORT: 'abc', AGENT_DRIVER: 'copilot' });

    expect(load).toThrow('PORT: ');
    expect(load).toThrow('AGENT_DRIVER: ');
  });

  it('ignores variables it does not use', () => {
    expect(loadConfig({ PATH: '/bin', NODE_ENV: 'test' }).port).toBe(3000);
  });
});

describe('ENV_FILE', () => {
  it('is .env in back-end/', () => {
    expect(ENV_FILE).toBe(join(BACK_END, '.env'));
  });
});
