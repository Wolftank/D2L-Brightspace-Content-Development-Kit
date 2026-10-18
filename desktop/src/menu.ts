import { dialog, Menu, shell } from 'electron';

/** Opens `logsDir` in File Explorer, or says why it could not. */
async function openLogsFolder(logsDir: Promise<string>): Promise<void> {
  const error = await shell.openPath(await logsDir);
  if (error) dialog.showErrorBox('Could not open the logs folder', error);
}

/** The app's menu: Help, with "Open logs folder" for the folder `logsDir` resolves to. */
export function appMenu(logsDir: Promise<string>): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Help',
      submenu: [{ label: 'Open logs folder', click: () => void openLogsFolder(logsDir) }],
    },
  ]);
}
