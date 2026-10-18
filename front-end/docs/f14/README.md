# F14 interface text audit

Compared with F13 commit `0e62bb5`. Screenshots use the local scripted stub at 1280 x 900, with a 390 x 844 phone comparison. They show interface copy and layout, not a live D2L course or a real agent response.

| Area or state | Change | Information kept |
| --- | --- | --- |
| Header and project heading | Remove Local mode and both intro taglines. Keep Course material workspace for the empty state and show Project: for an active project. Shorten the initial heading to Create an activity and tighten its spacing above the cards. | App identity, project title, heading hierarchy. |
| Empty conversation | Rename Conversation to Design to follow Design → Build → Preview. Remove the sentence repeating the initial request label, hide empty history, and remove its extra composer separator and spacing. Size cards to their contents. | Visible labels for Project title and the initial learning request. |
| Continuing conversation | Hide the visible Describe a change label and remove the repeated project-history hint. | The associated label remains screen-reader accessible; placeholder, speaker names, and conversation-history name remain. |
| Running and opening | Remove the two-sentence working hint. Disabled Send reads Working… while running. | Editable draft, progress indicator, elapsed time, connection notices, and Opening your project status. |
| Build panel | Remove 02 / BUILD and shorten Build panel to Build. Shorten the empty message to No build yet. Reword BUILD n to Version n. Remove QA summaries repeated by the result heading. | Version, completion/failure state, findings and explanations, errors, package download, and the F13 guide action. |
| Panel headers | Add burgundy accents and a thin divider with consistent, tighter spacing. | Clear Design, Build, and Preview headings without repeated numbered labels. |
| Preview | Remove 03 / PREVIEW, the repeated local-preview sentence, and the empty preview panel. Hide visible Preview ready text while retaining its screen-reader announcement. | Preview region/heading when a ready build exists, version, loading status, errors, Retry preview, and Restart preview. |
| F13 instructions modal | Keep its title, current build, ordered instructions, help links, and text export. Place Close at the bottom right and style the text export as a secondary button at the bottom left. | Each item supports adding or checking the activity; there is no decorative copy to remove. |
| QA and request errors | Remove the redundant QA sentence, retain the actual error and findings. | Actionable failure messages and recovery context; preview errors and retries remain. |
| Project list | No project-list screen exists on this base branch. | No new screen or workflow introduced. |

## Before and after

| State | Before | After |
| --- | --- | --- |
| Empty | [Screenshot](before-empty.png) | [Screenshot](after-empty.png) |
| Running | [Screenshot](before-running.png) | [Screenshot](after-running.png) |
| Ready and preview | [Screenshot](before-ready.png) | [Screenshot](after-ready.png) |
| Instructions | [Screenshot](before-guide.png) | [Screenshot](after-guide.png) |
| QA failed | [Screenshot](before-qa-failed.png) | [Screenshot](after-qa-failed.png) |
| QA failed on phone | [Screenshot](before-qa-failed-phone.png) | [Screenshot](after-qa-failed-phone.png) |

## Accessibility verification

The component and browser tests continue to locate the message box and regions by accessible names. The copy audit explicitly checks Design, Build, compact empty-state spacing, the workspace/project eyebrow, the continuing request's accessible name, and its visually hidden label. Existing axe checks cover empty, running, ready, and QA-failed states. F13's keyboard dialog test covers ordered content, Tab wrapping, Escape, and focus return.

Manual NVDA verification remains outstanding. Automated accessible-name and axe checks do not substitute for hearing the screen reader announce the interface.

F11 and F12 remain separate PRs. This audit covers the interface on F13's base and does not replace their pending acceptance checks.
