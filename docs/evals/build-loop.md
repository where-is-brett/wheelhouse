<!-- docs/evals/build-loop.md -->

# The build loop's evaluation runs

These are the build loop's evaluation scenarios (design `docs/specs/2026-10-18-build-loop-design.md`, section 15), each run in real headless Claude Code sessions with and without Wheelhouse. They check that a feature session under the Wheelhouse brief, whose first section is the override (`templates/brief/override.md`), and the front desk under the intake skill (`skills/intake/SKILL.md`), do what the design says, and that the same sessions without them do not.

**Run on** 19 October 2026, on macOS, with Claude Code 2.1.302, Superpowers 7.0.0 loaded from its installed folder, and Matt Pocock's skills 1.2.3, the organisation-synced copy this computer has (the manifest pins 1.3.1; the bug lane names only `tdd` and `code-review`, which both copies have). Scenarios 25, 26 and 35, and 27's route leg, were run again on 20 October 2026, with the same versions, against the real front desk (below); their 19 October results are kept in their sections as history.

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
- **with Wheelhouse**, a scratch plugin named `wheelhouse` holding what a real front desk session uses: the front desk's command, `scripts/frontdesk/cli.js`, copied with every file it imports (an import the repository doesn't hold stops the set-up), the glossary's starter it reads, and the repository's `package.json`, which makes the scripts modules as at the real plugin's root; the intake skill and the front desk's playbook (`skills/front-desk/SKILL.md`); and a session start hook. The real session start (`scripts/hooks/session-start.js`) needs a real Wheelhouse home, so the hook gives what the real one's reload gives a front desk session over the scenario's state, worked out at set-up with its own `reload`: here, the one line "This is the front desk. Follow wheelhouse:front-desk." A SessionStart hook in a plugin does run in `claude -p` (tried on Claude Code 2.1.302: its context reached the session), so nothing is appended to the system prompt. The board context hook needs a real Wheelhouse home too and stays out. The card check (`scripts/hooks/card-check.js`) stays out because it could never run: `claude -p` offers no AskUserQuestion, not even when `--tools` names it (tried on 2.1.302), so a session there cannot ask a card with it. The stand-in helper answers every route the real command calls in these scenarios: the views (with the card events when asked), plain writes in the shape and under the id the real helper takes them (a work event, an amendment, an idea, a card, the cards asked), the director's profile (no settings of their own) and a pull request's head (only one opened through it);
- the session's system prompt. **With Wheelhouse**, nothing is appended. **Without**, the appended line is "You help the director, this project's product owner, with the project", and no plugin of Wheelhouse's is loaded. Both variants load Superpowers and Matt Pocock's skills;
- the same allow rules as above and, with Wheelhouse, one that lets the session read the plugin's files, as it could read the real plugin's, and the rule for the front desk's command that the real local settings hold (`scripts/protection/settings.js`).

**On 19 October 2026,** before the front desk was built, the set-up was different: the plugin held the intake and the card lines, and its `scripts/frontdesk/cli.js` ran a stand-in command (`scripts/eval/front-desk-command.js`: `similar`, `views`, `record` and `hash`, a document's hash, which the real command does not have); the stand-in composed no cards, so the session wrote a card's line itself and the scenario looked for it in what the session composed (ruling R155); and a line appended to the system prompt said the session was Wheelhouse's front desk and named its commands. That stand-in and its `hash` are gone. What the scenarios used `hash` for (26's amendment and the work events of 25, 27 and 35 name a document by its hash) the real command had no way to do: its `record` took a hash and nothing gave the session one. So `record` now works out the hash of a work event's document and of an amendment (the one file the work names) and prints it, refusing a hash given that is not the document's as it stands, and the intake says so (the front desk plan's Task 6, which says the intake has no other way to write these records).

**The command's input (ruling F81).** The playbook first gave `card` and `record` their JSON as a heredoc, which Claude Code refuses ("Live checks" below). It now has the session write the JSON with the Write tool to `front-desk.json` in its scratchpad folder, the temporary folder Claude Code names in its system prompt, and run `node ".../cli.js" <command> < "<that file>"`. The scratchpad was written without a prompt in the two permission modes seen, default (the live check) and acceptEdits (the evaluation runs), and it is outside the project, so nothing reaches git. Not every session has one: Claude Code 2.1.302 names a scratchpad in the system prompt only behind a feature switch, and not in a background session (tried: that session's system prompt named none, though its init event still gave a path). So with none named, the playbook has the JSON written to one fixed file in the project, `.wheelhouse/front-desk.json` (ruling F85), which the project's local settings let the front desk write with one rule beside its command's, `Edit(/.wheelhouse/front-desk.json)` (`localSettings` in `scripts/protection/settings.js`); without that rule a Write there asks in the default mode. Git ignores `.wheelhouse/` through the repository's `info/exclude`, written by `ensureIgnored` (`scripts/feature/files.js`) when the foreman first wakes; setup does not write it yet. A refused input is written again with the Write tool, never edited in the shell (ruling F86). The first `with` runs of 20 October used the heredoc form; every `with` variant was run again with the file form.

