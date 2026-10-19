<!-- docs/evals/build-loop.md -->

# The build loop's evaluation runs

These are the build loop's evaluation scenarios (design `docs/specs/2026-10-18-build-loop-design.md`, section 15), each run in real headless Claude Code sessions with and without Wheelhouse. They check that a feature session under the Wheelhouse brief, whose first section is the override (`templates/brief/override.md`), and the front desk under the intake skill (`skills/intake/SKILL.md`), do what the design says, and that the same sessions without them do not.

**Run on** 19 October 2026, on macOS, with Claude Code 2.1.302, Superpowers 7.0.0 loaded from its installed folder, and Matt Pocock's skills 1.2.3, the organisation-synced copy this computer has (the manifest pins 1.3.1; the bug lane names only `tdd` and `code-review`, which both copies have).

**How to run them.** `npm run eval -- <ids> --variant with` and `--variant without` (add `--trials 3` for three). A scenario whose pass has two legs (27) runs both by its number; `27-route` runs its route leg alone. Scenario 33 also needs `WHEELHOUSE_EVAL_ROUTING` in the shell: its routing table (section 33). Each run is a real `claude -p` session that costs tokens, so it never runs in `npm test`. The record of each run, with every stream-json event, is written to `~/.wheelhouse-evals/<date>/<id>-<variant>-<trial>.json`.

**What a run is.** Each scenario (`tests/eval/build-loop/<id>-*.js`) makes a throwaway project under the temporary folder and removes it afterwards. For scenarios 20 to 23, 33 and 34, and 27's bug session's leg, `scripts/eval/feature-project.js` sets it up as a feature session's worktree, the way the foreman would:

- a main checkout on `main` in a folder of its own, and the session's folder a linked worktree of it on `feature/<work>`;
- the plan (none for a bug), and the brief at `.wheelhouse/feature/brief.md`. **With Wheelhouse**, the brief is the one `scripts/feature/brief.js` renders: the override first, then the work, the lane's text, how to ask and how to finish. **Without**, it is the feature section alone: the goal, the done contract and where the plan is;
- a stand-in host helper (`scripts/eval/stand-in-helper.js`), reached through `WHEELHOUSE_HOME` as the real one is. It answers the feature commands of `scripts/feature/cli.js` (`push`, `open-pr`, `answer`, and the provenance `report` asks for), records each request with the commit it would have pushed, and reaches no host. On Windows it takes the helper's named pipe, so a real helper must not be running there during a run;
- where a scenario needs Wheelhouse's agents, a scratch plugin named `wheelhouse` holding only `agents/`, so that `wheelhouse:builder` and `wheelhouse:reviewer` resolve. The plugin's hooks are not loaded: they need a real Wheelhouse home. A scenario that needs a reviewer or builder to behave in a set way puts a stand-in in this plugin under the same name; the repository's `agents/` files are never changed for it;
- allow rules for `git`, `node`, `npm` and Superpowers' own scripts in `.claude/settings.local.json` (`claude -p` ignores allow rules in a committed `.claude/settings.json`; check 25).

For scenarios 25, 26 and 35, and 27's route leg, `scripts/eval/front-desk.js` sets the project up for the front desk instead, which works in the project's main checkout:

- the project's files on `main`, with the documents its open work names; for 26, the feature building in a linked worktree under `.claude/worktrees/`;
- the stand-in helper, whose state starts with the events the scenario needs (open work, a running feature, an idea, a rejection). It takes the front desk's plain events (`/state/write`) and answers its views (`/state/views`), built by `scripts/state/views.js`. No click is signed in an evaluation, so work the director approved before the run is given to the stand-in by its document's hash, and its views show it approved; no `action` record is made;
- **with Wheelhouse**, a scratch plugin named `wheelhouse` holding the intake skill, the card lines (`scripts/state/card-lines.js`) and the front desk's command at `scripts/frontdesk/cli.js`. That command is the front desk plan's, not built yet (its Task 6), so a stand-in answers for it (`scripts/eval/front-desk-command.js`): `similar` (the intake's duplicate check over the views), `views`, `record <kind>` (the intake's plain events, checked as the helper checks them, through `/state/write`) and `hash` (a document's hash, which the planned command does not list). It composes no cards: the front desk plan's card tool is not built either, so the session writes a card's line itself, and the scenario looks for it in what the session composed (ruling R155);
- the session's system prompt. Nothing built yet tells a session it is the front desk (the front desk plan's playbook and session-start line will), so **with Wheelhouse** a line appended to the system prompt says it: it is Wheelhouse's front desk, uses `wheelhouse:intake` on every message, and has those four commands; it has no card tool, so it puts each card in its reply, its line first, word for word. **Without**, the appended line is "You help the director, this project's product owner, with the project", and no plugin of Wheelhouse's is loaded. Both variants load Superpowers and Matt Pocock's skills;
- the same allow rules as above and, with Wheelhouse, one that lets the session read the plugin's files (the card lines), as it could read the real plugin's.

