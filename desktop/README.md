# desktop

The Windows app. Its Electron main process starts the back end, opens the CDK window on it, keeps one copy running, stops the back end when the window closes, and updates itself from this repository's GitHub releases. Building, installing, and running the app are in the [root README](../README.md#the-windows-app).

## How it runs

- `src/main.ts` takes the single-instance lock, starts the back end, and opens the window at the back end's own origin. A second launch restores and focuses the open window. Closing the window quits the app. Every way the app closes, including **Restart now** for an update, goes through `stopBackEnd()`, which stops the back end once and lets the app exit only after it has stopped.
- `src/updates.ts` checks for updates. See [Updates](#updates).
- `src/log.ts` opens the desktop app's own log, `desktop.<n>.log`, in the back end's logs folder: one JSON record per line, written with pino and pino-roll like the back end's. A new file starts at 1 MB, and one older file is kept. It holds the update check's records.
- `src/menu.ts` is the app's only menu: **Help > Open logs folder** opens the back end's logs folder in File Explorer with `shell.openPath`.
- `src/back-end.ts` starts `cdk-back-end/dist/server.js` with the app's own executable as Node (`ELECTRON_RUN_AS_NODE=1`), on a port the OS picks, with `APP_ORIGIN=http://127.0.0.1:<port>` and `APP_DIR` set to the built front end. Previews are on `http://preview.localhost:<port>`. It passes the app's version as `APP_VERSION`, for the back end's startup log record. It waits for `/api/health` and reports the back end's error output if it stops while starting. Once its log file is open, the back end sends the logs folder back over a Node IPC channel, so the data folder's default stays in the back end's `config.ts` alone. `stop()` sends the back end `shutdown` over the same channel. The back end then stops any running request, keeping its work so far, and exits. If it has not exited within 5 seconds, `stop()` ends its process tree with `taskkill /T /F`, which also ends the agent and every command either started.
- If the back end stops while the window is open, the app says so and quits. The next launch marks any request that was running as interrupted.

## Updates

`src/updates.ts` uses [electron-updater](https://www.electron.build/auto-update) with the GitHub releases named in `electron-builder.yml`'s `publish` setting:

1. When the installed app starts, it reads the newest release's `latest.yml` and, if its version is newer, downloads the installer in the background to `%LOCALAPPDATA%\cdk-desktop-updater`. It checks only in a copy that was installed, recognised by `Uninstall CDK.exe` beside `CDK.exe`. A copy run from `release/win-unpacked/`, including the smoke tests, logs that it skipped the check, since an update would install into another folder.
2. When the download finishes, a dialog says the new version is ready, with **Restart now** and **Later**.
   - **Restart now** waits for `stopBackEnd()`, so a running request is stopped the same way as closing the app, then runs the installer with its progress window. The installer reopens CDK when it finishes.
   - **Later** leaves the update for electron-updater, which runs the installer silently from Electron's `quit` event the next time the app closes. That event still fires after the `will-quit` handler stops the back end and calls `app.exit()`.
3. A failed check or download, such as with no network or a release without `latest.yml`, is logged to `desktop.<n>.log` and never shown.

The update installs for the current user like the first install, with no admin prompt, and keeps the projects in `%LOCALAPPDATA%\CDK`. The installer is unsigned, and `publisherName` is not set, so electron-updater does not check a signature.

### Publish a release that installed apps pick up

1. In a pull request, raise the version in `desktop/package.json`:

   ```
   npm version 0.2.1 --no-git-tag-version --workspace cdk-desktop
   ```

   This changes only `desktop/package.json` and `package-lock.json`. Merge the pull request.
2. On GitHub, open **Actions**, select **CI**, then **Run workflow** on `main`. CI refuses a run that is not on `main` or a version that is already released, runs every check, and builds the installer.
3. Once every job passes, CI's `release` job publishes release `v<version>` with `CDK-Setup-<version>.exe`, `CDK-Setup-<version>.exe.blockmap`, and `latest.yml`, and notes generated from the merged pull requests.

Installed apps find the release the next time they start. `latest.yml` names the installer and its sha512, so the three files must stay as CI published them: never rename or replace one by hand. A release without `latest.yml` is ignored by installed apps, which log the failed check. Version 0.1.0 has no updater, so its users install a newer version by hand once.

## Packaging

`npm run package` at the repository root builds every package, then runs `electron-builder` here with `electron-builder.yml`:

- The app is the compiled main process and the `cdk-back-end` workspace with its production dependencies. Only the back end's `package.json`, `dist/`, `drizzle/`, `kit/`, and `preview/` are packaged, so a local `back-end/.env` is never shipped.
- The built front end (`front-end/dist`) is packaged as the `front-end` resource.
- `asar` is off. The kit is copied into workspaces, the agent's `claude.exe` and the QA gate are started as processes, and the back end sends the player's files, so every file stays a real file on disk.
- `after-pack.mjs` installs better-sqlite3's prebuilt binary for the app's Electron into the packaged copy, through the module's own `prebuild-install`. The repository's `node_modules` keep the Node build, so tests and development are unaffected. Electron stays on a version better-sqlite3 publishes a prebuilt binary for (Electron 42, ABI 146, for better-sqlite3 12.11.1), so packaging needs no C++ toolchain.
- The installer is a one-click, per-user NSIS installer, `release/CDK-Setup-<version>.exe`. `installer.nsh` adds to its uninstaller, except during an upgrade:
  - It removes `%LOCALAPPDATA%\cdk-desktop-updater`, with the copy of the installer that every install keeps and any downloaded update. electron-builder's uninstaller leaves that folder behind.
  - It asks whether to also delete the projects in `%LOCALAPPDATA%\CDK`, defaulting to No. A silent (`/S`) uninstall keeps them without asking.
- `deleteAppDataOnUninstall` removes the window's data in `%APPDATA%\CDK`, except during an upgrade.
- The `publish` setting names this repository's GitHub releases. Because of it, packaging also writes `release/latest.yml` and `resources/app-update.yml` in the app, which electron-updater reads, beside the installer's `.blockmap`.
- `--publish never` keeps electron-builder from publishing a release itself, including in CI.

CI's `package` job, on Windows, runs `npm run package` and `npm run test:e2e`, then uploads the installer, its `.blockmap`, and `latest.yml` under their own names in one artifact named `CDK-Setup-<version>-<commit>`. When CI is run by hand, the job first checks that it is on `main` and that the version in `package.json` is not released yet, and CI's `release` job publishes the three files as a GitHub release once every job has passed. See [Publish a release that installed apps pick up](#publish-a-release-that-installed-apps-pick-up).

There is no development mode that runs Electron against the repository: that would need the shared better-sqlite3 rebuilt for Electron, which breaks the back end's tests. Package with `npx electron-builder --win --dir` here (after `npm run build` in each package) for a quicker runnable copy in `release/win-unpacked/` without the installer.

## Scripts

- `npm run build` — compile `src/` to `dist/`
- `npm run package` — build the installer and `release/win-unpacked/` from the already built packages
- `npm run test:e2e` — smoke test the packaged app in `release/win-unpacked/` with Playwright: the back end on the app's own runtime and the log file it writes, then the whole app from launch to close. Uses temporary data folders, never makes agent calls
- `npm test` — unit (`*.test.ts`) and integration (`*.int.test.ts`) tests, with the back end's suffix rules
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