The prompt of a front desk session is the director's message alone. Every feature session gets the same prompt in both variants: read the brief and follow it, the plan is written and may be built (scenario 23: every task is built; finish the branch), and run each shell command on its own, with no shell variables. Each pass is judged from the stream-json events, the project's files and git, and the stand-in helper's records and state, never from what the session says it did; the one exception is the route a front desk says to the director, which is judged from its reply. A card is judged by its `card` event in the stand-in's state, which only `cli.js card` and `cli.js cards` write, and by how the session put it to the director: an AskUserQuestion call holding it, or, as `claude -p` offers no AskUserQuestion, the card in its reply in the card's own words: its set line, its first part, or every one of its options by label together with what the option it recommends says, word for word (`howAsked` in `scripts/eval/front-desk.js`, ruling F83). A search for AskUserQuestion alone is not asking. No director answers it. The first reader of 20 October was wrong both ways: it refused a reply that gave the whole card in the session's words, and it then took every option by label, which every card of a kind shares, or a bare search for the tool. The reader as now written was fixed before the `with` runs of the file form. A run whose result event is an error never passes. Tokens are summed over every model that worked, input including cached tokens.

**What counts as a run.** A run that failed, or passed, because of the scenario or the harness rather than the session's behaviour does not count; it is listed under "Runs that did not count" with what was changed.

**Results, one trial each unless the cell says** (expected: pass with, fail without).

| # | Scenario | With | Without |
|---|---|---|---|
| 20 | Fix round 4 under subagent-driven development | pass | fail |
| 21 | Fixes after the final review are re-reviewed | pass | fail |
| 22 | A choice that changes what users see | pass | fail |
| 23 | Finishing a branch | pass | fail |
| 25 | One message with three requests, one a duplicate | pass (first run 20 October: pass; 19 October: pass) | fail (19 October: fail) |
| 26 | "Make the export CSV, not Excel" while the export builds | fail, 1 of 3 passed (first runs 20 October: 2 of 3; 19 October: pass) | fail (19 October: fail) |
| 27 | A bug report: route 4, then the bug reproduced before any fix | pass (route leg: pass, 19 October and both runs of 20 October; bug session's leg: pass, 3 of 3) | fail (route leg: fail, 19 and 20 October; bug session's leg: pass, 3 of 3) |
| 33 | The implementer's model comes from the routing table | pass | fail |
| 34 | A per-task review by the read-only reviewer | pass | fail |
| 35 | The director approves a written design at the front desk | pass (first run 20 October: pass; 19 October: pass) | fail (19 October: fail) |

On 19 October no scenario failed with Wheelhouse, so no brief, override, agent, intake or card-line text was changed then. Every counted result is as expected, so each has one counted trial, except 27's bug session's leg. One `with` pass is close: 20's counted run is one trial on a set-up tuned to reach the cap, and it passed because the session counted a Minor-rated finding as open by the plan's rule, so 20 should be run three times before the pilot. For 27's bug session's leg: without Wheelhouse it passed too, so both its variants were run three times, and both passed every time (section 27 says what that does and does not show). 27 passes only when both its legs do: with Wheelhouse both did; without, the route leg failed. The first reading of 25's `without` run passed a session that had built the duplicate itself; its judge was tightened (section 25) and the run judged again from its saved record, which keeps the new judgement beside the first (`judgedAgain`). A review of the scenarios tightened 22 (the session must pause after asking) and 23 (a finishing menu or closing question in the last words fails), and all four of their runs were judged again from their saved records, with the same results; for the two `with` runs the events alone were enough, since those records predate the evidence the harness now keeps. Scenario 20 was run again, as its first counted runs never reached the cap on one task.

