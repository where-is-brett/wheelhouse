<!-- docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md -->
# Wheelhouse on Archon: the build plan

**Goal:** Wheelhouse becomes the director's seat on top of Archon, as the approved design says, in the order of its migration (section 17): the desk interface first, then the early checks, then Archon lane by lane, then the old engine removed.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, approved by the director and merged on 29 October 2026 (pull request #109).

**How to use this plan.** Each part below is a plan file of its own, carried out by a fresh session with nothing but that file, the spec and the repository. Each names what it waits on, its files, its tests, and what done looks like, and ends with a pull request and one message to the main session. One part per fresh context; the main session starts the next. The main session is the session that started the part's session; a part replies to it with SendMessage to the `from` id of its first message. Pull requests merge when CI is green on Linux, with macOS running on main after the merge.

## The parts

| Part | Release | Plan | Waits on |
|---|---|---|---|
| 1. The desk interface | v0.1.4 | [2026-10-29-archon-part-1-desk-interface.md](2026-10-29-archon-part-1-desk-interface.md) | nothing |
| 2. The early checks E1 to E6 (checks 74 to 79) | none | [2026-10-29-archon-part-2-early-checks.md](2026-10-29-archon-part-2-early-checks.md) | nothing; E3 waits for a throwaway private repository made through the main session, with the director's go |
| 3a. The engine seam, its records and its safety | v0.2.0 | [2026-10-29-archon-part-3a-engine-seam.md](2026-10-29-archon-part-3a-engine-seam.md) | part 1; checks 75 and 78 |
| 3b. The quick lane, the broker and previews | v0.2.0 | [2026-10-29-archon-part-3b-quick-lane.md](2026-10-29-archon-part-3b-quick-lane.md) | 3a; checks 75, 76 and 77 |
| 3c. The dispatcher, the card router and the spend meter | v0.2.0 | [2026-10-29-archon-part-3c-dispatch-cards-spend.md](2026-10-29-archon-part-3c-dispatch-cards-spend.md) | 3a and 3b |
| 3d. Setup, uninstall, and v0.2.0 on the Mac | v0.2.0 | [2026-10-29-archon-part-3d-setup-and-release.md](2026-10-29-archon-part-3d-setup-and-release.md) | 3a to 3c; check 76 |
| 4. The later lanes, Copilot, and the old engine's removal (stubs) | v0.2.x to v0.3.0 | [2026-10-29-archon-part-4-later-lanes.md](2026-10-29-archon-part-4-later-lanes.md) | v0.2.0; checks 74, 77, 78 and 79. Each stub gets its own plan when it starts |

Parts 1 and 2 can run at the same time: part 1 touches only the front ends and a new `scripts/desk/`, and part 2 only `probes/`, `tests/probes/` and `docs/checks/`. Part 3 starts once both have reported.

## Where the spec's sections are built

| Spec section | Part |
|---|---|
| 3 The shape (the helper at sign-in; the seams) | 1, 3a |
| 4 Part by part | throughout; removals in 4 (stub 4.6) |
| 5 The desk interface | 1 |
| 6 The engine interface and the Archon adapter | 3a (6.5's note in 3d) |
| 7.1 Skills | 3b (copies), 2 (check 77) |
| 7.2 Lanes | 3b (quick), 4 (the rest) |
| 7.3 The dispatcher | 3c |
| 7.4 The work order | 3b |
| 7.5 Reviews | 3b |
| 7.6 Models | 3b (bindings in the order), 3a (the adapter's `--model`) |
| 7.7 Clashes and a red main line | 3c (clash), stub 4.3 (fix main) |
| 8 Asks become cards | 3a (normalising), 3c (router, budget, answers) |
| 9 Previews | 3b |
| 10 Spend and caps | 3c (Claude), stub 4.5 (Copilot's estimate) |
| 11 Research additions | 3b (protected tests, done checks, lenses, lesson), 3c (cost record, caps), stub 4.3 (red main) |
| 12 Safety | 3a (guards, All stop), 3b (broker) |
| 13 Copilot | 2 (check 74), stub 4.5 |
| 14 Setup | 3d |
| 15 Early checks | 2 |
| 16 Risks (pins, the weekly check) | 3d |
| 17 Migration | 1 (v0.1.4), 3d (v0.2.0), 4 (v0.2.x, v0.3.0) |
| 18 Testing | each part; the counted evaluation once, in 3d |

## Choices this plan makes

The spec leaves these to the builder or doesn't settle them; the plan settles them so each part is unambiguous. The director or the main session may change any.

1. The desk's `watch` is answered at once with the changes since a cursor that carries the whole snapshot, so the helper keeps nothing per watcher (part 1, Task 4).
2. Front ends outside the sandbox fall back to running the desk's core in process when the helper is down, for reads and All stop only (part 1, Task 5).
3. Copilot's chat clicks keep today's rule: they can answer any label that isn't a signed one (part 1, Task 3).
4. The early checks are numbered 74 to 79, continuing the repository's checks (part 2).
5. E3 uses a stand-in broker in the probe, since the real broker comes after it (part 2, Task 7).
6. Archon's home is `~/.wheelhouse-engine`, outside `~/.wheelhouse`; the engine folder with Archon's and Bun's binaries is `~/.wheelhouse/engine` (part 3a, Task 3).
7. Steps the engine starts carry `WHEELHOUSE_ENGINE_RUN`, so the STOP guard doesn't mark bypass mode for them; the bypass markers go with the old engine in v0.3.0 (part 3a, Task 7).
8. Waiting for an answer doesn't count against a run's minutes cap (part 3c, Task 3).
9. **Give it more** raises the reached cap once by half (part 3c, Task 3).
10. Bundled approvals are a setting, `bundleApprovals`, off by default (part 3a, Task 1).
11. Projects set up before v0.2.0 are offered the switch to the new engine by one level-3 card (part 3d, Task 4).
12. The new engine scenarios are numbered 36 to 44 in the build-loop suite (part 3c, Task 5).
