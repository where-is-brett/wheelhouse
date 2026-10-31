<!-- docs/checks/84-set-status.md -->

# Check 84: the real status path on GitHub

**Answer:** Partly. On the quick connection every leg passed once: `wheelhouse/checks` posted through the connection's `gh`, the gate read `pending` and waited, then read green, and Archon's own merge queue merged the pull request on a repository with no Actions. Fact A3 holds for this context name. `hasCi` read `false` before the first status and `true` after it, so the plan's first choice is needed: `whereChecks` must leave Wheelhouse's own status out. The narrow connection and what a missing `statuses: write` answers were not measured, since this computer holds no app key and the app has no such permission yet. Part 2 can go ahead, and those two legs go with the status permission card's real test.

## Question

Spec section 4.3, steps 2 and 9, and the plan's part 0. On a repository with no Actions: post `wheelhouse/checks` through the helper's connection, on quick and narrow; confirm the gate reads `pending` then `green`; merge one pull request through Archon's queue; record what a missing `statuses: write` answers, and what `hasCi` says after a status is posted.

## Tested on

31 October 2026, on macOS 27.0.1 (arm64) with Node.js 22.22.1, `gh` from Homebrew, Archon v0.13.0's compiled binary and Bun 1.4.3 from `probes/lib/archon.js` (scratch home, telemetry off), and the private trial repository `where-is-brett/wheelhouse-merge-trial`, which has no workflows. The repository's settings were not changed. The merge queue's agent step ran on the mid-sized model, as in check 76. Claude spend was $0.38 across three queue runs.

## Method

`node probes/84-set-status/run.js`, then `--resume <stamp> 8` for the last leg (see Evidence).

- **The connection.** `envForConnection` in `scripts/host/helper.js` gave the environment, as the helper does, and the real adapter (`makeAdapter`) read `ciState` and `hasCi` and opened the pull request. On quick that environment is empty: `gh` uses the director's own sign-in.
- **The status.** The line part 2 puts in the adapter: `gh api -X POST repos/{o}/{r}/statuses/{sha} -f state=… -f context=wheelhouse/checks -f description=…`.
- **The gate.** Check 76's stand-in broker and mirror, a work item in Archon's state store, the verdict comment and a permit, then `archon-merge-queue`, once with `pending` and once with `success`.
- **Trial settings.** The repository holds Standard's agent settings since check 80, and their sandbox shuts out the stand-in broker on localhost. They were taken out of the scratch checkout only. Check 81 ran the real broker's route under them.

## Evidence

| Leg | Result | What showed it |
|---|---|---|
| Before any status | `none`, and no CI | `ciState`: `none`. `hasCi`: `false`, as the workflows folder answers 404 |
| Post `pending` | Pass | Exit 0. GitHub answered `state: pending`, `context: wheelhouse/checks`, creator `where-is-brett` |
| Read after `pending` | Pass | `ciState`: `pending`. `hasCi`: **`true`** |
| Queue on `pending` | Pass, merged nothing | The run completed, with no merge call. The decision was "wait (clear)": "… waiting on pending CI wheelhouse/checks" |
| Post `success` | Pass | Exit 0, `state: success`. Posting `success` a second time, on the resume, added a second entry with the same context, and the rollup stayed `success` |
| Read after `success` | Pass | `ciState`: `success`. `hasCi`: `true` |
| Queue on `success` | Pass, merged | Decision "merged (clear)": "Ready at head, CI green, merges clean". Pull request 8 merged at `a09ae82`, by `where-is-brett`, on a repository with no Actions and no other check |
| Narrow connection | Not run | "The GitHub connection has no keys: sign in to the Wheelhouse app again". This computer has no app key |
| A missing `statuses: write` | Not measured | The quick sign-in has the `repo` scope, which includes statuses. The app's own key isn't here |

Three runs of the probe were needed, and none changes the answer. The first stopped on a network timeout after the first queue run. On the second, the queue waited, since Standard's sandbox shut out the stand-in broker: "the gate could not read the forge (broker fetch failed)". The third, with those settings out of the scratch checkout, merged. On that run the gate's read-back timed out and it called `gh pr merge` a second time; the queue recorded "merge stands", and the broker logged both calls as allowed.

After the merge the new head of `main` has no status: `ciState` reads `none` there. That fits fact A4 (only a red main line holds merges), and spec 4.3 starts a main-line check for it.

### What was not tested

- The narrow connection, and GitLab, whose status path check 71 tried at Free.
- GitHub's answer to a key with no `statuses: write`. By check 20's pattern (a key without a permission is answered `403 Resource not accessible by integration`), the adapter's existing `refusal` words should catch it, but this wasn't measured.
- A `failure` status: check 76 covered a red one with the context `ci`.
- The queue's call with the real broker for this context: this used check 76's stand-in, since the queue's calls don't change with the status's name.

## What it means for the design

- **Section 4.3 stands.** A commit status with the context `wheelhouse/checks` is all the gate needs on a repository with no Actions, and `pending` holds the queue in `wait`, not refused as `none`.
- **The plan's first choice is confirmed, and Review Focus 1 is real.** `hasCi` reads any status, so the first posted status flips a no-CI project to "has CI". `whereChecks` must read the rollup's contexts by name and leave `wheelhouse/checks` out, and today's `hasCi` is the wrong read for it. The test in part 2's Task 1 is the one that matters.
- **`setStatus` can be the one `gh api` line used here.** Its answer carries `state`, `context` and `creator`. Each post adds an entry rather than replacing one, and the rollup takes the newest per context, so a repeated post on the dispatcher's next tick does no harm.
- **`description` is limited to what the host keeps,** so the status line stays short. "Tests not counted yet" fits.
- **Both legs not run go with part 2's status permission card:** adding `statuses: write` to the manifest needs the director to accept it, and that is the moment to see the real refusal. Nothing else waits on them.

## Needs the director

Not now. Two legs need a key this computer doesn't hold: the narrow connection, and the refusal with no `statuses: write`. Both need the Wheelhouse app signed in, so they wait for the part 2 sitting. No card is raised for this note.

The trial repository can be deleted once the main session says so; deleting it is the director's click. This check left it as follows, on top of what checks 76, 80 and 81 left:

- **Pull request 8** (`check-84/mvvyx5ar`), merged at `a09ae82`, with one verdict comment. The branch is still there.
- **`docs/check-84-mvvyx5ar.md`** on `main`, one line.
- **Commit statuses** with the context `wheelhouse/checks` on `9727de4`: one `pending` and two `success`.

The scratch checkout, mirror, broker logs and permits went to the Trash when the part's checks ended.
