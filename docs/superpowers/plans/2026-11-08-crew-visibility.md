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
  - `skips a line that is not JSON`: `[]`-free result, no throw.
  - `gives [] for a missing file`.
  - `does not change the file`: the mtime and size before and after are equal.
- [ ] **Step 2: Run them and see them fail.** Same command as 1.1 → FAIL.
- [ ] **Step 3: Implement `readTail`** with `fs.openSync`, `fs.fstatSync` and one `fs.readSync` from `size - max`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `git commit -am "Crew runs: read a transcript's tail, read-only"`
