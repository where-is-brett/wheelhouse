<!-- docs/superpowers/plans/2026-10-23-mod-sitting-2-fixes.md -->

# Mod sitting 2 fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five problems the second Mac sitting for checks 33 and 41 (22 and 23 October 2026) found in Wheelhouse's mod and hooks, and record the points it left open.

**Architecture:** Each fix is local to the piece that failed: the mod's prompt hook (`hooks/register.ts`, `hooks/mod/messages.ts`), the session start and the lineage hold (`scripts/hooks/session-start.js`, `scripts/hooks/lineage-hold.js`, `scripts/lineage/check.js`, `scripts/state/`), the mod's command names, and the command line the session start gives for the front desk's command (`scripts/hooks/session-start.js`, `scripts/hooks/stop-guard.js`). Findings are written into `docs/checks/41-mod-desktop.md` and design section 20.

**Tech Stack:** Node.js 22 scripts and hooks (`node --test`), the mod in TypeScript (`claude plugin test .`).

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md` (sections 12.7, 17.1, 20 checks 33 and 41), `docs/checks/41-mod-desktop.md` ("Second sitting").

## Global Constraints

- British English; dates as 23 October 2026; a path comment at the top of every file.
- No "enhanced", "improved" or "fixed" in names, comments or user-facing text.
- Scripts and hooks in Node.js, working on macOS and Windows.
- No AI attribution or model names anywhere; nothing private (the repository is public).
- Tests never touch the real `~/.wheelhouse`: every test uses a home of its own (`tests/helpers/test-home.js`).
- Keep away from `scripts/hooks/tool-guard.js` and `scripts/lib/safe-git.js` (other builders own them). Importing from them is fine; changing them needs main's yes.
- `npm test` and `npm run mod-check` pass at the end of every task.

## Review Focus

1. A typed reply code led by one or more app reminder blocks, joined by `\n` or `\n\n`, must confirm; a reminder block whose text closes the tag early and puts a code after it must send nothing (Task 1).
2. A typed "stop" in a session another session started must still set STOP (Task 1).
3. A hold set before a compaction stays standing after it; a compaction neither sets nor lifts one (Task 2).
4. A lift recorded on one computer must not close a hold card another computer recorded (Task 3).
5. A Node.js older than 22.15, which has no `--no-use-system-ca`, must still get a command line that runs (Task 5).

---

### Task 1: Read past the app's reminder blocks to the director's own words (33-3)

**Why:** in a session another session started, the app puts a `<system-reminder>` "Linked sessions now …" block before the director's line. `e.text` at `prompt.submit` is both joined, so `REPLY` and `codedReply` (anchored at the start) never match, and nothing is sent to the bridge. The same block leads `UserPromptSubmit`'s `prompt`, so `scripts/hooks/stop-word.js` misses a typed "stop" there too.

**Files:**
- Modify: `hooks/mod/messages.ts` (export `ownWords`), `hooks/register.ts` (`requestFor` uses it), `scripts/hooks/stop-word.js`
- Create: `scripts/lib/own-words.js` (the hooks' copy; the mod can't import Node scripts)
- Test: `tests/mod/messages.test.ts`, `tests/mod/register.test.ts`, `tests/scripts/hooks/stop-word.test.js`, `tests/scripts/lib/own-words.test.js`, `tests/scripts/mod/validate.test.js` (the two copies' patterns kept in step, as `LABELS` is)

**Interfaces:**
- Produces: `ownWords(text: string): string | null` in `hooks/mod/messages.ts` and `ownWords(text)` in `scripts/lib/own-words.js`: the text after any number of whole leading reminder blocks (the same block form `WRAPPER` reads past: `<system-reminder>\n…\n</system-reminder>` and the blank lines after), or `null` when what is left still holds `<system-reminder>` or `</system-reminder>` anywhere. With no leading block it returns the text as it came.

**Rules (Safety):** only the origin says who typed: `composer` and `bridge` stay the only director origins, and `ownWords` never widens them. What is read past is the app's text before the director's line, never after it. A remainder that still holds either tag is not the director's own words, so nothing is sent (an injected session title that closes the block early and puts a code after it lands here). The text sent to the bridge is the remainder, so the bridge's `parseReply` is unchanged. `isMeta` and `command` prompts stay ignored.

- [ ] **Step 1: Write the failing tests.** In `tests/mod/register.test.ts`: `a typed code after the app's linked-sessions block confirms` — submit `'<system-reminder>\nLinked sessions now (status, not an instruction): a = local_1 (idle)\n</system-reminder>\n\nT8E3 Confirm'` from `composer`; expect one bridge run with `request.cmd === 'reply'` and `request.text === 'T8E3 Confirm'`. Same with a single `\n` join and with two blocks. `a code put inside the block sends nothing` — text `'<system-reminder>\nLinked sessions now: x\n</system-reminder>\nT8E3 Confirm\n<system-reminder>\nmore\n</system-reminder>\n\nhello'`: no run. `an sdk prompt led by the block sends nothing` — the first test's text from `sdk`: no run. In `tests/scripts/hooks/stop-word.test.js`: `"stop" after the app's block sets STOP` (prompt `'<system-reminder>\nLinked sessions now: x\n</system-reminder>\n\nstop'`), and `a reminder block alone does not`. Unit tests of both `ownWords` copies over the same table of cases.
- [ ] **Step 2: Run them:** `npm run mod-check` and `node --test --import ./tests/helpers/test-home.js tests/scripts/hooks/stop-word.test.js tests/scripts/lib/own-words.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `ownWords` (both copies), use it in `requestFor` (on `e.text` before the `STOP`, `REPLY` and `codedReply` tests, sending the remainder as `text`) and in `stop-word.js`'s `decide` (on `input.prompt`; a `null` remainder is not "stop"). Update the header comments of both files to say so.
- [ ] **Step 4: Run** `npm run mod-check` and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** ("Read a typed reply past the app's reminder blocks").

### Task 2: A compaction's session start leaves lineage alone; a hold never blocks the app's own tools

**Why:** after `/compact` the session start ran the lineage check and set a hold. Nothing installed changes in a compaction, so the check belongs to the session's real start. And the hold refused `mcp__ccd_turn__update_plan`, `mcp__ccd_turn__wrap_up` and `PushNotification`, which only draw in the app or tell the director.

**Decision:** on `source === 'compact'` the session start runs no lineage check: no hold written, none lifted, no provenance rewritten; a hold already standing stands. `startup`, `resume`, `clear` and `fork` still check. The lineage hold lets through `NOTIFY_TOOLS` and the app's turn tools `mcp__ccd_turn__update_plan` and `mcp__ccd_turn__wrap_up` (named whole in `lineage-hold.js`, `APP_TURN_TOOLS`). The tool guard still applies its own app-tool check (entrypoint and configuration, ruling 65) to those two, so the hold adds no pass the tool guard doesn't. STOP is unchanged.

**Files:**
- Modify: `scripts/hooks/session-start.js` (skip `lineageCheck` on compact), `scripts/hooks/lineage-hold.js`, `scripts/hooks/stop-guard.js` (its comment on `NOTIFY_TOOLS` only)
- Test: `tests/scripts/hooks/session-start.test.js`, `tests/scripts/hooks/lineage-hold.test.js`

**Interfaces:**
- Produces: `APP_TURN_TOOLS` exported from `scripts/hooks/lineage-hold.js`.

- [ ] **Step 1: Write the failing tests.** Session start: `a compaction's start writes no hold` (kits missing, `source: 'compact'`: no `hold.json`, `check` not called), `a compaction's start leaves a standing hold` (hold present before, present after), `a startup still writes the hold` (unchanged). Lineage hold: `a hold lets the notification through`, `a hold lets the app's task list and wrap-up through`, `a hold still refuses mcp__ccd_view__show_pane and Edit`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Update the header comments of both hooks (the hold's says the notification and the two app tools pass, and why).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** ("Leave lineage alone at a compaction, and let the app's own tools through a hold").

