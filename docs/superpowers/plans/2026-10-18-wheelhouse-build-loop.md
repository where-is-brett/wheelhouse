<!-- docs/superpowers/plans/2026-10-18-wheelhouse-build-loop.md -->

# Wheelhouse build loop and lineage: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer checks 24 to 30, then build the build loop (the feature files, the status script, the watcher, the foreman, the intake, the three lanes and their brief, the agents the lanes dispatch, and the gate's new conditions) and lineage (the pins in Wheelhouse's marketplace, the manifest, the register, provenance, the session-start warning, the pre-tool hold, the upgrade path and the tested undo).

**Architecture:** Everything between sessions is a file or a state event, never chat. A feature session writes its questions and report into `.wheelhouse/feature/` in its worktree, and a hook builds its status there from the Superpowers ledger and the `.git` files, at no token cost. The watcher, a Node.js script with no keys, reads those files and the state clone, asks the helper for CI, mergeability and test merges, and wakes the foreman or one feature session by the route check 27 picks. The foreman is a thin playbook over deterministic scripts (the queue, the clash check, the brief). The helper gains the gate's new conditions. Lineage is data in Wheelhouse's own repository (`lineage/`), checked by small scripts at session start, before each tool call and at the gate.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies. `git` (`merge-tree --write-tree`, `patch-id --stable`), `gh` and `glab` through the helper only. The `claude` command line for the probes and the evaluation runs.

**Spec:** `docs/specs/2026-10-18-build-loop-design.md` (approved 18 October 2026): all of it, above all sections 11 (the watcher), 14 (lineage), 15 (scenarios 20 to 35), 16 (checks 24 to 30), 17 (the designer's calls) and 18 (the director's decisions). Read with the main design, `docs/specs/2026-10-17-wheelhouse-design.md`, sections 7, 8, 9, 10, 12.3, 12.4 and 18, which it points to, and with `HANDOVER.md` (next steps, step 4).

## Scope

The build-loop plan, HANDOVER's next step 4. It starts with checks 24 to 30, written up as checks 1 to 23 were, because their answers change what is built: check 27 picks the watcher's shape, check 24 says where the pinned copies are installed and which copies to switch off, and check 25 says whether the brief's override wins.

It builds the foreman whole (it is thin), the intake part of the front desk's playbook, and the three agents a feature session dispatches (builder, reviewer, tester), because the override routes Superpowers' subagents to them and scenarios 33 and 34 test that. *Plan's call.* It does not build the front desk's cards, briefing, board or learning, the usage receiver's store, the weekly official-sources check, the mod, or setup. Where those will call something this plan builds (the front desk asking an approval card, setup writing the pins into a project, the briefing's line for a green upgrade), this plan builds the function, the card line and the test, and the later plan calls them.

It builds on the safety plan's branch (pull request #4), which is waiting for the director's sitting. Nothing here starts until that work has merged, so the safety files this plan modifies are as that branch leaves them.

## Global Constraints

Everything in the safety plan's and the state-and-host plan's Global Constraints holds: Node.js 22 or later, no npm dependencies, ESM `.js`, `node:test` in `tests/**/*.test.js`, macOS and Windows, the path comment on every file, British or Australian English, dates as "18 October 2026", no model identifiers anywhere and no `Co-Authored-By` line in commits, secrets only in a child's environment, everything under `wheelhouseHome()`, times in UTC ISO 8601 with a `now` argument, child processes through `run`, hooks never running `git` in a folder an agent controls, guards failing closed and informing hooks failing open, the caller only raising a gate condition. In addition:

- **Upstream files are never edited or copied.** Superpowers and Matt Pocock's skills are used as installed. The one exception is `/implement`'s five lines, carried word for word in the quick-lane brief and recorded in the register as carried text (design section 6).
- **The watcher holds no keys and runs no project code.** It reads files with `fs` and asks the helper for anything on the host. Test merges run `git merge-tree` in the helper's own mirror (design section 12).
- **Signed records come only from the director's clicks.** Every new protected record in this plan is an `action` written by the prompt-record hook from a card that carries its exact line (`scripts/state/card-lines.js`). A plain event never stands in for one.
- **The design's numbers are constants, named once,** in `scripts/lib/build-loop.js`: `PACE = { building: 3, featureLane: 1 }`, `STUCK_MS = 20 * 60 * 1000`, `BUNDLE_MS = 60 * 1000`, `FIX_ROUNDS = 3`, `UPGRADE = { minAgeDays: 7, everyDays: 30 }`, `FOREMAN_FALLBACK_COMPACT = 100000`, `REPORT_WORDS = 300`.
- **No model identifiers in templates or tests.** The brief takes models from the project's routing table (`config.routing` in `.claude/wheelhouse.json`); templates hold placeholders, and tests use made-up names such as `model-a`.
- **Evaluation runs cost tokens and need a signed-in `claude`.** They run with `npm run eval`, never inside `npm test`, in throwaway projects under `os.tmpdir()`, with a stand-in helper and no real host. Each run's token use is reported with its result (main design, section 18).
- **The feature files are git-ignored** by an entry in the repository's `info/exclude`, written with `fs`, never in a project's `.gitignore`.

## Review Focus

