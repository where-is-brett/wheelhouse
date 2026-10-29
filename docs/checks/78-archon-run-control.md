<!-- docs/checks/78-archon-run-control.md -->

# Check 78: Archon's run control (early check E5)

**Answer:** Partly. The ask side passed: over 50 trials, 150 asks, none was lost and none was answered twice, with the attention stream or the waker restarted, or the stream's cursor put far behind, in each trial. The cancel side did not: a cancelled run cannot be resumed (Archon refuses it), and a cancel left one process alive that had moved itself into its own session. The sleep of the computer was not run.

## Question

Whether `workflow wake --watch` and the attention stream survive a restart of the helper, a sleep of the computer and a missed cursor, with no ask lost and none answered twice; whether a cancelled run resumes, skipping finished steps and keeping its worktree as it was; and whether cancelling a run with a child run and sleeping scripts leaves any process or child run alive (spec 6.3, 12.3 and the E5 row of section 15).

## Tested on

29 October 2026, on macOS 27.0.1 (Apple silicon), with Archon 0.13.0 and Bun 1.4.3 from the scratch engine of `probes/lib/archon.js`, run with the environment of spec 6.3. No model step ran: every workflow is waits, shell steps and script steps, so the trials cost nothing. Fifty ask trials took about 15 minutes (16 to 22 seconds each). The cancel trials were run twice (the second time with two more kinds of sleeping step). The raw event logs are kept with the build's working papers, not in the repository.

## Method

`node probes/78-archon-run-control/run.js trials 50` and `node probes/78-archon-run-control/run.js cancel`. The harness stands in for the helper's continuation host (spec 6.3).

**The ask trials.**
- **The workflow** (`waits.yaml` with `child.yaml`): an attention wait (`ask-one`), a child run (`workflow:`) that has its own attention wait (`child-ask`), a second attention wait (`ask-two`) and a closing shell step. Three asks a run, so 150 in all.
- **The host.** One `attention --watch --json` follower and one `workflow wake --watch --json`, started by the harness and restarted if they stop on their own. The follower answers each ask it is delivered, for runs the harness started and their child runs, with `workflow answer --occurrence <id> --choose a --json`. The cursor is kept in a file under the rule of spec 6.3 and the Operate page: a bookmark or the end of the snapshot is saved at once, and any other line saves the cursor of the line before it, once a line with a different cursor arrives, so the event being handled is never the one saved.
- **The disturbances, in turn** (17 follower, 17 waker, 16 cursor; about half straight after the run started, the rest after its first answer): kill the follower with SIGKILL, wait 2.5 seconds, restart it from the saved cursor; kill the waker the same way and restart it; kill the follower and restart it with `--after` set to the first cursor of the whole experiment, far behind the saved one. Only the harness's own processes, by pid.
- **The ledger.** Every stream line and every accepted answer is logged. A trial passes when each of its three expected asks (the run's two and its child's) was delivered at least once and its answer accepted exactly once. In the cursor trials the harness's own duplicate guard was switched off, so that if an ask were delivered again it would be answered again, and the engine's refusal of a second answer would decide. If a run had not finished 75 seconds after its start, the trial would be marked stalled and rescued through `attention --json`.
- **Not run: the sleep.** `pmset sleepnow` was not run, by the main session's instruction. Whether a wake can be scheduled without a password was checked without sleeping: `pmset schedule wake "10/30/2026 06:00:00"` answered `pmset: This operation must be run as root`. So a wake cannot be scheduled from an agent's session; a sleep trial needs the director at the lid, or a root step.

**The cancel trials** (`resume.yaml`, `tree.yaml`, `sleeper.yaml`; each in its own worktree).
- **Resume.** A run of three shell steps: the first writes a file and a time stamp, the second leaves a marker, a partial file and sleeps, and the third writes a file. The run is cancelled while the second sleeps, then `workflow resume` is tried. Then the fallback for Carry on: a fresh `workflow run` on the same branch.
- **Tree.** A run with a child run (a script step and a shell step that sleep), a shell step that sleeps, a script step that sleeps, a step that starts `nohup sleep 741 &` before sleeping, and a step that starts `sleep 747` in a new session (`perl POSIX::setsid`, then `exec`) before sleeping. Before the cancel, the harness records the process tree of every run owner (read from `execution_owner.pid` of `workflow get`). Ten seconds after the cancel it looks at those pids and at any process matching the trial's sleeps; the survivors are killed by pid afterwards.

**Undo.** Everything was in a scratch project (a local bare repository as its remote) under the system's temporary folder, and in the scratch Archon home (the project's own workspace folder there). The survivor was killed by pid. No settings or files outside those were written.

## Evidence

**Ask trials: 50 of 50 completed, none stalled.**

| Disturbance | Trials | Asks | Lost | Answered twice |
| --- | --- | --- | --- | --- |
| Follower killed and restarted | 17 | 51 | 0 | 0 |
| Waker killed and restarted | 17 | 51 | 0 | 0 |
| Cursor put back to the first cursor | 16 | 48 | 0 | 0 |
| Total | 50 | 150 | 0 | 0 |

