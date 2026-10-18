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
npm run test:e2e:real
```

`test:e2e` runs against the stub. `test:e2e:real` runs the main flows (a passing build and its download, a QA failure, a failed turn, and a follow-up's version 2) against the real back end with the scripted agent, so nothing is billed; it starts both servers itself, on ports 3010 and 5180, clear of the stub and the dev server.

Browser tests cover follow-ups on ready and failed builds, message order, reload, reopening with empty session storage, preview replacement and restart, retained ready previews, mobile stacking, focus and automated WCAG checks.

Manual keyboard and NVDA check: send `[long-step]`, confirm focus returns to the message box and Send is disabled with an explanation. Draft a follow-up, reload, and confirm it stays. Confirm timer ticks are silent, progress updates are announced, and the completed agent reply is announced once. Tab through Conversation, history, the message box, Build panel, download, Preview, Restart preview, and the activity controls. At desktop and narrow widths, verify visible focus and no horizontal page scrolling. NVDA verification remains manual.

## F11 recovery integration

Errors use the shared `NextStep` from `@cdk/contract`: `send_again`, `sign_in`, `try_later`, `smaller_request`, `wait`, `new_project`, and `ask_for_fix`. B24 supplies these on API, turn, history, and build errors. The UI validates incoming errors and does not infer actions from codes. Ask for a fix prepares a follow-up in the composer and preserves an existing draft.

The sign-in link still opens `/api/agent/sign-in`, implemented only by the stub. A real sign-in handler and Electron external-window integration remain outstanding, so F11 remains a draft. Manual NVDA verification also remains outstanding.

Stub markers use each shared next-step identifier in brackets. `[qa-fail]` covers build recovery, `[cancelled]` covers cancellation, and `[drop-lost]` covers explicit reconnect.

## Add to D2L guide (F13)

A ready SCORM build's download opens the instructions without changing the download endpoint. The adjacent Add to D2L instructions button reopens them. The labelled native dialog supports Close and Escape, explicitly wraps Tab/Shift+Tab, and returns focus to its opener. Its ordered steps cover upload, grading, visibility, and testing with a real enrolled test student. The optional deploy.txt uses the same content as the dialog. Other output formats do not receive SCORM instructions.

Sources checked October 17, 2026:

- The kit's `skills/d2l-scorm-package/SKILL.md`, Getting it into D2L and Verifying it actually works, supplies the measured SCSU upload path and the distinction between instructor preview and actual gradebook verification.
- [D2L import and manage SCORM](https://community.d2l.com/brightspace/kb/articles/4971-import-and-manage-scorm)
- [D2L content visibility](https://community.d2l.com/brightspace/kb/articles/3382-hide-content-topics-modules-and-downloads)
- [D2L student-experience testing](https://community.d2l.com/brightspace/kb/articles/35011)
- [SCSU Academic Technologies](https://www.stcloudstate.edu/ITS/services/academic/default.aspx) confirms the campus sign-in destination.

The desktop window opens only these four guide destinations in the system browser; other popup destinations remain denied.

Acceptance still requiring a person with sandbox access:

- [ ] Someone outside the development team follows the steps in the SCSU sandbox.
- [ ] A real enrolled test student completes the uploaded build and the instructor verifies its score, repeat-attempt calculation, and reopen behavior.
- [ ] Keyboard/NVDA reading confirms the dialog title, ordered steps, links, and focus return.
- [ ] The packaged Windows app opens the guide links in the system browser.

The connected browser had no D2L session during implementation. Automated browser checks use the local scripted stub and do not establish sandbox/gradebook correctness.
