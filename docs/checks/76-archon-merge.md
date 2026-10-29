<!-- docs/checks/76-archon-merge.md -->

# Check 76: the merge path on GitHub through a broker (early check E3)

**Answer:** Yes, with one part answered No. Every leg passed, once each, on a throwaway private repository. Archon v0.13.0's own merge queue ran with no key, and its only `gh` was a stand-in broker. A merge with no permit was refused, and the same pull request merged once the permit existed. A red main line was held, with an ask whose only choice was `hold`. A clash went back to the build queue, the lane ran again and the pull request then merged. A branch that deleted a test was stopped before any pull request was opened. The part answered No: Wheelhouse's `--config` cannot carry the maintainers policy, so the project still needs `.archon/sdlc/policy/maintainers.json` (spec 14.3). Three results matter for the build. The queue only takes work items from Archon's state store. A second review comment reads as `duplicate`, so the helper edits its one verdict comment in place. Most of the queue's `gh` calls are GraphQL reads, which the broker's first list has to name.

## Question

Spec section 15, E3. Can the merge path work on GitHub through the broker (spec 12.4)? The legs: a pull request through the broker, CI green at the head, Archon's merge gate merging with a verdict comment from the maintainer identity, a red main line refused (`hold`), a clash sent back and the lane run again, a planted test deletion stopped, and a merge without a permit refused by the broker. Also: can the maintainers policy come from Wheelhouse's `--config` rather than a file in the project (spec 14.3)? And what exact form of verdict comment does the pinned gate read (spec 7.5)?

## Tested on

29 October 2026, on macOS (arm64), with Archon v0.13.0's compiled binary and Bun 1.4.3 from `probes/lib/archon.js` (the scratch engine, with the spec 6.3 environment and telemetry off), `gh` from Homebrew, and the private repository `where-is-brett/wheelhouse-merge-trial`, made with the director's go. The merge queue's one AI step (`sweep`) ran on the mid-sized model (`--model large=medium`) rather than its default, the most capable model. The lane's conflict step ran on the small model. Each leg ran once. Claude spend for the whole check was $0.46: six merge-queue runs at $0.06 to $0.13 each, and $0.002 for the conflict step.

## Method

`node probes/76-archon-merge/run.js setup deletion config a1 a2 b1 b2 c1 c2 c3 summary` (the phases can run one at a time; state is kept in the scratch folder).

- **No key in Archon.** `run.js` reads `gh auth token` in its own process only. It runs a helper stand-in, an HTTP server on `127.0.0.1` at a random secret path, which answers `{argv, cwd}` with `broker.js`'s `handle`: it logs the call, refuses a merge with no permit file `<pr>-<head>`, and otherwise runs the real `gh` with `GH_TOKEN` set in that one child's environment. Archon's `PATH` is the pinned Bun, a scratch folder holding a `gh` launcher (`#!/bin/sh`, exec of the absolute Node path with `broker.js`), and the system folders. `run.js` refuses to start if `GH_TOKEN` or `GITHUB_TOKEN` is in Archon's environment.
- **Git with no credential.** The project checkout's `origin` is configured as GitHub's URL, which Archon's scripts read to find the repository, and a `url.<mirror>.insteadOf` rule points git at a local bare mirror. Before each run, `run.js` refreshes the mirror from GitHub (branches and `refs/pull/*/head`) with `gh auth git-credential` in its own process. It also pushes the lane's branches through the mirror, as the helper would. So the merge queue's `git fetch` calls never needed a credential. The credential-helper route of spec 12.4 was not tried.
- **CI stand-in.** No GitHub Actions workflow was added, since Actions minutes are not to be spent on a private repository. `run.js` posted commit statuses with context `ci` through the real `gh` (`gh api repos/<o>/<r>/statuses/<sha> -f state=… -f context=ci`). The gate counts them: `merge.ts`'s `checksOf` reads the head commit's `statusCheckRollup`, both `CheckRun` and `StatusContext`, and treats a `SUCCESS` status as passing and `FAILURE`/`ERROR` as red.
- **The seed** (`probes/76-archon-merge/seed/`): a tiny module and its test, `.archon/sdlc/policy/maintainers.json` naming `where-is-brett`, and two trial workflows. `trial-pr` runs a check step, which refuses a branch that deletes anything under `tests/`, and then `gh pr create` through the broker. `trial-update` merges the main line into the branch with a merge commit and has one small-model step resolve a conflict. Its check step then refuses leftover conflict markers, an uncommitted tree, a branch that lacks the main line, or a deleted test. The seed went straight to `main` in the first push.
- **Handing work to the queue.** Archon's merge queue takes only work items in its state store (`work/<n>` documents with `facts.build.status: ready`, or maintainers' own pull requests when the maintainer list opts in with `merge_queue: "own-prs"`). `run.js` writes a version 1 work item with `archon state put` for each pull request, standing in for the build queue as Wheelhouse would. A build-owned item was used because the queue sends a clash back only on such an item; on an own pull request it asks instead.
- **The verdict.** For each pull request, the helper posts the verdict comment through the broker as `where-is-brett`, with `gh pr comment`, logged apart from Archon's calls.
- **The legs, in order.** (1) `trial/drop-test` deletes `tests/add.test.js` and is checked by `trial-pr`. (2) PR 1 (`trial/a-double`) is opened by `trial-pr` and given green CI and a verdict, then the merge queue runs with no permit. (3) A permit is written and the queue runs again. (4) A `failure` status is posted on `main`, PR 2 and PR 3 are opened (each changes the same line differently), and the queue runs with PR 2's item; the run's ask is answered with its one choice. (5) `main` is set green and the queue runs. PR 2 merges. (6) PR 3, now conflicting, is handed to the queue. (7) `trial-update` runs on PR 3's branch, the helper pushes it, posts green CI, edits the verdict comment for the new head, writes the permit and hands the item back as ready, and the queue runs again.
- **`--config`.** Dry runs of `archon-merge-queue` with a run-scoped layer holding a policy key (`sdlc: maintainers: [...]`), and with one holding only `env:`. The pack's source was read for any other way in.

