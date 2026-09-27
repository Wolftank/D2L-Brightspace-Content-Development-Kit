import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, loadDotEnv } from './config.js';

describe('loadConfig', () => {
  it('applies the documented defaults when nothing is set', () => {
    const config = loadConfig({});
    expect(config.AGENT_DRIVER).toBe('claude');
    expect(config.PORT).toBe(3000);
    expect(config.DATA_DIR.length).toBeGreaterThan(0);
    expect(isAbsolute(config.DATA_DIR)).toBe(true);
  });

  it('reads the settings from the given environment', () => {
    const config = loadConfig({ AGENT_DRIVER: 'claude', DATA_DIR: '/tmp/cdk-data', PORT: '4000' });
    expect(config.AGENT_DRIVER).toBe('claude');
    expect(config.DATA_DIR).toBe('/tmp/cdk-data');
    expect(config.PORT).toBe(4000);
  });

  it('resolves a relative DATA_DIR to an absolute path', () => {
    const config = loadConfig({ DATA_DIR: 'cdk-data' });
    expect(config.DATA_DIR).toBe(resolve('cdk-data'));
  });

  it.each([
    ['an unsupported agent driver', { AGENT_DRIVER: 'copilot' }, "AGENT_DRIVER: expected 'claude', got \"copilot\""],
    ['a port of zero', { PORT: '0' }, 'PORT: expected an integer from 1 to 65535, got "0"'],
    ['a port past 65535', { PORT: '65536' }, 'PORT: expected an integer from 1 to 65535'],
    ['a non-numeric port', { PORT: 'later' }, 'PORT: expected an integer from 1 to 65535, got "later"'],
    ['a fractional port', { PORT: '30.5' }, 'PORT: expected an integer from 1 to 65535'],
    ['a blank data directory', { DATA_DIR: '   ' }, 'DATA_DIR: expected a non-empty directory path'],
  ])('rejects %s, naming the setting and the expected value', (_case, env, message) => {
    expect(() => loadConfig(env)).toThrowError(message);
  });
});

describe('loadDotEnv', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cdk-config-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('loads the file into the environment', async () => {
    const path = join(dir, '.env');
    await fs.writeFile(path, 'PORT=4000\nDATA_DIR=/tmp/from-file\n');
    const env: NodeJS.ProcessEnv = {};

    loadDotEnv(path, env);

    expect(env).toEqual({ PORT: '4000', DATA_DIR: '/tmp/from-file' });
  });

  it('lets a real environment variable take precedence over the file', async () => {
    const path = join(dir, '.env');
    await fs.writeFile(path, 'PORT=4000\nDATA_DIR=/tmp/from-file\n');
    const env: NodeJS.ProcessEnv = { PORT: '5000' };

    loadDotEnv(path, env);

    expect(env).toEqual({ PORT: '5000', DATA_DIR: '/tmp/from-file' });
  });

  it('leaves the environment alone when the file does not exist', () => {
    const env: NodeJS.ProcessEnv = { PORT: '5000' };

    loadDotEnv(join(dir, 'no-such-file'), env);

    expect(env).toEqual({ PORT: '5000' });
  });
});
