import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, type BrowserWindow, dialog } from 'electron';
import electronUpdater, { type Logger } from 'electron-updater';

/** The index of **Restart now** in the update dialog's buttons. */
const RESTART_NOW = 0;

/**
 * Whether this copy of the app was installed by its installer, which puts its
 * uninstaller beside the executable. A packaged copy run from `win-unpacked`
 * has none, and updating it would install into another folder.
 */
function isInstalled(): boolean {
  return app.isPackaged && existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
}

/** Asks whether to restart now to install `version`, and if so stops the back end, then installs it and reopens CDK. */
async function offerRestart(version: string, window: BrowserWindow, log: Logger, stopBackEnd: () => Promise<void>): Promise<void> {
  if (window.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(window, {
    type: 'info',
    title: 'Update ready',
    message: `CDK ${version} is ready to install.`,
    detail: 'Restart now to install it. Any request that is running is stopped, and its work so far is kept. If you choose Later, it installs the next time you close CDK.',
    buttons: ['Restart now', 'Later'],
    defaultId: RESTART_NOW,
    cancelId: 1,
    noLink: true,
  });
  if (response !== RESTART_NOW) {
    log.info('Update installs when CDK closes');
    return;
  }
  log.info('Restarting to install the update');
  await stopBackEnd();
  electronUpdater.autoUpdater.quitAndInstall();
}

/**
 * Checks this repository's GitHub releases for a newer version of the
 * installed app, and downloads it in the background. Once it is downloaded, a
 * dialog over `window` offers **Restart now**, which calls `stopBackEnd` and
 * then installs it and reopens CDK, or **Later**, which leaves electron-updater
 * to install it silently when the app next closes. Logs to `log`, and skips
 * the check in a copy that was not installed.
 */
export function startUpdates(log: Logger, window: BrowserWindow, stopBackEnd: () => Promise<void>): void {
  if (!isInstalled()) {
    log.info('Update check skipped: this copy of CDK is not installed');
    return;
  }
  const { autoUpdater } = electronUpdater;
  autoUpdater.logger = log;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.on('update-downloaded', ({ version }) => void offerRestart(version, window, log, stopBackEnd));
  // electron-updater logs a failed check or download through its own error listener.
  autoUpdater.checkForUpdates().then((result) => result?.downloadPromise).catch(() => {});
}
