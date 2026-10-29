<!-- docs/superpowers/plans/2026-10-30-archon-part-4-1-small-lane.md -->
# Wheelhouse on Archon, part 4.1: the small lane (`wheelhouse-small`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Small work runs on Archon as `wheelhouse-small`: plan, one in-run task block per plan task, the protected-tests check with one repair, a review that loops through at most three fix rounds, then the quick lane's pull request, signing, preview, approval, ready and lesson steps.

**Architecture:** The lane is one workflow and one block. `wheelhouse-small.yaml` plans into a file committed on the branch (`.wheelhouse-plan.md`), then fans the block `wheelhouse-small-task.yaml` out over the plan's unfinished tasks inside the same run (`include:` with `fan_out:`, one at a time). Each task is its own block instance, with its own rows in Archon's record. The review is a `loop_group` (`review`) whose body holds the same review step ids the quick lane uses. The Archon adapter gives a loop body's last output under the step's own id, so the helper signs the final round with no change to its routes. The small step scripts are Node.js in `scripts/engine/`, and talk to the helper only through the run's ticket, like the quick lane's.

**Tech Stack:** Node.js 22 (ES modules, `node:test`), Archon v0.13.0's workflow language in YAML's JSON form, the fake engine and the build-loop scenarios.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 7.1, 7.2 (small row), 10.2 and 11. Stub: `docs/superpowers/plans/2026-10-29-archon-part-4-later-lanes.md`, stub 4.1. The main session's rulings of 30 October 2026 are below.

## Global Constraints

- British English; dates as 30 October 2026; a repository-relative path comment atop every file (JSON exempt). No words such as "enhanced", "improved" or "fixed" in names or text; no model names in the repository; no AI attribution.
- Scripts in Node.js. Nothing is written to `~/.wheelhouse`, `~/.archon` or the director's `~/.claude` during tests. Archon's telemetry stays off.
- The pack names tiers only (`small`, `medium`, `large`); the routing table is the one place that names a model. The plan step uses `medium`, since the routing table has no plan row (ruling 8).
- Every Claude step names `wheelhouse@wheelhouse`, and every builder step has a blocked exit that reaches a wait.
- Stay out of `scripts/setup/`, uninstall, the manifest's `engine` entry and the version files (3d builds them). Keep dispatcher and router changes small (4.3 is building beside this).
- Only BLOCKER and HIGH findings hold work back. Usage pressure never lowers a level, relaxes a review or skips a check.
- Caps: small runs 60 minutes and 4,000,000 tokens (`LANE_CAPS.small`, already in `scripts/engine/order.js`).

**Rulings (main session, 30 October 2026):**
1. One unit per plan task. Done: the build tasks together stay within 60% of the 4M cap. (Built as an in-run fan-out, not child runs: see Deviations.)
2. Method as prompt text in `prompts/plan.md` and `prompts/fix.md`; no new skill copies.
3. The plan file is committed on the branch, so a rerun finds it, and it never lands on main.
4. Every step is safe to rerun; spend carries over as 3c does it.
5. The first review runs every lens that applies. Each fix round reruns standards and spec, plus any lens that raised a BLOCKER or HIGH. The verdict is edited in place at the final head.
6. A failed protected-tests check gets one repair step, then a blocked card.
7. Intake's sizing picks the lane and the work order carries it; a lane not in `engineLanes` goes to the old engine (the dispatcher already does this).
8. Models from the routing table; plan step `medium`.
9. The real small-lane run waits for 3d's setup and the main session's go. The counted evaluation runs from the main session at release. Scenarios are written here and run with the fake engine.

**Deviations, for the PR:**
- **Ruling 1, in-run fan-out rather than child runs.** A child run (`workflow:`) has its own run id and artefacts folder, so it has no work order and no ticket at the helper, and every routed step in it would be refused. An `include:` block fanned out with `max_parallel: 1` keeps each task inside the run the helper started, gives each task its own rows in the record, and resumes past finished tasks. An Archon limit follows from it: a block can't hold a wait. So a task that blocks records its question, later tasks skip, and one wait after the fan-out raises the card. (A no-model probe on the scratch engine, 30 October 2026, confirmed the serial fan-out, `$INPUTS.task` reaching bash, and a skip gate.)
- **Ruling 3, where the plan file is removed.** It is taken out in its own commit after the tasks pass their checks, before the review. Otherwise the reviews would read a head with the plan in it, and the signing would refuse a later head. A rerun still finds the plan in the branch's history, with every task ticked.