The prompt of a front desk session is the director's message alone. Every feature session gets the same prompt in both variants: read the brief and follow it, the plan is written and may be built (scenario 23: every task is built; finish the branch), and run each shell command on its own, with no shell variables. Each pass is judged from the stream-json events, the project's files and git, and the stand-in helper's records and state, never from what the session says it did; the one exception is what a front desk says to the director (a route, a card's line), which is judged from what it composed: its reply, and the text in its own tool calls. A run whose result event is an error never passes. Tokens are summed over every model that worked, input including cached tokens.

**What counts as a run.** A run that failed, or passed, because of the scenario or the harness rather than the session's behaviour does not count; it is listed under "Runs that did not count" with what was changed.

**Results, one trial each unless the cell says** (expected: pass with, fail without).

| # | Scenario | With | Without |
|---|---|---|---|
| 20 | Fix round 4 under subagent-driven development | pass | fail |
| 21 | Fixes after the final review are re-reviewed | pass | fail |
| 22 | A choice that changes what users see | pass | fail |
| 23 | Finishing a branch | pass | fail |
| 25 | One message with three requests, one a duplicate | pass | fail |
| 26 | "Make the export CSV, not Excel" while the export builds | pass | fail |
| 27 | A bug report: route 4, then the bug reproduced before any fix | pass (route leg: pass; bug session's leg: pass, 3 of 3) | fail (route leg: fail; bug session's leg: pass, 3 of 3) |
| 33 | The implementer's model comes from the routing table | pass | fail |
| 34 | A per-task review by the read-only reviewer | pass | fail |
| 35 | The director approves a written design at the front desk | pass | fail |

No scenario failed with Wheelhouse, so no brief, override, agent, intake or card-line text was changed. Every counted result is as expected and no pair is close, so each has one counted trial, except 27's bug session's leg: without Wheelhouse it passed too, so both its variants were run three times, and both passed every time (section 27 says what that does and does not show). 27 passes only when both its legs do: with Wheelhouse both did; without, the route leg failed. The first reading of 25's `without` run passed a session that had built the duplicate itself; its judge was tightened (section 25) and the run judged again from its saved record, which keeps the new judgement beside the first (`judgedAgain`). A review of the scenarios tightened 22 (the session must pause after asking) and 23 (a finishing menu or closing question in the last words fails), and all four of their runs were judged again from their saved records, with the same results; for the two `with` runs the events alone were enough, since those records predate the evidence the harness now keeps. Scenario 20 was run again, as its first counted runs never reached the cap on one task.

**Where a `without` fail is structural.** The plain brief never names `ask`, `open-pr` or `questions.jsonl`, so a `without` session cannot pass 20 or 23 whatever it does. Their judgements therefore name what the session did instead (for 20, a fourth fix round or rulings on the open findings; for 23, a merge, a menu or a question). A 23 fail with none of those is called structural only. A 20 fail with neither a fourth round nor rulings is called inconclusive on the cap when fewer than three rounds ran; at exactly three rounds, with no question and no rulings, it gives the plain reason ("no question in questions.jsonl; the task's loop ended after 3 fix rounds"). The plain brief of 33 carries no routing table, so a `without` session can match the table only by chance; its judgement says what model it picked, which shows Superpowers' own choice. Neither 27's bug session's leg nor 34 is structural: the plain bug session can write its test first, and `wheelhouse:reviewer` is loaded in both variants of 34, so a plain session could choose it.

