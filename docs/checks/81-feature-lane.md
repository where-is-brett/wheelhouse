<!-- docs/checks/81-feature-lane.md -->

# Check 81: one real two-slice feature run (part 4.4)

**Answer:** Yes. On real Archon, one feature went from an approved design to merged and switched on:
- slice 1 became pull request #5 and slice 2 became #6, each built, reviewed, signed "ready" and merged by the merge queue;
- the feature's own run opened #7, which turns the switch on;
- after the switch-on approval and an answer to the queue's question, the merge queue merged #7;
- the feature's report says "merged".

Seven defects stopped the run on the way. Six pull requests went after them (#138, #139, #140, #147, #148, #149), and all six are merged, but one defect was only half mended. #140 gave the merge queue its inputs. The work item's repository shape was mended in commit `cf25acc8`, made after #140 merged, so that commit never reached `main`, v0.2.0 carries the fault, and #182 mends it. Claude spend was about $6.30 of the $8 ceiling, and no Copilot was used.

Three things the director meets were asked twice or unclearly:
- The merge queue asked a level 3 question about #7 after its switch-on was already approved.
- That question doesn't name its pull request.
- A task can end with its test still failing and raise no question.

## Question

Part 4.4's end-to-end check (Archon design, section 7.2): does one feature of two slices go from an approved design to merged on real Archon? The slices are built one after the other, each merged by the merge queue before the next starts. Then the feature's own run turns the switch on behind the director's approval. The limits were $8 of Claude use and no Copilot. The pinned kits were installed at project scope for the trial's folder only and removed when the run ended.

## Tested on

30 October 2026, on macOS (arm64):
- **Code:** main with each fix branch in turn; the last runs had #147, #148 and #149 in.
- **Engine:** Archon v0.13.0 built from source with Bun 1.4.3, installed by setup's `installEngine` into a scratch Wheelhouse home, with telemetry off.
- **Project:** the throwaway private repository `where-is-brett/wheelhouse-merge-trial`, set up as check 80 left it.
- **Steps:** Claude Code on the Mac's subscription.

## Method

`WHEELHOUSE_HOME=<short home> node probes/81-feature-lane/run.js seed`, then `… run --ceiling <what was left>`.

**`seed`** writes what the First Mate and the director's clicks would:
- a design, `docs/designs/card-81.md`, with its slices block: a greeting with a formal form behind the `formal-greeting` switch, in two slices (greet by name, then say goodbye), with `demo: 'end'`;
- the design committed to `main`;
- the feature lane as a confirmed setting;
- the work, and the director's approval of the design.

**`run`** starts the real helper, with the real GitHub adapter and Archon, and leaves the rest to its own dispatcher. The probe only watches. It stands in for CI (a `ci` success on each open pull request's head and on main) and for the director's switch-on click. It signs that click only for the card naming the feature's own pull request at its head. Past 90% of the ceiling it would set All stop.

**Not stood in by the probe:** the merge queue's level 3 question about #7. That was answered by hand with a signed answer record, "Merge at e320581", the card's own recommendation and what the switch-on approval had already said.

**The pinned kits.** With the director's yes, `superpowers` and `mattpocock-skills` were installed from the `wheelhouse` marketplace at project scope, for the trial's folder only. When the run ended:
- both were uninstalled with `claude plugin uninstall … --scope project`;
- the folder's `.claude/settings.json` was put back from git;
- `~/.claude/plugins/installed_plugins.json` then held no entry for the folder.

**By hand.** `probes/81-feature-lane/reach.js` runs one sandboxed Claude step in the merge queue's folder, with a run's environment, and reports which `gh` it reaches.

## Evidence

| Where it stopped | Defect | Fix |
|---|---|---|
| Slice 1, plan step: "plan has no tasks" ($0.06) | The run's overlay named the engine's folders through a link (`/tmp`). The sandbox matches by real path, so the run's own artefacts never opened and `order.json` couldn't be read | #138: the overlay lists each sandbox folder by both spellings |
| Slice 1, task loop: every task used all its rounds | A task's own test, named for Node's runner, never ran alone, so its check never passed | #139: a named test runs alone under Node's own runner |
| Slice 1, controls step: held every slice | The switch steps couldn't fetch the run's ticket | #139: the switch steps get the run's ticket |
| Merge queue: failed at once, every time | Archon's merge queue was started with no `repo_host`/`repo_path`, and the work item named its repository in a shape Archon skips | #140 for the inputs. The shape's mend, `cf25acc8`, was committed after #140 merged and never reached `main`; #182 mends it |
| Merge queue: claimed #5, but its gate couldn't reach the helper (about $0.27 a sweep) | Archon runs the gate in its `sweep` AI step's shell, in the project folder, under Standard's settings with the sandbox on. The broker's connection to the helper's socket was refused (EPERM) | #147: the queue runs in Wheelhouse's own checkout of the mirror, under the engine folder, whose settings open only the helper's socket. The project's own settings never change; uninstall and teardown remove the folder |
| Merge queue in its folder: "project registration failed", then the broker refused "a folder that isn't a registered project's", then the sweep's `gh` was denied | Archon needs `--project mirrors/<slug>` to run in place. The broker didn't place the queue folder as its project's. Standard's `Bash(gh:*)` deny held in the queue folder too | #148: `--project mirrors/<slug>`, and the queue folder placed as its project's, by the broker and by the tool guard. The deny is lifted in the queue folder's settings only, under the conditions below |
| Slice 2 never started after #5 merged | Archon's run-ended event carries `pr: null`, so no run record named slice 1's pull request and the feature tick never asked whether it had merged | #149: the end record takes its pull request from the helper's own record of what the run opened, and the feature tick reads older records the same way |
| The probe never signed the switch-on | A paused run's records name no pull request | Probe only: it reads the helper's own record of what each feature run opened |

**`gh` in the queue folder (#148).** The deny is lifted there only, and these hold:
- The first `gh` on a run's PATH is the broker's, so a bare `gh` is always the broker.
- Any other `gh` on PATH finds no sign-in:
  - no token variables pass;
  - `GH_CONFIG_DIR` points at a folder that isn't there;
  - the sandbox denies the config folder, the keychain and those variables.
- The tool guard refuses `gh` named by a path (`/opt/homebrew/bin/gh`, `./gh`, `env /usr/bin/gh`) and `gh`'s variables set inline.
- The broker passes reads, merges and re-runs scoped to the project's repository, plus `pr edit --body-file` for a queued pull request from the sweep's own artefacts file.
- Any other queue call is refused and written to the Logbook.
- Merging still needs the signed approval.

By hand, in a sandboxed step in the queue folder, `which -a gh` found only the broker's shim, and Homebrew's signed-in `gh`, called by its full path, was not signed in. A sandbox read-deny on a binary doesn't stop it running on macOS. So the defence is PATH plus no credentials, not the deny.

**The run.**
- **Slice 1:** three tries as the fixes went in. Then pull request #5, with clean signed reviews, the stand-in CI green, and a signed "ready". The merge queue merged it from its own folder at ff0e2bf.
- **Slice 2** (run 9ed33c1c, $1.40): pull request #6, merged by the queue at 5546871.
- **The feature's run** (c31187ce, $0.80, 16.9 minutes): opened #7, which turns `formal-greeting` on, and paused on the switch-on card naming #7 at e3205810b744. The probe signed the approval and the run ended.
- **The merge queue:**
  - its next sweep (74533127, $0.28) asked a level 3 question about #7 ("it changes a schema, permissions or something the rules keep for a person");
  - after the answer, its ruling step recorded "merge", but the follow-up queue run it tried to start did not start;
  - the probe's next sweep (cfc887ac, $0.24) merged #7, and main's `ci` went green at b0c8cdc.
- **The report:** `{"work":"card-81","outcome":"merged","pr":7,"summary":"Switched on, with every slice added."}`.

**The midpoint demo** doesn't apply: the design's demo was `end`, so the only demo is the feature's own at the end.

**Spend:**
- $1.93 before the pause on the merge gate;
- $4.35 since: slice 2 $1.40, the feature's run $0.80, seven merge-queue sweeps that ran a model $2.15;
- about $0.02 of by-hand probes.

That is about $6.30 in all, under the $8 ceiling. The merge queue's sweeps were about a third of the whole check's spend. No Copilot was used.

**Seen, not changed.**

- **Two questions for one decision.** The director approved #7's switch-on at its head, then the merge queue asked again at level 3, holding every ready pull request until answered. The queue's card says "this pull request" without its number or title.
- **The ruling's follow-up run.** After the answer, Archon's ruling step couldn't start its own follow-up queue run ("archon-merge-queue did not start"). The helper's next sweep picked it up, so nothing was lost but time.
- **A task can end red.** A task can finish with its own test still failing and raise no question.
- **Allow rules in a fresh worktree.** Claude Code ignores a project's `permissions.allow` entries in a workspace that hasn't been trusted, and every fresh run worktree is one. So the overlay's `Read(…)` rule never applies, and a step reads its order through the shell, as every real run did.
- **Pull request #4** in the trial repository, check 80's, was left open in the shape check 80 made. The queue sweeps it while it is marked ready.
- **The probe's helper.** When a probe's helper was ended by its pid rather than closed, Archon's `workflow wake` process it started kept running; 13 were found and ended. A helper that closes ends its own, as the last run's did.

## What it means for the design

- The feature lane works end to end on real Archon: slices in order, each merged before the next, then the feature's run and its switch-on approval.
- Every one of the seven defects is in how real Archon and Claude Code behave: links in sandbox paths, `pr: null` on a run's end, the merge gate inside a sandboxed AI step. The fake engine and the stood-in hosts hid them. Each fix has a test that failed first.
- The merge queue now runs in a folder of Wheelhouse's own. The project's Standard settings are unchanged, and `gh` there reaches GitHub only through the broker.
- The double ask for a switch-on pull request costs the director a second click, and holds the queue while it waits. It is a design question, not a defect.

### After the check

Each "seen, not changed" item was settled on 30 October 2026 (`docs/superpowers/plans/2026-10-30-check-81-findings.md`):

- **A task can end red: fixed, HIGH.** A task's loop closes on its last round whatever the reason, and the lane's close asked only about unticked tasks. So a ticked task with its test red, changes uncommitted, or a review still holding, closed clean, and no step after it runs that test. The close now looks again at every ticked task. One that didn't end brings a card and is unticked, so the fresh run builds it.
- **Two questions for one decision: fixed.** The queue's question about a feature's own pull request is answered with the director's signed approval when that approval names exactly the head the queue asked about. A changed head is asked about again. The gate is unchanged.
- **The queue's card names its pull request: fixed.** By number and title.
- **The ruling's follow-up run: fixed in Wheelhouse.** Archon's start keeps no reason (`docs/engine/archon-upstream-note.md`), and the same start worked on a copy of the engine's database, so what refused it is unknown. The helper now starts the queue on the first tick after a ruling to merge.
- **Allow rules in a fresh worktree: documented, with one change to the steps' rules.** See below.

**Why the allow rules don't apply, and what that costs.** Claude Code reads no `permissions.allow` from a project's settings until its folder is trusted, and Archon's worktrees come from the engine's mirror, which nothing ever trusts. Trust is the director's own to give, folder by folder, so Wheelhouse doesn't set it. A plugin's `PreToolUse` hook answering `allow` does work there (check 75), and the tool guard answers it for a file tool call wholly in the step's own run's artefacts. Shell reads are the sandbox's, which the run's overlay opens. So nothing a run needs is blocked.

That is not what check 81's steps show, because they didn't run that guard. Archon loads `wheelhouse@wheelhouse` as installed, and this computer's install was 0.1.2, which is older than the guard's `allow` and has none of the review skills (`claude.skills_unresolved` in the steps' logs). Their file tools were refused in the artefacts and they used `cat`. Three steps in run 9ed33c1c instead went on without the order at all. The shared rules now say to read it with `cat`, and to take the blocked exit if it still can't be read. A release has one version of the plugin and the pack, so this mismatch is a check's, not a director's. A later real run should load this repository's plugin, so the guard's `allow` is seen working end to end.

## Needs the director

Nothing for this check.

Left in place:
- The trial repository keeps check 81's design commit and pull requests #5, #6 and #7, merged, on `main`. It was not deleted.
- The scratch home, engine and project checkout are in the session's scratch folder, with the links under `/tmp` (`wh80`, `wh80-engine`) that check 80 made. They go to the Trash once the main session has read this note.
- Claude Code's transcripts of the runs' steps are under `~/.claude/projects/`, as for check 80.