## Facts the plan rests on (probe of 30 October 2026, scratch engine, no model)

- `include: <block>` with `fan_out: { items, as: task, max_parallel: 1 }` runs one instance at a time. `$INPUTS.task` substitutes into a block's bash. The block's output is its `returns:` node's output, and the fan-out node's output is the JSON array of those outputs.
- In a `loop_group` named `review`, a body step's events are named `review.<step id>`, one `node_completed` per round. The group's own output is its last body node's output.
- Fan-out instance steps are named `__archon_fan_out__<node>__root__<hash>__<node>__<hash>__<step>`.
- Bash steps take an output reference safely as `value=$step.output; … "$value"` (Archon single-quotes it, or spills it to a file).

## File Structure

| File | Responsibility |
|---|---|
| `scripts/engine/plan-file.js` (new) | The plan file's name and its task list: reads `- [ ]`/`- [x]` task lines, finds the plan in the tree or the branch's history, gives the unfinished tasks; CLI `--gate`, `--tasks`, `--task <n> --gate` |
| `scripts/engine/task-check.js` (new) | A task's `until_bash`: the task is ticked, the tree is clean, and the task's test passes |
| `scripts/engine/task-record.js` (new) | After a task: records a blocked exit in the run's artefacts so later tasks skip; prints `{ blocked }` |
| `scripts/engine/tasks-done.js` (new) | After the fan-out: the blocked question of the task that stopped, or a level-3 card when tasks were left unfinished |
| `scripts/engine/unplan.js` (new) | Takes the plan file out in its own commit, if it is in the tree |
| `scripts/engine/review-round.js` (new) | The review loop's verdict step: which lenses held, whether any did, and any blocked exit |
| `scripts/engine/lenses.js` (modify) | `--held <list>`: after a fix, the security and design lenses run only where they held |
| `scripts/engine/archon/record.js` (modify) | `readOutputs` also gives a loop body step's last output under its own id |
| `engine/archon/pack/wheelhouse-small.yaml`, `wheelhouse-small-task.yaml` (new) | The lane and its task block |
| `engine/archon/pack/prompts/plan.md`, `implement-task.md`, `repair.md`, `fix.md` (new) | The steps' method, as prompt text |
| `scripts/engine/pack-check.js` (modify) | Blocks: an included workflow with no `work` input; its AI steps' blocked exits are waited on by the lane that includes it; a writing fan-out runs one at a time |
| `tests/eval/build-loop/51-…` to `54-…`, `engine-recordings.js` (new, modify) | Small-lane scenarios on the fake engine |
| `tests/e2e/engine-small.test.js` (new) | The small lane's step scripts end to end over a git fixture and the helper |

---

### Task 1: Loop body outputs under their own ids

**Files:**
- Modify: `scripts/engine/archon/record.js:76-84`
- Create: `tests/fixtures/archon/get-events-loop.json` (trimmed from the probe: a top-level `tasks`, a fan-out instance step, and two rounds of `review.fix` and `review.review-standards`)
- Test: `tests/scripts/engine/archon/record.test.js`

**Interfaces:**
- Produces: `readOutputs(json) -> { [stepId]: string }`. A top-level step keeps its own output. A loop body step `group.step` is also given as `step`, from its last round, unless a top-level step has that id. The `group.step` key stays.

- [ ] **Step 1: Write the failing tests**
  - `test('a loop body step is given under its own id, from its last round')`: from the fixture, `outputs['review-standards'] === '{"round":2}'` and `outputs['review.review-standards'] === '{"round":2}'`.
  - `test('a top-level step keeps its id over a body step of the same name')`: events with a top-level `lenses` `{"a":1}` and a body `review.lenses` `{"a":2}` give `outputs.lenses === '{"a":1}'`.
  - `test('a fan-out instance step is not given a bare id')`: no key `gate` comes from `__archon_fan_out__…__gate`.