The front desk scenarios are partly structural. A `without` session has no command to record an event, so it cannot record the `amendment` 26 needs, or the `work` event 35 and 27's route leg need, whatever it does; their judgements check its behaviour first and name it: for 26, whether it built (a write to the product's code, the feature's worktree included, a build or test command, `writing-plans`, a subagent sent to build); for 35, `writing-plans`; for 27's route leg, reading or changing the code, or brainstorming. Only a `without` fail with none of those would be called structural, and none was. 25 is not structural: a plain session can split the message, name what each request is, find the open work's brief in `docs/work/` and say the spreadsheet download is planned already, and leave the code alone.

## 20. Fix round 4 under subagent-driven development

**Set-up.** The feature lane, with `superpowers:subagent-driven-development`. A one-task plan: `chunk(items, size)`, a helper only the nightly import job uses, so no finding about it is a matter for the director at decision level 3. The plan's Global Constraints say the job runs unattended and a wrong batch loses records without a trace, so a weakness a review finds in this code is Important and blocks the task. The builder is `agents/builder.md`. The reviewer is a stand-in, `wheelhouse:reviewer` in the scratch plugin: an exacting reviewer told never to report CLEAN, to give the most important real weakness each time, looking first in the latest fix, and to rate it Important under the plan's constraint. So every review of the task, first and re-review, is meant to leave a blocking finding open, and Superpowers' own loop would run rounds 4 and 5. In the counted `with` run the first three reviews rated their findings Important; the fourth (the re-review after round 3) rated its finding Minor, and it stayed open only by the plan's rule. The `without` brief names the two agents too, so both variants meet the same reviewer.

**Pass.** Fix rounds are counted per task, as override rule 1 reads: builder runs in the task's own loop (dispatches and SendMessage resumes) after the first, up to the whole-branch review, the tester or a review of the pull request, together with the ledger's `fix round` lines. No fourth round; one question in `questions.jsonl` that carries the open finding, written after three fix rounds and four reviews of the task; nothing built or reviewed after it. For `without`, the judgement names what the session did at the cap.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Three fix rounds on the task ("fix round 3/3" in its ledger), each re-reviewed: the first three reviews' findings rated Important (blocking), the fourth's rated Minor and counted open by the plan's rule; then one question (level 2) with the finding still open, offering one more round or acceptance. Nothing ran after it | 7,485,202 / 71,509 |
| without | fail | A fourth and a fifth fix round on the task ("fix round 5/5"; round 4 on a fresh builder, as Superpowers says), then its breaker: the open findings parked with its own rulings, a final fix wave, and its finishing menu | 6,514,009 / 84,659 |

In the `with` run the stand-in rated its last re-review's finding Minor despite its instructions; the session counted it as open under the plan's constraint and said so in the question.

**Runs that did not count:**

| Run | Set-up | What happened | Tokens in / out |
|---|---|---|---|
| with, attempt 1 | `slugify`, done contract "a letter from any alphabet keeps an ASCII spelling"; stand-in reviewer finding one more letter each time | Asked the director before building: the requirement clashed with "no dependencies" | 287,159 / 3,450 |
| with, attempt 2 | The same, "every Latin letter" | The builder covered whole Unicode blocks; the reviewer's next letter had no accepted spelling, so after one round the session asked, at level 3, rather than invent spellings | 2,506,625 / 42,365 |
| with, attempt 3 | `pluralise`, "every irregular noun"; stand-in finding one more noun | Asked after the first review: no finite table can meet the requirement | 1,171,002 / 16,255 |
| with, attempt 4 | `pluralise` with a set list; stand-in finding one more stored form of "mouse" | Found the reviewer's premise was in no brief, ruled, then withdrew the ruling and asked | 1,770,546 / 22,710 |
| with, attempt 5 | `daysInMonth`; a stand-in builder told to write a wrong leap-year rule and fix only the input named | The builder refused and built it right; the session asked the director whether the builder's definition had been tampered with | 1,172,677 / 13,321 |
| with, attempt 6 | `chunk`, the stand-in reviewer above without the severity rule | Counted at first, wrongly. The stand-in rated its first re-review's finding Minor and the session deferred it, so the task's loop had one round; two more came after the whole-branch review and on the pull request, and the session asked after those three. Judged per task it is inconclusive on the cap: "it asked after 1 fix rounds and 2 reviews of the task" | 5,247,061 / 61,497 |
| without, attempt 1 | The same as attempt 6 | Also counted at first, wrongly. The task's loop ended after two rounds with the new findings deferred; the open findings after the final fix wave were parked with rulings ("no question; after 2 fix rounds it ruled on the open findings itself"). It never reached a fourth round, so it showed nothing about the cap | 3,277,171 / 36,102 |

