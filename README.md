# D2L Brightspace Content Development Kit

Lets any SCSU instructor, technical or not, direct an agent to build, test, and deploy interactive, WCAG 2.2–conformant D2L course content — without ever interacting with the agent directly.

For the full proposal, see [`docs/Capstone_Project_Proposal.pdf`](docs/Capstone_Project_Proposal.pdf) — the finished, team-submitted proposal. Earlier drafts and working/handoff notes are intentionally not carried over here; this repo starts fresh from the finished document.

## Layout

| Path | Purpose |
|---|---|
| [`docs/`](docs/) | The finished project proposal, plus the contract the tracks build against (`architecture.md`), the first slice to build (`v1.md`), and what was verified about each agent (`drivers.md`) |
| [`back-end/kit/`](back-end/kit/) | The actual D2L Content Development Kit — skills, harness/lint gate, probes, kit-level docs. Hardened and extended in place; not a frozen reference copy |
| [`back-end/src/`](back-end/src/) | The back end — runs turns with the agent, runs the QA gate and the pedagogy check, creates builds, deploys to D2L, translates findings to plain language |
| [`packages/contract/`](packages/contract/) | The HTTP API and event stream contract from `architecture.md` as TypeScript types, imported by both the back end and the front end |
| [`front-end/`](front-end/) | Local server + browser app: chat, configurator, build panel, preview. Displays the turn status, QA gate findings, and pedagogy check findings the back end produces — does not run those checks itself |
| [`desktop/`](desktop/) | The Windows app: starts the back end, opens the CDK window, and stops everything when the window closes |
| [`.github/`](.github/) | Issue/PR templates, CI workflow |

## Getting started

Requires Node ^20.19, ^22.13, or 24+. Install once at the repository root; npm workspaces install every package from one lockfile:

```
npm install
```

Then run the back end and the front end from their folders, as their READMEs describe. From the root, `npm test`, `npm run lint`, and `npm run typecheck` run that script in every package.

## The Windows app

The Windows app runs CDK without a terminal, Node, or developer tools. One launch starts the back end and opens the CDK window. Launching it again brings the open window to the front. Closing the window stops the back end and any request the agent is running. A request still running when the window closes is marked as interrupted, and its changes so far are kept.

### Get the installer

Released versions are on the repository's **Releases** page. Download `CDK-Setup-<version>.exe` from the latest release. No GitHub sign-in is needed.

CI also builds the installer for every pull request and every merge to `main`, for testing changes before they are released. On GitHub, open **Actions**, select the run (the latest **CI** run on `main` for the current app), and download `CDK-Setup-<version>-<commit>.exe` from **Artifacts** at the bottom of the run's summary. Downloading needs a GitHub sign-in, and CI keeps each installer for 30 days.

### Publish a release

On GitHub, open **Actions**, select **CI**, then **Run workflow**. Keep the branch as `main`, enter the new version, such as `0.2.0`, and select **Run workflow**. CI runs every check on the latest commit on `main`, builds the installer with that version, and publishes it as release `v<version>` with notes listing the pull requests merged since the last release. If any check fails, nothing is published. A version that is already released is refused.

To build it yourself instead, on Windows, at the repository root, after `npm install`:

```
npm run package
```

This builds every package, then writes the installer to `desktop/release/CDK Setup <version>.exe` and a runnable copy to `desktop/release/win-unpacked/CDK.exe`. Packaging downloads Electron and the Electron build of better-sqlite3 the first time, so it needs internet access. It takes about a minute and a half.

### Install and run

1. Run the installer on the laptop. It installs for the current user, without admin rights, into `%LOCALAPPDATA%\Programs\cdk-desktop`, adds CDK to the Start menu and the desktop, and opens it.
2. After that, open CDK from the Start menu.

The app isn't signed yet, so Windows may warn before it runs:

- **The browser** may warn that the installer isn't commonly downloaded. Choose to keep the file.
- **"Windows protected your PC"** (SmartScreen): select **More info**, then **Run anyway**. Windows shows this for an installer downloaded from the internet, including one from a release or from CI, or received through chat or email. It does not show it for an installer you built on the same computer.
- **Smart App Control** (Windows 11, Settings > Privacy & security > Windows Security > App & browser control): when it is on, it blocks unsigned apps and offers no way to run them. Use a laptop where it is off.

The agent uses the Claude sign-in on the laptop, like the development setup. If Claude Code is already signed in there, nothing else is needed. Otherwise, sign in once from PowerShell with the copy of Claude that ships with CDK:

```
& "$env:LOCALAPPDATA\Programs\cdk-desktop\resources\app\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe" auth login
```

Projects and builds are stored in `%LOCALAPPDATA%\CDK`, the same folder the development back end uses, so the app and a development back end on the same laptop share projects. The window's own browser data is in `%APPDATA%\CDK`.

When something goes wrong, choose **Help > Open logs folder** in the app and send the team the newest `cdk.<date>.<n>.log` file from `%LOCALAPPDATA%\CDK\logs`. The log holds no API keys or tokens and, at the default level, none of the instructor's messages. [The back end's README](back-end/README.md#logs) says what is logged.

### Update and uninstall

To update, run the newer installer. It closes CDK if it is open, replaces the app, keeps your projects, and opens CDK again. This can take several minutes.

To uninstall, open Settings > Apps > Installed apps, select **CDK**, then **Uninstall**. If CDK is open, the uninstaller offers to close it. It then asks whether to also delete your projects and builds in `%LOCALAPPDATA%\CDK`. **No**, the default, keeps them. Either way it removes the app, its Start menu and desktop shortcuts, the copy of the installer it keeps in `%LOCALAPPDATA%\cdk-desktop-updater`, and the window's browser data in `%APPDATA%\CDK`.

## Why front-end and back-end are separate top-level folders

So those tracks can work in parallel without touching each other's files, coordinating only through the contract in [`docs/architecture.md`](docs/architecture.md) and its types in [`packages/contract/`](packages/contract/). Role split across the 7-person team is a front-end/back-end/QA mix, not a fixed head-count per track.
