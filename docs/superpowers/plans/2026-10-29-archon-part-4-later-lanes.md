<!-- docs/superpowers/plans/2026-10-29-archon-part-4-later-lanes.md -->
# Wheelhouse on Archon, part 4: the later lanes, Copilot, and the old engine's removal (v0.2.x to v0.3.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every lane and Copilot projects run on Archon, and v0.3.0 removes the old engine.

**This part is a set of stubs.** Each stub gets its own full plan, written with `superpowers:writing-plans` once the early checks (part 2) have reported and part 3 has shipped v0.2.0, because the stubs' details rest on what those found: the skill form and the loop's tokens per round (check 77), the merge queue's calls (check 76), resume after cancel (check 78), Copilot under Archon (checks 74 and 79). Each stub here fixes its scope, the files it is known to touch, what it waits on, and what done looks like, so the plan written later can't drift from the design.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 7.2 (the lanes), 7.7, 11, 13, 15 and 17 (steps 3 to 5).

**Plan index:** `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md`.

## Global Constraints

- **The main session** is the session that started you (reply with SendMessage to the `from` id of your first message). Questions, cards for the director and the hand-over go there, never to the director directly.
- British English; dates as 29 October 2026; a repository-relative path comment atop every file. No words such as "enhanced", "improved" or "fixed"; no model names in the repository; no AI attribution anywhere. Scripts in Node.js.
- A lane moves only after its build-loop scenarios pass in the counted evaluation on real Archon (spec 17, step 3).
- Usage pressure never lowers a level, relaxes a review or skips a check.
- The routing table stays the only place that names a model; nothing in the pack names one.

## Order

| Stub | Release | Waits on |
|---|---|---|
| 4.1 The small lane | v0.2.x | v0.2.0 shipped; check 77's tokens per round |
| 4.2 The bug lane | v0.2.x | 4.1 |
| 4.3 Fix main | v0.2.x | v0.2.0 (it can ship beside 4.1) |
| 4.4 The feature slice and feature lanes | v0.2.x | 4.1; check 78's child-run results |
| 4.5 Copilot projects | v0.2.x | checks 74 and 79; 4.1 |
| 4.6 The old engine removed | v0.3.0 | 4.1 to 4.5 shipped, and every project on `engine: archon` |

---

### Stub 4.1: The small lane (`wheelhouse-small`)

**Planned.** The full plan, written 30 October 2026, was kept on the part's branch and taken out before it merged. As built: one task block a task, inside the run (a fan-out of an included workflow, one at a time), not a loop of 30 rounds or child runs, since a child run has no work order or ticket of its own; at most 8 tasks and 2 rounds each; the method in the plan and fix prompts, with no new skill copies; and the plan file taken out of the branch before review, so the pull request never carries it.

**Scope.** Spec 7.2's small lane: read the work order; plan with the adapted `writing-plans` copy and `codebase-design`; a loop group taking the plan's next unfinished task each round (implement with `tdd`, then verify), with a fixed cap of 30 rounds, or one child run per task if the plan chooses; protected-tests check; whole-change review with the standards, spec and other lenses that apply; fix loop with the adapted `receiving-code-review`, at most 3 rounds, closing only on BLOCKER and HIGH; pull request; preview; approval wait if shown first; mark ready; lesson. Caps: 60 minutes, 4M tokens.

**Known files.** `engine/archon/pack/wheelhouse-small.yaml` and its prompts; the plugin's skill copies `writing-plans`, `receiving-code-review` (adapted as spec 7.1 says); `engineLanes` accepting `small`; the build-loop scenarios for the small lane rewritten against the pack.

**Done.** The small-lane scenarios pass with the fake engine in tests and on real Archon in the counted evaluation; a project with `engineLanes: ["quick", "small"]` builds a small change end to end on the Mac; the loop's tokens per round sit within the cap's share check 77 measured.

### Stub 4.2: The bug lane (`wheelhouse-bug`)

