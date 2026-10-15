# Front end

The browser app provides a project conversation, the latest build and QA findings, and a local activity preview. Checks run in the back end.

## Local preview

Requires Node 20.19+, Node 22.13+, or Node 24+. Install dependencies with `npm install` at the repository root, then run these commands in `front-end/`, in separate terminals:

```
npm run stub
npm run dev:stub
```

Open http://127.0.0.1:5173. Name your project and send a request. After the reply, send a change to produce version 2. The stub uses scripted replies and the saved SCORM starter activity; its preview runs through the kit's D2L emulator. The stub download is the saved SCORM starter fixture.

A project can be reopened at `/?project=<projectId>`. Reload restores its history, builds and any running turn. Drafts stay in the current browser session. Stub projects live in memory and disappear when the stub server restarts.

`npm run dev` proxies to the real back end at port 3000. The real back end and stub provide the message-history route; configure the separate preview origin for interactive build previews:

- `GET /api/projects/:id/messages` returns `{ items, nextCursor? }`, oldest first. Instructor messages include a `turn` with its status and plain-language error, when present. The app follows every page and merges messages by ID.
- F6 renders ready builds through the emulator on a separate preview origin. `VITE_PREVIEW_ORIGIN` sets it for the dev server (`.env.development`); stub mode uses port 3002. A build made with `npm run build` leaves it unset and uses `http://preview.localhost` on the app's own port, because the back end that serves the built app (`APP_DIR`) serves previews on that port too.

The history shape follows the shared contract: instructor `turn` contains `{ id, status, error }`.

## Conversation behavior

Live progress and the working indicator sit in the build panel. At turn end it collapses to a single outcome line. The instructor and agent messages stay in order. Distinct assistant messages within a turn have separate bubbles, including text before and after tool calls. Send stays disabled while the request runs, and the message box remains editable so the next request can be drafted. Failed sends retain the draft.

The build panel shows the newest build. The preview shows the newest ready build, so a checking or failed build keeps the previous ready preview and its version label. Restart reloads the emulator with a fresh attempt. The desktop layout places chat and build side by side with preview below; narrow windows stack the three regions.

## Stub scenarios

- `[multi-message]`: two distinct agent messages around a tool call, preserved after reload and reopening.
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

## F11 draft integration

This PR is intentionally a draft pending B24 (#121). `src/api/failure.ts` defines the proposed next-step values: `send_again`, `sign_in_to_agent`, `try_again_later`, `try_smaller_request`, `wait_for_current_request`, and `start_new_project`. A failure is `{ message, nextStep }`; both the API error envelope and `turn.failed.error` must carry it, and history must preserve it. Until B24 lands, unrecognised errors show a generic message with guidance; the UI does not infer actions from internal error codes.

The sign-in link opens `/api/agent/sign-in` in a separate tab. The stub serves a demonstration page; a real host sign-in handler and Electron external-window integration still need agreement before this draft is ready. The PR does not implement B24 or initiate authentication automatically.

Stub markers `[send_again]`, `[try_smaller_request]`, `[sign_in_to_agent]`, `[try_again_later]`, `[wait_for_current_request]`, `[start_new_project]`, and `[cancelled]` exercise the actions. `[drop-lost]` exercises explicit reconnect. Errors use alerts, action controls are keyboard accessible, and focus returns to the composer after resend/edit. Manual NVDA verification remains outstanding.
