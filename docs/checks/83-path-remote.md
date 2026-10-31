<!-- docs/checks/83-path-remote.md -->

# Check 83: a lane on a folder with only a path remote

**Answer:** Yes. Archon v0.13.0 makes a worktree, runs its steps, takes an agent's commit and pushes it on a folder whose only remote is a plain path, with `worktree.remote` naming it, so the made-up https fallback isn't needed. Three things differ from what the plan expected. Archon names such a project after the last two parts of the path, not `_local`; `_local` applies only with no remote at all, and that case can't run a lane. That helps: a mirror at `mirrors/<project>` gets the same workspace name it has on a hosted project. Clean-up refuses until the merge has been fetched into the folder, and after a squash it refuses even then, so the local queue checks the work itself and uses `--force`. The lane run was one of the quick lane's shape, not the pack's own `wheelhouse-quick`, which needs a helper that knows a local project (part 5).

## Question

Spec section 5.3 and facts A10 and A11: does a real lane run on a folder with only a path remote? The worktree, the commit, the artefacts, what Archon names the project, and clean-up, with `worktree.remote` naming the path. If it fails, the fallback is a made-up https address with an `insteadOf` rule, and part 5 uses that.

## Tested on

31 October 2026, on macOS 27.0.1 (arm64) with Node.js 22.22.1, and Archon v0.13.0's compiled binary and Bun 1.4.3 from `probes/lib/archon.js` (scratch home, telemetry off). The agent step ran on the small model at low effort, on the Mac's subscription, at under $0.01 a run.

## Method

`node probes/83-path-remote/run.js none path`. Each scene is a scratch project under the temporary folder.

- **The folder.** `git init` on `main`, a small module with one test, `.gitignore` holding `.wheelhouse/`, and `.archon/config.yaml` with `worktree.path: .wheelhouse/worktrees`, `worktree.remote: wheelhouse` and `worktree.baseBranch: main`.
- **The remote.** `git clone --bare --no-hardlinks` beside the folder, as the design's mirror, and `git remote add wheelhouse <path>`. No `origin`, and no other remote.
- **The lane.** A workflow of the quick lane's shape, `check-83-quick`: a bash step writes the order into `$ARTIFACTS_DIR`; one agent step reads it, changes the code, adds a test and commits; a bash step runs the done check, confirms a clean tree and lists the commits; a bash step pushes to the path, standing in for `host.push`.
- **Clean-up.** `archon complete <branch>` before the merge. Then the branch is moved onto the mirror's `main`, the folder fetches, and `archon complete` runs again.
- **The control.** The same scene with no remote and no `worktree.remote`.

The pack's own `wheelhouse-quick` was not run. Its steps reach the helper's routes, and the helper can't yet hold a local project; `tests/e2e/git-alone-build.test.js` (part 5) and the counted evaluation (part 10) cover that with real parts. This check answers the one thing that could change the design: what Archon does with the remote.

## Evidence

| Step | Result | What showed it |
|---|---|---|
| No remote at all (the control) | Refused, as A10 says | "Could not create isolated workspace (Cannot determine git remote … no git remote is configured …)". The run was recorded as failed; no worktree |
| Worktree on the path remote | Works | `<project>/.wheelhouse/worktrees/<branch>`, on a new branch from `main`; `worktree.path` was honoured |
| Base branch | Works | `$BASE_BRANCH` read `main` |
| Agent's commit | Works | One commit on the branch, in the folder's own `.git`: `git worktree list` showed it there, and `main` did not move |
| Done check | Works | 2 tests, 2 passed. The bash steps have only what `PATH` gives them: the first try failed with `node: command not found` until Node's folder was added |
| Artefacts | Works | `<archon home>/workspaces/<parent>/<name>/artifacts/runs/<run id>/order.txt` |
| Push to the path | Works | The mirror gained the branch at the commit, and `main` stayed put |
| Run's end | `completed` | `workflow runs` read `completed`; "Workflow completed successfully" |
| Project's name | `<parent>/<name>` of the path | `project list`: name and key `path-mvvyrnqs/mirror`, for a mirror at `…/path-mvvyrnqs/mirror.git`. `_local/project` appeared only for the scene with no remote |
| `complete` before the merge | Refused | "Blocked … 1 commit(s) unique to this branch. Use --force to override." On a failed run it adds "run … is failed" |
| `complete` after moving the mirror's `main`, no fetch | Refused, the same way | It reads the folder's tracking ref, not the mirror |
| `complete` after a fetch | Works | Exit 0. The worktree and the local branch went. `.wheelhouse/worktrees` stayed, empty. The mirror's branch stayed: "Remote branch retained … inspect the push destination before deleting it manually" |

