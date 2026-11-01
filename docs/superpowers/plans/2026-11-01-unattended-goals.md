<!-- docs/superpowers/plans/2026-11-01-unattended-goals.md -->
# Unattended goals: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dropped connection, a limit, a sleeping Mac or a dead process no longer ends work with no one told; then the director can sign one goal with its bounds, leave for about 8 hours, and come back to a report made from the record.

**Architecture:** Recovery first, on all work: pure rules in `scripts/engine/recovery.js`, used by the continuation host, the runner and the dispatcher's runner. A goal then wraps ordinary work: a `goal` record signed by a `start-goal` action over its hash, pure bounds and endings in `scripts/engine/goal.js`, one gate in `startPiece`, and a report a script makes from the record. No lane, no model between runs.

**Tech Stack:** Node.js (ES modules), `node:test`, Archon v0.13.0 workflows in `engine/archon/pack/`, `caffeinate` and `launchd` on macOS.

**Spec:** `docs/specs/2026-10-31-unattended-goals-design.md`, approved by the director on 1 November 2026. Section 9 is the recovery parts' whole brief; sections 4 to 8, 10 and 11 are the goal parts'. Section 15 holds the director's answers. `docs/specs/2026-11-01-delegated-decisions-design.md` wins where it differs (its section 14).

**How to use this plan.** Each part is carried out by one fresh session with this file, the spec and the repository. Each names what it waits on, its files, its tests and what done looks like, and ends with a pull request and one message to the main session. One part per fresh context; the main session starts the next. A later part may refine its own tasks from what the parts before it left, but not its rulings or the Global Constraints. "Today" means main at commit `0c23e9ab`; a part starts from main as it stands at its go.

## The parts

| Part | What | Changes how work runs? | Waits on |
|---|---|---|---|
| R0a | Check U4, note 93: failure kinds, resuming a failed run, paid usage | no | nothing |
| R0b | Check U2, note 92: a lost owner, with the extended patch | no | nothing |
| R0c | Check U1, note 91: sleep | no | the director's lid, through the main session |
| R1 | Sleep doesn't count, and a helper that stays up | **yes: all work** | nothing |
| R2 | A resumed run counts again, and the failure's kind is kept | no, until R3 | R0a, R1 |
| R3 | Retries, a card for every failed piece, `tried` lists | **yes: all work** | R2 |
| R4 | No new start during a limit | **yes: all work** | R3 |
| R5 | A run that lost its process | **yes: all work** | R0b, R3 |
| | **Recovery is done here** (see below) | | |
| G1 | The `goal` record, the signature and the desk | no | R1 to R5 |
| G2 | A goal's work only, and the gate at `startPiece` | only while a goal runs | G1 |
| G3 | The spend meter | only while a goal runs | G2 |
| G4 | Endings and winding down, and staying awake | only while a goal runs | G3, G6 |
| G5 | Areas: the guard, mark ready and the permit | only while a goal runs | G1 |
| G6 | The goal's checks | only while a goal runs | G1 |
| G7 | The sheet: First Mate, card and checks before leaving | **yes: goals can start** | G4, G5, G6 |
| G8 | The report, the courier, the pane and the words of the main design | no | G4, G6 |
| E | The one counted evaluation | no | G7, G8 |
| U5 | Check U5, note 94: one real goal of about 8 hours | no | E, the director's yes for its spend |

**Side by side.** R0a, R0b and R0c can run together, and R1 beside them. R2, R3, R4 and R5 run one after another. After G1, the three parts G2, G5 and G6 can run together, the later to merge rebasing on the rows below. G3 follows G2, and G4 follows G3 and G6. G7 and G8 can run together. Two writers never touch one file's same function.

**Order.** The director's decision 6: recovery first, straight away, then the rest. No goal part starts before R1 to R5 have merged.

## What delegated decisions needs from this build

Parts 5 to 7 of `docs/superpowers/plans/2026-11-01-delegated-decisions.md` stay out of this plan, and no part here reads a rule or writes a decision. The stop in that plan's "Where the plan stops" lifts once G7 and G8 have merged and D2 and D3 pass; then a fresh planning session writes those parts against the goals code as built. What they will find:

| They need | This build gives | Part |
|---|---|---|
| A goal in force | `goalInForce(views)`, null or `{ id, hash, sheet, state, startedAt, until }`, in `scripts/engine/goal.js` | G1 |
| Its id on a record | `goalId` on `work`, and on each order as `order.goalId` | G1, G2 |
| Its sheet, with room for five lines and the ticks | `sheet` is hashed whole by `sheetHash`, and `checkSheet` passes over keys it doesn't know, so part 5 adds `forWhom`, `noGos`, `examples`, `goodEnough` and `ticks` with no new signature | G1 |
| Its report | `goalReport({ goal, views, ending, decisions = [] })`. `decisions` is empty here and part 5 fills it; `decided` is left out when empty, and says "Nothing" when `sheet.ticks` has entries | G8 |
| A reader's tokens against the piece's goal | `goalMeter` takes `extra: () => number`, a figure added to the tokens; 0 here | G3 |
| A goal's end for an answered piece | Built here (section 8.3, item 8): it comes back through `returning` as ordinary work | G4 |
| "A sitting isn't a day" | Built here (section 8.5): the report's waiting list. Part 5 no longer owes it | G8 |

`decision` stays a plain kind as it is today; part 5 moves it to helper-only with its new fields. `routeAsk` and `lowered` are not touched here. Parts 6 and 7 need nothing of goals beyond part 5. Part E of that plan stays its own: it can't run until part 7, and this build can't wait for it, so this plan has its own part E, once.

## Early checks: who they need

Each check has a note in `docs/checks/` in the form of `84-set-status.md`, a row in `docs/checks/README.md`, its opening sentence extended, and a probe in `probes/` where a run is needed. Check 90 was the last taken and was this design's U3.

| Check | Note | Runs where | Needs |
|---|---|---|---|
| U1, sleep | `91-sleep.md` | This Mac, on the scratch engine of `probes/lib/archon.js`, workflows with no model step | **The director closes the lid** for 1 and 30 minutes, through the main session. Agents do the rest. `pmset schedule` needs root, so no wake can be scheduled |
| U2, a lost owner | `92-lost-owner.md` | Scratch engine, built with the extended patch | Agents only |
| U4, a limit and a dropped connection | `93-limit-and-connection.md` | Scratch engine with a cheap real step; the connection cut by the probe's own stand-in for the provider's address, never the computer's network | Agents. A few cents. Reaching a real limit is not attempted: its failure kind is read from Archon's source and a recorded stand-in. Whether paid usage can start is read from the account's settings page by the main session and from Archon's `usageLimitWait` |
| U5, one real goal | `94-one-real-goal.md` | A throwaway project, end to end | **The director's yes** for its spend, through the main session |

If U1 finds `caffeinate` doesn't hold, the sheet asks the director to set this themselves, and G4 drops `stayAwake`'s wiring. If a step dies on waking, section 9.2 takes it and R3 needs nothing more. If U2 fails, R5 builds only the card's options, and nothing carries on by itself. If U4 finds a failed run doesn't resume, or resumes under a new id, R2 and R3 stop and the part's session asks the main session; the table in `recovery.js` otherwise takes the kinds found.

## Files shared

Delegated decisions parts 1 to 4 are merged. Local part 10 may still be open, and touches only the evaluation, so **part E rebases on it**, never the other way round.

