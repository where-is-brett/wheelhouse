<!-- docs/checks/90-leave-pull-request.md -->

# Check 90: leaving one pull request alone (U3)

**Answer:** Yes. On real Archon's merge queue, an unclear pull request is asked about with `park` among the choices every time it was asked (four asks), and once parked the next sweep merged a clear pull request and left it alone: no question, no merge call. Two things part 2e must allow for: readying a parked pull request again at the **same head** only makes the queue wait, with no new question (a new head asks again, and `merge` then merges it); and the engine adapter's `mergeAsked` reports only the id that merges, so it must also report the `park` id. The cost was about $0.75 of model spend.

**A later leg, for part 2e:** a parked pull request handed over afresh at the same head is asked about again, and `merge` merges it, so the director's approval can reach a pull request whose commit hasn't moved. The same leg found that the queue passed over every item `handOver` wrote, because they named the repository without its host. That cost about $0.61.

## Question

The delegated-decisions plan, part 0d, and the goals draft's check U3. Does the merge queue offer `park` for an unclear pull request; does taking it let later sweeps merge other pull requests and leave that one alone; and does `merge` on a signed approval merge it once it is readied again? What is the option's exact id, and how does `mergeAsked` report it?

## Tested on

1 November 2026, on macOS 27.0.1 (arm64) with Node.js 22.22.1, `gh` from Homebrew, Archon v0.13.0's compiled binary and Bun 1.4.3 from `probes/lib/archon.js` (scratch home, telemetry off, root `wheelhouse-archon-checks-90` of its own), and the private trial repository `where-is-brett/wheelhouse-merge-trial`. The queue's sweep ran on the mid-sized model, as in check 76. The trial repository's settings were not changed. Claude spend was about $0.75 across eleven sweeps.

## Method

`node probes/90-leave-pull-request/run.js`, then `--stamp <stamp> --from-leg-3 <pr>` for the last leg (see Evidence). The probe uses check 76's stand-in broker and mirror, so Archon holds no key; the broker allows a merge only where a permit for that pull request and head exists, and every pull request had one.

- **The pull requests.** Pull request A changes sign-in so any admin gets in with any secret, and adds a migration that drops a column and the sessions table. B and C each add one line to a docs file. Each had a green `ci` status, a ready verdict at its head and a work item the queue claims.
- **Legs.** One: A and B in one sweep. Two: answer `park`, then raise C and sweep again. Three: ready A again at the same head and sweep; then push a new commit to A, give it a fresh verdict, status and permit, ready it again and sweep.
- **Reads.** The ask is read from the run's `record` step output (`asked.attention.choices`, each with its `effect`), and from `archon workflow attention --all --json` for the occurrence the answer needs. The answer is `archon workflow answer <run> --occurrence <id> --choose <id>`.

## Evidence

| Leg | Result | What showed it |
|---|---|---|
| Unclear pull request beside a clear one | Pass | The sweep merged B and asked about A: "Touches a schema migration (drops column and sessions table) and authentication". The run paused |
| The choices offered | `merge`, `return`, `park`, `other` | Every ask, four times over (two pull requests, two heads). `park`'s effect was `park`; `other`'s effect was `return`. The order varied once (`return` first). The attention item lists only the ids and labels |
| `mergeAsked` | `{ pr, head, merge: "merge" }` | The adapter's read gives the id whose effect is `merge` and nothing for `park` |
| Answer `park` | Pass | Exit 0. The ruling step ran and the run completed. The work item's merge status read `parked`, with the decision "answered: park" at the head asked about |
| Sweep with C | Pass | Merged C ("clear"), asked nothing, made no merge call naming A, and A stayed `parked` and open |
| Ready A again at the same head | Waits, no new question | The sweep claimed it and decided "wait (unclear)": "maintainer already answered park at this head, no approval, so not merged or re-asked." Status went back to `waiting` |
| A new head, new verdict, ready again | Asks again | `park` offered again. Answering `merge` recorded an approval pinned to the new head; the ruling started a sweep of its own, which merged A (`gh pr merge … --match-head-commit <head>`, permitted) |

### What else showed

