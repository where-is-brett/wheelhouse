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
- Test: `tests/scripts/skills/` (whichever test already checks the intake skill's text; add to it)

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
