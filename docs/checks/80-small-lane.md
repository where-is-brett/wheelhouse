<!-- docs/checks/80-small-lane.md -->

# Check 80: one real small-lane run (part 4.1)

**Answer:** Yes. On the fifth try, one small-lane run went from a work order to a pull request ready for the merge queue on real Archon: a plan, two tasks built in parallel, the checks, two clean signed reviews, the pull request's text, its signed verdict ("ready") and a lesson, in 2.6 minutes for $0.72. The four tries before it found six defects, each of which on its own stopped every real run on a fresh setup. All six are fixed (pull request #125). One gap remains: the steps ran with the Wheelhouse plugin at 0.1.2 for the account, not main's, so main's own skills and hooks were not tested inside the steps. Claude spend for the whole check was $0.88.

## Question

Part 4.1's end-to-end check (Archon design, section 7.2). Does one small-lane run go from a work order to a pull request ready for the merge queue on real Archon? The run was to be made from a fresh checkout of main, set up as v0.2.0's setup does, for at most $5 of Claude use and no Copilot.

## Tested on

30 October 2026, on macOS (arm64). The code was a fresh checkout of main at 6b857d85, and after each fix, the fix branch; run 5 ran main at 77ce7ef2, with the fixes in. The engine was Archon v0.13.0 built from source with Bun 1.4.3, by setup's own `installEngine`. It was installed into a scratch Wheelhouse home (`WHEELHOUSE_HOME`), and its pins checked out. Telemetry was off. The project was the throwaway private repository `where-is-brett/wheelhouse-merge-trial`, used before by check 76. Claude Code's steps ran on the Mac's subscription. The plan step ran on the mid-sized model.

## Method

`WHEELHOUSE_HOME=<short home> node probes/80-small-lane/run.js prepare`, then `… run --ceiling 5`. The home's path has to be short, because the helper's socket lives in it.

- **Setup's parts, as v0.2.0 makes them.** `engineChanges` and `applyEngine` installed the engine and the broker. On `main`, a setup-style commit added Archon's project settings, Standard's Claude settings, `.wheelhouse/` in `.gitignore` and a `package.json` for `node --test`; the policy file was already there from check 76. The probe also wrote the mirror rule, the registration with a quick GitHub connection, the signing key, the exclude line for this computer's settings, and the hello trial.
- **The run.** `startHelper` ran with the real GitHub adapter and `packedArchon()`. A small-lane work order went in: two functions, each with its own test. The probe then watched the records, the run's spend (with a cancel near the ceiling) and a stand-in CI status, as check 76 did.
- **The pinned kits.** For the fifth try, with the director's yes, `superpowers` and `mattpocock-skills` were installed from the `wheelhouse` marketplace at project scope, for the trial's folder only. The installs rewrote the project's `.claude/settings.json` in a layout of their own; as setup does, Standard's settings were put back with only the two `enabledPlugins` lines added, and that went up to `main`. Both were uninstalled when the run ended, and Claude Code's record of installed plugins then held no entry for the folder.
- **Not set up as setup would.** Setup's step that brings the Wheelhouse plugin for the account up to date was not run, by the main session's ruling. It stayed at 0.1.2, so the steps ran 0.1.2's hooks and lacked main's skills (`codebase-design`, `review-standards`, `review-spec`, `frontend-design`; Archon only warns about a missing skill). The review steps ran and signed, but without their skills. So the run did not test main's skills or hooks inside the steps.

## Evidence

| Try | Where it stopped | Defect | Fix |
|---|---|---|---|
| Hello trial | `could not run` | Archon refuses to make a worktree for a project with no remote. A run in the foreground prints no run id. The trial's read had no `--events`, so it held no step output | `--detach --no-worktree`, then read the run's record with `--events` until the run ends |
| Run 1 | The run failed in 3 seconds, at $0 | Nothing refreshed the fetch mirror before a run, so Archon's git found no repository at the mirror | The helper refreshes the mirror before the engine starts a run, and starts none when it can't |
| Run 1 | The helper saw the run as `unknown` | Archon refuses any command (`workflow get`, `cancel`, `attention`, `status`) outside a git repository, and the helper runs in none | An Archon command that names no project runs in `<engine>/place`, an empty git folder |
| Run 2 | No base branch | The mirror's `HEAD` named no branch Archon could take as the base | The mirror's `HEAD` names the host's default branch |
| Run 3 | `order` step: no ticket | Archon names a workspace after its remote, the mirror, so a run's artefacts are under `workspaces/mirrors/<owner>__<name>/`, not `workspaces/<owner>/<name>/`. The ticket went to the wrong folder | `artefactsOf` names the mirror's workspace |
| Run 4 | `plan` step: `order.json` couldn't be read | Nothing wrote the run's own settings overlay (`ownRunRules` was never called). In the engine's `acceptEdits` mode, a read outside the worktree needs a rule that allows it | The first step writes the overlay in the run's worktree, and the overlay allows reads of the run's own artefacts folder |
| Run 4 | `plan` step: every tool held | A lineage hold: the installed `superpowers` and `mattpocock-skills` differ from the manifest | Not a defect. Setup installs the pinned kits for the project; with the director's yes, run 5 had them |
| Run 5 | Ended `completed`: pull request #4 in the trial repository, ready | None | — |

Run 5, step by step: the helper lifted the earlier lineage hold once the kits matched. The plan step ($0.14) planned two tasks; the fan-out built them in parallel ($0.06 and $0.05); the tests and the controls passed with no repair; `review-standards` ($0.13) and `review-spec` ($0.06) each signed a CLEAN review of the head commit (the security and design lenses were not called for); the pull request's text ($0.18) gave a summary, the done check's evidence (5 tests, 5 passed) and its danger in merging; the run posted its signed verdict, "ready", contract complete; the level-2 order needed no approval; the lesson step cost $0.11. The pull request held four commits (the plan, each task, the plan taken out) and four files, and was mergeable, with the stand-in `ci` status green. It was left open: the merge queue itself was check 76's.

Spend: $0.72 for run 5, $0.143 for run 4's plan step, which ran out of options after the hold, and about $0.02 for five hello trials: $0.88 in all, under the $5 ceiling. No Copilot was used.

## What it means for the design

- The fake engine and the stood-in hosts hid all six defects, because each is in how real Archon v0.13.0 behaves: a repository it insists on, workspace naming, the mirror's `HEAD`, and permission mode. Each fix has a test that failed first, written to match what Archon did here.
- The fixes hold on a real run. Run 5's plan step read `order.json` through the overlay, and the run used the mirror's workspace, its `HEAD` and the empty git folder throughout.
- The small lane's own steps ran end to end on real Archon: the task fan-out, the checks, the review lenses, signing and the verdict. The review loop's repair path was not called for, since the first reviews were clean.
- A run's steps load the Wheelhouse plugin for the account, so a check of main's own skills and hooks inside the steps needs that plugin at the release under test.

## Needs the director

Nothing for this check. To test main's own skills and hooks inside the steps, the Wheelhouse plugin for the account has to be at the release under test, which writes a plugin entry in `~/.claude`; that waits for the director's yes.

Undo, which needs nothing from the director: the trial repository keeps check 80's two setup commits on `main` and pull request #4, open. It was not deleted. The scratch home, engine and project checkout are in the session's scratch folder, with two links under `/tmp` (`wh80`, `wh80-engine`) for the short socket path. They go to the Trash once the main session has read this note. Claude Code's transcripts of the runs' steps are under `~/.claude/projects/`, as for checks 75 to 77.
