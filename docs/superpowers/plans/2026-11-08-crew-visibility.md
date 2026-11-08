<!-- docs/superpowers/plans/2026-11-08-crew-visibility.md -->

# Crew Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the director choose, per piece as they start it, how much of its crew they see (background, steps, transcript), with a project default `watchCrew`, and take the helm of one piece: open its own session in a terminal on this computer, talk to it, and hand it back, with what they say there recorded for the First Mate.

**Architecture:** A read-only script (`scripts/crew/runs.js`) finds a run's transcript on disk by session id, turns its tail into plain step lines, and writes a Markdown page on request; the Logbook asks it only for pieces at `steps` or above. The helm is a hold file in the watcher's folder (`helm/<work>.json`) that one gate, `helmHeld(project, work)`, makes every start, wake, resume, routine move and Bosun `act` respect; `scripts/crew/helm.js` takes, opens (through the adapter's interactive `featureHelmCall`) and hands back, and a `SessionEnd` hook ends the hold. Nothing changes how the watcher runs sessions.

**Tech Stack:** Node.js ES modules (as the rest of `scripts/`), `node:test`, `node:fs`. No new dependencies.

**Spec:** `docs/specs/2026-11-08-crew-visibility-design.md` (section numbers below are the spec's). Each task names the sections its implementer reads.

## Global Constraints

- **Path comment.** Every file starts with a comment giving its repository-relative path (`// scripts/crew/runs.js`), straight after any front matter. JSON is exempt.
- **Language.** British or Australian English. Dates as day month year. Never use "enhanced", "improved" or "fixed" in names, comments or user-facing text. Refer to the director as "the director", with they/them.
- **No attribution.** Commits, pull requests and comments carry no model identifiers and no AI attribution (no `Co-Authored-By`, no "Generated with").
- **Scripts and hooks are Node.js**, and run on macOS and Windows: paths through `path.join`, no shell strings.
- **Watching costs no model tokens and pushes nothing** (section 3, 6.3): no alert, digest line, desk change or message is produced because a step happened.
- **Transcripts stay on this computer** (section 8.1 rule 5): no transcript text goes to records, the repository, the digest, an alert, a remote or a model's context. The chat gets at most one line per page.
- **Read-only** (rule 2): transcripts are opened read-only; links and anything not a plain file are refused; the only file `runs.js` writes is its own page under `.wheelhouse/watch/`.
- **Off means off** (rule 6): for a piece at `off`, no transcript is opened.
- **One gate.** Every path that starts, wakes, resumes, pauses, merges or moves a piece asks `helmHeld(project, work)`; nothing re-implements the check.
- **`#400` seams.** Changes to `scripts/lib/role.js` and `scripts/hooks/session-start.js` stay small and in their own clearly separated block; every PR body lists any change to those two files, because the one-First-Mate build will add an `aside` role and change `session-start.js`.
- **Out of bounds.** Never touch `probes/haiku-trial/` or `tests/probes/haiku-trial/`.
- **Tests.** Run only the test files a task touches; CI runs the full suite.

## Parts and branches

One branch and pull request per part, base `main`, stacked only where a part needs another's code.

| Part | Branch | Needs | Spec |
|---|---|---|---|
| 1. Reader and the Bosun's session id | `feature/crew-runs-reader` | none | 4, 7.1, 7.2, 8.1 |
| 2. `watchCrew`, the `watch` event and the "Watch:" line | `feature/crew-watch-level` | none | 6.1, 6.2, 12 |
| 3. Steps in the Logbook | `feature/crew-steps` | 1, 2 | 6.3, 7.2 |
| 4. The transcript page and `--follow` | `feature/crew-page` | 1, 2 | 7.3, 8.1 |
| 5. The helm: hold, gate, open, hand back | `feature/crew-helm` | 2 | 8.2, 9.1, 9.2 |
| 6. The helm: steering from the start, "now", the note, the desk | `feature/crew-helm-desk` | 5 | 9.1, 9.2, 9.4 (note, calls) |
| 7. Answers at the helm | `feature/crew-helm-answers` | 6, #400's seat | 9.4 (answers) |

Parts 1, 2 run side by side; 3 and 4 side by side once 1 and 2 are on main; part 7 waits for #400.

## File structure

New:

- `scripts/crew/level.js`: the level for a piece. `watchCrewIn(settings)`, `levelFor(views, settings, work)`.
- `scripts/crew/runs.js`: finding, reading and summarising a run and its subagents; masking; the page; `--follow`. Read-only except its page.
- `scripts/crew/hold.js`: the hold file and the one gate, `helmHeld`. No other module reads `helm/*.json`.
- `scripts/crew/helm.js`: take, open, hand back, stop now; the CLI the director runs (`open`).
- `scripts/hooks/helm-end.js`: the `SessionEnd` hand-back.
- `probes/crew-helm/probe.js`: the section 14 probe, run on purpose, never by `npm test`.
- Tests beside them: `tests/scripts/crew/{level,runs,hold,helm}.test.js`, `tests/scripts/hooks/helm-end.test.js`.

Changed:

- `scripts/settings/catalogue.js`: the `watchCrew` entry.
- `scripts/state/events.js`: `watch`, `helm`, `helm-ended`, `helm-note` in `PLAIN_KINDS` and `PLAIN_SHAPES`; `decision` may carry `where` and `words`.
- `scripts/state/views.js`: reducers for the four kinds (`views.watch`, `views.helm`, `views.helmNotes`).
- `scripts/frontdesk/cli.js`: `watch`, `helm` in `RECORD_KINDS`; commands `page <work>`, `helm take|hand-back|now <work>`.
- `adapters/claude-code/sessions.js`: `featureHelmCall`.
- `scripts/watcher/waker.js`: the foreman's `--session-id`; `helmHeld` beside each `controlHeld` call and in `deliverByStart`; `markLost` skips a held piece; the start without a launch.
- `scripts/watcher/resume.js`, `scripts/watcher/routine.js`, `scripts/foreman/act.js`: ask `helmHeld`.
- `scripts/desk/views.js`: steps in `workLines` and the build tab; the helm lines.
- `scripts/hooks/board-context.js`: the helm note in the First Mate's news.
- `hooks/hooks.json`: the second `SessionEnd` command.
- `skills/intake/SKILL.md`: the "Watch:" line.
- `skills/front-desk/SKILL.md`, `commands/logbook.md`: the watch, helm and hand-back phrases; `watch <work>`.
- `docs/specs/2026-10-17-wheelhouse-design.md` (settings list, safety section), `docs/data.md`.

Not changed: `scripts/lib/role.js` and `scripts/hooks/session-start.js`. A helm session is already `feature` (its recorded role, or `featureSlug(cwd)` for the starting form). If a task finds it needs a change there, it goes in one separate block and the PR body names it.

## Review Focus

1. **A transcript being written as it is read.** The last line is often half-written: it is skipped, never a crash or a broken step. (Task 1.2.)
2. **A very long run.** A transcript of hundreds of megabytes: only its tail is read (256 KiB for steps, 2 MiB for the page), and the Logbook stays quick. (Tasks 1.2, 4.1.)
3. **Secrets and hostile text in a tool result.** An API key in `.env` output, Markdown or HTML, terminal escape codes, a line that says "ignore your instructions": masked or escaped on the page and in step lines, never acted on. (Tasks 1.3, 4.1.)
4. **No transcript found.** Unknown session id, `CLAUDE_CONFIG_DIR` moved, the run not yet started: the piece shows no step line and the page says "No transcript yet", never an error. (Tasks 1.1, 3.1, 4.2.)
5. **The helm terminal closed without `/exit`.** `SessionEnd` may not run: the recorded pid, checked with its start time, ends the hold at the watcher's next tick. (Task 5.4.)

---

## Part 1: Reader and the Bosun's session id

Branch `feature/crew-runs-reader` from `main`. Spec sections 4, 7.1, 7.2, 8.1.

### Task 1.1: Finding a run and its subagents

**Files:**
- Create: `scripts/crew/runs.js`
- Test: `tests/scripts/crew/runs.test.js`

**Interfaces:**
- Produces: `configDir(env) -> string` (`env.CLAUDE_CONFIG_DIR` or `~/.claude`); `findTranscript({sessionId, env}) -> string|null` (first `<sessionId>.jsonl` under `<config>/projects/*/`); `findSubagents(file) -> [{agentId, file}]` (`<dir of file>/<sessionId>/subagents/agent-*.jsonl`, oldest first by mtime).
- Every file found is checked with `lstat`: a link or anything not a plain file is left out.

- [ ] **Step 1: Write the failing tests**
  - `finds a transcript under any project folder`: a fake config with `projects/a/x.jsonl` → `findTranscript({sessionId:'x', env})` ends with `projects/a/x.jsonl`.
  - `honours CLAUDE_CONFIG_DIR`: with `env.CLAUDE_CONFIG_DIR` set, `~/.claude` is not searched.
  - `returns null for an unknown session`: `null`, no throw.
  - `refuses a link`: `x.jsonl` as a symlink → `null`.
  - `lists subagents oldest first`: two `agent-*.jsonl` files → both, in mtime order, `agentId` from the file name.
  - `rejects a session id with a path separator or ..`: `'../x'` → `null`.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/crew/runs.test.js` → FAIL, module not found.
- [ ] **Step 3: Implement** the three functions in `scripts/crew/runs.js` with `fs.readdirSync` and `fs.lstatSync`; no recursion beyond `projects/*/`.
- [ ] **Step 4: Run them and see them pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git add scripts/crew/runs.js tests/scripts/crew/runs.test.js && git commit -m "Crew runs: find a run's transcript and its subagents"`

### Task 1.2: Reading the tail, read-only

**Files:**
- Modify: `scripts/crew/runs.js`
- Test: `tests/scripts/crew/runs.test.js`

**Interfaces:**
- Consumes: Task 1.1's paths.
- Produces: `readTail(file, {max = 256 * 1024}) -> object[]`: the parsed events of the last `max` bytes, oldest first. The first line is dropped when the read starts mid-file; a line that does not parse is skipped. Opened with `fs.constants.O_RDONLY` (plus `O_NOFOLLOW` where defined); a file that is not plain gives `[]`.

- [ ] **Step 1: Write the failing tests**
  - `reads only the tail`: a 1 MiB file, `max: 1024` → every event comes from the last 1024 bytes.
  - `skips a half-written last line`: the file ends `{"type":"assist` → that line is absent, the rest parse.
  - `skips a line that is not JSON`: the other lines still parse, no throw.
  - `gives [] for a missing file`.
  - `does not change the file`: the mtime and size before and after are equal.
- [ ] **Step 2: Run them and see them fail.** Same command as 1.1 → FAIL.
- [ ] **Step 3: Implement `readTail`** with `fs.openSync`, `fs.fstatSync` and one `fs.readSync` from `size - max`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Crew runs: read a transcript's tail, read-only"`

### Task 1.3: Step lines

**Files:**
- Modify: `scripts/crew/runs.js`
- Test: `tests/scripts/crew/runs.test.js`

**Interfaces:**
- Consumes: `readTail` (1.2); `plainWords(text, glossary)` and `glossaryOf(view)` from `scripts/frontdesk/glossary.js`.
- Produces:
  - `stepOf(event) -> {at, text}|null`: one transcript event in plain words; `null` for anything it does not know.
  - `stepsOf(events, {glossary, waiting = null}) -> [{at, text}]`, oldest first, every `text` through `plainWords` and `mask`. When `waiting` is a decision number, the last line is `Waiting for your answer to decision ${waiting}` (section 8.1 rule 4).
  - `mask(text) -> string`: a line holding a key- or token-looking value becomes `[hidden: looked like a key]`. Patterns: `sk-[A-Za-z0-9_-]{20,}`, `gh[pousr]_[A-Za-z0-9]{20,}`, `glpat-[A-Za-z0-9_-]{20,}`, `AKIA[0-9A-Z]{16}`, `xox[abprs]-[A-Za-z0-9-]{10,}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, and `(api[_-]?key|token|secret|password)\s*[:=]\s*\S{8,}` (any case).
  - `plain(text) -> string`: terminal escape codes and other control characters removed (rule 3).
- Verbs (exact copy): `Read` → ``Reading `<path relative to the worktree>` ``; `Edit`, `Write` → ``Changing `<path>` ``; `Grep`, `Glob` → `Searching the code`; `Bash` whose command runs tests (`test`, `jest`, `vitest`, `pytest`, `node --test`) → `Running the tests`; other `Bash` → `Running a command`; `Agent`/`Task` → see 1.4; `WebFetch`, `WebSearch` → `Looking something up`; any other tool → `Using <tool name>`. Assistant text → its first sentence, cut to 120 characters. A `Bash` command that runs `frontdesk/cli.js record decision` → `Recording a decision` (the question is never shown).

- [ ] **Step 1: Write the failing tests**
  - `turns a Read into a reading step`: → ``Reading `src/login.ts` ``.
  - `names a test run`: `npm test` → `Running the tests`.
  - `keeps the first sentence of assistant text`: `"Done. Next I will…"` → `Done.`
  - `skips an event it does not know`: `{type:'summary'}` → no line.
  - `masks a key`: a result holding `sk-` plus 30 characters → the line has `[hidden: looked like a key]` and no `sk-`.
  - `strips escape codes`: `"\u001b[31mred"` → `red`.
  - `shows a waiting decision by number only`: `waiting: 2` → last line `Waiting for your answer to decision 2`, and the question text appears nowhere.
  - `passes wording through the glossary`: a glossary mapping `PR` → `change` → the line says `change`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** `stepOf`, `stepsOf`, `mask`, `plain`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Crew runs: step lines in plain words"`

### Task 1.4: Who is doing it: subagents and the Bosun

**Files:**
- Modify: `scripts/crew/runs.js`
- Test: `tests/scripts/crew/runs.test.js`

**Interfaces:**
- Consumes: 1.1–1.3.
- Produces:
  - `roleOf(agentType) -> string`: `builder` → `A Crew member`, `reviewer` → `A Lookout`, `tester` → `The tester`, matched on the part after any `plugin:` prefix; anything else → `A Crew member`.
  - `subagentLine({agentType, description}) -> string`: `A Crew member is building task 3`, `A Lookout is reviewing task 2`, `The tester is trying <description>`. The verb comes from the role (building, reviewing, trying); the object is the call's `description`, cut to 80 characters and through `plain`.
  - `runSteps({sessionId, env, glossary, waiting, foreman = false}) -> {steps: [{at, text}], crew: [string]}`: finds and reads the run (1.1, 1.2), its subagents' latest lines in `crew`. Each subagent file is matched to the call whose result names its agent id; one with no match uses `A Crew member`. With `foreman: true` each line reads `The Bosun is <verb phrase>`, and a decision step reads `The Bosun is deciding what to do about <work>`. A missing transcript gives `{steps: [], crew: []}`.

- [ ] **Step 1: Write the failing tests**
  - `names a reviewer subagent a Lookout`: a call with `subagent_type: 'wheelhouse:reviewer'`, description `review task 2` → `A Lookout is reviewing task 2`.
  - `falls back to a Crew member`: an unknown agent type → starts `A Crew member`.
  - `reads subagent transcripts beside the run`: a fixture run plus one subagent file → `crew` has one line.
  - `speaks of the Bosun in the third person`: `foreman: true` → every line starts `The Bosun is`.
  - `gives empty lists for a missing run`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** `roleOf`, `subagentLine`, `runSteps`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Crew runs: subagent and Bosun lines"`

### Task 1.5: The Bosun's session id

**Files:**
- Modify: `adapters/claude-code/sessions.js` (`foremanCall`, around line 80)
- Modify: `scripts/watcher/waker.js` (`startForeman`, around line 1265; `launch`, around 1160–1230)
- Test: `tests/scripts/agents/claude-sessions.test.js`, `tests/scripts/watcher/waker.test.js`

**Interfaces:**
- Produces: `foremanCall({..., sessionId = null})`: with a `sessionId`, `args` gains `--session-id <sessionId>` before `-p`. `launch` writes `sessionId` into the running record (`watcher/running/foreman.json`) when the target is `foreman`; `runSteps` in parts 3 and 4 reads it from there.
- `startForeman` makes the id with `crypto.randomUUID()` for each start.

- [ ] **Step 1: Write the failing tests**
  - `foremanCall passes a session id`: `args` contains `'--session-id', id` before `'-p'`.
  - `foremanCall without one is unchanged`: `args` has no `--session-id`.
  - `the foreman's running record names its session`: after a start through the waker's fake spawn, `running/foreman.json` has a `sessionId` matching `/^[0-9a-f-]{36}$/`.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/agents/claude-sessions.test.js tests/scripts/watcher/waker.test.js`
- [ ] **Step 3: Implement** the two changes.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Watcher: give the Bosun's run a known session id"`

Part 1's pull request: title `Crew visibility: the run reader and the Bosun's session id`; body names the spec sections and says nothing reads a transcript yet.

## Part 2: `watchCrew`, the `watch` event and the "Watch:" line

Branch `feature/crew-watch-level` from `main`. Spec sections 6.1, 6.2, 12.

### Task 2.1: The `watchCrew` setting and the level for a piece

**Files:**
- Modify: `scripts/settings/catalogue.js` (`SETTINGS`, beside `typedReplies` at line 86)
- Create: `scripts/crew/level.js`
- Test: `tests/scripts/settings/catalogue.test.js`, `tests/scripts/crew/level.test.js`

**Interfaces:**
- Produces:
  - The entry `watchCrew: { label: 'How much of the crew you see', group: 'advanced', levels: ['off', 'steps', 'transcript'], default: 'steps', home: 'project' }`.
  - `LEVELS = ['off', 'steps', 'transcript']`.
  - `watchCrewIn(settings) -> 'off'|'steps'|'transcript'`: `settings.watchCrew.value` when it is one of `LEVELS`, else `'off'` (an unreadable value counts as off).
  - `levelFor(views, settings, work) -> level`: the latest `watch` event for `work` (`views.watch[work]`, Task 2.2) while the piece is open, else `watchCrewIn(settings)`. `work === 'foreman'` always takes the project value.
  - `levelOf(project, work, {now}) -> level`: reads the records and `effectiveSettings` as `typedRepliesOn` does (`scripts/decisions/answer.js:50`), and returns `'off'` when anything throws.

- [ ] **Step 1: Write the failing tests**
  - `catalogue: watchCrew defaults to steps, per project`: `SETTINGS.watchCrew.default === 'steps'` and `.home === 'project'`.
  - `level: an unreadable value counts as off`: `watchCrewIn({watchCrew:{value:'loud'}}) === 'off'`.
  - `level: a piece's own choice beats the project`: project `steps`, `watch {work:'login', level:'off'}` → `'off'`.
  - `level: the choice ends when the piece closes`: the same, with `login` closed → `'steps'`.
  - `level: the Bosun follows the project only`: a `watch` event for `foreman` is ignored.
  - `level: a records error gives off`: `levelOf` on a project with an unreadable state folder → `'off'`.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/settings/catalogue.test.js tests/scripts/crew/level.test.js`
- [ ] **Step 3: Implement** the entry and `scripts/crew/level.js`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Crew level: the watchCrew setting and a piece's own level"`

### Task 2.2: The `watch` record

**Files:**
- Modify: `scripts/state/events.js` (`PLAIN_KINDS` at 21, `PLAIN_SHAPES` at 286)
- Modify: `scripts/state/views.js` (`buildViews` at 588)
- Modify: `scripts/frontdesk/cli.js` (`RECORD_KINDS` at 133)
- Test: `tests/scripts/state/events.test.js`, `tests/scripts/state/views.test.js`, `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- Produces: kind `watch` with shape `{ must: ['work', 'level'], may: [] }`, `level` one of `LEVELS` (2.1), `work` a feature slug. `views.watch` is `{ [work]: level }`, the latest event per work winning. `cli.js record watch < {"work":"login","level":"transcript"}` writes it. It is a request, not a decision: it never reaches the decision log (`scripts/decisions/line.js`).

- [ ] **Step 1: Write the failing tests**
  - `events: a watch event needs work and level`: a `watch` with no `level` is refused.
  - `events: a watch event refuses an unknown level`: `level: 'loud'` is refused.
  - `views: the latest watch per piece wins`: two events for `login` → `views.watch.login` is the second level.
  - `cli: record watch writes the event`: after the command, `listEvents` holds one `watch`.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/state/events.test.js tests/scripts/state/views.test.js tests/scripts/frontdesk/cli.test.js`
- [ ] **Step 3: Implement** the kind, the shape, the reducer and the record kind.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Records: the watch request"`

### Task 2.3: The "Watch:" line, the phrases and the documents

**Files:**
- Modify: `skills/intake/SKILL.md` (steps 4 and 5)
- Modify: `skills/front-desk/SKILL.md`
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md` (the settings list)
- Test: `tests/skills/intake.test.js` (new), `tests/skills/front-desk.test.js`

**Interfaces:**
- Consumes: `cli.js record watch` (2.2).
- Exact copy: the intake's confirming message gains `Watch: steps. Say "background", "full transcript" or "I'll steer it" to change.`, with the piece's level in place of `steps`.
- Phrases, recorded as a `watch` event: "background" or "don't show me this one" → `off`; "steps" or "keep me posted" → `steps`; "full transcript" or "show me everything" → `transcript`. "I'll steer it" or "let me drive this one" → `transcript`, and the steering itself comes in part 6 (until then the front desk says it is not ready yet).
- The settings list gains `watchCrew` with its three levels and its default.

- [ ] **Step 1: Write the failing test** `intake: the confirming message names the watch level`: the skill text contains `Watch: steps. Say "background", "full transcript" or "I'll steer it" to change.`
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Edit** the two skills and the design's settings list.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit.** `git commit -am "Intake and front desk: the watch level and its phrases"`

Part 2's pull request: title `Crew visibility: the watch level`.

## Part 3: Steps in the Logbook

Branch `feature/crew-steps` from `main` once parts 1 and 2 are merged. Spec sections 6.3, 7.2.

### Task 3.1: The latest step on a piece's state line

**Files:**
- Modify: `scripts/crew/runs.js`
- Modify: `scripts/desk/views.js` (`workLines` at 160, `workState` at 112)
- Test: `tests/scripts/crew/runs.test.js`, `tests/scripts/desk/views.test.js`

**Interfaces:**
- Consumes: `runSteps` (1.4), `levelFor` (2.1), `sessionFile` and `runningFile` from `scripts/watcher/waker.js`, `decisionsFrom` from `scripts/decisions/pending.js`.
- Produces:
  - `crewNow(project, views, settings, {env}) -> { [work]: {steps, crew} }` in `runs.js`: one entry per piece that has a live run and a level other than `off`, plus `foreman` when the Bosun's running record names a `sessionId`. A piece at `off` is never opened (rule 6). `waiting` is the piece's oldest open decision number from `decisionsFrom`.
  - `workLines(views, answers, words, prs = {}, crew = {})`: a running piece's state line ends ` · <its latest step>`; no entry, no change.

- [ ] **Step 1: Write the failing tests**
  - `crewNow: opens nothing at off`: a piece at `off` with a live run → no entry, and a spy on `readTail` saw no call for it.
  - `crewNow: includes the Bosun`: a `foreman.json` running record with a `sessionId` and a fixture transcript → a `foreman` entry.
  - `workLines: adds the latest step`: `crew.login.steps` ending ``Reading `a.ts` `` → the line for `login` ends `` · Reading `a.ts` ``.
  - `workLines: no step, no change`: an empty `crew` → the same lines as before.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/crew/runs.test.js tests/scripts/desk/views.test.js`
- [ ] **Step 3: Implement** `crewNow` and the `workLines` parameter; the Logbook's caller passes `crewNow(...)`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Logbook: the latest step on a running piece"`

### Task 3.2: The build tab's last five steps, and nothing pushed

**Files:**
- Modify: `scripts/desk/views.js` (`VIEWS.logbook`, around line 310)
- Test: `tests/scripts/desk/views.test.js`, `tests/scripts/desk/watch.test.js`

**Interfaces:**
- Consumes: `crewNow` (3.1).
- Produces: under each running piece in the build tab, its last five steps (oldest first) and then its `crew` lines; under a heading `The Bosun`, the Bosun's last five. The desk change feed and `snapshotOf` (`scripts/desk/watch.js:19`) never include steps (section 6.3: watching pushes nothing).

- [ ] **Step 1: Write the failing tests**
  - `build tab: shows five steps`: eight fixture steps → the last five, in order.
  - `build tab: lists the crew under the piece`: one `crew` line → shown after the steps.
  - `build tab: shows the Bosun's steps under its own heading`.
  - `snapshot: carries no steps`: `snapshotOf` with a live fixture run is equal with and without the transcript present.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/desk/views.test.js tests/scripts/desk/watch.test.js`
- [ ] **Step 3: Implement** the build tab lines.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Logbook: the build tab's recent steps"`

Part 3's pull request: title `Crew visibility: steps in the Logbook`.

## Part 4: The transcript page and `--follow`

Branch `feature/crew-page` from `main` once parts 1 and 2 are merged. Spec sections 7.3, 8.1.

### Task 4.1: Rendering and writing the page

**Files:**
- Modify: `scripts/crew/runs.js`
- Test: `tests/scripts/crew/runs.test.js`

**Interfaces:**
- Consumes: 1.1–1.4.
- Produces:
  - `escapeMarkdown(text) -> string`: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, and a backslash before each of `` \ ` * _ [ ] # | ``; then `plain` and `mask` (1.3).
  - `renderPage({work, events, subagents: [{line, events}], waiting, now}) -> string`: a Markdown page headed `# <work>: what the crew did` and `Written <day month year, HH:MM>. Kept on this computer only.`; then each event oldest first: what the session said, or `- <step line>` with the tool's result cut to one line of 160 characters beneath it; each subagent under `## <its line>`. Every transcript string goes through `escapeMarkdown`. With `waiting`, the page ends `Waiting for your answer to decision N`.
  - `pagePath(project, work) -> string`: `<project>/.wheelhouse/watch/<work>.md`.
  - `writePage(project, work, {env, now}) -> string|null`: reads the run with `max: 2 * 1024 * 1024`, writes the page atomically (temporary file, then rename) and returns its path. Refuses (returns `null`) when `.wheelhouse/watch` or the page is a link, or `work` is not a feature slug. It writes nothing else.

- [ ] **Step 1: Write the failing tests**
  - `page: escapes Markdown and HTML`: a result holding `<script>` and `[x](http://e)` → the page holds `&lt;script&gt;` and `\[x\]`.
  - `page: masks a token`: a `ghp_` token → absent from the page.
  - `page: subagents under their own headings`: one reviewer subagent → a `## A Lookout is reviewing …` heading.
  - `page: newest at the bottom`: the last event's line is the page's last step line.
  - `page: a waiting decision by number only`.
  - `page: refuses a linked folder`: `.wheelhouse/watch` as a symlink → `null` and nothing written through it.
  - `page: no transcript yet`: a piece with no transcript → the page says `No transcript yet.`
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/crew/runs.test.js`
- [ ] **Step 3: Implement** `escapeMarkdown`, `renderPage`, `pagePath`, `writePage`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Crew runs: the transcript page"`

### Task 4.2: "watch <work>", `--follow`, removal and the documents

**Files:**
- Modify: `scripts/crew/runs.js` (a command-line entry when run directly)
- Modify: `scripts/frontdesk/cli.js` (command `page <work>`)
- Modify: `scripts/watcher/routine.js` (`makeRoutine`'s tick removes pages of closed pieces)
- Modify: `commands/logbook.md`, `skills/front-desk/SKILL.md`, `docs/data.md`, `docs/specs/2026-10-17-wheelhouse-design.md` (safety section)
- Test: `tests/scripts/crew/runs.test.js`, `tests/scripts/frontdesk/cli.test.js`, `tests/scripts/watcher/routine.test.js`

**Interfaces:**
- Consumes: `writePage` (4.1), `cli.js record watch` (2.2), `isOpen(views, id)` from `scripts/desk/views.js:59`.
- Produces:
  - `cli.js page <work>`: records `watch {work, level: 'transcript'}` when the piece is below `transcript`, writes the page, and prints one line (exact copy): ``The page is at `<path>`. To follow it live: `node <plugin root>/scripts/crew/runs.js --follow <work>` `` For a closed or unknown piece it prints `There is no open piece called <work>.` and writes nothing.
  - `node scripts/crew/runs.js --follow <work>`: rewrites the page every 2 seconds and prints each new step line to the terminal; stops when the piece closes or on Ctrl-C.
  - `prunePages(project, views) -> string[]`: removes `watch/<work>.md` for every piece that is not open; returns what it removed. Called from the routine's tick.
  - "watch <work>" (front desk) and `/wheelhouse:logbook watch <work>` run `cli.js page <work>` and pass on its one line.
  - `docs/data.md` gains a `## Watching the crew` section: what the page holds, where it lives (`.wheelhouse/watch/`, ignored by git), that it stays on this computer and is removed when the piece closes. The design's safety section gains rules 1–6 of section 8.1.

- [ ] **Step 1: Write the failing tests**
  - `cli: page raises the level and prints one line`: after `page login`, `views.watch.login === 'transcript'` and stdout is one line containing `--follow login`.
  - `cli: page refuses a closed piece`: the refusal line, no file.
  - `routine: removes a closed piece's page`: a page for a closed piece is gone after one tick; an open piece's page stays.
  - `runs: --follow prints new steps`: run as a child with a fixture transcript appended once → its output gains that step, and it exits when the piece is marked closed.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/crew/runs.test.js tests/scripts/frontdesk/cli.test.js tests/scripts/watcher/routine.test.js`
- [ ] **Step 3: Implement** the command, `--follow`, `prunePages` and the documents.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Crew page: watch a piece, follow it, and tidy up"`

Part 4's pull request: title `Crew visibility: the transcript page`.

## Part 5: The helm: hold, gate, open, hand back

Branch `feature/crew-helm` from `main` once part 2 is merged. Spec sections 8.2, 9.1, 9.2.

### Task 5.1: The hold and its records

**Files:**
- Create: `scripts/crew/hold.js`
- Modify: `scripts/state/events.js`, `scripts/state/views.js`, `scripts/frontdesk/cli.js` (`RECORD_KINDS`)
- Test: `tests/scripts/crew/hold.test.js`, `tests/scripts/state/events.test.js`, `tests/scripts/state/views.test.js`

**Interfaces:**
- Consumes: `watcherDir(project)` (`scripts/watcher/waker.js:258`). `hold.js` imports it and nothing else from the waker; if that makes an import cycle once 5.2 lands, move `watcherDir` into a small `scripts/watcher/paths.js` that both import.
- Produces:
  - Kinds `helm` `{must: ['work', 'at'], may: ['fromStart']}`, `helm-ended` `{must: ['work', 'at'], may: ['why']}`, `helm-note` `{must: ['work', 'text'], may: []}` (`text` at most five lines). All three are requests, not decisions. `helm-note` joins `RECORD_KINDS`.
  - `views.helm`: `{ [work]: {since, fromStart} }` for each helm not yet ended. `views.helmNotes`: `{ [work]: [{at, text}] }`.
  - `holdFile(project, work)`: `<watcherDir>/helm/<work>.json`.
  - `takeHold(project, {work, sessionId, fromStart = false, now}) -> hold`: writes the `helm` event and the hold file `{work, sessionId, at, fromStart, opened: false, pid: null, startTime: null}`. Refuses (throws) when a hold already exists: one writer (rule 8).
  - `readHold(project, work) -> hold|null`; `holdBySession(project, sessionId) -> hold|null`; `markOpened(project, work, {pid, startTime})`.
  - `releaseHold(project, work, {why, now})`: removes the file and writes `helm-ended`.
  - `helmHeld(project, work) -> boolean`: true when the hold file exists, including when it cannot be parsed (a broken hold still holds).
  - `cleanOrphans(project, views) -> string[]`: removes hold files with no open `views.helm` entry.

- [ ] **Step 1: Write the failing tests**
  - `hold: take writes the event and the file`: after `takeHold`, `helmHeld` is true and `views.helm.login.since` is set.
  - `hold: one writer`: a second `takeHold` for the same piece throws.
  - `hold: a broken file still holds`: the file holds `{` → `helmHeld` is true.
  - `hold: release ends it`: after `releaseHold`, `helmHeld` is false and `views.helm.login` is absent.
  - `hold: finds a hold by session id`.
  - `hold: removes an orphan`: a file with no `helm` event → removed by `cleanOrphans`.
  - `events: a helm note of six lines is refused`.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/crew/hold.test.js tests/scripts/state/events.test.js tests/scripts/state/views.test.js`
- [ ] **Step 3: Implement** `hold.js`, the kinds and the reducers.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Helm: the hold and its records"`

### Task 5.2: The one gate

**Files:**
- Modify: `scripts/watcher/waker.js` (beside each `controlHeld` call at 1510, 1602, 1683, 1747; `deliverByStart` around 1562; `markLost` at 1066; the exit handling in `launch`)
- Modify: `scripts/watcher/resume.js` (`findLostSessions` at 80), `scripts/watcher/routine.js` (`readFacts` at 172, `triage` at 75, the `stalled` record around 329), `scripts/foreman/act.js` (`start` 583, `goAhead` 320, `pause` 789, `merge` 1382)
- Modify: `scripts/watcher/main.js` (at start, `cleanOrphans`)
- Test: `tests/scripts/watcher/waker.test.js`, `tests/scripts/watcher/resume.test.js`, `tests/scripts/watcher/routine.test.js`, `tests/scripts/foreman/act.test.js`, `tests/scripts/watcher/main.test.js`

**Interfaces:**
- Consumes: `helmHeld`, `cleanOrphans` (5.1).
- Produces:
  - Waker: a held piece's wakes stay queued (not delivered, not dropped); nothing starts or resumes it; a run that ends while held writes no lost marker. A live run is left to finish.
  - `resume.js`: a held piece is not a lost session.
  - `routine.js`: a held piece joins `held`, so the stuck check skips it; no `stalled` record and no reliability incident for it.
  - `act.js`: `start`, `build`, `resume`, `pause` and `merge` on a held piece refuse with (exact copy) `<work> is with the director at the helm. It waits until they hand it back.`
  - The pace limit (3) is unchanged: a held piece keeps its slot.

- [ ] **Step 1: Write the failing tests**
  - `waker: a held piece's wake waits`: a wake for a held piece → no spawn; after `releaseHold` and a tick → one spawn with that wake.
  - `waker: a held run that ends leaves no lost marker`.
  - `resume: a held piece is not lost`.
  - `routine: a held piece is never stuck`: an old run of a held piece → no `stalled` record.
  - `act: merge refuses a held piece`: the exact message, and no merge call.
  - `main: removes orphan holds at start`.
- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/watcher/waker.test.js tests/scripts/watcher/resume.test.js tests/scripts/watcher/routine.test.js tests/scripts/foreman/act.test.js tests/scripts/watcher/main.test.js`
- [ ] **Step 3: Implement** the gate at each site, asking `helmHeld` and nothing else.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Helm: every start, wake and move waits for a held piece"`