| File | Parts | Rule |
|---|---|---|
| `scripts/engine/dispatch-run.js` | R3, R4, R5, G2, G3, G4, G5 | R3 to R5 one at a time. G5 beside G2 keeps to its own function; the later rebases |
| `scripts/engine/dispatcher.js` | R4, G2 | Additive inputs |
| `scripts/engine/runner.js` | R1, R2, R3, R5, G4, G6 | R1 to R5 one at a time. G6's hunk is a line in `caps` |
| `scripts/engine/feature.js` | G2, G6 | `finishOrder`: the later rebases |
| `scripts/mod/courier.js` | G7, G8 | Different functions: the later rebases |
| `scripts/host/helper.js` | R1 to G8 | A few lines beside `engineDesk`; logic lives in `scripts/engine/`. Whichever is open second rebases |
| `scripts/state/events.js`, `scripts/state/views.js` | R1, R2, G1, G4, G6 | Additive lists |
| `scripts/engine/words.js` | R3, R5, G2, G4, G5, G8 | Additive |
| `docs/checks/README.md` | R0a, R0b, R0c, U5 | The later rebases |
| `scripts/eval/summary.js` | E | After local part 10 |

## Choices this plan makes

The design leaves these to the builder (its section 17), or the code showed a gap it doesn't settle. The main session may change any.

1. **`goal` is a plain record, and the signature is an action.** `start-goal` joins `ACTIONS`, as `approve-work` does: `{ goal, hash }`, signed. `views.goals` trusts only a `goal` whose `sheetHash` equals a verified `start-goal`'s hash. So an agent may write a `goal`, and it does nothing.
2. **`work` names its goal as `goalId`.** `goal` is already the work's words in `orderFor` and `workOrder`, so it can't be the field.
3. **The sheet lists each piece with the hash of its work record:** `pieces: [{ work, hash }]`. A piece whose record no longer matches isn't covered, so a changed piece can't borrow the signature.
4. **The sheet's approval stands in dispatch, not in the record.** `dispatch` gains `goal`, and a piece of the goal in force reads as approved there. `views.work[id].approved` doesn't change, so a goal that ends takes the approval with it. A piece with `visible: true` stays shown first, since the approval to start isn't an approval to merge, unless its sheet line carries `waived: true`, the director's tick for that piece (decision 5). That sets the order's `showFirst` to false, and there is no tick for a whole goal.
5. **Time and bounds are instants.** `until` is an ISO instant, held in the sheet; the card shows it in the computer's time.
6. **Numbers go in one table,** `scripts/engine/goal-limits.js`: `MAX_PIECES = 12`, `MAX_HOURS = 24`, `WIND_DOWN_MINUTES = 60`, `STUCK_MINUTES = 60`, `FAILED_IN_A_ROW = 2`, `REDS_TO_STOP = 2`, `SHARE_OF_WHAT_IS_LEFT = 1 / 3`, `READING_FRESH_MINUTES = 30`. `recovery.js` holds `RETRY_MINUTES = [5, 15, 30]`, `SLEEP_GAP_MINUTES = 3`, `LOST_CARRY_ONS = 1`.
7. **A goal's check files are a list on the sheet, `checkFiles`, and join `areas.wontTouch`.** `order.protectedFiles` is a list of files a run may change, and the guard behind it refuses only deletions and skips, so it can't hold them. A `test` check names a test, not a file, so the First Mate lists its file, and `checkSheet` refuses a sheet with a `test` check and no `checkFiles`, or with one outside `wontTouch`. What a `command` check reads can't be known by a script; the First Mate lists what it can. A fix-lane merge that touches one raises the same card.
8. **Winding down counts time awake.** Its 60 minutes leave out `slept` spans, so a Mac that sleeps through `until` doesn't cancel a run at the moment it wakes. `until` itself stays a clock time (section 9.1).
9. **A start held at a bound is `{ ok: false, goalHeld: true }`.** `afterStart` puts its entry back on `returning` with `heldBy: <goal id>`, raises no refusal or restart card, and `dispatch` passes over entries with `heldBy`. A new sheet listing the piece clears it. An entry the director's answer made (`via` of `rework`, `more`, `try-again`, `build-again`, `carry` or `answer`) isn't held once the goal has ended. After the end, `dispatch`'s `goal` is `{ pieces: <what's unfinished>, only: false, startsStopped: true }`, until a new sheet: other work may start, and the goal's own pieces hold as `goal-ended`.
10. **The baseline runs when the First Mate asks for it.** A `goal` record does nothing by itself: `cli.js goal-baseline <goal>` calls a helper route, which starts one goal-check run. The First Mate waits for its `goal-check` record and shows the card with the result. Each `goal-check` carries the sheet's hash, so **Change something…** needs a new one. `start-goal` refuses a sheet whose baseline for that hash isn't signed, or has every goal check passing.
11. **A goal's check run has no model step and its own folder,** a checkout beside the queue's (`scripts/engine/goal-folder.js`), so it costs nothing and can touch nothing of the project's. The stand-in order, the ticket and the trust check follow `startReader`. A `check` record already signed clean for the head and the test command counts for the test command, so it isn't run twice.
12. **The merge queue's spend** is read by id: while a goal is in force, `state.goalQueueRuns` keeps each queue run started, folded runs too, since `mergeRuns` is cut to 20 and has no times.
13. **An area clash at mark ready isn't a refusal to the step.** `/engine/ready` answers `{ ok: true, held: 'areas', pr, head }`, hands nothing to the queue, writes the ready record with `held: 'areas'`, which `tick` leaves out of `waiting`, and raises the card through the dispatcher. A refusal would fail a run whose work is done.
14. **`Allow this once` is a signed answer, kept by head.** A new head asks again.
15. **Retry state comes from the record.** `tries` is the highest `resume` on a run's `run` records, so the runner, the dispatcher's runner and the fix lane all reach the same answer from `retryPlan` on any tick, in any order, and a restart loses nothing. Only the time a try falls due is worked out, from the `ended` record's time.
16. **What goes on `note` records.** `end-goal` writes `{ about: 'end-goal', goal, now }` and a narrowing `{ about: 'narrow-goal', goal, change }`, as `pull-cards` writes its note, since stopping and narrowing decide nothing that needs a signature. `narrowed(sheet, change)` accepts only less time, less spend, fewer areas or fewer pieces, and `views.goals` applies what it accepts.
17. **Scenarios are numbered from 170** in `tests/eval/build-loop/`; delegated decisions holds 140 and on. Each is written in the part that builds its behaviour, and none is run before part E.
18. **No version numbers here.** The main session tags releases.

## Global Constraints

- British or Australian English; dates as 1 November 2026; a path comment on every file's first line, or straight after front matter; JSON exempt.
- "The director", they/them. No model identifiers and no AI attribution anywhere in the repository, commits or pull requests.
- No names with words such as "enhanced", "improved" or "fixed".
- Public repository: nothing about the director's other projects. A goal's sheet, report and records stay in the private record.
- Scripts in Node.js. `caffeinate` and `launchctl` calls run on macOS only, and everywhere else are a plain no-op.
- **Level 4 never moves.** Silence never settles anything. A timer never becomes a yes. No part here answers a question for the director.
- **Never `abandon`.** It removes uncommitted work.
- **Recovery holds with or without a goal.** Nothing in `recovery.js` reads a goal.
- **A retry, a carry-on and a resumed run all pass `admit`.** No path passes `pace`. The fix lane stays apart, as it does today: nothing is admitted under an incident, so its retries and carry-ons go through `fixDecision`, never `enter`.
- **Fits any project.** A check that can't run says so and takes the safe path. A project in git alone works the same: goals sit on the dispatcher, the permit and the record.
- `capsReached` stays `false`.
- Tests: run the files a change touches, as `node --test --import ./tests/helpers/test-home.js <file>`. Leave `npm test` to CI. Pull requests merge on Linux green.

## Review Focus

The inputs the design implies and no part would otherwise test, most likely first. Each has its test in the part named.

1. **The helper restarts between a retry coming due and the run being seen running.** It resumes once, and the try is counted once. `a restart between a retry's admit and its run keeps one resume` (R3).
2. **The Mac sleeps through a retry's time, or through `until`.** On waking, one retry fires, not three; a goal past `until` winds down from the wake and cancels nothing at once. `a sleep past until gives the run its wind-down` (G4).
3. **The week's allowance resets during a goal.** Points used can't be read across the reset, so the tokens stand alone and the report says so, and no negative or huge figure ends the goal. `a reset during a goal leaves the tokens standing alone` (G3).
4. **The helper is started again in mid-goal.** The goal, its wind-down clock, the held entries and the hold on sleep all come back from the record and `dispatch.json`. `a helper started again takes the goal up where it was` (G4).
5. **An old launch agent, a helper stopped on purpose.** A computer set up before R1 gets the new entry once, and the last uninstall's stop isn't undone within the minute. `a removed agent is unloaded, so nothing starts the helper again` (R1).

