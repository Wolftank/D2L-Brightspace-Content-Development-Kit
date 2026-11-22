import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { type BackEnd, LAUNCH_COOKIE, startBackEnd } from './back-end.js';
import { isGuideUrl } from './help-links.js';
import { openLog } from './log.js';
import { appMenu } from './menu.js';
import { startUpdates } from './updates.js';

/** The compiled back end, from the `cdk-back-end` workspace packaged with the app. */
const SERVER = createRequire(import.meta.url).resolve('cdk-back-end/dist/server.js');

/** The built front end, packaged as an extra resource next to the app. */
const APP_DIR = join(process.resourcesPath, 'front-end');

let window: BrowserWindow | undefined;
let backEnd: BackEnd | undefined;
let quitting = false;
let stopping: Promise<void> | undefined;

function showWindow(): void {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/** Stops the back end once, for every way the app closes, so a running request is always stopped the same way and its work kept. */
function stopBackEnd(): Promise<void> {
  quitting = true;
  stopping ??= backEnd ? backEnd.stop() : Promise.resolve();
  return stopping;
}

async function open(): Promise<void> {
  backEnd = await startBackEnd(process.execPath, SERVER, APP_DIR, app.getVersion());
  Menu.setApplicationMenu(appMenu(backEnd.logsDir));
  void backEnd.exited.then(() => {
    if (quitting) return;
    dialog.showErrorBox('CDK stopped', 'The CDK back end stopped unexpectedly. Open CDK again to continue.');
    app.quit();
  });

  const appWindow = new BrowserWindow({ width: 1280, height: 860, title: 'CDK', show: false });
  window = appWindow;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isGuideUrl(url)) void shell.openExternal(url).catch(() => dialog.showErrorBox('Could not open help', 'Open the guide link in your browser.'));
    return { action: 'deny' };
  });
  window.once('ready-to-show', showWindow);
  await window.webContents.session.cookies.set({
    url: backEnd.url,
    name: LAUNCH_COOKIE,
    value: backEnd.launchToken,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
  });
  await window.loadURL(backEnd.url);
  // Without a log, the app runs as usual and does not check for updates.
  void backEnd.logsDir.then(openLog).then((log) => startUpdates(log, appWindow, stopBackEnd)).catch(() => {});
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Menu.setApplicationMenu(null);

  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', (event) => {
    if (!backEnd) return;
    event.preventDefault();
    void stopBackEnd().finally(() => app.exit());
  });

  app.whenReady().then(open).catch((err: unknown) => {
    dialog.showErrorBox('CDK could not start', err instanceof Error ? err.message : String(err));
    app.quit();
  });
}
