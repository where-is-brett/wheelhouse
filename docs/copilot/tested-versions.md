<!-- docs/copilot/tested-versions.md -->

# Tested versions of Copilot

Copilot CLI updates often, and its hooks and flags have changed between versions. Wheelhouse therefore pins the CLI to the version its trial checks ran on, and runs its safety scenarios again before it uses another. This page lists what has been tested and says where the pin is kept. It is the record of the Copilot return (`docs/specs/2026-11-10-copilot-return-design.md`).

## The pin

**Copilot CLI 1.0.105**, set in `scripts/agents/copilot/numbers.js` (`COPILOT_VERSION`), carried into `lineage/manifest.json` as `agents.copilot.cli` through `scripts/agents/pins.js`, and checked by `scripts/lineage/`. Before every Copilot session starts, `scripts/agents/copilot/versions.js` reads the installed version (`COPILOT_CLI_BINARY_VERSION` in a hook's environment, else `copilot --version`, asked once per process) and compares it with the pin:

- **The pinned version** passes with nothing run.
- **Any other version, or one that can't be read,** is checked against the version last checked. The same version passes; a change runs the safety subset once. A pass is kept as checked and lifts the project's version hold. A failure writes the hold, which stops that project's Copilot work and raises one card, and it lifts when Copilot is back at the pinned version or a newer version passes.
- **No safety-subset runner is wired in yet:** `adapters/copilot/sessions.js` gives the check `noSubsetRunner`, which fails. So today only the pinned version runs, and any other version holds Copilot work.

## What was run on 1.0.105

| Stage (design section 7) | Date | What it showed | Where it is recorded |
|---|---|---|---|
| T1, capture; T2, guards | 10 November 2026 | Hooks add context at the start of a session and of a prompt; a turn's end and a subagent's end can send work back, and the subagent's stop names the agent; a session id is given up front; the events file carries token counts; a compaction can't be stopped by a hook (manual one run); a hook past its time-out lets the action through; a resume counts as a request; the allowance resets on the 1st. The scripted guard attempts moved to T4 | `docs/checks/96-copilot-trial-t1-t2.md` |
| T3, a piece of work | 14 November 2026 | One quick-lane change from the First Mate's order to the helper's local merge, killed once mid-task and resumed by session id: 2 requests | `docs/specs/2026-11-10-copilot-return-design.md`, section 5.2; the runner is `probes/copilot-t3/` |
| T4, the evaluation (first run) | 12 November 2026 (two more requests on 13 November settled the rule form) | 38 passed; 39 was retargeted to Copilot's `sql` tool; 40 and 41 found that a shell rule must name a launcher (`wh-frontdesk`, `wh-feature`), not a script path | `docs/evals/copilot.md`, "The first real run" |

T3 and T4 have no check note of their own; their records are the two places in the last column. The fixtures in `tests/fixtures/copilot/` were captured at 1.0.101 and extended at 1.0.105 by check 96 (`userPromptSubmitted`, `agentStop`, `sessionEnd`, `preCompact`, and one run's output and usage file). Nothing has yet re-captured them all at 1.0.105.

**Not yet run:** T5 (the click, check C6) and T6 (a Windows work computer) are the director's two sittings. `C6_PASSED`, `REVIEW_SESSION_READY` and `COPILOT_SANDBOX_CHECKED` are off until their own checks pass. `BACKGROUND_SESSIONS_READY` is on; a guard firing in a session the watcher started, a resume in the same home and the foreman's quoted shell rule are seen live only in T5 and T6.

## VS Code and its Copilot runtime

VS Code and its Copilot runtime update every week and can't be pinned. The VS Code add-on is parked (`docs/parked.md`), so nothing reads their versions from the add-on's record today. The director talks to Copilot's First Mate in VS Code's chat, and that use is first tried at T5. A pair of versions counts as tested only when a row below says **passed** in its Result (`isTested` in `scripts/agents/copilot/versions.js` reads this table). The version check above does not call it today; it goes by the CLI pin.

| VS Code | Copilot runtime | Tested on | Result |
|---|---|---|---|

The table has no rows: Wheelhouse's safety scenarios haven't been run in VS Code.

## Moving the pin

The pin is the version the trial's checks ran on, so a new version is run through the trial's stages (`docs/copilot/trial-harness.md`) before it replaces the pin. Then change `COPILOT_VERSION` and write the manifest again: `verifyManifest` in `scripts/lineage/manifest.js` breaks while the manifest's `agents` pin and `scripts/agents/pins.js` differ. Re-capture the fixtures at the new version.