1. **The watcher waking itself.** The foreman's own state writes, made in answer to a wake, arrive as new events. Expected: each event id wakes at most once; events the foreman wrote while handling a wake go to the digest, not a new wake, so wakes cannot loop. Owning task: Task 11.
2. **A computer that sleeps, or a watcher that restarts.** Expected: the cursor is on disk; after a restart no event is lost and none wakes twice; a feature whose status is old only because the computer slept is not called stuck (the clock counts awake time since the watcher last saw it). Owning task: Task 11.
3. **A feature session editing its own brief, or writing a malformed or huge feature file.** Expected: a brief whose hash isn't the foreman's latest record is never read as an amendment: it wakes the foreman as a tampered brief; malformed question lines are skipped and named in the digest; files over 64 KB are read no further. Owning tasks: Tasks 9 and 11.
4. **An update merge that hides a change.** The gate brings a branch up to date and the merge's own resolution changes code, while the feature's patch-id is unchanged. Expected: the review carries over only when the update merge is clean (its tree is the automatic merge's); otherwise a review of the new head is needed. Owning task: Task 21.
5. **Fingerprints on Windows.** A checkout with CRLF line endings, `\` separators, a file name differing only in case, or a link inside a skill folder. Expected: the same fingerprint as on the Mac; a link is hashed as the text of its target and never followed. Owning task: Task 23.

## File structure

```
scripts/lib/build-loop.js        the design's numbers
scripts/state/events.js          (changed) the build loop's kinds and actions
scripts/state/card-lines.js      (changed) the new card lines
scripts/state/views.js           (changed) work, features, questions, incidents
scripts/hooks/prompt-record.js   (changed) the new clicks
scripts/feature/files.js         the four feature files: paths, formats, readers
scripts/feature/status.js        status from the ledger and the .git files
scripts/feature/brief.js         rendering and amending a brief
scripts/feature/cli.js           ask, answer, report, open-pr: the session's commands
scripts/hooks/feature-status.js  the hook that runs status.js
scripts/watcher/core.js          observations to events, routing, bundling, the cursor
scripts/watcher/sources.js       reading the files, state and the helper
scripts/watcher/waker.js         waking the foreman or a feature session (check 27)
scripts/watcher/main.js          the watcher process
scripts/foreman/queue.js         pace, order, dependencies, the clash check, file maps
scripts/foreman/start.js         the foreman's start script
scripts/foreman/wake.js          reads a wake bundle for the foreman; records measures
scripts/intake/similar.js        open work, ideas and rejections like a new request
scripts/host/helper.js           (changed) test merges, answers, update-branch, incidents, provenance
scripts/gate/conditions.js       (changed) the three new conditions
scripts/lineage/fingerprint.js   whole-folder fingerprints, LF-evened
scripts/lineage/manifest.js      reading the manifest; checking installed files
scripts/lineage/register.js      anchors and carried text
scripts/lineage/provenance.js    the block every PR and report carries
scripts/lineage/upgrade.js       the monthly upgrade's deterministic steps
scripts/lineage/release.js       installing a Wheelhouse release in a project; the undo
scripts/lineage/check.js         re-checks the installed files; clears the hold
scripts/hooks/lineage-hold.js    the pre-tool hold
scripts/eval/harness.js          runs a scenario in a throwaway project
scripts/eval/run.js              npm run eval
lineage/manifest.json            what Wheelhouse runs on
lineage/register.json            what Wheelhouse lays on top
templates/brief/brief.md         the brief template
templates/brief/override.md      the Wheelhouse override
templates/brief/lanes/*.md       quick, small, feature, bug
agents/builder.md, agents/reviewer.md, agents/tester.md
skills/foreman/SKILL.md          the foreman's playbook
skills/intake/SKILL.md           the front desk's routing
docs/lineage/upgrading.md        the upgrade, step by step, for Wheelhouse's release work
tests/eval/build-loop/*.js       scenarios 20 to 27 and 33 to 35
tests/e2e/build-loop.test.js
```

## Findings note format

As the checks plan set it (`docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md`, "Findings note format"), checked by `tests/docs/checks-format.test.js`: the path comment, `# Check N: <title>`, an `**Answer:**` line starting Yes, No, Partly or Deferred, then the headings Question, Tested on, Method, Evidence, What it means for the design, Needs the director. The Question is copied from the build-loop design's section 16. Each note adds its row to `docs/checks/README.md`.

---

## Part 1: the checks

**Before Task 1, one card to the director.** What this is: checks 24 to 30, which make sure the build loop and lineage rest on facts. Why it comes to them: checks 24 and 30 add a throwaway plugin source to this computer's plugin list (removed at the end), check 28 changes Claude Code's update channel on this computer, and some checks need them at the Mac and on Windows. The options: **Go ahead**, **Not now**. Recommendation: go ahead. Meanwhile: the checks that need nobody run first; the sitting is arranged with its own card (see "The director's sittings").

### Task 1: Check 24, pinning through Wheelhouse's marketplace

**Files:**
- Create: `probes/lib/marketplace.js`, `probes/24-pinning/run.js`, `docs/checks/24-pinning.md`
- Modify: `docs/checks/README.md`; if it exists, rename `docs/checks/24-safety-live.md` to `docs/checks/31-safety-live.md`
- Test: `tests/probes/lib/marketplace.test.js`

**Interfaces:**
- Consumes: `makeScratchProject`, `probeLogDir`, `appendJsonl` (`probes/lib/`).
- Produces:
  - `makeScratchMarketplace({ name, plugins: Array<{ name, repo, ref, sha }> }) -> Promise<{ dir, url, cleanup() }>`: a git repository under `os.tmpdir()` holding `.claude-plugin/marketplace.json` with each plugin as `{ name, source: { source: 'github', repo, ref, sha } }`, committed. `url` is its `file://` address.
  - Findings later tasks rely on, recorded in the note under "What it means for the design": the upstream repositories and the commits behind Superpowers 7.0.0 and the installed Matt Pocock's skills; the folder each pinned copy installs to and how to find it (Claude Code's own list of installed plugins, or the cache path); the names under which Anthropic's copy and the synced copies are switched off in `enabledPlugins`; how auto-update is set for a marketplace in a project's settings.

- [ ] **Step 1: Number the notes.** The safety plan's sitting (its Task 18) names its note `24-safety-live.md`, but the build-loop design owns 24 to 30. If that file exists, rename it `31-safety-live.md`, change its heading to `# Check 31: the safety checks tried live`, and fix its row in `docs/checks/README.md`. Run `npm test`.
- [ ] **Step 2: Write the failing test** for `makeScratchMarketplace`: the file parses; each entry has `ref` and a 40-character lowercase `sha`; `git log` has one commit; `cleanup()` refuses a folder outside `os.tmpdir()`.
- [ ] **Step 3: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 4: Read** https://code.claude.com/docs/en/plugins/marketplace-reference and https://code.claude.com/docs/en/plugins/loading, and find the upstream repositories and the commits behind the installed copies (the installed copy's own git data, and each upstream's tags). Record the links and date.
- [ ] **Step 5: Run `probes/24-pinning/run.js`.** It makes a scratch marketplace listing Superpowers and Matt's skills at their commits, adds it to a scratch project at project scope, installs both at project scope, and records: the commit actually installed (from Claude Code's list of installed plugins and the installed folder's git data); the marketplace's auto-update setting; and, after writing `enabledPlugins` with Anthropic's copy of Superpowers set to `false`, what `claude plugin list` shows in that project. Then it moves the scratch marketplace's tag to a later commit without changing `sha`, updates the marketplace, and checks the installed commit did not move.
- [ ] **Step 6: Director (Mac, 5 min, in the sitting).** In a Desktop session on the scratch project, the session lists the skills it has. Pass: only the pinned Superpowers and Matt's skills appear; Anthropic's copy and the synced copies do not. Record the exact settings that did it.
- [ ] **Step 7: Undo and check.** Uninstall both from the scratch project, remove the scratch marketplace from this computer's plugin list, and confirm the user's plugin files are as before (copies taken before Step 5, outside the repository).
- [ ] **Step 8: Write the note,** add its row, run `npm test`, commit.

```bash
git add probes/lib probes/24-pinning tests docs/checks
git commit -m "Record check 24: pinning through Wheelhouse's marketplace"
```

### Task 2: Check 30, the undo

**Files:**
- Create: `probes/30-undo/run.js`, `docs/checks/30-undo.md`
- Modify: `docs/checks/README.md`

**Interfaces:**
- Consumes: `makeScratchMarketplace` (Task 1).
- Produces: the undo's route, recorded in the note for Task 29: the commands that reinstall a previous release from a marketplace pinned by `sha`, and whether they work when the earlier version's folder has been removed from the cache.

- [ ] **Step 1: Read** the plugin pages for how orphaned versions are cleaned up and how a pinned entry is fetched again. Record the links and date.
- [ ] **Step 2: Run `probes/30-undo/run.js`.** A scratch marketplace lists a scratch plugin at release A (`ref` `v1`, its `sha`); install it in a scratch project; move the marketplace to release B; update; confirm B is installed and A is orphaned. Then: (1) go back to A by moving the marketplace entry back and updating, and confirm A's commit is installed; (2) repeat with A's cached folder deleted first, standing in for the 14-day clean-up, and confirm A is fetched again at its `sha`.
- [ ] **Step 3: Undo** as in Task 1 Step 7.
- [ ] **Step 4: Write the note,** add its row, run `npm test`, commit.

```bash
git add probes/30-undo docs/checks
git commit -m "Record check 30: reinstalling a previous release"
```

### Task 3: Check 25, the override wins, and the evaluation harness

**Files:**
- Create: `scripts/eval/harness.js`, `scripts/eval/run.js`, `templates/brief/override.md`, `tests/eval/build-loop/24-override-wins.js`, `docs/checks/25-override.md`
- Modify: `package.json` (`"eval": "node scripts/eval/run.js"`), `docs/checks/README.md`
- Test: `tests/scripts/eval/harness.test.js`

**Interfaces:**
- Consumes: `makeScratchProject`; `startHelper` with a stand-in adapter (`tests/helpers/helper-process.js`).
- Produces (kept, used by Task 31):
  - `runSession({ dir, prompt, pluginDirs: string[], permissionMode: string, model?: string, maxTurns: number, env?: object }) -> Promise<{ events: object[], exitCode: number, usage: { input: number, output: number } }>`: runs `claude -p <prompt> --output-format stream-json --verbose` with `--permission-mode`, `--max-turns` and one `--plugin-dir` per entry, in `dir`, and parses each stdout line. Flag names are checked against `claude --help` at run time.
  - `toolCalls(events) -> Array<{ name, input }>`, `finalText(events) -> string`, `subagents(events) -> Array<{ type: string, model: string | null }>`.
  - A scenario module: `export default { id: number, title: string, setup: async (dir) => void, prompt: string, variants: { with: { pluginDirs }, without: { pluginDirs } }, pass: ({ events, dir }) => { pass: boolean, why: string } }`.
  - `run.js <id…> [--variant with|without] [--trials n]`: runs each, writes `<os.homedir()>/.wheelhouse-evals/<date>/<id>-<variant>-<n>.json`, prints `<id> <variant>: pass|fail (<why>) <tokens>`.
  - `templates/brief/override.md`: the seven rules of design section 7, each as one short paragraph that names, in a quoted line, the Superpowers sentence it overrides (the anchors are listed in Task 25), with a first line saying these rules win over any skill's.

- [ ] **Step 1: Write the failing tests** for `toolCalls`, `finalText` and `subagents` against a recorded `stream-json` fixture (`tests/fixtures/eval/stream.jsonl`, made by running one short session and replacing ids with placeholders).
- [ ] **Step 2: Run, expect FAIL; implement `harness.js` and `run.js`; run, expect PASS.**
- [ ] **Step 3: Write `templates/brief/override.md`** from design section 7's table.
- [ ] **Step 4: Write scenario 24.** Setup: a scratch project with a two-task plan and a brief whose first section is the override. Prompt: "Read `.wheelhouse/feature/brief.md` and follow it; then run the plan." The variants load Superpowers from its installed folder (Task 1's finding) with and without the brief. Pass: the session never ends by asking for an execution method, and never calls `AskUserQuestion`; without the brief, Superpowers' own hand-off is seen.
- [ ] **Step 5: Run it.** `npm run eval -- 24 --variant with` and `--variant without`, one trial each (three if they disagree with what is expected). Also record, from `subagents(events)`, whether a subagent's model can be set from the brief, and in what form (an alias or a full model ID): scenario 33 and Task 15 rely on it.
- [ ] **Step 6: Write the note.** If the override loses, "What it means for the design" names where it must go instead (the feature session's starting prompt, or a system prompt file passed by the starter), and Task 15 follows it. Add the row, run `npm test`, commit.

```bash
git add scripts/eval templates/brief tests docs/checks package.json
git commit -m "Add the evaluation harness and record check 25: the override wins"
```

### Task 4: Check 29, the hold

**Files:**
- Create: `probes/29-hold/hold.js`, `probes/29-hold/run.js`, `docs/checks/29-hold.md`
- Modify: `docs/checks/README.md`
- Test: `tests/probes/29-hold/hold.test.js`

**Interfaces:**
- Produces: `hold.js`, a PreToolUse hook: when its scratch project holds `.hold-probe`, it denies every tool but `Read`, `Grep` and `Glob` with "probe: held"; otherwise it says nothing.

- [ ] **Step 1: Write the failing test,** run it, implement `hold.js`, run it again.
- [ ] **Step 2: Run `probes/29-hold/run.js` on the Mac.** Headless sessions in a scratch project with the hook: with the marker, ask for a `Read`, an `Edit`, a `Write` and a `Bash` command; pass when only the read runs. Without it, all four run.
- [ ] **Step 3: Director (Windows, 5 min, in the Windows sitting).** The same run on Windows.
- [ ] **Step 4: Write the note,** add its row, run `npm test`, commit.

```bash
git add probes/29-hold tests docs/checks
git commit -m "Record check 29: a pre-tool hold on both systems"
```

### Task 5: Check 27, starting and waking sessions from a script

**Files:**
- Create: `probes/27-sessions/trials.js`, `probes/27-sessions/run.md`, `docs/checks/27-sessions.md`
- Modify: `docs/checks/README.md`

**Interfaces:**
- Produces: the watcher's shape (design section 11), stated on the note's answer line as **Shape 1** (a background process starts a fresh foreman per batch, and starts or wakes feature sessions) or **Shape 2** (the fallback), with the exact route: the command or call that starts a session with a prompt, an explicit permission mode and an explicit model, in a given folder; the one that wakes an existing session with a one-line message; and how long each takes.

- [ ] **Step 1: Read** the current pages on background and headless sessions, `claude --help`, and check 1's note. List every documented way a script can start a session and send one a message. Record the links and date.
- [ ] **Step 2: Write `trials.js`.** A plain Node.js script, outside any session, that for each route: (1) starts a fresh session in a scratch project with the prompt "write `pong-1` to `pong.txt`", the mode `acceptEdits` and a named model, and times how long until the file appears; (2) starts a second one in a separate worktree of that project; (3) sends that second session a one-line message asking for `pong-2`, and times it; (4) starts a third fresh session and checks from its transcript that it carries nothing of the first. Each result goes to the probe log.
- [ ] **Step 3: Run it on the Mac** from the shell, then **Director (Mac, 5 min, in the sitting):** with Desktop open, run it again and note whether the sessions it starts appear in Desktop, and whether the director can open one.
- [ ] **Step 4: Director (Windows, 10 min, in the Windows sitting).** The same on Windows. Check 1 found the command line's own sign-in failing there; if it still does, record it, and try any route that uses Desktop's sign-in.
- [ ] **Step 5: Write the note.** Shape 1 needs every trial to pass on both systems. Otherwise Shape 2, and Task 6 runs. Add the row, run `npm test`, commit.

```bash
git add probes/27-sessions docs/checks
git commit -m "Record check 27: starting and waking sessions from a script"
```

### Task 6: Check 26, plugin monitors (only for Shape 2)

**Files:**
- Create: `probes/26-monitor/` (a small plugin with one monitor), `docs/checks/26-monitor.md`
- Modify: `docs/checks/README.md`

- [ ] **Step 1: If check 27 answered Shape 1,** write the note with **Answer:** Deferred — not needed: check 27 chose the background process. Add the row and commit; skip the rest.
- [ ] **Step 2: Otherwise, read** the plugin monitors reference, then write the probe plugin: a monitor that prints a line every five minutes, limited to sessions whose folder holds `.foreman-probe` (by the monitor's own condition, or by the script exiting at once elsewhere).
- [ ] **Step 3: Director (Mac, then Windows; 5 minutes each, in the sittings).** The plugin installed in a scratch project; one Desktop session in a marked folder and one in an unmarked folder left open for an hour (the director only opens them). Pass: the marked session gets a line every five minutes for the hour; the unmarked one gets none. Also note whether a session started with its own settings file can compact at 100,000 tokens (`FOREMAN_FALLBACK_COMPACT`).
- [ ] **Step 4: Undo and check,** write the note, add the row, run `npm test`, commit.

```bash
git add probes/26-monitor docs/checks
git commit -m "Record check 26: plugin monitors in Desktop"
```

### Task 7: Check 28, Claude Code's update settings in Desktop

**Files:**
- Create: `docs/checks/28-update-channel.md`
- Modify: `docs/checks/README.md`

**Interfaces:**
- Produces, for Task 24: the exact setting names and values for the stable channel and a minimum version, where they must be written (user settings or elsewhere), and whether Desktop's built-in Claude Code follows them.

- [ ] **Step 1: Read** https://code.claude.com/docs/en/setup and the settings page for the update channel and minimum version. Record the setting names, links and date.
- [ ] **Step 2: Director (Mac, 5 min, in the sitting).** Note the Claude Code version a Desktop session reports (the session start reads it from the transcript). Write the stable channel and a minimum version one below it in the user settings (the card before Part 1 covered this), restart Desktop, and note the version again. Then set the minimum above the installed version, restart, and note what Desktop does. Put the settings back and check they are as before.
- [ ] **Step 3: Director (Windows, 5 min, in the Windows sitting).** The same.
- [ ] **Step 4: Write the note,** add its row, run `npm test`, commit.

```bash
git add docs/checks
git commit -m "Record check 28: Claude Code's update settings in Desktop"
```

---

## Part 2: state and the feature files

### Task 8: The build loop's records in state

**Files:**
- Create: `scripts/lib/build-loop.js`
- Modify: `scripts/state/events.js`, `scripts/state/card-lines.js`, `scripts/state/views.js`, `scripts/hooks/prompt-record.js`
- Test: `tests/scripts/state/events.test.js`, `tests/scripts/state/views.test.js`, `tests/scripts/hooks/prompt-record.test.js`

**Interfaces:**
- Consumes: `makeEvent`, `checkAction`, `buildViews`, `verify`; the prompt record's card matching.
- Produces:
  - Plain kinds added to `PLAIN_KINDS`:
    - `work`: `{ id: string, title: string, lane: 'quick' | 'small' | 'feature' | 'bug', doc?: { path: string, hash: string }, visible: boolean, dependsOn: string[], place?: number, parent?: string }`. `id` is a slug (`[a-z0-9-]`, at most 40 characters).
    - `feature`: `{ work, step: 'started' | 'planned' | 'building' | 'paused' | 'closed', worktree?, branch?, session?, plan?, files?: string[], brief?: string, slice?: { n, m } }`. `brief` is the hash of the brief the foreman last wrote.
    - `question`: `{ id: string, work, what, why, options: Array<{ label, says }>, recommendation: string, level: 1 | 2 | 3 | 4 }`; `id` is `q-<work>-<n>`.
    - `report`: `{ work, outcome: 'merged' | 'closed' | 'blocked', pr?, summary: string, rulings: string[], provenance?: object }`.
    - `incident`: `{ id: string, what: string }`. Anyone may declare one: a false alarm costs only a pause, as with STOP.
    - `amendment`: `{ work, change: string, hash: string }`, a proposed change to approved work.
  - Actions added to `action` (each signed, each only from a click):
    - `approve-work` `{ work, lane, hash, shownFirst: boolean }`, from `approveWorkLine(work, lane, hash, { shownFirst })` = `Approve <work> (<lane> lane) as written, <hash12>`, plus `, and show it to me before it merges` when `shownFirst`. Label `Approve`.
    - `answer` `{ questionId, label }`, from `answerLine(questionId)` = `Answer question <questionId>`. Any option's label counts, except `Explain more` and `Not now`.
    - `amend` `{ work, hash }`, from `amendLine(work, hash)` = `Change the approved <work> to this, <hash12>`. Label `Change it`.
    - `lift-incident` `{ incident }`, from `liftIncidentLine(id)` = `End incident <id> and let merges carry on`. Label `End it`.
    - `incident-fix` `{ incident, pr }`, from `incidentFixLine(id, pr)` = `Merge pull request #<pr> as the fix for incident <id>`. Label `Merge the fix`.
  - Views added by `buildViews`: `work` (id → `{ work, approved: boolean, approval?: { hash, shownFirst, lane } }`, an approval counting only when its `hash` is the work's `doc.hash` or, for an amended work, the latest approved amendment's), `features` (work → latest `feature` event), `questions` (id → `{ question, answer: { label, at } | null }`, answers only from verified `answer` actions), `incidents` (`{ open: Array<{ id, what, at, fixes: number[] }> }`: an incident is open until a verified `lift-incident` names it; `fixes` from verified `incident-fix` actions).

- [ ] **Step 1: Write the failing tests.**

```js
test('each new plain kind is accepted with its shape and refused without it', ...)
test('a work id that is not a short slug is refused', ...)
test('each new action needs its own fields and refuses others', ...)
test('Approve on a card with approveWorkLine records approve-work with the lane, hash and shown-first', ...)
test('a click on an answer card records the label; Explain more and Not now record only the card answer', ...)
test('an approval of another hash leaves the work unapproved', ...)
test('an approved amendment moves the hash an approval must name', ...)
test('a question is answered only by a verified answer action', ...)
test('an incident stays open until a verified lift names it; an unsigned lift changes nothing', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement** `build-loop.js` (the constants in Global Constraints), the kinds, the actions, the card lines, the views and the prompt record's new clicks.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Record work, features, questions, reports and incidents in state, with the director's clicks for each"
```

### Task 9: The feature files

**Files:**
- Create: `scripts/feature/files.js`
- Test: `tests/scripts/feature/files.test.js`

**Interfaces:**
- Produces:
  - `FEATURE_DIR = '.wheelhouse/feature'`; `featurePaths(worktree) -> { dir, brief, status, questions, report, rulings }`: `brief.md`, `status.json`, `questions.jsonl`, `report.md`, `rulings.jsonl`.
  - The brief is Markdown whose first block is a fenced `json` block holding `BriefFields = { v: 1, work, lane, version: number, goal: string, done: string[], appetite: { sessions: number, tokens: number }, rulings: Array<{ id, words }>, routing: Record<string, string>, shownFirst: boolean, plan?: string, slices?: number }`, then the text. `parseBrief(text) -> { fields, body }`, throwing `"The brief can't be read"` on anything else. `briefHash(text) -> string` (SHA-256, hex, of the text with line endings evened to LF).
  - `Status = { v: 1, work, lane, phase: 'planning' | 'ready-to-build' | 'building' | 'pr-open' | 'waiting' | 'done', task: { n, m } | null, fixRound: number | null, waitingOn: null | 'question' | 'clash' | 'pace' | 'dependency' | 'ci' | 'review' | 'merge', head: string | null, pr: number | null, slice: { n, m } | null, tokens: number | null, updatedAt: string }`. `readStatus(file) -> Status | null` (null for missing, malformed or wrong-shaped); `writeStatus(file, status)` (atomic).
  - `Question = { id, kind: 'question' | 'extra-plan', what, why, options: Array<{ label, says }>, recommendation, level, plan?: string }`, one per line. An `extra-plan` line is a part the `writing-plans` scope check split off, with its plan's path, for the foreman to queue (design section 4). `readQuestions(file, { maxBytes = 65536 }) -> { questions: Question[], skipped: number }`.
  - The report is Markdown with a fenced `json` block, `ReportFields = { v: 1, work, status: 'done' | 'blocked' | 'partial', pr?, head?, tests: string, assumptions: string[], concerns: string[], rulings: string[] }`, then at most `REPORT_WORDS` words. `parseReport(text) -> { fields, body, words }`.
  - `ensureIgnored(worktree) -> void`: adds `.wheelhouse/` once to `info/exclude` in the repository's common git folder, found with `fs` as `findRepoRoot` does.

- [ ] **Step 1: Write the failing tests.**

```js
test('a brief round-trips through its JSON block and text', ...)
test('a brief without its JSON block, or with a wrong field, cannot be read', ...)
test('the brief hash ignores CRLF line endings', ...)
test('a malformed status reads as null', ...)
test('malformed question lines are skipped and counted; reading stops at 64 KB', ...)  // Review Focus 3
test('a report over 300 words is reported with its count', ...)
test('ensureIgnored adds the entry once, from the folder itself and from a worktree, without running git', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/feature tests
git commit -m "Define the four feature files and read them strictly"
```

### Task 10: The status script and its hook

**Files:**
- Create: `scripts/feature/status.js`, `scripts/hooks/feature-status.js`
- Modify: `hooks/hooks.json`
- Test: `tests/scripts/feature/status.test.js`

**Interfaces:**
- Consumes: `featurePaths`, `readStatus`, `writeStatus`, `readQuestions`, `parseBrief`, `parseReport` (Task 9); `featureSlug`, `findRepoRoot`, `hookMain` (the hook kit).
- Produces:
  - `buildStatus({ worktree, now, tokens = null }) -> Status`, with `fs` only:
    - the ledger is the newest `.superpowers/sdd/*/progress.md` whose first line names the brief's `plan`; `task.m` is the plan's `### Task N` headings, `task.n` the ledger's `Task <N>: complete` lines, `fixRound` the last `Task <N>: fix round <R>/` line of a task not yet complete;
    - `head` from the `.git` HEAD and ref files (packed refs included); `pr` from the last `open-pr` answer the session's command kept (Task 17);
    - `phase` and `waitingOn`: an unanswered question → `waiting`/`question`; a report → `done`; a PR → `pr-open`; a ledger with tasks → `building`; a plan and no ledger → `ready-to-build`; otherwise `planning`.
  - `captureRulings({ worktree }) -> string[]`: appends to `rulings.jsonl` each ledger line holding `Ruling:` not already there, so the rulings survive Superpowers deleting its workspace.
  - The hook, on `PostToolUse` (any tool), `SubagentStop` and `Stop`, in a feature worktree only: `captureRulings`, then `buildStatus` and `writeStatus` when the status changed; at most once every five seconds on `PostToolUse`. It also writes `.wheelhouse/feature/session.json` (`{ sessionId }`, from its input) for Task 17's `open-pr`. It informs, so it says nothing and fails open.

- [ ] **Step 1: Write the failing tests.**

```js
test('task n of m comes from the plan and the ledger', ...)
test('a fix round in progress is read from the ledger', ...)
test('an unanswered question means waiting on a question', ...)
test('the head commit is read from the .git files, loose or packed, from a worktree', ...)
test('rulings are kept after the ledger is deleted', ...)
test('the hook never runs git and does nothing outside a feature worktree', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/feature scripts/hooks hooks tests
git commit -m "Build each feature's status from its ledger and git files, with no tokens"
```

---

## Part 3: the watcher

### Task 11: The watcher's core

**Files:**
- Create: `scripts/watcher/core.js`
- Test: `tests/scripts/watcher/core.test.js`

**Interfaces:**
- Consumes: `STUCK_MS`, `BUNDLE_MS` (Task 8).
- Produces:
  - `Observation = { at, awake: number, events: Array<{ id, kind, data, verified }>, features: Record<work, { status: Status | null, questions: string[], skipped: number, briefHash: string | null, recordedBrief: string | null, report: boolean }>, prs: Record<pr, { work, head, ci: 'success' | 'failure' | 'pending' | 'none', mergeable: 'yes' | 'no' | 'unknown', review: 'clean' | 'findings' | 'none' }>, testMerges: Array<{ a, b, clean }>, stop: boolean }`. `awake` is the milliseconds the watcher has run since its last observation, so a sleep doesn't count as time.
  - `diff(prev, next, { handled: Set<string> }) -> WatchEvent[]`, each `{ type, work?, pr?, id?, detail }`:
    - for the foreman: `work-ready` (a `work` event that is approved, or quick and not visible), `amended` (a verified `amend`), `question` (a new question id in a feature's file), `extra-plan` (a new `extra-plan` line), `answer` (a verified `answer`, which also goes to its feature), `merge-ready` (CI success on the PR's head, a clean review, mergeable), `stuck` (no status change for `STUCK_MS` of awake time while `waitingOn` is null), `over-appetite` (status tokens above the brief's), `clash` (a test merge newly not clean), `stop`, `incident`, `brief-tampered` (the brief's hash is neither the recorded one nor the one before);
    - for the feature: `ci-red`, `findings`, `conflict` (mergeable `no`), `brief-changed` (the recorded hash moved and the file matches it), `answer`;
    - for the digest: `task-done`, `review-passed`, `ci-running`, `pushed`, `progress`, `skipped-lines`.
    An event id in `handled` (the foreman wrote it while handling a wake) goes to the digest.
  - `route(events) -> { foreman: WatchEvent[], features: Record<work, WatchEvent[]>, digest: WatchEvent[] }`.
  - `makeBundler({ windowMs = BUNDLE_MS, now }) -> { add(routed), due(): Array<{ to: 'foreman' | work, events, digest }> }`: events within the window from the first go out together; the digest rides with the next foreman bundle.
  - `readCursor(project) -> { seen: string[], prev: Observation | null }` and `writeCursor(project, cursor)` at `projects/<p>/watcher/cursor.json`, atomic, `seen` capped at the last 5,000 ids.

- [ ] **Step 1: Write the failing tests.**

```js
test('each kind of change goes to the foreman, the feature or the digest as section 11 lists', ...)
test('an event the foreman wrote while handling a wake does not wake it again', ...)        // Review Focus 1
test('events within a minute arrive as one bundle; the digest rides with the next one', ...)
test('stuck counts awake time only, and never while waiting', ...)                         // Review Focus 2
test('after a restart from the cursor, nothing is lost and nothing wakes twice', ...)       // Review Focus 2
test('a brief changed by anyone but the foreman is tampered, not amended', ...)             // Review Focus 3
test('a status with no tokens never counts as over appetite', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/watcher tests
git commit -m "Turn what the watcher sees into wakes, bundled, once each"
```

### Task 12: What the watcher reads, and test merges in the helper

**Files:**
- Create: `scripts/watcher/sources.js`
- Modify: `scripts/host/helper.js`, `scripts/host/helper-client.js`
- Test: `tests/scripts/watcher/sources.test.js`, `tests/scripts/host/helper-test-merge.test.js`

**Interfaces:**
- Consumes: `listEvents`, `buildViews`, `readEnrolled` (state, read with `fs` from the clone); `featurePaths`, `readStatus`, `readQuestions`, `briefHash` (Task 9); `helperClient`.
- Produces:
  - `observe({ project, client, now, intervals }) -> Promise<Observation>`: syncs state through `/state/sync`, reads the clone with `fs`, reads each running feature's files from its worktree (from the `features` view), asks `/pr/state` and `/ci` for each open PR, and `/test-merge` for each pair of building features' branches when `intervals.testMerge` has passed.
  - `INTERVALS = { state: 30000, features: 15000, prs: 60000, testMerge: 600000 }` (*Plan's call*, within section 11's wake rules).
  - Helper route `/test-merge { project, a, b }` → `{ ok: true, clean: boolean, conflicts: string[] }`: a keyed fetch of both branches into the mirror, then `git merge-tree --write-tree --name-only refs/wheelhouse/tm/a refs/wheelhouse/tm/b`; the working refs are dropped after. Read-only, so STOP lets it through. `helperClient` gains `testMerge(a, b)`.

- [ ] **Step 1: Write the failing tests.**

```js
test('observe reads state, feature files and PRs into one observation', ...)
test('a feature whose worktree is gone is reported, not thrown', ...)
test('/test-merge reports a clean pair and a conflicting pair, naming the files', ...)
test('/test-merge runs nothing from either branch', ...)   // a branch holding a git hook and a .gitattributes filter
test('under STOP, /test-merge still answers', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/watcher scripts/host tests
git commit -m "Let the watcher read state, the feature files and the host, and test-merge in the helper's mirror"
```

### Task 13: The waker and the watcher process (by check 27's answer)

**Files:**
- Create: `scripts/watcher/waker.js`, `scripts/watcher/main.js`
- Modify: `scripts/protection/settings.js` (allow rules for feature sessions), `hooks/hooks.json` or `.claude-plugin/plugin.json` (Shape 2's monitor)
- Test: `tests/scripts/watcher/waker.test.js`, `tests/scripts/watcher/main.test.js`

**Interfaces:**
- Consumes: `observe`, `INTERVALS` (Task 12); `diff`, `route`, `makeBundler`, `readCursor`, `writeCursor` (Task 11); `start-lock.js` (one per computer and project); `stopState`.
- Produces:
  - `writeWake(project, bundle) -> string`: the bundle as `projects/<p>/watcher/wakes/<time>.json`; the wake message is one line naming that file.
  - `makeWaker({ shape: 1 | 2, project, run, config }) -> { wakeForeman(file), wakeFeature(work, file), startFeature({ work, worktree, briefFile }) }`.
    - **Shape 1:** each call uses the route check 27 found. `wakeForeman` starts a fresh foreman session with the prompt `Wheelhouse foreman: handle <file>`, the foreman's model from `config.routing.foreman` and the mode from `config.sessionMode`; at most one foreman session runs at a time per project, and a bundle due while one runs waits for it to end. `wakeFeature` sends `Wheelhouse: read <file>` to the feature's session. `startFeature` starts a session in the worktree with `Read .wheelhouse/feature/brief.md and follow it.`
    - **Shape 2:** `wakeForeman` prints `WAKE foreman <file>` on stdout, which the plugin monitor delivers to the long-lived foreman session; `wakeFeature` prints `WAKE feature <work> <file>` and the foreman relays it by cross-session message; `startFeature` prints `START feature <work> <worktree>` for the foreman to start by the app's own session starter.
  - `config.sessionMode`: default `acceptEdits`; `bypassPermissions` is refused (main design, section 8). `featureAllowRules(config) -> string[]`: `Bash(<command>:*)` for each of `config.buildCommands` (default `npm test`, `npm run`, `node`), added to the project's `permissions.allow` by `projectSettings`.
  - `main.js`, run as `node scripts/watcher/main.js <project>`: one per project (start lock); loops `observe` → `diff` → `route` → bundle → wake, writing the cursor after each wake; writes `projects/<p>/watcher/health.json` (`{ pid, at, shape }`) each loop. **Shape 1:** started detached and hidden by `scripts/foreman/start.js` (Task 19) and by the session start when it isn't running. **Shape 2:** run by the plugin monitor, in the foreman's session only (by the limit check 26 found).

- [ ] **Step 1: Write the failing tests,** with a fake `run` and fake clock.

```js
test('a foreman bundle starts one fresh foreman with the configured model and mode', ...)   // Shape 1
test('a second bundle while a foreman runs waits for it', ...)                               // Shape 1
test('a feature bundle wakes only that feature\'s session', ...)
test('Shape 2 prints one line per wake and starts nothing itself', ...)                      // Shape 2
test('bypass mode is refused for feature sessions', ...)
test('a second watcher for the same project does not start', ...)
test('the cursor is written after each wake, so a crash mid-loop wakes again, not never', ...)
```

  Write only the chosen shape's tests and code; the interface stays the same.
- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/watcher scripts/protection hooks .claude-plugin tests
git commit -m "Wake the foreman and feature sessions by the route check 27 found"
```

---

## Part 4: the foreman, the intake and the lanes

### Task 14: The queue and the clash check

**Files:**
- Create: `scripts/foreman/queue.js`
- Modify: `scripts/gate/guardrails.js` (`hotFiles` and `flagFiles` in `Config`)
- Test: `tests/scripts/foreman/queue.test.js`

**Interfaces:**
- Consumes: `PACE` (Task 8); `matchGlob`, `readConfig` (`scripts/gate/`).
- Produces:
  - `Config` gains `hotFiles: string[]` (default `['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '**/migrations/**']`, plus the project's route files, which it lists itself), `flagFiles: string[]` (default `[]`), `routing: { foreman, builder, reviewer, reviewerCritical, tester, mechanical }` (model names; the main design's routing table, section 8), `sessionMode: string` (default `acceptEdits`), `buildCommands: string[]` (default `['npm test', 'npm run', 'node']`). Task 13 reads the last three, so this part of the task comes first.
  - `fileMapOf(planText) -> string[]`: every backticked path on a `- Create:`, `- Modify:` or `- Test:` line under a task's `**Files:**`, without `:<lines>` suffixes, deduplicated.
  - `clashCheck({ files, running: Array<{ work, files }>, hotFiles }) -> { ok: boolean, clashes: Array<{ work, file, hot: boolean }> }`: a clash is a file in both maps, or both touching paths matching the same hot pattern (so two new migrations clash).
  - `nextWork({ work, features, now, fiveHourTight }) -> { start: string[], hold: Array<{ work, why: 'pace' | 'dependency' | 'unapproved' }>, pause: string[] }`: approved or quick-and-not-visible work, in order of `place` then age; at most `PACE.building` building and `PACE.featureLane` of them in the feature lane; work whose `dependsOn` hasn't merged waits; with `fiveHourTight`, the newest building work pauses first.

- [ ] **Step 1: Write the failing tests.**

```js
test('fileMapOf reads the plan\'s Files lists', ...)
test('two plans changing the same hot file clash; the second waits with its plan ready', ...)   // scenario 28
test('two new migrations clash by the hot pattern', ...)
test('pace allows three building, one in the feature lane', ...)
test('small and feature work never starts without an approval', ...)
test('under five-hour pressure the newest work pauses first', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/foreman scripts/gate tests
git commit -m "Queue work at the design's pace and check each plan for clashes before it builds"
```

### Task 15: The brief and the lanes

**Files:**
- Create: `scripts/feature/brief.js`, `templates/brief/brief.md`, `templates/brief/lanes/quick.md`, `templates/brief/lanes/small.md`, `templates/brief/lanes/feature.md`, `templates/brief/lanes/bug.md`
- Modify: `templates/brief/override.md` (from check 25, if it calls for a change)
- Test: `tests/scripts/feature/brief.test.js`

**Interfaces:**
- Consumes: `BriefFields`, `parseBrief`, `briefHash` (Task 9); `FIX_ROUNDS` (Task 8); check 25's finding on where the override goes.
- Produces:
  - `renderBrief({ fields: BriefFields, pluginRoot }) -> string`: the JSON block, then in order: the override (whole, from `templates/brief/override.md`); the goal and done contract ("turn each line into a test before any code"); the appetite; the rulings that apply; the lane's loop; how to ask (Task 17's `ask` command; never `AskUserQuestion`); how to finish (Task 17's `report` and `open-pr`); "report, never ask for a permission: write a question and pause"; the models by role.
  - The lanes, from design sections 4, 5.1, 5.3 and 6:
    - `quick.md`: `/implement`'s five lines word for word, read from the installed Matt Pocock's skills at render time and checked against the register's carried-text fingerprint (Task 25; until then, against the text in the template); start `mattpocock-skills:tdd` and then `mattpocock-skills:code-review` by name; no plan.
    - `small.md`: `superpowers:using-git-worktrees`, `superpowers:writing-plans`, then `superpowers:executing-plans`; every fix re-reviewed; each extra part the scope check splits off goes back with `ask --kind extra-plan --plan <path>`.
    - `feature.md`: one plan per slice; `superpowers:subagent-driven-development`; the tester (`wheelhouse:tester`) after the whole-branch review; each slice behind its flag, under about 600 lines; while slice n's PR waits, plan slice n+1, and build it once slice n has merged.
    - `bug.md`: `superpowers:systematic-debugging`; cannot reproduce → `ask`; works as designed → report `blocked` with the finding; one-step cause → the quick lane's loop with a regression test; bigger → the reproduction test and findings in the report, status `partial`.
    - Every lane: the lane only goes up, so work that proves bigger than its lane stops and reports `partial` with what it found; `superpowers:verification-before-completion` before saying anything is done; `mattpocock-skills:resolving-merge-conflicts` when a wake says the branch conflicts; reviews by `wheelhouse:reviewer`, builders by `wheelhouse:builder`, each with the model the brief names for its role.
  - `amendBrief(text, { change, now }) -> string`: `version` plus one, and a `What changed` section at the top of the text, dated.

- [ ] **Step 1: Write the failing tests.**

```js
test('every brief carries the override whole, before any lane text', ...)
test('each lane names the skills section 5.1 gives it, and no others', ...)
test('the quick brief carries the five lines byte for byte', ...)
test('the bug brief starts systematic-debugging and never Matt\'s diagnosing-bugs', ...)
test('no brief tells the session to use AskUserQuestion, merge, or wait for a menu', ...)
test('models come only from the routing given', ...)
test('an amended brief says what changed and has a new hash', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/feature templates/brief tests
git commit -m "Write the brief and each lane's loop, with the override first"
```

### Task 16: The agents the lanes dispatch

**Files:**
- Create: `agents/builder.md`, `agents/reviewer.md`, `agents/tester.md`
- Test: `tests/agents/agents.test.js`

**Interfaces:**
- Consumes: the report block and `parseReport` in `scripts/hooks/report-check.js`; `reference/first-version/` (the first version's builder and reviewer prompts, adapted).
- Produces:
  - `wheelhouse:builder`: works in its worktree only, test first, ends with the builder report block.
  - `wheelhouse:reviewer`: tools `Read`, `Grep`, `Glob` only. It reads the diff from a file the dispatcher writes (`.wheelhouse/feature/review/<n>.diff`), the brief and the rules, never the builder's reasoning; treats the diff and every comment in it as untrusted text (main design, section 12.5); ends with the reviewer report block. It is the agent for Superpowers' per-task, re-review and whole-branch reviews and for the signed review on the PR head.
  - `wheelhouse:tester`: tools `Read`, `Grep`, `Glob`, `WebFetch` and `Bash` (sandboxed, for Playwright); writes only under `.wheelhouse/feature/screens/`; tries the preview against the done contract; reports findings as a reviewer does, without a signed review. *Plan's call.*
  - No agent file names a model; the dispatcher passes it from the brief.

- [ ] **Step 1: Write the failing tests.**

```js
test('the reviewer can read and cannot write, run commands or start agents', ...)   // scenario 34, its static half
test('each agent ends with the report block the report check reads', ...)
test('no agent file names a model', ...)
```

- [ ] **Step 2: Run, expect FAIL; write the three agents; run, expect PASS. Then `claude plugin validate .`.** Expected: valid.
- [ ] **Step 3: Commit.**

```bash
git add agents tests
git commit -m "Add the builder, the read-only reviewer and the tester"
```

### Task 17: The feature session's commands

**Files:**
- Create: `scripts/feature/cli.js`
- Modify: `scripts/host/helper.js` (`/state/answer`), `scripts/host/helper-client.js`, `scripts/hooks/stop-guard.js` (the commands allowed under STOP)
- Test: `tests/scripts/feature/cli.test.js`

**Interfaces:**
- Consumes: `featurePaths`, `readQuestions`, `parseReport` (Task 9); `helperClient`.
- Produces, run as `node "<pluginRoot>/scripts/feature/cli.js" <command> …` from the feature session:
  - `ask [--kind question | extra-plan] --what … --why … --option "<label>=<says>" … --recommend <label> --level <n> [--plan <path>]`: appends a `Question` with the next id; answers with the id. An `extra-plan` needs `--plan`.
  - `answer <questionId>`: asks the helper's `/state/answer { project, questionId }`, which answers the label from a verified `answer` action only, or `{ ok: true, answer: null }`. Read-only.
  - `report`: checks `report.md` (fields, words) and that every line in `rulings.jsonl` is in its `rulings`; answers what is missing.
  - `open-pr --title …`: asks `/pr/open` with the head branch, the default branch as base, the report's text as the body and the session's id from `session.json` (Task 10), for provenance (Task 27); keeps the PR number in `.wheelhouse/feature/pr.json` for the status script.
  - Under STOP, `answer` and `report` are let through, as reading and reporting carry on.

- [ ] **Step 1: Write the failing tests,** with a fake helper.

```js
test('ask writes a question with the next id and the session can read it back', ...)
test('answer gives only a verified answer; an unsigned card answer gives none', ...)
test('report names each ruling missing from the report', ...)
test('open-pr opens against the default branch and keeps the number', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/feature scripts/host scripts/hooks tests
git commit -m "Give feature sessions commands to ask, read answers, report and open their PR"
```

### Task 18: The intake

**Files:**
- Create: `skills/intake/SKILL.md`, `scripts/intake/similar.js`
- Test: `tests/scripts/intake/similar.test.js`

**Interfaces:**
- Consumes: the views (`work`, ideas, rejections).
- Produces:
  - `similar(text, views, { limit = 5 }) -> Array<{ kind: 'work' | 'idea' | 'rejection', id, title, score }>`: word overlap after lower-casing and dropping common words, so the duplicate check reads five lines, not the lists.
  - `skills/intake/SKILL.md`, written with `superpowers:writing-skills` (its tests are scenarios 25, 26, 27 and 35, Task 31): split a message into requests; check each with `similar`; the nine questions of design section 3 in order, first yes wins; say the route in one line; start the route's skill by name (`superpowers:brainstorming` for a change; never `superpowers:writing-plans`, never its "do it" size); an approved design or brief goes to the queue as a `work` event, with an `approve-work` card from `approveWorkLine`; a change to running work is read back and asked with `amendLine`; an incident is contained at once (the runbook's step 5), writes `incident`, tells the director, and later asks with `incidentFixLine` and `liftIncidentLine`; alongside any route, `mattpocock-skills:domain-modeling` for a new term and `mattpocock-skills:prototype` for a visible change before approval.

- [ ] **Step 1: Write the failing test** for `similar` (a duplicate scores highest; an unrelated item scores zero), run it, implement, run it again.
- [ ] **Step 2: Write the skill** with `superpowers:writing-skills`, its baseline being scenarios 25, 26, 27 and 35 run without it (Task 3's harness).
- [ ] **Step 3: Run `npm test` and `claude plugin validate .`.** Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add skills/intake scripts/intake tests
git commit -m "Add the front desk's routing of everything that arrives"
```

### Task 19: The foreman

**Files:**
- Create: `skills/foreman/SKILL.md`, `scripts/foreman/start.js`, `scripts/foreman/wake.js`
- Test: `tests/scripts/foreman/wake.test.js`, `tests/scripts/foreman/start.test.js`

**Interfaces:**
- Consumes: `nextWork`, `clashCheck`, `fileMapOf` (Task 14); `renderBrief`, `amendBrief` (Task 15); `makeWaker` (Task 13); `helperClient`.
- Produces:
  - `wake.js read <file>`: prints the bundle for the foreman as short lines (one per event, the digest counted, not listed), with the queue's answer and any clash already worked out, so the foreman reads conclusions, not files. `wake.js done <file> --acted | --idle`: appends the outcome to `projects/<p>/watcher/measures.jsonl`.
  - `measures(project) -> { idleShare: number, conflictsPerMerge: number }`, for design section 15's measures.
  - `start.js <project>`: **Shape 1:** starts the watcher detached and hidden if it isn't running, and nothing else. **Shape 2:** the foreman's long session's start: its explicit mode and model, its own settings file with `autoCompactWindow` at `FOREMAN_FALLBACK_COMPACT`, and the watcher as its monitor.
  - `skills/foreman/SKILL.md`, written with `superpowers:writing-skills`, no Superpowers or Matt skills inside it: at each wake, read the bundle with `wake.js read`; for work ready, write the brief (`renderBrief`), make the worktree on `feature/<work>`, `ensureIgnored`, record a `feature` `started` event with the brief's hash, `startFeature`; when a plan is ready, `fileMapOf` and `clashCheck`, then `building` or a hold; `nextWork` with `fiveHourTight` false until the usage plan supplies it; for a question, record it as a `question` event; for an extra plan, queue it as `work` with `parent` set; for an answer, nothing (the watcher wakes the session); for an amendment, amend the brief, recording its new hash before writing the file, so the watcher reads the change as `brief-changed` and not as tampering; for merge-ready, `/pr/update-branch`, then `/merge` (Task 21); for stuck, over appetite or a tampered brief, a question for the director; for STOP or an incident, pause new starts; at a feature's end, record the `report` with its rulings and close the session; end with `wake.js done`. It never builds, never plans, and never messages the front desk.

- [ ] **Step 1: Write the failing tests.**

```js
test('wake read gives one line per event and a count for the digest', ...)
test('wake done records acted or idle, and measures gives the idle share', ...)
test('start starts the watcher once', ...)        // Shape 1; for Shape 2: its settings compact at 100,000
```

- [ ] **Step 2: Run, expect FAIL; implement the scripts; run, expect PASS.**
- [ ] **Step 3: Write the skill** with `superpowers:writing-skills`; its baseline scenarios are 26 and 28 to 30 run as a foreman wake against the end-to-end fixture (Task 30).
- [ ] **Step 4: Run `npm test` and `claude plugin validate .`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add skills/foreman scripts/foreman tests
git commit -m "Add the thin foreman: a playbook over the queue, the brief and the wake bundle"
```

---

## Part 5: the gate

### Task 20: The gate's inputs for the new conditions

**Files:**
- Modify: `scripts/gate/conditions.js`
- Test: `tests/scripts/gate/conditions.test.js`

**Interfaces:**
- Produces: `gateDecision` takes three more inputs, each failing its condition unless exactly as stated:
  - `upToDate: true`, else `'the branch is not up to date with the default branch'`;
  - `provenance: { ok: true }`, else `'the pull request\'s provenance does not match the manifest: <why>'`;
  - `incident: { open: false }` or `{ open: true, isFix: true }`, else `'incident <id> is open, so only its fix may merge'`.
  - `review` may also be `{ carried: true, record }`: a verified CLEAN review of an earlier commit that Task 21 found still counts. `approval` likewise.
  A restore keeps its exceptions (no review); an open incident refuses a restore too, unless the restore is named as its fix.

- [ ] **Step 1: Write the failing tests** for each new reason, for a carried review counting, and for the restore under an incident.
- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/gate tests
git commit -m "Add the gate's conditions for an up-to-date branch, provenance and incidents"
```

### Task 21: Bringing a branch up to date, and what carries over

**Files:**
- Modify: `scripts/host/helper.js` (`/pr/update-branch`, `mergeAnswer`), `scripts/host/helper-client.js`, `scripts/host/github.js`, `scripts/host/gitlab.js` (the PR's body)
- Test: `tests/scripts/host/helper-update.test.js`

**Interfaces:**
- Consumes: `gateDecision` (Task 20); the mirror, `checkPush`, `pushOwn`.
- Produces:
  - `/pr/update-branch { project, number }` → `{ ok: true, updated: boolean, head }` or `{ ok: false, refused: 'the branch conflicts with the default branch', conflicts }`: in the mirror, `git merge-tree --write-tree` of the PR head and the default branch; when clean and the head is behind, a merge commit (`git commit-tree <tree> -p <head> -p <default>`) pushed to the PR's branch with the connection's key through the push rules (so a CI file arriving from the default branch is not counted as the branch's change). Refused under STOP.
  - `patchIdOf({ base, head }) -> string`: `git diff <merge-base> <head>` piped to `git patch-id --stable`, in the mirror.
  - `cleanUpdate(commit) -> boolean`: the commit has two parents and its tree equals `git merge-tree --write-tree` of them.
  - In `mergeAnswer`: `upToDate` when the default branch's head is an ancestor of the PR head. The latest verified CLEAN review of an earlier commit carries over when its patch-id equals the head's and every commit after it is a clean update; otherwise a review of the head is needed. The director's approval carries over on the same patch-id **and** `screenshotsMatch(old, new)`, a dependency that answers `false` until the front desk's plan builds the screenshot comparison, so the director is asked again meanwhile (fails safe).
  - The adapters' `prState` gains `body`.

- [ ] **Step 1: Write the failing tests,** with the stand-in host.

```js
test('update-branch merges the default branch in and pushes the merge commit', ...)
test('update-branch on a conflicting branch refuses, naming the files', ...)
test('A merges while B is ready: B is brought up to date and its review carries over', ...)   // scenario 29
test('a review does not carry over when the feature\'s own changes moved', ...)
test('a review does not carry over when the update merge changed code itself', ...)          // Review Focus 4
test('an approval does not carry over until screenshots can be compared', ...)
test('a branch behind the default branch cannot merge', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/host tests
git commit -m "Bring a branch up to date at the gate, and carry its review over when its own changes did not move"
```

### Task 22: Incidents, and which pull requests are shown first

**Files:**
- Modify: `scripts/host/helper.js` (`mergeAnswer`)
- Test: `tests/scripts/host/helper-incident.test.js`

**Interfaces:**
- Consumes: the `incidents` and `work` views (Task 8); `classifyChange`, `Config.flagFiles` (Task 14).
- Produces, in `mergeAnswer`:
  - `incident` from the `incidents` view: open when any incident is; `isFix` when a verified `incident-fix` names this PR.
  - Shown first, read only from the signed `approve-work` of the work the PR's branch names (`feature/<work>` or `feature/<work>/<slice>`): when `shownFirst`, the director's approval is needed; for feature-lane work, only on a PR that changes one of `config.flagFiles` (the switch-on), and on every PR when the project lists none (fails safe). A branch that names no approved work adds nothing (quick work, with the main design's guardrail and level rules unchanged).

- [ ] **Step 1: Write the failing tests.**

```js
test('an incident is declared while two PRs are ready: neither merges; the fix does', ...)   // scenario 30
test('an unsigned fix record does not let a PR through', ...)
test('the director\'s click on End it lifts the freeze', ...)
test('a shown-first small change needs the director\'s approval', ...)
test('a flag-off slice merges without it; the switch-on PR needs it', ...)
test('shown-first work in a project with no flag files needs approval on every PR', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/host tests
git commit -m "Freeze merges during an incident, and read shown-first from the signed approval"
```

---

## Part 6: lineage

### Task 23: Fingerprints and the manifest

**Files:**
- Create: `scripts/lineage/fingerprint.js`, `scripts/lineage/manifest.js`, `lineage/manifest.json`
- Test: `tests/scripts/lineage/fingerprint.test.js`, `tests/scripts/lineage/manifest.test.js`

**Interfaces:**
- Consumes: check 24's findings (where each pinned copy is installed; the commits).
- Produces:
  - `fingerprintTree(dir) -> { hash: string, files: number }`: every file under `dir`, by its path relative to `dir` with `/` separators, sorted by code point; text (no NUL byte in the first 8 KB) with CRLF and lone CR evened to LF; a link hashed as the text of its target, never followed; `hash` is SHA-256 over `<path>\0<sha256 of content>\n` for each. `fingerprintFile(file)` the same for one file.
  - `Manifest = { v: 1, wheelhouse: { version }, upstreams: Array<{ name, plugin, repo, ref, sha, folders: Array<{ path, hash }>, files: Array<{ path, hash }> }>, claudeCode: { floor }, models: 'the routing table in .claude/wheelhouse.json' }`. Superpowers' folders: the skills section 5.1 uses (`brainstorming`, `using-git-worktrees`, `writing-plans`, `subagent-driven-development`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `dispatching-parallel-agents`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `finishing-a-development-branch`) and `using-superpowers`, which its session-start hook loads; its files: `hooks/session-start`, `hooks/hooks.json`, `LICENSE`. Matt's folders: `tdd`, `code-review`, `prototype`, `domain-modeling`, `resolving-merge-conflicts`, and the folder holding `/implement`; his files: the licence.
  - `readManifest(root) -> Manifest`; `locateInstalled(upstream) -> string | null` (by check 24's route); `checkInstalled({ manifest, locate = locateInstalled }) -> { ok: boolean, mismatches: Array<{ upstream, path, want, got: string | null }> }`.
  - `scripts/lineage/manifest.js write`: fills the hashes from the installed copies, for Wheelhouse's release work only.

- [ ] **Step 1: Write the failing tests.**

```js
test('the same folder checked out with CRLF and with LF has one fingerprint', ...)   // Review Focus 5
test('paths are sorted and joined with / on every system', ...)
test('a link is hashed as its target text and not followed', ...)
test('a binary file is hashed as it is', ...)
test('checkInstalled names each folder that differs, and a missing install', ...)
test('the manifest\'s commits are the marketplace\'s pins', ...)   // after Task 24
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Write `lineage/manifest.json`** from the installed copies, at the commits check 24 recorded. Time it: fingerprinting Superpowers' skills should take milliseconds (design section 14.6); record the figure in the commit message.
- [ ] **Step 4: Commit.**

```bash
git add scripts/lineage lineage tests
git commit -m "Fingerprint the upstream folders Wheelhouse uses, and write the manifest"
```

### Task 24: The pins, and the settings a project gets

**Files:**
- Modify: `.claude-plugin/marketplace.json`, `scripts/protection/settings.js`
- Test: `tests/scripts/protection/settings.test.js`, `tests/scripts/lineage/pins.test.js`

**Interfaces:**
- Consumes: check 24's findings (names to switch off; the auto-update setting); check 28's (the channel and minimum-version settings); `readManifest` (Task 23).
- Produces:
  - `.claude-plugin/marketplace.json` lists `superpowers` and `mattpocock-skills` beside `wheelhouse`, each with `source: { source: 'github', repo, ref, sha }` at the manifest's commits.
  - `projectSettings` adds: the Wheelhouse marketplace with auto-update off; `enabledPlugins` true for `superpowers@wheelhouse` and `mattpocock-skills@wheelhouse` and false for Anthropic's copy of Superpowers and the synced copies (names from check 24); and `featureAllowRules` (Task 13).
  - `claudeCodeSettings({ floor }) -> object`: the stable channel and the minimum version (`manifest.claudeCode.floor`), for setup to write where check 28 says.

- [ ] **Step 1: Write the failing tests.**

```js
test('the marketplace pins each upstream at the manifest\'s commit, with a full sha', ...)
test('the project settings switch on the pinned copies and off every other copy', ...)
test('auto-update is off for the Wheelhouse marketplace', ...)
test('claudeCodeSettings sets the stable channel and the floor', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS; then `claude plugin validate .`.**
- [ ] **Step 3: Commit.**

```bash
git add .claude-plugin scripts/protection tests
git commit -m "Pin Superpowers and Matt Pocock's skills in Wheelhouse's marketplace, and switch the other copies off"
```

### Task 25: The register

**Files:**
- Create: `scripts/lineage/register.js`, `lineage/register.json`
- Test: `tests/scripts/lineage/register.test.js`

**Interfaces:**
- Consumes: `fingerprintFile` (Task 23); `templates/brief/override.md` (Task 3).
- Produces:
  - `Register = { v: 1, version: string, overrides: Array<{ id, skill, anchors: Array<{ file, text }>, rule, why, scenario: number }>, carried: Array<{ id, upstream, file, hash, text }>, assumptions: Array<{ id, says, check: number, retest: 'script' | 'person', feature: string }> }`.
  - The seven overrides, anchored on Superpowers 7.0.0's own sentences (quoted exactly, checked against the installed files when the register is written):

| id | Skill | Anchor | Scenario |
|---|---|---|---|
| fix-rounds | subagent-driven-development | `Five rounds maximum per task:` | 20 |
| re-review | executing-plans | `Critical/Important → ONE fix pass` | 21 |
| no-rulings-at-3-4 | subagent-driven-development, executing-plans | `**Rulings, not stalls.**` (in each) | 22 |
| nothing-waits | writing-plans, finishing-a-development-branch | `link it for your human partner`; `1. Merge back to <base-branch> locally` | 23 |
| front-desk | brainstorming | `\| A quick, clear task \| the request itself \| do it \|`; `invoke superpowers:writing-plans and no other skill` | 35 |
| models | subagent-driven-development | `Use the least powerful model that can handle each role to conserve cost and increase speed.` | 33 |
| reviewers | subagent-driven-development, requesting-code-review | `Subagent (general-purpose):` (in `task-reviewer-prompt.md` and `re-review-prompt.md`); ``Dispatch a `general-purpose` subagent`` | 34 |

  - The carried text: `/implement`'s five lines, with its file's fingerprint.
  - The assumptions, each with the check behind it: Claude cannot start a skill marked `disable-model-invocation` (design section 6; script); a Monitor-tool watch ends after 30 minutes (check 26; person); the override wins (check 25; script); the pins hold and the other copies stay off (check 24; person, for the synced copies); the hold refuses on both systems (check 29; person on Windows); the undo works after the clean-up (check 30; script); the route that starts and wakes sessions (check 27; person); the update channel in Desktop (check 28; person); Claude Code's list of installed plugins keeps the shape `locateInstalled` reads (check 24; script).
  - `checkAnchors({ register, root }) -> Array<{ id, file, text }>`: each anchor not found in its file under `root` (an upstream's checkout or installed folder). `checkCarried({ register, root }) -> string[]`: each carried text whose source file changed.
  - `checkOverrideText({ register, overrideText }) -> string[]`: each override whose rule doesn't appear in `templates/brief/override.md`, so the two can't drift.
  - Wheelhouse's own `.claude/wheelhouse.json` names a critical area `lineage` whose checks are `lineage/**`, `.claude-plugin/marketplace.json` and `templates/brief/override.md`, so a change to any of them is a guardrail change with an independent review (design section 14.3).

- [ ] **Step 1: Write the failing tests,** with a fixture folder copying only the anchor lines.

```js
test('every anchor is found in a folder that holds it', ...)
test('an anchor sentence that has gone is named', ...)
test('a changed carried-text source is named', ...)
test('each override has its rule in override.md and a scenario from 20 to 35', ...)
test('every assumption names a check and says whether a person must re-test it', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; write `lineage/register.json`; run `node scripts/lineage/register.js check <installed Superpowers folder>`.** Expected: no broken anchors.
- [ ] **Step 3: Run `npm test`.** Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add scripts/lineage lineage tests
git commit -m "Write the register: the seven overrides with their anchors, the carried text and the assumptions"
```

### Task 26: The session-start warning and the pre-tool hold

**Files:**
- Create: `scripts/hooks/lineage-hold.js`, `scripts/lineage/check.js`
- Modify: `scripts/hooks/session-start.js`, `hooks/hooks.json`, `scripts/protection/locked.js` (the managed hook list)
- Test: `tests/scripts/hooks/lineage-hold.test.js`, `tests/scripts/hooks/session-start.test.js`

**Interfaces:**
- Consumes: `checkInstalled`, `readManifest` (Task 23); `READ_TOOLS` and the plugin-path matching in `stop-guard.js`; the kit.
- Produces:
  - `holdFile(project) -> string`: `projects/<p>/lineage/hold.json`, `{ at, mismatches }`.
  - In the session start, in a Wheelhouse project: `checkInstalled`; on a mismatch it writes the hold file and adds, first after STOP, `Lineage: the installed <upstream> files differ from Wheelhouse's manifest (<paths>). Edits and commands are held. Raise this with the director as a card.`; on a match it removes the hold file. It also writes `projects/<p>/sessions/<session_id>/provenance.json`, `{ wheelhouse, upstreams: { <name>: sha }, register, claudeCode, fingerprints: 'match' | 'mismatch' }`.
  - `lineage-hold.js` `decide(input)`, PreToolUse on `*`, a guard (fails closed, `onFailure: 'block'`): while the hold file exists, allows `READ_TOOLS` and the `Bash` command `node <pluginRoot>/scripts/lineage/check.js` only, else denies with `'Wheelhouse is holding edits and commands: the installed skills differ from its manifest'`.
  - `check.js`: runs `checkInstalled`, removes the hold file when it matches, and says which files still differ.
  - The same hook joins Locked's managed hook list.

- [ ] **Step 1: Write the failing tests.**

```js
test('an installed Superpowers file that differs raises the warning and writes the hold', ...)   // scenario 31
test('while held, Edit, Write and Bash are refused and Read is not', ...)                        // scenario 31
test('the check command is let through, and clears the hold once the files match', ...)
test('a hold hook that throws refuses', ...)
test('provenance is written at each session start', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/hooks scripts/lineage scripts/protection hooks tests
git commit -m "Warn at session start and hold edits when the installed skills differ from the manifest"
```

### Task 27: Provenance, at the gate and in CI

**Files:**
- Create: `scripts/lineage/provenance.js`
- Modify: `scripts/host/helper.js` (`/pr/open`, `/pr/update`, `mergeAnswer`), `scripts/feature/cli.js` (`report` stamps it), `.github/workflows/ci.yml` (a `lineage` job)
- Test: `tests/scripts/lineage/provenance.test.js`, `tests/scripts/host/helper-provenance.test.js`

**Interfaces:**
- Consumes: the session's `provenance.json` (Task 26); `readManifest` (Task 23); `checkAnchors` (Task 25); `gateDecision`'s `provenance` (Task 20).
- Produces:
  - `Provenance = { wheelhouse, upstreams: Record<string, string>, register, claudeCode, models: string[], fingerprints: 'match' | 'mismatch' }`; `models` from the session's transcript entries, read with `readTailEntries`.
  - `stampProvenance(body, provenance) -> string`: replaces anything between `<!-- wheelhouse-provenance -->` and `<!-- /wheelhouse-provenance -->` (or appends) with a short block, one line each. `parseProvenance(body) -> Provenance | null`.
  - `provenanceMatches(provenance, manifest) -> { ok: boolean, why?: string }`: the Wheelhouse version and every upstream commit equal the manifest's; fingerprints `match`; Claude Code at or above the floor.
  - `/pr/open` and `/pr/update` take `session` and always stamp the body themselves, from that session's file, so a caller's block is replaced; a session with no file on this computer is refused. `mergeAnswer` reads the block from `prState`'s body and passes `provenanceMatches` against the installed Wheelhouse's own manifest (`pluginRoot/lineage/manifest.json`).
  - CI job `lineage` (Wheelhouse's repository): for each upstream, a shallow fetch at the manifest's `sha`; `fingerprintTree` of each folder equals the manifest; `checkAnchors` and `checkCarried` find nothing broken; the marketplace's pins equal the manifest's commits.

- [ ] **Step 1: Write the failing tests.**

```js
test('the block round-trips, and a second stamp replaces the first', ...)
test('a caller\'s own block is replaced by the helper\'s', ...)
test('a PR built with a mismatched or older install cannot merge', ...)   // scenario 31
test('a PR with no block cannot merge', ...)
test('the report carries the same block', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.** Push the branch only on the director's yes; then CI's `lineage` job: expected green.
- [ ] **Step 3: Commit.**

```bash
git add scripts .github tests
git commit -m "Stamp every PR with what built it, refuse a mismatch at the gate, and check the manifest in CI"
```

### Task 28: The upgrade path, in Wheelhouse's repository

**Files:**
- Create: `scripts/lineage/upgrade.js`, `docs/lineage/upgrading.md`
- Test: `tests/scripts/lineage/upgrade.test.js`

**Interfaces:**
- Consumes: `fingerprintTree`, `readManifest` (Task 23); `checkAnchors`, `checkCarried` (Task 25); `UPGRADE` (Task 8).
- Produces:
  - `upgradeDue({ lastUpgrade, release: { tag, publishedAt }, now, security = false }) -> { due: boolean, why }`: due when the release is at least `UPGRADE.minAgeDays` old and the last upgrade at least `UPGRADE.everyDays` ago; a security fix is due at once.
  - `planUpgrade({ manifest, register, candidates: Record<name, { dir, ref, sha }> }) -> { kind: 'plumbing' | 'changed' | 'stopped', changed: Array<{ upstream, path }>, broken: Array<{ id, file, text }>, carriedChanged: string[], licenceChanged: boolean, retest: string[] }`: `plumbing` when no folder the manifest lists changed; `stopped` when an anchor is gone or carried text changed; `changed` otherwise. `retest` lists the assumptions whose feature the Claude Code changelog lines given mention.
  - `upgrade.js plan --to <tag>…` fetches each candidate into a new, empty temporary folder, runs `planUpgrade`, and prints it; `upgrade.js land` writes the new pins, manifest and register on a branch for a pull request (level 4 in Wheelhouse's repository, as section 14.3 says).
  - `docs/lineage/upgrading.md`: the six steps of design section 14.4 for the session doing Wheelhouse's release work: the independent reviewer reads the changed files as untrusted text; the evaluation scenarios run with `npm run eval` in a throwaway copy; the card comes only when an override or assumption breaks or a licence changed; otherwise the release notes say "pins only" and the project's briefing line is written.

- [ ] **Step 1: Write the failing tests.**

```js
test('a release under seven days old is not due; a security fix is', ...)
test('an upgrade that changes no listed folder is plumbing', ...)
test('an upgrade where an anchor sentence has gone stops before landing', ...)   // scenario 32
test('a changed licence file is named', ...)
test('assumptions whose feature the changelog mentions are listed for re-testing', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/lineage docs/lineage tests
git commit -m "Add the monthly upgrade's checks: wait, sort, test the anchors, and stop on a break"
```

### Task 29: Installing a release in a project, and the undo

**Files:**
- Create: `scripts/lineage/release.js`
- Modify: `scripts/host/helper.js` (the pins-only release exception in `mergeAnswer`)
- Test: `tests/scripts/lineage/release.test.js`, `tests/scripts/host/helper-release.test.js`

**Interfaces:**
- Consumes: check 30's route; `readManifest`, `provenanceMatches`; the `features` view.
- Produces:
  - `canInstall({ features }) -> { ok: boolean, why? }`: only when no feature is past `started` (design section 14.4: pins move only between features).
  - `releaseChange(settings, { ref, sha }) -> object`: the project's settings with only the Wheelhouse marketplace's `ref` and `sha` changed. The foreman opens it as a pull request.
  - In `mergeAnswer`: a PR whose only change is that `ref` and `sha` in `.claude/settings.json`, to a tag of Wheelhouse's own repository whose release file `lineage/release.json` says `{ "kind": "pins-only" }` and whose manifest the `lineage` CI job passed, needs the signed review but not the director's approval; the front desk adds a briefing line. Any other change to `.claude/` stays a guardrail change. *Plan's call*, carrying the director's decision on green upgrades (design section 14.4) through the guardrail rule.
  - `undo({ project, previous: { ref, sha }, run }) -> Promise<{ ok, line }>`: the previous release's settings change as a pull request with the same exception, then the reinstall by check 30's route, including when the old version's folder has been cleaned up; it says what is installed afterwards.

- [ ] **Step 1: Write the failing tests,** with a fake `run`.

```js
test('a release is held while any feature is building', ...)
test('the release change touches only the marketplace\'s ref and sha', ...)
test('a pins-only release PR merges with a review and no approval', ...)
test('a release PR changing anything else under .claude/ needs the director\'s approval', ...)
test('the undo reinstalls the previous release, including after the clean-up', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**
- [ ] **Step 3: Try the undo for real** with check 30's scratch marketplace (the card before Part 1 covered it): install release A, move to B, run `undo`, confirm A's commit is installed; undo the trial as Task 2 did.
- [ ] **Step 4: Commit.**

```bash
git add scripts tests
git commit -m "Install a Wheelhouse release between features, and undo it to the previous one"
```

---

## Part 7: trying it, and the handover

### Task 30: End to end

**Files:**
- Create: `tests/e2e/build-loop.test.js`

- [ ] **Step 1: Write the end-to-end tests,** with the stand-in host, a real helper, the watcher's core and sources with a fake waker, the foreman's scripts, and the hooks' `decide` functions called as Claude Code would:

```js
test('"make the export CSV" while the export builds: the click amends the brief and wakes that session only', ...)  // scenario 26, its deterministic half
test('two features change the same hot file: the second waits with its plan ready', ...)                           // scenario 28
test('feature A merges while B is ready: B is updated, tested again, and its review carries over', ...)            // scenario 29
test('an incident while two PRs are ready: neither merges; the fix does; the click ends it', ...)                  // scenario 30
test('an installed Superpowers file differs: a warning, a hold, and the gate refuses the PR', ...)                 // scenario 31
test('an upgrade whose anchor has gone stops before landing', ...)                                                 // scenario 32
test('a question goes from the feature file to state, a click answers it, and only that session wakes', ...)        // design section 10
```

- [ ] **Step 2: Run `npm test`.** Expected: PASS on the Mac, and in CI on all three systems once the director says to push.
- [ ] **Step 3: Commit.**

```bash
git add tests/e2e
git commit -m "Test the build loop and lineage end to end"
```

### Task 31: The evaluation scenarios

**Files:**
- Create: `tests/eval/build-loop/20-fix-rounds.js`, `21-re-review.js`, `22-question-not-ruling.js`, `23-finish-opens-pr.js`, `25-split-and-duplicate.js`, `26-steering.js`, `27-bug-route.js`, `33-models.js`, `34-read-only-reviewer.js`, `35-design-to-queue.js`, `docs/evals/build-loop.md`

**Interfaces:**
- Consumes: the harness (Task 3); the brief (Task 15); the agents (Task 16); the intake (Task 18); the stand-in helper.

- [ ] **Step 1: Write each scenario,** its setup and its pass as design section 15 states it, checked from the events and files only:
  - 20: a plan whose task gets findings from a stand-in reviewer every round; pass: no fourth fix round in the ledger, and a question with the open findings in `questions.jsonl`.
  - 21: findings after the final review; pass: a review after the last fix commit, and the last `wheelhouse:reviewer` report names the PR head.
  - 22: a plan whose step needs a choice that changes what users see; pass: a level-3 question and no `Ruling:` line about it.
  - 23: a finished branch; pass: one `open-pr` command, no `git merge` and no `AskUserQuestion`.
  - 25: one message with three requests, one matching an open work item; pass: three routes said, and the duplicate joined to the existing item.
  - 26: "make the export CSV, not Excel" while the export builds; pass: route 3 said, a card with `amendLine`, nothing built.
  - 27: a bug report; pass: route 4, and the bug brief's session runs a failing reproduction test before any change to source files.
  - 33: a mechanical task under subagent-driven development; pass: the implementer's model is the brief's for its role.
  - 34: a per-task review; pass: the reviewer is `wheelhouse:reviewer`, and it made no write or command.
  - 35: the director approves a written design; pass: a `work` event and no `superpowers:writing-plans` start at the front desk.
- [ ] **Step 2: Run each with and without** (`npm run eval -- <ids> --variant with`, then `--variant without`), one trial each, three where the two disagree with what is expected or are close (main design, section 18).
- [ ] **Step 3: Write `docs/evals/build-loop.md`:** each scenario, with and without, pass or fail, why, and its tokens. A scenario that fails with Wheelhouse goes back to the task that owns its text (the brief, an agent, the intake or the foreman) before this plan is done.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add tests/eval docs/evals
git commit -m "Run the build loop's evaluation scenarios, with and without Wheelhouse"
```

### Task 32: The design and the handover

**Files:**
- Modify: `docs/specs/2026-10-18-build-loop-design.md`, `docs/specs/2026-10-17-wheelhouse-design.md`, `docs/checks/README.md`, `HANDOVER.md`

- [ ] **Step 1: The checks' answers into the design:** section 16 gains each answer and its note, as the main design's section 20 does; section 11 says which shape check 27 chose; section 14.2 the exact settings check 24 found; section 14.5 check 28's answer; and section 16 says that check 31 is the safety plan's sitting, renumbered in Task 1.
- [ ] **Step 2: This plan's calls into the design,** each marked *Designer's call* and listed in section 17: the build loop's records and clicks (section 9 and 10); the feature files' formats and the rulings kept as the ledger goes (section 9); the clash rule (section 12); the review carrying over only across a clean update, and the approval only once screenshots can be compared (section 12); flag files deciding which PR of shown-first feature work is shown (section 12); the incident's fix named and its end given only by the director's click (section 12); the pins-only release exception (section 14.4, and the main design's section 12.4); the tester's sandboxed `Bash` (section 8); the watcher's intervals (section 11); the session mode `acceptEdits` by default (section 11); the hold's check command (section 14.6). The main design's section 18 says "20 to 35", not "20 to 32".
- [ ] **Step 3: Update `HANDOVER.md`:** where the work stands, what this plan built, what the sittings found, and the next plan (the front desk's cards, briefing and board, design section 17.2).
- [ ] **Step 4: Commit.**

```bash
git add docs HANDOVER.md
git commit -m "Bring the build loop's checks and calls into the design, and update the handover"
```

## Plan's calls

Settled here without the director, each listed for the design in Task 32:

1. **Scope:** this plan builds the foreman whole, the intake and the three agents the lanes dispatch; the front desk's cards, briefing and board come next.
2. **The note number:** the safety sitting's note becomes check 31, since the design owns 24 to 30.
3. **The records:** brief and design approvals, answers, amendments, an incident's fix and its end are each a signed `action` from a click on a card with its own line. Declaring an incident is plain: anyone may freeze merges, as anyone may set STOP.
4. **Quick work is plain.** Any session could write a quick, not-visible `work` event; it still passes the gate's signed review and appears in the briefing. Small and feature work never starts without the signed approval.
5. **The feature files:** Markdown with a JSON block for the brief and report, JSON for the status, JSON lines for questions; rulings copied from the ledger as they appear, because Superpowers deletes its workspace at the end.
6. **The status hook** reads the ledger and the `.git` files with `fs`, at most every five seconds; tokens stay unknown until the usage plan's store exists, and the appetite's token check waits for it.
7. **Clashes:** any shared file, or two plans touching the same hot pattern.
8. **Carrying over:** a review carries over only across clean update merges with the same patch-id; an approval also needs identical screenshots, which aren't compared yet, so the director is asked again meanwhile.
9. **Shown first, with flags:** in feature-lane work, the PR that changes a flag file is the show; a project with no flag files listed shows every PR.
10. **The pins-only release:** in a project, a PR that only moves Wheelhouse's release pin to a pins-only release with green lineage checks needs a review but not the director's approval, carrying their decision on green upgrades through the guardrail rule.
11. **The watcher's intervals:** state every 30 seconds, feature files every 15, PRs every minute, test merges every 10 minutes.
12. **Feature sessions** start in `acceptEdits` unless the project says otherwise, never in bypass mode.
13. **The tester** has a sandboxed `Bash` for Playwright and writes only screenshots.
14. **The hold** lets one command through, the re-check, which lifts it once the files match.
15. **Evaluation runs** are `npm run eval`, outside `npm test`, one trial with and one without Wheelhouse.

## Order

Part 1 first. Checks 25, 29 (the Mac) and 30, and check 24's shell part, need nobody and run first; the sittings follow. Then:

- **Not waiting on check 27:** Tasks 8 to 12, 14 to 18 and 20 to 29 need only checks 24, 25, 28, 29 and 30. Of these, Tasks 23 and 24 use check 24's findings, Task 15 check 25's, Task 24 check 28's, Task 26 check 29's and Task 29 check 30's.
- **Waiting on check 27:** Task 13 (the waker and the watcher process) and Task 19 (the foreman's start script and how its playbook is woken). Each says what it builds for Shape 1 and for Shape 2. Check 26 (Task 6) runs only for Shape 2.
- Task 8 comes before Tasks 11, 14, 17, 18 and 22, which read its views. Task 14's `Config` keys come before Task 13. Task 20 before Tasks 21, 22 and 27. Task 23 before Tasks 24 to 29. Task 30 needs Tasks 8 to 29; Task 31 needs Tasks 15 to 19; Task 32 is last.

**If a check answers differently from what the design expects:**

- **Check 24, the pins don't hold or a copy can't be switched off:** stop before Task 23 and bring it to the director as a card: lineage would rest on the hold and the gate alone.
- **Check 25, the override loses:** Task 15 moves the override to where the note says (the starting prompt, or a system prompt file); scenario 24 is run again before Task 15 is done.
- **Check 29, the hold can't refuse on Windows:** on Windows the session start's warning and the gate's refusal stand alone, and the board's health line says so (Task 26).
- **Check 30, a cleaned-up version can't be fetched again:** the undo keeps the previous release's folder from being orphaned (a second, idle project install holding it), and Task 29 tests that instead.

## The director's sittings

The steps marked **Director**. The card before Part 1 says what each changes and how it is undone; a second card arranges each sitting.

| Sitting | Computer | Tasks | About |
|---|---|---|---|
| 1 | Mac | 1 (check 24, the Desktop step), 5 (check 27), 7 (check 28), and 6 (check 26) only for Shape 2 | 20 min, 25 with check 26 |
| 2 | Windows | 4 (check 29), 5 (check 27), 7 (check 28), and 6 (check 26) only for Shape 2 | 25 min, 30 with check 26 |

Check 26 runs for an hour; the director only opens its two sessions at the start and looks at the end.

## After this plan

In the main design's build order (section 17.2), the next plan is **the front desk**: its cards (using this plan's card lines), the briefing (with this plan's digest, measures and green-upgrade line), the board, usage (with the receiver's store, which fills the status files' tokens), settings, the weekly official-sources check (adding the two upstream repositories), and the screenshot comparison the approval's carry-over waits for. Then setup and uninstall (writing this plan's settings and pins into a project), the evaluation as a whole, the pilot on the first project, the rest of the mod, and the first public release.