- **A restarted follower picked up what it missed.** 26 of the 150 asks were first delivered in a new stream's snapshot (the ask opened while the follower was down); the stream's open set is the recovery, so a cursor is not needed for an ask that is still open.
- **Every ask was delivered exactly once.** No ask was delivered twice in any trial, even with the cursor put back (a delivery count of 1 for all 150). The documentation says delivery is at least once; this was not seen, so the duplicate guard was never what saved a trial. It was therefore not tested by a real duplicate. What was tried instead: a second answer sent for a finished run was refused (`was already resolved or is no longer paused at the expected gate`), and a stale occurrence is refused with the current one named.
- **Putting the cursor back replays only the ends of runs.** Replaying from the first cursor sent `terminal` lines for every earlier run (1,049 across the experiment) and never an old `attention` line, since an ask that was answered is no longer an open item. The cursor is not a way to recover an ask; the snapshot is.
- **No lines of the kinds that signal trouble:** no `degraded`, `error` (`cursor_invalid`) or `owner_lost` line, and no answer was refused or failed. The supervisor never had to restart a process that stopped on its own.
- **A killed waker lost nothing.** Killing it straight after a run started, or after the first answer, left every run to be continued by the new waker within its five-second pass. The segments here are short (a shell echo), so a waker killed in the middle of a long segment was not tried: Archon's documentation says an abrupt kill of a running segment is not recovered automatically (the run's owner is gone), and the stream reports `owner_lost` for it.
- **Two things about running together.** `wake` scans every project in the install's database, so a waker started for this check would also continue another check's answered runs; and a run started with `--no-worktree` is refused while another run is active on the same path (`Workflow already active on this path`). The trials ran one run at a time on one path for that reason; runs in worktrees have separate paths.

**Cancel and resume.**

| What | Result |
| --- | --- |
| `workflow cancel` of a run in the middle of its second step | `ok`, status `cancelled`, `processStopped: true`; the step's `sleep 731` was gone ten seconds later |
| The worktree after the cancel | As it was: the first step's file and time stamp, the marker and `partial.txt` all still there |
| `workflow resume <run>` | Refused, in both trials: `Cannot resume run with status 'cancelled'. Only failed or paused runs can be resumed.` The run stayed cancelled |
| A fresh `workflow run <same workflow> --branch <the run's branch> --detach` | Started on the same worktree (the same path), ran to completion: the first step ran again (a new time stamp), the second found its marker and finished, the third ran. `partial.txt` was kept. Finished steps were not skipped |

**Cancel with a child run and sleeping steps** (the second trial; the first, with only the child run, the shell step and the script step, found nothing alive).
- Before the cancel, one owner process (the detached run's, whose parent is process 1) held the whole tree: the parent's and the child run's steps, thirteen processes in all, including two `bun` script processes and six `sleep`s. The child run shares the parent's owner.
- After `workflow cancel` (status `cancelled`, the child run also `cancelled`, and a warning that no survivor or cleanup is confirmed), ten seconds later: every process was gone **except `sleep 747`**, the one started in its own session. The shell step's `nohup sleep 741 &` background job, which stays in the step's process group, was ended. No child run was left alive (the child's status was `cancelled`).
- The survivor was a child of the step's shell at the time of the cancel, so the pid tree recorded before the cancel contained it.

## What it means for the design

Part 3a builds the following.
- **The backstop is cheap insurance, not a repair.** Nothing was lost, so the evidence does not show the 15-second `attention --json` backstop to be needed. It stays, as the design says, because this check could not cause the cases it is for: a sleep of the computer (not run), a stream that goes silent without a `bookmark` for well over 30 seconds, a `degraded` line, and a killed waker in the middle of a long step. The follower should treat a missing `bookmark` for 60 seconds as a stuck stream and restart it, as the Operate page says.
- **The restart rule that works:** reconnect with the saved cursor if there is one, expect the open asks again in the snapshot, and answer each ask once by keeping a record of (run, node) answered. Save the cursor as the Operate page says (bookmark at once, otherwise the line before). A cursor put back is harmless: it replays ends of runs, which the adapter takes as news it has already had.
- **Process-tree kill in `stopAll` (spec 12.3) is needed, with a pre-cancel record.** One process that started itself in a new session (what a daemon or a `setsid` does) survived `cancel`, though the cancel reported success and the run was `cancelled`. `stopAll` must take the process tree of each run owner **before** it cancels (the owner's pid is `metadata.execution_owner.pid` in `workflow get --json`; a survivor is still a child of its step's shell then, but is reparented to process 1 once the shell goes), cancel, wait ten seconds, and kill what is left by pid. A process that has already moved to process 1 before the snapshot (a real daemon started by an earlier step) is not found this way; for that the fallback is the run's worktree: processes whose working folder is the worktree (`lsof +D`), which Archon's own warning also suggests. The Logbook says if a process had to be killed.
- **Resume after cancel does not work, so Carry on restarts the lane on the same branch.** This is the fallback of the E5 row, and it works as specified: a fresh run with `--branch <the lane's branch>` takes over the same worktree with everything in it. It does not skip finished steps: every step runs again, so the order it is given must say "carry on from what's there", and a lane's steps must tolerate being run again over their own results. A paused run (a wait, an ask) does resume, and a failed run does; only a cancelled one does not. So `stopAll` cancels, and Carry on starts a new run on the branch, as the design says. The spend of the first run is lost to the lane's cap record unless the adapter adds the cancelled run's spend to the new run's.
- **Not tried:** whether a run whose owner is killed instead of cancelled (left `running` with its owner gone) could be resumed with its finished steps skipped. The documentation says `resume` and `run --resume` accept a `running` run whose owner is gone after a day of no activity; that is no use for All stop, and is a lead only.
- **The check does not settle the sleep.** The note's sleep line is "not yet run".

## Needs the director

Nothing for the director as such. The sleep of the computer is arranged separately by the main session: a trial there needs the lid closed for one minute (a wake cannot be scheduled from an agent's session, since `pmset schedule` needs root), and the director's hand for that goes through the main session. The decision for a card is that **Carry on restarts a cancelled lane on the same branch and cannot skip finished steps**, which section 12.3 of the design describes as "resumes it and skips finished steps".
