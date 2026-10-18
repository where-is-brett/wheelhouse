<!-- docs/superpowers/plans/2026-10-19-wheelhouse-mod.md -->

# Wheelhouse mod: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the rest of the mod (design section 17.1): the side pane and status bar, the card buttons (**Approve**, **Not now**, **Explain more**, **Show me**), the STOP button, `/digest`, watching CI and pull requests on a timer, the settings pane and the courier, all calling the scripts the front desk and foreman already use, and proved, from what `claude plugin validate` reports, never to approve a permission prompt.

**Architecture:** The mod stays as thin as its first piece. Every decision is made by Node.js scripts the plugin already has, reached through the one bridge (`node <plugin root>/scripts/mod/bridge.js`, run by `$.process.run` outside the sandbox, check 32). The mod draws, keeps time and relays: on a timer it sends one `tick` request, and the bridge answers with what to draw (the pane's model, which it also writes as the project's `status.json`), what the status line says, and any prompt the mod should submit (a courier's wake for the front desk, or a watcher's wake for a Shape 2 foreman). A button press is one request naming the card and what was pressed; the bridge earns and signs exactly the record a card click earns, through the prompt record's own code, so the buttons write the same records the hooks write. The pane is drawn only in the front desk's session; a Shape 2 foreman's session uses the mod's timer to run the watcher's loop; feature sessions and Shape 1 foremen get only the first piece's usage reading.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies, for every script. The mod is TypeScript run by Claude Code's mod engine, tested with `claude plugin validate` and `claude plugin test` (`npm run mod-check`), outside `npm test`. `git` and the host only through the helper.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, section 17.1 (all of it) and 17.2 (build order, step 6: the mod calls the same scripts, nothing is written twice), with the sections its jobs serve: 5.2 (at a glance, the briefing), 5.3 (cards and their buttons), 9 (confirmations from a mod click), 12.5 (approvals only from the director), 12.7 (STOP and lifting it), 13 (notifications), 14 (settings, and 14.4's settings pane) and 19 (scripts, not reasoning; wake only on change). Read with `docs/specs/2026-10-18-build-loop-design.md`, which wins where the two differ: section 2 (the front desk and the foreman talk only through state) and section 11 (what wakes whom, and the watcher's two shapes). Check notes `docs/checks/04-remote-control.md`, `06-usage-in-desktop.md`, `09-mod.md`, `27-sessions.md` and, on the board-and-usage branch, `32-mod-sandbox.md`.

## Scope

Step 6 of design section 17.2, moved ahead of the evaluation by the director's decision of 19 October 2026 (build every designed piece first, then test in real use). It builds every job in section 17.1's table that the mod's first piece doesn't already cover:

- **At a glance:** the side pane and the status line under the prompt, read from the project's `status.json`.
- **Card buttons:** each waiting card's deciding option and **Not now** written straight into state with no Claude turn; **Explain more** and **Show me** starting a front-desk turn.
- **STOP:** a button that sets STOP at once, and **Lift STOP** beside it while STOP is on.
- **`/digest`:** the briefing, rendered from the state files with no Claude turn.
- **Watching:** CI and pull requests polled on a timer, waking the foreman only when something changed.
- **The settings pane:** the everyday settings of design section 14 as buttons, with the current choice shown.
- **The courier:** the pane kept current, and the front desk woken only for needs-you items.

The first piece (the usage figure, the prompt record by origin, `/go`, "stop" from the phone and reply codes) is the board-and-usage plan's, built on branch `claude/focused-pasteur-70cf64`. This plan changes it only where a new job needs it (the bridge's requests, the validator's lists, the module split into files).

It does not build notifications by ntfy or Telegram (off by default, design section 13: they stay settings only), budget allocation (in the backlog, by the director's decision of 18 October 2026: the settings pane shows the budget setting's one level and offers no other), or setup's install of the plugin (the mod ships in the same plugin, check 32).

**What the build-loop design changes in section 17.1.** The main design's courier "sees the foreman's one-line messages". The build-loop design, which wins, replaced those messages with state: the foreman writes questions, outcomes and reports into state, and the front desk reads them (its section 2). So the courier reads state for what is new, through the pane's model; messages from other sessions that do reach the front desk carrying Wheelhouse's lead are kept out of its conversation and shown in the pane, as section 17.1 and check 9 ask. And the build-loop design's watcher already polls CI and pull requests in a background process (Shape 1, chosen on the Mac by check 27). So the mod's watching keeps that process running from the front desk, and, under Shape 2, runs the same watcher's loop on the mod's timer in the foreman's session, in place of a plugin monitor. *Plan's call*, in each case calling the build loop's own scripts.

## Where this plan builds on other plans

Each function this plan calls, and the task that makes it. "Built" means the task's code exists on the branch named, reviewed, not yet merged into `main`.

| What | Plan, task | Where it stands on 19 October 2026 |
|---|---|---|
| The bridge (`handle`, `runBridge`, `SAYS`, `BRIDGE_MS`, `HELPER_MS`), the mod's four hooks, `scripts/mod/validate.js` (`checkMod`, `membersIn`, `HOOKS`, `CALLS`), `npm run mod-check` | board-and-usage, Tasks 17 and 18 | built, `claude/focused-pasteur-70cf64` |
| `earned`, `keepEarned`, `sendKept`, `SIGNED_LABELS` (`scripts/hooks/prompt-record.js`); `replyRecord`, `parseReply` and the reply's private `claim`, `answeredInPending`, `recordedAs` (`scripts/mod/reply.js`); `setLineOf`, `replyCode`, `replyCodeLine` | board-and-usage, Task 16 | built, same branch |
| `loadBoardInputs({ cwd, now, offline })`, `boardModel` (its waiting list, which this plan's Task 3 gives ids), `glanceLine`, `renderBoard`, `oneLine`, `NOT_A_PROJECT` | board-and-usage, Tasks 12 and 13 | built, same branch |
| `earned` signing the build loop's clicks too (`approve-work`, `answer`, `amend`, `lift-incident`, `incident-fix`) | board-and-usage Task 16 and build loop Task 8, joined when the second of the two merges (board-and-usage, Card 1) | the board-and-usage branch's `earned` signs the five first-piece labels only |
| `briefingModel`, `briefingText`, `readSeen`, `markSeen` | board-and-usage, Task 14 | built, same branch |
| `SETTINGS`, `checkSetting`, `definitionOf`, `say`, `effectiveSettings`, `sayTime`; the helper's `/state/write`, `/profile/write`, `/state/record`, `/profile/record` | board-and-usage, Tasks 3 and 4 | built, same branch |
| The board-context hook (`commandOf`, `decide`) | board-and-usage, Task 15 | built, same branch |
| Check 33, the first piece in Desktop | board-and-usage, Task 19 | waits for the director's sitting |
| `card` data (`kind`, `options`, `line`, `code`, `level`, `importance`), the `waiting` view with `asked` | front desk, Task 1 | not started (`claude/front-desk-build-92aa7a`) |
| The importance order (`cardsForVisit`, and `importanceOf`, which this plan's Task 8 asks it to export), `askAgain` | front desk, Task 3 | not started |
| The card check's tests of a card's form (`scripts/hooks/card-check.js`) | front desk, Task 4 | not started |
| `plainWords`, `glossaryOf` | front desk, Task 5 | not started |
| `cli.js preview`, `/pr/preview` (for **Show me**) | front desk, Tasks 6 and 12 | not started |
| `sessionRole`, `recordRole` (`scripts/lib/role.js`), `skills/front-desk/SKILL.md` | front desk, Task 7 | not started |
| The build loop's card lines and actions (`approve-work`, `answer`, `amend`, `lift-incident`, `incident-fix`) | build loop, Task 8 | merged into `main` (pull request #5) |
| `makeWaker` (Shape 2's lines), `runWatcher({ loops })`, `projectConfig` | build loop, Task 13 | merged into `main` (pull request #6) |
| `startWatcher`, `watcherRunning`, `FOREMAN_PROMPT_LEAD`, `MONITOR_NOTE`, `skills/foreman/SKILL.md` | build loop, Task 19 | built, `claude/build-loop-foreman-9786cf` |
| Check 26, plugin monitors | build loop, Task 6 | not run (needed only for Shape 2) |
| Check 27's Windows half, which may pick Shape 2 there | build loop, Task 5 | waits for the director at the Windows computer |
| Evaluation scenarios' numbering and runner (`--all`) | evaluation, Task 3 | not started |

## Decisions for the director

None before the build: every choice here follows the design, or is a plan's call listed below. The director's part is the sitting in Task 14, which opens with its own card.

## Global Constraints

Everything in the earlier plans' Global Constraints holds: Node.js 22 or later, no npm dependencies, ESM `.js`, `node:test` in `tests/**/*.test.js`, macOS and Windows, the path comment on every file, British or Australian English, dates as "19 October 2026", no model identifiers anywhere (tests use made-up names such as `model-a`) and no `Co-Authored-By` line in commits, secrets only in a child's environment and never in output, everything under `wheelhouseHome()`, times in UTC ISO 8601 with a `now` argument, child processes through `run`, hooks never running `git` in a folder an agent controls, guards failing closed and informing hooks failing open, only hooks and the bridge signing. In addition:

- **The design's numbers are constants, named once,** in `scripts/lib/mod-numbers.js`: `PANE_ID = 'wheelhouse'`, `TICK_MS = 15000` (the front desk's pane and courier), `FOREMAN_TICK_MS = 30000` (a Shape 2 foreman's watcher loop, as the watcher's own state interval), `WATCH_EVERY_MS = 60000` (a Shape 1 check that the watcher runs), `WATCH_BRIDGE_MS = 45000` (the limit on a Shape 2 loop), `COURIER_GAP_MS = 10 * 60 * 1000`, `CARD_HASH_CHARS = 12`, `PANE_LINES = 5`, `STALE_TICKS = 3`, `LEADS = { pane: 'Wheelhouse pane:', courier: 'Wheelhouse courier:' }`, `MESSAGE_LEAD = /^Wheelhouse(?: [a-z]+)?:/`, `AWAY = { hours: 2, evening: '18:00', morning: '09:00' }`. The foreman's lead stays `FOREMAN_PROMPT_LEAD` in `scripts/foreman/start.js`; it is imported, never written again.
- **The mod decides nothing.** Every rule (which buttons a card gets, what a press records, which setting a choice sets, when the courier wakes) is in a script tested by `npm test`. The mod's own tests check only that it draws what the bridge answered, sends what was pressed, and passes every message on.
- **The mod never approves a permission prompt.** It hooks no `tool.check`, `tool.call`, `tool.describe`, `config.set`, `agent.offer`, `plugin.register` or `classic.*` event, and calls nothing on `$.tool`, `$.agent`, `$.fs`, `$.settings`, `$.http`, `$.model`, `$.command.run`, `$.prompt.fill`, `$.session.append`, `$.process.spawn` or `$.env.set`. Its one `$.process.run` runs the bridge and nothing else, and the bridge's own imports never reach the code that writes Claude Code's settings. Under Shape 2 the bridge runs the watcher's loop (Task 7), which starts sessions with the build loop's own modes and allow rules, exactly as the background watcher does under Shape 1; the mod adds none. This is proved by `scripts/mod/validate.js` from `claude plugin validate`'s report and the module's source (Task 2), in `npm run mod-check`, which every mod task runs before it commits and CI's `validate` job runs on every pull request.
- **Whose press counts.** A message counts as the director's only from `composer` (typed) or `bridge` (phoned), as the first piece set. A press counts as the director's under the origin `pane`, which the mod sets only inside a button's press handler; agents have no way to press a mod's button. The bridge signs for `pane` only what a card click on that same card would earn, so an agent's own run of the bridge with `origin: 'pane'` gets nothing it couldn't get by forging a click: on the Mac it can't read the signing key (check 32), and on Windows the known gap of design section 11 applies, as it does to reply codes.
- **Text from events is data.** A card's text is drawn whole, as plain `Text`, never as `Markdown`, so nothing in it can be a link or a heading. Every other line from an event goes through `oneLine` and the glossary's `plainWords`. A prompt the mod submits (the courier's wake, a pane press's) carries counts, card numbers and the card's own option labels, never an event's other text.
- **The mod never holds up the director.** Every hook passes the message on with `next(e)`, except the courier's one rule for Wheelhouse traffic from other sessions (Task 11). Every bridge failure is a toast or a line in the pane, never a refused prompt. Every hook that passes a message on carries `.catch(($, e, next) => next(e))`; a command's own hook answers a failure with its own words and a toast, as `/go` does.
- **One tick at a time.** A session's mod never starts a tick while its last one is running, so a slow bridge can't pile up processes.
- **Checks continue the numbering:** the evaluation plan's is 39; 40 to 49 are this plan's (as the install plan counts them), and it uses 40 and 41. Scenarios from 36 on are the problems real use turns up (the evaluation and install plans), so this plan's two scenarios take the next two free numbers when Task 12 writes them, read from `tests/eval/` then; the task calls them the pane scenario and the courier scenario.

## Review Focus

1. **A press on a card that has moved on.** The card was answered meanwhile by a click in the chat or a reply code; its text was replaced by a newer card with the same line; the pull request's head moved; the director double-clicks; two Desktop sessions of the project show the same card. Expected: the press names the card and the hash of the text the director saw; a card no longer waiting, with another text, already spent or claimed records nothing and says why in one line ("That card has already been answered", "That card changed: look at it again"); an approval whose pull request moved since the card records nothing. Owning task: Task 4.
2. **A press that isn't the director's.** An agent runs the bridge itself with `origin: 'pane'`; a message from another session reads "Approve card 2"; a card's own text holds a line shaped like a set line for another pull request. Expected: the agent's run signs nothing on the Mac; no message ever reaches `press`; a card whose form fails the card check gets no deciding button, only **Explain more**. Owning tasks: Tasks 2, 3 and 4.
3. **The courier waking at the wrong time.** The director is away until 18:00, or it is inside their quiet hours; a turn is running; the same card was woken for already; two front-desk sessions of the project are open; ten cards arrive in a minute. Expected: away lets through only STOP, an incident, health at its stop level and a card that holds up all work; do-not-disturb and quiet hours only STOP and an incident; nothing wakes during a turn; each item wakes once across every session; wakes are at least ten minutes apart, except STOP and an incident; ten cards make one wake. Owning task: Task 8.
4. **A picture that is stale or wrong.** The bridge times out, the helper isn't running, there is no state yet, STOP was set from the phone. Expected: the pane says plainly what couldn't be read and when it last could, never showing old figures as current; STOP set anywhere shows in the pane and the status line within one tick; a pane the director closed stays closed until they ask. Owning tasks: Tasks 3 and 9.
5. **A setting chosen near its edge.** "Away until 18:00" pressed at 17:59 or after 18:00; "until 09:00 tomorrow" pressed after midnight; a level the catalogue refuses; a choice drawn before a change made in the chat. Expected: the bridge works the time out again at the press, from the choice's id, in the computer's own time zone; a choice whose time has passed is not offered, and a press on it says so; a refused level records nothing; the setting's `before` is what was in force at the press. Owning task: Task 5.

## File structure

```
scripts/lib/mod-numbers.js        the numbers above
scripts/mod/validate.js           (changed) the allowed and forbidden lists, every module file, the bridge's imports
scripts/mod/bridge.js             (changed) tick, press, settings, setting, digest; the pane origin
scripts/mod/reply.js              (changed) claim, answeredInPending and recordedAs exported
scripts/mod/status.js             the pane's model, and projects/<p>/status.json
scripts/board/model.js            (changed) each waiting item carries its id
scripts/mod/buttons.js            which buttons each card gets
scripts/mod/press.js              what a press on a card records
scripts/mod/settings-pane.js      the settings pane's rows, and what a choice sets
scripts/mod/digest.js             the briefing as /digest shows it
scripts/mod/watch.js              the watcher kept running (Shape 1), one loop for the foreman (Shape 2)
scripts/mod/courier.js            which needs-you items wake the front desk, once each
scripts/watcher/waker.js          (changed) Shape 2's lines to a given printer
scripts/foreman/start.js          (changed) Shape 2's wakes come from the mod
scripts/hooks/board-context.js    (changed) the mod's commands and the courier's wake left alone
scripts/hooks/card-check.js       (changed) cardProblems exported
skills/front-desk/SKILL.md        (changed) the pane's and the courier's prompts
skills/foreman/SKILL.md           (changed) a wake handed on by the mod
hooks/register.ts                 (changed) the hooks, wired to the files below
hooks/mod/ask.ts                  the one bridge call
hooks/mod/pane.tsx                the side pane and the status line
hooks/mod/cards.tsx               a card's buttons, STOP and Lift STOP
hooks/mod/settings.tsx            the settings pane
hooks/mod/messages.ts             which messages are Wheelhouse traffic
tests/mod/pane.test.ts, cards.test.ts, settings.test.ts, messages.test.ts, register.test.ts (changed)
tests/fixtures/mod/               recorded `claude plugin validate --json` reports
probes/40-mod-headless/…          check 40
docs/checks/40-mod-headless.md, docs/checks/41-mod-desktop.md
tests/eval/mod/<n>-pane-explain.js, <n+1>-courier-wake.js
tests/e2e/mod.test.js
.github/workflows/ci.yml          (changed) the validate job runs npm run mod-check
```

## Findings note format

As the checks plan set it (`docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md`, "Findings note format"), checked by `tests/docs/checks-format.test.js`. Each note adds its row to `docs/checks/README.md`.

---

## Part 1: the check and the proof

### Task 1: Check 40, the mod without a screen

**Files:**
- Create: `probes/40-mod-headless/.claude-plugin/plugin.json`, `probes/40-mod-headless/hooks/hooks.json`, `probes/40-mod-headless/hooks/register.ts`, `probes/40-mod-headless/hooks/part.ts`, `probes/40-mod-headless/run.js`, `docs/checks/40-mod-headless.md`
- Modify: `docs/checks/README.md`

**Interfaces:**
- Consumes: `makeScratchProject`, `probeLogDir`, `appendJsonl` (`probes/lib/`); the session route check 27 found.
- Produces, in the note under "What it means for the design", for Tasks 2, 6, 9 and 11: how `claude plugin validate --json` lists the hooks and calls of a file the module imports, and how it spells a `ui.render` matcher and a `command.run` matcher; whether `claude plugin test` runs with no Claude sign-in (as in CI); whether a classic UserPromptSubmit hook receives a mod command's typed line (`/digest`), and whether the command's `{ text }` answer is kept with no model turn; whether `$.clock.every` keeps firing between turns in a long-lived session, and whether `$.prompt.submit` from it starts a turn when idle and waits behind a running one; whether a prompt sent into a `stream-json` session arrives with origin `sdk`, and whether a `prompt.submit` hook's `{ drop }` keeps it from the model and the transcript. Whether `session.receive` sees a message from another session can't be asked here: check 27 found no route by which a script sends a message into a running session, so check 41 asks it in Desktop.

The question: *What a mod can do with no screen, which the rest of the mod relies on: how the validator reports a mod split into files; whether its tests run without a sign-in; how a mod command meets the command hooks; whether a mod's timer and its submitted prompts keep working across turns; and whether messages from other sessions can be kept out of a session's conversation.*

- [ ] **Step 1: Read** the mod reference that ships with Claude Code (the `plugin-authoring` skill's `reference.md` and `types/claude-code.d.ts`: `$.clock.every`, `$.prompt.submit`, `prompt.submit`'s `{ drop }`, `session.receive`'s `{ consumed }`, `command.run`'s answer, `claude plugin test`) and record what each says, with the date.
- [ ] **Step 2: Write the probe.** A mod split into two files (`register.ts` importing `part.ts`, which holds one hook) that: registers a command `digest` answering `{ text: 'probe digest' }`; on `session.start` starts `$.clock.every(5000, …)` logging each fire and, on the third, `$.prompt.submit({ text: 'probe: timer prompt' })`; logs every `prompt.submit` with its origin and answers `{ drop: 'probe' }` for a text beginning `probe-drop:`; Beside it, a classic UserPromptSubmit hook that logs the prompt it receives.
- [ ] **Step 3: Run `probes/40-mod-headless/run.js` (agent, Mac).** In a scratch project: `claude plugin validate --json` on the probe (record the report); `claude plugin test` on it with `HOME` set to an empty scratch folder; `claude -p "/digest"` (record what the classic hook saw and whether a model turn ran, from the stream-json events); a long-lived `claude -p --input-format stream-json --output-format stream-json --verbose` session sent one ordinary message, then one beginning `probe-drop:` while idle, then one while a turn runs, left open for 30 seconds after (record the timer's fires, the turn the timer's prompt started, each origin, and whether the dropped text reached the transcript).
- [ ] **Step 4: Undo.** Remove the scratch project and folders, and the empty folders the sessions made under `~/.claude/projects/`. Nothing else on the computer changes.
- [ ] **Step 5: Write the note,** add its row, run `npm test`, commit.

```bash
git add probes/40-mod-headless docs/checks
git commit -m "Record check 40: what the mod can do without a screen"
```

**If the answers differ:** if the validator doesn't list an imported file's hooks and calls, the mod stays in one file (`hooks/register.tsx`) and the file list above folds into it; Task 2's checks read that one file. If `claude plugin test` needs a sign-in, CI's `validate` job runs `scripts/mod/validate.js` alone and the mod's tests run on the Mac before every push, said in each pull request. If the classic hook doesn't see a mod command, Task 6's change to the board-context hook still stands (it is harmless) and the note says so. If a mod command's answer starts a model turn, `/digest` opens the briefing in the pane's own view instead of the command's output (Task 11). If the timer stops between turns, Shape 2 keeps the plugin monitor of build-loop check 26 (build loop, Task 6) and Task 7's Shape 2 half is not built; the courier's half is decided in Desktop by check 41. If `{ drop }` doesn't keep an `sdk` prompt out, Task 11's Wheelhouse traffic is let through and only refreshes the pane.

### Task 2: The proof that the mod approves nothing

**Files:**
- Modify: `scripts/mod/validate.js`, `.github/workflows/ci.yml` (the `validate` job)
- Create: `tests/fixtures/mod/` (validator reports recorded in Task 1, with paths replaced by placeholders)
- Test: `tests/scripts/mod/validate.test.js`

**Interfaces:**
- Consumes: `checkMod`, `membersIn`, `HOOKS`, `CALLS` (board-and-usage, Task 18); check 40's report shapes.
- Produces:
  - `HOOKS` and `CALLS` become the whole mod's lists, each entry added by the task that first needs it, as the validator spells it (recorded from its output): Tasks 9 to 11 name theirs. `VALUES` keeps `$.plugin.root`.
  - `FORBIDDEN_HOOKS = ['tool.check', 'tool.call', 'tool.describe', 'config.set', 'agent.offer', 'plugin.register', 'classic.*']` and `FORBIDDEN_CALLS = ['$.tool.*', '$.agent.*', '$.fs.*', '$.settings.*', '$.http.*', '$.model.*', '$.command.run', '$.prompt.fill', '$.session.append', '$.process.spawn', '$.env.set']`, where `*` stands for any rest of the name. A hook or call matching one is a problem even if `HOOKS` or `CALLS` names it, and a test asserts the lists never overlap.
  - `moduleFiles(root) -> string[]`: `hooks/register.ts` and every file under `hooks/mod/`; `checkMod({ report, sources })` takes every file's text and runs `membersIn` over each.
  - `bridgeArgv(sources) -> { ok: boolean, why? }`: the sources hold exactly one `$.process.run(`, in `hooks/mod/ask.ts`, whose argv is the literal `['node', `${$.plugin.root}/scripts/mod/bridge.js`]`.
  - `paneOrigin(sources) -> { ok: boolean, why? }`: `origin: 'pane'` appears only inside functions whose names begin `press` in `cards.tsx` and `settings.tsx`, which those files pass as `onPress` and nothing else calls. *Reviewer's call:* a check by name is one a script can make on the source without a TypeScript parser.
  - `bridgeImports(root) -> { files: string[], reaches: string[] }`: the bridge's static import graph, followed through `import … from '…'` in each file; a problem when a file in it imports `writeSettings` or `mergeSettings` from `scripts/protection/settings.js`, or when it reaches `scripts/protection/managed.js`, `scripts/protection/locked.js` or anything under `scripts/setup/`, which write Claude Code's settings. *Reviewer's call:* the graph reaches `scripts/protection/settings.js` itself through the watcher's waker, which takes only the pure `featureAllowRules` from it, so the check is on what is imported, not on the file.
  - The `validate` job runs `npm run mod-check` (in place of `claude plugin validate .`), with the Claude Code version the lineage manifest names as its floor (`lineage/manifest.json` `claudeCode.floor`), or the job's current one until that file exists.

- [ ] **Step 1: Write the failing tests,** each from a recorded report or a small source written in the test.

```js
test('the first piece\'s report and source pass as before', ...)
test('a report listing a tool.check hook fails, even when HOOKS names it', ...)
test('a classic.PermissionRequest or classic.PreToolUse hook fails', ...)
test('a call to $.tool.call, $.fs.write, $.env.set or $.settings.read fails', ...)
test('the forbidden and allowed lists never overlap', ...)
test('a member used in an imported file but not in the report fails', ...)
test('a second $.process.run, or one running anything but the bridge, fails', ...)
test('the pane origin outside a press handler fails', ...)
test('a bridge that imports the settings writer fails, through any chain of imports', ...)
test('the waker\'s import of featureAllowRules alone passes', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run `npm test` and `npm run mod-check`.** Expected: PASS; the validator's lines name the first piece's four hooks and its calls.
- [ ] **Step 5: Commit.**

```bash
git add scripts/mod tests .github
git commit -m "Prove from the validator, the source and the bridge's imports that the mod approves nothing"
```

## Part 2: what the mod shows and records

### Task 3: The pane's model, and status.json

**Files:**
- Create: `scripts/lib/mod-numbers.js`, `scripts/mod/status.js`, `scripts/mod/buttons.js`
- Modify: `scripts/mod/bridge.js` (`tick`, for the front desk; the answer line's new fields), `scripts/hooks/card-check.js` (exports), `scripts/board/model.js` (ids on the waiting list)
- Test: `tests/scripts/mod/status.test.js`, `tests/scripts/mod/buttons.test.js`, `tests/scripts/mod/bridge.test.js`, `tests/scripts/hooks/card-check.test.js`, `tests/scripts/board/model.test.js`

**Interfaces:**
- Consumes: `loadBoardInputs({ cwd, now, offline: true })`, `boardModel` (its `director.waiting` numbering), `glanceLine`, `oneLine`, `localViews` (the `waiting` view), `plainWords`, `glossaryOf`, `stopState`, `sessionRole`, `recordRole`, `projectOf`, `featureSlug`; `SIGNED_LABELS`, `setLineOf`; the card check's tests of a card's form (front desk, Task 4).
- Produces:
  - `PaneModel`:

```js
PaneModel = {
  v: 1, project, at,
  glance: string,                       // glanceLine, at most 80 characters
  stop: { on: boolean, since: string | null },
  cards: Array<{ id, n, header, kind, text, hash, buttons: Array<{ label, does: 'record' | 'turn' }>, note: string | null }>,
  building: string[],                   // at most PANE_LINES, through oneLine and plainWords
  health: Array<{ level: 'watch' | 'stop', text }>,
  usage: string | null,                 // the briefing's usage line
  finished: string[],                   // work ids whose report says merged, for the courier
  watcher: 'running' | 'started' | 'failed' | 'not-needed' | null,
  missing: string[],
}
```

  - The board's waiting list (`waitingList` in `scripts/board/model.js`) gives each item its `id`: the card's event id, or `q:<question id>` for a build-loop question no card asks yet. *Reviewer's call:* the board numbers its items without ids, and the pane must number them the same way.
  - `paneModel({ project, cwd, now }) -> Promise<PaneModel>`: the cards are the `waiting` view's, in the board's numbering (`n` is the number the board and the front desk use for it, so "card 3" means one card everywhere; a build-loop question no card asks yet keeps its number and shows as one line, "A question from the build waits; the front desk will ask it", with no buttons), each with its whole question as `text`, `hash` the first `CARD_HASH_CHARS` of the SHA-256 of that text, and `buttons` and `note` from `cardButtons`. Anything that can't be read becomes one `missing` line, as the board's do.
  - `cardProblems(question: string) -> string[]`, exported from `scripts/hooks/card-check.js`: the card check's own tests of one question's form (the five parts, one set line, its reply code, the first part naming the set line's pull request or commit), so the hook and the pane judge a card by one function.
  - `cardButtons(card) -> { buttons: Array<{ label, does }>, note: string | null }`, in `scripts/mod/buttons.js`:
    - a card whose `kind` has a set line and whose question passes `cardProblems`: its deciding label (the first of its options that `SIGNED_LABELS`, as the build loop extends it, holds) as `record`, then **Not now** as `record`, **Explain more** and **Show me** as `turn`, each only when the card offers it;
    - an `answer` card: each of its own options as `record` (the `answer` action), and **Explain more** as `turn` when offered;
    - a `question` card (no set line): each of its options as `turn`;
    - a card with a set line that fails `cardProblems`: **Explain more** only, and the note "This card can't be answered here: ask the front desk about it."
  - `paneStatusFile(project) -> string` (`projects/<p>/status.json`); `writePaneStatus(project, model)` (atomic) and `readPaneStatus(project) -> PaneModel | null`, null for missing, damaged or another version. (Named apart from the feature files' `readStatus` and `writeStatus`.)
  - The bridge's `{ cmd: 'tick', session, cwd, idle: boolean, surface }` -> `{ ok, role, every, pane?, glance?, status?, submit? }`: `role` from `sessionRole` (the role the board-context hook recorded from the first prompt, or `WHEELHOUSE_ROLE`, which the bridge inherits from the session); for the front desk in a project's main folder, `pane` and `glance` from `paneModel`, written to `status.json` first, `status` the glance for the status line, and `every: TICK_MS`; for a feature session, a Shape 1 foreman, or outside a project, `every: 0`, which tells the mod to stop ticking. Tasks 7 and 8 add the foreman's half and `submit`. In the terminal, when the project's local settings name Wheelhouse's own status-line command (board-and-usage, Task 8), `status` is left out, so the glance isn't shown twice. *Reviewer's call.*
  - The answer line now carries, beside `ok` and `says`, only `role`, `every`, `pane`, `glance`, `status`, `submit`, `rows` and `text`, each when present and of its type.
  - `runBridge` starts its time limit once the request is read, at `WATCH_BRIDGE_MS` for a foreman's tick and `BRIDGE_MS` for anything else. *Reviewer's call:* the limit is set today before the request is known, and a Shape 2 loop (Task 7) needs longer.

- [ ] **Step 1: Write the failing tests.**

```js
test('the pane lists the waiting cards in the board\'s numbering, each with its whole text and hash', ...)
test('a card\'s text is kept as written; the other lines are one line each, in plain words', ...)
test('STOP set from the phone shows in the next tick\'s model', ...)                    // Review Focus 4
test('no state, no helper and no usage still give a model naming what is missing', ...) // Review Focus 4
test('the model is written to status.json before the tick answers', ...)
test('the board\'s waiting items carry ids, and the pane numbers them as the board does', ...)
test('a build-loop question no card asks yet is one line with no buttons', ...)
test('in the terminal with Wheelhouse\'s status line set, the tick gives no status', ...)
test('a card with a set line for another pull request than its first part names gets Explain more only', ...)  // Review Focus 2
test('each kind of card gets its own buttons, and only the options it offers', ...)
test('the card check hook and cardProblems agree on every composed card', ...)
test('a feature session or a Shape 1 foreman is told to stop ticking', ...)
test('the answer line carries only its own fields', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Build the pane's model and each card's buttons from the board's inputs, and keep it as status.json"
```

### Task 4: Presses on cards, STOP and Lift STOP

**Files:**
- Create: `scripts/mod/press.js`
- Modify: `scripts/mod/bridge.js` (`press`; `stop` and `go` take `origin: 'pane'`), `scripts/mod/reply.js` (exports)
- Test: `tests/scripts/mod/press.test.js`, `tests/scripts/mod/bridge.test.js`

**Interfaces:**
- Consumes: `earned`, `keepEarned`, `sendKept`, `SIGNED_LABELS`; `claim`, `answeredInPending`, `recordedAs` (now exported from `reply.js`); `cardButtons` (Task 3); `localViews`; `helperClient` (`/state/write`); the build loop's actions; the front desk's card kinds.
- Produces:
  - `pressCard({ project, card, hash, label, client, now, liftStop, stopState }) -> Promise<{ made: boolean, says: string, submit?: string[] }>`, refusing in this order, recording nothing: the card isn't in the `waiting` view ("That card has already been answered"); its hash differs ("That card changed: look at it again"); `label` isn't one of `cardButtons`'s ("That card doesn't offer <label>"); it is already answered in pending or claimed (as a reply is). Then:
    - a `record` label that earns a signed record: `earned({ project, question, label })`, claimed as a reply is, kept with `keepEarned` and sent with `sendKept`, then the plain `card-answer` `{ question, label }` through `/state/write`. The signed record is kept before the answer is written, so a stop between the two leaves the record, which closes the card on its own (front desk, Task 1); when `earned` gives nothing, "That couldn't be recorded: the card no longer matches what it decides" (an approval whose pull request moved, a Lift STOP while STOP is off);
    - **Not now**: the `card-answer` alone;
    - a `turn` label: the `card-answer`, and `submit` holding one prompt, `Wheelhouse pane: the director pressed <label> on card <n>.`, or for a `question` card's option `Wheelhouse pane: the director chose "<label>" on card <n>.`.
    `says` names what was recorded ("Recorded: Approve on card 2").
    **Under STOP** the helper refuses `/state/write` and takes `/state/record`. So a press that earns a signed record still records it, and its card closes by that record; **Not now** records nothing and says "STOP is on, so that wasn't noted; the card stays as it was"; **Explain more** and **Show me** still give their prompt, since reading and explaining carry on. *Reviewer's call*, following the helper as built.
  - The bridge's `{ cmd: 'press', origin: 'pane', cwd, card, hash, label }` -> `pressCard`, for `origin: 'pane'` only. `stop` now also sets STOP for `origin: 'pane'`; `go` now also lifts it for `origin: 'pane'`, answering what was in progress as `/go` does.

- [ ] **Step 1: Write the failing tests,** with a fake helper and signed records checked with `verify`.

```js
test('Approve on an approval card signs the approval a click earns, then writes the card answer', ...)
test('an answer card\'s option signs the answer action for its question', ...)
test('Not now writes the card answer alone, and the card stays waiting', ...)
test('Explain more and Show me write the card answer and give one prompt naming the card', ...)
test('a card already answered, by a click, a reply code or a press, records nothing', ...)  // Review Focus 1
test('a card whose text changed since it was drawn records nothing', ...)                  // Review Focus 1
test('two presses at once record once', ...)                                               // Review Focus 1
test('an approval whose pull request moved records nothing and says why', ...)              // Review Focus 1
test('press is refused for any origin but pane; stop and go accept pane', ...)              // Review Focus 2
test('run where the signing key cannot be read, a press signs nothing and says so', ...)    // Review Focus 2
test('under STOP, Approve still records and closes its card; Not now says it was not noted', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Record a press on a card exactly as its click, and let the pane set and lift STOP"
```

### Task 5: The settings pane

**Files:**
- Create: `scripts/mod/settings-pane.js`
- Modify: `scripts/mod/bridge.js` (`settings`, `setting`)
- Test: `tests/scripts/mod/settings-pane.test.js`

**Interfaces:**
- Consumes: `SETTINGS`, `definitionOf`, `checkSetting`, `say`, `effectiveSettings`, `sayTime`; the project's and the profile's views (`localViews`, `readProfileViews`); `/state/write`, `/profile/write`; `confirmationFor`; `keepEarned`, `sendKept`; `AWAY`.
- Produces:
  - `settingsRows({ effective, now, timeZone }) -> Array<SettingsRow>`, `SettingsRow = { key, label, current: string, from: 'yours' | 'this project' | 'the default', until?: string, choices: Array<{ id, label, chosen: boolean }>, here: boolean, why?: string }`, the everyday settings of design section 14.1 in its order:
    - **Autonomy, Show before build, Feature milestones, Token efficiency, Pace, Briefing, Explanations, Product phase,** and the board's default tab: one choice per level, in the catalogue's words;
    - **Presence:** Here; Away for 2 hours; Away until 18:00 (offered only while it is before 18:00 here); Away until 09:00 tomorrow; Do not disturb until 09:00 tomorrow; Do not disturb until I change it;
    - **Budget:** its current level and no choices, `why` "The other budget levels come with the budget design";
    - **Protection, Notifications** and working hours: no choices, `here: false`, `why` "Changed by asking the front desk" (Protection runs its guided step with the password; the others take times and channels the pane doesn't draw);
    - the advanced settings of design section 14.2 are not rows: the pane says "Advanced settings: ask the front desk".
  - `choiceOf(key, id, { now, timeZone }) -> { value, until? } | null`: the setting a choice sets, worked out at the press, so a choice drawn earlier can't carry an old time; null for an id no longer offered.
  - `pressSetting({ key, choice, client, now, timeZone }) -> Promise<{ made: boolean, says: string }>`: `choiceOf`, then `checkSetting`; the `setting` event through `/state/write` or `/profile/write`, by the setting's home; then its confirmation, signed, kept and sent as a Confirm click's is: the route answers the new event's `id`, and the bridge reads that event back from the state or profile clone for `confirmationFor`. *Reviewer's call:* the routes answer `{ ok, id, pushed }`, not the event. Under STOP the helper refuses the write, and the press says "Settings change once STOP is lifted". A press is both the change and the director's confirmation of it (design sections 9 and 14.4). `says` is "Pace is now 2, for this project" or why not.
  - The bridge's `{ cmd: 'settings', cwd }` -> `{ ok, rows }`, and `{ cmd: 'setting', origin: 'pane', cwd, key, choice }` -> `pressSetting`, for `origin: 'pane'` only. The time zone is the bridge's own (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

- [ ] **Step 1: Write the failing tests.**

```js
test('every everyday setting is a row in the design\'s order, with its current choice marked', ...)
test('a choice sets the setting and signs its confirmation, in the project or the profile by its home', ...)
test('Away until 18:00 is not offered at 18:00, and a press on it then records nothing', ...)  // Review Focus 5
test('until 09:00 tomorrow is worked out at the press, after midnight too', ...)                 // Review Focus 5
test('a level the catalogue refuses records nothing', ...)                                       // Review Focus 5
test('the value before is the one in force at the press', ...)                                   // Review Focus 5
test('protection, notifications and working hours offer no choice and say where they change', ...)
test('budget offers no other level while budget allocation is in the backlog', ...)
test('setting is refused for any origin but pane', ...)
test('under STOP a choice records nothing and says when it can', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Offer the everyday settings as choices, each press its own confirmation"
```

### Task 6: /digest

**Files:**
- Create: `scripts/mod/digest.js`
- Modify: `scripts/mod/bridge.js` (`digest`), `scripts/hooks/board-context.js`
- Test: `tests/scripts/mod/digest.test.js`, `tests/scripts/hooks/board-context.test.js`

**Interfaces:**
- Consumes: `loadBoardInputs({ offline: true })`, `briefingModel`, `briefingText`, `readSeen`, `markSeen`, the effective `briefing` setting, `plainWords`, `NOT_A_PROJECT`; check 40's answer on how a mod command meets the command hooks.
- Produces:
  - `digestText({ cwd, now }) -> Promise<{ ok: boolean, text: string }>`: "Wheelhouse's briefing" as a first line, then the briefing since the last one, within the words the `briefing` setting gives, through `plainWords`; it marks the briefing given, so the next gap starts from it. Outside a project, `NOT_A_PROJECT`.
  - The bridge's `{ cmd: 'digest', origin, cwd }` -> `{ ok, text }`, for any origin (it only reads, and marks a briefing given).
  - The board-context hook leaves alone, recording no time and adding nothing: a prompt that is one of the mod's commands (`/go`, `/digest`, `/wheelhouse`), since a mod command's answer starts no turn and a briefing added to it would be lost; and a prompt beginning `LEADS.courier`, since the courier's wake is not the director arriving. A prompt beginning `LEADS.pane` counts as the director's, as their press made it.

- [ ] **Step 1: Write the failing tests.**

```js
test('/digest gives the briefing since the last one, within its words, in plain words', ...)
test('/digest marks the briefing given, so the next gap starts from it', ...)
test('outside a project /digest says so', ...)
test('the board-context hook records nothing for /go, /digest or /wheelhouse', ...)
test('a courier wake neither restarts the gap nor brings the briefing', ...)
test('a pane press after two hours brings the briefing', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Give the briefing as /digest, and keep the mod's own prompts from moving the briefing's gap"
```

### Task 7: Watching

**Files:**
- Create: `scripts/mod/watch.js`
- Modify: `scripts/watcher/waker.js` (`print`), `scripts/foreman/start.js` (Shape 2), `scripts/mod/bridge.js` (`tick` for the foreman; the watcher in the front desk's tick), `skills/foreman/SKILL.md`
- Test: `tests/scripts/mod/watch.test.js`, `tests/scripts/watcher/waker.test.js`, `tests/scripts/foreman/start.test.js`

**Interfaces:**
- Consumes: `projectConfig(project, client)` (the default branch's `watcherShape`, through the helper, ruling R50); `watcherRunning`, `startWatcher`, `FOREMAN_PROMPT_LEAD`, `MONITOR_NOTE`; `runWatcher({ project, loops: 1, wakerOptions })`; `makeWaker`; `takeStartLock`; check 40's answer on the mod's timer between turns.
- Produces:
  - `makeWaker` takes `print: (line: string) => void`, used for Shape 2's three lines (`WAKE foreman <file>`, `WAKE feature <work> <file>`, `START feature <work> <worktree>`); the default writes to stdout as now.
  - `watchTick({ project, role, client, now, pluginRoot }) -> Promise<{ watcher: 'running' | 'started' | 'failed' | 'not-needed', submit: string[] }>`, with the shape from `projectConfig` (cached in `projects/<p>/mod/watch.json` for ten minutes; nothing is started until it has been read once, as the watcher itself waits):
    - **Shape 1, the front desk:** at most every `WATCH_EVERY_MS` (kept in `watch.json`), `watcherRunning`, and `startWatcher` when it isn't, so a watcher that stopped mid-session starts again without waiting for a session start. `submit` is empty.
    - **Shape 2, the foreman's own session:** one loop, `runWatcher({ project, loops: 1, wakerOptions: { print } })` with a `print` that collects the lines, within `WATCH_BRIDGE_MS`; `submit` holds each line as `<FOREMAN_PROMPT_LEAD> <line>`, in order. The watcher's start lock keeps two loops of one project from running at once, so a second foreman session, or a monitor left over, runs nothing.
    - Any other role, or the other shape: `not-needed`.
  - The bridge's tick: the front desk's answer gains `pane.watcher`; a Shape 2 foreman's answer is `{ ok, role: 'foreman', every: FOREMAN_TICK_MS, submit }`.
  - `scripts/foreman/start.js`, Shape 2: `MONITOR_NOTE` gives way to "The mod in this session hands it the watcher's wakes", and the start no longer waits for check 26.
  - `skills/foreman/SKILL.md`: a prompt `Wheelhouse foreman: WAKE foreman <file>`, `Wheelhouse foreman: WAKE feature <work> <file>` or `Wheelhouse foreman: START feature <work> <worktree>` is the watcher's line as a monitor would have given it, handled as the playbook already says.

- [ ] **Step 1: Write the failing tests,** with a fake `run`, a fake clock and the stand-in helper.

```js
test('Shape 1: a front desk tick starts a watcher that has stopped, at most once a minute', ...)
test('Shape 1: a watcher running is left alone', ...)
test('Shape 2: a foreman tick runs one watcher loop and hands back its wake lines, in order', ...)
test('Shape 2: a second foreman session\'s tick finds the lock taken and runs nothing', ...)
test('nothing starts before the default branch\'s configuration has been read', ...)
test('the waker prints Shape 2\'s lines through the printer it is given', ...)
test('the Shape 2 start says the mod hands on the wakes', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts skills tests
git commit -m "Keep the watcher running from the front desk, and run its loop on the mod's timer for a Shape 2 foreman"
```

### Task 8: The courier

**Files:**
- Create: `scripts/mod/courier.js`
- Modify: `scripts/mod/bridge.js` (the front desk's tick gains `submit`)
- Test: `tests/scripts/mod/courier.test.js`

**Interfaces:**
- Consumes: `PaneModel` (this tick's, and the last one from `readPaneStatus`, read before `writePaneStatus` replaces it); the `waiting` view's `level` and `importance`, and the front desk's importance order (`importanceOf`, Task 3 of that plan); the effective `presence` (with `until`) and `notifications.quiet`; `takeStartLock`; `COURIER_GAP_MS`, `LEADS`.
- Produces:
  - `needsYou({ before, after }) -> Array<{ id, kind: 'card' | 'stop' | 'incident' | 'health' | 'finished', n?: number, blocking?: boolean }>`: what `after` holds that `before` didn't: a card (`card:<id>`, with `blocking` when the front desk's order puts it above level 3: STOP or an incident, level 4, or one that holds up all work, by `importanceOf(card, views)`, which the front desk's Task 3 exports for this; *reviewer's call*, so the two never rank a card differently); STOP turned on (`stop:<since>`); an open incident (`incident:<id>`); a health line at its stop level (`health:<text hash>`); a feature finished (`finished:<work>`). Design section 13's needs-you items, previews (which arrive as approval cards), finished features and STOP.
  - A tick whose `before` is missing, or older than `STALE_TICKS` ticks, records everything it finds as sent and wakes for nothing: the director has just opened the session, and the visit asks what waits. *Reviewer's call:* otherwise every old card would wake the front desk at every session start.
  - `PRESENCE_LETS = { here: every kind, away: ['stop', 'incident', 'health', blocking cards], dnd: ['stop', 'incident'] }`; inside the quiet hours, as `dnd`.
  - `courierWake({ project, items, presence, quiet, idle, now }) -> { submit: string | null, sent: string[] }`, under a start lock on `projects/<p>/mod/courier.json` (`{ sent: Array<{ id, at }>, lastWakeAt }`, the last 500): drops items already sent; keeps those presence lets through; with none left, or while a turn runs, or within `COURIER_GAP_MS` of the last wake (unless one is `stop` or `incident`), it submits nothing and marks nothing sent, so they wait for the next tick. Otherwise one prompt for all of them: `Wheelhouse courier: <what>. Ask any new cards now, once, then send Claude's notification in one line.`, `<what>` being counts and numbers only ("2 new cards (3 and 4); STOP is on"). Each item is marked sent when its wake is handed back.
  - The front desk's tick answer carries that prompt as `submit` when there is one.

- [ ] **Step 1: Write the failing tests.**

```js
test('a new card, STOP, an incident, a health stop and a finished feature are each needs-you once', ...)
test('away lets through STOP, an incident, health and a blocking card, and holds the rest', ...)   // Review Focus 3
test('do not disturb and quiet hours let through only STOP and an incident', ...)                 // Review Focus 3
test('away that has ended counts as here', ...)
test('nothing wakes while a turn runs, and the items wait for the next tick', ...)                // Review Focus 3
test('ten cards in a minute make one wake; another comes no sooner than ten minutes on', ...)     // Review Focus 3
test('STOP wakes at once, inside the ten minutes', ...)
test('two sessions of one project wake once for an item', ...)                                    // Review Focus 3
test('the first tick of a session wakes for nothing and marks what it found', ...)
test('the wake holds counts and card numbers, never a card\'s words', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Wake the front desk only for what needs the director, by their presence, once each"
```

## Part 3: the mod

### Task 9: The pane and the status line

**Files:**
- Create: `hooks/mod/ask.ts`, `hooks/mod/pane.tsx`, `tests/mod/pane.test.ts`
- Modify: `hooks/register.ts`, `tests/mod/register.test.ts`, `scripts/mod/validate.js` (`HOOKS`, `CALLS`)

**Interfaces:**
- Consumes: the bridge's `tick` (Task 3); `PANE_ID`, `STALE_TICKS`; `$.ui.open`, `$.ui.panes`, `$.ui.status`, `$.ui.resolve`, `$.state`, `$.clock.every`, `$.session.id`, `$.session.root`, `$.command.register`.
- Produces:
  - `hooks/mod/ask.ts`: `ask($, request, { timeoutMs = 5000 }) -> Promise<Answer | null>`, the board-and-usage mod's `ask` moved here unchanged but for `Answer = { ok, says?, role?, every?, pane?, glance?, status?, submit?, rows?, text? }`, and `send($, request)` (its toast). The only `$.process.run` in the mod.
  - `session.start`: as before (`/go`, the usage reading), then one tick, not awaited, so the session starts at once as the usage reading does; for the front desk, `$.ui.open({ id: PANE_ID, title: glance })` and `$.ui.status(status)`, then `$.clock.every(answer.every, tick)` while `every` is above 0. The command `wheelhouse` ("Open Wheelhouse's pane") opens the pane at any width, as the person asked, and answers with the glance.
  - Each tick: skipped while the last is running; sends `{ cmd: 'tick', session, cwd, idle, surface }` (`idle` from `$.state`'s `busy`, set by `turn.start` and cleared by `turn.complete`; `surface` from `session.start`'s input); keeps the answer's `pane` in `$.state` (`pane`, with the time it was read), sets `$.ui.status` to the answer's `status` and clears it when there is none, and retitles the pane only when `$.ui.panes()` shows it open, so a pane the director closed stays closed; an `every` of 0 cancels the timer. A tick whose role is no longer the front desk (a Shape 2 foreman's first prompt arrived after its first tick) closes the pane with `$.ui.close` and clears the status line. *Reviewer's call:* a foreman started by the app's own session starter is known as one only from its first prompt.
  - `ui.render` for `{ component: 'Pane', requestId: PANE_ID }`, `drawPane`: the glance; STOP's line; the waiting cards one at a time, "Card n of m" with **Back** and **Next**, each card's `text` as plain `Text` (Task 10 adds its buttons); the building lines, the health lines and the usage line; each `missing` line; and, when the model is older than `STALE_TICKS` ticks or the last tick failed, "Couldn't read the latest at <time>; showing <time>'s" above it all.
  - `HOOKS` gains `turn.start`, `turn.complete`, `command.run` for `wheelhouse` and `ui.render` for the pane; `CALLS` gains `$.ui.open`, `$.ui.close`, `$.ui.panes`, `$.ui.status`, `$.ui.resolve`, `$.state.get`, `$.state.set` and `$.clock.every`, each spelled as the validator spells it (check 40).

- [ ] **Step 1: Write the failing tests** in `tests/mod/pane.test.ts`, with `claude-code/testing`, looped over `['terminal', 'desktop']`, `$.process.run` mocked:

```ts
test('the front desk\'s session opens the pane and sets the status line from the first tick', ...)
test('the pane draws each card\'s text as plain text, one card at a time', ...)
test('a failed tick shows the last picture under a line saying it is old', ...)        // Review Focus 4
test('a pane the director closed is not opened again by a tick', ...)                  // Review Focus 4
test('a tick never starts while the last one runs', ...)
test('a feature session opens nothing and stops ticking', ...)
test('a session that turns out to be the foreman closes its pane', ...)
test('session start does not wait for the first tick', ...)
test('/wheelhouse opens the pane', ...)
```

- [ ] **Step 2: Run `npm run mod-check`.** Expected: FAIL.
- [ ] **Step 3: Implement** `ask.ts`, `pane.tsx` and the new hooks in `register.ts`, which only wires them.
- [ ] **Step 4: Run `npm run mod-check` and `npm test`.** Expected: PASS; the validator lists only the hooks and calls named.
- [ ] **Step 5: Commit.**

```bash
git add hooks scripts tests
git commit -m "Draw the side pane and the status line from the bridge's tick"
```

### Task 10: The buttons

**Files:**
- Create: `hooks/mod/cards.tsx`, `hooks/mod/settings.tsx`, `tests/mod/cards.test.ts`, `tests/mod/settings.test.ts`
- Modify: `hooks/mod/pane.tsx`, `hooks/register.ts`, `scripts/mod/validate.js` (`CALLS`)

**Interfaces:**
- Consumes: the bridge's `press`, `stop`, `go`, `settings`, `setting` (Tasks 4 and 5); `ask`, `send` (Task 9); `$.prompt.submit`, `$.ui.toast`.
- Produces:
  - `drawCard($, card)`: the card's text and one `Button` per entry of the card's `buttons`, keyed by card id and label. A press first sets `$.state` `pressing` to the card and label, which redraws the button as "Recording…" and toasts "Recording <label> on card <n>", then sends `{ cmd: 'press', origin: 'pane', cwd, card: id, hash, label }`; the bridge's `says` is toasted; each `submit` prompt goes to `$.prompt.submit`; then a tick. A card's `note` is drawn under it.
  - One press at a time: while `pressing` is set, every other button but **STOP** is drawn as plain text, so a double click sends once. *Reviewer's call.*
  - The pane's top line: **STOP** while STOP is off, sending `{ cmd: 'stop', origin: 'pane', cwd }`; **Lift STOP** while it is on, sending `{ cmd: 'go', origin: 'pane', cwd }` and toasting the bridge's words, which say what was in progress.
  - `drawSettings($, rows)`: the settings view, reached by a **Settings** button on the board view and left by **Board**; each row's label, its current choice and where it comes from, and a `Button` per choice (the chosen one `variant="primary"`); a press sends `{ cmd: 'setting', origin: 'pane', cwd, key, choice: id }` and toasts `says`; a row with `here: false` shows its `why` and an **Ask the front desk** button that submits `Wheelhouse pane: the director wants to change <label>.`
  - Buttons stay live during a turn, since each press says at once that it was taken (design section 17.1). `HIDE_WHILE_BUSY = false` in `pane.tsx`; check 41 turns it on if a press made during a turn is lost in Desktop, and then the buttons (STOP included) are drawn as "Wait for Claude to finish, or type stop" while a turn runs.
  - `CALLS` gains `$.prompt.submit`.

- [ ] **Step 1: Write the failing tests,** in the same style.

```ts
test('each button the bridge gave a card is drawn, and a press sends its card, hash and label as pane', ...)
test('a press shows Recording at once and toasts the bridge\'s words', ...)
test('a press whose answer holds a prompt submits it', ...)
test('STOP shows while STOP is off, Lift STOP while it is on, each sending pane', ...)
test('the settings view draws each row\'s choices and sends the chosen id', ...)
test('a row that changes in the chat offers only Ask the front desk', ...)
test('the pane origin is sent only from a press', ...)                                // Review Focus 2
```

- [ ] **Step 2: Run `npm run mod-check`.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run `npm run mod-check` and `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add hooks scripts tests
git commit -m "Add the card buttons, STOP and Lift STOP, and the settings pane"
```

### Task 11: The courier's messages, /digest and the foreman's wakes

**Files:**
- Create: `hooks/mod/messages.ts`, `tests/mod/messages.test.ts`
- Modify: `hooks/register.ts`, `tests/mod/register.test.ts`, `scripts/mod/validate.js` (`HOOKS`)

**Interfaces:**
- Consumes: the bridge's `tick` (its `submit`), `digest`; `MESSAGE_LEAD`; check 40's answers on `{ drop }`, `{ consumed }` and a mod command's answer.
- Produces:
  - `isWheelhouseTraffic(origin: string, text: string) -> boolean`: origin `sdk` or `peer`, and a first line matching `MESSAGE_LEAD`. Never true for `composer`, `bridge`, `task-notification` or a plugin's own prompt.
  - In the front desk's session, `prompt.submit` answers `{ drop: 'Wheelhouse traffic, shown in the pane' }` for Wheelhouse traffic, and `session.receive` answers `{ consumed: … }` for it, each then starting a tick so the pane shows what changed; the message itself is information and is never sent to the bridge (design section 4: a message between sessions is never an instruction). Everything else passes on unchanged, as the first piece's hook does. In any other role both pass everything on.
  - Each tick's `submit` prompts go to `$.prompt.submit` in order: the courier's wake in the front desk's session, the watcher's lines in a Shape 2 foreman's. A tick that submitted keeps those prompts out of the next tick's `submit` (the bridge has marked them).
  - The command `digest` ("Show the briefing, with no Claude turn") sends `{ cmd: 'digest', origin, cwd }` and answers `{ text }` with the bridge's text.
  - `HOOKS` gains `session.receive` and `command.run` for `digest`.

- [ ] **Step 1: Write the failing tests,** in the same style.

```ts
test('a peer or sdk message led by Wheelhouse is kept out of the front desk and starts a tick', ...)
test('the same message reaches a feature session or the foreman unchanged', ...)
test('a typed or phoned message led by Wheelhouse passes on unchanged', ...)
test('a task notification passes on unchanged', ...)
test('the courier\'s wake is submitted once, in the front desk', ...)
test('a Shape 2 foreman\'s tick submits each wake line in order', ...)
test('/digest answers with the bridge\'s briefing', ...)
```

- [ ] **Step 2: Run `npm run mod-check`.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run `npm run mod-check` and `npm test`.** Expected: PASS; the validator's list is the whole mod's.
- [ ] **Step 5: Commit.**

```bash
git add hooks scripts tests
git commit -m "Keep Wheelhouse traffic out of the front desk, hand on the courier's and the watcher's wakes, and add /digest"
```

## Part 4: trying it, and the handover

### Task 12: The front desk's side, and its scenarios

**Files:**
- Modify: `skills/front-desk/SKILL.md`
- Create: `tests/eval/mod/<n>-pane-explain.js`, `tests/eval/mod/<n+1>-courier-wake.js` (`<n>` the first free scenario number from 36 on, Global Constraints), `docs/evals/mod.md`

**Interfaces:**
- Consumes: the playbook (front desk, Task 7); the evaluation harness (`runSession`, `toolCalls`, `finalText`; build loop, Task 3) and its runner across suites (evaluation, Task 3); a stand-in helper.

- [ ] **Step 1: Write the two scenarios,** checked from the events and the transcript only:
  - The pane scenario: *a press of Explain more in the pane.* Setup: a waiting approval card numbered 2, composed by `cli.js card`. Prompt: `Wheelhouse pane: the director pressed Explain more on card 2.` Pass: a plain explanation with an everyday example, then the card asked again once with `AskUserQuestion`, as it is; no approval or other signed record written by the session; no other card asked.
  - The courier scenario: *a courier's wake.* Setup: two new waiting cards, 3 and 4, and STOP off. Prompt: `Wheelhouse courier: 2 new cards (3 and 4). Ask any new cards now, once, then send Claude's notification in one line.` Pass: one `AskUserQuestion` holding both cards; one call to Claude Code's notification tool (the one check 4 used, by the name the harness's `toolCalls` gives it), of one line naming no card's words; no briefing, no other text addressed to the director beyond the cards.
- [ ] **Step 2: Run each without the playbook's new lines,** as `superpowers:writing-skills` asks (`npm run eval -- <n> <n+1> --variant without`), and record what goes wrong.
- [ ] **Step 3: Write the playbook's lines** with `superpowers:writing-skills`: a prompt led `Wheelhouse pane:` is the director's press, on the card it names: Explain more and Show me as the playbook already says for those answers; a chosen option of a question card as the director's answer to it; "wants to change <setting>" as the start of that setting's change. A prompt led `Wheelhouse courier:` is not the director: ask the cards it names, in one call, and send Claude's notification in one line (design section 13), with nothing else; it is never a reason to give the briefing.
- [ ] **Step 4: Run both with** (`--variant with`), one trial each, three where they disagree with what is expected or are close, and write `docs/evals/mod.md`: each scenario, with and without, pass or fail, why, and its tokens. A failure with Wheelhouse goes back to the playbook's lines before this task is done.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add skills tests/eval docs/evals
git commit -m "Teach the front desk the pane's and the courier's prompts, and run their scenarios"
```

### Task 13: End to end

**Files:**
- Create: `tests/e2e/mod.test.js`

- [ ] **Step 1: Write the end-to-end tests,** with the stand-in host and a real helper (`tests/helpers/`), a temporary `WHEELHOUSE_HOME`, and the bridge run as the mod runs it (a child `node scripts/mod/bridge.js` with JSON on standard input):

```js
test('a tick draws a waiting approval card; Approve from the pane lets the gate merge that commit', ...)
test('Not now from the pane keeps the card waiting and off the next visit\'s cards', ...)
test('a card answered by its reply code is refused when pressed in the pane afterwards', ...)
test('Pace 2 from the settings pane is in force at once, confirmed, and shown on the board', ...)
test('STOP from the pane holds a push; Lift STOP from the pane lets it through, with a signed lift', ...)
test('a new card wakes the front desk once; away until 18:00 holds a card that blocks nothing', ...)
test('/digest gives the briefing, and a prompt within the next two hours brings none', ...)
test('Shape 2: a state event makes one foreman wake line on the next foreman tick', ...)
test('the bridge run where the signing key cannot be read signs nothing for a press', ...)   // the key made unreadable, as the board-and-usage bridge test does
```

- [ ] **Step 2: Run `npm test`.** Expected: PASS, the whole suite, on the Mac. Report the count. Run `npm run mod-check`. Expected: PASS.
- [ ] **Step 3: Commit.**

```bash
git add tests/e2e
git commit -m "Try the mod end to end through the bridge, the helper and the gate"
```

### Task 14: Check 41, the mod in Desktop

**Files:**
- Create: `docs/checks/41-mod-desktop.md`
- Modify: `docs/checks/README.md`, and `hooks/mod/pane.tsx` only if Step 2 finds a press during a turn is lost

The question: *That the mod's pane, status line, buttons, settings pane, STOP button, courier and `/digest` work in Claude Desktop on the Mac and on Windows: the pane opens beside the front desk; the status line shows; each press records what a click would, including one made while a turn runs; a settings choice is in force at once; STOP and Lift STOP work from the pane; the courier's wake reaches the director's phone while they are away; and the mod's timer keeps running while the Desktop window is hidden.*

Agents do every step they can (the director's standing rule for Wheelhouse, 18 October 2026). The director is brought only what needs them: one card to approve the sitting, the hot-reloading click (which only the person at the computer can give), the presses (a press by anyone else would prove nothing), locking the screen for the phone test, and being at the Windows computer.

- [ ] **Step 1: Prepare (agent).** A scratch Wheelhouse project with the stand-in host, as the safety sitting made it; four waiting cards composed by `cli.js card` (an approval of a stand-in pull request, a confirmation of a setting, a feature's question, a product question); Remote Control left as the director has it. One card to the director: what the sitting changes on the computer (this worktree's plugin loaded for one session only by hot reloading, as in check 9; a scratch project under the temporary folder; nothing else) and how each is undone; **Go ahead**, **Not now**. If board-and-usage check 33 hasn't run yet, the same card covers it and the sitting runs its steps first, adding about 5 minutes.
- [ ] **Step 2: Mac (about 10 minutes of the director's time).** The agent opens a Desktop session on the scratch project with `start_session`; the director clicks **Enable for this session** when hot reloading is offered. The agent then asks, one card at a time, for each press, and reads the records after each: whether the pane and the status line are there (a card: **I see both**, **Only the pane**, **Neither**); **Approve** on card 1 while the session is idle; **Not now** on card 2; **Explain more** on card 3, then, while the turn it starts is still running, an answer option on card 3 itself; **Pace: 2** in the settings view; **STOP**, then **Lift STOP**. The agent also runs the bridge itself from its own Bash with `origin: 'pane'` and checks nothing was signed. Then the director locks the screen for three minutes, during which the agent adds a fifth card; on their return, one card asks whether a notification reached the phone. The agent then sends the scratch session, from its own session with `SendMessage`, one line led `Wheelhouse:`, and reads the mod's log and the transcript for whether `session.receive` fired on the Mac (check 9's open point, which the pilot was to settle) and whether the line was kept out of the conversation. Last, the director types `/digest`. Pass: each press made a signed, verified record or a card answer, as its click would; the press during a turn too, or, if it was lost, `HIDE_WHILE_BUSY` is turned on and the note says so; Pace 2 is in force and confirmed; STOP set and lifted with a signed lift; the courier woke the front desk once, while the screen was locked (`courier.json`'s `lastWakeAt` falls inside the three minutes, which shows the timer fired); the line sent from another session never reached the conversation; nothing was signed for the agent's run.
- [ ] **Step 3: Windows, when the director is next at that computer,** with that visit's other checks: the same steps; the director's part is being there, the approval click, the hot-reloading click and the same presses.
- [ ] **Step 4: Undo,** write the note with what each step showed, add its row, run `npm test` and `npm run mod-check`, commit.

```bash
git add docs/checks hooks
git commit -m "Record check 41: the mod in Desktop"
```

**If the answers differ:** if Desktop draws no status line, the glance stays in the pane's title (Task 9 sets both), and the note says the status line serves the terminal and VS Code. If a press made during a turn is lost, `HIDE_WHILE_BUSY` is turned on, with its test. If the timer stops while the window is hidden, the courier can't wake the front desk while the director is away from the computer; needs-you items still wait on the board and in the next briefing (design section 13 never relies on the phone alone), and the board's health line says the phone hears of them only while Desktop is open in front.

### Task 15: The design and the handover

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md`, `docs/specs/2026-10-18-build-loop-design.md`, `HANDOVER.md`

- [ ] **Step 1: Bring the design up to date:** section 17.1 (the pane's model as `status.json`; the tick; the press origin `pane`; each card's buttons and the form check; the settings pane's rows and that a press is its own confirmation; `/digest` as the command's output; the courier reading state, its presence rules and its wake; Wheelhouse traffic kept out of the front desk; watching under both shapes; the proof's three parts), 5.2 (the glance in the status line and the pane), 9 (a mod click as a confirmation), 12.7 (STOP and Lift STOP from the pane), 13 (the courier's wake and Claude's notification), 14.4 (the settings pane), 17.2 (step 6 done, ahead of the evaluation by the director's decision of 19 October 2026), section 18 (the pane and courier scenarios), section 20 (checks 40 and 41); and the build-loop design's section 11 (Shape 2's wakes carried by the mod's timer, so check 26 is no longer needed for it) and 16 (check 26's note). This plan's calls go into section 21, each marked *Designer's call*.
- [ ] **Step 2: Update `HANDOVER.md`:** what this plan built, what checks 40 and 41 found, and the next step in design section 17.2 (the evaluation as a whole, then Wheelhouse used for all work on the first project).
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add docs HANDOVER.md
git commit -m "Bring the mod into the design, and update the handover"
```

## Plan's calls

Settled here without the director, each listed for the design in Task 15:

1. **When it starts:** once the board-and-usage, front desk and build-loop plans have merged, since it calls all three. Task 1 can run now; Task 2 once the board-and-usage branch has merged.
2. **One tick per period.** The mod sends one request on its timer and draws what comes back; the bridge works out the pane, the courier and the watcher in that one run, so the mod holds no rule of its own.
3. **`status.json` is the pane's model,** written by the bridge at each tick: the design's file for "at a glance", and the courier's record of what was there last time.
4. **A press is the director's,** under the origin `pane`, which only a press handler sets; the bridge signs for it only what a click on the same card would earn.
5. **A card in the pane shows its whole text, as plain text,** and gets its deciding button only when its form passes the same check the card hook uses; otherwise only **Explain more**.
6. **A press names the card's hash,** so a card that changed, closed or was spent since it was drawn records nothing.
7. **Buttons stay live during a turn,** each saying at once that its press was taken; check 41 can switch them off during a turn if a press made then is lost.
8. **The settings pane:** a press is the change and its confirmation; presence has six fixed choices worked out at the press; protection, notifications and working hours are changed through the front desk; the budget offers only its one level while budget allocation is in the backlog; the advanced settings stay with the front desk.
9. **`/digest`** is the mod command's own output, and counts as a briefing given.
10. **Watching, Shape 1:** the background watcher stays the poller, and the front desk's mod starts it again within a minute if it stops. **Shape 2:** the mod's timer in the foreman's session runs the watcher's loop and hands it each wake, in place of a plugin monitor, so check 26 is no longer needed for it.
11. **The courier reads state,** since the build-loop design replaced the foreman's messages with state; it wakes the front desk only for needs-you items, by the director's presence and quiet hours, once each across every session, at most every ten minutes except for STOP and an incident, and never during a turn.
12. **A finished feature wakes the front desk** only while the director is here, since design section 13 lists it with the needs-you items.
13. **The courier's wake carries counts and card numbers,** never an event's words.
14. **Wheelhouse traffic from other sessions** (`sdk` or `peer`, led by `Wheelhouse…:`) is kept out of the front desk's conversation and shown in the pane; nothing else is ever dropped.
15. **The pane opens by itself** only at the front desk's session start and on `/wheelhouse`; a pane the director closed stays closed.
16. **The mod is split into files** under `hooks/mod/`, by job, once check 40 shows the validator reads them.
17. **The proof has three parts:** the validator's report against the allowed and forbidden lists, every module file's source, and the bridge's import graph, which never reaches the code that writes Claude Code's settings; CI's `validate` job runs it on every pull request.
18. **Two scenarios** test the front desk's side of the pane's and the courier's prompts, numbered after the real-use ones already written.

## Builder check

Read on 19 October 2026 as the builder would, against design section 17.1, the build-loop design's sections 2 and 11, the mod reference that ships with Claude Code 2.1.299, and the code as built on the board-and-usage branch (`claude/focused-pasteur-70cf64`), the build loop's foreman branch (`claude/build-loop-foreman-9786cf`) and `main`. Nothing needed the director. These gaps were settled in place, each marked *Reviewer's call*, and go into the design with the plan's calls in Task 15:

1. **The bridge's imports** (Task 2) reach `scripts/protection/settings.js` through the watcher's waker, which takes only the pure `featureAllowRules` from it. So the proof checks what is imported (never `writeSettings` or `mergeSettings`), not the file, and still refuses `managed.js`, `locked.js` and setup outright.
2. **The pane origin** (Task 2) is checked by the press handlers' names, `press…`, which a script can read without a TypeScript parser.
3. **The board's waiting list has no ids** (Task 3): its items are numbered but not named. They gain their card's id, or `q:<question id>` for a build-loop question no card asks yet, which the pane shows as a line with no buttons.
4. **The status line in the terminal** (Task 3): where Wheelhouse's own status-line command is set, the tick gives no status, so the glance doesn't show twice.
5. **The bridge's time limit** (Task 3) is set today before the request is read; it now follows the request, so a Shape 2 loop gets its 45 seconds.
6. **Who a session is** (Tasks 3 and 9): a foreman started by the app's own session starter is known only from its first prompt, after the mod's first tick, so a tick that finds the session is the foreman closes the pane it opened.
7. **The first tick doesn't hold up the session** (Task 9): it isn't awaited, as the first piece's usage reading isn't.
8. **STOP and the helper's writes** (Tasks 4 and 5): under STOP the helper refuses `/state/write` and `/profile/write` but takes `/state/record`. So a deciding press still records and closes its card by its signed record; **Not now** and a setting record nothing and say so; **Explain more** and **Show me** still start their turn. The signed record is always kept before the card's plain answer.
9. **A setting's confirmation** (Task 5) needs the event, and the write routes answer only its id; the bridge reads the event back from the clone.
10. **The courier's first tick** (Task 8) records what it finds and wakes for nothing, or every old card would wake the front desk at each session start.
11. **One rank for a card** (Task 8): the front desk's importance order is exported as `importanceOf`, so the courier's "holds up all work" and the visit's order never disagree.
12. **One press at a time** (Task 10): while a press is in flight, the other buttons but STOP are plain text, so a double click sends once.
13. **No script can send a message into a running session** (check 27 found no such route), so `session.receive` and the courier's drop of a message from another session are asked in Desktop (check 41), where the agent's own session sends one with `SendMessage`. That also settles check 9's open point on the Mac, which the pilot was to settle before the director dropped it.
14. **Scenario numbers** (Task 12): the evaluation and install plans number the problems real use turns up from 36, so this plan's two scenarios take the next free numbers when they are written.
15. **The check numbers** follow the install plan's count, which gives this plan 40 to 49; it uses 40 and 41.

## Order

Task 1 first: it needs nobody and can run now. Task 2 once the board-and-usage branch has merged. Tasks 3 to 8 once the front desk and build-loop plans have merged too, in order, except that Task 6 and Task 7 can come at any point after Task 3, and Task 8 needs Task 3. Tasks 9 to 11 in order, after Tasks 2 to 8. Task 12 needs Task 11 and the evaluation plan's runner (its Task 3). Task 13 needs Tasks 3 to 11. Task 14 needs Task 13. Task 15 is last.

**If a check answers differently:** check 40's fall-backs are in Task 1, and check 41's in Task 14. If build-loop check 27 picks Shape 2 on Windows, Task 7's Shape 2 half is what wakes that computer's foreman, and check 41's Windows run includes one foreman wake.

## The director's sittings

| Sitting | Computer | Tasks | The director's part | About |
|---|---|---|---|---|
| 1 | Mac | 14 (check 41), and board-and-usage check 33 if it hasn't run | the approval click, the hot-reloading click, the presses, locking the screen once | 10 min, 15 with check 33 |
| 2 | Windows, when next at it | 14 (check 41) | being there, and the same | 10 min |

Agents run every step they can (the director's standing rule for Wheelhouse, 18 October 2026). Each sitting starts with one card listing every change it makes (the plugin loaded for one session by hot reloading, a scratch project) and how each is undone, which the director approves by clicking. Check 40 needs nobody.

## After this plan

The next step in the design's build order (section 17.2), as the director set it on 19 October 2026, is the evaluation as a whole (section 18), on a build with every designed piece in it, then Wheelhouse used for all work on the first project, and the first public release once the measures have been met for two weeks.
