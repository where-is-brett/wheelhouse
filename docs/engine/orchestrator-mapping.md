<!-- docs/engine/orchestrator-mapping.md -->
# The engine interface, mapped to Orchestrator.inc

The fallback if Archon fails (Archon design, section 6.5). This page maps each part of the engine interface (`scripts/engine/contract.js`) to what Orchestrator.inc offers, so a second adapter could be written behind the same interface. Check it at each monthly upgrade of Archon, beside the safety subset.

Orchestrator.inc runs a local daemon reached over HTTP. Nothing in this note has been tried against it yet: it is a reading of its documentation, to be confirmed by a short trial before any switch.

| Interface | What Archon's adapter does | What an Orchestrator.inc adapter would do |
|---|---|---|
| `health()` | `archon version`, `archon telemetry status` (off, or the engine isn't started), the Claude tier's check | The daemon's status call, plus Wheelhouse's own checks of its version pin and its telemetry |
| `start(order)` | `archon workflow run <pack workflow>` with the work order as its input, in the project's worktree folder | A task created through the daemon's API, with the worker role and Wheelhouse's prompts from its pack |
| `watch(cursor)` | `archon workflow status` and each run's record, turned into run-started, step-finished, ask, ask-resolved and run-ended events | The daemon's event stream, turned into the same five events |
| `act(runId, …)` | answer an approval or question node, `archon workflow cancel`, `archon workflow resume` | The task's reply, cancel and resume calls |
| `inspect(runId)` | the run's record: steps with role, model, tokens and cost, branch, pull request | The task's details; its cost records skip Copilot, as Archon's do, so the spend meter's estimate carries over |
| `stopAll(reason)` | cancel every running or pending run, then All stop ends what is left by pid (`scripts/engine/stop.js`) | Cancel every task through the daemon, then the same ending by pid |
| `wakeCommand()` | the continuation host carries answered runs on | The daemon keeps tasks going itself; the host would only watch |
| `ownsProcess(command)` | a process is Archon's when its command is the pinned build's | The daemon's own processes, by their command |

## What would change beyond the adapter

- **The pack.** Orchestrator.inc has worker and reviewer roles in place of Archon's workflows. Wheelhouse's prompts go into those roles.
- **The gate comes back to Wheelhouse.** Orchestrator.inc merges in one call with no gate. The broker's permit would grow back to the full gate the helper has today (`scripts/gate/conditions.js`), which is kept in the repository for that reason until Archon has held for three months.
- **Nothing else in the core.** The dispatcher, the card router, the spend meter, the Logbook and the records read only the interface's events.
