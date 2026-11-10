<!-- docs/handoffs/2026-11-07-build-kickoff.md -->

> **Done:** the core cut and the way of working are merged and built (`docs/specs/2026-11-07-core-cut-design.md`, `docs/parked.md`). This page is the order the work started in, kept as it was.

# Build kickoff: the core cut and the director's way of working (7 November 2026)

## Where things stand

- **The core cut design** is approved: `docs/specs/2026-11-07-core-cut-design.md` on `feature/core-cut-design-5b4673` (not merged). It decides what Wheelhouse keeps, parks and drops. Its section 8 gives the build order in nine parts.
- **The director's way-of-working design** is approved: `docs/specs/2026-11-07-director-way-of-working-design.md` on `design/director-way-of-working` (commit `4836d098`, not merged). It decides how the director works with what the core cut leaves. Its section 14 gives the build order in ten steps.
- **No build plan exists** for either.

## What runs next, and in what order

| Stream | What it does | Starts |
|---|---|---|
| **A. Core cut** | Write the build plan from section 8, then build the parts, each in its own session and branch | Now |
| **B. Way of working** | Write the build plan from section 14, against the code the core cut leaves | Now, alongside A |
| **C. Way-of-working build** | Build section 14's steps on plan B | Once the core cut's parts 1 to 5 have merged |

Inside stream A, as the core cut's section 8 says:

- Part 1 (the parking frame) goes first; every later part needs it.
- Then parts 2, 6 and 7 run side by side (separate files), with part 3 alongside them.
- Part 4 follows part 3's release; part 5 follows part 1; PR #370 follows part 5.
- Part 8, then part 9 (documents, release and the trial update) last.

Inside stream C, steps 3, 7 and 9 can run side by side.

## Rules for every session

- **No AI attribution anywhere:** no `Co-Authored-By` trailer, no "Generated with" lines, no session links, no model names, in commits, pull requests, code or documents.
- **One branch and pull request per part.** Each part runs the tests of the files it touches; the whole suite is left to CI.
- **The director merges.** Open pull requests; don't merge them. The way-of-working design's auto-merge isn't built yet.
- **The decision line** (way-of-working design, section 5) applies already: product behaviour, algorithms, cost, schema, auth, public interfaces, major dependencies, deletion and rewrites are the director's; ask in the chat in the section 6.2 shape, keep building on the recommendation, and stop only before a step that can't be undone. Everything else, decide and note it in the pull request.
- **Two writers never touch the same files.** Parallel sessions each get their own worktree.
- **Superpowers' loop** inside each part: `writing-plans` for the plan, `subagent-driven-development` or nested sessions for the build, `verification-before-completion` before claiming done.