**Scope.** Reproduce with `diagnosing-bugs`, writing the failing test, whose command becomes the done check; then the quick lane's steps; or blocked with a proposal if the fix is bigger. Caps: 30 minutes, 2M tokens.

**Known files.** `engine/archon/pack/wheelhouse-bug.yaml`; the `diagnosing-bugs` copy; intake's bug route sending to the lane; the bug scenarios.

**Done.** A planted bug in a test project is reproduced red, fixed and merged; a too-big bug raises a blocked card with a proposal; the scenarios pass on real Archon.

### Stub 4.3: Fix main (`wheelhouse-fix-main`)

**Scope.** Spec 7.7: when Archon's merge gate raises `hold` on a red main line, the card router answers it at level 1, the Logbook shows a line, and the dispatcher starts `wheelhouse-fix-main`. The broker's permit lets the fix merge during an incident.

**Known files.** `engine/archon/pack/wheelhouse-fix-main.yaml`; the dispatcher's red-main trigger; the router table's `hold` row (built in part 3c, answered there but with no run started).

**Done.** A red main line in the counted evaluation starts one fix-main run, no other run starts until main is green, and the fix merges with the incident open.

### Stub 4.4: The feature slice and feature lanes

**Scope.** `wheelhouse-slice`: as small, plus a task review inside the loop, the tester's walk of the done checks in a real browser, and the critical-area review on the most capable model; 120 minutes, 10M tokens. `wheelhouse-feature`: one child run of `wheelhouse-slice` per slice, in the approved design's order, each merging behind its feature flag; a whole-feature review; the midpoint demo wait where chosen; the switch-on wait. The pitch, preview and design stay with the First Mate, and Archon starts once the design is approved. A feature counts as one run against pace.

**Known files.** The two workflows; the First Mate's hand-over of an approved design into a work order per slice; `prototype` used at the First Mate's design stage only; the feature scenarios.

**Done.** A two-slice feature goes from approved design to switched on in the counted evaluation; cancelling it leaves no child run or process alive (check 78's finding holds).

### Stub 4.5: Copilot projects

**Scope.** Spec 13: the Copilot CLI installed at its pin into the engine folder and signed in; its clean home holding the guards as the CLI's own hooks and the same skill copies, named without the plugin's prefix; the routing table's Copilot column on included models; the spend meter's premium-request estimate checked daily against GitHub's figure; a premium model only on the director's opt-in, up to 80% of the plan's allowance. If check 74 failed, this stub follows the fallback ladder it recorded. Wheelhouse offers to maintain Archon's Copilot provider upstream.

**Known files.** `scripts/engine/archon/env.js` (`COPILOT_BIN_PATH`); `scripts/agents/copilot/home.js` (the clean home under Archon); setup's Copilot line; the Copilot scenarios 38 to 41 retargeted.

**Done.** A Copilot project builds a quick and a small change on included models with no premium requests used, and the meter's estimate matches GitHub's figure.

### Stub 4.6: The old engine removed (v0.3.0)

**Scope.** Spec 17, step 4: delete the foreman, its playbook and its routes, the watcher and the waker, feature sessions, the four feature files, the feature commands, the mirror and test merge, the bypass markers, the feature-status hook and the Copilot background sessions, with their tests. Keep the full gate's merge code (`scripts/gate/conditions.js`) for the fallback until Archon has held for three months (spec 6.5). GitLab projects stay on v0.2.x and are told on their Logbook. Old `feature` records stay readable for history.

**Known files.** `scripts/foreman/`, `scripts/watcher/`, `scripts/feature/`, `skills/foreman/`, `scripts/hooks/feature-status.js`, the helper's foreman and feature routes, the Copilot background-session parts of `scripts/agents/`, and their tests; the `engine` setting's `wheelhouse` value retired, and `engineLanes` covering every lane.

**Done.** The whole suite passes in CI; no file names the foreman's routes; the director's measures have held for two weeks on Archon before the first public release (spec 17).