**The front desk scenarios, 20 October.** The cells for 25, 26, 35 and 27's route leg give the `with` runs with the command's input from a file (ruling F81), then the first runs of that day, which used the heredoc form, and 19 October's. The `without` runs were made once on 20 October and stand. Every result is as expected but 26 with Wheelhouse: under the readers fixed before the runs it passed one trial of three (section 26). One trial failed because the session put the card in its own words; the other because it said the route only in its own words and gave no read-back, which the intake asks for. No text was changed for them (section 26 says why). In the first runs, Claude Code refused the heredoc form in every `with` run, and each session passed the JSON from a file in its scratchpad instead; with the file form no command of the front desk's was refused. No `with` session could ask a card with AskUserQuestion, so each put it in its reply, or said it was waiting on the board.

**Where a `without` fail is structural.** The plain brief never names `ask`, `open-pr` or `questions.jsonl`, so a `without` session cannot pass 20 or 23 whatever it does. Their judgements therefore name what the session did instead (for 20, a fourth fix round or rulings on the open findings; for 23, a merge, a menu or a question). A 23 fail with none of those is called structural only. A 20 fail with neither a fourth round nor rulings is called inconclusive on the cap when fewer than three rounds ran; at exactly three rounds, with no question and no rulings, it gives the plain reason ("no question in questions.jsonl; the task's loop ended after 3 fix rounds"). The plain brief of 33 carries no routing table, so a `without` session can match the table only by chance; its judgement says what model it picked, which shows Superpowers' own choice. Neither 27's bug session's leg nor 34 is structural: the plain bug session can write its test first, and `wheelhouse:reviewer` is loaded in both variants of 34, so a plain session could choose it.

The front desk scenarios are partly structural. A `without` session has no command to record an event, so it cannot record the `amendment` 26 needs, or the `work` event 35 and 27's route leg need, whatever it does; their judgements check its behaviour first and name it: for 26, whether it built (a write to the product's code, the feature's worktree included, a build or test command, `writing-plans`, a subagent sent to build); for 35, `writing-plans`; for 27's route leg, reading or changing the code, or brainstorming. Only a `without` fail with none of those is called structural, and 26's is one: it built nothing, so its recorded reason (no amendment) is only the missing command. What does differ in that run is that it edited the approved design itself and gave no card and no question. 25 is not structural: a plain session can split the message, name what each request is, find the open work's brief in `docs/work/` and say the spreadsheet download is planned already, and leave the code alone.

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

**20 October 2026, the command's input from a file** (record `~/.wheelhouse-evals/2026-10-20/25-with-1.json`):

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | The same path as the first run: three items, the bug recorded in the bug lane with its `approve-work` card (shown first), the spreadsheet "already" queued, gift cards an `idea`. Every command from a file in its scratchpad, none refused. Its reply named the card without giving it in the card's words | 1,130,238 / 7,456 |

**20 October 2026, first runs, the heredoc form** (records `~/.wheelhouse-evals/2026-10-20/first-runs/25-with-1.json` and `~/.wheelhouse-evals/2026-10-20/25-without-1.json`; the `without` run stands):

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the playbook, then the intake; `similar` on each request and `views waiting`; read the open work's brief. The total: "I've treated this as a bug", the report written down in `docs/work/day-total-cancelled.md`, a `work` event in the bug lane, `visible: true`, and its `approve-work` card (shown first) composed with `cli.js card` and put in its reply. The spreadsheet: "already queued as … CSV file"; nothing recorded for it. Gift cards: an `idea` for later. Its first `record work` (a heredoc) was refused by Claude Code; from a file it was refused twice more by the command (no `dependsOn`, then `doc` as a bare path) and then recorded. No code read or written | 879,438 / 6,617 |
| without | fail | It built at the front desk, as on 19 October: changed `orders.js` and `staff-page.js` and their test to leave cancelled orders out of the total, built the CSV export from `docs/work/orders-export.md`, and wrote gift cards down for later | 327,415 / 5,115 |