- [ ] **Step 2: Run them and see them fail:** `node --test tests/scripts/engine/archon/record.test.js` (the first assertion fails: `review-standards` is undefined).
- [ ] **Step 3: Implement it in `readOutputs`.** Do a second pass over the `node_completed` rows whose `step_name` matches `/^[a-z0-9][\w-]*\.([a-z0-9][\w-]*)$/`. Set the bare id when no top-level row had it, so the later rounds overwrite the earlier ones.
- [ ] **Step 4: Run** `node --test tests/scripts/engine/archon/record.test.js`. It passes.
- [ ] **Step 5: Commit:** "Give a loop body step's last output under its own id".

### Task 2: The plan file and its tasks

**Files:**
- Create: `scripts/engine/plan-file.js`
- Test: `tests/scripts/engine/plan-file.test.js` (pure parts and a git fixture from `tests/helpers/git-fixture.js`)

**Interfaces:**
- Produces:
  - `PLAN_FILE = '.wheelhouse-plan.md'`
  - `MOST_TASKS = 8`
  - `tasksOf(text) -> [{ n: number, title: string, test: string|null, done: boolean }]`. A task line is `- [ ] **Task <n>:** <title>` (or `- [x]`). It may be followed by an indented line `Test: <test name>`.
  - `findPlan({ cwd, base, run }) -> { text, where: 'tree'|'history' } | null`. History is the last version before a commit on `base..HEAD` deleted the file.
  - CLI:
    - `node plan-file.js --gate --base <ref>` prints `{ planned }`.
    - `node plan-file.js --tasks --base <ref>` prints a JSON array of the unfinished tasks' numbers as strings. It prints `[]` when the plan has more than `MOST_TASKS` tasks or none: `tasks-done.js` reads that case through `plan-file.js --problem`.
    - `node plan-file.js --problem --base <ref>` prints `{ problem: null | 'none' | 'too-many' }`.
    - `node plan-file.js --task <n> --gate --base <ref> --artefacts <dir>` prints `{ skip }`. `skip` is true when `<dir>/small-blocked.json` exists or task `n` is ticked.

- [ ] **Step 1: Write the failing tests**
  - `tasksOf` reads three tasks, one ticked, one with `Test: prices show two decimals`, and ignores checkbox lines that aren't tasks.
  - `findPlan` finds the file in the tree; after a commit deletes it, it finds the deleted version with `where: 'history'`; with neither, it gives `null`.
  - `--tasks` gives `["2","3"]` when task 1 is ticked. It gives `[]` with `--problem` `too-many` for nine tasks, and `[]` with `none` for a plan with no task lines.
  - `--task 2 --gate` gives `{ skip: true }` once `small-blocked.json` exists, and `{ skip: true }` for a ticked task.
- [ ] **Step 2: Run** `node --test tests/scripts/engine/plan-file.test.js`. It fails: no module.
- [ ] **Step 3: Implement it.** Use `run('git', …)` from `scripts/lib/run.js`, and `runArg` from `done-check.js`. Find the deleting commit with `git log --diff-filter=D --format=%H <base>..HEAD -- .wheelhouse-plan.md` and read `git show <sha>^:.wheelhouse-plan.md`.
- [ ] **Step 4: Run it.** It passes.
- [ ] **Step 5: Commit:** "Read the small lane's plan and its unfinished tasks".

### Task 3: A task's check, record and the tasks' end

**Files:**
- Create: `scripts/engine/task-check.js`, `scripts/engine/task-record.js`, `scripts/engine/tasks-done.js`
- Test: `tests/scripts/engine/task-steps.test.js`

**Interfaces:**
- Consumes: `tasksOf`, `findPlan`, `PLAN_FILE` (Task 2); `runDoneChecks(order, { cwd, run, platform })` from `done-check.js`; the order through `withTicket(client, argv).engine.order({ runId })`.
- Produces:
  - `task-check.js --run <id> --artefacts <dir> --base <ref> --task <n>`: exits 0 only when task `n` is ticked in the tree's plan, `git status --porcelain` is empty, and, if the task names a test, `runDoneChecks({ ...order, done: [{ test }] })` passes.
  - `task-record.js --artefacts <dir> --task <n>`: reads the build step's output from stdin. When `blocked` is true, it writes `small-blocked.json` with `{ task, question, options, recommend, level, topic }`, once (the first block wins). It prints `{ blocked }`.
  - `tasks-done.js --artefacts <dir> --base <ref>`: prints `{ blocked, question, options, recommend, level, topic }`.
    - From `small-blocked.json` when it exists.
    - Otherwise, when `plan-file --problem` is `too-many`: blocked, level `3`, topic `plan-too-big`. The question is "The plan for this work has more than 8 tasks, which is more than the small lane takes." Options are `slice` "Make it a feature, in slices" and `stop` "Stop this work". The recommendation is `slice`.
    - Otherwise, when tasks are left unticked: blocked, level `3`, topic `tasks-unfinished`. The question is "Some of the plan's tasks didn't finish within their rounds." Options are `rework` "Send it back for a fresh run" and `stop` "Stop this work". The recommendation is `rework`.
    - Otherwise `{ blocked: false }`, with the other fields empty.

