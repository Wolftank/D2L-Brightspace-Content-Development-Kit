import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Arch } from 'electron-builder';

const ELECTRON_VERSION = createRequire(import.meta.url)('electron/package.json').version;

/**
 * Replaces the packaged better-sqlite3's binary with its prebuilt one for the
 * app's Electron, through the module's own prebuild-install. Only the packaged
 * copy changes, so the repository's node_modules keep matching Node for tests
 * and development.
 *
 * @param {import('electron-builder').AfterPackContext} context
 */
export default async function afterPack(context) {
  const moduleDir = resolve(context.appOutDir, 'resources', 'app', 'node_modules', 'better-sqlite3');
  const prebuildInstall = createRequire(join(moduleDir, 'package.json')).resolve('prebuild-install/bin.js');
  await promisify(execFile)(
    process.execPath,
    [prebuildInstall, '--runtime', 'electron', '--target', ELECTRON_VERSION, '--arch', Arch[context.arch], '--platform', context.electronPlatformName],
    { cwd: moduleDir },
  );
}
