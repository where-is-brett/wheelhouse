<!-- docs/superpowers/plans/2026-11-01-delegated-decisions.md -->
# Delegated decisions: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wheelhouse quietly records what it would have decided, a piece waiting on the director stops holding up other work, each decision is asked once, and answers can become signed rules; then, once goals exist, the First Mate settles what a signed rule covers.

**Architecture:** A new core module, `scripts/delegation/`, holds what the design adds: the facts read from a change, the eight candidates and common exclusions, the seal, the reader's view and later the rule and its checks. The helper runs it beside the card router and never in its way. Parked pieces change `dispatch`, the dispatcher's runner and the card router: `dispatch` gains a `waiting` input and an `admit` output, and every restart asks for a place in one way.

**Tech Stack:** Node.js (ES modules), `node:test`, Archon v0.13.0 workflows in `engine/archon/pack/`, git through `safeGit`.

**Spec:** `docs/specs/2026-11-01-delegated-decisions-design.md`, approved by the director on 1 November 2026 with all six decisions at (a). Sections 8 (parked pieces), 15 (parts), 16 (early checks) and 17 (decisions) are the ones to read first. Where it differs from `docs/specs/2026-10-17-wheelhouse-design.md` or `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, it wins; section 14 states each difference.

**How to use this plan.** Each part below is carried out by one fresh session with this file, the spec and the repository. Each names what it waits on, its files, its tests and what done looks like, and ends with a pull request and one message to the main session. One part per fresh context; the main session starts the next. A later part may refine its own tasks from what the parts before it left, but not its rulings or the Global Constraints. "Today" below means main at commit `6d79c2e7`; a part starts from main as it stands at its go.

## The parts

The numbers are the design's (section 15), so its "from part 3" and "from part 5" still read true. Letters split a part into sessions.

| Part | What | Changes an outcome? | Waits on |
|---|---|---|---|
| 0a | Checks D2, D3, D5 (notes 86, 87, 89) | no | nothing |
| 0b | Check D1 (note 85) | no | nothing |
| 0c | Check D4 (note 88) | no | the director's clicks, on the pane, in chat and on the phone |
| 0d | Check U3 (note 90) | no | a throwaway GitHub repository, through the main session |
| 1a | The seal: facts, candidates, `shadow` | no | nothing |
| 1b | The reader | no | 1a, D3 |
| 1c | Scoring, the evidence view, `chat-question` | no | 1a |
| 1d | Blind cards | yes, the stated exception | 1c, D4 |
| 2a | A waiting piece gives up its place | not until 2b wires it | D1, local part 6 |
| 2b | Returning work and `admit`, and the wiring | **yes: how work runs** | 2a |
| 2c | The card budget: `heldBack` and the pull | **yes: how work runs** | 2a |
| 2d | Alike cards, and the top card rising | **yes: how work runs** | 2b, 2c |
| 2e | The merge queue's `park` for all work | **yes: how work runs** | 2a, U3 |
| 3a | Decision keys and exact answers | exact repeats only | 1a, 2d |
| 3b | The reader's close matches, and chat answers | no | 1b, 3a |
| 4a | The `rule` record and the composer | no | 1a |
| 4b | The one click | no | 4a, 3a |
| 4c | The standing brief | no | 4a, 1b |
| | **The plan stops here** (see below) | | |
| 5 | Stage 1 | yes, signed and ticked rules only | the goals draft built, D2, D3 |
| 6 | Audit and direction | only by a fall | part 5 |
| 7 | Stage 2 | yes, by click per rule | part 6, the bars set |
| E | The one counted evaluation | no | parts 1 to 7 |

**Side by side.** 0a, 0b, 0c and 0d can run together. 1a can run beside anything. After it, 1b and 1c can run together; 1d follows 1c. After 2a, 2b, 2c and 2e can run together, each in a different part of `runner.js`, with the later to merge rebasing. 2e and 2c read `waiting.js` and change nothing in `dispatch`, so neither needs 2b. 2d waits for both 2b and 2c, since it reads hold reasons and held cards. 3a follows 2d; 4a can run beside 3a; 4b follows both; 4c can run beside 4b. Part 2 is the one line that must not run beside the local work below.

**Order.** The design's: record-only, then parked pieces and budget, then asked once, then rules, then stage 1.

## Where the plan stops

**Stage 1 needs the unattended goals draft built, and that draft's six decisions are still held. The tasks below stop at the end of part 4.** Parts 5, 6 and 7 here are outlines only, and no session starts them from this file.

- **What part 5 needs.** A goal in force, its sheet, its id on a record, and its report. None of these exists, and the draft (`docs/specs/2026-10-31-unattended-goals-design.md`) isn't on main.
- **What lifts the stop, all of it.** The director answers the draft's six decisions (its decision 1 is replaced by this design's decisions 4 and 5). The goals build is merged. D2 and D3 pass, or the pack has closed what they found. Then a fresh planning session writes parts 5 to 7 in full against the goals code as built, in this file, and a fresh reviewer reads them.
- **What this plan leaves out on that account, so that nothing assumes an answer:**
  - The sheet's five new lines (design section 6). Section 15 lists them under part 4, but the sheet doesn't exist, so they move to part 5.
  - "A sitting isn't a day" (section 8.5), which needs the goal's report. The pull in 2c doesn't need it.
  - A goal's end for an answered piece (section 8.3, item 8), which needs a goal. Nothing in parts 1 to 4 reads one.
  - The time, spend and show-first bounds. No part reads or sets them.
- **What needs nothing from goals.** U3 is the goals draft's check, but part 2e needs it, so it runs here as check 90. Section 14.2 already applies `park` to all work.

## Early checks: who they need

Each check has a note in `docs/checks/`, a row in `docs/checks/README.md`, and a probe in `probes/` where a run is needed. Checks 82 to 84 are the last taken.

| Check | Note | Runs where | Needs |
|---|---|---|---|
| D1, many paused | `85-many-paused.md` | This Mac, on the scratch engine of `probes/lib/archon.js`, with workflows with no model step, so it costs nothing | An hour of the Mac. Agents run it. The scratch engine stays apart from the real one |
| D2, no way out | `86-no-way-out.md` | Pack reading, plus one real cheap step on the scratch engine | Agents only |
| D3, the reader's view | `87-reader-view.md` | One real cheap step on the scratch engine, in a folder of its own | Agents only |
| D4, a blind card | `88-blind-card.md` | The real pane, a real chat card, and the phone | **The director's clicks**, through the main session, on the main session's own computer, which holds the pane and the phone pairing |
| D5, the off path | `89-off-path.md` | A sample change in a scratch repository, no engine | Agents only |
| U3, leaving a pull request | `90-leave-pull-request.md` | Real Archon merge queue on a throwaway GitHub repository, as check 84 was | The repository, through the main session, on the main session's own computer. A few cents of model spend for the queue's ruling step |

Only D4 needs the director. D4 and U3 need the main session's own computer. D1 runs on any session's copy on this Mac, as long as nothing else uses the scratch engine for its hour. If D1 fails, the parked limit in 2a takes the number that held. If D4 fails, 1d limits blind cards to the pane. If U3 fails, 2e builds nothing and the merge question stays a blocking card. If D2 finds a way out, 1b closes it, since it already changes the pack. D5 is only read by part 5.

## Files shared with local checks

Local checks parts 2 to 7 are merging now, with 8 to 10 after. **Local work goes first on a shared file.** A delegated part rebases on it, never the other way round.

| File | Delegated parts | Local parts | Rule |
|---|---|---|---|
| `scripts/engine/dispatcher.js` | 2a, 2b | 2 (`sentBack` gains `reason`) | Part 2 waits for local part 6 |
| `scripts/engine/dispatch-run.js` | 1a, 2a, 2b, 2d, 2e | 2 (`sentBack`, the tail), 3 (`no-tests` hold), 6 (the local queue), 9 (a hold during a move) | Part 2 waits for local part 6. Local part 9 merges either side and rebases its one hold if it comes after |
| `scripts/host/helper.js` | 1a, 1b, 1c, 2a, 2b | 2 to 6, 8, 9 | Keep delegated hunks to a few lines beside `engineDesk`'s `dispatchRun` and `engineRunner` calls; logic lives in `scripts/delegation/` and `scripts/engine/`. Whichever is open second rebases |
| `scripts/state/events.js` | 1a, 1c, 1d, 2d, 3a, 4a, 4c | 3 (`checks-state`), 4 (`change`) | Additive lists. Local first if both are open |
| `scripts/engine/routes.js` | 1b, 4c | 2 (`mainCheck`) | New routes only. Local first if both are open |
| `scripts/engine/archon/adapter.js` | 1b | 5, if the lane needs it | Local first if both are open |
| `scripts/lib/front-desk.js`, `scripts/state/card-lines.js` | 1d, 4b, 4c | 2, 3, 5 | Additive. Local first if both are open |
| `scripts/engine/words.js` | 2a to 2e | 2, 3 | Additive |
| `scripts/desk/mod-pane.js`, `scripts/briefing/model.js` | 2c, 2d | 2, 3, 8 | Different rows. Local first if both are open |
| `scripts/gate/guardrails.js` | 1a reads it only | 3, 8 | No change here |
| `scripts/hooks/card-check.js` | 1d | 2 or 3, by the new cards | Additive |
| `docs/data.md`, `README.md`, `HANDOVER.md`, `SECURITY.md` | 1a, 2d, 4c | 3, 7, 8 | Whoever merges second rebases |
| `docs/checks/README.md` | 0a, 0b, 0c, 0d | none left | Four parts may touch it: the later rebases |
| `scripts/eval/summary.js`, `scripts/eval/engine-world.js` | E | 10 | Local first |

**So Part 1 may run beside the local parts now, and part 2 starts after local part 6 merges,** since 2 and 6 both reshape the same start paths. `scripts/checks/runner.js` is local's and has nothing to do with `scripts/engine/runner.js`. 2c doesn't touch `dispatch-run.js`, but it needs 2a's waiting test, so it waits too.

## Choices this plan makes

The design leaves these to the builder (section 20), or the code showed a gap it doesn't settle. The main session may change any.

1. **`shadow` is signed and helper-only:** in `PROTECTED_KINDS` and `HELPER_ONLY_KINDS`, as `check` is. Three lines make a seal, joined by the card's id: the seal, the reader's reading, the score. Each signed line keeps what the design calls sealed from being rewritten later.
2. **`shadow` never reaches a view that an agent or the board reads.** `/state/views` carries only `evidence: { sealed, read, sampled }`. Nothing but `scripts/delegation/` reads a seal's contents until the bars are set. Part 3b's close match is the one use before then: it acts on `sameAs` inside `scripts/delegation/`, and shows no score.
3. **Every level-3 card is sealed in one place:** `recordOnly.onCard`, called after the card is written, from the runner's `writeCard` and `capped` and from the dispatcher's own `write('question')` calls. Cap, stall, clash, requests and fix cards seal with `signed: <what>` and no reader, as approvals do, since no rule can decide them.
4. **The reader runs in a folder of its own,** never the project's or a worktree, kept beside the merge queue's (`scripts/engine/queue-folder.js`). Its view comes from a ticketed helper route, so the reader needs a start of its own: `routes.start` refuses it, since it has no work order. `startReader` (1b) saves a stand-in order and writes the ticket as `start` does. D3 confirms this shape.
5. **The view is built when the card is sealed, and frozen.** A reader that starts late reads the piece as it stood at the card. Its result counts even if the director has answered, since nothing in its view can show the answer; the line records `afterAnswer: true` so the review can leave those out.
6. **The reader's step has no blocked exit.** It can't ask, so `pack-check.js` gains `READ_ONLY = new Set(['wheelhouse-reader'])`: no `blocked` field, wait, `work` input or `{{rules}}` mark is required, since `rules.md` tells a step to read an order and take the blocked exit. The step must carry the read-only tool list D3 settled.
7. **The reader's model is the `reviewer` role's binding.** A role of its own would need a catalogue entry for no gain now. The setup stamp names the binding, so a later change resets evidence as it should.
8. **A blind card is a card of its own, ahead of the answer card.** `card` kind `blind`: the shuffled labels, no recommendation, Suggest a change… kept. Its click answers nothing. The ordinary answer card follows, with "You picked X first", and carries the signed answer. So the answer path, its signing and delivery stay exactly as they are. The follow-up card carries `blind: true`, which `learning.js` leaves out.
9. **Shuffling is seeded by the question's id,** so a card drawn twice reads the same.
10. **`returning` lives in `dispatch.json`, and who acts follows what the path does.** The dispatcher owns places. A path that wakes a paused run (an answer, a resume, Give it more's resume) is carried out by the runner once admitted, since it holds the answer and the fallback. A path that starts a new run (a rework, a next slice, a requeue, Try again, Build it again, Give it more's fallback) is carried out by the dispatcher. Each entry names its `runId` where it has one. The runner's `onStart` becomes an `enter`, and it keeps its `carried` figures through a callback when a run starts.
11. **Held cards are named by a note, not a field.** A question is hashed for its signature, so it can't change after it is written. The `cards-waiting` note gains `ids`, and `views.cardsWaiting` gives `{ count, ids }`. A card's held state is its presence in the latest list, so a new day's budget or a pull lifts it with no rewrite.
12. **Bundles and joins are one mechanism: a joiner is a `question` record of its own.** It carries `joins: <lead id>`, and its own `engine` options, so nothing already signed changes. `views.questions` gives a joiner its lead's answer, so `deliver` and `routerWaiting` need no new path. The answer card lists every joiner; where a card is already out, the front desk re-issues it through the existing `revises` field. **A click covers only what its card showed:** a joiner newer than the card answered stays open, with "You said this before". 2d uses this across pieces, and 3a within one.
13. **`normaliseWords` is defined once,** in `scripts/delegation/words.js`: lower case, Unicode NFKC, runs of white space to one space, trailing punctuation off, `\p{Cf}` removed. Options compare as sorted labels after the same step.
14. **The numbers go in one table,** `scripts/delegation/limits.js`: `BLIND_EVERY = 5`, `BLIND_A_DAY = 1`, `PARKED_TIMES = 2` (of `pace`), `OFFER_SITTING = 1`, `OFFER_AGAIN_DAYS = 30`, `RULE_REVIEW_MONTHS = 6`. The guardrails' numbers and the bars join it in part 5.
15. **Evaluation scenarios are numbered from 140,** the next clear run in `tests/eval/build-loop/` (it reaches 134, and local part 10 takes 76 to 81). Each is written in the part that builds its behaviour, and none is run before part E.
16. **The one counted evaluation is part E, after part 7.** Parts 1 to 4 stand on their tests, D1 and `tests/e2e/parked-pieces.test.js`, as v0.2.1 stood on check 84 and an end-to-end test. Sections 12 and 13.3 need stage 1 inside the evaluation, and the token rule allows one.
17. **No version numbers here.** The main session tags releases.
18. **A start is at most once, and an orphan is cleared.** Today each restart clears its entry and then starts, so a crash loses a start but never doubles one. `returning` keeps the entry, so it marks `starting` in `dispatch.json` before calling start. A refusal from before the engine was called is certain: the entry goes back, as any refusal does. A start that timed out, or a crash while `starting`, is uncertain: the engine's reply carries `uncertain: true`, and nothing retries until `liveRunOf` has answered. No run: start again. A run with a `run` record: it counts as started. A run with no `run` record never got its order or ticket, so it can read nothing and its asks are dropped: cancel it, confirm it ended, then start once. If `liveRunOf` can't say, or the cancel can't be confirmed, the entry goes to a Try again and Stop card, and nothing starts until the director clicks.
19. **The director's Stop ends a reservation,** and so does a bug that moves lane: neither writes a report, so `dispatchRun` is told by `release(work)`. Without this a stopped piece would hold its files for good.
20. **Blind cards have an off switch,** a `blindCards` project setting in the catalogue, on by default (design section 19).

## Global Constraints

- British or Australian English; dates as 1 November 2026; a path comment on every file's first line, or straight after front matter; JSON exempt.
- "The director", they/them. No model identifiers and no AI attribution anywhere in the repository, commits or pull requests.
- No names with words such as "enhanced", "improved" or "fixed".
- Public repository: nothing about the director's other projects, and no figures from the question history beyond what the design prints. Reader views, seals and scores stay in the private record.
- Scripts in Node.js, for macOS and Windows.
- **Record-only changes no outcome.** Before part 2, no card waits on any of this, and no piece's spend, cap or counted requests move. `recordOnly.tick` is detached from `engineTick`, with its own single-flight and timeout, since a hang there would otherwise stop every project's deliveries. A failure in `scripts/delegation/` costs a seal, never a card. Blind cards are the one stated exception.
- **Level 4 never moves, by any setting, at any stage.** Silence never settles anything. A timer never becomes a yes. An agent's confidence or word clears nothing.
- **Fits any project.** A check that can't run says so and takes the safe path; nothing asks a project to change shape.
- `lowered` in `routeAsk` stays exactly as it is until part 5, proposals included. `delegationProposals` runs as today, with blind cards left out from 1d.
- Figures in the design marked "first cut" are reasons. No code reads one.
- Tests: run the files a change touches, as `node --test --import ./tests/helpers/test-home.js <file>`. Leave `npm test` to CI. Pull requests merge on Linux green.

## Review Focus

The inputs the design implies and no task would otherwise test, most likely first. Each has its test in the task named.

1. **The helper restarts between a click and its delivery, or between `admit` and the run being seen running.** The answer is delivered once, the place is held across the restart, and nothing is lost. `a restart between admit and running keeps the place and delivers once` (2b).
2. **Runs already waiting when this version lands.** `router.json` and `dispatch.json` without the new fields, cards already open, a feature mid-slice: each counts rightly on the first tick, with no card raised twice. `state kept by the version before reads as waiting on the first tick` (2a).
3. **The reader can't run, or ends after the answer.** Counted requests, no folder, a timeout or an empty reply: the card is untouched, and the seal holds its script checks. `a reader that fails leaves the seal whole and the card alone` (1b).
4. **A worktree that has gone, or a branch that can't be read, when a piece parks.** Its expected files stand as the reservation, it is read again each tick, and nothing releases by itself. `an unreadable branch keeps the expected files and is read again` (2a).
5. **Questions alike in words but not in substance.** Different option labels, one at level 4, an approval, the same words on two pieces in different lanes, non-Latin text, a topic label that matches when the words don't. `only the same words and options at level 3 bundle` (2d).

### Part 2's own review

Parts 2a to 2e are the only ones that change how real work runs, so they carry more than the rest. Between 2a and 2b merging, nothing changes for real work: 2b wires it, because a freed place with ungated answers would pass `pace`.

- **Two reviewers on each pull request:** the usual fresh reviewer for the task, plus one who has read only section 8 of the design and `tests/scripts/engine/dispatcher.test.js`, and who is asked to find a way for work to be lost, started twice or left stuck with nothing to move it on.
- **The whole of part 2 gets one further read** after 2d merges, against the invariants below, before the main session lets it reach real use.
- **`tests/e2e/parked-pieces.test.js`** grows with each task, on the fake engine, and must stay green on Linux.

The invariants, each pinned by a named test in its task:

1. A running count never passes `pace`, with `admitted` counted, on any tick.
2. No restart path clears its entry before its run is seen to start.
3. A usage limit, or a feature waiting only on a merge, never reads as waiting on the director.
4. A reservation ends only with the piece's merge or end.
5. No answer is delivered twice, and none under All stop.
6. Every piece on `hold` names a reason, and a project where nothing runs has a card that says so.
7. The fix lane and the merge queue never wait for `admit`.
8. No piece counts against its own return, at any `pace` from 1 to 3.
9. One entry on `returning` starts at most one run, through a crash or a false refusal.
10. A piece never clashes with its own reservation.

---

## Part 0a: Checks D2, D3, D5

**Waits on:** nothing. **Done means:** three notes in the form of `docs/checks/84-set-status.md`, three rows in `docs/checks/README.md`, its opening sentence extended ("and checks 85 to 90, which are the delegated-decisions design's D1 to D5 and the goals draft's U3"), and one pull request.

**Files:**
- Create: `probes/86-no-way-out/run.js`, `probes/87-reader-view/run.js`, `probes/89-off-path/run.js`, `docs/checks/86-no-way-out.md`, `87-reader-view.md`, `89-off-path.md`
- Modify: `docs/checks/README.md`

- [ ] **Step 1: D2.** List every AI node in the built pack and the tools it can reach. Then run one real cheap step on the scratch engine whose prompt tells it to use the question tool and then to end on a plain-chat question. Record what each did and whether anything reached a person. Answer: which tools are open, and what closes them.
- [ ] **Step 2: D3.** Write `probes/87-reader-view/view.mjs`, a trial of `cleanDiff(text) -> { diff, pathsOnly: string[] }` that strips comments for `.js`, `.ts`, `.py`, `.swift`, `.md` and `.yaml`, and lists any other file by path and size. Run one real cheap step in an empty folder, its prompt telling it to find the builder's reasoning: artefacts of other runs, the worktree, `~/.wheelhouse-engine`, git history. Answer: which read-only tool list holds, what it could reach, and which file types need path and size only. **This must pass before stage 1.**
- [ ] **Step 3: D5.** On a scratch repository with a flags file: a slice that reuses a name found in the main line's history, a slice that changes the off path where a test sees it, and one where no test sees it. Answer: which of the planned checks catch which. Record the third as the known limit in section 19 of the design.
- [ ] **Step 4: Commit, and open the pull request.**

```bash
git add probes docs/checks
git commit -m "Answer the early checks a run needs no one for"
```

## Part 0b: Check D1

**Waits on:** nothing. **Done means:** the note and row, one pull request, and one message giving the parked limit that held.

**Files:**
- Create: `probes/85-many-paused/run.js`, `docs/checks/85-many-paused.md`
- Modify: `docs/checks/README.md`

- [ ] **Step 1: D1.** On the scratch engine, with workflows with no model step: 3 running loops, a merge-queue stand-in, a fix-lane stand-in, a reader stand-in and 6 paused runs, polled by `workflow attention` as the helper polls, for one hour. Then answer all 6 within one tick. Record: database lock errors, lost or doubled answers (reuse `askLedger` from `probes/78-archon-run-control/run.js`), and each run's state after. Repeat at 8 and 10 paused if 6 holds, to show the margin. Also record which fields `workflow status --all --json` gives for a run, and whether a run started with a timed-out `start` can be told by its branch or path: 2b's `liveRunOf` is built on that. Run it in the background and start nothing else on the scratch engine meanwhile.
- [ ] **Step 2: Commit, and open the pull request.**

```bash
git add probes/85-many-paused docs/checks
git commit -m "Answer how many paused runs hold"
```

## Part 0c: Check D4

**Waits on:** the director's clicks, through the main session; ask the main session, never the director. **Done means:** the note and row, one pull request.

**Files:**
- Create: `probes/88-blind-card/card.js`, `docs/checks/88-blind-card.md`
- Modify: `docs/checks/README.md`

- [ ] **Step 1: Prepare.** Make a card with no recommended option on a test project. Run it through `scripts/hooks/card-check.js` with a local trial change and record what it refuses and which line, in the hook and in the prompt record.
- [ ] **Step 2: Give the main session the steps** for the pane, a chat card and the phone, in one message: what to press and what to report back.
- [ ] **Step 3: Write the answer per surface.** Whether each shows the card, takes the click, and keeps the option order.
- [ ] **Step 4: Commit, and open the pull request.**

```bash
git add probes/88-blind-card docs/checks
git commit -m "Answer whether a card can go without a recommendation"
```

## Part 0d: Check U3

**Waits on:** a throwaway GitHub repository from the main session. **Done means:** the note and row, one pull request, and one message giving U3's answer.

**Files:**
- Create: `probes/90-leave-pull-request/run.js`, `docs/checks/90-leave-pull-request.md`
- Modify: `docs/checks/README.md`

- [ ] **Step 1: U3.** On the throwaway repository, with real Archon's merge queue: raise an unclear pull request several times and record how often `park` is offered; take it, and record whether later sweeps merge another pull request and leave that one alone; ready it again, and record whether `merge` on a signed approval merges it. Record the option's exact id, and how `mergeAsked` reports it.
- [ ] **Step 2: Commit, and open the pull request.**

```bash
git add probes/90-leave-pull-request docs/checks
git commit -m "Answer whether the merge queue can leave a pull request"
```

---

## Part 1a: The seal

**Waits on:** nothing. **Done means:** every level-3 card has a signed `shadow` line within one tick of being written, nothing about a card or its timing changes, and `docs/data.md` says so.

### Task 1: Facts and candidates

**Files:**
- Create: `scripts/delegation/words.js`, `scripts/delegation/limits.js`, `scripts/delegation/facts.js`, `scripts/delegation/candidates.js`
- Test: `tests/scripts/delegation/facts.test.js`, `tests/scripts/delegation/candidates.test.js`

**Interfaces:**
- Produces: `normaliseWords(text) -> string`; `sameOptions(a, b) -> boolean`; `changeFacts({ git, base, head, config }) -> { readable, paths, lines, testsChanged, depsChanged, schemaChanged, guardrail, secrets, critical }`, `git` being a `safeGit`; `CANDIDATES` (eight `{ id, words, undo, applies(facts, ctx) -> true | false | null }`, in the order of section 11.2, null meaning it can't say); `COMMON_EXCLUSIONS` (`{ id, hit(facts) -> true | false | null }`); `exclusionsHit(facts) -> string[]`; `exclusionsHash() -> string`.

- [ ] **Step 1: Write the failing tests.**

```js
test('the eight candidates are the design\'s, in order', () => {
  assert.deepEqual(CANDIDATES.map((c) => c.id), ['land', 'push-draft', 'remove-branches', 'defect-in-work', 'run-plan', 'tested-choice', 'follow-mock-up', 'written-rule']);
});
test('landing never applies to work that touches a guardrail', () => {
  assert.equal(byId('land').applies({ ...clean, guardrail: true }, { permitHolds: true }), false);
});
test('a change to a data model hits the common exclusions, and no candidate lifts one', () => {
  assert.deepEqual(exclusionsHit({ ...clean, schemaChanged: true }), ['data-model']);
});
test('a fact that can\'t be read is null, never false', () => {
  assert.equal(COMMON_EXCLUSIONS.find((e) => e.id === 'data-model').hit({ ...clean, readable: false }), null);
});
test('words normalise by case, space, invisible marks and end punctuation, and keep other scripts', () => {
  assert.equal(normaliseWords('  Which​  ONE? '), 'which one');
  assert.equal(normaliseWords('どちらにしますか？'), normaliseWords('どちらにしますか'));
});
```

Also test `changeFacts` on a scratch repository: paths, size, a test file changed, `package.json` changed, a migration path, a guardrail path by `classifyChange`.

- [ ] **Step 2: Run to see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/delegation/facts.test.js tests/scripts/delegation/candidates.test.js`
- [ ] **Step 3: Implement.** `facts.js` uses `classifyChange` and `config` from `scripts/gate/guardrails.js` for guardrails and critical areas, and `scripts/state/secret-scan.js` for secrets. Candidates that need a done check, a mock-up or a private host read `ctx` and give null without it. Legal, privacy, outside contact and a claim's meaning are `{ readable: false }` by nature: they have entries in `COMMON_EXCLUSIONS` that always give null, so the seal says so.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts/delegation tests/scripts/delegation
git commit -m "Read a change's facts, and write down the eight candidates"
```

### Task 2: The seal and `recordOnly`

**Files:**
- Create: `scripts/delegation/seal.js`, `scripts/delegation/stamp.js`, `scripts/delegation/record-only.js`
- Modify: `scripts/state/events.js` (`shadow` in `PROTECTED_KINDS`, `HELPER_ONLY_KINDS`, its fields), `scripts/engine/runner.js` (`onCard` called after `writeCard` and `capped`), `scripts/engine/dispatch-run.js` (`onCard` after each own `write('question')`), `scripts/host/helper.js` (builds `recordOnly` and starts its tick beside `engineTick`, never awaited by it), `docs/data.md`
- Test: `tests/scripts/delegation/seal.test.js`, `tests/scripts/delegation/record-only.test.js`, `tests/scripts/engine/runner.test.js`, `tests/scripts/state/events.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `setupStamp({ bindings, packDigest, ruleHash, exclusionsHash }) -> { models, pack, rule, exclusions }`; `sealOf({ card, facts, stamp, at }) -> { card, work, head, signed, candidates, exclusions, stamp, hash }`; `recordOnly({ engine, project, file, write, readViews, stopped, now, sign, factsOf, viewOf }) -> { onCard(card), tick() }`, `card` being `{ id, kind: 'question' | 'approval' | 'cap' | 'stall' | 'clash' | 'requests' | 'fix', work, runId, level }`, its state in `shadow.json` beside `router.json`.

