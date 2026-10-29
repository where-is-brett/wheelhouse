<!-- docs/superpowers/plans/2026-10-30-archon-part-4-2-bug-lane.md -->
# Wheelhouse on Archon, part 4.2: the bug lane (`wheelhouse-bug`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bug work runs on Archon. The lane reproduces the bug with a failing test, committed on its own. That test's command joins the done checks, which the helper keeps. The quick lane's steps follow. A bug that proves bigger than a bug, or that can't be reproduced, takes the blocked exit with a proposal.

**Architecture:** The lane follows 4.1's shape: one run, one ticket, one order, with the quick lane's steps inline after a reproduce block. The reproduction comes from the engine's own record of the `reproduce` step, never from a file an agent can write. A script proves it red at its own commit. Then the helper keeps it, once per work, and adds it to the order's `done` whenever a step asks for the order. So the loop's `until_bash`, the review prompts (through the order copy) and the merge path all see it. A lane-move answer on the "bigger than a bug" card ends the work in this lane. The First Mate then records it again in the chosen lane, as intake's route 2 already does for work that ended partial.

**Tech Stack:** Node.js (ESM, `node:test`), Archon v0.13.0 workflow JSON-in-YAML, the fake engine (`scripts/engine/fake.js`).

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 7.1 (`diagnosing-bugs`'s row), 7.2 (the Bug row), 10.2 (caps: bug 30 minutes, 2M tokens) and 11 (the done check). The stub is `docs/superpowers/plans/2026-10-29-archon-part-4-later-lanes.md`, stub 4.2. Rulings: the shared notes folder's `part-4-2-rulings.md`, plus 4.1's `part-4-1-rulings.md` and PR #119's body.

## Global Constraints

- British English; dates as 30 October 2026; a repository-relative path comment atop every file (JSON exempt; the pack's `.yaml` files start `# engine/archon/pack/<name>.yaml`).
- No words such as "enhanced", "improved" or "fixed" in names, comments or text. No model names in the repository. No AI attribution.
- Scripts are in Node.js. Nothing is written to `~/.wheelhouse`, `~/.archon` or the director's `~/.claude` during tests (use `tests/helpers/homes.js`).
- The pack names no model, only the tiers `small`, `medium` and `large`. Every Claude node names `wheelhouse@wheelhouse`.
- Method as prompt text (check 77; ruling 1): `prompts/reproduce.md` names `diagnosing-bugs` only in its words. No new skill copy.
- Caps come from `LANE_CAPS.bug`: `{ minutes: 30, tokens: 2000000 }`. They cover the whole run.
- Scenarios are numbered 63 to 69. 4.4 numbers from 70.
- Changes to the shared files `runner.js`, `dispatch-run.js`, `order.js` and `tests/engine/pack.test.js` stay small. Setup, uninstall and version files are not touched.
- Every step is safe to rerun (4.1 ruling 4). A rerun of the same work finds its kept reproduction and skips the reproduce step.

## Review Focus

1. **A reproduction planted in the artefacts**, or written into a later step's output, is never kept. The helper reads only the `reproduce` and `red` outputs from the engine's record (Task 2 test: a `red` output with `red: false`, or a missing one, is refused).
2. **A fix that loosens the reproduction test** (a changed assertion, a skip, the test removed) never passes the loop's check. The reproduction files must be unchanged since the reproduction commit (Task 4 test).
3. **A reproduction test that passes before any fix** is not a reproduction. The red step refuses it and the lane asks the no-reproduction card (Task 3 test).
4. **The reproduction commit holding product code** (the agent "reproduced" by also changing code) is refused. Every file in it must be a test file the step listed (Task 3 test).
5. **Rerun after Give it more, or after a rework**, keeps the first reproduction. It doesn't build a second one, and the order still carries the check (Task 2 and scenario 68).

---

## File Structure

- `scripts/engine/reproduction.js` (new): reads and validates the reproduce step's output. Holds the lane's fixed limits.
- `scripts/engine/reproduce.js` (new): the lane's three scripted steps, `--gate`, `--red` and `--keep`.
- `scripts/engine/bug-check.js` (new): the implement loop's `until_bash`, which closes on its last round.
- `scripts/engine/bug-size.js` (new): the after-loop rule that decides "bigger than a bug".
- `scripts/engine/routes.js`: the `/engine/reproduction` and `/engine/reproduction/find` routes. The order route adds the kept check.
- `scripts/host/helper-client.js`: `engine.reproduction` and `engine.reproductionFind`.
- `scripts/state/events.js`: the helper-only kind `reproduced`.
- `scripts/engine/runner.js`: blocked answers `small` and `feature` end the work for the First Mate to record again.
- `scripts/engine/words.js`: plain words for the new steps.
- `engine/archon/pack/wheelhouse-bug.yaml` and `engine/archon/pack/prompts/reproduce.md` (new), plus `prompts/implement.md`, whose words cover the reproduction.
- `skills/intake/SKILL.md`: route 2 names the bug lane's lane-move card. Its desk copies follow, if the parity test needs them.
- `tests/eval/build-loop/bug-project.js` (new): the evaluation's test project with a planted bug.
- `tests/eval/build-loop/63-…` to `69-…`, `engine-recordings.js` and `tests/scripts/eval/scenarios-engine.test.js`.
- `tests/e2e/engine-bug.test.js` and `tests/fixtures/engine/bug-lane.jsonl` (new).
- `docs/evals/build-loop.md` (scenario entries), plus the spec's and the stub's "as built" lines.

---

### Task 1: The reproduction's shape

**Files:**
- Create: `scripts/engine/reproduction.js`
- Test: `tests/scripts/engine/reproduction.test.js`

**Interfaces:**
- Produces:
  - `MOST_FILES = 5`, the most product files a bug's fix may change. More is a small change.
  - `MOST_TEST_FILES = 3` and `BUG_ROUNDS = 5`.
  - `readReproduction(text: string) -> { check: { test } | { command, expect: 0 }, files: string[] } | null`. It reads the `reproduce` step's output JSON. `blocked: true` gives null. It needs exactly one of `test` (one line, at most 200 characters) or `command` (one line, at most 400 characters). `files` holds 1 to `MOST_TEST_FILES` relative paths. None may start with `/` or `-`, hold `..` or a backslash, or fail `isTestFile`.
  - `sameReproduction(a, b) -> boolean`.

- [ ] **Step 1: Write the failing tests.** `readReproduction` gives `{ check: { test: 'formats 65 seconds as 1:05' }, files: ['test/duration.test.js'] }` from `{"summary":"…","blocked":false,"test":"formats 65 seconds as 1:05","files":["test/duration.test.js"],"assumptions":[]}`. It gives `{ check: { command: 'node --test test/duration.test.js', expect: 0 }, … }` for a `command`. It gives null for: blocked; both `test` and `command`; neither; a multi-line test; `files` empty or longer than 3; `src/duration.js` (not a test); `../x.test.js`; `/abs/x.test.js`; text that isn't JSON.
- [ ] **Step 2: Run** `node --test tests/scripts/engine/reproduction.test.js` and expect it to fail (module not found).
- [ ] **Step 3: Implement** `scripts/engine/reproduction.js`, using `isTestFile` from `test-guard.js`.
- [ ] **Step 4: Run** the tests again and expect them to pass.
- [ ] **Step 5: Commit** "Read the bug lane's reproduction from its step's output".

### Task 2: The helper keeps the reproduction, and the order carries it

**Files:**
- Modify: `scripts/engine/routes.js` (two routes, and the order route). The kept reproductions go in `verdicts.json` as `reproduced: { [work]: { check, files, commit, runId, at } }`.
- Modify: `scripts/host/helper-client.js` (`reproduction: post('/engine/reproduction')`, `reproductionFind: post('/engine/reproduction/find')`).
- Modify: `scripts/state/events.js`: `reproduced: { must: ['work', 'runId', 'commit', 'check'], may: ['files'] }`, in `HELPER_ONLY_KINDS`.
- Test: `tests/scripts/engine/routes-reproduction.test.js`, and the events test file that covers helper-only kinds.

**Interfaces:**
- Consumes: `readReproduction` and `sameReproduction` (Task 1).
- Produces:
  - `/engine/reproduction/find { runId } -> { ok, kept: { check, files, commit } | null, given: { check, files } | null }`. `kept` is the work's kept reproduction. `given` is `readReproduction(outputs.reproduce)` from the engine's record.
  - `/engine/reproduction { runId } -> { ok, check, commit }`. It refuses when:
    - the order's lane isn't `bug`;
    - `outputs.red` isn't `{ red: true, commit: <40 hex> }`;
    - `given` is null or not the check that `red` names (`red.check` must be `sameReproduction` with `given.check`).
    If the work already has a kept reproduction, it gives that one back unchanged. Otherwise it keeps the new one and writes a `reproduced` event.
  - `/engine/order` for a bug run with a kept reproduction gives `{ ...order, done: [...order.done, kept.check] }`. The stored order file never changes.

- [ ] **Step 1: Write the failing tests**, in `engineRoutes` with a fake engine whose `outputs` the test sets (as `routes-fix.test.js` does):
  - The keep route refuses with no `red` output, with `red: false`, with a red output for another check, and for a quick-lane run.
  - It keeps once and writes one `reproduced` event.
  - A second run of the same work gets the first reproduction back, and no second event.
  - Afterwards the order route's `done` ends with the check, and the order file on disk is byte for byte the same.
  - The find route gives `kept: null` before the keep and the kept one after.
  - `appendEvent` accepts `reproduced` from the helper and refuses it from `/state/write`, as the other helper-only kinds do.
- [ ] **Step 2: Run** the test files and expect them to fail.
- [ ] **Step 3: Implement** the routes. The ticket wraps both, as for the others. `readVerdicts` and `keepVerdicts` gain the `reproduced` key.
- [ ] **Step 4: Run** `node --test tests/scripts/engine/routes-reproduction.test.js tests/scripts/engine/routes-fix.test.js` plus the events test, and expect them to pass.
- [ ] **Step 5: Commit** "Keep a bug's reproduction once, from the engine's record, and add it to the run's done checks".

### Task 3: The reproduce steps (`reproduce.js`)

**Files:**
- Create: `scripts/engine/reproduce.js`
- Test: `tests/scripts/engine/reproduce.test.js`, with a real git repository from `tests/helpers/git-fixture.js` and a stub client.

**Interfaces:**
- Consumes: the client's `engine.reproductionFind`, `engine.reproduction` and `engine.order` (Task 2), and `runDoneChecks` (`done-check.js`).
- Produces: `main(argv, { client, cwd, out, run, platform }) -> exit code`. Every mode prints one JSON line and exits 0 unless the usage is wrong (exit 2).
  - `--gate --run <id> --base <ref>` prints `{ reproduced }`. It is true when the work has a kept reproduction whose commit is in `HEAD`'s history (`git merge-base --is-ancestor`).
  - `--red --run <id> --base <ref>` prints `{ red, commit, check, line }`. It is true only when all of these hold:
    - `given` exists;
    - the tree is clean;
    - `HEAD` is a commit after `base` whose changed files (`git diff --name-only HEAD~1 HEAD`) are all in `given.files`;
    - the check run through `runDoneChecks` fails.
    Otherwise it is false, with `line` saying why in plain words. When the gate found a kept reproduction, `--red` prints that one as red without running it.
  - `--keep --run <id> --artefacts <dir>` calls `engine.reproduction`, then writes the order copy again: it calls `order-copy.js`'s `main` with `--out <dir>`. It prints `{ kept, line }`.

- [ ] **Step 1: Write the failing tests.**
  - A repository has `src/duration.js` with the planted bug and a reproduce commit adding `test/duration.test.js`. With the test failing, `--red` prints `red: true` and the commit.
  - With the bug's code also changed in that commit, it prints `red: false` ("the reproduction's commit changes more than its test").
  - With a test that passes, it prints `red: false` ("the test passes before any fix, so it doesn't reproduce the bug").
  - With uncommitted changes, it prints `red: false`.
  - With `given` null, it prints `red: false`.
  - `--gate` is false with nothing kept, and false when the kept commit isn't an ancestor. It is true when it is.
  - `--keep` writes `order.json` again with the check in its `done`.
- [ ] **Step 2: Run** `node --test tests/scripts/engine/reproduce.test.js` and expect it to fail.
- [ ] **Step 3: Implement** `reproduce.js`. Git runs through `run` from `../lib/run.js` with `timeoutMs`.
- [ ] **Step 4: Run** the test again and expect it to pass.
- [ ] **Step 5: Commit** "Prove a bug's reproduction red at its own commit, and keep it".

### Task 4: The loop's check and the size rule

**Files:**
- Create: `scripts/engine/bug-check.js` and `scripts/engine/bug-size.js`
- Test: `tests/scripts/engine/bug-check.test.js` and `tests/scripts/engine/bug-size.test.js`

**Interfaces:**
- Consumes: `runDoneChecks`; `protectedFindings` and `changeOf`; `MOST_FILES`, `BUG_ROUNDS` and `isTestFile`; the find route.
- Produces:
  - `bug-check.js --run <id> --artefacts <dir> --base <ref> --most <n> [--blocked <true|false>]` exits 0 when:
    - the builder took its blocked exit; or
    - every done check in the helper's order passes (the reproduction among them), the kept reproduction's files are unchanged since its commit (`git diff --quiet <commit> HEAD -- <files>`), and `protectedFindings` finds nothing.
    It also exits 0 on round `--most`, counted in `<artefacts>/bug-rounds.json`, with "out of rounds, so the loop closes and the lane asks". Otherwise it exits 1. It prints one line for each failure.
  - `bug-size.js --run <id> --base <ref>` prints `{ blocked, question, options, recommend, topic, level, line }`:
    - `blocked: false` when the done checks pass and at most `MOST_FILES` non-test files changed against `base`;
    - otherwise `blocked: true`, `topic: 'bigger-than-a-bug'`, `level: '3'`, `recommend: 'small'`, with the options `[{ id: 'small', label: 'Make it a small change' }, { id: 'feature', label: 'Make it a feature' }, { id: 'stop', label: 'Stop this work' }]`. The question says why in plain words: "The fix for this bug changes 7 files, more than a bug's fix should." or "The fix for this bug didn't pass its checks within its rounds."

- [ ] **Step 1: Write the failing tests.**
  - `bug-check` passes on a fix that makes the reproduction green.
  - It fails when the fix edits the reproduction test (a changed assertion makes the check pass), with "the reproduction's test changed since it went red".
  - It fails on a red check, and passes on round 5 with the out-of-rounds line.
  - It passes at once with `--blocked true`.
  - `bug-size` is clean on a two-file fix. It is blocked with "changes 6 files" on six product files, and blocked with the rounds question when the reproduction still fails.
- [ ] **Step 2: Run** both tests and expect them to fail.
- [ ] **Step 3: Implement** both scripts.
- [ ] **Step 4: Run** both and expect them to pass.
- [ ] **Step 5: Commit** "Check a bug's fix against its reproduction, and ask when it proves bigger than a bug".

### Task 5: The pack's bug lane

**Files:**
- Create: `engine/archon/pack/wheelhouse-bug.yaml` and `engine/archon/pack/prompts/reproduce.md`
- Modify: `scripts/engine/words.js`; `tests/engine/pack.test.js` (`ALL`, and one bug-lane test); `tests/scripts/engine/pack-check.test.js` (accepts it)
- Test: the files above, plus `tests/scripts/engine/words.test.js`

**Interfaces:**
- Consumes: Tasks 3 and 4's scripts, and the quick lane's nodes from `tests` onwards, copied as they are.
- Produces: the nodes in this order:
  1. `order` (with `--flags`).
  2. `reproduce-gate` (`reproduce.js --gate`).
  3. `reproduce`: an AI node, `model: medium`, `plugins: [wheelhouse@wheelhouse]`, `skills: [wheelhouse:codebase-design]`, `prompt_file: prompts/reproduce.md`, with `when: $reproduce-gate.output.reproduced == 'false'`. Its output is the shared blocked shape plus `test`, `command` and `files`.
  4. `reproduce-blocked` (wait, `wh.kind: blocked`).
  5. `red` (`reproduce.js --red`; `when` is the gate reproduced, or reproduce not blocked).
  6. `red-held`: a wait when `$red.output.red == 'false'`, with `wh.topic: no-reproduction`, `wh.level: 3`, `wh.recommend: rework`, and the options `rework` ("Try to reproduce it again") and `stop` ("Stop this work"). Its attention is `$red.output.line`.
  7. `reproduced` (`reproduce.js --keep`, when red).
  8. `implement`: a loop group with `max_iterations: 5` and `fresh_context: true`. Its `until_bash` runs `bug-check.js --most 5 --blocked $build.output.blocked`, and its body is the quick lane's `build` with `prompt_file: prompts/implement.md`.
  9. `implement-blocked`.
  10. `size` (`bug-size.js`) and `size-blocked` (a wait from `$size.output.*`).
  11. From `tests` to `lesson-record`, the quick lane's nodes, with `tests`' and `controls`' `depends_on` and `when` pointing at `size`/`size-blocked` and `$size.output.blocked == 'false'`.
  - `returns: open-pr`.
  - `prompts/reproduce.md` holds `{{rules}}` and the method: follow the diagnosing-bugs skill's first phase in its own words. Read the bug report in the order's goal. Build the fastest loop that shows the bug. Write the smallest test that fails for the bug's reason and for no other. Commit only that test, on its own commit, "Reproduce: <title>". Return its name as `test` (run with the order's test command) or a `command`, plus `files`. Don't change product code. With no reproduction possible, take the blocked exit, topic `no-reproduction`. A fix that needs a design choice or a level-3 call takes the blocked exit, topic `bigger-than-a-bug`, with the options `small`, `feature` and `stop`.
  - `STEP_WORDS` gains: `'reproduce-gate': 'looking for its reproduction'`, `reproduce: 'reproducing the bug'`, `'reproduce-blocked': 'stopped, with a question about the bug'`, `red: 'checking the reproduction fails'`, `'red-held': 'stopped: the bug couldn\'t be reproduced'`, `reproduced: 'noting the reproduction'`, `size: 'checking the fix is a bug\'s size'` and `'size-blocked': 'stopped: the fix is bigger than a bug'`.

- [ ] **Step 1: Write the failing tests.**
  - In `pack.test.js`, `ALL` gains `LANE_WORKFLOWS.bug`. Add "the bug lane reproduces first, proves it red, keeps it, then runs the quick lane's steps": the node ids hold `['order', 'reproduce-gate', 'reproduce', 'red', 'reproduced', 'implement', 'size', 'tests', 'lenses', 'review-standards', 'pr-text', 'open-pr', 'sign', 'preview', 'approval', 'ready', 'lesson']` in that order. `implement.loop_group.max_iterations === 5`, and `until_bash` matches `/bug-check\.js/`. `red-held.wait.labels['wh.topic'] === 'no-reproduction'`. `reproduce.prompt` matches `/diagnosing-bugs/` and `reproduce.skills` doesn't include it.
  - In `words.test.js`, every pack node has its own words (if that test exists; otherwise the new ids are listed).
- [ ] **Step 2: Run** `node --test tests/engine/pack.test.js tests/scripts/engine/pack-check.test.js tests/scripts/engine/words.test.js` and expect them to fail.
- [ ] **Step 3: Write** the YAML with a throwaway script in the scratchpad that copies the quick lane's tail, and check it by eye. Then write the prompt and the words.
- [ ] **Step 4: Run** the same tests, plus `node scripts/engine/pack-check.js` if it has a command line, and expect them to pass.
- [ ] **Step 5: Commit** "Add the bug lane to the pack".

### Task 6: A lane move goes back through intake

**Files:**
- Modify: `scripts/engine/runner.js` (the blocked-answer branch in `deliver`).
- Modify: `skills/intake/SKILL.md`, route 2. If the parity test needs them, also its desk copies.
- Test: `tests/scripts/engine/runner.test.js`

**Interfaces:**
- Produces: a blocked answer whose choice is `small` or `feature` is delivered to the engine, which ends the run. It sets no rework, so the work doesn't start again in the bug lane. It writes the Logbook note "<Title> is bigger than a bug, so it stops in the bug lane; the First Mate records it as a small change and asks you to approve it." (for `feature`, "as a feature"). Intake's route 2 gains: "A bug the build engine found bigger than a bug (its card offered the small lane or a feature) is the same: record the work again in the lane the click picked, naming its report, and ask its `approve-work` card."

- [ ] **Step 1: Write the failing test.** A blocked ask answered `small` delivers the answer, starts no second run once the first ends, and writes the note. An answer of `rework` still starts a second run, as before.
- [ ] **Step 2: Run** `node --test tests/scripts/engine/runner.test.js` and expect it to fail.
- [ ] **Step 3: Implement**, with a `MOVES` set beside `STOP` and `REWORK`, and edit the intake line.
- [ ] **Step 4: Run** the runner test, `tests/scripts/frontdesk/desk-parity.test.js` and `tests/scripts/agents/core-neutral.test.js`, and expect them to pass.
- [ ] **Step 5: Commit** "Send a bug that proves bigger back to the First Mate in the lane the director picked".

### Task 7: Scenarios 63 to 69 on the fake engine

**Files:**
- Create: `tests/eval/build-loop/63-bug-lane-runs.js`, `64-bug-reproduced-in-order.js`, `65-bug-bigger-moves-lane.js`, `66-bug-not-reproduced.js`, `67-planted-reproduction-refused.js`, `68-bug-rerun-keeps-reproduction.js` and `69-bug-shown-first.js`
- Modify: `tests/eval/build-loop/engine-recordings.js` (`bug(work, opts)`, `bugBlocked(work, topic)` and `bugWork(world, { id, title, visible, lanes })`); `tests/scripts/eval/scenarios-engine.test.js` (`ENGINE_SCENARIOS` gains 63 to 69, plus one failing-variant test); `docs/evals/build-loop.md` (one entry for each)

**Interfaces:**
- Consumes: `world.put`, `world.tick`, `world.starts`, `world.orders`, `world.views` and `engine.setOutput` (`scripts/eval/engine-world.js`), and Task 2's routes through the real helper.
- Produces, one pass rule for each:
  - **63:** bug work holds while `engineLanes` lacks `bug`. Once it is added, one run starts with a `bug` order and the caps 30 and 2000000, and does so unapproved when it isn't visible. The run ends with its pull request.
  - **64:** after the recording's `reproduce` and `red` outputs and the `reproduced` step's call, the helper's order for the run carries the reproduction in `done`, and the record has one `reproduced` event.
  - **65:** a `size-blocked` ask answered `small` raises one card with the three options. No second bug-lane run starts, and the Logbook says the First Mate records it as a small change.
  - **66:** a `red-held` ask raises a blocked card on the topic `no-reproduction`. Answered `rework`, a fresh run starts on the branch.
  - **67:** a reproduction written to the artefacts with `red` refused by the record (`red: false`) is not kept. The order's `done` is unchanged.
  - **68:** a second run of the same work, after a rework, gets the first reproduction back. Its order carries the check, and there is still one `reproduced` event.
  - **69:** visible bug work waits for the director's approval at the head it opened, and isn't marked ready before it.
  - The failing-variant test: scenario 67 fails when the recording's `red` says `true` for the planted check.

- [ ] **Step 1: Write** the recordings and scenario files. Add the ids to `ENGINE_SCENARIOS`.
- [ ] **Step 2: Run** `node --test tests/scripts/eval/scenarios-engine.test.js`. Expect 63 to 69 to pass, since Tasks 2 to 6 are in. If one fails, the scenario or the code is wrong: fix it, and the failing-variant test proves the scenario can fail.
- [ ] **Step 3: Write** the `docs/evals/build-loop.md` entries.
- [ ] **Step 4: Commit** "Play the bug lane on the fake engine: scenarios 63 to 69".

### Task 8: The planted bug end to end

**Files:**
- Create: `tests/eval/build-loop/bug-project.js`, the evaluation's test project. `FILES` holds `package.json` (`node --test`), `src/duration.js` with `formatDuration(seconds)` giving `1:5` for 65 (the planted bug), its passing test for 125 seconds, and `REPORT`, the bug report in the reporter's words.
- Create: `tests/e2e/engine-bug.test.js` and `tests/fixtures/engine/bug-lane.jsonl`

**Interfaces:**
- Consumes: everything above. The harness follows `tests/e2e/engine-small.test.js` (stand-in host, guarded `gh`, real helper, fake engine).

- [ ] **Step 1: Write the test.** In a real worktree of `bug-project`:
  1. Run `reproduce.js --gate`, which gives false.
  2. As the reproduce step, add and commit `test/duration.test.js` asserting `formatDuration(65) === '1:05'`, and set the `reproduce` output.
  3. `--red` gives `red: true`. Set it as the `red` output.
  4. `--keep` keeps it, and the order carries it.
  5. `bug-check` fails (the reproduction is red).
  6. As the build, change `src/duration.js` to pad the seconds and commit.
  7. `bug-check` passes, and `bug-size` is clean.
  8. The review steps sign at the pull request's head as in the small lane's e2e, and `/engine/ready` hands it to the merge queue.
  A second test plays the too-big path: a fix touching six product files makes `bug-size` blocked with `recommend: 'small'`.
- [ ] **Step 2: Run** `node --test tests/e2e/engine-bug.test.js` and expect it to pass.
- [ ] **Step 3: Commit** "Run the bug lane's steps end to end on a planted bug".

### Task 9: Describe the bug lane as built

**Files:**
- Modify: the spec, section 7.2's Bug row. Add one sentence: as built, the reproduction is kept by the helper from the engine's record and added to the order's done checks, and a lane move goes back through the First Mate.
- Modify: the stub 4.2 in `2026-10-29-archon-part-4-later-lanes.md`, adding "Built: this plan, PR …".

- [ ] **Step 1: Edit**, then **commit** "Describe the bug lane as built".

### Finish

- [ ] Run every test file touched, and every file under each test folder touched: `tests/scripts/engine/`, `tests/scripts/eval/`, `tests/engine/`, `tests/e2e/engine-*.test.js`, `tests/scripts/state/`, plus `tests/scripts/agents/core-neutral.test.js` and `tests/scripts/frontdesk/desk-parity.test.js`.
- [ ] Run an independent whole-branch review (`superpowers:requesting-code-review`). Fix each BLOCKER and HIGH finding test first, and list the MEDIUMs in the PR.
- [ ] Push, open the PR, and get Linux CI green. Don't merge.