- [ ] **Step 1: Write the failing tests:** each case above, with a stand-in client for the order, and a git fixture for the tree and the test command (`node -e "process.exit(0)"`, then `exit 1`).
- [ ] **Step 2: Run** `node --test tests/scripts/engine/task-steps.test.js`. It fails.
- [ ] **Step 3: Implement the three scripts,** each with `main(argv, { client, cwd, out, run, stdin })` and `startedAsScript`, like `done-check.js`.
- [ ] **Step 4: Run it.** It passes.
- [ ] **Step 5: Commit:** "Check, record and close each task of the small lane".

### Task 4: The review loop's verdict, and lenses after a fix

**Files:**
- Create: `scripts/engine/review-round.js`, `scripts/engine/unplan.js`
- Modify: `scripts/engine/lenses.js:38-65`
- Test: `tests/scripts/engine/review-round.test.js`, `tests/scripts/engine/lenses.test.js`

**Interfaces:**
- Produces:
  - `review-round.js --standards <json> --spec <json> --security <json> --design <json> --fix <json>`: an empty value is a lens that didn't run. It prints `{ holds, held, blocked, question, options, recommend, level, topic }`. `held` lists the lenses that held, comma-joined (`standards`, `spec`, `security`, `design`), or `none`. A lens holds when its verdict is `FINDINGS` with a BLOCKER or HIGH finding, or when its output can't be read. The first blocked output, fix step first, gives the blocked fields.
  - `lenses.js --held <list>`: when given and not empty, security is `applies && held has security`, and design likewise. With no `--held`, or an empty one, behaviour is unchanged.
  - `unplan.js --base <ref>`: when `.wheelhouse-plan.md` is in the tree, `git rm` it and commit "Take out the build plan". It prints `{ removed }`, and running it again is a no-op.

- [ ] **Step 1: Write the failing tests:**
  - All four CLEAN gives `holds: false`, `held: 'none'`.
  - A HIGH in security gives `holds: true`, `held: 'security'`.
  - MEDIUM only gives `holds: false`.
  - An unreadable spec output gives `holds: true`, `held` including `spec`.
  - A blocked standards output carries its question.
  - `lenses --held standards,spec` on a security-touching change gives `security: false`.
  - `lenses --held security` gives `security: true`.
  - `unplan` removes and commits once, then is a no-op.
- [ ] **Step 2: Run** `node --test tests/scripts/engine/review-round.test.js tests/scripts/engine/lenses.test.js`. It fails.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run it.** It passes.
- [ ] **Step 5: Commit:** "Decide each review round of the small lane, and take the plan out before review".

### Task 5: The pack's check knows blocks

**Files:**
- Modify: `scripts/engine/pack-check.js`
- Test: `tests/scripts/engine/pack-check.test.js`

**Interfaces:**
- Produces:
  - `checkPack` treats a workflow that another pack workflow names in `include:` as a block. A block needs no `work` input.
  - An AI step inside a block has its blocked exit waited on when the including lane has a wait whose `when` reads `.output.blocked == 'true'` from a node that depends on the include node.
  - An `include:` naming a workflow not in the pack is a problem.
  - A `fan_out` on an `include:` must set `max_parallel: 1`: its instances share the checkout.
  - `nodesOf` and the check's other walks don't change.

- [ ] **Step 1: Write the failing tests:**
  - A block's AI step whose blocked exit the lane never waits on is refused, with "has no wait for its blocked exit".
  - `include: wheelhouse-nothing` is refused.
  - `max_parallel: 2` is refused.
  - A block without the `work` input passes.
  - `packWith` gains a second file argument, so the small pack can be edited.