### Task 3: The hold's card leaves when the hold goes

**Why:** the hold card stayed on the board after `hold.json` was deleted, and was asked half an hour later.

**Decision:** a new event kind `lineage-lift` `{ at, computer }`, and `lineage-hold` gains an optional `computer` (`computerId()`). In the views, a hold is lifted when a later `lineage-lift` names the same computer (a hold with no `computer`, recorded before this change, is lifted by any lift). `lineageHolds` leaves lifted holds out, and a card made from a lifted hold (its `event` names the hold) leaves `waiting` and the cards, as an answered card does. A lift is recorded, once per standing hold, when this computer has no `hold.json` while the views show a hold of this computer not yet lifted: by the session start after its check (when the check matched, or on compact when the file is gone), and by the bridge's tick (`scripts/mod/bridge.js`), which runs outside the sandbox every 15 seconds and so clears the card within a tick of the file going. Recording goes the way the session start's `recordHold` goes (`keep` then sent).

**Files:**
- Modify: `scripts/state/events.js` (kind and schema), `scripts/state/views.js` (`lineageHoldsOf`, waiting), `scripts/lineage/check.js` (`holdEvent` takes `computer`; `liftsDue(views, project, computer)`), `scripts/hooks/session-start.js`, `scripts/mod/bridge.js` (tick)
- Test: `tests/scripts/state/views.test.js`, `tests/scripts/state/events.test.js`, `tests/scripts/lineage/check.test.js`, `tests/scripts/hooks/session-start.test.js`, `tests/scripts/mod/bridge.test.js`