## Evidence

| Leg | Result | What showed it |
| --- | --- | --- |
| Test deletion stopped | Pass | `trial-pr` run failed at `check`: "Bash node 'check' failed [exit 1]: Check step: this branch deletes test files: tests/add.test.js". The `pr` node was skipped (`upstream_failed`). No pull request exists for the branch, and the broker logged no call |
| Pull request through the broker | Pass | `trial-pr`'s `pr` node ran `gh pr create` on the broker, logged as kind `create`. PR 1 was opened, author `where-is-brett`. PRs 2 and 3 the same way |
| CI green at the head | Pass | Combined status `success` at PR 1's head `7ea72c0`. The queue's facts read `checks: green` |
| Merge without a permit refused | Pass | Run 1: the sweep ran the gate with `--merge`; the gate called `gh pr merge 1 --repo github.com/where-is-brett/wheelhouse-merge-trial --squash --match-head-commit 7ea72c0…`. The broker refused it ("no permit for pull request 1 at head 7ea72c0…"). The gate failed, PR 1 stayed open, and the queue recorded `wait (clear)`: "Clear and gate-ready, but the merge was refused by Wheelhouse's broker: no permit for PR 1 at this head; waiting for a permit." It tried no other route |
| Gate merges with the maintainer's verdict | Pass | Run 2, permit written: the same `pr merge` call passed, PR 1 merged (squash `26349ec`), merged by `where-is-brett`, read back by the gate |
| Red main line held | Pass | Run 3: facts read `main` red (`ci` failing at `26349ec`). The sweep merged nothing and decided `wait` for PR 2. It looked for Actions runs to re-run (`gh run list`, the commit's check runs and statuses), found none, and raised a base ask (label `merge: base`) naming PR 1 as the suspect and recommending a revert or fix-forward. Its only option was `hold`. The run paused. Answered `hold`, the `ruling` node recorded "The queue holds merges while the default branch is red". No merge call was made. Run 4, with `main` green: PR 2 merged (`fbbd149`) |
| Clash sent back and lane run again | Pass | Run 5: PR 3 read `CONFLICTING`. The sweep decided `return (clear)` and the record node set the item's build status to `next`, with a brief: merge main into `trial/c-greeting` with a normal merge commit (no rebase), resolve `src/add.js` keeping both intents, and "the new head needs a fresh review". `trial-update` then merged the main line, its small-model step resolved the line to `greeting = 'hello there, good day'` and committed `d124cbd`, and its check step passed. Run 6, after the helper's push, green status, in-place verdict edit and permit: PR 3 merged (`ee73dd4`) |
| `--config` carries the policy | No | The policy-key layer was refused: "Unknown run config key 'sdlc'." Run config takes only `assistant`, `assistants`, `tiers`, `aliases`, `workflows`, `docs.path` and `env`. The `env:` layer is accepted, but nothing reads it for this: `.shared/maintainers.ts` reads only `.archon/sdlc/policy/maintainers.json` at the default branch's head, with `git show`, and "No file means nobody" |

**The verdict comment's form** (spec 7.5), from `.shared/review-comment.ts` and `merge.ts` in v0.13.0, and posted as such here:

```
<!-- archon-review-report -->
Reviewed commit: `<full head sha>`
Verdict: ready
Contract: complete

<prose for people; nothing parses it>
```

The first line must be the marker exactly. The commit must match `[0-9a-f]{7,64}`. The verdict is `ready` or `not ready`, and the contract is `complete` or `open` (`open` stops the queue writing `Closes #N`). It is an ordinary issue comment on the pull request, read from `GET repos/{o}/{r}/issues/{n}/comments`. It is trusted only when its author's login, lower-cased, is in the maintainer list. More than one trusted marked comment reads as `duplicate`, which refuses the merge. So after the lane moves the head, the helper must edit its one comment in place (here `gh api -X PATCH repos/{o}/{r}/issues/comments/{id} -f body=…`), not post a second one.

**Every `gh` call the merge queue made**, across the six runs, by kind. This is the broker's first allow list for part 3b. Values are taken out; `{o}/{r}` is the repository, `{n}` a number.

| Kind | Call | Count | Who |
| --- | --- | --- | --- |
| read | `api graphql --hostname github.com -f query=query(…) …`: the pull-request snapshot (state, head, mergeable, status rollup, review threads), the head's `behindBy` against the default branch, and the default branch with its rollup | 48 | facts, gate and record scripts |
| read | `api --hostname github.com repos/{o}/{r}/issues/{n}/comments?per_page=100&page=1 --include` | 19 | facts, gate and record scripts (the verdict) |
| read | `pr view {n} --repo github.com/{o}/{r} --json body` (once with `,state`, once with `-q .body`) | 3 | sweep agent, checking the closing keyword before a merge |
| read | `run list --repo {o}/{r} … --json …` | 2 | sweep agent, red main only |
| read | `api repos/{o}/{r}/commits/{sha}/check-runs --jq …` and `api repos/{o}/{r}/commits/{sha}/status --jq …` | 1 and 2 | sweep agent, red main only |
| merge | `pr merge {n} --repo github.com/{o}/{r} --squash --match-head-commit {sha}` | 4 (1 refused) | gate script |

The queue made no push, no comment, no pull-request create and no edit. The broker classes the GraphQL reads as `other`, since they are POSTs with no REST path. The lane and the helper made these calls: `pr create` (the trial lane, 3), `pr comment` (the helper's verdict, 3), and `api -X PATCH repos/{o}/{r}/issues/comments/{id}` (the helper's re-signing, 1, classed `other`). Calls the queue's source can make but this trial did not reach: `gh run rerun <id> --failed` (red CI with Actions runs, which needs Actions write), `gh pr edit {n} --body-file …` (a closing keyword corrected), `gh issue view {n} --json body` (a pull request linking an issue), `gh pr list … --author …` (own-PR enrolment), and the retriage label and intake calls (with `retriage_as` set).

**Other observations.**

- The gate merges with `gh pr merge … --match-head-commit`, not the REST merge call, so the broker's head comes from the command itself.
- The merge queue runs in the launch checkout, with no worktree, and its scripts `git fetch` the default branch from the remote whose configured URL names the repository. Archon's own project key, though, followed the `insteadOf` rewrite: its transcripts went to `workspaces/e3/mirror/` rather than a name for the GitHub repository.
- The sweep agent ran `git merge-tree` on the checkout and read the policy files. It also read the queue's own workflow source under Archon's home. It ran no `gh` call outside the list above.
- `~/.claude/plugins/installed_plugins.json` was unchanged by this check: checksum `3c1f323e…a97c` after the runs, with the file last modified at 11:24 UTC, before the first run at 11:32 UTC. No step names a plugin.

### What was not tested

- Real GitHub Actions CI (check runs, re-runs of failed jobs, logs). Commit statuses stood in. The gate reads both, but the sweep's "one rerun" path needs `gh run rerun`.
- Git credentials through the helper (spec 12.4's credential helper). A local mirror served every git read.
- Branch protection and server-side rules: the repository's settings were not changed.
- The queue on its default most capable model, own-PR enrolment, an unclear pull request's ask, `.archon/` changes, a stale or missing verdict at merge time, a second clash on the same work, and anything run more than once.
- How the dispatcher would run the lane again. The probe did the handing back by hand: one more round, and a ready time later than the queue's decision.

## What it means for the design

- **The broker works as designed, and Archon's merge queue can be used** (spec 15's pass). The permit check at the broker is enough to stop the gate, and the queue reported the refusal plainly and waited, rather than trying another way to merge. The merge does not need to stay with the helper's own gate.
- **The project keeps the policy file** (14.3). `--config` cannot carry the maintainer list, so the designer's call stands as written: setup puts `.archon/sdlc/policy/maintainers.json` in the project. This is for a card only in that the "left open" note in 14.3 can now close.
- **The engine adapter has a new duty: handing work to the queue.** The queue reads only `work/<n>` documents in Archon's state store. Wheelhouse, as the build queue, writes each one with `archon state put`: build status `ready` and the round naming the pull request. After a `return`, it reads the brief from `facts.build.brief`. Once the lane has run again, it hands the item back with a ready time later than the queue's decision. That takes `archon state get/put` from the helper's side, which spec 12.2 keeps from agents. The other route, maintainers' own pull requests (`merge_queue: "own-prs"`), never sends a clash back (it asks instead), so it does not fit spec 7.7. For a card: this belongs in section 7.3 (the dispatcher) or 6.1 (the engine interface).
- **The helper re-signs by editing its comment** (7.5). A new review of a new head must replace the body of the helper's one verdict comment. A second comment makes the verdict `duplicate`. The helper must keep the comment's id, and its allow list must name `PATCH repos/{o}/{r}/issues/comments/{id}` for its own comment only.
- **The broker's first allow list** is the table above. One change is needed in how the broker sorts calls: a `gh api graphql` call whose query starts with `query` is a read, and one with `mutation` is not. Nearly every call the queue makes is one of those reads. The list also needs the calls the source can make that this trial didn't reach (listed above). Each one is refused until the list names it, as 12.4 says, so the monthly evaluation should drive a red CI with real Actions runs to see `gh run rerun`.
- **Git reads need a route too.** The queue fetches the default branch itself, and the sweep fetches pull-request heads. In a private project that means the credential helper of 12.4 must answer fetches (read only) as well as pushes, or the helper keeps a mirror as this probe did. This is a builder's choice. The mirror kept every credential out of Archon's process tree, at the cost of a refresh before each run.

## Needs the director

Nothing for this check. Every step was done by an agent. The trial repository can now be deleted, and deleting it is the director's (through the main session). It is left as it was at the end of the check:

- **Pull requests:** 1 (`trial/a-double`), 2 (`trial/b-greeting`) and 3 (`trial/c-greeting`), all merged by squash. Each has one verdict comment from `where-is-brett`.
- **Branches:** `main`, `trial/a-double`, `trial/b-greeting` and `trial/c-greeting`. `trial/drop-test` was never pushed.
- **Commit statuses** (context `ci`): `success` on the seed commit `5b6743d`, on each pull request's head (`7ea72c0`, `9019dc0`, `8e6ac9c`) and on PR 3's updated head `d124cbd`. On `26349ec` (PR 1's merge) there is a `failure` and then a `success`. The last two merge commits, `fbbd149` and `ee73dd4`, have none.

**Scratch removed.** The check's scratch folder (`<temporary folder>/wheelhouse-archon-checks/e3/`: the mirror, the project checkout, the broker logs, the permits and the run records) and Archon's workspace for it (`home/workspaces/e3/`, holding the runs' transcripts and artifacts) were moved to the Trash. The scratch engine's database still holds the runs and the three `work/<n>` documents. It goes when the engine's scratch folder is removed.