- [ ] **Step 2: Run** `node --test tests/scripts/engine/pack-check.test.js`. It fails.
- [ ] **Step 3: Implement it in `checkPack` and `aiProblems`.** Pass the including lane's nodes to the block's AI steps' wait check.
- [ ] **Step 4: Run it.** It passes. The shipped pack still passes.
- [ ] **Step 5: Commit:** "Let the pack's check read an included task block".

### Task 6: The small lane's workflow, block and prompts

**Files:**
- Create: `engine/archon/pack/wheelhouse-small.yaml`, `engine/archon/pack/wheelhouse-small-task.yaml`, `engine/archon/pack/prompts/{plan,implement-task,repair,fix}.md`
- Modify: `tests/engine/pack.test.js`

**Interfaces:**
- Consumes: Tasks 1 to 5, and the quick lane's step scripts as they are.
- Produces: the lane's node ids, in order: `order`, `plan-gate`, `plan`, `plan-blocked`, `tasks`, `each`, `tasks-done`, `tasks-blocked`, `tests`, `controls`, `repair`, `repair-blocked`, `tests-again`, `held`, `unplan`, `review`, `review-blocked`, `pr-text`, `pr-text-blocked`, `open-pr`, `sign`, `review-held`, `preview`, `approval`, `rejected`, `ready`, `lesson`, `lesson-blocked`, `lesson-record`. `returns: 'open-pr'`.

The lane, step by step:
- **`order`:** as quick.
- **`plan-gate`:** `plan-file.js --gate`.
- **`plan`:** when `planned == 'false'`. Tier `medium`, skill `wheelhouse:codebase-design`, `prompts/plan.md`. Its output carries `summary`, `tasks` (integer) and the blocked fields.
- **`plan-blocked`:** a wait.
- **`tasks`:** `plan-file.js --tasks`. Its `trigger_rule` is `none_failed_min_one_success` after `plan-gate`, `plan` and `plan-blocked`, and its `when` excludes a blocked plan.
- **`each`:** `include: wheelhouse-small-task`, `fan_out: { items: "$tasks.output", as: task, max_parallel: 1 }`.
- **`tasks-done`:** `tasks-done.js`.
- **`tasks-blocked`:** a wait on `$tasks-done.output.blocked == 'true'`, with the labels as quick.
- **`tests` and `controls`:** as quick's, after `tasks-done` when not blocked.
- **`repair`:** when either is not clean. AI, `medium`, `prompts/repair.md`. Its output has the blocked fields.
- **`repair-blocked`:** a wait.
- **`tests-again`:** `protected-check.js` and `control-check.js` in one bash, printing `{ clean }`.
- **`held`:** as quick's wait, when `tests-again` is not clean.
- **`unplan`:** when clean, either first time or after the repair.
- **`review`:** a `loop_group` with `max_iterations: 4` and `fresh_context: true`. Its body:
  - `fix`: AI, `medium`, `prompts/fix.md`, when `$LOOP_PREV.verdict.output.holds == 'true'`.
  - `lenses`: `lenses.js … --held "$held"`, where `held=$LOOP_PREV.verdict.output.held`.
  - `review-standards`, `review-spec`, `review-security` and `review-design`: as quick's, with security and design each on their lens flag.
  - `verdict`: `review-round.js` over each lens's output and `fix`'s.
  - Its `until_bash`: `holds=$verdict.output.holds; blocked=$verdict.output.blocked; [ "$holds" = "false" ] || [ "$blocked" = "true" ]`.
- **`review-blocked`:** a wait on `$review.output.blocked == 'true'`.
- **From `pr-text` to `lesson-record`:** as quick's, with `pr-text` after `review` and `review-blocked`, when `$review.output.blocked == 'false'`.

The block `wheelhouse-small-task`:
- **Inputs:** `task` only. `returns: record`.
- **`gate`:** `plan-file.js --task "$INPUTS.task" --gate`.
- **`build`:** a `loop_group` with `max_iterations: 2` and `fresh_context: true`, when `skip == 'false'`.
  - Its body is the AI step `implement` (`medium`, skill `wheelhouse:codebase-design`, `prompts/implement-task.md`, with the blocked fields).
  - Its `until_bash`: `blocked=$implement.output.blocked; [ "$blocked" = "true" ] || node task-check.js …`.
