<!-- docs/checks/09-mod.md -->

# Check 9: a mod's button, and what a mod can see

**Answer:** Partly — a mod's button can write a file and start a turn in Desktop on the Mac and Windows, and a mod can tell the director's typed messages, and their Remote Control messages, from everything else. In Desktop on Windows, replies from another Desktop session don't reach the mod's `session.receive` hook: they arrive as prompts marked `sdk`.

## Question

That a mod button can write a file and start a turn in Desktop on both operating systems, and that a mod can see cross-session messages.

## Tested on

macOS, Claude Desktop, Claude Code 2.1.299, 17 October 2026. The director enabled hot reloading for this session only. The mod was removed afterwards.

Windows 11, Claude Desktop, Claude Code 2.1.299, 17 October 2026, the same way.

## Method

The probe mod (`probes/09-mod/`) opened a pane with one button, which wrote a line to the probe's log and called `$.prompt.submit`. Its hooks logged `prompt.submit` (with the message's origin) and `session.receive` (deliveries from other sessions). `claude plugin validate` listed every hook it registers and every call it makes.

On Windows the mod logs under `USERPROFILE` when `HOME` isn't set. While it was loaded, a second Desktop session answered three pings with `SendMessage`, and the director sent one message from the Claude app on their phone through Remote Control.

## Evidence

- The director clicked the button. The log line was written, and a new turn began with "probe: mod button", announced as "The wheelhouse-probe plugin sent a message".
- When the director typed a message, the mod's `prompt.submit` saw it with `origin: { kind: "composer" }`, the engine's mark for the person's own typing. The documentation lists the other origins: `bridge` (Remote Control), `peer` (another session), `task-notification`, `scheduled-trigger` and more.
- The mod's own submitted prompt didn't come back through its `prompt.submit` hook. To a project's `UserPromptSubmit` hook, it looked exactly like a typed message.
- No other session sent a message while the mod was loaded on the Mac, so `session.receive` wasn't seen there.
- **Windows, the button:** pressed while the session was idle, it wrote the log line and started a turn announced as "The wheelhouse-probe plugin sent a message: probe: mod button". Two presses gave two log lines 0.2 seconds apart and two turns. A first press, made while the session was busy and just after the mod had loaded, left no log line and started no turn.
- **Windows, typed and phone messages:** the director's typed messages arrived with `origin: { kind: "composer" }`; their message from the phone arrived with `origin: { kind: "bridge" }`.
- **Windows, messages from another session:** `session.receive` never fired. Each reply from the other Desktop session reached the mod's `prompt.submit` with `origin: { kind: "sdk" }`, wrapped in the app's own note about that session. App notes such as "hot reloading enabled" arrived as `task-notification`.
- The validator listed the mod's calls: `$.env.get`, `$.fs.read`, `$.fs.write`, `$.prompt.submit`, `$.session.usage`, `$.ui.open`, `$.ui.resolve`, and since the Windows sitting `$.ui.toast`. A mod that approved tool calls would show a `tool.check` hook in that list, so the list is the proof section 17.1 asks for.

## What it means for the design

- Section 17.1 stands on the Mac: card buttons in a mod can write a record and start a turn.
- Sections 12.3 and 12.5: the prompt record moves into the mod. Its `prompt.submit` hook records a message as the director's only when its origin is `composer` (typed) or `bridge` (Remote Control). A project hook can't tell the director from a mod, so it can't be the source of approvals.
- Until the mod exists, approvals come only from card clicks (check 8).
- Sections 12.3 and 12.5: the rule "only `composer` or `bridge` counts as the director" holds on Windows. Messages between Desktop sessions arrive as `sdk`, so they can never pass for the director; but the mod can't rely on `session.receive` to see them, and should treat any `sdk` prompt as not the director's.
- Section 17.1: a button pressed while a turn is running may be lost. The mod's buttons should show that a press was taken (a toast or a changed label), or be disabled while a turn runs.

## Needs the director

No. A message from another session while the mod is loaded can be tried on the Mac in the pilot, to see whether `session.receive` fires there.
