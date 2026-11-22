import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  app: { isPackaged: true, getName: () => 'CDK' },
  dialog: { showMessageBox: vi.fn(async (_window: unknown, _options: unknown) => ({ response: 0 })) },
}));
vi.mock('electron', () => electron);

const fs = vi.hoisted(() => ({ existsSync: vi.fn((_path: string) => true) }));
vi.mock('node:fs', () => fs);

/** A stand-in for electron-updater's autoUpdater: an event emitter with the methods the app calls. */
class FakeUpdater extends EventEmitter {
  logger: unknown = console;
  disableWebInstaller = false;
  autoInstallOnAppQuit = true;
  checkForUpdates = vi.fn(async (): Promise<{ downloadPromise?: Promise<string[]> } | null> => ({ downloadPromise: Promise.resolve([]) }));
  quitAndInstall = vi.fn();
}

const updater = vi.hoisted(() => ({ autoUpdater: undefined as unknown as FakeUpdater }));
vi.mock('electron-updater', () => ({ default: updater }));

const { startUpdates } = await import('./updates.js');

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const window = { isDestroyed: () => false };

/** Starts updates for the fake window, with a `stopBackEnd` that records when it was called. */
function start(stopBackEnd = vi.fn(async () => {})) {
  startUpdates(log, window as never, stopBackEnd);
  return stopBackEnd;
}

/** Emits `update-downloaded` for `version` and waits for the dialog's answer to be handled. */
async function download(version: string): Promise<void> {
  updater.autoUpdater.emit('update-downloaded', { version });
  await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/^(Restarting|Update installs)/)));
}

describe('startUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electron.app.isPackaged = true;
    fs.existsSync.mockReturnValue(true);
    updater.autoUpdater = new FakeUpdater();
  });

  it('does not check when the app is not packaged', () => {
    electron.app.isPackaged = false;

    start();

    expect(updater.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('Update check skipped: this copy of CDK is not installed');
  });

  it('does not check in a packaged copy without the uninstaller beside it', () => {
    fs.existsSync.mockReturnValue(false);

    start();

    expect(fs.existsSync).toHaveBeenCalledWith(join(dirname(process.execPath), 'Uninstall CDK.exe'));
    expect(updater.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('checks on start in an installed copy, logging to the app log', () => {
    start();

    expect(updater.autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.autoUpdater.logger).toBe(log);
    expect(updater.autoUpdater.disableWebInstaller).toBe(true);
  });

  it('shows no dialog when the check fails', async () => {
    updater.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'));

    start();
    await Promise.resolve();
    await new Promise(setImmediate);

    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('shows no dialog when the download fails', async () => {
    updater.autoUpdater.checkForUpdates.mockResolvedValueOnce({ downloadPromise: Promise.reject(new Error('sha512 checksum mismatch')) });

    start();
    await new Promise(setImmediate);

    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('offers Restart now and Later once the update is downloaded', async () => {
    start();
    await download('0.2.1');

    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(window, expect.objectContaining({
      title: 'Update ready',
      message: 'CDK 0.2.1 is ready to install.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }));
  });

  it('Restart now stops the back end before installing', async () => {
    const order: string[] = [];
    const stopBackEnd = start(vi.fn(async () => {
      order.push('stopBackEnd');
    }));
    updater.autoUpdater.quitAndInstall.mockImplementation(() => order.push('quitAndInstall'));

    await download('0.2.1');

    expect(stopBackEnd).toHaveBeenCalledOnce();
    expect(order).toEqual(['stopBackEnd', 'quitAndInstall']);
    expect(updater.autoUpdater.quitAndInstall).toHaveBeenCalledWith();
  });

  it('Later leaves the update to install when the app closes', async () => {
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    const stopBackEnd = start();

    await download('0.2.1');

    expect(stopBackEnd).not.toHaveBeenCalled();
    expect(updater.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(log.info).toHaveBeenCalledWith('Update installs when CDK closes');
  });

  it('shows no dialog once the window is gone', async () => {
    start();
    vi.spyOn(window, 'isDestroyed').mockReturnValueOnce(true);

    updater.autoUpdater.emit('update-downloaded', { version: '0.2.1' });
    await new Promise(setImmediate);

    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
