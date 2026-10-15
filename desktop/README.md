# desktop

The Windows app. Its Electron main process starts the back end, opens the CDK window on it, keeps one copy running, and stops the back end's whole process tree when the window closes. Building, installing, and running the app are in the [root README](../README.md#the-windows-app).

## How it runs

- `src/main.ts` takes the single-instance lock, starts the back end, and opens the window at the back end's own origin. A second launch restores and focuses the open window. Closing the window quits the app.
- `src/back-end.ts` starts `cdk-back-end/dist/server.js` with the app's own executable as Node (`ELECTRON_RUN_AS_NODE=1`), on a port the OS picks, with `APP_ORIGIN=http://127.0.0.1:<port>` and `APP_DIR` set to the built front end. Previews are on `http://preview.localhost:<port>`. It waits for `/api/health` and reports the back end's error output if it stops while starting. `stop()` ends the back end with `taskkill /T /F`, which also ends the agent and every command either started.
- If the back end stops while the window is open, the app says so and quits. The next launch marks any request that was running as interrupted.

## Packaging

`npm run package` at the repository root builds every package, then runs `electron-builder` here with `electron-builder.yml`:

- The app is the compiled main process and the `cdk-back-end` workspace with its production dependencies. Only the back end's `package.json`, `dist/`, `drizzle/`, `kit/`, and `preview/` are packaged, so a local `back-end/.env` is never shipped.
- The built front end (`front-end/dist`) is packaged as the `front-end` resource.
- `asar` is off. The kit is copied into workspaces, the agent's `claude.exe` and the QA gate are started as processes, and the back end sends the player's files, so every file stays a real file on disk.
- `after-pack.mjs` installs better-sqlite3's prebuilt binary for the app's Electron into the packaged copy, through the module's own `prebuild-install`. The repository's `node_modules` keep the Node build, so tests and development are unaffected. Electron stays on a version better-sqlite3 publishes a prebuilt binary for (Electron 42, ABI 146, for better-sqlite3 12.11.1), so packaging needs no C++ toolchain.
- The installer is a one-click, per-user NSIS installer. `installer.nsh` adds to its uninstaller, except during an upgrade:
  - It removes the copy of the installer that every install keeps in `%LOCALAPPDATA%\cdk-desktop-updater`, which electron-builder's uninstaller leaves behind.
  - It asks whether to also delete the projects in `%LOCALAPPDATA%\CDK`, defaulting to No. A silent (`/S`) uninstall keeps them without asking.
- `deleteAppDataOnUninstall` removes the window's data in `%APPDATA%\CDK`, except during an upgrade.
- `--publish never` keeps electron-builder from publishing a release when it runs in CI.

CI's `package` job, on Windows, runs `npm run package` and `npm run test:e2e`, then uploads the installer as `CDK-Setup-<version>-<commit>.exe`.

There is no development mode that runs Electron against the repository: that would need the shared better-sqlite3 rebuilt for Electron, which breaks the back end's tests. Package with `npx electron-builder --win --dir` here (after `npm run build` in each package) for a quicker runnable copy in `release/win-unpacked/` without the installer.

## Scripts

- `npm run build` — compile `src/` to `dist/`
- `npm run package` — build the installer and `release/win-unpacked/` from the already built packages
- `npm run test:e2e` — smoke test the packaged app in `release/win-unpacked/` with Playwright: the back end on the app's own runtime, then the whole app from launch to close. Uses temporary data folders, never makes agent calls
- `npm test` — unit (`*.test.ts`) and integration (`*.int.test.ts`) tests, with the back end's suffix rules
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
