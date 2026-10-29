<!-- docs/superpowers/plans/2026-10-29-archon-part-3d-setup-and-release.md -->
# Wheelhouse on Archon, part 3d: setup, uninstall, and v0.2.0 on the Mac

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setup installs and pins Archon and Bun with telemetry off, proves the engine with a tiny trial, and gives the merge queue its one policy file; uninstall removes it all; and v0.2.0 ships with new quick changes built by Archon beside the old engine, after the counted evaluation passes on real Archon.

**Architecture:** A pinned fetcher, unlike the host tools' (which take the latest release), downloads exact versions checked against checksums Wheelhouse pins, into the engine folder, with no admin step. Setup's existing engine (cards of changes, the helper making every change, the journal, the one recommended card) is reused: the engine is new changes on existing steps, not a new step. Projects switch per project: `engine: 'archon'` with `engineLanes: ['quick']`.

**Tech Stack:** Node.js (ES modules), `node:test`, Archon v0.13.0 and Bun release assets, `tar`.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 14 (all), 5.6 (the engine room), 6.5 (the fallback note), 16 (lineage and the weekly check), 17 step 2, 18.

**Plan index:** `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md`.

**Waits on:** parts 3a, 3b and 3c merged; check 76 (E3: whether the maintainers policy can come from `--config`, which removes Task 3's file).

## Global Constraints

- British English; dates as 29 October 2026; a repository-relative path comment atop every file. No words such as "enhanced", "improved" or "fixed"; no model names; no AI attribution. Scripts in Node.js. Don't touch `.github/workflows/ci.yml`. Run only the test files a change touches.
- **Telemetry off is a quiet default:** no setting, no card (the director ruled on 24 October 2026). The health check fails closed if Archon reports it on.
- No admin step: Archon's installer, which wants `/usr/local/bin`, is not used.
- Only Archon's processes get Bun on their `PATH`.
- The director sees one new line on the recommended card and nothing else is asked.
- Uninstall's card for Archon's run history is level 4 with **Keep it** recommended.
- Mac first. Windows is tried in its own sitting after the first release.

## Review Focus

1. **A download whose checksum doesn't match the pin** (a re-published asset, a proxy). Refused, nothing installed, the folder left as it was, and the Logbook says why in plain words. Test in Task 1.
2. **`archon provider add claude` run inside the sandbox**, where the trial found it fails. The helper runs it outside the sandbox. Test in Task 1.
3. **A project set up before v0.2.0 switches to the new engine** while a piece is mid-build on the old one. That piece finishes on the old engine; only new quick work goes to Archon; the Logbook reads both. Test in Task 4.
4. **Uninstall while runs are going.** Runs are cancelled first (part 3a's `stopEngine`), then the folders are removed. Test in Task 3.
5. **The engine room left on.** It binds `127.0.0.1` only, is shown on the Logbook while on, and its port is denied to agents. Test in Task 2.

---

### Task 1: Pinned engine install

**Files:**
- Create: `scripts/engine/pins.js`, `scripts/engine/install.js`
- Modify: `scripts/lineage/manifest.js` (`buildManifest` and `verifyManifest` carry `engine: { archon, bun }`), `lineage/manifest.json`, `scripts/lineage/upgrade.js` (an engine upgrade re-runs the install at the new pin, adds the providers again, then runs the safety subset and the counted evaluation before the pin moves), `scripts/sources/` (the weekly official-sources check watches Archon's releases and advisories, and counts its merged changes)
- Test: `tests/scripts/engine/install.test.js`, `tests/scripts/lineage/manifest.test.js`, `tests/scripts/lineage/upgrade.test.js`

**Interfaces:**
- Produces: `ENGINE_PINS = { archon: { version: '0.13.0', assets: { 'darwin-arm64': { name, sha256 }, 'darwin-x64': { name, sha256 } } }, bun: { version, assets: { … } } }`, the sha256 values taken from the releases' `checksums.txt` on the day and written into the file.
- Produces: `installEngine({ platform, arch, fetch, run, record, folder = engineDir() }) -> { ok, archonBin, bunBin } | { ok: false, refused }`: downloads each asset from its official release (GitHub, `coleam00/Archon` and `oven-sh/bun`), checks it against the pin (never against the release's own list alone), unpacks into a temporary folder, moves it in, records each folder change in the journal, then runs `archon provider add claude` through the helper outside the sandbox. A mismatch leaves the engine folder as it was.

- [ ] **Tests first:** `a matching checksum installs into the engine folder`; `a mismatched checksum is refused and the folder is unchanged`; `a URL off the official host is refused`; `provider add runs outside the sandbox`; `the manifest carries the engine pins and verifyManifest catches a changed one`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Install Archon and Bun at pinned versions`.

### Task 2: Setup's steps learn the engine

**Files:**
- Modify: `scripts/setup/tools.js` (step 2's changes add the engine folder, the broker's launcher and the git credential helper, from part 3b), `scripts/setup/computer.js` (the login start from part 3a), `scripts/setup/health.js` (step 10 runs `engine.health()` and the `wheelhouse-hello` trial), the recommended card's words (where setup composes it), `scripts/settings/catalogue.js` and the helper (the **Engine room** setting starts `archon serve` with `HOST=127.0.0.1`, through `archonCli`, shown on the Logbook while on), `SECURITY.md` and `docs/data.md` (Archon's release check, which can't be switched off and sends nothing of the director's; the engine room's first-run download)
- Test: `tests/scripts/setup/tools.test.js`, `tests/scripts/setup/health.test.js`, `tests/e2e/setup.test.js`

**Interfaces:**
- Produces: the recommended card gains one line: "Install the build engine, Archon, with its usage reporting off." For a Copilot project the line names Copilot and its included models (filled in by stub 4.5; here the Claude line only).
- Produces: step 10 fails with a plain line when `engine.health()` reports any finding, and the engine isn't started. `wheelhouse-hello` runs one script step and one cheap AI step, costing a few cents, and proves the engine, the provider and the guards (a planted `.env` read refused in its AI step).

- [ ] **Tests first:** `step 2 lists the engine folder and the broker`; `the recommended card gains the engine line and nothing else is asked`; `step 10 fails closed when telemetry reports on`; `the hello trial's planted .env read is refused`; `the engine room binds 127.0.0.1 only and shows on the Logbook`.
- [ ] Run: fail. Implement. Run: pass, including `tests/e2e/setup.test.js`. Commit: `Set up the build engine with telemetry off`.

### Task 3: The merge queue's policy file, and uninstall

**Files:**
- Modify: `scripts/setup/project-files.js` (a new setup puts `.archon/sdlc/policy/maintainers.json`, naming the identity the helper posts as, in setup's own commit, before protection is switched on), `scripts/setup/` (a project set up already gets it by a pull request the helper merges through its own route after the director's approval card), `scripts/setup/uninstall.js` and `uninstall-run.js` (stop target `engine`; remove the engine folder, the broker and the login start; one level-4 card for Archon's run history, its database and transcripts, **Keep it** recommended, **Delete it**; the project's `.archon/` file, if setup added one, leaves by uninstall's pull request)
- Test: `tests/scripts/setup/project-files.test.js`, `tests/scripts/setup/uninstall.test.js`, `tests/e2e/setup.test.js`

**Interfaces:**
- Skip the policy file's two routes if check 76 found the policy can come from Wheelhouse's `--config` (part 3b's `engine/archon/config.yaml`); then the project stays untouched and the pull request says so.

- [ ] **Tests first:** `a new setup's own commit holds the policy file`; `a project set up already gets it by an approved pull request`; `uninstall cancels runs before removing the engine folder`; `uninstall's run-history card is level 4 with Keep it recommended`; `uninstall's pull request removes the project's .archon file`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the merge queue's policy file, and uninstall the engine`.

### Task 4: The switch, per project

**Files:**
- Modify: `scripts/setup/` (projects set up from v0.2.0 on the Mac start with `engine: 'archon'`, `engineLanes: ['quick']`; projects set up before are offered the switch by one level-3 card at the next visit, **Switch** recommended), `scripts/desk/views.js` (the Logbook reads old `feature` records and new `run` records side by side), the briefing (one line, once: "New quick changes are built by the new engine."), `docs/engine/orchestrator-mapping.md` (the one-page note mapping the engine interface to Orchestrator.inc, spec 6.5), `README.md`
- Test: `tests/scripts/setup/switch.test.js`, `tests/scripts/desk/views.test.js`

- [ ] **Tests first:** `a piece mid-build on the old engine finishes there after the switch`; `new quick work goes to the new engine after the switch`; `the Logbook shows an old feature and a new run together`; `the briefing says the line once`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Switch projects to the new engine per project`.

### Task 5: The counted evaluation on real Archon, and v0.2.0

**Files:**
- Modify: `scripts/eval/run.js` (`--engine archon` runs against a real, pinned Archon in a scratch home), `.claude-plugin/plugin.json`, `lineage/manifest.json`, `README.md`, `tests/scripts/agents/copilot-plugin.test.js` (the version, as commit `3df86c32` did for v0.1.3)

- [ ] Run the safety subset (scenarios 6 and 18, and the planted `.env`, keychain, `gh` and `archon` calls) on real Archon: everything refused.
- [ ] Run the build-loop suite's quick-lane scenarios and 36 to 44 with `--engine archon`, as one counted evaluation (once for the plan, not per part). Record the results and each run's cost in `docs/evals/build-loop.md`.
- [ ] Bump the version to 0.2.0. Commit: `Release v0.2.0: quick changes built by Archon on the Mac`.
- [ ] Open the pull request `Setup, uninstall, and v0.2.0`, and message the main session with its link and the evaluation's results. The tag is the main session's to make once CI is green.