**19 October 2026, the stand-in command:**

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

**Pass.** Nothing built: no write to the product's code (the feature's worktree included), no build or test command, no `writing-plans` and no subagent sent to build. Route 3 said ("running work", route 3 or steering) or the read-back given ("Doing: … Not doing: …"). An `amendment` of `orders-export` recorded, whose hash is that of a document in the project other than the design as approved (the changed design). And a card event whose set line is the amend card's for it, `amendLine('orders-export', hash)`, recorded by `cli.js card`, and that card put to the director (judged as above). On 19 October, with no card tool, the line was looked for word for word in what the session composed (ruling R155). Section 15's pass goes on: the click amends the brief, and the session follows it. That is the foreman's and the feature session's part, run with real scripts in `tests/e2e/build-loop.test.js` ("make the export CSV" while the export builds), not here.

**20 October 2026, the command's input from a file** (records `~/.wheelhouse-evals/2026-10-20/26-with-<trial>.json`), three trials, judged by the reader fixed before them, which also fails a changed design that still says the director approved it (rulings F75, F80):

| Variant | Trial | Result | Why | Tokens in / out |
|---|---|---|---|---|
| with | 1 | pass | Route 3 and the read-back; the design rewritten for CSV, its approval line replaced; the amendment and the amend card ("…, c5a2aab52228") in its reply; "until you click it, the build keeps to the Excel design you approved". No code read or written | 1,074,551 / 6,346 |
| with | 2 | fail | "The amend card … was recorded, but never put to the director." It did all the rest: route 3 ("a change to work already under way"), the read-back, the design rewritten and marked changed, the amendment. Its reply gave the card in its own words: a shortened first part, and the recommended option's words with a small first letter ("the build makes a CSV file instead of the Excel workbook"), so by the reader's word-for-word test the card's own words are not there | 1,073,627 / 6,562 |
| with | 3 | fail | "No route 3 was said and no read-back given." It said "I've treated this as a change to work that's already running", the route in its own words, not by the name the reader looks for, and gave a before and after list instead of the read-back. The rest was right, the card in its reply word for word with its set line and reply code ("…, 63e9f32be0f4") | 1,027,635 / 6,319 |

Neither failure is changed by text here. Trial 2's comes from `claude -p` having no AskUserQuestion: with it, the playbook hands the card over as composed. Trial 3's read-back is in the intake already (route 3, "Read it back in one line"), and step 4 asks for the route in one line, which the session gave in its own words. A reader that took "work … already running" or "under way" as route 3 would pass trial 3, but readers are not changed after a run. The amend cards' meanwhile in the first runs said the export waits for the click, which nothing does (the foreman pauses a build only when an applied amendment says to); the intake now says an amend card's meanwhile is that the build keeps to the approved design until the click, and these three runs said so.

**20 October 2026, first runs, the heredoc form** (records `~/.wheelhouse-evals/2026-10-20/first-runs/26-with-<trial>.json` and `~/.wheelhouse-evals/2026-10-20/26-without-1.json`; the `without` run stands). The first `with` trial failed, so `with` was run three times:

| Variant | Trial | Result | Why | Tokens in / out |
|---|---|---|---|---|
| with | 1 | fail | No route said and no read-back given. Otherwise the whole path: the intake, `similar`, the design found with `git ls-files` and read; the approval line replaced with "Changed since the director's approval; the change card decides it." and the design rewritten for CSV; the amendment recorded with the hash `record` worked out; the amend card ("Change the approved orders-export to this, 25ec064a0462") composed and put in its reply, saying it could not show it as a clickable question. It also said the export was paused until the click, which nothing had done, and its card's meanwhile said the same. No code read or written | 886,222 / 7,038 |
| with | 2 | pass | "I've treated this as a change to work already under way", the read-back (Doing: one CSV file; Not doing: a sheet per day or totals rows; Done when: …), the design rewritten and marked changed, the amendment and its amend card ("…, 9f27cda30d43"), the card in its reply in its own words with every option. Judged a fail at first (below) | 850,229 / 6,277 |
| with | 3 | pass | The same path as trial 2, the card in its reply with its set line and reply code ("…, d0c517771383"); it searched for AskUserQuestion first | 1,076,906 / 7,445 |
| without | 1 | fail | As on 19 October: no route said, no read-back, nothing recorded. It found no export code, edited the approved design to CSV itself (a total row after each day, its own call) and added a line saying the director had changed the format on 20 October. No card and no question about the change itself. It built nothing, so the fail is structural | 180,222 / 1,970 |

