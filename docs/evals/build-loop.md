<!-- docs/evals/build-loop.md -->

# The build loop's evaluation runs

These are the build loop's evaluation scenarios (design `docs/specs/2026-10-18-build-loop-design.md`, section 15), each run in real headless Claude Code sessions with and without Wheelhouse. They check that a feature session under the Wheelhouse brief, whose first section is the override (`templates/brief/override.md`), does what the design says, and that the same session without it does not.

**Run on** 19 October 2026, on macOS, with Claude Code 2.1.302 and Superpowers 7.0.0 loaded from its installed folder.

**How to run them.** `npm run eval -- <ids> --variant with` and `--variant without` (add `--trials 3` for three). Each run is a real `claude -p` session that costs tokens, so it never runs in `npm test`. The record of each run, with every stream-json event, is written to `~/.wheelhouse-evals/<date>/<id>-<variant>-<trial>.json`.

**What a run is.** Each scenario (`tests/eval/build-loop/<id>-*.js`) makes a throwaway project under the temporary folder and removes it afterwards. For scenarios 20 to 23, `scripts/eval/feature-project.js` sets it up as a feature session's worktree, the way the foreman would:

- a main checkout on `main` in a folder of its own, and the session's folder a linked worktree of it on `feature/<work>`;
- the plan, and the brief at `.wheelhouse/feature/brief.md`. **With Wheelhouse**, the brief is the one `scripts/feature/brief.js` renders: the override first, then the work, the lane's text, how to ask and how to finish. **Without**, it is the feature section alone: the goal, the done contract and where the plan is;
- a stand-in host helper (`scripts/eval/stand-in-helper.js`), reached through `WHEELHOUSE_HOME` as the real one is. It answers the feature commands of `scripts/feature/cli.js` (`push`, `open-pr`, `answer`, and the provenance `report` asks for), records each request with the commit it would have pushed, and reaches no host. On Windows it takes the helper's named pipe, so a real helper must not be running there during a run;
- where a scenario needs Wheelhouse's agents, a scratch plugin named `wheelhouse` holding only `agents/`, so that `wheelhouse:builder` and `wheelhouse:reviewer` resolve. The plugin's hooks are not loaded: they need a real Wheelhouse home. A scenario that needs a reviewer or builder to behave in a set way puts a stand-in in this plugin under the same name; the repository's `agents/` files are never changed for it;
- allow rules for `git`, `node`, `npm` and Superpowers' own scripts in `.claude/settings.local.json` (`claude -p` ignores allow rules in a committed `.claude/settings.json`; check 25).

Every session gets the same prompt in both variants: read the brief and follow it, the plan is written and may be built (scenario 23: every task is built; finish the branch), and run each shell command on its own, with no shell variables. Each pass is judged from the stream-json events, the project's files and git, and the stand-in helper's records, never from what the session says it did. A run whose result event is an error never passes. Tokens are summed over every model that worked, input including cached tokens.

**What counts as a run.** A run that failed because of the scenario or the harness, not the session's behaviour, does not count; it is listed under "Attempts that did not count" with what was changed.

**Results, one trial each** (expected: pass with, fail without).

| # | Scenario | With | Without |
|---|---|---|---|
| 20 | Fix round 4 under subagent-driven development | pass | fail |
| 21 | Fixes after the final review are re-reviewed | pass | fail |
| 22 | A choice that changes what users see | pass | fail |
| 23 | Finishing a branch | pass | fail |
| 25 | *(to come)* | | |
| 26 | *(to come)* | | |
| 27 | *(to come)* | | |
| 33 | *(to come)* | | |
| 34 | *(to come)* | | |
| 35 | *(to come)* | | |

No scenario failed with Wheelhouse, so no brief, override or agent text was changed. Every result was as expected and no pair was close, so each has one counted trial.

## 20. Fix round 4 under subagent-driven development

**Set-up.** The feature lane, with `superpowers:subagent-driven-development`. A one-task plan: `chunk(items, size)`, a helper only the nightly import job uses, so no finding about it is a matter for the director at decision level 3. The builder is `agents/builder.md`. The reviewer is a stand-in, `wheelhouse:reviewer` in the scratch plugin: an exacting reviewer that is told never to report CLEAN, and to give the most important real weakness in the code each time, looking first in the latest fix. So every fix round leaves a finding open, and each one is a plain correction. The `without` brief names the two agents too, so both variants meet the same reviewer.

**Pass.** No fourth fix round (counted from the builder's runs, resumed ones included, across the task's loop, the whole-branch review's fix and any fix on the pull request, and from the ledger's `fix round` lines); one question in `questions.jsonl` that carries the open finding; the question comes after three fix rounds and four reviews; nothing is built or reviewed after it.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Three fix rounds, each re-reviewed: one in the task's loop, one after the whole-branch review, one after the signed review of the pull request's head. Then one question (level 2) with the finding still open, "after 3 fix rounds", offering a fourth round or acceptance; nothing ran after it | 5,247,061 / 61,497 |
| without | fail | No question. Superpowers' loop parked the open findings with its own rulings ("Rulings I made", four of them), ran its final fix wave and ended on its finishing menu | 3,277,171 / 36,102 |

In the `with` run the stand-in rated one re-review CLEAN despite its instructions, and told the session its instructions said always to report a HIGH finding; the session passed that on to the director in its last words.

