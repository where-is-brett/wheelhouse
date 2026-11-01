<!-- docs/checks/85-many-paused.md -->

# Check 85: many paused runs

**Answer:** Yes. Archon's database held with 6 paused runs for an hour beside 6 other live runs, and in 20-minute runs at 6, 8 and 10 paused. Answers sent to all the paused runs in one tick were all accepted, none lost and none doubled, and a repeat answer was refused. The parked limit in part 2a can take 10 as measured; the margin above 10 wasn't tried. An answered run continues only while Archon's waker runs. A run whose `start` timed out can't be told by its branch or path.

## Question

Delegated-decisions design, check D1 (section 16), and the plan's part 0b. With `pace` running plus the merge queue, a fix-lane run, the reader and 6 paused runs, does Archon's database hold over an hour? Do answers delivered together stay safe? Which fields does `workflow status --all --json` give for a run, and can a run started with a timed-out `start` be told by its branch or path (part 2b's `liveRunOf` is built on that)?

## Tested on

1 November 2026, on macOS 27.0.0 (arm64) with Node.js 22.22.1, Archon v0.13.0's compiled binary and Bun 1.4.3 from `probes/lib/archon.js`, in a scratch folder of its own (`wheelhouse-archon-checks-85`, scratch home, telemetry off). No step used a model, so it cost nothing. Seven idle test processes from check 82 were on the computer; they use no CPU.

## Method

`node probes/85-many-paused/run.js stage <paused> <minutes>`, and `fields` for the field questions.

- **The load.** Three loops, a merge-queue stand-in, a fix-lane stand-in and a reader stand-in (each a script step that holds a run open), plus the paused runs (one attention wait, then a script). Each run in its own worktree.
- **The polling.** As the helper polls: `workflow attention --json` and `workflow status --all --json` every 5 seconds, and `workflow get --json --verbose` on every run every minute.
- **The waker.** `workflow wake --watch --json`, as the helper keeps one.
- **The answers.** At the end, one `workflow answer` to every paused run at the same moment, then a second answer to each. The ask ledger of check 78 (`askLedger`) counted deliveries and accepted answers.

## Evidence

| Stage | Polls | Failed polls | Lock errors | Answers accepted in one tick | Lost / doubled | After |
|---|---|---|---|---|---|---|
| 6 paused, 60 minutes, no waker | 695 | 0 | 0 | 6 of 6 | 0 / 0 | The 6 answered runs stayed paused: nothing woke them |
| 6 paused, 20 minutes | 232 | 0 | 0 | 6 of 6 | 0 / 0 | All 6 completed |
| 8 paused, 20 minutes | 232 | 0 | 0 | 8 of 8 | 0 / 0 | All 8 completed |
| 10 paused, 20 minutes | 232 | 0 | 0 | 10 of 10 | 0 / 0 | All 10 completed |

In every stage all 6 other runs were still running just before the answers, and a second answer to each paused run was refused ("already resolved or is no longer paused at the expected gate").

Two probe mistakes, neither changing the answer. A first hour started every run with `--no-worktree` in one folder, and each start cancelled the one before, so nothing was measured; runs go in their own worktrees. The 60-minute stage ran before the waker was added, which is why its answered runs stayed paused; the 20-minute stages ran with it.

**Fields.** `workflow status --all --json` gives, for each run, `id`, `workflow_name`, `status`, `outcome`, `user_message`, `started_at`, `completed_at`, `last_activity_at`, `working_path`, `output_root`, `parent_run_id`, `adopted_from_run_id`, `codebase_id`, `codebase_name`, `conversation_id`, `platform_type`, `origin`, `metadata`, step counts (`current_step_index`, `current_step_name`, `total_steps`, `active_nodes`, `agents_*`) and `attention` (the paused ask: `node`, `occurrence`, `message`, `options`). It gives no `branch` field. The attention item carries `context.branch` and `context.workingPath`. A run's `metadata` holds `execution_owner` (host, pid), `owned_worktree`, `wait` and `pause_cause` once it is running, and `cli_detached_launch_token` for a detached start.

**A timed-out `start`.** The client stopped after 1.5 seconds. With a worktree (a chosen `--branch`, or the default) it left a run in `pending` with no `working_path`, no branch and no `execution_owner`; its `metadata` held only the model settings and workflow source. Only `workflow_name`, `started_at` and `user_message` tell it from another run. With `--no-worktree` the run was already `paused` with its `working_path` set. So a worktree run in `pending` can't be told by its branch or path, and 2b's `liveRunOf` has to work from the workflow name, start time and message. Whether a message or the launch token can be chosen by the caller wasn't tried.

### What was not tested

More than 10 paused runs, or more than an hour at 8 and 10. A waker that stops mid-hour. A start with a chosen message or token.

## What it means for the design

- Part 2a's parked limit takes 10, with the load above. No lock showed at 10, so the limit may not be the engine's.
- Part 2b: an answer is not enough; the waker must be running for the run to continue.
- Part 2b's `liveRunOf` can't rely on a branch or path for a `pending` run.

## Needs the director

Nothing.

Evidence files: `probes/85-many-paused/run.js`, tested by `tests/probes/85-many-paused/run.test.js`. The logs and summaries of each stage are in the scratch folder only.