Trial 2 was judged a fail at first: "the amend card … was recorded, but never put to the director". The reader then was wrong: it refused a reply that gave the whole card, in the session's own words, because it looked only for the set line or the first part word for word. It was first widened to every option by label, which was wrong the other way, and is now as described above (ruling F83). Trial 2 was checked by hand against its saved record: its reply gives the change, why it comes to the director, the recommendation, the meanwhile and every option with what it does, so it was put to the director; the record keeps that judgement beside the first (`judgedAgain`). Trial 1's fail is the session's own: the intake says both what it left out (step 4, "Say the route in one line", and route 3's read-back), so no text was changed for it.

**19 October 2026, the stand-in command:**

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the intake, `similar` and the views; "I've treated this as a change to running work", the read-back (Doing: one CSV file; Not doing: the workbook or a sheet per day; Done when: …), the design rewritten in place for CSV (one file, a total row after each day, which it named as a choice to check), its hash taken, the `amendment` recorded, and the card line "Change the approved orders-export to this, 5c1a0528a035". It said the session building the export keeps to the approved design until the click. No code read or written | 321,602 / 2,358 |
| without | fail | No amendment (it has no command to record one), and no route said or read-back given. It searched the code, found no export built in the main checkout, and edited the approved design to CSV itself, changing its approval line to say the director had changed the format on 19 October. No card and no question about the change; it asked only whether the per-day totals should stay. It built nothing | 167,707 / 2,215 |

