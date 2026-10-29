<!-- docs/checks/80-small-lane.md -->

# Check 80: one real small-lane run (part 4.1)

**Answer:** Not yet. The run was stopped at the plan step, the first AI step of the lane. Getting there showed six defects, each of which on its own stopped every real run on a fresh setup. All six are fixed in the same pull request as this note. The step that stopped it is a lineage hold: the skills installed on this Mac differ from the pinned kits. Setup's next step would install the pinned kits, but that writes plugin entries in `~/.claude`, and so it waits for the director's yes. Claude spend was $0.16.

## Question

Part 4.1's end-to-end check (Archon design, section 7.2). Does one small-lane run go from a work order to a pull request ready for the merge queue on real Archon? The run was to be made from a fresh checkout of main, set up as v0.2.0's setup does, for at most $5 of Claude use and no Copilot.

## Tested on

30 October 2026, on macOS (arm64). The code was a fresh checkout of main at 6b857d85, and after each fix, the fix branch. The engine was Archon v0.13.0 built from source with Bun 1.4.3, by setup's own `installEngine`. It was installed into a scratch Wheelhouse home (`WHEELHOUSE_HOME`), and its pins checked out. Telemetry was off. The project was the throwaway private repository `where-is-brett/wheelhouse-merge-trial`, used before by check 76. Claude Code's steps ran on the Mac's subscription. The plan step ran on the mid-sized model.

## Method

`WHEELHOUSE_HOME=<short home> node probes/80-small-lane/run.js prepare`, then `… run --ceiling 5`. The home's path has to be short, because the helper's socket lives in it.

- **Setup's parts, as v0.2.0 makes them.** `engineChanges` and `applyEngine` installed the engine and the broker. On `main`, a setup-style commit added Archon's project settings, Standard's Claude settings, `.wheelhouse/` in `.gitignore` and a `package.json` for `node --test`; the policy file was already there from check 76. The probe also wrote the mirror rule, the registration with a quick GitHub connection, the signing key, the exclude line for this computer's settings, and the hello trial.
- **The run.** `startHelper` ran with the real GitHub adapter and `packedArchon()`. A small-lane work order went in: two functions, each with its own test. The probe then watched the records, the run's spend (with a cancel near the ceiling) and a stand-in CI status, as check 76 did.
- **Not set up as setup would.** Two steps of setup write plugin entries in `~/.claude`, and neither was run. The main session ruled that these wait for the director:
  - the user-scope Wheelhouse plugin stayed at 0.1.2, so the steps ran 0.1.2's hooks and lacked main's skills (`codebase-design`, `review-standards`, `review-spec`, `frontend-design`; Archon only warns about a missing skill);
  - the pack's kits were not installed for the project.

  So the run did not test main's skills or hooks inside the steps.

## Evidence

| Try | Where it stopped | Defect | Fix |
|---|---|---|---|
| Hello trial | `could not run` | Archon refuses to make a worktree for a project with no remote. A run in the foreground prints no run id. The trial's read had no `--events`, so it held no step output | `--detach --no-worktree`, then read the run's record with `--events` until the run ends |
| Run 1 | The run failed in 3 seconds, at $0 | Nothing refreshed the fetch mirror before a run, so Archon's git found no repository at the mirror | The helper refreshes the mirror before the engine starts a run, and starts none when it can't |
| Run 1 | The helper saw the run as `unknown` | Archon refuses any command (`workflow get`, `cancel`, `attention`, `status`) outside a git repository, and the helper runs in none | An Archon command that names no project runs in `<engine>/place`, an empty git folder |
| Run 2 | No base branch | The mirror's `HEAD` named no branch Archon could take as the base | The mirror's `HEAD` names the host's default branch |
| Run 3 | `order` step: no ticket | Archon names a workspace after its remote, the mirror, so a run's artefacts are under `workspaces/mirrors/<owner>__<name>/`, not `workspaces/<owner>/<name>/`. The ticket went to the wrong folder | `artefactsOf` names the mirror's workspace |
| Run 4 | `plan` step: `order.json` couldn't be read | Nothing wrote the run's own settings overlay (`ownRunRules` was never called). In the engine's `acceptEdits` mode, a read outside the worktree needs a rule that allows it | The first step writes the overlay in the run's worktree, and the overlay allows reads of the run's own artefacts folder |
| Run 4 | `plan` step: every tool held | A lineage hold: the installed `superpowers` and `mattpocock-skills` differ from the manifest | Not a defect. Setup installs the pinned kits, which waits for the director |

Spend: $0.143 for the one plan step, which ran out of options after the hold, and about $0.02 for five hello trials. No Copilot was used.

## What it means

- The fake engine and the stood-in hosts hid all six defects, because each is in how real Archon v0.13.0 behaves: a repository it insists on, workspace naming, the mirror's `HEAD`, and permission mode. Each fix has a test that failed first, written to match what Archon did here.
- The overlay fix is not yet checked on a real run. Run 4 also hit the hold, so whether its Claude step reads `order.json` now is still open.
- The small lane's own steps (task fan-out, checks, review loop, signing) are still unrun on real Archon. The next try needs the director's yes to two things: the user-scope plugin at the release under test, and the pinned kits for the project.

## Undo

The trial repository keeps check 80's setup commit on `main`. It was not deleted. The scratch home, engine and project checkout are in the session's scratch folder, with two links under `/tmp` (`wh80`, `wh80-engine`) for the short socket path. They go to the Trash when the next try is done. Claude Code's transcripts of the runs' steps are under `~/.claude/projects/`, as for checks 75 to 77.