### Recovery's own review

R1 to R5 change how real work runs on every project, so each pull request has two reviewers: the usual fresh one, and one who has read only section 9 of the spec and `tests/scripts/engine/runner.test.js`, asked to find a way for work to be lost, started twice, billed twice or left stuck. The invariants, each pinned by a named test in its part:

1. No run is resumed twice for one failure, and no piece has two live runs.
2. A retry, a carry-on and every card keep the piece's reservation until its work ends.
3. A run's spend is counted once, however many times it resumes.
4. A run's `ended` stands until a `started` with `resume` follows it, everywhere that reads it.
5. Every failed piece ends in a merge, a card, or a named next try. None drops out unseen.
6. No retry runs under All stop or an open incident, and none past All stop's lift without a look at the run.

---

## Part R0a: Check U4

**Waits on:** nothing. **Done means:** `docs/checks/93-limit-and-connection.md`, a probe in `probes/93-limit-and-connection/`, the row in the README, and one pull request. It changes no code outside `probes/` and `docs/`.

- [ ] **Step 1:** Write the probe on `probes/lib/archon.js`: a workflow of a shell step, a cheap model step and a shell step. Cut the connection mid-step by pointing the provider's base address at a local stand-in that drops the socket. Keep the `terminal` line whole from `workflow attention --watch --json`.
- [ ] **Step 2:** Answer, each with the line that shows it: the `terminal` line's fields (`cause`, kinds) for a dropped connection; for a usage limit with no reset, from Archon's `run-terminal.ts`; whether `workflow resume <run> --detach` takes a `failed` run, skips finished steps, keeps the run's id, its worktree and its artefacts folder, so the ticket still reads; whether `inspect` afterwards adds the steps of both legs; what a second `terminal` line looks like, whether the first can replay once the run has resumed, and how to tell the two apart; whether a resumed run that pauses again gets a new occurrence, since the host writes an ask once by its id.
- [ ] **Step 3:** Read whether paid usage can start in place of a pause, as far as reading can say. Say plainly what stays unknown.
- [ ] **Step 4:** Write the note, with what R2 and R3 should take: the kinds for `FAILURE_KINDS`, and the retry table's row for each. Open the pull request.

## Part R0b: Check U2

**Waits on:** nothing. **Done means:** `scripts/engine/archon/patch/paused-run-cancel.patch` extended, `docs/checks/92-lost-owner.md`, a probe, the note in `docs/engine/archon-upstream-note.md` extended, and one pull request. Nothing calls the new path yet.

**Files:** Modify `scripts/engine/archon/patch/paused-run-cancel.patch`, `scripts/engine/archon/build.js` (the mark health reads, `CANCEL_PATCH_MARK`, moves to the new text, so an engine built before it is found by health and built again). Create `probes/92-lost-owner/run.js`.

- [ ] **Step 1:** Extend the patch: `cancelWorkflow` takes a `running` run whose owner is confirmed gone, by `stopLiveOwner` answering it is unreachable, and goes the way `cancelPaused` goes, keeping the worktree. An owner that answers behaves as released. It records nothing it can't prove.
- [ ] **Step 2:** On a scratch engine built with the patch, with a step running: kill the owner. See `owner_lost` on the stream. `workflow cancel` takes it; the worktree and its uncommitted file stay; a fresh run with `--branch` starts and doesn't meet "Workflow already active on this path".
- [ ] **Step 3:** Restart the computer's stand-in instead: the same with every process of the run gone and the wake process started again, as a restart leaves it.
- [ ] **Step 4:** Write the note and open the pull request.

## Part R0c: Check U1

**Waits on:** the main session's word that the director is at the Mac. **Done means:** `docs/checks/91-sleep.md`, a probe, and one pull request.

- [ ] **Step 1:** With a run of shell steps going on the scratch engine, start `caffeinate -s -w <pid>`. On mains, ask the director through the main session to leave it past the Mac's idle sleep, then to close the lid for 1 minute, then 30.
- [ ] **Step 2:** Answer: does it hold on mains, and with the lid shut; after a real sleep do the run's owner, its step and the stream carry on; does a one-minute interval show the gap; what does a step's idle timeout do.
- [ ] **Step 3:** Write the note and open the pull request.

## Part R1: Sleep doesn't count, and a helper that stays up

**Waits on:** nothing; U1's note, if it lands first, may change `stayAwake`'s flags. **Done means:** a sleep can't cancel a run through its cap, a dead helper is back within a minute on a computer set up before or after this part, and one pull request. Spec sections 9.1 and 9.4.

**Files:**
- Create: `scripts/engine/recovery.js`, `scripts/engine/stay-awake.js`
- Modify: `scripts/engine/spend.js`, `scripts/engine/runner.js` (`caps`, `costOf`), `scripts/state/events.js`, `scripts/state/views.js`, `scripts/host/helper.js`, `scripts/lib/login-start.js`, `scripts/setup/computer.js`, `docs/data.md`
- Test: `tests/scripts/engine/recovery.test.js`, `tests/scripts/engine/stay-awake.test.js`, `tests/scripts/engine/spend.test.js`, `tests/scripts/lib/login-start.test.js`

**Interfaces:**
- Produces: `sleepGap(lastMs, nowMs) -> { from, to } | null`; `runningMinutes(records, now, slept = [])`; `views.slept: [{ from, to }]`; `stayAwake({ platform, spawn, pid }) -> { set(wanted: boolean) }`; `reloadLoginStart({ run, entry })`.

### Task 1: The sleep gap

- [ ] **Step 1: Write the failing tests** in `tests/scripts/engine/spend.test.js`:

