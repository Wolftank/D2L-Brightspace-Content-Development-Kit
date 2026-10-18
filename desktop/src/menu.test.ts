import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template) },
  shell: { openPath: vi.fn(async (_path: string) => '') },
  dialog: { showErrorBox: vi.fn() },
}));
vi.mock('electron', () => electron);

const { appMenu } = await import('./menu.js');

type Template = { label: string; submenu: { label: string; click: () => void }[] }[];

/** Clicks Help > Open logs folder in a menu for `logsDir`, and waits for the click to finish. */
async function clickOpenLogsFolder(logsDir: string): Promise<void> {
  const [help] = appMenu(Promise.resolve(logsDir)) as unknown as Template;
  expect(help!.label).toBe('Help');
  const item = help!.submenu.find((entry) => entry.label === 'Open logs folder')!;
  item.click();
  await vi.waitFor(() => expect(electron.shell.openPath).toHaveBeenCalled());
}

describe('appMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the logs folder from Help > Open logs folder', async () => {
    await clickOpenLogsFolder('C:\\Users\\pat\\AppData\\Local\\CDK\\logs');

    expect(electron.shell.openPath).toHaveBeenCalledWith('C:\\Users\\pat\\AppData\\Local\\CDK\\logs');
    expect(electron.dialog.showErrorBox).not.toHaveBeenCalled();
  });

  it('says why when the folder cannot be opened', async () => {
    electron.shell.openPath.mockResolvedValueOnce('The system cannot find the path specified.');

    await clickOpenLogsFolder('C:\\missing');

    await vi.waitFor(() =>
      expect(electron.dialog.showErrorBox).toHaveBeenCalledWith('Could not open the logs folder', 'The system cannot find the path specified.'),
    );
  });
});
