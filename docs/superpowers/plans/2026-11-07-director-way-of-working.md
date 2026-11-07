<!-- docs/superpowers/plans/2026-11-07-director-way-of-working.md -->

# The director's way of working: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan step by step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the director's way of working on the code the core cut leaves. That means:
- decisions as plain chat messages, answered by the director's own signed reply;
- a wider decision line, with a log of the agents' own calls;
- a shape check that sends a bad decision back to the agent;
- decision records kept in the project;
- work that carries on behind a gate hold while a decision waits;
- "why" answered by a copy of the session that asked;
- proof notes, with a before-and-after of the data;
- merging by what the change shows, and undo on every host;
- a daily digest and alerts that carry no content;
- routine moves made by a script, with a reliability bar.

**Architecture:**
- **Decisions get their own folder,** `scripts/decisions/`, for the message, the waiting list, reply parsing, the record files and "why".
  - The existing card code feeds it. `compose.js` still builds each decision and `card-check.js` still checks it.
  - The director's reply is captured on `UserPromptSubmit` by `prompt-record.js`, and only in a front-desk session.
- **The gate gains three refusals:** a decision still waiting, a change that shows something users see, and a change at director level. All three are built from the existing guardrail facts and `gateDecision`.
- **Undo** reverts through the helper's own git and opens the revert as a pull request, which merges through the same gate.
- **The digest and alerts** run from the watcher's tick, not from cron. Alerts leave through the helper, the only part holding the alert tokens.
- **Routine moves** go from the foreman model into a watcher script. Inside each piece, the feature session still runs the Superpowers loop.

**Tech Stack:** Node.js (ES modules) and `node:test`. Alerts use Node's own `fetch` over HTTPS. No new dependency.

**Spec:**
- `docs/specs/2026-11-07-director-way-of-working-design.md`, cited below as "the design".
- The core cut, `docs/specs/2026-11-07-core-cut-design.md`. Until it merges, it lives on `feature/core-cut-design-5b4673`. This plan builds on the code its section 3 keeps and touches nothing it parks.

## How to use this plan

- **One fresh session per step.** Each step gets its own branch (`feature/wow-<step>-<slug>`) and one pull request. The step's session messages the main session once, when it is done, blocked or limited. The director merges.
- **Nothing starts until core cut parts 1 to 5 have merged into main** (design section 14). Some steps wait on a later core cut part too; the order table names it.
- **Re-check before you start.** Every step begins with a "Re-check before starting" list.
  - File and line references here are from main at `ff40128d` (7 November 2026). The core cut moves and removes code, so find things by name, not by line.
  - Where a re-check finds the code gone or changed, adapt to what is there. Ask the main session only when the step's intent no longer fits.
- **Run only the test files you touch:** `node --test --import ./tests/helpers/test-home.js <test file>`. Leave `npm test` (about 40 minutes) to CI.
- **Ask the main session, never the director.** A question on the director's side of the decision line (design section 5) goes to the main session in the design's section 6.2 shape.

## Global Constraints

- Every file starts with a comment giving its repository-relative path. JSON is exempt.
- British or Australian English. Dates are written day month year (7 November 2026).
- No model identifiers and no sign of AI authorship in code, comments, commits or pull requests.
- The repository is public:
  - Never name the director's projects.
  - Tests use made-up projects and data: the project `harbour-demo`, the pieces `w-tide-1` and `w-tide-2`.
- Scripts and hooks are Node.js, use `node:path`, and run on macOS and Windows.
- Hooks fail open, except the ones that already block (`stop-guard`, `tool-guard`, `lineage-hold`, `protected-tests`, `areas`).
- **Silence never counts as yes.** No code path turns a timeout, an expiry or a missing reply into an answer (design section 6.5).
- **Only the director's own typed words decide.**
  - A decision is recorded from `UserPromptSubmit` prompt text, in a session whose role is `front-desk` and that wasn't started by a script.
  - Text an agent wrote never counts (design section 6.1).
- **Alerts carry no content and no link.** An alert holds only a count and the project's name (design section 9).
- **Agents never write to real data.** The real-data route is read-only and works only once the director has approved it (design section 7).
- No "enhanced", "improved" or "fixed" in names. No release tag.

## Review Focus

1. **A reply that could mean more than one decision,** or that answers a decision already answered. Examples: a lone "B" while two decisions wait, or "2 A" after decision 2 was answered. Expected: nothing is recorded, and the director is told which decisions wait, or when and how decision 2 was answered. Tested in Step 1.
2. **Reply-shaped text in a session that isn't the front desk.** For example, a feature or foreman prompt, or a headless `claude -p` prompt, containing "Reply 1 A". Expected: it is never recorded as an answer. Tested in Step 1.
3. **A decision answered with something other than the recommendation.** The pull request was built on the recommendation. Expected: the gate keeps refusing it until the rework is pushed and the session marks the answer as applied. Tested in Step 5.
4. **A change whose visibility the detectors can't judge.** For example, an unknown file kind under the source folder. Expected: it waits for the director, because unsure is the director's (design section 5). Tested in Step 8.
5. **An undo on GitHub or GitLab when later merges conflict with the revert.** Expected: the helper doesn't force anything. It tells the director the undo can't be done in one step, as a decision. Tested in Step 8.

## Order

