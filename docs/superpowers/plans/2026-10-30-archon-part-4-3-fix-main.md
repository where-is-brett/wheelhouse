<!-- docs/superpowers/plans/2026-10-30-archon-part-4-3-fix-main.md -->
# Wheelhouse on Archon, stub 4.3: fix main (`wheelhouse-fix-main`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Archon's merge gate holds on a red main line, Wheelhouse opens a red-main incident, starts one `wheelhouse-fix-main` run, merges its fix through the helper's own gate, and lets held work go on once the main line is green.

**Architecture:** The card router already answers the queue's `hold` at level 1 (part 3c); the runner now also records a `red-main` incident. The dispatcher's runner starts one fix-main run per incident, watches the default branch's checks through the helper's host adapter, closes the incident when they are green, and raises one level-3 card when a fix fails. The fix merges through a new ticketed route, `/engine/merge-fix`, which runs the helper's existing merge gate with the fix recognised only from the helper's own record of the run, never through Archon's queue.

**Tech Stack:** Node.js (ES modules, `node:test`), Archon v0.13.0 workflow YAML (JSON form, as the quick lane), the fake engine and the engine scenarios.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 7.3, 7.7, 8.3, 11 and 12.4; stub 4.3 in `docs/superpowers/plans/2026-10-29-archon-part-4-later-lanes.md`; checks 76 and 78; the main session's rulings of 30 October 2026 (below).

## Rulings this plan builds to (main session, 30 October 2026)

1. Answering `hold` records an incident of kind `red-main`.
2. The fix is known by its lane, on the helper's own record of the run.
3. One fix-main run per incident.
4. The incident closes when the default branch's checks read green, from a read-only look on each dispatcher tick; held work is then released.
5. A failed fix raises a level-3 card that holds everything and ignores the daily budget; its options include undoing the suspect pull request (recommended where the sweep names one) and fixing forward.
6. The fix keeps its review steps; the incident lifts only the "no incident open" rule.
7. **Changed from the first ruling:** the fix merges through `/engine/merge-fix` and the helper's own gate, never Archon's merge queue. Why: Archon v0.13.0's gate (`.archon/workflows/sdlc/.shared/merge.ts`, `gateRefusals`) refuses every merge while the default branch is red, the fix included (check 76's red leg merged nothing until main was green), so handing the fix to the queue would wait for ever. Spec 7.7 makes code that makes CI pass level 1, and E3's fallback keeps merging with the helper's own gate.
   - It is the incident's fix only when the helper itself recorded the pull request as opened by that fix-main run, for that open incident, at that head.
   - A fix that would make main green by weakening the checks gets the level-3 card, never a merge: a deleted or skipped test, fewer assertions, changed test or coverage settings, or a change to CI files, `.archon/` policy, agent control files or any other guardrail path.
   - The route serves only the run's merge step, and once per run: a second call after a merge is refused.
8. Running work finishes to its pull request; the permit holds its merge.
9. Every fix-main step is safe to run again (Carry on restarts the lane on its branch, check 78).
10. Scenarios run on the fake engine; the counted run on real Archon is the main session's, once per plan.
11. The broker allows `gh run rerun <id> --failed` only for a run on the default branch while a red-main incident is open; the lane tries it first, as the cheapest fix.

## Global Constraints

