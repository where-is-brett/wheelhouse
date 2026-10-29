<!-- docs/superpowers/plans/2026-10-29-archon-part-3c-dispatch-cards-spend.md -->
# Wheelhouse on Archon, part 3c: the dispatcher, the card router and the spend meter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A script in the core starts runs from the First Mate's work in order, at most `pace` at once; the engine's asks become cards only at levels 3 and 4, within about three a day; and every run's spend is counted and capped by Wheelhouse, shown in plain words on the Logbook and in the briefing.

**Architecture:** Three pure deciders, each with a thin runner in the helper: `dispatch` (what to start, hold or re-queue), `routeAsk` (answer, card or Logbook line) and `capReached` (whether a run must stop). They read the record's views and the engine's events through the interface from part 3a, so every test runs them against the fake engine. The desk's views from part 1 gain runs, asks and costs, through one word table that turns engine words into the director's.

**Tech Stack:** Node.js (ES modules), `node:test`.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 7.3, 7.7, 8 (all), 10 (all), 4.1 (briefing and Logbook), 18.

**Plan index:** `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md`.

**Waits on:** parts 3a and 3b merged. No early check beyond theirs (Copilot's estimate waits for part 4's stub 4.5 and check 79).

## Global Constraints

- British English; dates as 29 October 2026; a repository-relative path comment atop every file. No words such as "enhanced", "improved" or "fixed"; no model names; no AI attribution. Scripts in Node.js. Don't touch `.github/workflows/ci.yml`. Run only the test files a change touches.
- **The director never sees Archon's words:** run ids, node names, "attention item", YAML (spec 2, anti-goals).
- **Silence is never consent.** The triggers that raise a level (main design, section 6) apply.
- The card budget is a target with an overflow to the next day, not a hard cap. Cards that hold up all work, and All stop, ignore it.
- The dispatcher never decides anything a model would.
- Usage pressure never lowers a level, relaxes a review or skips a check.
- Any money beyond the plan never, without the director's own Yes.

## Review Focus

1. **Four level-3 asks arrive in one afternoon.** Three cards today, the fourth tomorrow, and the briefing says one waits; an ask that holds up all work is shown at once regardless. Test in Task 2.
2. **The director answers a card after the run has moved on** (someone answered in the engine room, or the run was cancelled). The engine refuses; the card closes with one plain line. Test in Task 2.
3. **A run reaches its time cap while waiting for an answer.** Waiting time doesn't count against the minutes cap (only running steps do); the token cap counts only spend. Test in Task 3.
4. **The helper was asleep through two of the 15-minute merge-queue ticks.** On waking it starts at most one merge-queue run, not two. Test in Task 4.
5. **A run whose steps report no cost.** The cost event says unknown, the Logbook shows "not reported", and the total shows as "at least …", never as a smaller true-looking figure. Test in Task 3.

---

### Task 1: Engine words become the director's

**Files:**
- Create: `scripts/engine/words.js`
- Modify: `scripts/desk/views.js` (`work`, `logbook` build tab, `briefing`), `scripts/frontdesk/glossary.js` if a new term needs a glossary line
- Test: `tests/scripts/engine/words.test.js`, `tests/scripts/desk/views.test.js`

**Interfaces:**
- Produces: `STEP_WORDS` (each pack step id to plain words: `implement` "building it", `review-standards` "checking it against the project's standards", `review-spec` "checking it does what was asked", `preview` "taking pictures", `approval` "waiting for you", `merge` "adding it to the product", and the rest); `runLine(run, cost) -> string` ("The sale banner: checking it does what was asked. 12 minutes so far, about $0.40."); `shippedLine(run, cost) -> string` for the briefing ("Shipped: the sale banner, for about $0.40.").
- The Logbook's build tab shows each run's steps in plain words and its cost; the `work` view gains the run's state; the briefing gains shipped lines.

- [ ] **Tests first:** `no line holds a run id, a step id or the word workflow`; `a cost with unknown dollars reads not reported`; `the build tab lists a run's steps in order in plain words`; `the briefing names a shipped change with its cost`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Show runs and their cost in the director's words`.

### Task 2: The card router