`complete` calls `gh pr list --head <branch>`. With no `gh` on the path that call fails, is logged as `isolation.complete_pr_check_failed`, and doesn't stop it.

### Clean-up after a squash

`node probes/83-path-remote/squash.js`, 1 November 2026, on the same machine and Archon. A workflow of bash steps alone makes one commit in Archon's worktree, so no model ran. The scratch Archon has no provider, which bash steps don't need. The branch is pushed to the mirror, and the squash is a new commit on the mirror's `main` holding the branch's tree.

| Scene | `archon complete` | What was left |
|---|---|---|
| Squashed and fetched | Refused: "1 commit(s) unique to this branch. Use --force to override." | The worktree and the branch |
| Squashed, `--force` | Exit 0 | Neither. The mirror's branch stayed |
| Never merged, `--force` | Exit 0 | Neither: the commit is gone from the folder |
| A commit after the squash, `--force` | Exit 0 | Neither: that commit is gone |
| An uncommitted change after the squash, `--force` | Exit 0 | Neither: the change is gone |
| A file git doesn't track after the squash, `--force` | Exit 0 | Neither: the file is gone |

Archon compares commits, not contents, so a squash always reads as unmerged. `--force` asks nothing at all about what it removes.

### What was not tested

- The pack's `wheelhouse-quick`, the helper's routes and the real engine built from source with Wheelhouse's patches (see Method).
- Many runs, or a run on a folder with uncommitted work.
- A mirror refreshed from a home: this mirror was cloned from the folder.

## What it means for the design

- **Sections 3 and 5.3 stand.** A10 holds: a path remote is enough, so part 5 builds the folder remote as designed and the fallback isn't needed.
- **A11 needs a narrower reading.** `_local` is only for a repository with no remote, which can't run a lane anyway. With the design's remote, the project is named from the path. The engine's mirror lives at `<engine>/mirrors/<project>`, so the workspace is the `mirrors/<project>` that `artefactsOf` and `--project` already name, and part 5 changes neither. This is good news but worth a test: a mirror moved to a path without that shape would land the artefacts where `artefactsOf` doesn't look.
- **Part 5's folder remote needs a fetch after each merge,** or `archon complete` refuses a branch moved onto the main version. The local queue (part 6) fetches the home into the folder when it brings the folder up to date.
- **A squashed branch takes `--force`, and only behind Wheelhouse's own look.** `--force` would take unmerged work as readily as merged. Before it, the helper confirms that the change merged, that the branch's tip is within the head that merged, that the worktree has nothing uncommitted, untracked or left unfinished, and that no run is using the branch. Anything else stays in the folder, with one line on the Logbook. Removing the worktree by hand would leave Archon's own record of it behind, so `--force` it is.
- **Each merged branch stays on the mirror** until the helper removes it, as Archon says. The mirror is disposable, so part 6 can drop it after the merge.
- Nothing here goes to the director as a card.

## Needs the director

Nothing. Every step was done by an agent. The scratch projects and the scratch Archon's workspaces under the temporary folder went to the Trash when the part's checks ended.
