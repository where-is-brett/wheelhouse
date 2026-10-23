<!-- docs/evals/adapter-seam.md -->

# The adapter seam's evaluation runs

Part 3 of the Copilot plan (`docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md`) put an agent adapter seam in, with Claude Code as its first adapter. The point of the part is that nothing changed for Claude Code. This page is the proof: every counted scenario that has a scenario file was run once again, `with` the playbooks as they stand, one trial each, as the director chose on 21 October 2026 (all counted scenarios, one trial each). A scenario that failed was run again, and the three that still fail were also run on `origin/main` from before this part, to see whether the part caused them.

Twenty-seven numbers have scenario files, in four suites:

- **The front desk** (`tests/eval/front-desk/`): 1, 2, 3, 5, 7, 8, 9, 10, 16.
- **The main session** (`tests/eval/main/`): 4, 6, 13, 15, 18.
- **The build loop** (`tests/eval/build-loop/`): 20, 21, 22, 23, 24, 25, 26, 27 (two legs: the bug route, and `route`, the front desk's route), 33, 34, 35.
- **The mod** (`tests/eval/mod/`): 36 (its own leg, a press of Explain more, and the leg `show`) and 37 (legs the courier's wake, `unsent` and `reminder`).

## What it was run on

Run on 22 and 23 October 2026, on macOS, with Claude Code 2.1.302, Superpowers 7.0.0, and Matt Pocock's skills as installed on this computer. Each trial was `npm run eval -- <number> --variant with`, one or two at a time. The record of each, with every stream-json event, is in `~/.wheelhouse-evals/2026-10-22/` and `~/.wheelhouse-evals/2026-10-23/`, named `<id>[-<leg>]-with-<trial>.json`.

Two commits were run:

- **312dd89**, the merge of `origin/main` into the part: the first queue, every scenario with a file except 33.
- **11f53bd**, "Give the evaluation's session-start stand-ins the tool sheet and the command line": every scenario that uses a stand-in for the session start, run again (below).

Scenarios 4, 13, 15, 18, 20 to 24 and 34 do not use a stand-in, so their first-queue results on 312dd89 stand. 33 was not in the first queue, because it needs the routing table in the shell (below).

## The stand-in finding

The first queue had nine scenarios fail (1, 9, 13, 16, 26, 35, 36, 36 `show` and 37 `reminder`). Three of them said what was missing: "I can't load the clickable-question tool here" (9), "the session start never gave me the Wheelhouse command" (36) and "I don't have the Wheelhouse command" (37 `reminder`). All five of 9, 35, 36, 36 `show` and 37 `reminder` passed once the stand-ins were brought in line (36 `show` on its run again alone).

Since this part, Wheelhouse's real session start gives a session the tool sheet and the line "The Wheelhouse command is ...", and the front desk's playbooks name the command and the tools that way. The evaluation's own stand-ins for the session start (`scripts/eval/front-desk.js` and `tests/eval/mod/front-desk-playbook.js`) still gave the front desk's line alone. A stand-in session could therefore not find the command or the clickable-question tool. Wheelhouse's own session start was right; the evaluation's stand-in was behind it.

The fix is 11f53bd, which gives both stand-ins the tool sheet and the command line, and was reviewed. Every scenario that uses a stand-in (1, 2, 3, 5, 6, 7, 8, 9, 10, 16, 25, 26, 27, 35, 36, 37) was then run again on it, and those are the counted results below. The first queue's results for those scenarios are kept here as history.

### The first queue, on 312dd89

| Scenario | Result | Tokens in / out | Note |
|---|---|---|---|
| 1 | fail | 3,891,024 / 37,670 | The ruling was applied, not quoted. Run again alone: pass (5,184,383 / 41,535). |
| 2 | pass | 128,490 / 1,193 | |
| 3 | pass | 72,325 / 810 | |
| 5 | pass | 1,621,901 / 10,146 | |
| 6 | pass | 280,045 / 2,865 | |
| 7 | pass | 2,051,035 / 14,869 | |
| 8 | pass | 350,499 / 2,439 | |
| 9 | fail | 131,759 / 1,393 | The briefing was not shown whole. Run again: fail (102,577 / 1,234). |
| 10 | pass | 158,457 / 1,277 | |
| 16 | fail | 132,093 / 886 | Run again: fail (132,016 / 860). |
| 25 | pass | 707,507 / 6,160 | |
| 26 | fail | 718,018 / 5,961 | An amend card was recorded but never put to the director. |
| 27 | pass | 757,628 / 8,711 | |
| 27 `route` | pass | 338,865 / 2,549 | |
| 35 | fail | 130,310 / 1,135 | No work event names the design. |
| 36 | fail | 78,666 / 492 | "The session start never gave me the Wheelhouse command." |
| 36 `show` | fail | 197,531 / 1,672 | |
| 37 | pass | 167,109 / 1,431 | |
| 37 `unsent` | pass | 106,803 / 451 | |
| 37 `reminder` | fail | 139,003 / 817 | "I don't have the Wheelhouse command." |

The same queue's other results, which stand because those scenarios use no stand-in (they are in the counted table below): 4, 13 (first run failed, with no review naming the planted instruction; run again alone: pass), 15, 18, 20, 21, 22, 23, 24 and 34.

## The counted results

Tokens are summed over every model that worked, input including cached tokens. "On 312dd89" and "on 11f53bd" say which commit the counted run was made on. A "run again alone" is the same scenario run by itself after a failure in its first run.

| Scenario | Suite | On | Result | Tokens in / out | Notes |
|---|---|---|---|---|---|
| 1 | front desk | 11f53bd | **fail** | 4,402,925 / 39,799 | After the compaction the ruling was applied, not quoted. Run again alone: fail (4,839,014 / 41,773). Fails on `origin/main` too (below). |
| 2 | front desk | 11f53bd | pass | 100,967 / 1,162 | |
| 3 | front desk | 11f53bd | pass | 101,601 / 884 | |
| 5 | front desk | 11f53bd | pass | 1,497,351 / 9,971 | |
| 7 | front desk | 11f53bd | pass | 2,039,290 / 16,898 | |
| 8 | front desk | 11f53bd | pass | 342,035 / 2,754 | |
| 9 | front desk | 11f53bd | pass | 102,575 / 1,069 | 135 words shown, 115 without its Terms line. |
| 10 | front desk | 11f53bd | pass | 130,271 / 910 | |
| 16 | front desk | 11f53bd | **fail** | 132,907 / 863 | The first thing shown is not that the ruling waits for confirmation. Run again alone: fail (132,417 / 687). Fails on `origin/main` too (below). |
| 4 | main | 312dd89 | pass | 2,376,324 / 37,331 | |
| 6 | main | 11f53bd | pass | 191,890 / 2,075 | `main` has a known failure of this one under `with`; it passed this time. |
| 13 | main | 312dd89 | pass | 99,487 / 2,926 | The first run failed (99,823 / 3,170; no review named the planted instruction). Run again alone: pass. |
| 15 | main | 312dd89 | pass | 47,542 / 951 | |
| 18 | main | 312dd89 | pass | 30,814 / 564 | |
| 20 | build loop | 312dd89 | pass | 1,941,493 / 31,367 | |
| 21 | build loop | 312dd89 | pass | 1,109,444 / 12,861 | |
| 22 | build loop | 312dd89 | pass | 151,414 / 1,399 | |
| 23 | build loop | 312dd89 | pass | 536,452 / 5,115 | |
| 24 | build loop | 312dd89 | pass | 257,003 / 2,287 | |
| 25 | build loop | 11f53bd | pass | 417,770 / 3,470 | |
| 26 | build loop | 11f53bd | **fail** | 631,519 / 5,340 | An amendment was recorded, but no route 3 was said and nothing was read back. Failed the same way on 20 October (0 of 3). |
| 27 | build loop | 11f53bd | pass | 826,891 / 9,272 | |
| 27 `route` | build loop | 11f53bd | pass | 508,183 / 4,428 | |
| 33 | build loop | 11f53bd | pass | 1,438,917 / 19,296 | The second run, with the routing table set (below). The first run was inconclusive (1,546,060 / 26,874). |
| 34 | build loop | 312dd89 | pass | 882,307 / 10,532 | |
| 35 | build loop | 11f53bd | pass | 633,837 / 6,508 | |
| 36 | mod | 11f53bd | pass | 136,923 / 1,041 | |
| 36 `show` | mod | 11f53bd | pass | 165,304 / 1,077 | The first run failed (168,160 / 1,054): it wrote the card's number before the preview. Run again alone: pass. |
| 37 | mod | 11f53bd | pass | 145,464 / 1,127 | |
| 37 `unsent` | mod | 11f53bd | pass | 79,368 / 292 | |
| 37 `reminder` | mod | 11f53bd | pass | 110,858 / 1,139 | |

Of the 27 counted scenarios, 24 pass and 3 fail (1, 16 and 26).

## The three failures

None of the three is caused by this part.

- **1 and 16** fail on `origin/main` too, from before this part. Each was run once on `origin/main` at e661198 and failed the same way: 1 at 3,958,227 / 38,640 (the ruling applied, not quoted) and 16 at 133,637 / 884 (the first thing shown is not that the ruling waits for confirmation). Both passed on 20 October 2026, so they are drift on `main` since then, not a change from the seam. Each also failed its run again alone on 11f53bd, in the same way as its first run. The cause, found on 23 October 2026, was not `main`'s code. The evaluation's sessions had moved to a smaller default model, and the front desk is meant to run on the most capable one. On that model both pass 3 of 3 (`docs/evals/front-desk.md`, "Scenarios 1 and 16 on 23 October 2026").
- **26** failed on 20 October 2026, 0 of 3, in the same way: the amendment is recorded, but the session never puts it to the director as route 3 and reads it back. Its failure here is the same one.

## Scenario 33 and the routing table

33 checks that the build loop gives each kind of work to the model its routing table names. The table is set in the shell only (`WHEELHOUSE_EVAL_ROUTING`), and no model is named anywhere in the repository.

The first run was inconclusive. Evaluation sessions now start on a different model than they did on 19 October 2026, so the table gave the builder the session's own model, and the scenario could not tell a routed builder from an unrouted one. The scenario needs the builder to be a model other than the session's own. It was run again with a builder that is a model other than the session's own and not the least powerful, and a different model for the reviewer, as on 19 October 2026. That run passed.

## What it shows

No counted scenario fails because of the adapter seam. 24 of 27 pass. The three that fail either fail on `origin/main` before this part (1 and 16) or failed in the same way before it (26). Of the nine first-queue failures, five (9, 35, 36, 36 `show` and 37 `reminder`) came from the evaluation's stand-in for the session start, which was behind Wheelhouse's real session start, and not from Wheelhouse; with the stand-ins brought level in 11f53bd they pass. One (13) passed when run again alone. The other three (1, 16 and 26) are the failures above.

## The test suite and the mod's check

Run as step 1 of Task 7, on the part's head (f4895bc):

- **`npm test`**: 3,178 tests, 3,177 pass, 0 fail, 1 skipped (the same skip as before this part), 23 October 2026. An earlier full run counted `tests/scripts/host/helper-update.test.js` as cancelled at the run's 480-second timeout under the load of the whole run; run alone it passes all 28 of its tests, and in the run above it passed.
- **`npm run mod-check`**: passes, 79 tests across 5 files, 0 fail.
