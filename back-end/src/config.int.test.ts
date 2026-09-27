import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkDataDir, ConfigError, loadEnvFile } from './config.js';

describe('config on disk', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cdk-config-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.CDK_TEST_FROM_FILE;
    delete process.env.CDK_TEST_OVERRIDDEN;
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('loadEnvFile', () => {
    it('sets variables from the file and keeps the ones already in the environment', async () => {
      const file = join(dir, '.env');
      await fs.writeFile(file, 'CDK_TEST_FROM_FILE=from-file\nCDK_TEST_OVERRIDDEN=from-file\n');
      process.env.CDK_TEST_OVERRIDDEN = 'from-environment';

      loadEnvFile(file);

      expect(process.env.CDK_TEST_FROM_FILE).toBe('from-file');
      expect(process.env.CDK_TEST_OVERRIDDEN).toBe('from-environment');
    });

    it('skips a missing file', () => {
      expect(() => loadEnvFile(join(dir, 'missing.env'))).not.toThrow();
    });

    it('names the file when it exists but cannot be read', async () => {
      const file = join(dir, '.env');
      await fs.writeFile(file, 'CDK_TEST_FROM_FILE=from-file\n');
      // Node reports a file locked by another process as ENOENT.
      vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      });

      expect(() => loadEnvFile(file)).toThrow(ConfigError);
      expect(() => loadEnvFile(file)).toThrow(`Cannot read ${file}`);
    });
  });

  describe('checkDataDir', () => {
    it('creates a missing directory', async () => {
      const dataDir = join(dir, 'new', 'data');

      checkDataDir(dataDir);

      expect((await fs.stat(dataDir)).isDirectory()).toBe(true);
      expect(await fs.readdir(dataDir)).toEqual([]);
    });

    it('names DATA_DIR when the path cannot be used', async () => {
      const file = join(dir, 'a-file');
      await fs.writeFile(file, 'not a directory');

      expect(() => checkDataDir(join(file, 'data'))).toThrow(ConfigError);
      expect(() => checkDataDir(join(file, 'data'))).toThrow(/^DATA_DIR ".*" cannot be used/);
    });

    // Windows ignores a directory's read-only mode, and root ignores it everywhere.
    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'names DATA_DIR when the directory cannot be written',
      async () => {
        const dataDir = join(dir, 'read-only');
        await fs.mkdir(dataDir, { mode: 0o555 });

        expect(() => checkDataDir(dataDir)).toThrow(/^DATA_DIR ".*" cannot be used/);
      },
    );
  });
});
