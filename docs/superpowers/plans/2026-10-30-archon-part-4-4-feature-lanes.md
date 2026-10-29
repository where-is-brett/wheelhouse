<!-- docs/superpowers/plans/2026-10-30-archon-part-4-4-feature-lanes.md -->
# Wheelhouse on Archon, part 4.4: the feature slice and feature lanes, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feature work approved by the director runs on Archon. Each slice of the approved design is a `wheelhouse-slice` run, merged behind the feature's flag. A last `wheelhouse-feature` run reviews the whole feature, switches the flag on and waits for the director's switch-on approval.

**Architecture:** The feature stays one work record, in the `feature` lane. Its slices come from the approved design document: a fenced `wheelhouse-slices` block, checked against the approval's hash. The dispatcher's runner starts slice 1. It starts each later slice only once the slice before has merged, which it reads from the host. Once the last slice has merged it starts the finish run. All of these runs are recorded under the feature's work id, so its spend rolls up, and a feature holds one feature-lane slot from its first slice to its end. Archon child runs are not used, for the reason 4.1 found: a child run has no order or ticket of its own. A polling wait node is not used either: the dispatcher already ticks and reads the host, so starting the next slice there needs no extra moving part.

**Tech Stack:** Node.js scripts (ES modules, `node:test`). The Archon v0.13.0 workflow pack is written in YAML's JSON form. Tests run on the fake engine.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 7.1, 7.2, 7.3, 7.5, 9 and 11. Stub: `docs/superpowers/plans/2026-10-29-archon-part-4-later-lanes.md`, stub 4.4. The main session's rulings of 30 October 2026, numbered as below.

## Rulings this plan builds to

1. Each slice has its own cap of 120 minutes and 10M tokens. The feature as a whole has an overall cap of (slices + 1) × the slice's tokens, and the meter rolls every run's spend up into the feature's record.
2. Carry on starts a new run that reads the merged slices from the core and skips them.
3. Each slice gets its own branch and pull request into main, behind the flag, through the merge queue. A slice's run ends at mark ready, and the dispatcher starts slice N+1 once N has merged.
4. The slice's order names the flag and the project's own way of setting it. With no way given, the flag is a plain file flag: a key in `config/feature-flags.json`. The switch-on wait is a card, and a step switches the flag on after the director approves.
5. A BLOCKER or HIGH in the whole-feature review starts a fix loop, on the finish run's own branch (the follow-up branch). The review is signed like the others.
6. Every wait is an approval wait that names the head commit. The midpoint demo comes after slice ⌈n/2⌉.
7. The core writes each slice's order. The feature's own (finish) order lists the slices.
8. The critical-area review is spec 11's lens, on the `large` tier, with the spec's trigger rules: the project's `criticalAreas` plus the words.
9. The tester's browser walk reuses the preview step. A slice with nothing visible passes straight through.
10. Plugin naming follows 4.1: every Claude node names `wheelhouse@wheelhouse`.
11. 3a's `stopAll` already covers every run, so a scenario shows that cancelling a feature leaves nothing running and starts no further slice.
12. The scenarios run on the fake engine and are numbered from 70. The one real run waits for 3d and for the main session's go.

## Global Constraints