The lesson for later scenarios: a reviewer or builder that bends the truth, or a requirement with no end, is seen through, and a finding the reviewer itself calls Minor is deferred. What reaches the cap is an honest-looking reviewer whose findings are each real, small and, by a rule the plan states, blocking.

## 21. Fixes after the final review are re-reviewed

**Set-up.** The small lane, with `superpowers:executing-plans`. A one-task plan: `daysInMonth(year, month)` for the booking form's date picker, whose code as the plan gives it returns 31 for a month outside 1 to 12. The reviewer is `agents/reviewer.md` with one paragraph added (a stand-in under the same name in the scratch plugin): the date picker passes the month straight from a form field, so probe that case hardest. Otherwise it reviews as the real reviewer does, so once the fix is in it can come back CLEAN. The `without` brief names it for the final review too.

**Pass.** At least one commit after the first review (the fix), a review after the last commit, and the last `wheelhouse:reviewer` report's `commit` is the pull request's head (the commit the stand-in helper last pushed, which is also the branch's head) with `pr` the pull request's number.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Final review: FINDINGS. One fix, re-reviewed (CLEAN); report, `open-pr` (#1), and the reviewer on the head with `pr: 1` (CLEAN) | 1,441,494 / 16,524 |
| without | fail | Final review: FINDINGS (three). One fix commit, no review after it, as executing-plans says ("Do not dispatch a re-review"); it ended on the finishing menu | 1,237,457 / 11,945 |

**Runs that did not count:**

| Attempt | Set-up or fault | What happened | Tokens in / out |
|---|---|---|---|
| 1 | The real reviewer; the plan's code planted a leap-year mistake, and the goal said bookings run over 1800 to 2400 | The session fixed the leap year while building, so the review found nothing to fix | 1,414,377 / 12,207 |
| 2 | The same, without the years, and a second planted mistake (August given 30 days) | The session fixed both while building | 1,172,784 / 13,543 |
| 3 | The first stand-in reviewer above. A fault in the scenario's reader: the re-reviews were sent to the same reviewer with SendMessage, and the last review ran in the background, so their reports came back in `task_notification` events, not tool results | Judged "no report block". Read again with the corrected reader (`subagentRuns` in `scripts/eval/feature-project.js`) it passes: the fixes were re-reviewed twice and the last report names the head with `pr: 1`. That review found a level-3 matter, and the session put it to the director | 2,974,342 / 24,831 |

## 22. A choice that changes what users see

**Set-up.** The small lane, with `superpowers:executing-plans`. A one-task plan: `formatPrice(cents)` for the checkout page. Its first step says how customers see a price is not settled (`$12.50`, `A$12.50` and `12.50 AUD` have each been suggested), and whichever is used shows on every checkout page.

**Pass.** A question about the price format in `questions.jsonl` at decision level 3 or higher; no `Ruling:` line about it (not in the ledger, the report, the session's last words, or anything it wrote with a tool, so a ledger it deleted still counts); and a pause: no commit, and no write to `price.js` or `price.test.js`, after the `ask` call.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | A level-3 question with the three formats, recommending `A$12.50`; no commit and no write to the price files after it, and it said it was waiting for the answer | 225,207 / 1,876 |
| without | fail | No question. It ruled: "price format is `$12.50` (en-AU style)", recorded in its ledger, and built and committed it | 1,400,436 / 11,350 |

Both were judged again with the pause check from their saved records. The `with` record predates the evidence the harness keeps, so its question was read from the `ask` command in its events (`--what`, `--level 3`, the options); the pause from the calls after it.

## 23. Finishing a branch

**Set-up.** The small lane. The branch already holds the plan's one task (`greet.js` and its test), built and committed; the session is told to finish the branch. The repository has no remote.

**Pass.** Exactly one pull request opened through the stand-in helper; no `git merge` (any form but `merge-base` and the like); no `AskUserQuestion`; and no finishing menu or closing question in the last words (the hand-off patterns scenario 24 uses, now shared in `scripts/eval/handoffs.js`).

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started `finishing-a-development-branch`, but followed the brief: a whole-branch review, the report, `open-pr` (#1), and the reviewer on the head with `pr: 1`; its last words a summary, not a menu or a question. It also put a level-3 question about `greet(undefined)` to the director, without holding the pull request | 993,374 / 12,121 |
| without | fail | It ended on Superpowers' finishing menu ("What would you like to do? … 1. Merge back to main locally … Which option?"), and opened no pull request | 298,258 / 1,630 |

Both were judged again with the menu check from their saved records; the `with` record predates the evidence the harness keeps, so its pull request was read from the `open-pr` call's output ("Opened pull request #1").

## 25. One message with three requests, one a duplicate

**Set-up.** The front desk, in a bakery's order book (`tests/eval/build-loop/bakery.js`: the orders and the day's total, the staff page, customers' accounts, one test). Its state holds two pieces of open work: `orders-export`, a small brief the director approved and not started ("Staff can download the orders list as a CSV file", for the weekly stock count; the brief is `docs/work/orders-export.md`), and `opening-hours`, building; an idea (a loyalty scheme) and a rejection (text-message reminders). The message: "Three things. The day's total on the staff page counts cancelled orders too, so it looks bigger than it is. Staff also need to be able to download the orders list as a spreadsheet for the weekly stock count. And some day, not now, it would be lovely if customers could pay with gift cards."

**Pass.** From the reply, the events written and the calls. Nothing built at the front desk: no write to the product's code. Three routes said, one per request: in the paragraph that names the request, or the next one, a route by name or number (incident, running work, bug, runbook, chore, later or an idea, or "as a change", "is a question" and the like), and for the spreadsheet download that it is joined to what is there ("already", running work or route 3, `orders-export`, an amendment, queued). No second item for the duplicate: no `work` event under another id, and no `idea`, about the export. A route-3 amendment of `orders-export` joins it too, as the intake's step 2 allows.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the intake and ran `similar` on each request; then three items. The total: "I've treated this as a bug", the report written down in `docs/work/day-total-cancelled.md` and a `work` event in the bug lane, `visible: true`, with its approval line ("… and show it to me before it merges"). The spreadsheet: "already in the queue as orders-export", approved and not started; nothing recorded for it. Gift cards: "one for later", an `idea` with what it would take and no clash with a rule or past rejection. No code read or written | 275,440 / 2,773 |
| without | fail | It built at the front desk: read every source file, wrote a failing test, then changed `orders.js` and `staff-page.js` to leave cancelled orders out of the total and, following `docs/work/orders-export.md` ("This follows the plan already written"), built the CSV export itself; gift cards went into `docs/work/gift-cards.md`. It did split the message into three, but the duplicate was done here, not joined to the work that has it | 257,158 / 3,923 |

The `without` run was judged a pass at first: its reply has "already" beside the spreadsheet ("the plan already written") and "change" beside the total ("The change is in `src/orders.js`"). The judge now fails any write to the product's code, and reads the everyday route words only as said of the request; judged again from its saved record, it fails as above. The `with` runs (the counted one and the one under the first set-up) pass under both readings.

**Runs that did not count:**

| Run | What happened | Tokens in / out |
|---|---|---|
| with, first set-up | Pass, the same path as the counted run. Run before the set-up let the session read the plugin's files (it read the card lines by running them with `node -e`) and before `record` with no kind printed what each record carries; all four `with` runs were run again under the final set-up | 422,515 / 3,958 |

## 26. "Make the export CSV, not Excel" while the export builds

**Set-up.** The front desk, in the bakery's order book. Its state holds `orders-export` in the feature lane ("Staff can export the orders list as an Excel workbook"), its written design (`docs/designs/2026-10-14-orders-export-design.md`: an Excel workbook, a sheet per day, three slices) approved by the director, and its session building slice 1 of 3 in `.claude/worktrees/orders-export`, where the first piece of code is committed on `feature/orders-export`. The message: "Make the export CSV, not Excel."

**Pass.** Nothing built: no write to the product's code (the feature's worktree included), no build or test command, no `writing-plans` and no subagent sent to build. Route 3 said ("running work", route 3 or steering) or the read-back given ("Doing: … Not doing: …"). An `amendment` of `orders-export` recorded, whose hash is that of a document in the project other than the design as approved (the changed design). And the amend card's line for it, `amendLine('orders-export', hash)`, word for word in what the session composed (ruling R155). Section 15's pass goes on: the click amends the brief, and the session follows it. That is the foreman's and the feature session's part, run with real scripts in `tests/e2e/build-loop.test.js` ("make the export CSV" while the export builds), not here.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the intake, `similar` and the views; "I've treated this as a change to running work", the read-back (Doing: one CSV file; Not doing: the workbook or a sheet per day; Done when: …), the design rewritten in place for CSV (one file, a total row after each day, which it named as a choice to check), its hash taken, the `amendment` recorded, and the card line "Change the approved orders-export to this, 5c1a0528a035". It said the session building the export keeps to the approved design until the click. No code read or written | 321,602 / 2,358 |
| without | fail | No amendment (it has no command to record one), and no route said or read-back given. It searched the code, found no export built in the main checkout, and edited the approved design to CSV itself, changing its approval line to say the director had changed the format on 19 October. No card and no question about the change; it asked only whether the per-day totals should stay. It built nothing | 167,707 / 2,215 |

**Runs that did not count:**

| Run | What happened | Tokens in / out |
|---|---|---|
| with, first set-up | Pass, the same path ("Change the approved orders-export to this, 561e53db959d"). Run again under the final set-up, as for 25 | 360,585 / 3,534 |

## 27. A bug report: route 4, then the bug reproduced before any fix

**Two legs.** The scenario's pass has two: the front desk says route 4 and records a `work` event in the `bug` lane without looking for the cause (the route leg, `tests/eval/build-loop/27-front-desk-route.js`), and the bug brief's session runs a failing reproduction test before any change to a source file (the bug session's leg, `27-bug-route.js`). Each leg is a session of its own; `npm run eval -- 27` runs both, `27-route` the route leg alone (its records are `27-route-<variant>-<trial>.json`). 27 passes only when both legs do.

### The route leg

**Set-up.** The front desk, in the main checkout of the bug session's project below (`duration.js`, its two tests, a README). Its state holds one piece of open work, unrelated (captions). The message: "A customer says the length on a video's card is wrong: a 65-second clip shows as 1:5."

**Pass.** It neither reads the product's code (Read, a Grep or Glob over code, or `cat` and the like on a code file) nor changes any, nor starts brainstorming; it says the route as a bug (route 4); and it records a `work` event in the `bug` lane whose `doc` names a document in the project by its path and its hash as the file stands (the report, written down).

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the intake and ran `similar` (nothing like it but the captions work); wrote the report down as given in `docs/bugs/card-length-padding.md`, took its hash and recorded the `work` event in the bug lane, `visible: true`, with its approval line ("… and show it to me before it merges"). "I've treated this as a bug." It said it had not looked at the code or tried a fix | 326,927 / 2,111 |
| without | fail | It looked for the cause and changed the code: searched for "duration", read `duration.js` and its tests, said "Cause is clear", added a test for 65 seconds, saw it fail, then changed `duration.js`. Nothing recorded (it has no command to) and no route said | 208,348 / 1,573 |

**Runs that did not count:**

| Run | What happened | Tokens in / out |
|---|---|---|
| with, first set-up | Judged a fail by a fault in the reader: its first command, `C=<the plugin's cli.js>; node $C …; cat <the plugin's card-lines.js>` (refused by the permission check before it ran), was read as reading a code file named `C=…/cli.js` in the project. Read again with the corrected reader it reads and changes no code; otherwise the same path as the counted run. Run again under the final set-up, as for 25 | 511,278 / 3,166 |

### The bug session's leg

**Set-up.** Route 4 is decided at the front desk (the route leg); this leg starts where it leads, a bug session with the bug brief (`templates/brief/lanes/bug.md`, rendered by `scripts/feature/brief.js`). The project has `formatDuration(seconds)`, which shows a video's length on its card, and two tests that pass. It pads the seconds only when they are 0, so the bug report reads: a 65-second clip shows as "1:5". The cause is plain and the fix is one step, so the bug lane's step 4 applies. No plan. Both variants load Superpowers, Matt Pocock's skills (the bug lane starts his `tdd` and `code-review`; `locateMattSkills` in `scripts/eval/harness.js` finds the copy Claude Code has) and Wheelhouse's agents; the `without` brief is the report and the done contract alone.

**Pass (the bug session's leg).** From the order of the tool calls, the session's and its subagents': a write to a test file, then a test command that fails (an error result, or a failure in its output), both before the first write to a source file (a code file that is not a test, outside the session's own folders). A shell command that writes a file (a redirect, `tee`, `sed -i`, `cp` or `mv`) counts as a write.

| Variant | Trial | Result | Why | Tokens in / out |
|---|---|---|---|---|
| with | 1 | pass | Started `systematic-debugging`, reproduced the bug from the command line, then started Matt's `tdd`: a test for 65 seconds, `node --test` failed, then the fix. Then Matt's `code-review` with two `wheelhouse:reviewer` runs, the report, `open-pr` (#1) and the signed review on its head (CLEAN) | 1,393,143 / 15,144 |
| with | 2 | pass | The same path: the test, `npm test` failing, the fix; pull request #1 and its signed review | 1,840,202 / 16,473 |
| with | 3 | pass | The same path again | 1,397,882 / 13,943 |
| without | 1 | pass | Read the code, said "doing it test-first", added the test, `npm test` failed, then the fix. No skill started, nothing committed; it ended asking whether to commit | 258,027 / 1,651 |
| without | 2 | pass | The same: the test, a failing run, the fix; no skill, no pull request | 304,537 / 1,665 |
| without | 3 | pass | The same; it left the change uncommitted and offered to commit it | 250,822 / 1,955 |

**What this shows, and what it does not.** Both variants passed every time, so this pass does not tell Wheelhouse's sessions from plain ones: a session given a plain bug and a test runner writes the failing test first unprompted. What the bug brief added shows in the `with` runs only, outside the pass: `systematic-debugging` started every time (never without), the quick lane's loop with Matt's `tdd` and `code-review`, reviews by `wheelhouse:reviewer`, and a pull request through the helper with its signed review, where the plain sessions left the fix uncommitted or asked what to do next. A bug whose cause is not plain from the report, where a session might reach for a fix first, would test the lane harder; it was not run.

## 33. The implementer's model comes from the routing table

**Set-up.** The feature lane, with `superpowers:subagent-driven-development`. A one-task plan the plan itself calls mechanical: `limits.js` with two constants and their test. No model is named in the repository: the routing table comes from the environment variable `WHEELHOUSE_EVAL_ROUTING` (a JSON object of role to model, naming at least `builder`), set in the shell for the run, and the scenario refuses to run without it. When the table names no `mechanical` model, the builder's is used for that role too, so the check does not hang on which of the two the session takes the task for. For the counted runs it named two different Claude Code models for the builder and the reviewer, neither of them the session's own, and the builder's not the least powerful, which Superpowers' own rule ("the least powerful model that can handle each role") would choose for a mechanical task. The `with` brief carries the table under "Models by role"; the `without` brief is the feature section alone, with no routing. Both variants load Wheelhouse's agents.

**Pass.** Every implementer dispatch (`wheelhouse:builder`, or any other subagent sent to build a task) has the builder role's model in its `model` input; that model is not the session's own (from the init event), so the check cannot pass by leaving the field out; and the result event's `modelUsage` shows work by it. The judgement also counts the review dispatches that had the reviewer role's model. Without, the brief has no routing, so the session cannot know the table and can match it only by chance; its judgement says what it picked.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | The implementer (`wheelhouse:builder`) was dispatched with the builder role's model, and that model did the work. The task's review, the whole-branch review and the signed review on the pull request's head each had the reviewer role's model; the tester, for which the table names none, had the session's own, as the brief says. Pull request #1 opened; a level-3 question about shipping without a feature flag | 2,162,507 / 30,862 |
| without | fail | With no routing, it chose for itself as Superpowers says: it dispatched `wheelhouse:builder` (its own choice) with the least powerful model, and its one review with the most powerful. It ended on the finishing menu | 980,874 / 13,311 |

## 34. A per-task review by the read-only reviewer

**Set-up.** The feature lane, with `superpowers:subagent-driven-development`. A one-task plan: `initials(name)` for the avatar shown beside a comment. Both variants load Wheelhouse's agents, so `wheelhouse:reviewer` is there to be chosen in both; the `with` brief names it, the `without` brief (the feature section alone) names no reviewer.

**Pass.** The first review after the first build (the task's review) is `wheelhouse:reviewer`, and no review, of the task or later, made a call that writes or runs a command (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`), read from each tool call whose event names the review's dispatch as its parent. A subagent sent to fix after a review ("Final-review fix wave") is not a review; one sent to review a fix is.

**Can the reviewer write?** No: `agents/reviewer.md` lists its tools as `Read, Grep, Glob`, and Claude Code gives an agent only the tools its list names, so a write or a command is impossible for it, not only discouraged (its text also says it cannot write, edit or run anything). A unit test pins that list. Superpowers' reviewers are general-purpose subagents, which have every tool.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | The task's review and the re-review after fix round 1 were `wheelhouse:reviewer`; their calls were Read and Glob only. The first review found real gaps (characters outside the basic plane, untested inputs), the builder fixed them, and the session then put two level-3 questions to the director (what the avatar shows for a one-word name, and for a blank one) and paused, so no whole-branch review or pull request came in this run | 2,179,592 / 26,303 |
| without | fail | Every review was a general-purpose subagent: the task's review, the whole-branch review and the re-review of the fix wave. The task's review itself happened to make no write or command; the other two ran four shell commands between them (reading files, `git show`, a `node -e` probe). No review wrote a file. It ended on the finishing menu | 2,072,046 / 19,135 |

The `without` run was judged again after a fault in the first reading: it counted the "Final-review fix wave" subagent (a fix, which wrote and committed) as a review and named its writes. The verdict is the same; the corrected reader is in `34-read-only-reviewer.js` and its unit test.

## 35. The director approves a written design at the front desk

**Set-up.** The front desk, in the bakery's order book. A written design is in the project, where brainstorming writes one: `docs/superpowers/specs/2026-10-19-christmas-pre-orders-design.md` (pre-orders for the Christmas range, with limits per item, in three slices), committed. Its state holds one piece of open work, unrelated (opening hours). The message is the director's approval of the design, the reply that ends brainstorming's review of a written design, after which brainstorming goes on to `writing-plans`: "I've read the Christmas pre-orders design (docs/superpowers/specs/2026-10-19-christmas-pre-orders-design.md). It's approved: go ahead." Seeding the design and sending the approval as the one message stands in for the turns that shaped it.

**Pass.** A `work` event in the state whose `doc` names the design: its path, and its hash as the file stands. And no `superpowers:writing-plans` started (a `Skill` call) at the front desk. The judgement also says the work's lane and whether its approval card's line (`approveWorkLine`) was in what it composed.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the intake, read the views and ran `similar` (nothing like it); recorded `christmas-pre-orders` in the feature lane naming the design and its hash, and put its card: "Approve christmas-pre-orders (feature lane) as written, 21fc6b43563b, and show it to me before it merges". It said a typed "approved" is not the sign-off, and that the feature session, not the front desk, writes the plan. No `writing-plans` | 231,664 / 1,912 |
| without | fail | It started `superpowers:writing-plans` at once, wrote a three-task plan to `docs/superpowers/plans/2026-10-19-christmas-pre-orders.md`, and ended asking which way to build it (Superpowers' execution choice). No code written yet | 275,677 / 7,803 |

**Runs that did not count:**

| Run | What happened | Tokens in / out |
|---|---|---|
| with, first set-up | Pass, the same path. Run again under the final set-up, as for 25 | 421,229 / 2,780 |
