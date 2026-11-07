<!-- docs/parked.md -->

# Parked pieces

On 7 November 2026 the director approved cutting Wheelhouse back to its core (`docs/specs/2026-11-07-core-cut-design.md`). Each piece below is switched off, lifted out of the main line, and neither installed, tested nor upgraded. Each stays whole in the history under a `parked/<piece>` tag.

**Bringing a piece back.** It is the director's request through the First Mate, like any feature: a short design that brings the piece up to date against the core of that day, then a build from its tag. Nothing switches itself back on. To read a piece as it was: `git checkout parked/<piece>`.

**Settings and records.** What a parked piece wrote stays in the project's record and the director's profile. The settings catalogue still accepts those keys (`RETIRED` and `RETIRED_PATTERNS` in `scripts/settings/catalogue.js`), so old records never fail a check, but nothing reads them.

Each lift-out part adds its piece's keys to those lists as it removes the piece, so a key listed under "Settings retired" below is retired once its piece has been lifted out.

## The pane, the status line and the courier (the mod)

- **What it was:** the Claude Code mod: a pane beside the chat with the cards, the Logbook and the board, a status line, and the courier that woke the front desk. Also the watcher's Shape 2, which ran inside the mod's timer.
- **Tag:** `parked/mod`
- **Designs and plans:** `docs/specs/2026-10-31-pane-design.md`, `docs/specs/2026-11-04-one-card-design.md`; `docs/superpowers/plans/2026-10-19-wheelhouse-mod.md`, `docs/superpowers/plans/2026-10-21-wheelhouse-calm-interface.md`, `docs/superpowers/plans/2026-10-23-mod-sitting-2-fixes.md`
- **Why parked:** the director asked on 7 November 2026 to rethink the mods and the UI-first approach and get the core right (design sections 1 and 4.2). Real use has needed the chat only.
- **Bringing it back:** a short design against the core of that day (cards, watcher keep-alive and notifications have moved into the chat, the session-start hook and the helper's tick), then a build from the tag.
- **Settings retired:** `watcherShape` (Shape 1 only; the value is accepted and ignored) and the pane's own view settings.

## Copilot, with its Lean tier

- **What it was:** GitHub Copilot as a second coding agent, with the agent seam's Copilot adapter, the Lean tier and the Copilot pin.
- **Tag:** `parked/copilot`
- **Designs and plans:** `docs/specs/2026-10-20-other-agents-design.md`; `docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md`, `docs/superpowers/plans/2026-10-30-archon-copilot.md`, `docs/superpowers/plans/2026-11-02-copilot-remaining-parts.md`
- **Why parked:** the agents have converged, so a second agent is upkeep with no gain in what gets built (design section 2.2); no one upstream owns Archon's Copilot connection (section 2.4); real use hasn't reached it. Sittings S1 to S7 are cancelled and no Copilot spend is asked for.
- **Bringing it back:** a short design against the core of that day, written for the agent seam (`scripts/agents/contract.js`), then a build from the tag.
- **Settings retired:** `capRequests`.

## Archon

- **What it was:** Archon, an open-source build engine pinned at v0.13.0, built from source with three patches, with Wheelhouse's connector, pack, broker, dispatcher, card router and spend meter.
- **Tag:** `parked/archon`
- **Designs and plans:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md` (and its architecture drawing); `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md` and the `2026-10-29-archon-*` and `2026-10-30-archon-*` plans
- **Why parked:** no merging for a project kept on one computer; no GitLab; it wants WSL2 on Windows; no one upstream owns its Copilot connection; in effect one person maintains it and it moves fast; real use hasn't needed it, as the own engine builds every project Archon can't (design sections 2.4 and 4.3).
- **Bringing it back:** a short design against the core of that day, then a build from the tag. The engine connector (`scripts/engine/contract.js`) and its stand-in (`scripts/engine/fake.js`) stay in the core so an engine can be plugged in.
- **Settings retired:** `engine`, `engineLanes`, `engineRoom`, and the caps only the engine read (`capMinutes`, `capTokens`, `cardsPerDay`, where nothing outside the engine reads them).
- **Look again on 7 February 2027,** or sooner if any of these happens:
  1. Archon adds merging for a project kept on one computer.
  2. Archon supports GitLab.
  3. Its Copilot connection gets an owner upstream, and Archon gains a second regular maintainer.
  4. Wheelhouse's own engine repeatedly loses work in real use.

  The look is a short report to the director with a card: stay parked, or bring it back.

## The engine's side of the core

- **What it was:** the parts of the core that only an engine behind the connector used: the dispatcher, the card router (`scripts/engine/runner.js`), the spend meter and its caps, the broker (`scripts/engine/broker/`), the engine room and the pack checks.
- **Tag:** `parked/engine-side`
- **Designs and plans:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`; `docs/superpowers/plans/2026-10-29-archon-part-3a-engine-seam.md`, `docs/superpowers/plans/2026-10-29-archon-part-3c-dispatch-cards-spend.md`
- **Why parked:** it stands on Archon. The own engine has its own queue, pace and usage reading (design section 4.2, "Parked with them").
- **Bringing it back:** with Archon, or with another engine: a short design against the core of that day, then a build from the tag.
- **Settings retired:** those listed under Archon.

## The VS Code add-on

- **What it was:** an editor panel for Claude Code in VS Code, packaged as a `.vsix`, with the helper's `add-on` proof.
- **Tag:** `parked/vscode-addon`
- **Designs and plans:** `docs/specs/2026-11-04-vscode-panel-design.md`; `docs/superpowers/plans/2026-11-04-vscode-panel.md`
- **Why parked:** the front ends are cut back to the chat (design sections 1 and 4.2). The helper stops answering the add-on's proof, so an add-on still installed is inert, and the update offers to remove it.
- **Bringing it back:** a short design against the core of that day, then a build from the tag, with CI's add-on steps and the release's `vsix` job.
- **Settings retired:** none.

## Delegation and concept learning

- **What it was:** the First Mate settling small decisions for the director within bounds, with a review, and learning which concepts the director knows so as to skip explaining them.
- **Tag:** `parked/delegation`
- **Designs and plans:** `docs/specs/2026-11-01-delegated-decisions-design.md`; `docs/superpowers/plans/2026-11-01-delegated-decisions.md`
- **Why parked:** it stood on parked pieces and real use hasn't needed it. Every decision at levels 3 and 4 is the director's card, as before delegation (design section 4.2).
- **Bringing it back:** a short design against the core of that day, then a build from the tag.
- **Settings retired:** `delegationReviewDays`, `blindCards`, and the family `known:*`.

## Screenshot approvals

- **What it was:** comparing screenshots so that an approval carried over when a branch was brought up to date.
- **Tag:** `parked/screenshot-approvals`
- **Designs and plans:** the "Comparing screenshots" ruling in `docs/specs/2026-10-17-wheelhouse-design.md` (section 22); `docs/specs/2026-10-18-build-loop-design.md`; `docs/superpowers/plans/2026-10-18-wheelhouse-build-loop.md`
- **Why parked:** a small gain for a part that needs its own upkeep (design section 4.2). When a branch is brought up to date after approval, the approval card is asked again, in one click. Previews stay.
- **Bringing it back:** a short design against the core of that day, then a build from the tag.
- **Settings retired:** none.

## Windows Locked

- **What it was:** the Windows branch of Locked protection (`scripts/protection/locked.js` and `managed.js`), and the plan to try it.
- **Tag:** `parked/windows-locked`
- **Designs and plans:** `docs/specs/2026-10-17-wheelhouse-design.md` (check 12 and section 22); `docs/superpowers/plans/2026-10-18-wheelhouse-safety.md`
- **Why parked:** it was never tried on Windows with admin rights, and Windows projects use Standard with the Guarded build commands (decided 7 November 2026, design section 4.2). macOS Locked is unchanged.
- **Bringing it back:** a short design against the core of that day, then a build from the tag, and a trial on Windows with admin rights.
- **Settings retired:** none.

## Unattended goals

- **What it was:** goals the First Mate pursues while the director is away, partly built on Archon's dispatcher, caps and delegation (`scripts/engine/goal-*.js`).
- **Tag:** `parked/unattended-goals`
- **Designs and plans:** `docs/specs/2026-10-31-unattended-goals-design.md`; `docs/superpowers/plans/2026-11-01-unattended-goals.md`
- **Why parked:** it stands on Archon, its caps and delegation, all parked (design section 4.2, "Parked with them").
- **Bringing it back:** the director decided on 7 November 2026 that goals come back later on the own engine, with their own design, then a build from the tag.
- **Settings retired:** none of its own; its decisions used `blindCards` and the caps listed above.