**Files:**
- Create: `scripts/engine/router.js`
- Modify: `scripts/lib/front-desk.js` (`CARD_KINDS`: `engine-ask`, `engine-blocked`, `engine-cap`), `scripts/state/card-lines.js` (`SET_LINES` and builders `engineAskLine(askId, option)`), `scripts/state/events.js` (`ACTIONS`: `engine-answer`), `scripts/engine/host.js` (attach `onAsk`), `scripts/desk/acts.js` (an `answer` to an engine card signs first, then calls the engine's `act`)
- Test: `tests/scripts/engine/router.test.js`, `tests/scripts/desk/acts.test.js`, `tests/scripts/state/card-lines.test.js`

**Interfaces:**
- Produces: `routeAsk(ask, { delegations, today, settings }) -> { answer: { choice, words? }, line } | { card: CardInput } | { line }`, following spec 8.3: Archon's own asks at levels 1 and 2 are answered by the fixed table and recorded, with level 2 reported by the briefing; a pack ask at level 3 that a delegation lowered to level 2 is answered by its recommendation; levels 3 and 4 become a card composed with `composeCard`, its first option the recommendation, and a preview first for visible work; a usage limit is a Logbook line.
- Produces: `cardBudget({ cards, now, cardsPerDay }) -> { show: CardInput[], wait: number }`, in the order All stop or an incident, then level 4, then a question that holds up all work, then level 3, then the rest; holding-up and All stop cards ignore the budget.
- Produces: `bundleApprovals(cards) -> CardInput[]` when `bundleApprovals` is on: approvals of visible work waiting together become one card (**Approve all**, **Show me**, **Suggest a change…**, **Not now**), each approval still signing its own set line.
- Answers go back (spec 8.4): the click is signed and recorded first, then `engine.act(runId, { answer })`; a refusal closes the card with one plain line; **Suggest a change…** sends the director's words as the answer text.

- [ ] **Tests first:** `hold on a red main line is answered with no card`; `a level-3 ask lowered by a delegation is answered by its recommendation`; `a level-4 ask becomes a card with the recommendation first`; `the fourth level-3 card waits for tomorrow and the briefing counts it`; `a card that holds up all work ignores the budget`; `two waiting approvals become one bundled card when the setting is on`; `an answer the engine refuses closes the card with one line`; `the engine is answered only after the signed record is written`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Turn the engine's asks into cards by level, within a daily budget`.

### Task 3: The spend meter and the caps

**Files:**
- Create: `scripts/engine/spend.js`, `scripts/engine/caps.js`
- Modify: `scripts/usage/store.js` (`recordRunUsage` takes `source` and per-step lines), `scripts/engine/host.js` (on `step-finished`, check the caps; on `run-ended`, write one `cost` event)
- Test: `tests/scripts/engine/spend.test.js`, `tests/scripts/engine/caps.test.js`, `tests/scripts/usage/store.test.js`

**Interfaces:**
- Produces: `runCost(inspect) -> { tokens, dollars, premiumRequests, minutes, source, byRole }` (minutes count running steps only; `source` the weakest of the steps'; `dollars` null when any step is unknown, with `floorDollars` the known part).
- Produces: `capReached(run, { capMinutes, capTokens, lane }) -> null | { cap: 'minutes'|'tokens', used, limit }`. When reached, the runner cancels the run keeping its worktree and raises an `engine-cap` card at level 3: **Give it more** (resumes, skipping finished steps, with the cap raised once by half), **Stop**, **Suggest a change…**. The node budget Archon offers Claude steps is set to the run's remaining allowance as a second guard (passed in the order's `caps`).
- The cost record never goes into a pull request.

- [ ] **Tests first:** `waiting time does not count against the minutes cap`; `the token cap counts reported and estimated tokens`; `a cap reached cancels the run and keeps its worktree`; `Give it more resumes with the cap raised once`; `a run with one unknown step has null dollars and a floor`; `the cost event has each role's share`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Count each run's spend and cap it`.

### Task 4: The dispatcher

**Files:**
- Create: `scripts/engine/dispatcher.js`
- Modify: `scripts/host/helper.js` (run the dispatcher on each new `work`, `run` or `card-answer` event and every 15 minutes, for projects with `engine: 'archon'`), `scripts/foreman/queue.js` (export `clashCheck` for reuse; nothing else changes while the old engine runs beside it)
- Test: `tests/scripts/engine/dispatcher.test.js`, `tests/scripts/host/helper-dispatch.test.js`

**Interfaces:**
- Produces: `dispatch({ work, runs, settings, stop, incident, capsReached, mergeQueue, now }) -> { start: [{ work, lane }], hold: [{ work, why }], startMergeQueue: boolean, requeue: [{ work }] }`:
  - takes work in the First Mate's order, only lanes in `engineLanes` (others stay with the old engine), at most `paceOf(settings).building` runs at once and `featureLane` of them features, a feature counting as one;
  - holds work whose files overlap a running piece's (`clashCheck`, as a hint);
  - starts nothing under All stop, an open incident, or a reached spend cap;
  - starts the merge queue when a lane run ended with a pull request ready, and again every 15 minutes while any wait, at most one merge-queue run at a time, so never more than pace + 2 runs;
  - re-queues a pull request the merge gate sent back for a clash with "bring it up to date" in the order; a second clash on the same work raises a level-3 card.
- The runner calls `engine.start(workOrder(...))` for each start, after `/engine/order` registration (part 3b), and writes the `run` event.

- [ ] **Tests first:** `three quick pieces start at pace three, the fourth holds for pace`; `a piece in a lane not in engineLanes is left for the old engine`; `nothing starts under All stop`; `nothing starts while a spend cap is reached`; `an overlapping piece holds for the clash`; `two missed ticks start one merge-queue run`; `a second clash raises a card`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Dispatch work to the engine by a script, at pace`.

### Task 5: The scenarios

**Files:**
- Create: `tests/eval/build-loop/36-ask-answered-without-card.js`, `37-card-budget.js`, `38-preview-card.js`, `39-cap-blocked-card.js`, `40-all-stop-cancels-runs.js`, `41-planted-review-refused.js`, `42-unsigned-merge-refused.js`, `43-red-main.js`, `44-clash-rerun.js` (spec 18's new scenarios)
- Modify: `scripts/eval/run.js` (an `--engine fake` flag that runs the build-loop scenarios against the fake engine and the real helper; part 3d adds `archon`), `scripts/eval/summary.js` (`DESIGNED` to 44), `docs/evals/build-loop.md`, and the quick-lane scenarios among 20 to 35 rewritten against the pack (`20-fix-rounds`, `21-re-review`, `23-finish-opens-pr`, `34-read-only-reviewer`)
- Test: the scenarios themselves, run with the fake engine (`npm run eval -- --suite build-loop --engine fake`)

- [ ] Write each scenario against the fake engine and a recording; run the suite with the fake: all pass.
- [ ] Commit: `Add the engine scenarios to the build-loop suite`.

### Task 6: Hand-over

- [ ] Run every test file this part touched.
- [ ] Open the pull request `The dispatcher, the card router and the spend meter`, and message the main session with its link.