- [ ] **Step 1: Write the failing tests.**

```js
test('a question card gets one shadow line, once, and an approval is sealed with no reader', async () => { /* onCard twice with the same id → one write; kind approval → signed: 'approval', reader: false */ });
test('a card waits for nothing: onCard returns before facts are read', async () => { /* factsOf never resolves; onCard resolves */ });
test('a level 4 card is sealed and marked as no rule can reach it', async () => { /* level 4 → signed: 'level-4', reader: false */ });
test('a seal that fails to write says nothing to the director', async () => { /* write rejects → no note, no card, tick resolves */ });
test('a tick that hangs holds up no delivery, and the next is skipped until it times out', async () => {});
test('a caller can\'t write a shadow line', () => { /* through /state/write and through checkRecord, as `check` is refused */ });
test('shadow isn\'t in the views an agent reads', () => { /* buildViews of a shadow event → no seal contents; evidence.sealed is 1 */ });
```

In `runner.test.js`: `the card is written whether or not onCard throws`.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `onCard` only queues to `shadow.json`; `tick` reads facts and writes. The head comes from the ask's `context.branch` and folder; a card with none seals with `{ readable: false }`. Add a line in `docs/data.md`: the seal stays in the private record.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests docs/data.md
git commit -m "Seal what each card's script checks say, beside the card"
```

## Part 1b: The reader

**Waits on:** 1a, D3. **Done means:** a question card's seal gains the reader's reading on the fake engine and on one real cheap run, with no card waiting and no spend on a piece.

### Task 1: The view

**Files:**
- Create: `scripts/delegation/view.js`, `scripts/delegation/view-copy.js` (the workflow's first step, as `order-copy.js` is)
- Modify: `scripts/engine/routes.js` (`/engine/reader-view`, ticketed, as `/engine/order` is), `scripts/host/helper-client.js`
- Test: `tests/scripts/delegation/view.test.js`

**Interfaces:**
- Produces: `readerView({ question, options, rule, quote, brief, sheet, diff, seed }) -> { refused } | { question, labels, rule, quote, brief, sheet, diff, pathsOnly }`; `screenWords(text) -> string[]`, the reasons it found; `cleanDiff(text) -> { diff, pathsOnly }`, from D3.

- [ ] **Step 1: Write the failing tests.**

```js
test('the view holds bare labels in a shuffled order, the same each time', () => {
  const v = readerView(sample);
  assert.deepEqual(v.labels, readerView(sample).labels);
  assert.ok(!JSON.stringify(v).includes('recommend'));
  assert.ok(!JSON.stringify(v).includes(sample.options[0].says));
});
test('a question with a claim of agreement or a reason is refused', () => {
  assert.ok(readerView({ ...sample, question: 'The director agreed, so shall I go on?' }).refused);
});
test('a long question is refused, not cut', () => { /* over the limit → refused */ });
test('comments leave the diff, and a file they can\'t leave shows as path and size', () => { /* .js comment gone; .xyz in pathsOnly */ });
test('a commit message appears nowhere in the view', () => { /* diff text only */ });
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** A refused view goes in the seal as `reader: 'refused'`; at stage 0 that parks nothing. The view is built in `recordOnly.tick` and kept in `shadow.json`; the route gives it to the run named by its ticket and to no other.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Build the reader's view: bare labels, a cleaned diff, nothing of the step's"
```

### Task 2: The workflow and its runs

**Files:**
- Create: `engine/archon/pack/wheelhouse-reader.yaml`, `engine/archon/pack/prompts/reader.md`, `scripts/delegation/reader.js`
- Modify: `scripts/engine/pack-check.js` (`READ_ONLY`, choice 6), `scripts/engine/archon/adapter.js` (`LANE_WORKFLOWS.reader`, and a `start` branch as the merge queue has: its own folder, no `--branch`, `--input card=<id>`), `scripts/engine/routes.js` (`startReader`), `scripts/delegation/record-only.js`, `scripts/engine/fake.js` (reader runs), `scripts/host/helper.js` (`workOf` names the reader's runs, as the merge queue's are named), `scripts/engine/runner.js` (`onAsk` and `caps` pass over `READER_WORK`)
- Test: `tests/scripts/delegation/reader.test.js`, `tests/scripts/engine/pack-check.test.js`, `tests/scripts/delegation/record-only.test.js`

**Interfaces:**
- Consumes: `readerView`; `engine.outputs`, `engine.inspect`.
- Produces: `READER_WORK = 'reader'`; `startReader({ project, card, folder, bindings }) -> { ok, runId } | { ok: false, refused }`, which saves a stand-in order with the run's lane and writes the ticket as `start` does; `readerResult(outputs) -> { frame: 'sound' | 'doubtful', why, kind, fits, pick, tags } | null`, null for anything missing, oversized or unparseable; `mayRead({ running, pace, live, counted }) -> boolean`.

- [ ] **Step 1: Write the failing tests.**

```js
test('one reader at a time, and only under pace + 2 runs', () => {
  assert.equal(mayRead({ running: 4, pace: 3, live: 0, counted: false }), true);
  assert.equal(mayRead({ running: 5, pace: 3, live: 0, counted: false }), false);
  assert.equal(mayRead({ running: 0, pace: 3, live: 1, counted: false }), false);
});
test('on a plan\'s counted requests no reader runs at stage 0', () => {
  assert.equal(mayRead({ running: 0, pace: 3, live: 0, counted: true }), false);
});
test('a reader that fails leaves the seal whole and the card alone', async () => { /* timeout, empty, bad shape, refused start → a shadow line reader: 'none', no question, no note to the director */ });
test('a reader\'s tokens fall under their own line and on no piece', async () => { /* cost record work: 'reader'; no piece's costs change; caps don't read it */ });
test('a reader\'s own trouble never becomes a card', async () => { /* onAsk with a lost owner or an unreadable ask on a reader run → no question, the run cancelled, the seal reader: 'none' */ });
test('a reader past a cap is cancelled with no cap card', async () => {});
test('no reader starts under All stop or an incident', async () => {});
test('an answer before the reader ends is marked, and the reading kept', async () => { /* afterAnswer: true */ });
test('the reader workflow passes the pack check and has no wait', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The workflow: `view-copy.js`, then one AI step with the tool list D3 settled, the `reviewer` binding's tier and a fixed `output_format` with the frame first. `reader.md` says what it answers and nothing of what follows from it; it is never told about the builder. The result is signed by the helper from `engine.outputs`, as `review-sign.js` does. If D2 found a way out, close it here, in `rules.md` or in the step's tool list.
- [ ] **Step 4: Run to see them pass,** then `node scripts/engine/pack-check.js`. Expected: no problems.
- [ ] **Step 5: One real run** on the scratch engine, with a real question and a small diff. Record the cost in the pull request.
- [ ] **Step 6: Commit.**

```bash
git add engine scripts tests
git commit -m "Add the reader, which reads each question card after it is written"
```

## Part 1c: Scoring, the evidence view, `chat-question`

**Waits on:** 1a. **Done means:** answered cards are scored in a sealed line, `views evidence` gives volume only, and a First Mate turn ending on a question with no card adds a count.

### Task 1: Scoring and the evidence view

**Files:**
- Modify: `scripts/delegation/seal.js`, `scripts/delegation/record-only.js`, `scripts/state/views.js` (`evidence`), `scripts/frontdesk/cli.js` (`VIEW_NAMES` gains `evidence`), `scripts/host/helper.js` (`/state/views` carries it)
- Test: `tests/scripts/delegation/seal.test.js`, `tests/scripts/state/views.test.js`, `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- Produces: `scoreOf({ seal, reading, answer, steered }) -> 'match' | 'miss' | 'outside' | null`; `views.evidence: { sealed, read, sampled }`.

- [ ] **Step 1: Write the failing tests.**

```js
test('a typed answer, a suggestion or a steered card counts outside, whatever it says', () => {
  assert.equal(scoreOf({ ...reading('Keep'), answer: { label: SUGGEST_LABEL, words: 'Keep' } }), 'outside');
  assert.equal(scoreOf({ ...reading('Keep'), answer: { label: 'Keep' }, steered: true }), 'outside');
});
test('with no reading and no set answer there is no score', () => { assert.equal(scoreOf({ seal, reading: null, answer: { label: 'Keep' } }), null); });
test('the evidence view shows volume, and no match, miss or direction', () => {
  assert.deepEqual(Object.keys(views.evidence).sort(), ['read', 'sampled', 'sealed']);
});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** A score is a third `shadow` line, once. Explain more and Why? aren't "outside".
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Score each sealed card against the answer, and show only how many"
```

### Task 2: `chat-question`

**Files:**
- Create: `scripts/hooks/chat-question.js`
- Modify: `hooks/hooks.json` (`Stop`), `scripts/state/events.js` (`chat-question`: `{ at }` and nothing else), `docs/data.md`
- Test: `tests/scripts/hooks/chat-question.test.js`

**Interfaces:**
- Produces: `endsOnQuestion(text) -> boolean`; `decide(input, deps)`, in the form of `stop-word.js`.

- [ ] **Step 1: Write the failing tests.**

```js
test('a question with no card adds one count, with none of the words', async () => { /* write called with { at } only */ });
test('a turn that asked a card counts nothing', async () => {});
test('an agent\'s reply that only quotes a question counts nothing', () => { assert.equal(endsOnQuestion('They asked "why?" and it was answered.'), false); });
test('outside the front desk, and in a failure of its own, it says nothing and blocks nothing', async () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Read the last assistant message from the hook's input, or the transcript's tail, and use the role check the other hooks use. No answer is ever returned: it can't change a turn.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add hooks scripts tests docs/data.md
git commit -m "Count a turn that ends on a question with no card"
```

## Part 1d: Blind cards

**Waits on:** 1c, D4. **Done means:** about 1 in 5 question cards, at most one a day, shows options first; the director's two answers are both kept; the delegation review leaves these out.

**Files:**
- Create: `scripts/delegation/blind.js`
- Modify: `scripts/state/events.js` (`question` gains `blind`), `scripts/settings/catalogue.js` (`blindCards`, choice 20), `scripts/lib/front-desk.js` (`blind` in `CARD_KINDS`), `scripts/cards/compose.js` (`blindInput(data, work)`; `answerInput` gains "You picked…"), `scripts/hooks/card-check.js` (a `blind` card needs no recommended option), `scripts/state/card-lines.js` (its set line), `scripts/frontdesk/cli.js` (`cards` makes a blind card first), `scripts/engine/runner.js` (`blind: true` on the question), `scripts/frontdesk/learning.js` (`unchanged` leaves out `card.data.blind`), `scripts/desk/mod-pane.js`, `scripts/delegation/seal.js` (`scoreOf` takes the blind pick)
- Test: `tests/scripts/delegation/blind.test.js`, `tests/scripts/cards/compose.test.js`, `tests/scripts/hooks/card-check.test.js`, `tests/scripts/frontdesk/learning.test.js`, `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- Produces: `blindDue({ ask, card, day, lastDay, roll, off }) -> boolean`, `roll` being a number in [0, 1) so tests fix it; `shuffled(options, seed) -> options`.

- [ ] **Step 1: Write the failing tests.**

```js
test('never at level 4, an approval or a card holding up all work', () => {
  for (const over of [{ level: 4 }, { approval: {} }, { exempt: true }]) assert.equal(blindDue({ ...due, card: { ...due.card, ...over }, roll: 0 }), false);
});
test('at most one a day', () => { assert.equal(blindDue({ ...due, lastDay: due.day, roll: 0 }), false); });
test('the blindCards setting turns them off', () => { assert.equal(blindDue({ ...due, off: true, roll: 0 }), false); });
test('about 1 in 5', () => { assert.equal(blindDue({ ...due, roll: 0.19 }), true); assert.equal(blindDue({ ...due, roll: 0.21 }), false); });
test('a blind card has no recommendation and keeps Suggest a change…', () => {});
test('the blind click answers nothing: the question stays open and its answer card follows', () => {});
test('a typed answer on the blind card closes the question, and scores outside', () => {});
test('a card that comes to hold up all work drops its blind form', () => {});
test('the delegation review leaves blind cards out of its count', () => { /* five unchanged, one blind → four counted */ });
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement,** per choices 8 and 9. If D4 limited it to the pane, the chat and phone forms show the ordinary card and the question isn't scored blind.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Show about one card in five with its options first"
```

---

## Part 2a: A waiting piece gives up its place

**Waits on:** D1, local part 6. **Read first:** section 8, and Part 2's own review above. **Done means:** the waiting test, `dispatch`'s new inputs and reservations are merged and tested. **Nothing changes for real work yet:** `dispatchRun` keeps passing `waiting: []` and `reserved: {}` until 2b wires them, since a freed place with answers not yet gated would pass `pace`.

### Task 1: What waits on the director

**Files:**
- Create: `scripts/engine/waiting.js`
- Modify: `scripts/engine/runner.js` (`waitingWork()`), `scripts/engine/dispatch-run.js` (its own cards)
- Test: `tests/scripts/engine/waiting.test.js`, `tests/scripts/engine/runner.test.js`

**Interfaces:**
- Produces: `routerWaiting({ state, views, prWork }) -> Set<work>`, from an unanswered entry in `state.waiting`, `state.questions` or `state.approvals`. Cap cards are among `state.questions`, so `state.capped` needs no test of its own, and an entry left there after Give it more, a Stop or a fix-lane cap reads as nothing. A merge-queue card is routed under `MERGE_WORK`, so `prWork(pr)`, the runner's `openedOf`, names the piece it stands for. `ownWaiting({ state, views }) -> Set<work>`, from a feature's `asked`, `stalls` not `done`, and `clashAsked`, each unanswered. `runner.waitingWork() -> Set<work>`.

- [ ] **Step 1: Write the failing tests.**

```js
test('an open card waits on the director, and an answered one no longer does', () => {});
test('a run paused at a usage limit doesn\'t wait on the director', () => { /* paused, no entry → not in the set */ });
test('a feature waiting only for its slice to merge doesn\'t wait on the director', () => {});
test('each feature card counts: cap, stall, clash, approval, demo, switch-on, merge', () => { /* the merge card through prWork */ });
test('a capped entry left after Give it more, after a Stop or in the fix lane doesn\'t wait', () => {});
test('state kept by the version before reads as waiting on the first tick', () => { /* router.json and dispatch.json with no new fields, cards open → in the set, no card written */ });
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The test reads what the runner knows, never the run's `paused` record. The two sets stay separate functions, so neither module reads the other's file.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Say which pieces wait on the director, from what the runner knows"
```

### Task 2: `dispatch` splits `live`

**Files:**
- Modify: `scripts/engine/dispatcher.js`, `tests/scripts/engine/dispatcher.test.js`, `scripts/delegation/limits.js` (the number D1 held, if under 2)
- Test: `tests/scripts/engine/dispatcher.test.js`, `tests/scripts/engine/dispatch-feature.test.js`

**Interfaces:**
- Consumes: nothing yet; 2b joins the two sets.
- Produces: `dispatch({ ..., waiting = [], reserved = {} })`. `reserved` is `{ [work]: string[] }`. `hold` entries gain `by: string[]`, naming what holds them where that can be named. A new `why`, `parked`.

- [ ] **Step 1: Change the test the design names, and add the rest.**

```js
test('a run waiting on the director gives its slot up and keeps its files; a run at a usage limit keeps both', () => {
  const work = Object.fromEntries([...['a', 'b', 'c'].map((id, n) => piece(id, { place: n })), piece('e', { place: 3, files: ['a.js'] }), piece('d', { place: 4, files: ['x.js'] })]);
  work.a[1].files = ['a.js'];
  const runs = { a: [runOf('a', 'paused')], b: [runOf('b', 'paused')], c: [runOf('c', 'started')] };
  const got = dispatch(base({ work, runs, waiting: ['a'] }));
  assert.deepEqual(got.start.map((s) => s.work), ['d']);
  assert.deepEqual(got.hold, [{ work: 'e', why: 'clash', by: ['a'] }]);
});
test('a second feature starts while the first waits on the director, and only one builds', () => {});
test('a feature between slices still holds the feature lane and a slot', () => { /* unchanged */ });
test('work that depends on a waiting piece still waits', () => {});
test('new work holds as parked once waiting plus running reach twice pace', () => {
  const got = dispatch(base({ work: sixWaitingPlusOneNew, runs, waiting: ['a', 'b', 'c', 'd', 'e', 'f'] }));
  assert.deepEqual(got.hold, [{ work: 'g', why: 'parked', by: ['a', 'b', 'c', 'd', 'e', 'f'] }]);
});
test('a reserved file keeps its hold after a run ends, until the work ends', () => {});
test('a piece never clashes with its own reservation', () => { /* a Carry on of a stopped piece: its files reserved → it starts */ });
test('a hot file a parked piece reserved holds what would touch it', () => {});
test('the running count never passes pace', () => { /* table of mixes */ });
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `live` keeps its test and drops `waiting`. `running` is what is live, plus what waits, plus each `reserved` key not ended, each with its files and reservation. `clashCheck` is given `running` without the piece itself. `PARKED_TIMES * pace.building` is the limit; the design fixes 2 unless D1 held less.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Let dispatch take a waiting piece's place and keep its files"
```

### Task 3: Reservations

**Files:**
- Modify: `scripts/engine/dispatch-run.js` (`reserved` in its state, `release(work)`), `scripts/engine/runner.js` (calls `release` on the director's Stop, at a blocked exit and at a cap, and on a bug's move), `scripts/host/helper.js` (`branchPaths`), `scripts/engine/words.js`
- Test: `tests/scripts/engine/dispatch-run.test.js`, `tests/scripts/engine/runner.test.js`

**Interfaces:**
- Consumes: `runner.waitingWork()`, given to `dispatchRun` as `waitingWork` through a setter as `onStart` is, since the runner is built after it.
- Produces: `branchPaths({ runId, branch }) -> Promise<string[] | null>`, null when it can't be read, using `safeGit` in the run's folder from `engine.inspect`: committed against the base, plus what is uncommitted. `dispatcher.release(work)`, choice 19.

- [ ] **Step 1: Write the failing tests.**

```js
test('a piece parks with its expected files and every path its branch changed', async () => {});
test('an unreadable branch keeps the expected files and is read again', async () => { /* null, then paths on the next tick; one Logbook line */ });
test('a reservation ends with the piece\'s merge or end, and never by time', async () => {});
test('the director\'s Stop ends a reservation, at a blocked exit and at a cap', async () => {});
test('a bug that moves lane releases the old id\'s reservation', async () => {});
test('a dispatch.json with no reservations reads as none', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Reads once per parking, adding to what is reserved. Delete nothing on an unknown read. The tick still passes `reserved: {}` to `dispatch`.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Reserve a parked piece's files until its work merges or ends"
```

## Part 2b: Returning work and `admit`

**Waits on:** 2a. **Read first:** section 8.3, and choices 10 and 18. **Done means:** three waits no longer stop new work, a second feature can start while the first waits, answers given together bring runs back at `pace`, every restart path passes one check, and a restart at any moment loses nothing and doubles nothing.

### Task 1: `dispatch` admits

**Files:**
- Modify: `scripts/engine/dispatcher.js`, `tests/scripts/engine/dispatcher.test.js`

**Interfaces:**
- Produces: `dispatch({ ..., returning = [], admitted = [] }) -> { ..., admit: [{ work, via }] }`. `returning` is `[{ work, lane, via, at }]`, `via` one of `answer`, `resume`, `more`, `rework`, `slice`, `carry`, `requeue`, `build-again`, `try-again`. `admitted` is the same shape, already named and not yet seen running.

- [ ] **Step 1: Write the failing tests.**

```js
test('a piece on returning doesn\'t count against its own return', () => {
  const got = dispatch(base({ settings: { ...settings, pace: { value: 1 } }, work, runs: { a: [runOf('a', 'paused')] }, returning: [back('a')] }));
  assert.deepEqual(got.admit.map((a) => a.work), ['a']);
});
test('a feature\'s own slice entry doesn\'t fill the place it asks for', () => { /* pace 1 and pace 3 */ });
test('an admitted piece counts once, and holds its place on the next tick', () => {});
test('returning work goes first, oldest answer first, ahead of work not yet started', () => {});
test('a place short: the rest stay on returning, and nothing is refused', () => {});
test('two returning pieces never hold each other by files', () => {});
test('nothing is admitted under All stop or an incident', () => {});
test('a returning feature waits for the feature place, and takes it when the builder parks', () => {});
test('at a slice boundary an answered feature that waited longer takes the turn', () => {});
test('work not yet started never takes the feature place at a slice boundary', () => {});
test('a requeue with no place stays for the next tick', () => {});
test('returning work counts towards the parked limit, and is held by it never', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `live` also drops every work on `returning` or `admitted`. Order: `admitted` into `building` and `features`, once each; then `returning`, oldest first; then `requeue`, as far as places allow; then `queued`. After admitting, each unadmitted `slice` entry counts against `building` and `features` for `queued`, so a feature between slices still holds its place against new work. An unadmitted answer doesn't: it gave its place up.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Admit returning work first, at pace"
```

### Task 2: One way back

**Files:**
- Modify: `scripts/engine/dispatch-run.js` (`returning` and `admitted` in its state; `enter`, `admittedTo`, `delivered`, `drop`; the new-run paths through them), `scripts/engine/runner.js` (`deliver` and `capAnswer` gated; `reworks` through `enter`), `scripts/engine/archon/adapter.js` (`liveRunOf`), `scripts/engine/contract.js`, `scripts/engine/fake.js`, `scripts/engine/words.js`
- Test: `tests/scripts/engine/dispatch-run.test.js`, `tests/scripts/engine/dispatch-feature.test.js`, `tests/scripts/engine/runner.test.js`

**Interfaces:**
- Consumes: `dispatch`'s `admit`.
- Produces:
  - `dispatcher.enter({ work, lane, via, key, runId?, branch?, carryOn?, raised?, answers?, carried? }) -> void`, idempotent by `work` and `key`.
  - `dispatcher.admittedTo(work) -> boolean`; `dispatcher.delivered(work, key)`, the runner's mark that an answer went back; `dispatcher.drop(work, key)`, for an answer refused.
  - `dispatcher.startAdmitted(args)`, for Give it more's fallback, on the place already held.
  - `dispatcher.onStarted(fn)`, `fn(runId, carried)`, so the runner keeps its `carried` entry.
  - `engine.liveRunOf({ work, branch, since }) -> { runId } | null | undefined`, undefined when it can't say, matching on the fields D1 found. Optional on the engine; missing reads as undefined. `engine.start`'s refusal gains `uncertain: true` for a timeout, carried through `routes.start`.
  - `runner.onEnter(fn)` in place of `onStart`. `STOPS_WORK`, the labels that stop work: `Stop`, `Stop here`, `stop`.

- [ ] **Step 1: Write the failing tests.**

```js
test('the click is recorded and the card closes at once, and delivery waits for a place', async () => {});
test('an answer that stops the work goes at once, with no place', async () => {});
test('an answer with nothing to send never enters, and a refused one is dropped', async () => {});
test('the fix lane and the merge queue never wait for admit', async () => {});
test('each path asks: answer, rework, Give it more, next slice, requeue, Try again, Build it again', async () => { /* table: pace full → no start; place free → one start */ });
test('Give it more resumes, and falls back to a start on the same place', async () => {});
test('a feature with its cap card open doesn\'t enter', async () => { /* next.act start, ownWaiting holds it → no entry, no place taken */ });
test('a path\'s entry stays until its run is seen to start', async () => { /* start refused → still on returning */ });
test('an entry marked starting is never started twice', async () => {
  // start times out, uncertain, the run having begun with a run record; a restart on the same files → liveRunOf finds it, no second start
});
test('an orphan with no run record is cancelled, confirmed ended, then started once', async () => {});
test('a certain refusal goes straight back, with no liveRunOf and no card', async () => {});
test('when liveRunOf can\'t say, or the cancel can\'t be confirmed, a card comes, not a second start', async () => {});
test('a refused start gives the place back, says so once, and raises Try again and Stop on the second', async () => {});
test('a start refused for the feature\'s cap leaves returning for the cap card', async () => {});
test('a restart between admit and running keeps the place and delivers once', async () => { /* new dispatchRun and engineRunner from the same files */ });
test('a run that pauses on a new ask before it is seen running gives its place up', async () => {});
test('time on returning isn\'t running time, and meets no cap', async () => {});
test('under an incident answers wait, and go once it closes, even one already admitted', async () => {});
test('under All stop the answer isn\'t used, the piece leaves returning, and Carry on has the answer and the branch, through a refused start', async () => {});
test('a piece with two open cards returns once both are answered', async () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
  - `deliver`: an answered key on a run with nothing else open calls `enter`, and waits. Once `admittedTo`, and with no open incident, it goes as today, then `delivered`. Stops, the fix lane and `MERGE_WORK` go as today. An answer with nothing to send is marked as today and never enters. A refusal calls `drop`.
  - `capAnswer`: Give it more enters with `via: 'more'` and `runId`; once admitted the runner does what it does today, with `startAdmitted` as its fallback. `reworks` enters with `via: 'rework'` and `carried`.
  - `dispatchRun`: `featureTick`'s next slice, `heldUp`'s Build it again, the cap's carry, the clash's Try again and `requeue` enter. `featureTick` doesn't enter while `ownWaiting` holds the feature. On admit it marks `starting`, saves, then starts; a retry follows choice 18.
  - "Seen running" is `engine.inspect(runId).status` of `running` or `ended`, read on the tick. A run that has paused again on a newer ask leaves the list, and waits on the director again.
  - All stop: `deliver`'s branch stays as it is, and the answer and branch go to `carryOver[work]` in `dispatch.json`. `startPiece` reads them when `decided.start` names that work, and clears them only on `got.ok`, so Carry on has both and a refused start loses neither.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Bring every restart through one check for a place, at most once"
```

### Task 3: The wiring

**Files:**
- Create: `tests/e2e/parked-pieces.test.js`
- Modify: `scripts/engine/dispatch-run.js` (`tick` passes `waiting`, `reserved`, `returning`, `admitted`), `scripts/host/helper.js`, `README.md`

- [ ] **Step 1: Write the failing end-to-end tests,** on the fake engine: `three parked pieces with other work merging`, `answers bringing runs back over pace`, `a waiting feature with a second one starting`, `a start refused after admission`, `All stop through an answer waiting for a place`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Wire it.** `tick` passes `waiting: [...runner, ...own]` and the rest. `README.md` says, in a line, that a piece waiting on the director no longer holds up other work.
- [ ] **Step 4: Run to see them pass,** with `tests/scripts/engine/dispatcher.test.js`, `dispatch-run.test.js`, `dispatch-feature.test.js`, `dispatch-fix.test.js`, `dispatch-merged.test.js` and `runner.test.js`.
- [ ] **Step 5: Commit.**

```bash
git add scripts tests README.md
git commit -m "Let a piece waiting on the director stop holding up other work"
```

## Part 2c: The card budget

**Waits on:** 2a. **Read first:** section 8.5. **Done means:** a fourth question is a card at once, wakes nobody, and is one click from the briefing and the pane.

**Files:**
- Modify: `scripts/engine/runner.js` (`showNow`), `scripts/state/views.js` (`cardsWaiting: { count, ids }`), `scripts/mod/courier.js` (`needsYou`), `scripts/frontdesk/cli.js` (`cards`), `scripts/desk/mod-pane.js`, `scripts/briefing/model.js`, `scripts/mod/buttons.js`, `scripts/desk/acts.js`, `scripts/engine/words.js`
- Test: `tests/scripts/engine/runner.test.js`, `tests/scripts/mod/courier.test.js`, `tests/scripts/frontdesk/cli.test.js`, `tests/mod/pane.test.ts`, `tests/scripts/briefing/model.test.js`

**Interfaces:**
- Consumes: `cardBudget`, whose `show` now means "push"; `routerWaiting`.
- Produces: `views.cardsWaiting.ids`; each pane card gains `heldBack: boolean`; the act `pull-cards` writes `note { about: 'cards-pulled', ids }`; the runner drops those ids from its held list without spending budget.

- [ ] **Step 1: Write the failing tests.**

```js
test('every ask is a card at once, and past the budget it is listed as held back', async () => {});
test('a held card wakes nobody, and needsYou passes over it', () => {
  assert.deepEqual(needsYou({ after: { cards: [{ id: 'c', n: 1, heldBack: true }] } }), []);
});
test('the front desk\'s cards pass over a held card until it is pulled', async () => {});
test('a pull lifts it, spending no budget', async () => {});
test('a new day\'s budget lifts held cards, in order of importance', async () => {});
test('a card over budget never ages into an answer', async () => { /* many days → still unanswered */ });
test('an exempt card ignores the budget, as today', async () => {});
test('a piece with a held card waits on the director all the same', () => {});
test('bundled approvals still count as one', async () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Per choice 11. Words: "4 more waiting. Show them".
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Let the card budget limit what is pushed, never what exists"
```

## Part 2d: Alike cards, and the top card rising

**Waits on:** 2b, 2c. **Read first:** section 8.5. **Done means:** alike open questions are one card, and a project where nothing can run raises the card behind it past the budget and Away.

### Task 1: Alike cards

**Files:**
- Modify: `scripts/engine/runner.js` (`bundleAlike`), `scripts/state/events.js` (`question` gains `joins`), `scripts/state/views.js` (a joiner takes its lead's answer), `scripts/cards/compose.js` (`answerInput` takes the joiners and lists each piece), `scripts/frontdesk/cli.js` (re-issues a card through `revises`), `scripts/board/model.js` (`numberedWaiting` passes over a joiner)
- Test: `tests/scripts/engine/runner.test.js`, `tests/scripts/cards/compose.test.js`

**Interfaces:**
- Consumes: `normaliseWords`, `sameOptions`.
- Produces: `alike(a, b) -> boolean`, for two open questions.

- [ ] **Step 1: Write the failing tests.**

```js
test('only the same words and options at level 3 bundle', () => {
  // different labels, a level 4, an approval, a matching topic with different words: no
  // same words on two pieces in different lanes, in a non-Latin script: yes
});
test('the answer goes to each piece, once, by each one\'s own option ids', async () => {});
test('a joiner newer than the card answered stays open, saying You said this before', () => {});
test('a joiner has no number and no wake of its own', () => {});
test('a card already out is re-issued listing the joiner, and the lead\'s signature stands', async () => {});
test('a piece that ended leaves the bundle, and the rest are answered', async () => {});
test('the card lists every piece it answers', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement,** per choice 12. A question joining an open card is written as a joiner and raises no card of its own. `routerWaiting` reads it through `state.questions`, so each joined piece waits until the lead is answered.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Ask alike questions as one card"
```

### Task 2: The top card

**Files:**
- Create: `scripts/engine/stuck.js`
- Modify: `scripts/engine/dispatch-run.js` (writes the note), `scripts/state/views.js` (`cardsWaiting.top`), `scripts/cards/visit.js` (`importanceOf` reads it, so the pane's `blocking` and the courier follow), `scripts/briefing/model.js` (how many pieces a card holds up), `docs/data.md`
- Test: `tests/scripts/engine/stuck.test.js`, `tests/e2e/parked-pieces.test.js`

**Interfaces:**
- Consumes: `hold[].by` from `dispatch`.
- Produces: `topCard({ hold, running, cards }) -> { card, holdsUp } | null`; `holdsUpCount({ hold }) -> { [work]: number }`.

- [ ] **Step 1: Write the failing tests.**

```js
test('with nothing running and nothing able to start, the highest card behind a hold rises', () => {});
test('it follows parked, clash and dependency back to the card behind', () => {});
test('with anything running there is no top card', () => {});
test('it is worked out on every tick, not only when a card is written', async () => {});
test('it ignores the budget and passes Away', () => {});
test('a card holding up others says how many', () => {});
test('a hold with no card behind it says so on the Logbook, once', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Each tick, when the answer changes, `dispatchRun` writes `note { about: 'top-card', id, holdsUp }`, with `id: null` once work runs. A blind card raised this way drops its blind form (1d).
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit, then ask the main session for the read of all of part 2.**

```bash
git add scripts tests docs/data.md
git commit -m "Raise the card behind everything when nothing can run"
```

## Part 2e: The merge queue's `park`

**Waits on:** 2a, U3. **If U3 failed, or `park` isn't offered, this part builds nothing:** the question stays a blocking card, as decision 2 was approved knowing. Close it with one line in the Logbook's words and no code. **Done means:** one unclear pull request no longer holds the others, and the director's Merge click merges it.

**Files:**
- Modify: `scripts/engine/runner.js` (`onAsk`, `alreadyApproved`), `scripts/engine/archon/asks.js`, `scripts/engine/dispatch-run.js`, `scripts/engine/words.js`
- Test: `tests/scripts/engine/runner.test.js`, `tests/scripts/engine/archon/asks.test.js`

**Interfaces:**
- Consumes: U3's option id and `mergeAsked`'s shape, from note 90.
- Produces: `parkChoice(ask) -> string | null`.

- [ ] **Step 1: Write the failing tests.**

```js
test('where park is offered it is taken, with no ruling, and the director\'s card is raised', async () => {});
test('where it isn\'t, the question stays a blocking card', async () => {});
test('a parked pull request\'s piece waits on the director, and others merge', async () => {});
test('Merge is a signed approval of that head, and the next ask merges on it, in any lane', async () => {});
test('a new head isn\'t covered by that approval', async () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `alreadyApproved` drops its `lane === 'feature'` test only for a pull request the helper's record shows was parked. This decides nothing: the permit's conditions don't change.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Let the merge queue leave one unclear pull request and go on"
```

---

## Part 3a: Decision keys and exact answers

**Waits on:** 1a, 2d. **Read first:** section 7.4. **Done means:** an ask repeating an open question joins its card; one repeating an answered question takes the director's own answer only where every condition holds.

**Files:**
- Create: `scripts/delegation/asked.js`
- Modify: `scripts/engine/runner.js` (`onAsk`, replacing its `earlier` block), `scripts/state/events.js` (`question` gains `key` and `head`), `scripts/cards/compose.js` ("You said this before", with that answer first)
- Test: `tests/scripts/delegation/asked.test.js`, `tests/scripts/engine/runner.test.js`

**Interfaces:**
- Produces: `decisionKey(work, words) -> string`; `reuse({ ask, earlier, commitsSince, spokenSince, changed, exclusions }) -> { answer } | { card: 'said-before' } | null`.

- [ ] **Step 1: Write the failing tests.**

```js
test('the key is from the piece and the words, and the topic label plays no part', () => {
  assert.equal(decisionKey('w', 'Which one?'), decisionKey('w', ' which  ONE'));
  assert.notEqual(decisionKey('w', 'Which one?'), decisionKey('x', 'Which one?'));
});
test('an exact repeat takes the earlier answer only when all hold', () => {
  for (const miss of [{ kind: 'approval' }, { level: 4 }, { options: other }, { commitsSince: 1 }, { commitsSince: null }, { exclusions: ['data-model'] }]) assert.notEqual(reuse({ ...hit, ...miss }).answer, hit.answer);
});
test('a stale answer dies: the director spoke on the piece, or changed it', () => {});
test('same words and different options is a card saying You said this before', () => {});
test('an open key with the same options joins the card and raises no other', async () => {});
test('the note says which earlier answer was given', async () => {});
test('a blocked ask answered from before starts its rework, and the piece doesn\'t strand', async () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `commitsSince` is null when it can't be read, and null gives a card. Records a Logbook line in the words of today's blocked exit. A reused answer to a blocked ask ends its run as any other does, so it sets `state.reworks` as `deliver` does, which today's path doesn't.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Ask each decision once, by a key made of its words"
```

## Part 3b: Close matches, and chat answers

**Waits on:** 1b, 3a. **Done means:** the reader's reading can join a close match or add a line, and never answers.

**Files:**
- Modify: `scripts/delegation/view.js` (the piece's open and answered cards), `scripts/delegation/reader.js`, `engine/archon/pack/prompts/reader.md`, `scripts/delegation/record-only.js`, `scripts/engine/runner.js`, `scripts/cards/compose.js`, `scripts/frontdesk/cli.js` (`card` takes `said`), `skills/front-desk/SKILL.md`
- Test: `tests/scripts/delegation/record-only.test.js`, `tests/scripts/cards/compose.test.js`

**Interfaces:**
- Produces: `readerResult` gains `sameAs: string | null`; `closeMatch({ card, sameAs, views }) -> { join } | { line } | null`.

- [ ] **Step 1: Write the failing tests.**

```js
test('a close match joins an open card only with the same options, and both wordings show', async () => {});
test('a close match on an answered card adds the line and answers nothing', async () => {});
test('with no reader, or no match, the card stands', async () => {});
test('a close match can\'t answer, at any setting', async () => {});
test('a card carrying the director\'s chat words asks for one click', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The reader's reading arrives after the card is written, so nothing waits. The skill says: where the director has already said what they want, put their words on the card as `said`. Typed words still steer and never approve.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add engine scripts skills tests
git commit -m "Let the reader point out a question already asked, and answer nothing"
```

---

## Part 4a: The `rule` record and the composer

**Waits on:** 1a. **Done means:** a composed rule can be proposed, confirmed by a signed click and read back, at stage 0, deciding nothing.

**Files:**
- Create: `scripts/delegation/rules.js`, `scripts/delegation/composer.js`
- Modify: `scripts/state/events.js` (`rule` plain, helper-only, in `CONFIRMABLE_KINDS`), `scripts/state/views.js` (`rules`), `scripts/delegation/seal.js` (a signed rule's hash in the stamp), `docs/data.md`
- Test: `tests/scripts/delegation/rules.test.js`, `tests/scripts/delegation/composer.test.js`, `tests/scripts/state/views.test.js`

**Interfaces:**
- Produces: `ruleHash(rule) -> string`; `composeRule({ answer, card, facts, lane, project, now }) -> rule | null`; `rule` is `{ id, words, literal, conditions, exclusions, answer, project, paths, lanes, stage: 0, review, hash }`; `views.rules: { [id]: { rule, stage, signedAt } }`; `stageOf(rule, { now }) -> number`.

- [ ] **Step 1: Write the failing tests.**

```js
test('typed words are kept; a clicked label is a literal match only', () => {
  assert.equal(composeRule(typed).words, 'Take the proper long-term option');
  assert.deepEqual(composeRule(clicked).literal, { options: labels, take: 'Keep' });
  assert.equal(composeRule(clicked).words, null);
});
test('the scope is this project, these paths, this lane, and every common exclusion', () => {});
test('the topic label plays no part', () => {});
test('the composer refuses level 4', () => { assert.equal(composeRule({ ...typed, card: { level: 4 } }), null); });
test('an unconfirmed rule is no rule', () => {});
test('a changed word changes the hash, and a hash that doesn\'t match isn\'t in force', () => {});
test('a new rule starts at stage 0', () => {});
test('past its review a rule falls to stage 1 or stays lower, and never rises', () => {});
test('an agent can\'t write a rule', () => {});
test('a candidate\'s evidence carries over when signed with the same hash', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Rules live in the private record only. `RULE_REVIEW_MONTHS` is the default.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts tests docs/data.md
git commit -m "Keep a signed rule, composed narrowly, deciding nothing yet"
```

## Part 4b: The one click

**Waits on:** 4a, 3a. **Done means:** after an answer that earns it, one line offers a rule, and a Confirm signs it.

**Files:**
- Create: `scripts/delegation/offer.js`
- Modify: `scripts/frontdesk/cli.js` (`cards` adds the offer), `scripts/cards/compose.js`, `scripts/state/card-lines.js`, `scripts/lib/front-desk.js`, `scripts/frontdesk/learning.js` (reuses `TURNED_DOWN_DAYS`), `skills/front-desk/SKILL.md`
- Test: `tests/scripts/delegation/offer.test.js`, `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- Consumes: `composeRule`, `decisionKey`.
- Produces: `offerDue({ events, answer, sitting, now }) -> rule | null`.

- [ ] **Step 1: Write the failing tests.**

```js
test('offered after a like question was answered, or the answer left the recommendation', () => {});
test('at most one a sitting, and a declined offer stays quiet 30 days', () => {});
test('never at level 4', () => {});
test('the card shows the rule as it would read, and its scope', () => {});
test('a typed wider rule becomes a ruling draft in the director\'s words, with a confirm card', () => {});
test('no pattern changes anything until the click', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The words: "Same answer for this kind of thing from now on?"
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit.**

```bash
git add scripts skills tests
git commit -m "Offer a rule in one click after an answer that earns it"
```

## Part 4c: The standing brief

**Waits on:** 4a, 1b. **Done means:** a project may hold one signed brief, the reader sees it, and a project with none works as today.

**Files:**
- Create: `scripts/delegation/brief.js`
- Modify: `scripts/state/events.js` (`brief`, in `CONFIRMABLE_KINDS`), `scripts/state/views.js` (`brief`), `scripts/delegation/view.js`, `scripts/engine/routes.js` (read only), `skills/front-desk/SKILL.md`, `docs/data.md`, `HANDOVER.md`
- Test: `tests/scripts/delegation/brief.test.js`, `tests/scripts/delegation/view.test.js`

**Interfaces:**
- Produces: `briefProblem(data) -> string | null`; `views.brief`, the latest confirmed, or null; `addFact(brief, { words, date }) -> brief`, a new version to confirm.

- [ ] **Step 1: Write the failing tests.**

```js
test('a blank line is allowed', () => { assert.equal(briefProblem({ for: '', now: '', noGos: '', examples: [], facts: [] }), null); });
test('a fact needs its date', () => {});
test('a secret is refused', () => {});
test('a build step reads it through the helper and can\'t write it', () => {});
test('with no brief the view holds none, and nothing else changes', () => {});
test('a fact given on a card may join the brief, with its date, by a confirm card', () => {});
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The skill: the First Mate proposes the brief from what the project holds, in conversation, never as a form, and the director corrects it. `HANDOVER.md` says where the work stands, and that the plan stops here.
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit, and tell the main session the plan has reached its stop.**

```bash
git add scripts skills tests docs/data.md HANDOVER.md
git commit -m "Keep a project's standing brief, and show it to the reader"
```

---

## Past the stop: outlines only

None of this is a task yet. Each line is what the fresh planning session starts from; it records no answer to the goals draft's decisions.

### Part 5: Stage 1

- The sheet's five lines and its ticks (section 6). `scripts/delegation/checks.js`: guardrails 1 to 9, each with a test that it moves an outcome. `scripts/engine/flag.js`: the off-path checks, from D5. `routeAsk`: the guardrails replace `lowered`, and existing level-2 topics are offered as composed rules. Pack: the blocked exit gains its citation fields, and what it searched; a sent-back ask. `decision` and `reversal` gain their fields. `brokerDecision`: the switch-on and held-merge refusal, sharing `scripts/engine/broker/rules.js` with local parts 2 and 5, which are merged by then. The report's flagged and told parts, in section 10. `learning.js`: the review reads evidence, and blind cards stay out. The falls in section 13.2 and resets in 13.3. Naming a reading (section 7.1). The checks run again at ready.
- **What it reads from goals:** a goal in force, its sheet and ticks, its id, its report. Whatever the draft's decisions on time, spend and show-first turn out to be, this design doesn't read them.
- **Needs:** D2, D3. D5 for switch undo; without it, switch falls back to held.

### Part 6: Audit and direction

- A weekly random sample of merged pieces, a fresh reader, one bundled card, `missed` records, a sample of chat questions. Direction shown in the review, only once the bars are set. It needs no goal in itself; its falls come with part 5.

### Part 7: Stage 2

- Standing rules, and tell, by the director's click per rule. Outside a goal, the 5 applies per project over a rolling day. Sample rates for tell-as-flag.
- **Needs:** the director to have set the bars (decision 5), before seeing any rule's results.

### Part E: The one counted evaluation

- Scenarios from 140 in `tests/eval/build-loop/`, `DESIGNED` in `scripts/eval/summary.js`, and `docs/evals/`. All of section 15's list, with stage-1 and planted-error scenarios in one run, as the token rule says. Its spend is the main session's to raise.

Parts 1 to 4 add their scenarios as files, unrun, as they build the behaviour: 140 a card sealed and shown unchanged; 141 a reader timing out; 142 three parked pieces with other work merging; 143 answers bringing runs back over pace; 144 a waiting feature with a second starting; 145 a fourth card pulled; 146 a close match that must not answer; 147 an answer waiting for a place through All stop; 148 a start refused after admission. Numbers from 149 are part 5's.

### Stage 3

Not planned. It needs its own design (section 13.1).

## Where the spec's sections are built

| Spec section | Part |
|---|---|
| 5 The shape | 5 |
| 6 The brief | 4c |
| 6 The sheet | 5 |
| 7.1 to 7.3 | 5 |
| 7.4 Asking once | 3a, 3b |
| 7.5 Plain chat | 1c (counts), 0a (D2), 6 (sample) |
| 8.1, 8.2 Waiting, what it gives up | 2a, wired in 2b |
| 8.3 Returning | 2b |
| 8.4 The limit | 2a, wired in 2b |
| 8.5 The budget | 2c, 2d; "a sitting isn't a day" in 5 |
| 8.1 The merge queue | 2e |
| 9 Guardrails | 1b (the reader at stage 0), 5 |
| 10 Outcomes | 5, 7 |
| 11.1 One click | 4a, 4b |
| 11.2 First classes | 1a (as candidates), signed from 4b |
| 12 Sealed against actual, blind sample | 1a to 1d |
| 12 The rest, the review | 5, 6 |
| 13 Stages | 4a (stage 0), 5, 7 |
| 13.3 The stamp | 1a; resets in 5 |
| 14 What this replaces | Each part named there |
| 16 Early checks | 0a, 0b, 0c; U3 in 0d |
