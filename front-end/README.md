# Front end

The browser app provides a project conversation, the latest build and QA findings, and a local activity preview. Checks run in the back end.

## Local preview

Requires Node 20.19+, Node 22.13+, or Node 24+. Install dependencies with `npm install`, then run these commands in separate terminals:

```
npm run stub
npm run dev:stub
```

Open http://127.0.0.1:5173. Name your project and send a request. After the reply, send a change to produce version 2. The stub uses scripted replies and a sample cell-division activity; its preview runs through the kit's D2L emulator. The stub download is an empty ZIP fixture.

A project can be reopened at `/?project=<projectId>`. Reload restores its history, builds and any running turn. Drafts stay in the current browser session. Stub projects live in memory and disappear when the stub server restarts.

`npm run dev` proxies to the real back end at port 3000. F10 requires B17's message-history endpoint and F6's preview endpoint for real-agent integration; those routes are absent from this checkout. The stub implements the expected routes:

- `GET /api/projects/:id/messages` returns `{ items, nextCursor? }`, oldest first. Instructor messages include a `turn` with its status and plain-language error, when present. The app follows every page and merges messages by ID.
- `GET /api/builds/:id/preview/` renders a build through the emulator with a fresh attempt on each load.

The B17 `turn` shape needs to be confirmed when its contract lands.

## Conversation behavior

Live progress sits in the chat with the working indicator. At turn end it collapses to a single outcome line. The instructor and agent messages stay in order. Send stays disabled while the request runs, and the message box remains editable so the next request can be drafted. Failed sends retain the draft.

The build panel shows the newest build. The preview shows the newest ready build, so a checking or failed build keeps the previous ready preview and its version label. Restart reloads the emulator with a fresh attempt. The desktop layout places chat and build side by side with preview below; narrow windows stack the three regions.

## Stub scenarios

- `[qa-fail]`: failed QA build; an ordinary follow-up produces the next ready version.
- `[turn-fail]`: agent failure; an ordinary follow-up continues the same project.
- `[long-step]`: 20-second pause for checking the timer, reload and drafts.
- `[long-feed]`: 60 progress lines for checking scrolling. The feed follows at the bottom, pauses when scrolled up, and resumes with Jump to latest or a new turn.

## Validation

```
npm test
npm run lint
npm run typecheck
npx playwright install chromium firefox
npm run test:e2e
```

Browser tests cover follow-ups on ready and failed builds, message order, reload, reopening with empty session storage, preview replacement and restart, retained ready previews, mobile stacking, focus and automated WCAG checks.

Manual keyboard and NVDA check: send `[long-step]`, confirm focus returns to the message box and Send is disabled with an explanation. Draft a follow-up, reload, and confirm it stays. Confirm timer ticks are silent, progress updates are announced, and the completed agent reply is announced once. Tab through Conversation, history, the message box, Build panel, download, Preview, Restart preview, and the activity controls. At desktop and narrow widths, verify visible focus and no horizontal page scrolling. NVDA verification remains manual.
