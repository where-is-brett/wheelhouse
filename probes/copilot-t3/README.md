<!-- probes/copilot-t3/README.md -->
# Copilot trial stage T3: a piece of work

The runner for stage T3 of `docs/specs/2026-11-10-copilot-return-design.md` (section 7, part 10). It drives one quick-lane change on a throwaway project kept on this computer (local hosting), from the First Mate's order to the helper's merge, kills the Copilot session once mid-task and resumes it by id. It records requests per step, to replace section 5.2's estimate, and whether subagents are charged.

Nothing here runs by itself. `plan` spends nothing; `run` starts real Copilot sessions and spends requests.

```
node probes/copilot-t3/runner.js plan
node probes/copilot-t3/runner.js run --label <label> [--from auto|<step>]
```

## Budget

10 requests for the stage, Auto only: no `--model` and no `COPILOT_MODEL` is ever passed (the adapter's `auto-only` plan). `budget.js` reserves each run before it starts and refuses one that would pass 10 for the stage or 150 for the month, so the stage stops before it goes over. `month-check` reads the month's use (GitHub's figure through `gh api /copilot_internal/user`, which costs no request, else the ledger's count) and stops the stage when it can't.

The CLI's count is cumulative for a session across resumes (check 96), so each run is settled as the rise since the session's last figure. A run that leaves no figure (the killed one, when its usage file was never written) counts as 1, marked *assumed* in the summary.

## Steps

`stage` and `month-check` are foundation steps: a failure stops the run. Any other step that fails is a finding and the run goes on; a step whose needs failed is skipped with a finding. A budget stop ends the run, and the report is still written.

| Step | What |
|---|---|
| `stage` | The project under `~/.wheelhouse-trials/copilot-t3-<label>/project`, a scratch Wheelhouse home beside it with its own signing key, the project registered as in git alone, and its home made |
| `month-check` | The month's use, and the budget |
| `order` | The First Mate's order for the change, and the feature branch's worktree |
| `build` | The feature session starts with a session id given up front; once its first tool call has ended it is killed |
| `resume` | The same id resumed (`--resume=<id>`), to finish |
| `merge` | The change opened and merged by the local adapter, as the helper's gate would |
| `report` | Requests per step, subagent runs, the figures against section 5.2's 3 to 5 |

Files in the run folder: `run-log.jsonl`, `state.json`, `summary.md`. After each step a snapshot goes to `~/.wheelhouse-trials/copilot-t3-<label>.snapshots/`, in the Haiku trial's form. `--from auto` goes on from the run-log; `--from <step>` runs that step again.

## Before the real run

- Copilot must be signed in (`WHEELHOUSE_EVAL_COPILOT_SIGN_IN` names a folder signed in on its own, as the evaluation runner reads it).
- The start's version check holds a Copilot CLI that is not the pinned one until the safety subset passes (`adapters/copilot/sessions.js`), so a run on another version stops at `build` with that reason.
- Whether subagents are charged shows only if the session uses the `task` tool; the report says "not seen" otherwise.

## Tests

`tests/probes/copilot-t3/`: the budget, the runner against a stand-in host whose sessions are real child processes (so the kill is real), and the real host's project, worktree and merge with no session.

## A limit of the live cap

A run is killed when its spend reaches what the budget has left for it, read from its usage checkpoints. A run that ends with no checkpoint was never held to that cap while it went. It is settled on its final figure, with a finding and a line saying so, and if it spent all it was given the stage stops before the next run.