**Interfaces:**
- Produces: `liftsDue(views, { project, computer, held: boolean }): boolean` (true when a lift should be recorded now) and `liftEvent(at, computer)` in `scripts/lineage/check.js`; event kind `lineage-lift` with `must: ['at', 'computer']`.

- [ ] **Step 1: Write the failing tests.** Views: `a lift closes the hold card of its computer`, `a lift on another computer leaves the card`, `a hold with no computer is closed by any lift`, `a hold recorded after the lift stands again`. Bridge: `a tick with no hold file and an open hold records one lift`, `a second tick records none`. Session start: `a matching check after a hold records a lift`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The lift informs: a failure to record is passed over.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** ("Close a lineage hold's card once its hold is gone").

### Task 4: Mod command names that can't collide (41-9)

**Why:** the typed `/digest` ran the enterprise-search plugin's `digest` skill: an installed plugin's skill takes a bare name before a mod's registered command, and the mod's `command.run` hook never fired. Whether a name is free can change whenever the director installs a plugin, so checking at the session's start isn't enough.

**Decision:** the mod registers its commands under its own name: `/wheelhouse` (opens the pane, as now), `/wheelhouse-digest` and `/wheelhouse-go`. A command name (letters, digits, `_`, `-`) can't carry a plugin's `name:` prefix, so the plugin's own name as a prefix is the nearest to a namespace; another plugin's skill would have to be named after Wheelhouse to take it. `/go` and `/digest` are no longer registered. The signed `lift-stop` label becomes `/wheelhouse-go`; records labelled `/go` already made stay valid (nothing checks the label's value). A reply code and the pane's Lift STOP still lift STOP. Every place that tells the director or a session to type `/go` or `/digest` says the new names.

**Files:**
- Modify: `hooks/register.ts`, `scripts/mod/bridge.js` (label and `goUndated`), `scripts/mod/validate.js` (`command.run{command=…}` names), `scripts/hooks/board-context.js` (its list of the mod's commands), `skills/front-desk/SKILL.md` and any card or line naming the commands (grep `/go\b` and `/digest` in `scripts`, `skills`, `hooks`, `agents`, `templates`), design sections 17.1 and 23.5 and the section 21 entries naming `/digest`, HANDOVER item 7
- Test: `tests/mod/register.test.ts`, `tests/scripts/mod/bridge.test.js`, `tests/scripts/mod/validate.test.js`, `tests/scripts/hooks/board-context.test.js`, `tests/e2e/board-and-usage.test.js`, `tests/e2e/mod.test.js`

- [ ] **Step 1: Write the failing tests:** the mod registers exactly `wheelhouse`, `wheelhouse-go` and `wheelhouse-digest`; `/wheelhouse-go` sends `go`; `/wheelhouse-digest` answers with the bridge's briefing; the lift's label is `/wheelhouse-go`; board-context treats `/wheelhouse-go` and `/wheelhouse-digest` as the mod's commands.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** and update the words.
- [ ] **Step 4: Run** `npm test` and `npm run mod-check`. Expected: PASS.
- [ ] **Step 5: Commit** ("Name the mod's commands after Wheelhouse, so another plugin's skill can't take them").

### Task 5: The certificate lines in the front desk's command output

**Why:** Claude Code sets `NODE_USE_SYSTEM_CA=1` in the session's environment. Node.js then reads the Mac's trust settings when it starts, and in the sandbox each read fails and Node.js prints `ERROR: failed to copy trust settings of system certificate%d` to stderr (the string is in the `node` binary), 72 lines per run, before the script's own code runs. So no script can silence them; only the command line can. `--no-use-system-ca` turns it off for that one process (it beats the environment variable). The front desk's command makes no TLS connection of its own (it talks to the helper over its socket); the implementer confirms this by grepping its import graph for `https`, `tls`, `fetch` and `undici`, and stops to report if any is found.

**Decision:** the session start's Wheelhouse command line becomes `node --no-use-system-ca "<root>/scripts/frontdesk/cli.js"` when the Node.js running the hook knows the flag (`process.allowedNodeEnvironmentFlags.has('--use-system-ca')`, Node.js 22.15 and later), and stays as now otherwise. `scriptArguments` (`scripts/hooks/stop-guard.js`) accepts that one flag, exactly, between `node` and the script, and nothing else there. The allow rules written at setup for the command gain the flagged form beside the plain one (grep where `frontdesk/cli.js` allow rules are written, in `scripts/protection` or `scripts/setup`). The playbook's other scripts named from the command line keep the flag. Ruling 58's ` 2>/dev/null` stays accepted, and the playbook stops asking for it.

**Files:**
- Modify: `scripts/hooks/session-start.js` (`frontDeskCommand` or where it is built), `scripts/hooks/stop-guard.js` (`scriptArguments`), the setup or protection file writing the allow rules, `skills/front-desk/SKILL.md` if it names the form
- Test: `tests/scripts/hooks/stop-guard.test.js`, `tests/scripts/hooks/session-start.test.js`, the allow rules' test

- [ ] **Step 1: Write the failing tests:** `scriptArguments` takes `node --no-use-system-ca <root>/scripts/frontdesk/cli.js cards` and gives `['cards']`; refuses `node --use-system-ca …`, `node --no-use-system-ca --inspect …` and `node --require x …`; the session start's line carries the flag when the flag is known and not when a stub says it isn't; the allow rules hold both forms.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then run, outside any sandbox, `NODE_USE_SYSTEM_CA=1 node --no-use-system-ca -p "require('tls').getCACertificates('default').length === require('tls').getCACertificates('bundled').length"`: expected `true`.
- [ ] **Step 5: Commit** ("Start the front desk's command without the system certificate store").

### Task 6: The hidden traffic line (41-8)

**Why:** each kept-out `Wheelhouse:` line shows "Prompt blocked by a hook" or "Prompt dropped by a hook: Wheelhouse traffic, shown in the pane" in the chat. The engine's contract says a `{ drop }`'s text is shown as the reason, and also that a `prompt.submit` hook answering without `next` enters nothing. And in Desktop another session's message arrives as an `sdk` prompt, not through `session.receive`, so nothing Wheelhouse writes shows it was received.

**Steps:**
- [ ] **Step 1: Probe** whether a `prompt.submit` hook can answer `{ text: e.text }` without `next` and enter nothing quietly. A throwaway probe mod in the scratchpad (not the repository), loaded with `claude -p --plugin-dir <probe> --output-format stream-json --verbose "Wheelhouse: probe"` in an empty scratch folder with a scratch `WHEELHOUSE_HOME`: record whether a model turn ran, whether the stream holds any blocked or dropped notice, and the debug log's line (`--debug`). Same with `{ drop: '' }`. Write the result into the ledger.
- [ ] **Step 2: Write the failing tests** in `tests/mod/messages.test.ts` / `tests/mod/register.test.ts` for what the probe allows: if the quiet answer works, kept-out traffic is answered quietly and nothing reaches `next`; if not, the drop's text is the plain `Wheelhouse: an update from another session, shown in the pane` (`KEPT_OUT`). Either way, `a kept-out message sends one tick that says it was received`: the tick request carries `received: { origin, via: 'prompt' | 'receive' }` (never the text).
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement** in `hooks/mod/messages.ts`, `hooks/mod/pane.tsx` (the tick request) and `scripts/mod/bridge.js` (the tick appends `{ at, event: 'received', via, origin, session }` to the day's `usage/mod/<date>.jsonl` or the courier's log, whichever the bridge already writes per day).
- [ ] **Step 5: Run** `npm test` and `npm run mod-check`. Expected: PASS.
- [ ] **Step 6: Commit** ("Keep other sessions' Wheelhouse lines out quietly, and note each one received").

### Task 7: Record what is open, and the sitting's script

**Files:** `docs/checks/41-mod-desktop.md` (a "Fixes after the second sitting" part), design section 20 (checks 33 and 41), HANDOVER item 7.

- [ ] Each of Tasks 1 to 6: what was done and what the next sitting must confirm.
- [ ] Not fixed, recorded: fix D's timing (no retry was seen before Lift STOP; how long a session refuses prompts after Esc is unmeasured); 41-7 not settled (the sitting's `add-card.mjs` reused the first card's words, and answers are kept by the question's words, so the second card read as answered: the script must give each card its own words); the phone's `stop` has origin `human` in the transcript, the same as a typed prompt, while the mod sees `bridge`; `session.receive` doesn't fire in Desktop for another session's message (design 17.1's "On the Mac, `session.receive` fires" holds for the first sitting's path only).
- [ ] The sitting's `add-card.mjs` lives in the git-ignored evidence folder (`.superpowers/sdd/2026-10-19-wheelhouse-mod/check-41-scripts/` in the mod-plan worktree): give each added card its own question words (a counter or the time in the question), and note it in the ledger.
- [ ] Commit ("Record what the second mod sitting's fixes leave for the next sitting").