- **`record`:** `out=$build.output; printf '%s' "$out" | node task-record.js …`, with `trigger_rule: none_failed_min_one_success`.

The prompts, each with `{{rules}}`:
- **`plan.md` (writing-plans' method, adapted):**
  - Read the order, and the codebase-design skill where the shape is unclear.
  - Write `.wheelhouse-plan.md` with a goal line and three to eight tasks. Each task is one testable behaviour, as `- [ ] **Task n:** …`, with an optional `Test:` line naming a test for the order's test command.
  - Each task lists the files it touches. No line names a way to carry out the plan.
  - Commit the plan.
  - Work that needs more than eight tasks is the blocked exit, at level 3, recommending the feature lane.
- **`implement-task.md`:** the tdd method, as in `implement.md`, for task `$INPUTS.task` only.
  - Tick the task in `.wheelhouse-plan.md`, in the same commit as its last green step.
  - The other tasks stand: don't start them.
- **`repair.md`:** the protected-tests and control-file findings (quick's wording).
  - Put back the deleted, skipped or loosened tests, or revert the control-file change, unless the order lists the file.
  - A change that can't be undone without breaking the goal is the blocked exit.
- **`fix.md` (receiving-code-review's method, adapted):**
  - Read the last round's findings from `$LOOP_PREV`'s review outputs, which the prompt names.
  - Check each finding against the code before changing anything. Fix BLOCKER and HIGH, one at a time, test first where a test can show it.
  - A finding you judge wrong is recorded in your output as a disagreement, with the reason. The reviewer reads it in the next round. Never ask.
  - Leave MEDIUM and LOW unless the fix is one line.

- [ ] **Step 1: Write the failing tests in `tests/engine/pack.test.js`:**
  - `buildPack` gives `wheelhouse-hello`, `wheelhouse-quick`, `wheelhouse-small` and `wheelhouse-small-task`.
  - The small lane's node ids are the list above, in order, and `returns` is `open-pr`.
  - `each` is an include of `wheelhouse-small-task` with `max_parallel: 1`.
  - The `review` loop has `max_iterations: 4` and a body holding every id in `REVIEW_STEPS`, plus `lenses`, `fix` and `verdict`.
  - The block's `build` loop has `max_iterations: 2`.
  - **The budget (ruling 1):** `MOST_TASKS × build.max_iterations × 127000 ≤ 0.6 × LANE_CAPS.small.tokens`. 127,000 is check 77's mean tokens per round.
  - Every wait carries `wh.kind`, `wh.level`, `wh.topic` and `wh.work`.
  - Every script a step names exists.
  - No step in either file names a model.
- [ ] **Step 2: Run** `node --test tests/engine/pack.test.js tests/scripts/engine/pack-check.test.js`. It fails.
- [ ] **Step 3: Write the two workflow files and the four prompts.**
- [ ] **Step 4: Run it, and run `node scripts/engine/pack-check.js`.** It passes. Then validate the built pack on the scratch engine, with no model: `archon validate workflows` over a `buildPack` out folder, through `probes/lib/archon.js`. Expect `wheelhouse-small ok`.
- [ ] **Step 5: Commit:** "Add the small lane to the pack".

### Task 7: Small-lane scenarios on the fake engine (51 to 54)

**Files:**
- Modify: `tests/eval/build-loop/engine-recordings.js` (`started(work, lane = 'quick')`, and a `small(work, …)` builder)
- Create: `tests/eval/build-loop/51-small-lane-to-ready.js`, `52-small-task-question-card.js`, `53-small-fix-round-signed.js`, `54-small-carry-on-keeps-plan.js`
- Modify: `tests/scripts/eval/scenarios-42-50.test.js` (rename it `scenarios-engine.test.js`, and list 42 to 54)

**Interfaces:**
- Consumes: the world of `scripts/eval/engine-world.js` (`put`, `tick`, `records`, `answer`, `starts`, `acts`, `until`).

- [ ] **Step 1: Write the four scenarios:**
  - **51:** small work in `engineLanes: ['quick','small']` starts as `small`. The recording plays the plan, three task instances and one clean review round, then ends `completed` with a pull request. The run's `cost` record is written, and no card is raised.
  - **52:** a task's blocked question (level 3) gives one card with the step's options and recommendation. Answering it carries the run on.
  - **53:** the review's first round holds (HIGH in spec) and the second is clean. The recording's outputs give `review-spec` from the last round. The run reaches ready, and no `review-findings` card is raised.
  - **54:** a small run cancelled at its cap, then Give it more, starts again with `carryOn: true` on the same branch. The cap counts the first run's spend.
  - Also: small work with `engineLanes: ['quick']` is held for the old engine: no `start`.
- [ ] **Step 2: Run** `node --test tests/scripts/eval/scenarios-engine.test.js`. The new scenarios fail until their recordings are complete.
- [ ] **Step 3: Finish the recordings until each scenario passes.** Change the helper or dispatcher only if a scenario shows a real gap, and keep any such change small.
- [ ] **Step 4: Run** `node --test tests/scripts/eval/scenarios-engine.test.js`. It passes.
- [ ] **Step 5: Commit:** "Add the small lane's engine scenarios".

### Task 8: The small lane's steps end to end

**Files:**
- Create: `tests/e2e/engine-small.test.js`, `tests/fixtures/engine/small-lane.jsonl`

**Interfaces:**
- Consumes: as `tests/e2e/engine-quick.test.js` (helper, stand-in host, fake engine, `withTicket`), plus Tasks 2 to 4's scripts run in a git fixture worktree.

- [ ] **Step 1: Write the test.** In a worktree of a bare remote:
  - Commit a plan with two tasks.
  - Run `plan-file --tasks` to get `["1","2"]`.
  - For each task, commit code and a tick, then run `task-check`, which exits 0.
  - Run `tasks-done` to get `blocked: false`.
  - Run `unplan` to remove the plan in its own commit.
  - Run `plan-file --gate` to get `planned: true` (from history) and `--tasks` to get `[]`.
  - Play the `small-lane.jsonl` recording, whose review steps are bare ids from the last round, through the helper. Then `review-sign` gives `{ clean: true }`, the verdict comment names the final head, `ready` hands the PR to the merge queue, and one lesson is written.
  - No host tool runs.
- [ ] **Step 2: Run** `node --test tests/e2e/engine-small.test.js`. It fails until the fixture is complete.
- [ ] **Step 3: Complete the fixture.**
- [ ] **Step 4: Run it.** It passes.
- [ ] **Step 5: Commit:** "Run the small lane's steps end to end".

### Task 9: Docs and the stub's status

**Files:**
- Modify: `docs/superpowers/plans/2026-10-29-archon-part-4-later-lanes.md` (stub 4.1: "Planned in 2026-10-30-archon-part-4-1-small-lane.md")
- Modify: `docs/specs/2026-10-29-wheelhouse-on-archon-design.md` 7.2's small row: "one block instance per task, inside the run (fan_out on an include), at most 8 tasks and 2 rounds each"; and the plan file's removal before review

- [ ] **Step 1: Edit both files.**
- [ ] **Step 2: Commit:** "Note how the small lane runs its tasks".

## Review Focus

1. **A plan with no task lines, or with numbered tasks out of order or repeated.** Expect: `--problem` `none`, a card, and no empty fan-out that silently skips building. Test in Task 2: duplicate numbers count once, by first appearance, and no tasks gives `none`.
2. **A builder that never ticks its task, but commits working code.** Expect: the task's two rounds end, `tasks-done` raises `tasks-unfinished`, and nothing goes on to review half-built. Test in Task 3.
3. **A reviewer whose output isn't valid JSON or lacks `findings`.** Expect: the lens holds (counted as BLOCKER), so the fix loop can't close on garbage. Test in Task 4.
4. **A rerun after the plan was removed.** Expect: `plan-gate` says planned from history, `tasks` is `[]`, the plan step doesn't run again, and the run goes straight to the checks and review. Tests in Tasks 2 and 8.
5. **A lens that ran in round 1 but not in round 2.** Expect: its round-1 output still counts for signing, since it was CLEAN and ruling 5 reruns only held lenses, while a lens that held must rerun. Test in Task 1 (the last round wins, and a skipped round leaves the earlier output) and Task 4 (`--held`).