```js
test('a sleep inside a run leaves its minutes out', () => {
  const records = [{ at: '2026-11-01T01:00:00Z', data: { state: 'started' } }];
  const slept = [{ from: '2026-11-01T01:10:00Z', to: '2026-11-01T07:10:00Z' }];
  assert.equal(runningMinutes(records, new Date('2026-11-01T07:20:00Z'), slept), 20);
});
test('a sleep over a pause counts for nothing twice', () => { /* paused 01:05 to 01:30, slept 01:10 to 01:20: 5 + time after 01:30 */ });
```

and in `recovery.test.js`: `sleepGap` gives null at 3 minutes and a span at 3 minutes and one millisecond.

- [ ] **Step 2: Run them** and see them fail: `node --test --import ./tests/helpers/test-home.js tests/scripts/engine/spend.test.js tests/scripts/engine/recovery.test.js`.
- [ ] **Step 3: Implement.** `slept` joins `PLAIN_KINDS` and `HELPER_ONLY_KINDS` with `{ must: ['from', 'to'], may: [] }`. `runningMinutes` takes each running span less its overlap with `slept`. In `engineRunner`, `caps` and `costOf` pass `v.slept`. In the helper, `dispatchWatch`'s callback keeps the last time it fired; a gap writes one `slept` to every project in `engineHosts`, and the tick waits for those writes, with a failed one caught: on the first tick after a wake `caps` must already see the span, or it cancels the very run this part protects.
- [ ] **Step 4: Run them** and see them pass, then `tests/scripts/engine/runner.test.js`. Add `a run asleep six hours passes no cap` there, and in the helper's tests `a wake writes slept before the tick reads it`.
- [ ] **Step 5: Commit.**

### Task 2: `stayAwake`

- [ ] **Step 1: Write the failing tests:** `set(true)` twice spawns `caffeinate -s -w <pid>` once; `set(false)` ends it; a child that exits while wanted is spawned again; on `win32` nothing spawns. Use U1's flags if its note has landed.
- [ ] **Step 2: See them fail, implement, see them pass.** Nothing calls `set(true)` until G4.
- [ ] **Step 3: Commit.**

### Task 3: The launch agent

- [ ] **Step 1: Write the failing tests** in `tests/scripts/lib/login-start.test.js`: the plist holds `StartInterval` 60; `reloadLoginStart` writes the new entry, updates `login-start.json`, and runs `launchctl bootout gui/<uid>/dev.wheelhouse.helper` then `launchctl bootstrap gui/<uid> <path>`; an entry changed by someone else is left and said; `a removed agent is unloaded, so nothing starts the helper again`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.** Keep a change of the agent's text recognised: `ours` still matches, and `removeLoginStart` compares with the recorded content, so uninstall works on either form. Where the helper starts, if `loginStartRecord()` holds text other than `loginEntry` gives now, reload once and write one Logbook line. `removeLoginStart` runs `launchctl bootout` before it deletes the file: launchd holds a loaded entry whether or not the file is there, so `scripts/setup/uninstall-run.js` and `scripts/agents/copilot/start-helper.js`, its two callers, both get this with no change. The uninstall's stop of the helper comes after, by `helperStops`. No other stop on purpose exists today. Setup's card of changes names the restart in its line for the agent. The reload runs from a process launchd may have started, so try it by hand before trusting it: `AbandonProcessGroup` should keep the helper alive through the `bootout`.
- [ ] **Step 4: See them pass.** Check by hand on this Mac: the agent loaded, `kill` the helper, back within 60 seconds, and say so in the pull request.
- [ ] **Step 5: Commit, update `docs/data.md`, open the pull request.**

## Part R2: A resumed run counts again

**Waits on:** R0a. **Done means:** a run that resumes reads as running everywhere, its second ending is written, its spend is settled once, the failure's kind is on the `run` record, and one pull request. Nothing resumes a run by itself yet, beyond Give it more's path as today. Spec section 9.2.

