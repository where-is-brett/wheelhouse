<!-- docs/superpowers/plans/2026-10-30-archon-part-4-8-scenarios-20-35.md -->

# Part 4.8: the build-loop scenarios 20 to 35 against the pack

**Goal.** The Archon design (`docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, the evaluation runner's row and section 18) says the build-loop scenarios 20 to 35 are rewritten against the pack, played on the fake engine in tests and on real Archon in the counted evaluation. Each kept scenario keeps what it proves, and no pass is made weaker.

## How the two versions live side by side

The old scenarios are sessions of the old engine: a feature session under the brief, or the front desk. GitLab projects stay on the old engine until v0.3.0 (design, section 17), and the Thoroughness readiness bar (20, 21, 22, 23, 27's bug leg, 33 and 34) is judged from their records, so they stay as they are until v0.3.0 removes the old engine and its tests.

The rewrites are new scenario files numbered 100 above the old: **1NN rewrites NN** (120 rewrites 20, and so on). A file that has an engine play always plays it (`scripts/eval/run.js`), so an engine play can't sit in the old file without ending its session; a number of its own keeps both runnable with no change to the runner, the readiness check or the summary. `npm run eval -- 20` runs the old session; `npm run eval -- 120 --engine fake` (or `--engine archon`) the rewrite; `--suite build-loop --engine archon` picks every rewrite up with the other engine scenarios. In v0.3.0 the old files go and the rewrites keep their numbers.

## Per scenario

| Old | What it proves | Decision | New |
|---|---|---|---|
| 20 | Fix rounds stop at three; the open finding goes to the director as one question, with no fourth round | **Rewrite** as an engine play. The review loop's own counting (`review-round.js`, from Archon's record) closes the loop on round 4, the fourth review after three fixes, with the finding still open; the helper signs FINDINGS from the record and posts no verdict; the held run gives one card, naming the open finding, that the router never answers itself. The card did not name the finding: `review-held` said only that a review found a problem. So the sign step now says which (`review-sign.js` prints `question`, from the findings the helper signed), and `review-held` asks it | 120 |
| 21 | Fixes after the last review are reviewed again; the pull request's last review is on its head | **Rewrite** as an engine play on the helper's routes: reviews that read a commit before the pull request's head are refused and nothing is posted; the round that read the head is signed CLEAN at it, and the verdict is posted once | 121 |
| 22 | A choice users would see is put to the director at level 3, not ruled on; the work pauses | **Rewrite** as an engine play: every agent step of every workflow has the blocked exit at level 3 or 4, and the rules every step reads say a choice users would see is level 3; a quick run's level-3 ask about the price format becomes one card with the step's options, nothing answers it, nothing starts, and the director's click is what goes back | 122 |
| 23 | Finishing opens one pull request through the helper; no merge, no menu | **Rewrite** as an engine play: the pull-request step pushes the run's own branch and opens one pull request through the helper, and nothing merges; no workflow but fix-main has a merge step (fix-main's goes through the helper's own gate, 60 to 62); a run that finishes, not shown first, asks the director nothing | 123 |
| 24 | Wheelhouse's rules win over Superpowers' start-up text | **Rewrite** as a pack check: no step names a plugin but Wheelhouse's or a skill outside it, so `using-superpowers` never reaches a step through the pack, and every step that could hand a choice back has only its blocked exit to do it with. Whether a director's user-scope Superpowers reaches a real step is for a real play; it isn't written, as it can't be made deterministic here (left as a follow-up) | 124 |
| 25 | The front desk splits three requests and joins the duplicate | **Kept as it is.** A front-desk session; section 18 leaves those unchanged, and it reads nothing of the build | — |
| 26 | "Make the export CSV" while the export builds: route 3, the amendment and its card, nothing built | **Front desk kept as it is;** its build half, run for the old engine in `tests/e2e/build-loop.test.js`, is **rewritten** as an engine play: the changed design starts nothing while slice 1 builds; the director's click on the amend card lets the next slice start from the changed design | 126 |
| 27 route | The front desk sends a bug down route 4 | **Kept as it is** (front desk) | — |
| 27 bug | The bug is reproduced by a failing test before any fix | **Rewrite** as an engine play: the bug lane's red step, on the evaluation's bug project in real git, takes a test-only commit that fails, and refuses a commit that also changes the product, a branch whose fix came first and a test that passes. The implement step runs only once the reproduction is kept (64 and 67 cover the keeping) | 127 |
| 33 | The implementer's model is the routing table's, not the session's own | **Rewrite** as an engine play: the project's routing table reaches the run's work order as tier bindings and Archon's `--model` values, every tier a building step names is bound, and no step names a model itself. A real play reads Archon's record of a real step's model and wants the world's bound one | 133 |
| 34 | The task's review is the read-only reviewer's, and no review writes | **Rewrite** as an engine play: every review step of every workflow, in loops too, denies Write, Edit and NotebookEdit and runs on the pack's own review prompts; and a change a review made reaches no signed review, since the helper signs only reviews of the pull request's head. The design gives review steps a shell for reading (section 7.5), so a review's commands are no longer counted against it; what it changed is | 134 |
| 35 | The front desk records an approved design as work, and writes no plan | **Kept as it is** (front desk). Its hand-off to the build is already the engine's: 70 starts slice 1 from the approved design, 75 starts nothing from a design changed since | — |

## Tasks

1. The card for a held review names its findings: the helper's review route gives the findings it signed, `review-sign.js` prints `question`, and `review-held` asks it in every workflow. Test first.
2. Scenarios 120, 121, 122, 123, 124, 126, 127, 133 and 134, each with its `with` variant alone, recordings in `engine-recordings.js` where a step can't be made to ask on cue.
3. `tests/scripts/eval/scenarios-120-134.test.js` plays them on the fake.
4. `docs/evals/build-loop.md`: the rewrites' section, and the deferred note replaced.
5. `tests/scripts/eval` passes; an independent review of the branch.