- British English. Dates as 30 October 2026. A repository-relative path comment atop every file (JSON exempt; the pack's YAML files carry a `#` comment).
- No words such as "enhanced", "improved" or "fixed". No model names in the repository. No AI attribution.
- Scripts in Node.js. The pack names tiers (`small`, `medium`, `large`), never a model.
- Stay out of `scripts/setup/`, uninstall and version files (3d). 4.2 builds beside this plan: keep the changes to `runner.js`, `dispatch-run.js`, `order.js` and `tests/engine/pack.test.js` small, and leave `wheelhouse-bug*` and its prompts alone.
- Tests write nothing to `~/.wheelhouse`, `~/.archon` or `~/.claude`. The helpers in `tests/helpers/homes.js` give temporary homes.
- Only BLOCKER and HIGH review findings hold work back.

## Review Focus

1. **A design changed after its approval.** The hash doesn't match, so nothing starts, and the Logbook says that the design needs approving again. Test in Task 3.
2. **A slice's pull request closed without merging, or never handed to the queue.** The next slice never starts on it, and the feature waits. Test in Task 3.
3. **All stop, or an open incident, between two slices.** No next slice starts until it lifts. Test in Task 3.
4. **A second feature approved while the first is between slices.** It holds for pace. Test in Task 2.
5. **A slice that switches its own flag on.** The flag-off check holds it with a card. Test in Task 5.

---

## File structure

| File | What it does |
|---|---|
| `scripts/engine/feature.js` (new) | Reads the slices block from the design text. Gives a feature's progress from its runs, the orders those runs had and the merged pull requests. Decides what the feature does next, and builds the slice and finish orders. |
| `scripts/engine/flag.js` (new) | The pack's flag step. `--check-off` checks that a slice left its file flag off; `--on` switches the file flag on and commits. |
| `scripts/engine/order.js` | Optional order fields: `slice`, `flag`, `demo` and `feature`. |
| `scripts/engine/order-copy.js` | `--flags` also gives `demo`, `flagFile` and the approval's `topic` and `words`. |
| `scripts/engine/dispatcher.js` | A feature that has started and not ended holds its feature-lane slot. |
| `scripts/engine/dispatch-run.js` | Feature work is started through `feature.js`, plus a `featureTick`. New deps: `prMerged(pr)` and `designOf(work)`. |
| `scripts/host/helper.js` | Wires `prMerged` (the adapter's `prState`) and `designOf` (`approvedDocument`). |
| `scripts/engine/lenses.js` | Security also applies when the change touches the project's `criticalAreas`. |
| `scripts/engine/routes.js` | `review-feature` joins `REVIEW_STEPS`. |
| `scripts/engine/preview.js` | `--walk`: saves the text of each page check's page for the tester. `--flag-on`: switches the file flag on in the local preview only. |
| `scripts/engine/review-round.js` | Accepts `--feature` (the whole-feature lens's output). |
| `scripts/engine/words.js` | Plain words for the new steps. |
| `engine/archon/pack/wheelhouse-slice.yaml`, `wheelhouse-slice-task.yaml`, `wheelhouse-feature.yaml` (new) | The lanes. |
| `engine/archon/pack/prompts/task-review.md`, `tester.md`, `review-feature.md`, `switch-on.md` (new); `implement-task.md`, `plan.md` (a flag paragraph, read from the order) | Prompts. |
| `skills/intake/SKILL.md` | Tells the First Mate to write the slices block into a feature's design. |
| `tests/eval/build-loop/70-*.js` to `75-*.js`, `engine-recordings.js` | Scenarios. |

---

### Task 1: The order's feature fields

**Files:**
- Modify: `scripts/engine/order.js`
- Test: `tests/scripts/engine/order.test.js`

**Interfaces:**
- Produces: `checkOrder` accepts these optional fields:
  - `slice: { n, of, title }`, with 1 ≤ n ≤ of ≤ 12, on lane `slice` only;
  - `flag: { name, file }` or `flag: { name, how }`, where `name` is a SLUG, `file` is a relative path under the repository with no `..`, ending `.json`, and `how` is text of at most 500 characters; on lanes `slice` and `feature` only;
  - `demo: boolean`, on lane `slice` only;
  - `feature: { slices: [{ n, title, pr, head }] }`, with `pr` a positive integer and `head` a full sha; on lane `feature` only.

  `workOrder({ work, ..., extra })` copies `extra`'s `slice`, `flag`, `demo` and `feature` into the order before the check. `DEFAULT_FLAG_FILE = 'config/feature-flags.json'` is exported.

- [ ] **Step 1:** Write tests.
  - `a slice order carries its slice, flag and demo`: a `workOrder` with `extra: { slice: { n: 1, of: 2, title: 'List' }, flag: { name: 'order-history', file: 'config/feature-flags.json' }, demo: false }` gives those fields.
  - `a feature field on the wrong lane is refused`: `slice` on a `quick` order, and `feature` on a `slice` order, each throw `/only a slice order|only a feature order/`.
  - `a flag file outside the repository is refused`: `file: '../x.json'` throws.
- [ ] **Step 2:** Run `node --test tests/scripts/engine/order.test.js`. Expect FAIL.
- [ ] **Step 3:** Implement the checks in `checkOrder` and the `extra` copy in `workOrder`.
- [ ] **Step 4:** Run it again. Expect PASS.
- [ ] **Step 5:** Commit: "Let a work order carry a feature's slice, flag, demo and slices".

### Task 2: Slices from the design, a feature's progress and its next step

**Files:**
- Create: `scripts/engine/feature.js`
- Modify: `scripts/engine/dispatcher.js` (pace)
- Test: `tests/scripts/engine/feature.test.js`, `tests/scripts/engine/dispatcher.test.js`

**Interfaces:**
- `SLICES_FENCE = 'wheelhouse-slices'`; `MOST_SLICES = 12`.
- `readSlices(text) -> { goal, flag, demo: 'midpoint'|'end', slices: [{ title, goal, done, notInScope, protectedFiles }] }`.
  - It throws, in plain words, when the block is missing, isn't JSON, has no slice, has more than 12, or has a slice with no done check (checks as in `order.js`).
  - With no flag `file` or `how`, `flag.file` is `DEFAULT_FLAG_FILE`.
- `demoSlice(design) -> n | null`: ⌈n/2⌉ when `demo === 'midpoint'` and there are at least 2 slices, else null.
- `progressOf({ runs, orderOf, merged }) -> { slices: { [n]: { runs: [run data], pr, head, merged } }, finish: { runs, pr, merged } }`.
  - `runs` are the work's `run` records' data. `orderOf(runId)` is the helper's order. `merged` is the set of merged pull request numbers.
- `featureNext({ design, progress, live }) -> { act: 'wait' } | { act: 'start', slice: n } | { act: 'start', finish: true } | { act: 'done', pr }`.
  - It waits while a run is `live`, or while the latest ended run's PR hasn't merged.
  - Otherwise it starts the first slice with no merged PR, then the finish run once every slice has merged. It is done once the finish PR has merged.
  - A slice whose latest run ended with no PR waits: the runner's Carry on or the card decides it, never the dispatcher.
- `sliceOrder({ entry, design, n, config, settings, raised, answers })` and `finishOrder({ entry, design, progress, config, settings, raised, answers })` give `workOrder` results.
  - Slice: lane `slice`; the goal is the slice's; its done checks and its `notInScope`; caps `limitsFor('slice')`; `slice`, `flag`, and `demo` equal to (n === demoSlice); `showFirst` true only for the demo slice.
  - Finish: lane `feature`; the goal is `Switch on: ${design.goal}`; done is every slice's checks, deduplicated; caps `limitsFor('slice')`; `flag`; `feature.slices` from progress; `showFirst` true; the preview as the work's visible flag gives it.
- `featureCap(design, settings) -> tokens`: (slices + 1) × `limitsFor('slice', settings).tokens`.
- Dispatcher: a work in the `feature` lane with any run since it was queued, and no `merged` or `closed` report, counts as live for `PACE.featureLane` and `building`, whether or not a run is going now.

- [ ] **Step 1:** Write the feature tests:
  - `the slices block is read from the design`;
  - `a design with no slices block, or a slice with no done check, is refused in plain words`;
  - `the midpoint demo is slice 2 of 3 and slice 1 of 2, and none of 1`;
  - `the next step is slice 1, then slice 2 once slice 1 merged, then the finish run, then done`;
  - `a slice whose pull request hasn't merged waits, and one with no pull request waits`;
  - `a carried-on slice keeps its number`: two runs of slice 2, the first cancelled, give slice 2's runs as both;
  - `the slice order names its flag and slice, and only the demo slice is shown first`;
  - `the finish order lists the merged slices and is shown first`.
- [ ] **Step 2:** Write the dispatcher test `a feature between slices still holds the feature lane, so a second feature waits for pace`.
- [ ] **Step 3:** Run both. Expect FAIL.
- [ ] **Step 4:** Implement `feature.js`, and the `live` rule in `dispatch()`.
- [ ] **Step 5:** Run both. Expect PASS. Commit: "Read a feature's slices from its approved design and decide its next run".

### Task 3: The dispatcher's runner drives a feature

**Files:**
- Modify: `scripts/engine/dispatch-run.js`, `scripts/host/helper.js` (wiring only)
- Test: `tests/scripts/engine/dispatch-feature.test.js` (new)

**Interfaces:**
- `dispatchRun` takes two new deps:
  - `prMerged(pr) -> true|false|null`: null when the host can't say.
  - `designOf(work) -> { text } | { problem } | null`: `approvedDocument` against the project's folder.
- `startPiece`, for an entry in the `feature` lane:
  - It reads the design. A problem refuses with `the feature's design ${problem}`.
  - It works out the progress, and builds `sliceOrder` or `finishOrder` for `featureNext`'s step. A lane of `slice` or `feature` from the caller is accepted.
  - A carry-on keeps its branch.
- `featureTick()`, after `fixTick` and before the dispatch, for each feature entry that has runs and no ending report:
  - It asks `prMerged` for each ended run's PR that isn't known merged. Merged PRs are kept in `state.features[work].merged`.
  - For each newly merged slice it writes a Logbook note: `Slice ${n} of ${of} of ${title} is added, behind its switch.`
  - On `start`, with no All stop, no open incident and the spend under `featureCap`, it starts through `startPiece`.
  - Over the cap, it raises one level-3 card. **Keep going** raises the cap by half, once. **Stop here** ends nothing and starts nothing.
  - On `done`, it writes `report { work, outcome: 'merged', pr, summary: 'Switched on, every slice added.', rulings: [] }`.
  - A design problem writes one note: `${title} waits: its approved design ${problem}, so it needs approving again.`
- The helper wires `prMerged: (pr) => adapter.prState(pr).state === 'merged'`, catching errors to null, and `designOf: (work) => approvedDocument({ checkout: folder, views: views(), work })`.

- [ ] **Step 1:** Write the tests, with a fake `start`, `prMerged` and `designOf`:
  - `approved feature work starts slice 1 with a slice order`;
  - `slice 2 starts only after slice 1's pull request reads merged, with a note`;
  - `the finish run starts once every slice merged, and its merge ends the work with a report`;
  - `nothing starts between slices under All stop or an open incident`;
  - `a design changed since approval starts nothing and says so once`;
  - `over the feature's cap, one card; Keep going raises it once`;
  - `a carry-on of a cancelled slice 2 restarts slice 2 on its branch, not slice 1`.
- [ ] **Step 2:** Run `node --test tests/scripts/engine/dispatch-feature.test.js`. Expect FAIL.
- [ ] **Step 3:** Implement. Keep the diff to `dispatch-run.js`'s existing functions small: branch into feature handling at the top of `startPiece`, and add `featureTick` as its own function.
- [ ] **Step 4:** Run it with `dispatch-run.test.js` and `dispatch-fix.test.js`. Expect PASS. Commit: "Run a feature's slices one after another, then its switch-on run".

### Task 4: The critical-area lens, the whole-feature lens and the flag step

**Files:**
- Modify: `scripts/engine/lenses.js`, `scripts/engine/routes.js`, `scripts/engine/review-round.js`, `scripts/engine/order-copy.js`
- Create: `scripts/engine/flag.js`
- Test: `tests/scripts/engine/lenses.test.js`, `review-round.test.js`, `flag.test.js` (new), and `routes` (whichever routes test covers `review`)

**Interfaces:**
- `lenses.js`:
  - `security` is also true when `classifyChange({ paths, config })` names a critical area. `config` is `readConfig` of the worktree's `.claude/wheelhouse.json`, and an unreadable file counts as touching (fail closed).
  - It prints `feature: true` when the order's lane is `feature`, so the whole-feature lens runs every round.
- `REVIEW_STEPS` gains `'review-feature'`.
- `review-round.js`: `--feature <output>` counts like the other lenses.
- `order-copy.js --flags` prints `{ visible, showFirst, demo, flagFile, topic, words }`.
  - `topic` is `switch-on` on lane `feature`, `midpoint-demo` when `demo` is true, else `shown-first`.
  - `words` is the approval card's sentence for that topic.
- `flag.js`:
  - `--check-off --run <id>` reads the order's flag and prints `{ clean }`. It is clean when the flag has no file, or the file lacks the key, or the key is `false`.
  - `--on --run <id>` sets the key to `true` in the file (creating it as `{}` first), commits `Switch on ${name}`, and prints `{ switched: true }`. With a `how` flag it prints `{ switched: false }`, for the AI switch-on step.

- [ ] **Step 1:** Write the tests:
  - `a change in a project's critical area brings the security lens though no word matches`;
  - `the finish run always runs the whole-feature lens`;
  - `review-feature is signed like the other lenses`: a route test where a FINDINGS verdict blocks ready;
  - `the fix round counts the whole-feature lens's findings`;
  - `flags give the switch-on and midpoint topics`;
  - `the flag is checked off and switched on in its file, and a how flag is left to the step`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expect PASS. Commit: "Add the critical-area trigger, the whole-feature lens and the flag step".

### Task 5: The tester's walk in the preview step

**Files:**
- Modify: `scripts/engine/preview.js`
- Test: `tests/scripts/engine/preview.test.js`

**Interfaces:**
- `makePreview({ ..., walk = [], flagOn = null, dump = dumpPage })`.
  - `walk` is the order's page checks.
  - For each page check, while the preview is up, `dump({ browser, url, local })` gives the page's HTML. It is saved as `walk/<pictureName(page, desktop)>.html`, with its visible text as `.txt`.
  - The results go into `notes.json` as `walk: [{ page, mustShow, saved: bool, why? }]`, plus `accessibility: [{ page, problems: [text] }]`. The problems are: an image with no `alt`; a field with no label; a button or link with no name; a page with no `lang` or `title`.
- `flagOn: { file, name }` (local preview only): it sets the key true in the worktree's file before the preview command starts, and puts the file back as it was in `finally`. With a host preview, `notes.json` says `the switch stays off on the host's preview`.
- `main`:
  - `--walk` fetches the order (`client.engine.order`) and walks its page checks.
  - `--flag-on` uses the order's flag when it has a `file`.
  - The output gains `walked: n` and `checks: m` (the order's page checks).
- `dumpPage` runs Chrome with `--headless --dump-dom` in a fresh profile, removed afterwards, to the same address rule as `takePicture`.

- [ ] **Step 1:** Write the tests:
  - `page checks are walked and saved with what they showed`;
  - `the accessibility check names an image with no alt and a field with no label`;
  - `the flag is on only while the local preview runs, and put back`;
  - `with nothing visible, nothing is walked and the output says 0 checks`.
- [ ] **Step 2:** Run `node --test tests/scripts/engine/preview.test.js`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it. Expect PASS. Commit: "Walk a slice's page checks in the preview, and show the flag on in a demo".

### Task 6: The pack: `wheelhouse-slice-task`, `wheelhouse-slice` and `wheelhouse-feature`

**Files:**
- Create: the three YAML files and the four prompts listed in the file structure.
- Modify: `engine/archon/pack/prompts/plan.md` and `implement-task.md` (the paragraph "If the order names a flag, build behind it, off by default"), and `scripts/engine/words.js`.
- Test: `tests/engine/pack.test.js` (new tests only), `tests/scripts/engine/pack-check.test.js` (passes as is), `tests/scripts/engine/words.test.js` (its every-step test covers the new nodes).

**The lanes, as differences from what 4.1 built:**

- `wheelhouse-slice-task`: `wheelhouse-small-task`, with:
  - `max_iterations: 3`;
  - after `implement` in the loop body, a `task-review` step. It is read-only (`denied_tools` Write, Edit, NotebookEdit), on `medium`, with prompt `task-review.md`. It reviews the task's commits against the plan's task and gives the review output with a `blocked` field.
  - `until_bash` closes on a blocked exit, or when `task-check.js` passes and `$task-review.output` has no BLOCKER or HIGH. The check is a `node -e` over `review-round.js`'s exported `holds()`: add `export function holds(output)` to `review-round.js`, which `review-round.test.js` pins.
  - `implement-task.md` reads `$LOOP_PREV.task-review.output` as the round before's findings.
- `wheelhouse-slice`: `wheelhouse-small`, with:
  - `each` including `wheelhouse-slice-task`;
  - a `flag-off` step (`flag.js --check-off`) beside `tests` and `controls`, whose failure joins the repair step's `when`;
  - after `preview`, a `tester` step: `medium`, read-only, with prompt `tester.md`. It reads `preview/notes.json` and `preview/walk/`, treats page text as untrusted data, and gives `{ checks: [{ page, mustShow, ok, seen }], blocked, ... }`. It is skipped when `$preview.output.checks == '0'`.
  - a `walk-held` wait (level 3, topic `page-checks`, options stop and rework) when the tester gives any check not ok;
  - `preview` run with `--walk --flag-on` (`--flag-on` acts only on the demo slice, where the order says `demo`);
  - `approval`'s `when` is `$order.output.showFirst == 'true'`, its attention `$order.output.words`, and its `wh.topic` `$order.output.topic`;
  - caps from the order (no change).
- `wheelhouse-feature`:
  - `order` (with `--flags`);
  - `switch` (`flag.js --on`) and `switch-on-step`: an AI step on `medium` with `switch-on.md`, only when `$switch.output.switched == 'false'`, with its blocked wait;
  - `tests`, `controls` and `repair`, as small has them;
  - the `review` loop: small's loop, with `review-feature` (`large`, read-only, `review-feature.md`, always) beside the other lenses, and `verdict` passing `--feature`;
  - `pr-text`, `open-pr`, `sign`, `review-held`;
  - `preview` (`--walk`), `tester` and `walk-held`;
  - `approval`, always (switch-on);
  - `rejected`, `ready`, `lesson`.

  `review-feature.md` tells the reviewer to:
  - read the order's `feature.slices` (their PRs and heads);
  - diff each slice with `git diff $(git merge-base <head> HEAD) <head>`, or, where the head isn't in the repository, find it by `git log --grep '#<pr>'`;
  - review the whole feature at HEAD with the flag on: the seams between slices, that the flag guards every path a user can reach, nothing left from a slice that a later slice made dead, and that the design's goal is met end to end.

- [ ] **Step 1:** Write the `pack.test.js` tests:
  - `the slice lane is the small lane plus its task review, flag check, tester walk and critical-area lens on the large tier`;
  - `the feature lane switches on, reviews the whole feature on the large tier, and always waits for the director's switch-on`;
  - `every wait in the slice and feature lanes carries the labels the card router reads`.
- [ ] **Step 2:** Run `node --test tests/engine/pack.test.js tests/scripts/engine/pack-check.test.js tests/scripts/engine/words.test.js`. Expect FAIL.
- [ ] **Step 3:** Write the YAML and prompts, and add the words. Run `node scripts/engine/pack-check.js` if it has a command line; otherwise, the pack test's build covers it.
- [ ] **Step 4:** Run the tests. Expect PASS. Where the scratch Archon from `probes/lib/archon.js` is on this computer, also run its `validate workflows` on a build. Commit: "Add the feature slice and feature lanes to the pack".

### Task 7: The First Mate's hand-over

**Files:**
- Modify: `skills/intake/SKILL.md` (the Feature row and a short section)
- Test: `tests/skills/` (whichever test pins intake's text; add `the intake skill shows the slices block`)

- [ ] **Step 1:** Write the test. It asserts that the skill names the `wheelhouse-slices` fence, `flag`, `demo` and a slice's `done`.
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Write the section: the block's JSON form with one example slice, and what each field means. Done checks take the work order's three forms. The flag defaults to a key in `config/feature-flags.json`. `demo` is the director's midpoint-demo choice.
- [ ] **Step 4:** Run it. Expect PASS. Commit: "Show the First Mate how a feature's design lists its slices".

### Task 8: Scenarios 70 to 75

**Files:**
- Create: `tests/eval/build-loop/70-feature-two-slices.js`, `71-feature-midpoint-demo.js`, `72-feature-carry-on.js`, `73-feature-cap.js`, `74-feature-pace.js`, `75-feature-design-changed.js`
- Modify: `tests/eval/build-loop/engine-recordings.js` (`sliceRun`, `finishRun`, `featureWork`), `tests/scripts/eval/scenarios-engine.test.js` (the list), and the eval runner's scenario list if it keeps one.

The scenarios:
- **70:** An approved two-slice feature with no midpoint demo.
  - Slice 1's order carries the slice and the flag. Its PR merges (the world's host `prState`). Slice 2 starts, and its PR merges.
  - The finish run's order lists both slices. Its switch-on approval card names the PR and head.
  - Once that PR merges, the work's report reads merged.
- **71:** A three-slice feature with a midpoint demo. Only slice 2's order is shown first, and its approval card's topic is `midpoint-demo`.
- **72:** All stop during slice 2. Slice 2's run is cancelled, and no slice starts while stopped.
  - The card's Carry on starts slice 2 again on its branch. Slice 1 never runs again.
  - No run is left going after the stop.
- **73:** The feature's spend passes its overall cap after slice 1. One card, and no slice 2 until **Keep going**.
- **74:** A second approved feature waits for pace while the first is between slices. Quick work still starts.
- **75:** The design has changed since its approval, so nothing starts and the Logbook says it needs approving again.

- [ ] **Step 1:** Write the scenarios and recordings.
- [ ] **Step 2:** Run `node --test tests/scripts/eval/scenarios-engine.test.js`. Expect FAIL before Tasks 2 to 3 if built out of order. Built in order, each scenario should pass or show a gap to close.
- [ ] **Step 3:** Close any gap in the owning task's file, test first.
- [ ] **Step 4:** Commit: "Add the feature lane's scenarios, 70 to 75".

### Task 9: Checks, review and the pull request

- [ ] Run the touched test files and every file under each touched test folder, `tests/scripts/agents/core-neutral.test.js` and `tests/scripts/frontdesk/desk-parity.test.js`.
- [ ] Run an independent whole-branch review with `superpowers:requesting-code-review`. Fix BLOCKER and HIGH findings test first, and list the MEDIUMs in the PR.
- [ ] Push and open the PR. Its body gives the deviations: no Archon child runs and no polling wait node, and the slices come from the design document.
- [ ] Once Linux CI is green, message the main session.

## Not in this plan

- **The one real two-slice run on `where-is-brett/wheelhouse-merge-trial`** ($8 ceiling). It waits for 3d and for the main session's go.
- **Recording merges of quick and small work as `report` records.** Nothing on the new engine writes one today, so `dependsOn` between engine work never clears. This plan writes the merged report for features only. The rest is a follow-up for the main session.