- British English; dates as 30 October 2026; a repository-relative path comment atop every file (JSON exempt; the pack's YAML files carry `#`).
- No words such as "enhanced", "improved" or "fixed" in names or text; no model names anywhere in the repository; no AI attribution.
- Scripts in Node.js. Core files (`scripts/engine/*.js` outside `archon/`, `scripts/host/`) must not name Copilot (`tests/scripts/agents/core-neutral.test.js`).
- The routing table is the only place that names a model; the pack uses tiers (`small`, `medium`, `large`) only.
- Usage pressure never lowers a level, relaxes a review or skips a check.
- Stay out of `scripts/setup/`, uninstall and the version files (part 3d), and `wheelhouse-small.yaml`, its prompts, `writing-plans` and `receiving-code-review` (stub 4.1). Changes to `dispatch-run.js`, `runner.js` and `scripts/eval/engine-world.js` stay small and are named in the PR.
- Engine scenarios for this part are numbered from 60.
- Nothing is written to `~/.wheelhouse`, `~/.archon` or the director's `~/.claude` during tests.

## Review Focus

- **A second `hold` while the incident is open** (another queue run already under way when main went red): no second incident, no second fix run. Test in Task 2 and Task 4.
- **A fix whose pull request head moved after the run opened it** (someone pushed to the branch): not the fix; the normal gate refuses it while the incident is open. Test in Task 5.
- **Main turns green by itself** (a flaky job, or the rerun) while the fix run is still working: the incident closes, held work goes on, and the fix run is left to finish; its merge is then an ordinary one (normal gate). Test in Task 4.
- **All stop while the fix runs**: nothing new starts; after the lift the dispatcher does not start a second fix run for the same incident while the first is listed as cancelled — it carries the same run's branch on. Test in Task 4.
- **The host can't be read for the main line's checks**: the incident stays open (never closed on an unknown), and the Logbook says nothing new. Test in Task 4.

## File Structure

- Create `scripts/engine/fix-main.js` — the pure rules: the incident for a red-main ask, the fix work's id and order, the fix decision each tick, and what weakens the checks.
- Create `engine/archon/pack/wheelhouse-fix-main.yaml` and `engine/archon/pack/prompts/fix-main.md` — the lane.
- Create `scripts/engine/fix-rerun.js` — the lane's first step: re-run the main line's failed jobs once and wait for them.
- Create `scripts/engine/merge-fix.js` — the lane's merge step: asks the helper to merge the fix.
- Modify `scripts/state/events.js`, `scripts/state/views.js` — the incident's `kind`/`suspect`/`work`, and `incident-closed`, a helper-only record that closes a red-main incident.
- Modify `scripts/engine/archon/asks.js` — the `main-line-red` row marks the ask as opening a red-main incident and keeps the suspect.
- Modify `scripts/engine/runner.js` — writes the incident after answering that ask.
- Modify `scripts/engine/dispatch-run.js` — starts the fix, closes the incident, writes the failed-fix card and acts on its answer.
- Modify `scripts/engine/routes.js` — records the lane and incident in `opened`; adds `mergeFix`.
- Modify `scripts/engine/broker/rules.js` — classifies `run rerun` and allows it under ruling 11.
- Modify `scripts/host/helper.js`, `scripts/host/helper-client.js` — wires the route, the merge with the verified fix, the main-line check and the broker's rerun context.
- Create `tests/eval/build-loop/60-red-main-fixed.js`, `61-fix-weakens-checks.js`, `62-non-fix-refused-while-red.js`, their recordings in `engine-recordings.js`, and `tests/scripts/eval/scenarios-60-62.test.js`.

---

### Task 1: The incident records

**Files:**
- Modify: `scripts/state/events.js` (the `incident` shape; `HELPER_ONLY_KINDS`; a new plain kind `incident-closed`)
- Modify: `scripts/state/views.js:415-436` (incidents)
- Test: `tests/scripts/state/events.test.js`, `tests/scripts/state/views.test.js`

**Interfaces:**
- Produces: `incident` data `{ id, what, kind?: 'red-main', suspect?: number|null, work?: string }`; `incident-closed` data `{ incident, why }`, helper-only; `views.incidents.open[i]` gains `kind`, `suspect`, `work`.

- [ ] **Step 1: Failing tests:** `an incident may carry its kind, suspect and work`; `incident-closed is the helper's own record`; `incident-closed closes a red-main incident`; `incident-closed does not close an incident the director declared` (no `kind`); `a red-main incident opened again after it closed is open`.
- [ ] **Step 2:** Run `node --test tests/scripts/state/events.test.js tests/scripts/state/views.test.js`; the new tests fail.
- [ ] **Step 3:** Add `may: ['kind', 'suspect', 'work']` to the incident shape (`kind` must be `'red-main'` when given; `suspect` a whole number or null); add `incident-closed: { must: ['incident', 'why'] }` to `PLAIN_SHAPES`, `PLAIN_KINDS` and `HELPER_ONLY_KINDS`; in the views, an `incident-closed` after a `red-main` incident with the same id removes it from `open`.
- [ ] **Step 4:** The two files pass.
- [ ] **Step 5:** Commit: `Record a red-main incident and its close`.

### Task 2: Opening the incident when `hold` is answered

**Files:**
- Create: `scripts/engine/fix-main.js`
- Modify: `scripts/engine/archon/asks.js` (the `main-line-red` row), `scripts/engine/runner.js` (`onAsk`)
- Test: `tests/scripts/engine/fix-main.test.js`, `tests/scripts/engine/archon/asks.test.js`, `tests/scripts/engine/runner.test.js`

**Interfaces:**
- Produces in `fix-main.js`: `RED_MAIN = 'red-main'`; `FIX_LANE = 'fix-main'`; `redMainIncident(ask, { now }) -> { id, what, kind: 'red-main', suspect }`, where `id` is `red-main-<first 10 hex of sha256(ask.id)>`; `openRedMain(views) -> incident | null`; `suspectOf(text) -> number | null` (the first `#<n>` or `pull request <n>` in the sweep's words).
- The normalised ask from the `main-line-red` row gains `opens: 'red-main'` and `suspect`.

- [ ] **Step 1: Failing tests:** `the red main line's ask opens a red-main incident naming the suspect`; `suspectOf reads "#12" and "pull request 12", and gives null for none`; `answering hold writes one red-main incident`; `a second hold while one is open writes no second incident`; `a hold under All stop opens no incident until it is answered`.
- [ ] **Step 2:** Run the three test files; the new tests fail.
- [ ] **Step 3:** Implement `fix-main.js`'s functions above; mark the row; in `runner.onAsk`, after the answer is accepted (`got.ok`) and `ask.opens === RED_MAIN`, write the incident when `openRedMain(readViews())` is null. The Logbook line stays the router's.
- [ ] **Step 4:** The three files pass.
- [ ] **Step 5:** Commit: `Open a red-main incident when the merge queue holds on a red main line`.

### Task 3: The lane

**Files:**
- Create: `engine/archon/pack/wheelhouse-fix-main.yaml`, `engine/archon/pack/prompts/fix-main.md`, `scripts/engine/fix-rerun.js`, `scripts/engine/merge-fix.js`
- Modify: `scripts/host/helper-client.js` (`engine.mergeFix`)
- Test: `tests/scripts/engine/pack-check.test.js`, `tests/scripts/engine/fix-rerun.test.js`, `tests/scripts/engine/merge-fix.test.js`

**Interfaces:**
- Steps, in order: `order`; `rerun` (bash, `fix-rerun.js`, prints `{ green, rerun }`); `implement` (as the quick lane's loop group, prompt `prompts/fix-main.md`, when `$rerun.output.green == 'false'`) and its blocked wait; `tests`, `controls`, `held`; `lenses`; the review lenses and their blocked waits; `pr-text`; `open-pr`; `sign`; `review-held`; `merge` (bash, `merge-fix.js`, the last step that changes anything); `lesson`, `lesson-record`. No preview, approval or ready step. `returns: open-pr`. Every Claude node names the Wheelhouse plugin.
- `fix-rerun.js --run <id> --base <ref> [--wait-ms n]`: through `gh` (the broker), lists the newest failed Actions run on the base branch (`gh run list --branch <base> --status failure --limit 1 --json databaseId,headSha`), and when it is the base's head, re-runs it (`gh run rerun <id> --failed`) and waits (10 minutes at most, `gh run view <id> --json status,conclusion` each 20 seconds); prints `{ green: true|false, rerun: true|false }` and exits 0. No run found, or any `gh` refusal: `{ green: false, rerun: false }`.
- `merge-fix.js --run <id>`: `client.engine.mergeFix({ runId })`; prints the result; exits 1 on a refusal.
- `helper-client` gains `engine.mergeFix(body)` → `POST /engine/merge-fix`.

- [ ] **Step 1: Failing tests:** `checkPack accepts wheelhouse-fix-main`; `the fix-main lane has no preview, approval or ready step, and merge is its last changing step`; `the fix-main lane's implement step runs only when the rerun didn't make main green`; `fix-rerun re-runs the newest failed run on the base head and reports green`; `fix-rerun reports not green when no failed run is found`; `fix-rerun reports not green when the broker refuses`; `fix-rerun stops waiting at its limit`; `merge-fix prints the refusal and exits 1`.
- [ ] **Step 2:** Run the three files; the new tests fail.
- [ ] **Step 3:** Write the workflow from the quick lane's form; the prompt tells the builder: make the main line's checks pass; never delete, skip or loosen a test, and never change CI, test or coverage settings (the order lists no protected files), which is a blocked exit; where a suspect pull request is named and the order's goal says to undo it, `git revert` its merge commit. Write the two scripts with `run` and `client` injectable, as `ready.js` is.
- [ ] **Step 4:** The three files pass; `node scripts/engine/pack-check.js` reports the pack clean.
- [ ] **Step 5:** Commit: `Add the fix-main lane`.

### Task 4: The dispatcher starts the fix, closes the incident and raises the failed-fix card

**Files:**
- Modify: `scripts/engine/fix-main.js`, `scripts/engine/dispatch-run.js`
- Test: `tests/scripts/engine/fix-main.test.js`, `tests/scripts/engine/dispatch-run.test.js`

**Interfaces:**
- `fixWorkOf(incident) -> 'fix-main-<incident.id>'`.
- `fixOrder(incident, { config, settings, attempt, revert }) -> Order` (through `workOrder`): lane `fix-main`, level 1, `incident: incident.id`, goal "Make the main line's checks pass again." or, with `revert`, "Undo pull request #<n>, which broke the main line's checks.", done `[{ command: config.testCommand, expect: 0 }]`, no protected files, caps `limitsFor('fix-main', settings)`.
- `fixDecision({ incident, runs, green, stop, kept }) -> { act: 'start'|'wait'|'close'|'card'|'none', why? }`:
  - no open red-main incident: `none`;
  - `green === true`: `close`;
  - stop: `wait`;
  - no run for the fix work, and no card waiting: `start`;
  - the latest run live: `wait`;
  - the latest run ended `cancelled` by All stop (its record says so): `start` with `carryOn` on its branch;
  - the latest run ended any other way while main is not green, and no card for this attempt: `card`;
  - otherwise `wait`.
- `dispatchRun({ …, mainGreen })`: `mainGreen()` resolves `true`, `false` or `null` (unknown); the tick runs the fix decision before `dispatch`. On `close` it writes `incident-closed` `{ incident, why: 'the main line\'s checks are green' }` and the Logbook line "The main line is green again, so held work goes on."; on `start`, `start({ project, order: fixOrder(...), branch?, carryOn? })` and a Logbook line "The main line is red, so Wheelhouse started fixing it; other work waits."; on `card`, one `question` `q-fix-main-<incident>-<attempt>` at level 3 with options **Undo #<suspect>** (when a suspect is known, and recommended), **Fix it forward**, **Leave it**. An answer starts the next attempt (`revert` for Undo), or nothing for Leave it.
- The order module accepts `incident` on an order (`checkOrder`, `workOrder`).

- [ ] **Step 1: Failing tests (fix-main):** one per `fixDecision` branch above; `fixOrder gives a level-1 fix-main order naming the incident`; `fixOrder with revert names the suspect`.
- [ ] **Step 2: Failing tests (dispatch-run):** `a red-main incident starts one fix-main run and holds other work`; `a second tick starts no second fix run`; `green checks close the incident and held work starts on the next tick`; `unknown checks keep the incident open`; `a fix run that failed brings one level-3 card recommending Undo #12`; `the card's Fix it forward starts a second attempt`; `All stop then lift carries the cancelled fix on, on its branch`; `the merge queue doesn't start while the incident is open`.
- [ ] **Step 3:** Run the two files; the new tests fail.
- [ ] **Step 4:** Implement; keep the change to `dispatch-run.js` to one call before `dispatch` and the card's answer, beside the clash card's.
- [ ] **Step 5:** The two files and `tests/scripts/engine/order.test.js` pass.
- [ ] **Step 6:** Commit: `Start the fix for a red main line, and close the incident once it is green`.

### Task 5: The merge route and the helper's gate

**Files:**
- Modify: `scripts/engine/fix-main.js` (`weakensChecks`), `scripts/engine/routes.js` (`openPr`, `mergeFix`), `scripts/host/helper.js` (`incidentFor`, `mergeAnswer`, the route's wiring, `mainGreen`)
- Test: `tests/scripts/engine/fix-main.test.js`, `tests/scripts/engine/routes-fix.test.js`, `tests/scripts/host/helper-engine-fix.test.js`

**Interfaces:**
- `weakensChecks({ paths, config, tests }) -> string[]` (plain reasons): `tests` is the run's `tests` step output from the engine's own record (`{ clean, findings }`); missing or not clean is a reason; every path `classifyChange` counts as a guardrail (CI files, `.archon/**`, agent control files, the project's critical-area checks), and every path `isTestSettings` matches, is a reason.
- `opened[pr]` gains `lane` and `incident`.
- `mergeFix({ runId })` (ticketed, as every `/engine/` route): refuses unless the run has an order with lane `fix-main` and an `incident`; the incident is open and red-main (`incidentOf(project, id)`); the run opened a pull request (`opened[pr].runId === runId`); every lens that ran is signed CLEAN for `opened[pr].head`; the run has not merged already (`verdicts.fixed[runId]`). It reads `changesOf(project, pr, head)` and refuses with `weakens: [...]` when `weakensChecks` gives any. Then `merge(project, { pr, head, incident, runId })`; on `ok`, keeps `verdicts.fixed[runId] = { pr, head, at }` and writes a Logbook note.
- `incidentFor(views, number, { fix })`: also `isFix: true` when `fix` is `{ incident, pr, head }` and that incident is open, red-main, `fix.pr === number`. The helper passes `fix` only from `mergeFix`'s own call, after checking `engineRun.openedOf(project, pr)` names that run, lane `fix-main`, that incident and the pull request's current head; `/merge`'s body can't give it.
- `mainGreen(project)`: `adapter.ciState(await adapter.branchHead(defaultBranch))` mapped `success` → true, `failure`/`error` → false, anything else or a throw → null.

- [ ] **Step 1: Failing tests (fix-main):** `a deleted test reasons the fix weakens the checks` (from the `tests` output); `a change to .github/workflows weakens the checks`; `a change to .archon policy weakens the checks`; `a change to coverage settings weakens the checks`; `a missing tests output weakens the checks`; `a change to source only does not`.
- [ ] **Step 2: Failing tests (routes):** `mergeFix merges the run's own fix for the open incident`; `mergeFix refuses a run that isn't fix-main`; `mergeFix refuses when the incident is closed`; `mergeFix refuses without a signed CLEAN review of the head`; `mergeFix refuses a fix that deletes a test, naming why`; `mergeFix refuses a fix that changes CI files`; `a second mergeFix after a merge is refused`; `mergeFix refuses a call without the run's ticket`.
- [ ] **Step 3: Failing tests (helper):** `the fix merges through the gate while the incident is open`; `another pull request is refused while the red-main incident is open`; `a fix whose head moved since the run opened it is refused`; `/merge with a fix in its body is not taken as the fix`.
- [ ] **Step 4:** Run the three files; the new tests fail.
- [ ] **Step 5:** Implement. `mergeAnswer(body, ctx, { fix } = {})`: only the internal call passes `fix`.
- [ ] **Step 6:** The three files, `tests/scripts/engine/routes*.test.js` and `tests/scripts/host/helper-*.test.js` touched pass.
- [ ] **Step 7:** Commit: `Merge the fix for a red main line through the helper's own gate`.

### Task 6: The broker's rerun

**Files:**
- Modify: `scripts/engine/broker/rules.js`, `scripts/host/helper.js` (`brokerPermit`)
- Test: `tests/scripts/engine/broker/rules.test.js`, `tests/scripts/host/helper-broker.test.js`

**Interfaces:**
- `classifyCall(['run', 'rerun', '<id>', '--failed', …])` → `{ kind: 'rerun', run: <id> }`; any other `run rerun` form → `other` (refused).
- `brokerDecision({ kind: 'rerun' }, ctx)` passes only with All stop off, the lock held, `ctx.redMain === true` and `ctx.runBranch === ctx.defaultBranch`; otherwise refused with a plain reason.
- `brokerPermit` for `rerun`: `redMain` from `openRedMain(views)`, `runBranch` from the helper's own `gh run view <id> --json headBranch`.

- [ ] **Step 1: Failing tests:** `run rerun --failed is classed rerun`; `a rerun passes on the default branch while main is red`; `a rerun is refused with no red-main incident`; `a rerun is refused for a feature branch's run`; `a rerun without --failed is refused`.
- [ ] **Step 2:** Run the two files; the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The two files pass.
- [ ] **Step 5:** Commit: `Let the broker re-run the main line's failed jobs during a red-main incident`.

### Task 7: The scenarios

**Files:**
- Create: `tests/eval/build-loop/60-red-main-fixed.js`, `61-fix-weakens-checks.js`, `62-non-fix-refused-while-red.js`, `tests/scripts/eval/scenarios-60-62.test.js`
- Modify: `tests/eval/build-loop/engine-recordings.js` (`fixing(work, outcome)`), `scripts/eval/engine-world.js` (an optional `adapter` for the host stand-in), `tests/scripts/eval/scenarios-42-50.test.js` (the suite's list), `docs/evals/build-loop.md`

- [ ] **Step 1:** Scenario 60: a quick piece's run raises the red main line's hold; the world's host reads main red. Pass: one red-main incident, one fix-main run started, the other queued piece held; after the fix run ends and the host reads green, the incident closes and the held piece starts on the next tick. Fails when the hold comes as a card (recording swapped) or a second fix run starts.
- [ ] **Step 2:** Scenario 61: the merge route for a fix-main run whose `tests` output found a deleted test. Pass: no merge call; the refusal names the deleted test; the dispatcher's card follows the failed run, at level 3, recommending Undo.
- [ ] **Step 3:** Scenario 62: a red-main incident open; the gate's incident check for an ordinary pull request and for the fix (`incidentFor`). Pass: the ordinary one is refused naming the incident; the fix is the fix only with the helper's own record at its head.
- [ ] **Step 4:** Run `node --test tests/scripts/eval/scenarios-60-62.test.js tests/scripts/eval/scenarios-42-50.test.js`; all pass.
- [ ] **Step 5:** Commit: `Add the fix-main scenarios`.

### Task 8: Hand-over

- [ ] **Step 1:** Run every touched test file and every file under each test folder touched (`tests/scripts/engine/`, `tests/scripts/engine/archon/`, `tests/scripts/engine/broker/`, `tests/scripts/state/`, `tests/scripts/host/`, `tests/scripts/eval/`), plus `tests/scripts/agents/core-neutral.test.js` and both desk-parity files.
- [ ] **Step 2:** The independent whole-branch review (superpowers:requesting-code-review); BLOCKER and HIGH fixed with failing tests first; MEDIUMs listed in the PR.
- [ ] **Step 3:** Push, open the PR (ruling 7's change and its reasons in the body; the small changes to `dispatch-run.js`, `runner.js` and `engine-world.js` named), and wait for Linux CI green.