| Step | Name | Needs | Core cut part it waits on | Can run alongside |
|---|---|---|---|---|
| 1 | Chat-first decisions | none | 1 to 5; part 5 above all | none |
| 2 | The decision line and the decision log | 1 | 7 (parks delegation and its levels) | none |
| 3 | The shape check and sending back | 2 | 5 | 7, 9 |
| 4 | Decision records in the project | 3 | 5 | 6 |
| 5 | Building on the recommendation, with the gate hold | 2 | 3 (resume and wakes), 4 (parks `waiting.js`) | 6 |
| 6 | "Why" by a session copy | 1 | 3 (session ids and resume) | 4, 5 |
| 7 | Proof notes, with the data before-and-after | 2 | 4 (what it keeps of `preview.js` and the lenses) | 3, 9 |
| 8 | Merging by what the change shows, and undo on every host | 2, 5, 7 | 4, 6 (Lean's undo) | none |
| 9 | The daily digest, alerts and the weekly decision log | 2 | 5 (parks the mod's digest and the courier) | 3, 7 |
| 10 | The script's routine moves and the reliability bar | 5 | 3, 4 | none |

Steps 3, 7 and 9 touch separate areas, as the design says, and can run side by side once step 2 has merged.

Step 6 touches only its own files and the session adapter, so it can also run beside 4 and 5. This is an engineering call.

Where two side-by-side steps both edit `scripts/feature/cli.js` or `templates/brief/brief.md`, they edit different commands or sections. The second to merge brings in main first.

**The first to start is step 1,** as soon as core cut parts 1 to 5 have merged. Nothing else can start before it.

---

### Step 1: Chat-first decisions

Design section 6.1. A decision becomes a plain chat message: the First Mate prints it, and the director answers it with a short typed reply. That reply is signed into the record. The question picker is retired for decisions.

**Re-check before starting.** Core cut part 5 makes cards chat-only through `AskUserQuestion` and changes every file in this step. After part 5 has merged, read each file below as it then stands:
- `scripts/hooks/card-check.js`, `prompt-record.js`, `board-context.js` and `chat-question.js`, and `hooks/hooks.json`;
- `skills/front-desk/SKILL.md`, at the lines on the clickable-question tool and "why";
- `scripts/cards/compose.js`;
- `scripts/cards/answered.js`: whether `WHERE` still holds `'panel'`;
- `scripts/state/events.js`: `PROTECTED_KINDS` and how `card-answer` is checked;
- `scripts/desk/views.js` `cardOutcomes`;
- `scripts/state/card-lines.js` `replyCode`.

Also check these:
- Whether core cut part 7 parked `chat-question.js`, `scripts/delegation/asked.js` and `learning.js`. If `chat-question.js` is gone, skip its change below. Nothing in this step may import `asked.js`.
- Which card kinds still accept only a click after the core cut: setup, confirm-all, trust, takeover, uninstall, keep-control, usage, premium and start-goal. `prompt-record.js` `shownFor` lists them.

**Files:**
- Create:
  - `scripts/decisions/message.js`
  - `scripts/decisions/pending.js`
  - `scripts/decisions/reply.js`
  - `scripts/decisions/answer.js`
- Modify:
  - `scripts/cards/compose.js`
  - `scripts/hooks/prompt-record.js`
  - `scripts/hooks/card-check.js`
  - `scripts/hooks/board-context.js`
  - `scripts/state/events.js`
  - `scripts/frontdesk/cli.js`
  - `skills/front-desk/SKILL.md`
  - `hooks/hooks.json`
  - `scripts/hooks/chat-question.js`, if it is still there
- Test:
  - `tests/scripts/decisions/message.test.js`
  - `tests/scripts/decisions/pending.test.js`
  - `tests/scripts/decisions/reply.test.js`
  - `tests/scripts/hooks/prompt-record-reply.test.js`
  - `tests/scripts/hooks/card-check-shown.test.js`
  - `tests/scripts/hooks/board-context-decisions.test.js`

**Interfaces:**
- Consumes:
  - `composeCard(input) -> {question, card}` (compose.js)
  - `sessionRole({sessionId, env, prompt, cwd})` (role.js)
  - `startedAsScript` (`scripts/lib/started-as-script.js`)
  - `makeEvent`, `writeEvent` and `listEvents` (events.js)
  - `sign` and `verify` (signing.js)
  - `replyCode(line)` (card-lines.js)
- Produces:
  - `decisionText(decision) -> string`. The design's section 6.2 shape. Cost and undo lines are printed when present; step 3 makes them required.
  - `pendingDecisions(project) -> Array<{n, question, code, options: [{label, says, cost?, undo?}], recommend, work, raisedAt}>`
  - `decisionNumber(project) -> number`. Numbers count up from 1 within a project, and go back to 1 only once no decision waits.
  - `parseReply(text, pending) -> {kind: 'answer', n, label, words} | {kind: 'why', n, words} | {kind: 'ambiguous', candidates: number[]} | {kind: 'refused', n, reason} | {kind: 'none'}`
  - `recordAnswer({project, sessionId, prompt, at}) -> {recorded: boolean, note?: string}`
  - The signed event kind `decision-answer`, with data `{question, n, label, words, where: 'chat'}`.

- [ ] **Write the failing tests.** In `tests/scripts/decisions/reply.test.js`:
  ```js
  test('a lone letter answers the only waiting decision', () => assert.deepEqual(parseReply('B', one), {kind: 'answer', n: 1, label: 'B', words: ''}));
  test('a lone letter with two waiting is ambiguous', () => assert.deepEqual(parseReply('b', two).candidates, [1, 2]));
  test('"2 c", "2C" and "#2 C" answer decision 2 with C', ...);
  test('"2: weekly, not daily" is decision 2 in the director\'s own words', () => assert.deepEqual(parseReply('2: weekly, not daily', two), {kind: 'answer', n: 2, label: 'own', words: 'weekly, not daily'}));
  test('"B, but keep the old export" is B with words', ...);
  test('a reply code and a letter answer that code\'s decision', ...);
  test('"why" and "why 2 what about cost" ask why', ...);
  test('words with no number or letter are not an answer, even with one waiting', () => assert.equal(parseReply('looks good to me', one).kind, 'none'));
  test('a letter beyond the options is refused', () => assert.equal(parseReply('1 E', one).kind, 'refused'));
  ```
  In `prompt-record-reply.test.js`:
  - `a reply in a front-desk session is signed as decision-answer`: `verify(event)` is true, and the data equals `{question, n: 1, label: 'B', words: '', where: 'chat'}`.
  - `a reply typed in a feature or foreman session is never recorded`
  - `a prompt from a script-started session is never recorded`
  - `a second answer to the same decision is refused and nothing is written`: the note names the first answer and its date.
  - `a decision with no reply still waits after thirty days`

  In `card-check-shown.test.js`:
  - `a Decision needed block equal to decision 1's text passes`
  - `a paraphrased block is sent back with "show decision 1 exactly as printed"`
  - `a Decision needed block with no waiting decision is sent back`

  In `board-context-decisions.test.js`:
  - `each prompt lists the waiting decisions by number and question`
  - `a refused reply's note is shown once`

  In `message.test.js`:
  - `the message has the section 6.2 lines in order`
  - `the recommended option carries "(recommended)"`

  In `pending.test.js`:
  - `numbers count up and restart only when none waits`
- [ ] **Run the tests and see them fail.**
  Run: `node --test --import ./tests/helpers/test-home.js tests/scripts/decisions/*.test.js tests/scripts/hooks/prompt-record-reply.test.js tests/scripts/hooks/card-check-shown.test.js tests/scripts/hooks/board-context-decisions.test.js`
  Expected: FAIL, because the modules aren't defined.
- [ ] **Implement `message.js`, `pending.js` and `reply.js`.**
  - `pending.js` derives the list from the record: a decision is pending when it has been composed and no `decision-answer` is recorded for it.
  - A number is never reused while any decision waits. A late reply to an old number therefore meets "already answered", not a different decision.
- [ ] **Implement `answer.js` `recordAnswer`, and dispatch to it from `prompt-record.js` when `hook_event_name === 'UserPromptSubmit'`.**
  - Return early unless `sessionRole(...) === 'front-desk'` and `!startedAsScript(...)`.
  - Add `decision-answer` to `PROTECTED_KINDS`.
  - A second answer returns `{recorded: false, note}` and writes nothing.
  - An ambiguous or refused reply returns a note, which `board-context.js` passes to the First Mate as additional context.
- [ ] **Move `card-check.js` to a Stop hook for decisions.** Add `checkShown(lastMessage, pending) -> {ok} | {ok: false, reason}`. Every `Decision needed:` block in the First Mate's last message must equal one pending decision's `decisionText` exactly. Otherwise the Stop hook blocks with the reason.
- [ ] **Add `decision list` and `decision show <n>` to `scripts/frontdesk/cli.js`.** `show` prints `decisionText` for the First Mate to copy exactly.
- [ ] **Update the front-desk SKILL.**
  - Decisions are shown with `decision show`, copied exactly.
  - The First Mate never types a reply on the director's behalf.
  - Unaddressed words don't answer a decision. If the director seems to be answering, the First Mate says: "To answer decision 1 in your own words, start with '1:'".
- [ ] **Update `hooks/hooks.json`.**
  - Add `prompt-record.js` to `UserPromptSubmit`, before `board-context.js`.
  - Add `card-check.js` to `Stop`.
  - Keep the `AskUserQuestion` matchers only for the click-only card kinds (see "Kept as the director ruled").
  - In `chat-question.js`, if it still exists, count a turn as asking when it shows a pending decision block rather than when it calls `AskUserQuestion`.
- [ ] **Run the tests again and see them pass,** together with the existing `tests/scripts/hooks/prompt-record*.test.js`, `card-check*.test.js` and `board-context*.test.js`.
- [ ] **Commit:** `git commit -m "Ask decisions as chat messages and record the director's typed reply"`.

### Step 2: The decision line and the decision log

Design section 5. Algorithms, public interfaces, major dependencies, rewrites, data migration and deletion become director-level. Every call an agent makes on its own side becomes one line in the piece's log, and the director can pull a call back.

**Re-check before starting:**
- What core cut part 7 left of the levels: `compose.js` level checks, the level check in `events.js`, and the level wording in the brief.
- `scripts/gate/guardrails.js` `classifyChange`, `DEFAULT_HOT_FILES` and `readConfig`.
- `scripts/feature/status.js` `captureRulings`. Calls are captured the same way.
- Where project rulings are written today. Grep for the `ruling` event kind.

**Files:**
- Create:
  - `scripts/decisions/line.js`
  - `scripts/decisions/log.js`
- Modify:
  - `scripts/gate/guardrails.js`
  - `scripts/feature/files.js`, so `featurePaths` gains `decisions`, at `.wheelhouse/feature/decisions.jsonl`
  - `scripts/feature/cli.js`: a new `log` command, and `ask --about <kind>`
  - `scripts/feature/status.js`, to capture calls into the record
  - `scripts/cards/compose.js`, so a director kind forces level 3 or above
  - `scripts/frontdesk/cli.js`: a new `pull-back` command
  - `templates/brief/brief.md`
- Test:
  - `tests/scripts/decisions/line.test.js`
  - `tests/scripts/gate/guardrails-director.test.js`
  - `tests/scripts/feature/cli-log.test.js`
  - `tests/scripts/feature/status-calls.test.js`
  - `tests/scripts/frontdesk/pull-back.test.js`

**Interfaces:**
- Produces:
  - `DIRECTOR_KINDS = ['behaviour', 'algorithm', 'cost', 'data-model', 'security', 'public-interface', 'major-dependency', 'deletion', 'rewrite']`
  - `AGENT_KINDS = ['structure', 'bug-fix', 'tests', 'performance', 'minor-dependency', 'library-in-stack', 'tooling']`
  - `sideOf(kind) -> 'director' | 'agent'`. An unknown kind is `'director'`.
  - `classifyDiff({paths, read}) -> {...classifyChange, directorLevel: Array<{kind, paths}>}`. Here `read(path, 'base' | 'head') -> string | null`.
  - `readLog(worktree) -> Array<{v, at, decided, options, why, kind}>`
  - `projectCalls(project, {since}) -> Array<{work, at, decided, options, why, kind}>`, read from the record's `agent-call` events.
  - The feature command `log --decided "<what>" --option "<a>" --option "<b>" --why "<why>" --kind <agent kind>`.
  - The front-desk command `pull-back <call-id> [--change]`. It writes a ruling; with `--change` it also opens an intake request.

- [ ] **Write the failing tests:**
  - `an unknown kind is the director's`
  - `a new runtime dependency in package.json is major-dependency`
  - `a major version bump is major-dependency; a minor or patch bump is not`
  - `pyproject.toml, requirements.txt, go.mod, Cargo.toml and Gemfile are read the same way`
  - `a file under migrations/ or a schema.prisma change is data-model`
  - `an openapi file or a changed command-line option file is public-interface`
  - `log appends one line with the time`
  - `log refuses a director kind and says to ask instead`
  - `ask --about algorithm refuses a level below 3`
  - `calls reach the record once, not again on the next status pass`
  - `pull-back writes a ruling naming the call`
  - `pull-back --change also files an intake request in the director's words`
- [ ] **Run them and see them fail.**
- [ ] **Implement `line.js` and `classifyDiff` in `guardrails.js`.** `classifyDiff` is new, alongside `classifyChange`, which stays as it is. Dependency detection compares the base and head manifests.
- [ ] **Implement `log`, `ask --about` and `captureCalls`.**
  - `captureCalls` sits beside `captureRulings` and writes unsigned `agent-call` events.
  - Calls go into the record because the worktree is removed after merge.
- [ ] **Implement `pull-back`.**
- [ ] **Add "The decision line" to `brief.md`.**
  - The section 5 table, in short.
  - "When unsure, it is the director's: ask."
  - "Log every call you make on your own side with `{{cli}} log`."
- [ ] **Run the tests and see them pass.** Also run `tests/scripts/gate/guardrails*.test.js` and `tests/scripts/feature/cli*.test.js`.
- [ ] **Commit:** `git commit -m "Widen the decision line and log the agents' own calls"`.

### Step 3: The shape check and sending back

Design section 6.2.
- Each option says what it costs and whether it can be undone.
- A decision that fails the shape goes back to the agent that raised it, not to the director.
- After three failures in a row, the agent sends one plain "stuck" message.

**Re-check before starting:**
- Where today's "stop this work" card is made from a badly formed card. Grep `questionProblem` callers in `scripts/foreman/act.js` and `card-check.js`.
- `compose.js` `isTooLong`.
- `scripts/feature/cli.js` `ask` after step 2.

**Files:**
- Modify:
  - `scripts/cards/compose.js`
  - `scripts/hooks/card-check.js`
  - `scripts/feature/cli.js` (`ask`, plus a new `stuck` command)
  - `scripts/foreman/act.js` (the `act question` path)
  - `templates/brief/brief.md`, in "How to ask the director"
- Test:
  - `tests/scripts/cards/compose-shape.test.js`
  - `tests/scripts/feature/cli-ask-shape.test.js`
  - `tests/scripts/foreman/act-send-back.test.js`

**Interfaces:**
- Produces:
  - `shapeProblems(input) -> string[]`. It is empty when the shape passes, and `card-check.js` shares it.
  - `PHONE_LIMIT = {chars: 1400, lines: 18}`
  - New `ask` flags: `--cost "<label>=<cost>"`, `--undo "<label>=yes|no|partly"`, `--holds "<what waits>"` and `--meanwhile "<what you go on with>"`.
  - `{{cli}} stuck --why "<what keeps failing>"`, which writes a `stuck` event that `board-context` shows as a plain message.
  - Send-back: `ask` exits with code 2 and prints one problem per line. `act question` returns the problems to the raising session's next wake.

- [ ] **Write the failing tests:**
  - `an option with no cost is sent back, naming the option`
  - `an option with no undo answer is sent back`
  - `one option, or five, is sent back`
  - `no recommendation, or a recommendation with no reason, is sent back`
  - `a message over 1400 characters or 18 lines is sent back with its length`
  - `the director never sees a failing decision`: the pending list is unchanged after a failing `ask`.
  - `the third failure in a row tells the agent to send a stuck message`
  - `a passing ask resets the count`
  - `act question returns the problems to the session instead of making a stop-this-work card`
- [ ] **Run them and see them fail.**
- [ ] **Implement `shapeProblems`.**
  - Add `cost` and `undo` to each option, plus `holds`.
  - Remove the "stop this work" card path for bad shapes.
  - Count failures per piece in `questions.jsonl`.
- [ ] **Update the brief's "How to ask the director"** with the new flags and the sending-back rule.
- [ ] **Run the tests and see them pass.** Also run `tests/scripts/cards/compose*.test.js` and `tests/scripts/hooks/card-check*.test.js`.
- [ ] **Commit:** `git commit -m "Send a badly shaped decision back to the agent that raised it"`.

### Step 4: Decision records in the project

Design section 6.6.
- Every answered decision becomes a short file under `docs/decisions/` in the project.
- A decision about a piece is committed on that piece's branch.
- A decision with no piece, or whose piece was dropped, goes into one batched change a day that touches only `docs/decisions/`.
- A signed copy stays in the private record. Step 1 already writes it.

**Re-check before starting:**
- `scripts/feature/cli.js` `answer` after steps 1 and 3.
- The helper's `/pr/open` route and `openPr` on each host adapter.
- How the adapter can tell whether a repository is public. GitHub `visibility`; GitLab `visibility`; a local home is always private.

**Files:**
- Create:
  - `scripts/decisions/record-file.js`
  - `scripts/decisions/batch.js`
- Modify:
  - `scripts/feature/cli.js` (`answer`)
  - `scripts/decisions/message.js` and `reply.js` (the "private" line and reply)
  - `scripts/host/adapter.js` (`isPublic`)
  - `scripts/gate/conditions.js` (the decisions-only rule)
  - `scripts/watcher/main.js` (the daily batch on its tick)
- Test:
  - `tests/scripts/decisions/record-file.test.js`
  - `tests/scripts/decisions/batch.test.js`
  - `tests/scripts/feature/cli-answer-record.test.js`
  - `tests/scripts/gate/decisions-only.test.js`

**Interfaces:**
- Produces:
  - `recordFile(decision, answer) -> {path, text}`. The path is `docs/decisions/<yyyy-mm-dd>-<slug>.md`. The slug comes from the question, is at most 50 characters, and gets `-2`, `-3` and so on on a collision.
  - `batchChange(project, decisions, {date}) -> {branch: 'wheelhouse/decisions-<yyyy-mm-dd>', files}`
  - `decisionsOnly(paths) -> boolean`
  - `parseReply` accepts a trailing `private`, for example `2 B private`.
- The record file's text is fixed:
  ```
  <!-- docs/decisions/<file>.md -->
  # <the question>

  - **Date:** <d Month yyyy>
  - **Piece:** <work, or "none">
  - **Options:** A. <says> (<cost>; <can or can't be undone>) · B. … · C. …
  - **Recommended:** <label>
  - **Chosen:** <label, or "own words">
  - **The director's words:** "<words>", or "none"
  ```

- [ ] **Write the failing tests:**
  - `the record file has the fixed format with the path comment`
  - `two decisions with the same question on one day get -2`
  - `a private reply writes no file and keeps the signed record`
  - `the private line shows only on a public project's decision`
  - `answer writes and commits the record on the piece's branch`
  - `a dropped piece's decision goes into the day's batch`
  - `the batch touches only docs/decisions/`
  - `the gate lets a decisions-only change merge with no approval and refuses one that touches anything else`
- [ ] **Run them and see them fail.**
- [ ] **Implement it.**
  - `answer` writes the record file and commits it itself with `git commit -- <path>`.
  - The watcher's first tick after local midnight batches the previous day's pieceless decisions.
  - The decisions-only rule in `conditions.js` is narrow. Step 8 adds the general rule for internal-only work.
- [ ] **Run the tests and see them pass.** Also run `tests/scripts/gate/*.test.js` and `tests/scripts/host/adapter.test.js`.
- [ ] **Commit:** `git commit -m "Keep each answered decision as a file in the project"`.

### Step 5: Building on the recommendation, with the gate hold

Design section 6.4. A piece that has asked keeps working:
- It builds on its recommendation, kept easy to change.
- It does the parts that don't depend on the answer.
- It stops only before a step that can't be undone.
- The gate refuses to merge it until the decision is answered and applied.
- A waiting piece keeps its slot unless it has truly stopped.

**Re-check before starting:**
- Core cut part 3: how a session is woken after an answer.
- Core cut part 4: that `scripts/engine/waiting.js` is parked and nothing here calls it.
- `scripts/host/helper.js` `doMerge`, and how it uses `questionHold` from `open-questions.js`.
- `scripts/feature/status.js`: where the phase is set to `waiting`.
- `scripts/foreman/queue.js` `nextWork`: how slots are counted.
- `templates/brief/override.md` rule 3.
- `scripts/hooks/report-check.js`.

**Files:**
- Modify:
  - `templates/brief/brief.md` ("How to ask the director")
  - `templates/brief/override.md` (rule 3)
  - `scripts/feature/cli.js` (`ask` no longer pauses; a new `wait-for`; `answer` marks a decision applied)
  - `scripts/feature/status.js`
  - `scripts/foreman/queue.js`
  - `scripts/state/open-questions.js` (`questionHold` covers decisions)
  - `scripts/gate/conditions.js`
  - `scripts/host/helper.js` (mark the pull request as waiting)
  - `scripts/hooks/report-check.js`
- Test:
  - `tests/scripts/gate/decision-hold.test.js`
  - `tests/scripts/feature/status-waiting.test.js`
  - `tests/scripts/foreman/queue-slots.test.js`
  - `tests/scripts/hooks/report-check-rework.test.js`
  - `tests/scripts/feature/brief-asking.test.js`

**Interfaces:**
- Produces:
  - A new `gateDecision` reason, `'waiting-on-decision'`, given while any decision on the piece is unanswered, or answered but not yet applied.
  - The helper sets the commit status `wheelhouse/decision` to pending, with the description "Waiting on decision <n>", using `adapter.setStatus`. The local queue keeps the same hold.
  - `{{cli}} wait-for <questionId>`: the piece has reached a step that can't be undone and has nothing else to do. Only this sets the `waiting` phase and frees the slot.
  - The report json gains `rework: {question, chose, recommended, cost}`, which is required when the answer differs from the recommendation.

- [ ] **Write the failing tests:**
  - `a pull request with an unanswered decision is refused with waiting-on-decision`
  - `answered with another option but not yet applied is still refused`
  - `answered and applied is allowed`
  - `answered with the recommendation and --no-change is allowed`
  - `asking does not set the waiting phase`
  - `wait-for sets waiting and frees the slot`
  - `a piece that asked keeps its slot`
  - `a report after a different answer must say what the rework cost`
  - `the brief tells the session to build on its recommendation and stop only before migrating real data, deleting, spending money or going live`
- [ ] **Run them and see them fail.**
- [ ] **Implement it.** Rewrite the brief's asking rules and override rule 3 from the four points of design section 6.4, using the design's own words for the four irreversible steps.
- [ ] **Run the tests and see them pass.** Also run `tests/scripts/host/helper-*.test.js`, `tests/scripts/host/local/queue.test.js` and `tests/scripts/feature/*.test.js`.
- [ ] **Commit:** `git commit -m "Keep building on the recommendation while a decision waits, and hold the merge"`.

### Step 6: "Why" by a session copy

Design section 6.3.
- The glossary's answer stays as the instant first answer.
- When the director wants more, a read-only fork of the session that raised the decision answers in the chat. The director can ask follow-ups.

**Re-check before starting:**
- Core cut part 3: `sessionFile(work)` in `scripts/watcher/waker.js`. It is the store for `{sessionId, worktree, at}`.
- `adapters/claude-code/sessions.js` `featureCall`, `featureResumeCall` and `invocation` (claude.js).
- `scripts/lib/role.js` `ROLES` and `ROLE_VARIABLE`.
- `scripts/hooks/tool-guard.js`: how it reads the role.
- `scripts/frontdesk/cli.js` `why()` and `desk/views.js` `whyNext`.

**Files:**
- Create: `scripts/decisions/why.js`
- Modify:
  - `adapters/claude-code/sessions.js` (`whyCall`)
  - `scripts/lib/role.js` (add the role `'why'`)
  - `scripts/hooks/tool-guard.js`
  - `scripts/frontdesk/cli.js` (`why <n> [words]`)
  - `skills/front-desk/SKILL.md`
- Test:
  - `tests/scripts/decisions/why.test.js`
  - `tests/adapters/claude-sessions-why.test.js`. Put it beside `claude-sessions.test.js`, wherever that lives after the core cut.
  - `tests/scripts/hooks/tool-guard-why.test.js`

**Interfaces:**
- Produces:
  - `whyCall({sessionId, worktree, question}) -> {command, args, cwd, env}`. Its args include `-p`, `--resume <sessionId>`, `--fork-session`, `--permission-mode plan`, `--allowedTools Read,Grep,Glob` and `--output-format json`. Its env sets the role variable to `why`.
  - `askWhy({project, n, words, run, now}) -> {answer: string, fork: string} | {fallback: string}`
  - The fork's own session id is kept at `wheelhouseHome()/why/<project>-<n>.json`. A follow-up resumes the fork, never the building session.

- [ ] **Write the failing tests:**
  - `whyCall forks the session and never resumes the building one directly`
  - `whyCall allows only read-only tools`
  - `tool-guard refuses Edit, Write, MultiEdit, NotebookEdit and Bash in a why session`
  - `a follow-up resumes the fork`
  - `a finished piece falls back to the glossary and its decision log`
  - `why never records an answer`: no `decision-answer` is written.
  - `a why run past three minutes stops and says so`
- [ ] **Run them and see them fail.**
- [ ] **Implement it.**
  - `why <n>` prints `whyNext`'s instant answer first, then the fork's answer.
  - The answer is trimmed to the phone limit from step 3; until step 3 lands, use 1400 characters.
- [ ] **Run the tests and see them pass,** with the existing `claude-sessions` and `tool-guard` tests.
- [ ] **Commit:** `git commit -m "Answer why from a read-only copy of the session that asked"`.

### Step 7: Proof notes, with the data before-and-after

Design section 7. A finished piece reaches the director as a proof note. It says:
- what changed, in product terms;
- what it decided on its own, and which decisions it followed;
- how it was checked;
- what it looks like;
- for data work, a before-and-after of the data.

The pull request's body becomes the note.

**Re-check before starting:**
- Core cut part 4: whether `scripts/engine/preview.js` and `lenses.js` stay. They aren't under `scripts/engine/archon/`, but part 4 may park them.
  - If `preview.js` is parked, move it and its tests to `scripts/proof/preview.js` unchanged, and say so in the pull request.
  - If it is deleted outright, ask the main session before rebuilding it.
  - If the lenses are gone, the note lists what the Lookout's signed review recorded.
- `scripts/feature/cli.js` `openPr` and `inspect`; `feature/files.js` `parseReport`; `report-check.js` `decide`; `REPORT_WORDS` in `scripts/lib/build-loop.js`.
- `scripts/frontdesk/cli.js` `preview()` ("Show me").

**Files:**
- Create:
  - `scripts/proof/note.js`
  - `scripts/proof/data.js`
- Modify:
  - `scripts/feature/cli.js` (`open-pr` writes the note)
  - `scripts/feature/files.js` (the report's `followed` and `data`)
  - `scripts/hooks/report-check.js`
  - `scripts/host/helper.js` (runs the real-data route)
  - `templates/brief/brief.md` ("How to finish")
- Test:
  - `tests/scripts/proof/note.test.js`
  - `tests/scripts/proof/data.test.js`
  - `tests/scripts/feature/cli-open-pr-note.test.js`
  - `tests/scripts/host/helper-data-route.test.js`

**Interfaces:**
- Consumes: `readLog(worktree)` from step 2.
- Produces:
  - `proofNote({report, calls, followed, review, previews, data}) -> string`. Its headings, in this order:
    1. What changed
    2. Why
    3. Decided on its own
    4. Decisions followed
    5. How it was checked
    6. What it looks like
    7. The data, before and after (only for data work, and it ends with "On test data." or "On a read-only sample of real data.")
  - `dataSnapshot({command, cwd, env}) -> {tables: [{name, rows, sample: [{key, values}]}]}`. The project's command prints this JSON.
  - `compareSnapshots(before, after, {expect}) -> {counts: [{table, before, after}], changed: [{table, key, column, before, after}], unexpected: string[]}`. A table outside `expect`, or one that moved where no change was expected, is unexpected.
  - The project's config gains `dataCheck: {command, route: 'test' | 'real'}`. The `real` route runs only through the helper, with the read-only credential the director set up, and only once a signed `data-route-approved` event exists for the project.

- [ ] **Write the failing tests:**
  - `the note has the headings in order and stays within the report's word limit`
  - `a note with no data work has no data section`
  - `with no approved route the data runs on test data and the note says so`
  - `the real route is refused without a signed approval`
  - `the real route runs only the approved command, through the helper`
  - `counts, changed values and unexpected moves are reported`
  - `open-pr makes the note the pull request body`
  - `report-check refuses data work with no data comparison and no reason`
- [ ] **Run them and see them fail.**
- [ ] **Implement it.**
  - Previews are taken after `open-pr` when `touchedPages` finds pages, and stay in Wheelhouse's record. The note names them, and "Show me" opens them.
  - The project's data command is run at the base commit and at the head.
- [ ] **Run the tests and see them pass,** with `tests/scripts/feature/*.test.js` and `tests/scripts/hooks/report-check*.test.js`.
- [ ] **Commit:** `git commit -m "Write a proof note for the director, with the data before and after"`.

### Step 8: Merging by what the change shows, and undo on every host

Design section 8.
- Internal-only work merges itself once checks pass and the reviewer finds nothing blocking.
- Visible or director-level work waits with its proof note.
- The gate judges visibility from the change itself, as well as from intake.
- Undo is one reply on every host.

**Re-check before starting:**
- `scripts/gate/conditions.js` `gateDecision`.
- `scripts/host/helper.js` `doMerge`, especially the `approvalRequired` line, `shownFirstNeeded` and `pinsOnly`.
- `doLocalUndo` and the `/local/undo` route.
- `scripts/host/local/merge.js` `revertOnHome` and `scripts/lib/local-git.js` `revertOn`.
- Whether core cut part 6 parked `scripts/lean/store.js` `undoMerge`. If it did, leave it alone.
- `frontdesk/cli.js` `undo`.
- `skills/intake/SKILL.md`'s visibility lines.
- `foreman/queue.js` `STARTS_UNAPPROVED`.

**Files:**
- Create:
  - `scripts/gate/visible.js`
  - `scripts/host/undo.js`
- Modify:
  - `scripts/gate/conditions.js`
  - `scripts/host/helper.js` (`doMerge`, plus a new `/undo` route that serves every host; `/local/undo` keeps working and calls it)
  - `scripts/host/helper-client.js`
  - `scripts/frontdesk/cli.js` (`undo`)
  - `skills/front-desk/SKILL.md`
- Test:
  - `tests/scripts/gate/visible.test.js`
  - `tests/scripts/gate/self-merge.test.js`
  - `tests/scripts/host/undo.test.js`, against the fake GitHub and GitLab adapters and a local home

**Interfaces:**
- Consumes:
  - `classifyDiff` (step 2)
  - the `'waiting-on-decision'` reason (step 5)
  - `proofNote` (step 7)
- Produces:
  - `visibleFromChange({paths, diff, config}) -> {visible: boolean, unsure: boolean, reasons: string[]}`
    - Path detectors look for pages, components, templates, styles, locales, command-line entry points, flags, settings and API routes.
    - A text detector looks for changed string literals in code outside the tests.
    - A file the detectors don't know, in the project's source, is `unsure`.
    - Projects can add paths under `visibility.paths` in their config.
  - `selfMergeDecision(input) -> {allow, reasons}`. It allows only when all of these hold:
    - the checks are green;
    - the signed review is CLEAN;
    - `visible === false && unsure === false`;
    - there is no `directorLevel`;
    - no decision is open;
    - intake didn't mark the work visible.
  - The `self-merged` event, for the digest.
  - `undoOnHost({adapter, git, merge, approval}) -> {ok: true, pr} | {ok: false, reason: 'conflict' | 'not-merged'}`
    - It makes a branch from the default branch's head, runs `git revert -m 1 <merge>`, pushes, opens the pull request and merges it through `doMerge`.
    - The director's undo reply is the signed approval.

- [ ] **Write the failing tests:**
  - `a page or template change is visible`
  - `a test-only change is not visible`
  - `a changed string literal in source is visible`
  - `an unknown file kind in source is unsure and waits`
  - `a config path override is honoured`
  - `internal-only work merges itself and records self-merged`
  - `visible or unsure work waits for approval with its proof note`
  - `work intake marked visible waits even if the change looks internal`
  - `director-level facts make it wait`
  - `undo on GitHub opens a revert and merges it through the gate`
  - `undo on GitLab does the same`
  - `undo on a local home still works`
  - `a conflicting revert forces nothing and becomes a decision`
  - `an undo of an undo works`
- [ ] **Run them and see them fail.**
- [ ] **Implement it.** In `doMerge`, `approvalRequired` also turns on when `visibleFromChange` says visible or unsure, or when `classifyDiff` finds director-level kinds. `selfMergeDecision` replaces step 4's narrow decisions-only rule, which becomes one case of it.
- [ ] **Run the tests and see them pass,** with `tests/scripts/gate/*`, `tests/scripts/host/helper-*.test.js`, `host-approval.test.js`, `tests/scripts/host/local/*.test.js` and `hooks/policy-click.test.js`.
- [ ] **Commit:** `git commit -m "Merge internal work by itself and undo merges on every host"`.

### Step 9: The daily digest, alerts and the weekly decision log

Design section 9.
- The decisions and the digest wait in the chat and show at the director's next message.
- A phone alert says only that something waits and where.
- Once a week, the digest also carries the decision log.

**Re-check before starting:**
- Core cut part 5 parks the mod's digest (`scripts/mod/digest.js`) and the courier. Take nothing from them.
- `scripts/hooks/board-context.js` `decide` and the briefing: `briefing/model.js` `briefingModel`, `text.js` and `seen.js` `weeklyDue`.
- `scripts/settings/catalogue.js` `notifications` and `CHANNELS`.
- How the helper stores host tokens. The alert token is stored the same way.
- `scripts/watcher/main.js`'s tick.

**Files:**
- Create:
  - `scripts/digest/model.js`
  - `scripts/digest/due.js`
  - `scripts/alerts/send.js`
- Modify:
  - `scripts/hooks/board-context.js`
  - `scripts/briefing/seen.js`
  - `scripts/settings/catalogue.js` (a new `digestAt` setting)
  - `scripts/host/helper.js` (an `/alert` route and the alert token)
  - `scripts/watcher/main.js`
  - `scripts/frontdesk/cli.js` (`alerts ntfy <topic>` and `alerts telegram`; the Telegram token is read by the helper from the director's own terminal)
- Test:
  - `tests/scripts/digest/model.test.js`
  - `tests/scripts/digest/due.test.js`
  - `tests/scripts/alerts/send.test.js`
  - `tests/scripts/hooks/board-context-digest.test.js`

**Interfaces:**
- Consumes:
  - `projectCalls` (step 2)
  - `pendingDecisions` (step 1)
  - `self-merged` events (step 8; the list is empty until step 8 lands)
- Produces:
  - `digestModel({events, calls, pending, usage, now, weekly}) -> {selfMerged, waitingApproval, waitingDecisions: [{n, question, meanwhile, work}], usage, calls?}`
  - `digestText(model) -> string`
  - `digestDue({seen, now, at}) -> boolean`. It is due once a day after `digestAt`, which defaults to `'17:00'` local time. The weekly log is added on the first digest seven or more days after the last.
  - `alertText({count, project}) -> '1 decision waits in <project>' | '<n> decisions wait in <project>'`
  - `sendAlert({channel, settings, text, fetch}) -> {sent: boolean, reason?}`
    - ntfy: `POST <server>/<topic>` with the text as the body, and no click, attach or actions headers.
    - Telegram: `sendMessage` with `disable_web_page_preview: true`.

- [ ] **Write the failing tests:**
  - `the digest lists self-merged, waiting for approval, waiting on decisions with what each did meanwhile, and usage`
  - `the weekly decision log appears once a week`
  - `the digest shows once, at the director's next message`
  - `an alert holds only a count and the project's name`: it matches `/^\d+ decisions? waits? in \S+$/u` and holds no URL.
  - `one alert per newly waiting decision, never for progress`
  - `quiet hours hold an alert until they end`
  - `a channel that fails is tried once more, then noted in the digest`
  - `no alert is sent when no channel is set up, and the decision still waits in the chat`
- [ ] **Run them and see them fail.**
- [ ] **Implement it.**
  - The watcher's tick checks `digestDue` and newly waiting decisions.
  - The helper alone holds the ntfy topic and the Telegram token, and sends.
- [ ] **Run the tests and see them pass,** with `tests/scripts/briefing/*`, `tests/scripts/hooks/board-context*.test.js` and `tests/scripts/settings/*`.
- [ ] **Commit:** `git commit -m "Add the daily digest, content-free alerts and the weekly decision log"`.

### Step 10: The script's routine moves and the reliability bar

Design section 10.
- A script makes the routine moves: start the next piece, wake a session after an answer, notice a finished or stuck piece, and open the gate.
- The foreman model wakes only for judgement.
- `pace` is applied.
- Lost, stalled and crash-resumed pieces are recorded.
- More than three in a month triggers the look at Archon early.

**Re-check before starting:**
- Core cut part 3's crash resume: where it counts resumes, and its card for three deaths.
- What core cut part 4 left of `scripts/foreman/wake.js`, `act.js` and `queue.js`, and the `Next: act …` lines.
- `scripts/watcher/core.js` wake types; `stuck-cards.js`; `recover.js`.
- `paceOf` in `scripts/lib/build-loop.js`. The own engine's `queue.js` and `wake.js` still use the constant `PACE.building`. Wire `paceOf` in.

**Files:**
- Create:
  - `scripts/watcher/routine.js`
  - `scripts/watcher/reliability.js`
- Modify:
  - `scripts/watcher/core.js`
  - `scripts/watcher/main.js`
  - `scripts/foreman/queue.js`
  - `scripts/foreman/wake.js`
  - `scripts/watcher/stuck-cards.js`
  - `scripts/watcher/recover.js`
  - the crash-resume module that part 3 adds
  - `skills/foreman/SKILL.md`
- Test:
  - `tests/scripts/watcher/routine.test.js`
  - `tests/scripts/watcher/reliability.test.js`
  - `tests/scripts/foreman/queue-pace.test.js`

**Interfaces:**
- Produces:
  - `routineMoves(state) -> Array<{act, args}>`. The watcher runs them by calling `act.js`'s functions directly.
  - `JUDGEMENT = ['ambiguous-report', 'stuck', 'unknown']`. These are the only reasons the foreman model is woken.
  - `recordIncident({kind: 'lost' | 'stalled' | 'resumed', project, work, at})` appends to `wheelhouseHome()/reliability.jsonl`, across projects.
  - `overBar(lines, now) -> boolean`. It is true when more than 3 incidents fall in the last 30 days.
  - When over the bar, one notice per 30 days goes to the director: "Engine trouble: look at Archon early?" This is a decision in the section 6.2 shape.

- [ ] **Write the failing tests:**
  - `a free slot starts the next piece with no foreman wake`
  - `an answer wakes its session with no foreman wake`
  - `a finished piece opens the gate with no foreman wake`
  - `an ambiguous report wakes the foreman`
  - `pace 3 keeps at most three pieces building`
  - `pace 1 keeps one`
  - `each lost, stalled or resumed piece is recorded once`
  - `a fourth incident in 30 days raises one notice`
  - `a fifth in the same 30 days raises none`
  - `incidents older than 30 days don't count`
- [ ] **Run them and see them fail.**
- [ ] **Implement it.**
  - The Superpowers loop inside the feature session is untouched.
  - The routine is rebuilt small in the watcher. Nothing is restored from Archon's dispatcher.
- [ ] **Run the tests and see them pass,** with `tests/scripts/watcher/*` and `tests/scripts/foreman/*`.
- [ ] **Commit:** `git commit -m "Make routine moves by script and record the engine's reliability"`.

---

## Engineering calls

These are the builder's calls (design section 13, and gaps the design leaves). Each is made here.

- **Matching a reply to its decision** (design section 13):
  - Each waiting decision gets a short number, and its reply code still works.
  - A lone letter counts only when one decision waits.
  - The director's own words count only when addressed, for example "2: …". An unaddressed message is never taken as an answer.
- **Where the reply is captured:** `prompt-record.js` on `UserPromptSubmit`. It works only in a `front-desk` session that wasn't started by a script, because a headless session's prompt is a script's words. Replies are signed with the existing Ed25519 signing as a new protected kind.
- **How a shown decision is checked:** the First Mate prints `decision show <n>` and copies it. A Stop hook (`card-check.js`) sends back any `Decision needed:` block that isn't an exact copy of a pending decision.
- **Keeping the "why" copy read-only** (design section 13). This uses four guards together:
  - `--fork-session`;
  - `--permission-mode plan`;
  - read-only `--allowedTools`;
  - a `why` role that `tool-guard` enforces.
- **The phone-screen limit:** 1400 characters and 18 lines.
- **A three-month limit:** none. Silence never answers, so no decision expires.
- **Where decision records reach the repository:** the feature command `answer` writes and commits the record file itself. The daily batch runs on the watcher's first tick after local midnight.
- **Judging "users see it" from a change** (design section 13). Path and text detectors start from the guardrail facts, and unsure waits. The gate also gains `classifyDiff` for dependency and data-model facts. The design assumes these exist; today `guardrails.js` is path-based only.
- **Undo on hosts:** the helper reverts with git and opens a pull request. No host API is needed beyond `openPr` and `merge`, so the adapter contract doesn't change. The undo reply is the revert's signed approval.
- **The data before-and-after** (design section 13):
  - Each project names one read-only command that prints table counts and samples as JSON. It is run at the base commit and at the head.
  - The real route runs only through the helper, after a signed approval made once.
- **The digest's layout** (design section 13):
  - Four sections, in the order of design section 9: merged by itself, waiting for approval, waiting on decisions (with what each piece did meanwhile), and usage.
  - The weekly log comes last.
  - It runs from the watcher's tick at `digestAt` (default 17:00). There is no cron.
- **Alerts:** the helper alone holds the ntfy topic and the Telegram token. An alert is sent once per newly waiting decision, retried once, and a failure is noted in the digest.
- **"A month" in the reliability bar** is a rolling 30 days, counted across all of the director's projects.
- **The switch or seam per project** (design section 13) is left to each feature session. Its `--meanwhile` line and proof note say which it used.

## Kept as the director ruled

- **Click-only cards:** setup, trust, takeover, uninstall, keep-control, usage, premium and start-goal (rulings R36, R80, R90, P7-31). Today only a click answers them, never a typed reply code.
  - The design doesn't name them, and changing them would be a security call on the director's side of the line. So this plan leaves them as they are: they stay on the question picker, with `card-check` and `prompt-record` around them as the core cut leaves them. Buttons stay an extra for every other decision (design section 6.1).
  - Moving them to chat would be a decision for the director, in its own piece. Nothing in this plan waits on it.