- **A paused run lets other sweeps through.** While one run was paused on A's question, a second sweep started beside it, merged a clear pull request and left A alone. That was seen by accident on an early attempt in which my answer had not gone through. The queue's own text says a paused run gives its slot back. The block is Wheelhouse's count of a paused run as running, not Archon's.
- **A second ask for the same pull request.** In that attempt, readying A again while its first run was still paused started a second sweep that asked about A in a new run, so two runs were paused on one pull request. Answering one of them is a thing the helper must be ready for.
- **What counts as unclear.** A change under `.archon/` that is a plain note was judged "docs-only" and merged with no question (pull request 9), though the pack's text says such changes always ask. Auth plus a destructive migration asked every time.
- **Two review reports.** A second verdict comment on a pull request, left beside the first at a new head, made the sweep read the verdict as "duplicate" and `return` the item. The probe removes the old one first.
- **Attempts.** Four runs of the probe were needed. The first used a note under `.archon/` that merged without a question. The second and third ran with an attention read that missed `--json`, so no answer went through. None changes the answer.

### The fresh hand-over leg

`node probes/90-leave-pull-request/run.js --fresh-hand-over`, run on 1 November 2026 on a scratch root of its own, `wheelhouse-archon-checks-90-fresh`, with a stop at $0.60 before any sweep. Check 90's same-head leg kept the item's record, using the probe's `readiedAgain`. Wheelhouse's own `handOver` writes a fresh item, so this leg goes that way.

| Step | Result | What showed it |
|---|---|---|
| Item as `handOver` wrote it, with `repo` a plain name | Passed over | The sweep finished with no model step and at no cost, asked nothing and wrote no merge record. The queue's `parseWorkItem` needs `repo` as `{ host, path }` |
| Item with the repository in full (pull request 17) | Asked | `park` offered, as before |
| Answer `park` | Pass | `parked`, with "answered: park" at head `eb22a65` |
| Fresh item at the same head | Asked again | A new question at the same head, with `merge` and `park` offered: "no approval" |
| Answer `merge` | Merged | The approval was pinned to that head. The ruling's own sweep merged it: "maintainer approval pinned to head eb22a65 holds" |

| Run | Cost |
|---|---|
| Passed-over item | $0.00 |
| First ask | $0.13 |
| Ask after the fresh item | $0.09 |
| The ruling's own sweep, which merged | $0.39 |
| A last sweep with nothing to do | $0.00 |

The ruling's own sweep cost most because it runs without the models the helper gives a queue run (`docs/engine/archon-upstream-note.md`). Its run wasn't listed in time for the probe to count it, so the report's $0.22 leaves it out, and the table reads each run's own record.

### What was not tested

- `park` on a maintainer's own pull request (`merge_queue: "own-prs"`), whose text differs: it stays parked until a later sweep sees a different head.
- A pull request that is not build-owned and is readied again by the build queue after real work, only by writing the ready record by hand.
- Which kinds of change the sweep calls unclear, beyond the two seen.

## What it means for the design

- **Part 2e can go ahead.** Taking `park` stops the pull request holding anything up, and the next sweeps merge others.
- **`mergeAsked` needs the park id too.** Today it returns `merge` only. Part 2e should add the id of the choice whose effect is `park` (it was `park` here), read the same way, and take it only when it is there.
- **A parked pull request comes back by a fresh hand-over.** Ready again with its record kept, at the same head, the queue waits and does not ask. Handed over afresh, it asks again, and `merge` merges it. Part 2e takes that way.
- **`handOver` must name the repository in full.** An item that doesn't is passed over with no word from the queue, and Wheelhouse's own hand-overs were all of that form until part 2e. The probes wrote the full form, so no earlier check saw it.
- **A second ask can appear for the same pull request** if the item is readied while its first run is paused. The dispatcher should treat a paused run on a pull request as that pull request's one open question.

## Needs the director

Not now. The trial repository was left as it is; deleting it is the director's click when the main session says so. This check left, on top of what checks 76, 80, 81 and 84 left:

- **Pull requests 9 to 17**, all merged except **11**, which is open with a paused run behind it that the probe abandoned. Their branches are still there.
- **Files on `main`** under `docs/` (`check-90-*.md`), `db/migrations/` and `src/auth/`, from the merged pull requests.
- **Commit statuses** with the context `ci` on each head.

The scratch checkouts, mirrors, broker logs and permits stay in the scratch roots for now; the scratch engines under `wheelhouse-archon-checks-90` and `wheelhouse-archon-checks-90-fresh` can go to the Trash.