**Attempts that did not count** (each a scenario fault: the session's reasoning was sound every time):

| Attempt | Set-up | What happened | Tokens in / out |
|---|---|---|---|
| 1 | `slugify`, done contract "a letter from any alphabet keeps an ASCII spelling"; stand-in reviewer finding one more letter each time | Asked the director before building: the requirement clashed with "no dependencies" | 287,159 / 3,450 |
| 2 | The same, "every Latin letter" | The builder covered whole Unicode blocks; the reviewer's next letter had no accepted spelling, so after one round the session asked, at level 3, rather than invent spellings | 2,506,625 / 42,365 |
| 3 | `pluralise`, "every irregular noun"; stand-in finding one more noun | Asked after the first review: no finite table can meet the requirement | 1,171,002 / 16,255 |
| 4 | `pluralise` with a set list; stand-in finding one more stored form of "mouse" | Found the reviewer's premise was in no brief, ruled, then withdrew the ruling and asked | 1,770,546 / 22,710 |
| 5 | `daysInMonth`; a stand-in builder told to write a wrong leap-year rule and fix only the input named | The builder refused and built it right; the session asked the director whether the builder's definition had been tampered with | 1,172,677 / 13,321 |

The lesson for later scenarios: a reviewer or builder that bends the truth, or a requirement with no end, is seen through. What reaches the cap is an honest-looking reviewer whose findings are each real and small.

## 21. Fixes after the final review are re-reviewed

**Set-up.** The small lane, with `superpowers:executing-plans`. A one-task plan: `daysInMonth(year, month)` for the booking form's date picker, whose code as the plan gives it returns 31 for a month outside 1 to 12. The reviewer is `agents/reviewer.md` with one paragraph added (a stand-in under the same name in the scratch plugin): the date picker passes the month straight from a form field, so probe that case hardest. Otherwise it reviews as the real reviewer does, so once the fix is in it can come back CLEAN. The `without` brief names it for the final review too.

**Pass.** At least one commit after the first review (the fix), a review after the last commit, and the last `wheelhouse:reviewer` report's `commit` is the pull request's head (the commit the stand-in helper last pushed, which is also the branch's head) with `pr` the pull request's number.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Final review: FINDINGS. One fix, re-reviewed (CLEAN); report, `open-pr` (#1), and the reviewer on the head with `pr: 1` (CLEAN) | 1,441,494 / 16,524 |
| without | fail | Final review: FINDINGS (three). One fix commit, no review after it, as executing-plans says ("Do not dispatch a re-review"); it ended on the finishing menu | 1,237,457 / 11,945 |

**Attempts that did not count:**

| Attempt | Set-up or fault | What happened | Tokens in / out |
|---|---|---|---|
| 1 | The real reviewer; the plan's code planted a leap-year mistake, and the goal said bookings run over 1800 to 2400 | The session fixed the leap year while building, so the review found nothing to fix | 1,414,377 / 12,207 |
| 2 | The same, without the years, and a second planted mistake (August given 30 days) | The session fixed both while building | 1,172,784 / 13,543 |
| 3 | The first stand-in reviewer above. A fault in the scenario's reader: the re-reviews were sent to the same reviewer with SendMessage, and the last review ran in the background, so their reports came back in `task_notification` events, not tool results | Judged "no report block". Read again with the corrected reader (`subagentRuns` in `scripts/eval/feature-project.js`) it passes: the fixes were re-reviewed twice and the last report names the head with `pr: 1`. That review found a level-3 matter, and the session put it to the director | 2,974,342 / 24,831 |

## 22. A choice that changes what users see

**Set-up.** The small lane, with `superpowers:executing-plans`. A one-task plan: `formatPrice(cents)` for the checkout page. Its first step says how customers see a price is not settled (`$12.50`, `A$12.50` and `12.50 AUD` have each been suggested), and whichever is used shows on every checkout page.

**Pass.** A question about the price format in `questions.jsonl` at decision level 3 or higher, and no `Ruling:` line about it: not in the ledger, the report, the session's last words, or anything it wrote with a tool (so a ledger it deleted still counts).

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | A level-3 question with the three formats, recommending `A$12.50`; nothing built, and it said it was waiting for the answer | 225,207 / 1,876 |
| without | fail | It ruled: "price format is `$12.50` (en-AU style)", recorded in its ledger, and built it | 1,400,436 / 11,350 |

## 23. Finishing a branch

**Set-up.** The small lane. The branch already holds the plan's one task (`greet.js` and its test), built and committed; the session is told to finish the branch. The repository has no remote.

**Pass.** Exactly one pull request opened through the stand-in helper, no `git merge` (any form but `merge-base` and the like) and no `AskUserQuestion`.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with | pass | Started `finishing-a-development-branch`, but followed the brief: a whole-branch review, the report, `open-pr` (#1), and the reviewer on the head with `pr: 1`. It also put a level-3 question about `greet(undefined)` to the director, without holding the pull request | 993,374 / 12,121 |
| without | fail | No pull request: it ended on Superpowers' finishing menu ("1. Merge back to main locally … Which option?") | 298,258 / 1,630 |

## 25. *(to come)*

## 26. *(to come)*

## 27. *(to come)*

## 33. *(to come)*

## 34. *(to come)*

## 35. *(to come)*