**Files:**
- Modify: `scripts/engine/recovery.js`, `scripts/engine/archon/adapter.js` (`eventsOf`'s `terminal`), `scripts/engine/contract.js`, `scripts/engine/fake.js`, `scripts/engine/host.js` (`runState`), `scripts/engine/spend.js`, `scripts/engine/runner.js` (`caps`, `capAnswer`), `scripts/host/helper.js` (`engineRunsGoing`), `scripts/state/events.js`, `docs/data.md`
- Test: `tests/scripts/engine/host.test.js`, `tests/scripts/engine/runner.test.js`, `tests/scripts/engine/spend.test.js`, `tests/scripts/engine/archon/adapter.test.js`

**Interfaces:**
- Produces: `run-ended` gains `failure: string | null`. `run` records may hold `resume: number` and `failure: string`. `resumeRun({ engine, runId, write, record }) -> { ok } | { ok: false, refused }`, the one way a run resumes: it writes `{ state: 'started', resume: n }`, then acts, and a refusal writes `{ state: 'ended', resume: n, outcome: 'failed', failure: 'resume-refused' }`, since a refused resume brings no `terminal` line. `runLive(records) -> boolean`: an `ended` stands until a `started` with `resume` follows it. `failureKind(event) -> 'connection' | 'provider' | 'host' | 'limit' | 'other'`, from U4's table. `unsettled({ records, capped }) -> boolean`, pure, in `recovery.js`: the run's latest record is `failed`, and either `retryPlan` still allows a try, or a cap card on the run waits. The runner calls it itself, on the tick the failure is seen, since it ticks before the dispatcher's runner and would otherwise write the cost first. Until R3, `retryPlan` allows none.

- [ ] **Step 1: Write the failing tests:**
  - `host.test.js`: `a resumed run's second ending is written`: a `run` record with `resume: 1` is known to the host through a new `resumes(runId)` input, and `runState`'s key for `ended` carries that number.
  - `host.test.js`: `an ask-resolved after the ending writes no started`.
  - `spend.test.js`: `minutes count after a resume`: records started, ended, started `{ resume: 1 }`, ended add both legs, and a plain `started` after `ended` adds nothing, since `ask-resolved` can arrive late.
  - `runner.test.js`: `a resumed run is costed once, at its true end`; `a resumed slice's reviews are kept again`; `a refused resume leaves the run ended`; `a crash after started is reconciled against the engine`; Give it more on a failed run goes through `resumeRun`, its cost not written while the card waits.
  - In the helper's tests: `engineRunsGoing` goes by `runLive`.
  - `adapter.test.js`: a `terminal` line of each kind from U4's note gives its `failure`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.** `host.js` writes no plain `started` for a run whose current leg has ended. `runningMinutes` drops its `break` at `ended` and counts `started` after an `ended` only with `resume`. In `caps`, a run that `unsettled` names writes neither `keepReviews` nor `cost`, and `resumeRun` clears `reviewsKept[runId]`. Each tick, a run whose latest record is a `started` with `resume` and which `inspect` reads as over gets its `ended` written, for a crash between the record and the act. `costOf` reads the whole run from `inspect`, per U4's answer on how legs add. Change no other reader of `run` records: `runsOf` and `engineRunsAtWork` already take the latest. Grep every `state === 'ended'` over `run` records, and say in the pull request what you read.
- [ ] **Step 4: See them pass,** then `dispatch-run.test.js`, `dispatch-feature.test.js`, `dispatcher.test.js`.
- [ ] **Step 5: Commit, update `docs/data.md`, open the pull request.**

## Part R3: Retries, and a card for every failed piece

**Waits on:** R2. **Done means:** a failed run is retried at 5, 15 and 30 minutes where its kind allows, every failed piece ends in a merge, a card or a named next try, a later run knows what failed, the failing scenarios are written, and one pull request. Spec section 9.2.

**Files:**
- Modify: `scripts/engine/recovery.js`, `scripts/engine/dispatch-run.js`, `scripts/engine/runner.js`, `scripts/engine/waiting.js`, `scripts/engine/order.js`, `scripts/engine/words.js`, `engine/archon/pack/prompts/rules.md`, `tests/e2e/parked-pieces.test.js`
- Create: `tests/fixtures/engine/failed-connection.jsonl`, `tests/e2e/recovery.test.js`, `tests/eval/build-loop/170-retry-sees-tried.js`, `171-failed-run-retried.js`
- Test: `tests/scripts/engine/recovery.test.js`, `tests/scripts/engine/dispatch-run.test.js`, `tests/scripts/engine/dispatch-feature.test.js`, `tests/scripts/engine/dispatch-fix.test.js`

**Interfaces:**
- Consumes: `resumeRun`, `failureKind`, `run.failure`, `unsettled`.
- Produces: `retryPlan({ failure, tries }) -> { retry: boolean, afterMinutes? }`; dispatcher `retrying(runId)` and `retryingWork(views) -> Set<work>`; `triedList({ runs, costs, orderOf }) -> [{ run, step, failure, checks }]`; order field `tried`; a new `via: 'retry'`, in `WAKES`.

- [ ] **Step 1: Write the failing tests:**
  - `recovery.test.js`: `retryPlan` for each kind and try, and `other` and a fourth try say no.
  - `dispatch-run.test.js`: `a failed quick run is resumed at five minutes and not before`; `a retry waits for its place`; `a retry holds its files`; `a third failed retry brings one card`; `a failed piece never drops out unseen`; `a retry under All stop waits, and looks at the run after the lift`; `a restart between a retry's admit and its run keeps one resume`; a card's **Try again** enters a fresh run on the branch with `tried`; **Stop here** releases.
  - `dispatch-feature.test.js`: a failed slice raises its card only after the retries, and `heldUp`'s `cancelled` branch passes over a run on its way back.
  - `dispatch-run.test.js`: `a run with a cap card isn't retried`; `a retry that a goal's gate would hold parks the piece`, from G2.
  - `dispatch-fix.test.js`: `a failed fix is retried under its incident, with no place asked for`, then `fixDecision`'s card after the last try.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement `retryTick(views)`** in `dispatch-run.js`, called from `tick` after `returnTick`. For each latest `run` with `outcome: 'failed'`, outside the fix lane, that passes `heldUp`'s own guards other than `run.pr` (`namedByCard`, `onTheWay`, `sentBack` and `reds` acted on) and has no cap card, when `retryPlan` says a try is due, `enter({ work, lane, via: 'retry', key: 'retry:<run>:<try>', runId })`. The runner carries `via: 'retry'` out as it does `more`, through `resumeRun`, once admitted. Add retrying work to `reserveTick`'s `pieces`, and to the `run.outcome === 'failed'` test in `heldUp`, so it waits. The merge queue and the reader have no `run` record and so never enter. A retry after a `cancelled` run doesn't exist.
- [ ] **Step 3a: The fix lane.** `fixDecision` gains `retry: { due, waiting }` from `retryPlan`, ahead of its `failed` card: `{ act: 'wait', why: 'retrying' }`, then `{ act: 'resume', run }`, which `fixNow` carries out with `resumeRun` directly. Nothing enters the list, since nothing is admitted under an incident.
- [ ] **Step 4: Implement the card.** Past the retries, a piece outside a feature and the fix lane gets `state.returning` entry with `asked`, through `askAboutRestart`, in a new `failedCardWords(title, kind)`: **Try again**, **Stop here**, with Suggest a change… as every card has. `strandedTick` then finds it already on the way. `waiting.js` already counts it through `state.returning`.
- [ ] **Step 5: Implement `tried`.** `orderFor`, `sliceOrder` and `finishOrder` take `tried`; `checkOrder` allows it; `startPiece` fills it from Archon's record for every start with `carryOn` of a piece with earlier failed runs. `rules.md` says a run with a `tried` list reads it first and doesn't repeat what failed. It's data from the helper, never a step's words.
- [ ] **Step 6: See them pass,** add `tests/e2e/recovery.test.js` on the fake engine, with a recording that fails and a second that passes.
- [ ] **Step 7: Commit, open the pull request.**

## Part R4: No new start during a limit

**Waits on:** R3. **Done means:** while any run of the project is parked at a usage limit, nothing new starts, work coming back waits, the fix lane and the queue go on, and one pull request. Spec section 9.3. The goal's half of 9.3 is G4's.

**Files:** Modify `scripts/engine/dispatcher.js`, `scripts/engine/dispatch-run.js`, `scripts/engine/waiting.js`, `scripts/engine/stuck.js`, `scripts/engine/words.js`. Test `tests/scripts/engine/dispatcher.test.js`, `dispatch-run.test.js`, `waiting.test.js`, `stuck.test.js`.

**Interfaces:** `dispatch` gains `limited: boolean`, and a hold `why: 'limit'`. `limitedRuns(views) -> [runId]` in `waiting.js`: runs whose latest `run` record is `paused` and whose latest `ask` is a `usage-limit`. It reads the record, so a restart keeps it, and it needs no word of `ask-resolved`, which the runner never hears.

- [ ] **Step 1: Write the failing tests:** `a run parked at a limit stops new starts and admissions`; `a limit holds no merge queue and no fix`; `a limit whose run ended holds nothing`; a hold for a limit counts as moving, so no top card rises and no `noCardBehind` note is written, since it clears by itself.
- [ ] **Step 2: See them fail, implement, see them pass.**
- [ ] **Step 3: Commit, open the pull request.**

## Part R5: A run that lost its process

**Waits on:** R0b, R2. **Done means:** a run whose owner died is cancelled keeping its worktree and carried on once on its branch, a second loss brings a card with real options, and one pull request. Recovery is then done: the main session may tell the director so. Spec section 9.5.

**Files:** Modify `scripts/engine/archon/adapter.js`, `scripts/engine/fake.js`, `scripts/engine/runner.js`, `scripts/engine/dispatch-run.js`, `scripts/engine/words.js`, `docs/engine/archon-upstream-note.md`. Create `tests/eval/build-loop/172-lost-run-carried-on.js`. Test `tests/scripts/engine/runner.test.js`, `dispatch-run.test.js`, `tests/scripts/engine/archon/adapter.test.js`, `tests/e2e/recovery.test.js`.

**Interfaces:** the `owner_lost` ask gains `ownerLost: true` and options `[{ id: 'carry-on', label: 'Carry on' }, { id: 'stop', label: 'Stop' }]`. Fake engine: `loseOwner(runId)`. Runner `lostTick()`, each tick: `state.lost[runId]`, marked before anything else, is taken forward until the run has ended and its entry is in, so a crash in between strands nothing. Dispatcher `via: 'carry-on'`, a new run. `fixDecision` gains `lost: [runId]`, and takes a lost fix the way it takes one All stop cancelled: `{ act: 'start', carryOn: true, branch, after }`.

- [ ] **Step 1: Write the failing tests:** `a lost run is cancelled and carried on once on its branch`; `the spend before a lost run stays counted` (`carried.runs`); `a second loss brings a card with Carry on and Stop`; `an answer to that card never goes to the engine`, since `askOccurrence` would pass `owner-lost` through; `a cancel refused leaves the run on a card, and starts nothing`; `All stop finds a lost run and ends it`; a lost `slice` doesn't raise `heldUp`'s `cancelled` card; `a lost fix is carried on under its incident`; `a crash between the mark and the cancel is taken forward`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.** In `onAsk`, `ask.ownerLost` goes to a path of its own, ahead of the card: mark `state.lost` and count the piece's losses in `router.json`; under `LOST_CARRY_ONS`, enter first, then `engine.act(runId, { cancel })`, so `heldUp` sees it on the way; confirm with `inspect` that it ended; the dispatcher starts it once admitted, with `CARRY_ON`. A refused cancel, or a second loss, writes the card, and `deliver` treats `kept.ask.ownerLost` as the helper's own: **Carry on** does what the first loss did, and **Stop** calls `letGo`. Takes the same path with no goal.
- [ ] **Step 4: See them pass. Commit, open the pull request.**

---

## Part G1: The `goal` record, the signature and the desk

**Waits on:** R1 to R5 merged. **Done means:** a sheet can be recorded and signed, `read('goal')` shows it, `end-goal` records the wish, no work changes, and one pull request. Spec sections 4 and 5.

**Files:**
- Create: `scripts/engine/goal.js`, `scripts/engine/goal-limits.js`
- Modify: `scripts/state/events.js`, `scripts/state/views.js`, `scripts/desk/vocabulary.js`, `scripts/desk/acts.js`, `scripts/desk/core.js`, `scripts/desk/views.js`, `scripts/desk/evidence.js`, `scripts/desk/watch.js`, `scripts/cards/compose.js`, `scripts/frontdesk/cli.js`, `docs/data.md`
- Test: `tests/scripts/engine/goal.test.js`, and the desk's and the state's own tests

**Interfaces:**
- Produces:
  - Sheet: `{ title, done: [Check], checksSay: [text], checkFiles: [path], pieces: [{ work, hash, waived? }], areas: { may: [glob], wontTouch: [glob] }, spend: { tokens, points?, requests? }, until, stopEarly: { failedInARow, reds } }`.
  - `sheetHash(sheet) -> string`, over `canonical`, whole. `checkSheet(sheet, { now }) -> problem | null`: 1 to `MAX_PIECES` pieces, `until` ahead by at most `MAX_HOURS`, `done` holding at least one `test` or `command` check and no `page` check. Keys it doesn't know pass.
  - Kinds: `goal: { must: ['id', 'sheet'], may: [] }`; action `start-goal` with `['goal', 'hash']`; helper-only `goal-end: { must: ['goal', 'ending', 'at', 'spent'], may: ['words'] }`, `spent` being `{ tokens, points, requests, unknown, shareAtStart, queueRuns }`, so the report reads the record and not `dispatch.json`.
  - `work` gains `may: ['goalId']`.
  - `views.goals: { [id]: { sheet, hash, startedAt, ended, endAsked } }`, with `narrowed` applied; `goalInForce(views)`.
  - Desk: view `goal`, commands `start-goal` (needs evidence), `end-goal { now? }` and `narrow-goal` (both in `NO_EVIDENCE`), watch event `goal-changed`.

- [ ] **Step 1: Write the failing tests:** `a goal with no signature is not in force`; `a signature over another hash counts for nothing`; `a sheet of 13 pieces is refused`; `until more than 24 hours ahead is refused`; `a sheet with no test or command check is refused`; `the sheet's hash covers a key it doesn't know`; `a piece whose work record changed isn't covered`; `a second goal in a project is refused while one is in force`; `end-goal needs no evidence, and records whether it means now`; `a narrowing that widens anything is refused`; `a test check with no check file, or one outside wontTouch, is refused`.
- [ ] **Step 2: See them fail, implement, see them pass.** Follow `approve-work` from `compose.js` through `evidence.js` to `views.js`. `vocabulary.js` stays at `desk/1`, as `pull-cards` did.
- [ ] **Step 3: Commit, update `docs/data.md`, open the pull request.**

## Part G2: A goal's work only, and the gate at `startPiece`

**Waits on:** G1. **Done means:** while a goal is in force only its pieces start, in its order, the sheet standing as each one's approval; every start passes one gate; and one pull request. Spec sections 4 and 6.

**Files:** Modify `scripts/engine/goal.js`, `scripts/engine/dispatcher.js`, `scripts/engine/dispatch-run.js`, `scripts/engine/feature.js`, `scripts/engine/stuck.js`, `scripts/engine/words.js`. Test `tests/scripts/engine/goal.test.js`, `dispatcher.test.js`, `dispatch-run.test.js`, `dispatch-feature.test.js`.

**Interfaces:**
- Consumes: `goalInForce`, `views.goals`.
- Produces: `dispatch` gains `goal: { pieces: [work], only: boolean, startsStopped: boolean } | null` (choice 9), and holds `why: 'goal'` (not this goal's) and `why: 'goal-ended'`. `gateStart({ goal, work, lane, via, state, meter, now }) -> null | { goalHeld: true, why }`. `order.goalId`.

- [ ] **Step 1: Write the failing tests:**
  - `dispatcher.test.js`: `work outside the goal holds`; `an unapproved piece of the goal starts`; `a visible piece of the goal still shows first`; `pieces start in the sheet's order`; `two features of a goal build one at a time`; `the fix lane and the merge queue run during a goal`; `an entry with heldBy gets no place`.
  - `dispatch-run.test.js`: `a start held at a bound raises no card`; `a rework, a next slice and a Try again all pass the gate`; `the fix lane passes the time bound`; `after the goal's end an answered piece starts, and a next slice doesn't`; a piece not in the goal's list with a live run keeps going.
  - `goal.test.js`: `gateStart` for each state, lane and `via`, with the time bound and, from G3, a stand-in meter.
  - `dispatch-run.test.js`: `a retry is a start: it asks the gate`; `a waived piece's order doesn't show first`, and `an unwaived visible piece's does`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.** The gate goes at the head of `startPiece`, so a feature's slices pass it too. `afterStart` follows choice 9. `via: 'retry'` entries never reach `startPiece`, so `retryTick` asks `gateStart` itself, and a retry the gate would hold goes to its card. `tick` passes `goal` to `dispatch` from `goalInForce` and the kept state. `orderFor`, `sliceOrder` and `finishOrder` put `goalId` on the order, and `checkOrder` allows it. `FOLLOWED` in `stuck.js` leaves both new holds out, and `noCardBehind` writes nothing for them.
- [ ] **Step 4: See them pass. Commit, open the pull request.**

## Part G3: The spend meter

**Waits on:** G2. **Done means:** a goal's spend is known at every tick by both limits, unknown spend never reads as zero, and a piece starts only if its cap fits, and one pull request. Spec section 5.

**Files:** Create `scripts/engine/goal-meter.js`, `tests/eval/build-loop/173-spend-bound-mid-run.js`. Modify `scripts/engine/dispatch-run.js`, `scripts/engine/goal.js`, `scripts/usage/figures.js`, `scripts/host/helper.js`. Test `tests/scripts/engine/goal-meter.test.js`.

**Interfaces:**
- Produces: `goalMeter({ goal, views, inspect, queueRuns, capOf, reading, requests, extra = () => 0, now }) -> { tokens, points: number | null, requests: number | null, unknown: boolean, reached: 'tokens' | 'points' | 'requests' | null }`. `capOf(lane)` from `limitsFor`.
- `reading` is `{ share, shareAt, resetsAt }` from `weeklyShare`, which gains `resetsAt`; `requests` is the count for a Copilot project, from `requestsThisMonth`.

- [ ] **Step 1: Write the failing tests:** tokens add `cost` records of the goal's work, each live run's `runCost`, and queue runs in `state.goalQueueRuns`; a run of unknown spend counts its whole cap, and a queue run of unknown spend counts `LANE_CAPS.small.tokens`, since that table holds no row for the queue; points read `share - share at Start` while fresh; `a stale reading leaves the tokens standing alone`; `a reset during a goal leaves the tokens standing alone`; a Copilot project reads counted requests; `a fix-lane run's spend counts`; `a piece whose cap doesn't fit is held`.
- [ ] **Step 2: See them fail, implement, see them pass.** The share at Start goes in `dispatch.json`, read at `start-goal`, kept beside the goal. A run costed and live isn't counted twice.
- [ ] **Step 3: Commit, open the pull request.**

## Part G4: Endings, winding down and staying awake

**Waits on:** G3. **Done means:** every row of section 8's table happens, a limit past `until` can't wake and spend, the Mac is held awake for exactly the life of a goal, a restart picks it all up, and one pull request. Spec sections 8, 9.1 and 9.3.

**Files:**
- Modify: `scripts/engine/goal.js`, `scripts/engine/dispatch-run.js`, `scripts/engine/runner.js`, `scripts/engine/words.js`, `scripts/state/views.js`, `scripts/host/helper.js`, `scripts/engine/stop.js`
- Create: `tests/eval/build-loop/174-goal-to-done.js` and one scenario for each ending, `175-` on, and `180-run-parked-past-until.js`, `181-sleep-across-a-run.js`
- Test: `tests/scripts/engine/goal.test.js`, `dispatch-run.test.js`, `tests/e2e/goal.test.js`

**Interfaces:**
- Produces: `goalStep({ goal, facts, now }) -> { state: 'running' | 'waiting' | 'winding' | 'ended', ending?: string, cancel?: [runId] }`, pure. `facts`: `{ pieces: { [work]: 'queued' | 'going' | 'waiting' | 'failed' | 'merged' | 'ended' }, failedInARow, reds, meter, lastStepAt, parkedRuns, liveRuns, windingSince, slept, endAsked, allStop, lastCheck }`. Endings: `done`, `waiting-for-you`, `check-failed`, `time`, `spend`, `stuck`, `end-goal`, `all-stop`. `goalTick(views)` in `dispatch-run.js`, first in `tick` after `fixTick`.

- [ ] **Step 1: Write the failing tests:** one on `goalStep` for each row of section 8's table, and:
  - `nothing can run and all waits on the director: the goal waits until until`, then ends as `waiting-for-you`.
  - `a card holding up the whole goal rises`, through `topTick`.
  - `a sleep past until gives the run its wind-down`.
  - `a run parked at a limit is cancelled when the goal ends, keeping its worktree`.
  - `a helper started again takes the goal up where it was`.
  - `stuck counts no time parked, waiting or asleep`.
  - `spend cancels running runs and keeps their worktrees`.
  - `All stop ends the goal and its lift starts nothing`; `Carry on offers a new sheet`.
  - `the merge queue runs on through a wind-down and after`; `its spend is named after the end`.
  - `an answered piece after the end comes back through returning` (delegated section 8.3, item 8).
  - `stayAwake is on for exactly a goal's life`.
  - `End goal winds down, and End goal now stops at once`.
  - `once waiting work has merged after the end, the goal's checks run again and the report says so`.
  - `goal-end holds the spend the report reads`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.** `goalTick` builds `facts`, calls `goalStep`, acts: cancels through `engine.act`, writes one `goal-end`, sets `dispatch.json`'s kept goal state. After a `waiting-for-you` ending it keeps watching: once each remaining piece has merged it calls `startGoalCheck` with `when: 'last'`. `lastStepAt` moves when `inspect(...).steps` grows. The goal-end is written last, after cancels are confirmed or tried twice; a run that won't cancel goes to `endRun`, as at a cap. The helper's `stayAwake.set(anyGoalInForce)` runs each tick across projects.
- [ ] **Step 4: See them pass. Commit, open the pull request.**

## Part G5: Areas

**Waits on:** G1. **Done means:** a run under a goal can't write outside its areas, a change outside them parks at mark ready with a card, the permit refuses it behind that, a project in git alone is held the same way, and one pull request. Spec sections 5 and 6.

**Files:**
- Create: `scripts/engine/areas.js`, `scripts/hooks/areas.js`, `tests/eval/build-loop/182-change-outside-areas.js`, `183-run-changes-goal-check.js`
- Modify: `hooks/hooks.json`, `scripts/agents/copilot/hook-entry.js`, `scripts/engine/order.js`, `scripts/engine/routes.js` (`ready`, `mergeFix`), `scripts/engine/broker/rules.js`, `scripts/host/helper.js` (`brokerPermit`), `scripts/engine/dispatch-run.js`, `scripts/engine/words.js`
- Test: `tests/scripts/engine/areas.test.js`, `tests/scripts/hooks/areas.test.js`, `tests/scripts/engine/broker/rules.test.js`, `tests/scripts/engine/routes-start.test.js`

**Interfaces:**
- Produces: `outsideAreas(paths, areas) -> [path]`, with `matchGlob` as `shownFirstNeeded` uses it. `order.areas`. `brokerDecision`'s context gains `outsideAreas: boolean`, refusing a merge. Dispatcher `areaCard({ work, pr, head, paths })`, answered **Allow this once** or **Stop here**.

- [ ] **Step 1: Write the failing tests:** the hook refuses a write, and a shell delete, outside `may` or inside `wontTouch`, and fails closed with no order; `a run with no areas is free as before`; `a goal's check file can't be edited`; `/engine/ready` holds with a card and writes no `ready` record; `the permit refuses paths outside`; `Allow this once at a head lets that head through, and a new head asks again`; `the fix lane isn't held by the areas, and is by a goal's check file`; `a pull request opened before the goal isn't held`; `the areas still govern after the goal ends`; a guardrail path can't be listed in `may`.
- [ ] **Step 2: See them fail, implement, see them pass.** Copilot's list doesn't hold `protected-tests` today, so check what it does hold and register `areas` so a Copilot step is held the same. The order takes areas from the goal the piece's `goalId` names, ended or not. `/engine/ready` is the one place both a hosted and a git-alone project pass; after **Allow this once**, `handBack` takes it on a host, and a ready record on a project in git alone.
- [ ] **Step 3: Commit, open the pull request.**

## Part G6: The goal's checks

**Waits on:** G1. **Done means:** a goal's checks run on the main line with no model at the baseline and at the end, the helper signs the result from Archon's record, and one pull request. Spec sections 4.1 and 8.

**Files:**
- Create: `engine/archon/pack/wheelhouse-goal-check.yaml`, `scripts/engine/goal-check.js`, `scripts/engine/goal-folder.js`, `tests/eval/build-loop/184-goal-refused-checks-pass.js`, `185-late-piece-caught.js`
- Modify: `scripts/engine/archon/adapter.js` (`LANE_WORKFLOWS`, `start`, `liveRunOf`'s list), `scripts/engine/pack-check.js`, `scripts/engine/routes.js`, `scripts/engine/feature.js` (`finishOrder`), `scripts/engine/runner.js`, `scripts/state/events.js`, `scripts/host/helper.js`
- Test: `tests/scripts/engine/goal-check.test.js`, `tests/engine/pack.test.js`, `tests/scripts/engine/feature.test.js`

**Interfaces:**
- Produces: lane `goal-check`, a run named by `GOAL_WORK` as `READER_WORK` names a reader's, so caps and costs pass over it. `startGoalCheck({ project, goal, when: 'before' | 'last', head })`. Kind `goal-check`, signed, helper-only: `{ goal, hash, when, head, results: [{ check, ok, walked? }], ok }`. Route for `cli.js goal-baseline` (choice 10).

- [ ] **Step 1: Write the failing tests:** `every goal check passing refuses the baseline`; `a failed check can't read as Done`; `pass or fail, with no partial credit`; `a run's own word counts for nothing`: only `engine.outputs` from an installed pack is read, as `trusted` does; `a page check is listed, walked at its piece`; `a project's signed check counts for its test command`; `a check run that fails to start says so and the goal isn't Done`; `a baseline for another hash doesn't count`; `the folder works for a project in git alone`, which has no fetch mirror path as a hosted one does; `an unsigned goal starts nothing by itself`; for a feature, the sheet's checks are added to `finishOrder`'s done checks.
- [ ] **Step 2: See them fail, implement, see them pass.** The workflow is one `bash` node, `node "$WHEELHOUSE_ROOT/scripts/engine/goal-check.js" --run "$WORKFLOW_ID"`, reusing `done-check.js`'s way of running a check. `pack-check.js` joins it to `NOT_LANES`. Copilot needs no twin, having no model step: `workflowFor` passes it as it passes the queue.
- [ ] **Step 3: Commit, open the pull request.**

## Part G7: The sheet

**Waits on:** G4, G5, G6. **Done means:** the director can say what they want, see one card, click Start and leave; starting sets Away; and one pull request. Goals can now be used. Spec sections 4.2, 5 and 11.

**Files:**
- Create: `scripts/engine/goal-start.js`
- Modify: `skills/intake/SKILL.md`, `skills/front-desk/SKILL.md`, `scripts/frontdesk/cli.js`, `scripts/cards/compose.js`, `scripts/state/card-lines.js`, `scripts/hooks/card-check.js`, `scripts/desk/core.js`, `scripts/mod/courier.js`, `scripts/agents/copilot/` (rebuilt with `npm run copilot-home`)
- Test: `tests/scripts/engine/goal-start.test.js`, the card and desk tests, `tests/skills/` for the intake

**Interfaces:** `checksBeforeLeaving({ project, sheet, views, health, power, sessions, reading }) -> { refused: [line], warns: [line] }`. `onBattery()`, from `pmset -g batt`, macOS only.

- [ ] **Step 1: Write the failing tests,** one for each line of "Must pass" and "Warns" in section 5, and: `the default spend is a third of what's left, rounded down`; `with no reading the sheet offers tokens and says so`; `Start sets Away until until, unless a nearer Away or Do not disturb is set`; `narrowing needs nothing, widening needs a new sheet`; `a paid-usage account is refused where U4 found a limit can bill`; a sheet card passes the card check, with why it comes, what happens meanwhile, options and a recommendation.
- [ ] **Step 2: See them fail, implement, see them pass.**
- [ ] **Step 3: Write the intake.** A new route ahead of Change: "Is it a goal to leave running?" The First Mate works as in intake, proposes every bound, says so where a goal doesn't suit (section 4.2) and offers a piece that does, and never presents a form. Run the skill's pressure tests as `tests/skills/` does for intake.
- [ ] **Step 4: Rebuild the Copilot home, commit, open the pull request.**

## Part G8: The report, the courier, the pane

**Waits on:** G4, G6. **Done means:** the report on return is a script's from the record, checked line by line in a test, the courier and the pane know a goal, the main design's settings line is corrected, and one pull request. Spec sections 10 and 11.

**Files:**
- Create: `scripts/engine/goal-report.js`, `tests/eval/build-loop/186-report-against-record.js`
- Modify: `scripts/desk/views.js`, `scripts/briefing/model.js`, `scripts/briefing/text.js`, `scripts/mod/courier.js`, `scripts/desk/mod-pane.js`, `scripts/engine/words.js`, `docs/specs/2026-10-17-wheelhouse-design.md` (the Away line, section 11), `README.md`, `docs/data.md`, `HANDOVER.md`
- Test: `tests/scripts/engine/goal-report.test.js`, the briefing's, courier's and pane's tests

**Interfaces:** `goalReport({ goal, views, ending, decisions = [] }) -> { verdict, added, decided, waits: { top: [card], rest: [name] }, wrong, spent }`, then `goalReportText(report)`.

- [ ] **Step 1: Write the failing tests:** the parts in their fixed order; `nothing is rounded up`: built and waiting is under Waits; `unknown spend reads as unknown`; `a piece merged is Added`; `a stopped goal names what's left undone`; `the waiting list shows the top four and names the rest`; What went wrong reads `slept`, usage limits, retries and losses from the record, and `a report checked line by line against its record` matches a recorded fixture; the courier: a goal that stopped early passes Away, one that finished wakes only while here; the pane line reads "Goal: 2 of 4 added, 3 hours left, a third of its spend used.".
- [ ] **Step 2: See them fail, implement, see them pass.** No model anywhere. The report stays on the Logbook until each item is settled.
- [ ] **Step 3: Update the main design's line, the documents and `HANDOVER.md`. Commit, open the pull request.**

## Part E: The one counted evaluation

**Waits on:** G7, G8, and local part 10 if it is still open. Its spend is the main session's to raise. **Done means:** the scenarios from 170 run once in `tests/eval/build-loop/`, `DESIGNED` in `scripts/eval/summary.js` holds them, the result is in `docs/evals/`, what fails is mended or carded, and one pull request.

Section 12's list, with each scenario's number: 170 and 171 (R3), 172 (R5), 173 (G3), 174 to 181 (G4), 182 and 183 (G5), 184 and 185 (G6), 186 (G8). A question parked while other work merges is delegated decisions' 142, and isn't repeated.

## Part U5: One real goal

**Waits on:** E, and the director's yes through the main session. **Done means:** `docs/checks/94-one-real-goal.md`, from a goal of about 8 hours on a throwaway project, end to end; what it found mended or carded; one pull request. It is the last check before real use.

## Where the spec's sections are built

| Spec section | Part |
|---|---|
| 4 The shape, 4.1 The goal's check | G1, G6 |
| 4.2 Which goals suit | G7 |
| 5 Handing over | G1, G3, G7 |
| 6 While it runs | G2, G4, G5 |
| 7 Questions | Nothing new; delegated decisions part 5 |
| 8 Endings | G4, G6 |
| 9.1 Sleep | R1, G4 |
| 9.2 A failed run | R2, R3 |
| 9.3 Limits | R4, G4, G7 (paid usage) |
| 9.4 The helper | R1 |
| 9.5 A lost run | R0b, R5 |
| 10 The report | G8 |
| 11 Away | G7, G8 |
| 12 Scenarios | E, each written in its part |
| 13 Early checks | R0a, R0b, R0c, U5 |
