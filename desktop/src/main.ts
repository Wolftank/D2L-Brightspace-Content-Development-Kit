import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { type BackEnd, LAUNCH_COOKIE, startBackEnd } from './back-end.js';
import { isGuideUrl } from './help-links.js';

/** The compiled back end, from the `cdk-back-end` workspace packaged with the app. */
const SERVER = createRequire(import.meta.url).resolve('cdk-back-end/dist/server.js');

/** The built front end, packaged as an extra resource next to the app. */
const APP_DIR = join(process.resourcesPath, 'front-end');

let window: BrowserWindow | undefined;
let backEnd: BackEnd | undefined;
let quitting = false;

function showWindow(): void {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function open(): Promise<void> {
  backEnd = await startBackEnd(process.execPath, SERVER, APP_DIR);
  void backEnd.exited.then(() => {
    if (quitting) return;
    dialog.showErrorBox('CDK stopped', 'The CDK back end stopped unexpectedly. Open CDK again to continue.');
    app.quit();
  });

  window = new BrowserWindow({ width: 1280, height: 860, title: 'CDK', show: false });
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
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Menu.setApplicationMenu(null);

  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', (event) => {
    if (!backEnd) return;
    quitting = true;
    event.preventDefault();
    void backEnd.stop().finally(() => app.exit());
  });

  app.whenReady().then(open).catch((err: unknown) => {
    dialog.showErrorBox('CDK could not start', err instanceof Error ? err.message : String(err));
    app.quit();
  });
}