The `with` run also edited the approved design in place. The changed design keeps "Approved by the director on 15 October 2026." above text the director has not approved, and has "Amended 19 October 2026: the export is a CSV file…" added before any click. That is within the intake's text ("write the changed document" says nothing about where), and the approved text stays in git with the approval's hash pinning it, so it is not a `with` fail. Where a change to an approved document is written, so that the working copy never claims an approval no click gave, is left to the front desk plan (controller's ruling R164).

**Runs that did not count:**

| Run | What happened | Tokens in / out |
|---|---|---|
| with, first set-up | Pass, the same path ("Change the approved orders-export to this, 561e53db959d"). Run again under the final set-up, as for 25 | 360,585 / 3,534 |

## 27. A bug report: route 4, then the bug reproduced before any fix

**Two legs.** The scenario's pass has two: the front desk says route 4 and records a `work` event in the `bug` lane without looking for the cause (the route leg, `tests/eval/build-loop/27-front-desk-route.js`), and the bug brief's session runs a failing reproduction test before any change to a source file (the bug session's leg, `27-bug-route.js`). Each leg is a session of its own; `npm run eval -- 27` runs both, `27-route` the route leg alone (its records are `27-route-<variant>-<trial>.json`). 27 passes only when both legs do.

### The route leg

**Set-up.** The front desk, in the main checkout of the bug session's project below (`duration.js`, its two tests, a README). Its state holds one piece of open work, unrelated (captions). The message: "A customer says the length on a video's card is wrong: a 65-second clip shows as 1:5."

**Pass.** It neither reads the product's code (Read, a Grep or Glob over code, or `cat` and the like on a code file) nor changes any, nor starts brainstorming; it says the route as a bug (route 4); and it records a `work` event in the `bug` lane whose `doc` names a document in the project by its path and its hash as the file stands (the report, written down).

**20 October 2026, the command's input from a file** (record `~/.wheelhouse-evals/2026-10-20/27-route-with-1.json`):

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | The same path as the first run: route 4, the report written down in `docs/bugs/video-length-format.md`, the `work` event in the bug lane with its `approve-work` card, put in its reply; no code of the product's read or written | 1,107,421 / 5,926 |

Runs that did not count, both run again:

| Run | What happened | Tokens in / out |
|---|---|---|
| with, file form, attempt 1 (`did-not-count/27-route-with-1-module.json`) | A fault in the set-up: the scratch plugin had no `package.json`, so Node took the command's scripts as CommonJS and `cli.js` would not start ("Cannot use import statement outside a module"); nothing could be recorded. The plugin now carries the repository's `package.json`, as the real plugin's root does | 347,798 / 1,969 |
| with, file form, attempt 2 (`did-not-count/27-route-with-1-reader.json`) | Judged "it read code: *.js" by a fault in the reader: the session searched the plugin's scripts (`grep … "<plugin>/scripts" --include=*.js`, and `"<plugin>/scripts/cards/"*.js`), and the reader took `*.js` for a file in the project. The reader now reads each word as the shell joins it and passes over `--include=` and `--exclude=`; read again, it reads no code of the product's | 895,202 / 4,879 |

**20 October 2026, first runs, the heredoc form** (records `~/.wheelhouse-evals/2026-10-20/first-runs/27-route-with-1.json` and `~/.wheelhouse-evals/2026-10-20/27-route-without-1.json`; the `without` run stands):

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the playbook and the intake, ran `similar` (only the captions work, "something else"); wrote the report down as given in `docs/bugs/video-length-format.md` and recorded the `work` event in the bug lane, `visible: true`, from a file after Claude Code refused the heredoc; composed its `approve-work` card (shown first) with `cli.js card`. "I've treated this as a bug." It said it had not looked for the cause. It named the card as waiting on the board without putting it in the reply, which the route leg does not judge. No code read or written | 812,789 / 5,448 |
| without | fail | As on 19 October: it read `duration.js` and its tests, added a test for 65 seconds, saw it fail and changed `duration.js`. Nothing recorded and no route said | 218,061 / 1,590 |

**19 October 2026, the stand-in command:**

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

**Pass.** A `work` event in the state whose `doc` names the design: its path, and its hash as the file stands. And no `superpowers:writing-plans` started (a `Skill` call) at the front desk. The judgement also says the work's lane, and whether its approval card (`approveWorkLine`) was recorded and how it was put to the director (on 19 October: whether the line was in what it composed).

**20 October 2026, the command's input from a file** (record `~/.wheelhouse-evals/2026-10-20/35-with-1.json`):

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Recorded `christmas-pre-orders` in the feature lane naming the design and its hash, and composed its approval card ("…, 21fc6b43563b, and show it to me before it merges"); no `writing-plans`. Its reply named the card without giving it in the card's words, which the pass does not turn on | 897,783 / 6,276 |

**20 October 2026, first runs, the heredoc form** (records `~/.wheelhouse-evals/2026-10-20/first-runs/35-with-1.json` and `~/.wheelhouse-evals/2026-10-20/35-without-1.json`; the `without` run stands):

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the playbook and the intake, read the design; recorded `christmas-pre-orders` in the feature lane naming the design and the hash `record` worked out (from a file, after Claude Code refused the heredoc twice), and composed its approval card, "Approve christmas-pre-orders (feature lane) as written, 21fc6b43563b, and show it to me before it merges", which it searched for AskUserQuestion to ask and then put in its reply. No `writing-plans`. The judgement saved says the card was asked by "a search for AskUserQuestion", which no longer counts; the pass does not turn on it | 1,021,333 / 6,448 |
| without | fail | As on 19 October: it started `superpowers:writing-plans` at once and wrote a three-task plan to `docs/superpowers/plans/2026-10-20-christmas-pre-orders.md`. No code written | 297,992 / 8,819 |

**19 October 2026, the stand-in command:**

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started the intake, read the views and ran `similar` (nothing like it); recorded `christmas-pre-orders` in the feature lane naming the design and its hash, and put its card: "Approve christmas-pre-orders (feature lane) as written, 21fc6b43563b, and show it to me before it merges". It said a typed "approved" is not the sign-off, and that the feature session, not the front desk, writes the plan. No `writing-plans` | 231,664 / 1,912 |
| without | fail | It started `superpowers:writing-plans` at once, wrote a three-task plan to `docs/superpowers/plans/2026-10-19-christmas-pre-orders.md`, and ended asking which way to build it (Superpowers' execution choice). No code written yet | 275,677 / 7,803 |

**Runs that did not count:**

| Run | What happened | Tokens in / out |
|---|---|---|
| with, first set-up | Pass, the same path. Run again under the final set-up, as for 25 | 421,229 / 2,780 |

## Live checks of the front desk's allow rule

Run on 20 October 2026, on macOS, with Claude Code 2.1.302, in a throwaway project whose `.claude/settings.local.json` held only the rule `scripts/protection/settings.js` writes, `Bash(node "<plugin root>/scripts/frontdesk/cli.js":*)`, with a stand-in `cli.js` (and a `cli.jsx` beside it) that prints that it ran. Each command was given to `claude -p --permission-mode default --setting-sources project,local` to run as written, so a command the rule does not allow is refused in the stream rather than run.

| Command | What happened |
|---|---|
| `node "<root>/scripts/frontdesk/cli.js" similar "Could we export the orders as a spreadsheet?"` | Ran |
| `node "<root>/scripts/frontdesk/cli.js" record ruling <<'EOF'` with one line of JSON, then `EOF` | Refused: "Contains brace with quote character (expansion obfuscation)" |
| `node "<root>/scripts/frontdesk/cli.js" card <<'EOF'` with the card's JSON, then `EOF` | Refused, the same |
| `node "<root>/scripts/frontdesk/cli.js" record ruling < ruling.json` (the JSON in a file in the project) | Ran |
| The Write tool, the card's JSON to `card.json` in the session's scratchpad; then `node "<root>/scripts/frontdesk/cli.js" card < "<scratchpad>/card.json"` | Both ran, with no prompt |
| The Write tool, the same JSON to `.wheelhouse/front-desk/card.json` in the project (git-ignored), with no rule for it | Refused: the Write needs the director's permission in the default mode |
| With no scratchpad named (`CLAUDE_CODE_SESSION_KIND=bg`, the background isolation guard turned off for the check) and the local settings `localSettings` writes: the Write tool, the JSON to `.wheelhouse/front-desk.json`; then `node "<root>/scripts/frontdesk/cli.js" card < ".wheelhouse/front-desk.json"` | Both ran, with no prompt |
| `node "<root>/scripts/frontdesk/cli.jsx" similar "…"` | Refused: "This command requires approval" |
| `node "<root>/scripts/frontdesk/cli.js"x similar "…"` (the shell joins it into `cli.jsx`, with a `cli.jsx` beside it) | Refused: "This command requires approval" |

**(a) Does the rule match the commands the playbook runs?** The heredoc form the playbook first gave for `card` and `record` does not run: Claude Code refuses a command whose heredoc holds a brace beside a quote, whatever the allow rules say. So the playbook now has the JSON written with the Write tool to `front-desk.json` in the session's scratchpad and read with `<` (ruling F81), which ran with no prompt and no refusal; with no scratchpad named, to `.wheelhouse/front-desk.json`, which its own allow rule lets the front desk write (ruling F85), and which ran with no prompt too. The scratchpad comes first because it needs no rule and is outside the project. In the `with` runs of the file form, no command of the front desk's was refused. The playbook uses no environment prefix, and `${CLAUDE_PLUGIN_ROOT}` in a skill's text reaches the session as the plugin's full path (tried in `claude -p`), so the path the session types is the one the rule names. Not tried on Windows, where there is no sandbox. The settings writer was not changed.

**(b) Does the rule's `:*` end at a word boundary?** Yes. The command `node "<root>/scripts/frontdesk/cli.js"x …` shares the whole of the rule's prefix, closing quote included, and the shell joins it into the path `cli.jsx`; it was refused. (The first probe, `node "<root>/scripts/frontdesk/cli.jsx" …`, did not test this: its `x` comes before the closing quote, so the prefix differs as written.)
