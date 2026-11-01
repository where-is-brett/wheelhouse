<!-- docs/checks/92-lost-owner.md -->

# Check 92: a run that lost its owner

**Answer:** Yes. With the extended patch, `workflow cancel` takes a running run whose owner is confirmed gone, the worktree and its uncommitted files stay, and a fresh run with `--branch` starts on the same folder and finishes. It holds after a killed owner and after a restart's stand-in, and for a run with a child. Part R5 can build its carry-on, with two things it must allow for: a step outlives its owner, and a refused start doesn't look like a refusal.

## Question

Unattended goals design, sections 9.5 and 13, and the plan's part R0b. With a step running, kill its owner. Does `owner_lost` come on the stream? Does the patched `cancel` take the run and keep the worktree, and does a fresh run start on the branch without meeting "Workflow already active on this path"? And the same with every process of the run gone and the wake process started again, as a restart leaves it.

## Tested on

2 November 2026, on macOS 27.0.1 (arm64) with Node.js 22.22.1, Archon v0.13.0 built from source by `buildFromSource` with all three patches, and Bun 1.4.3. The engine and Archon's home were this check's own, in `wheelhouse-archon-checks-92` under the temporary folder, so its database and waker touched no other check's. The workflows have no model step. Nothing was spent.

## Method

`node probes/92-lost-owner/run.js install`, then `node probes/92-lost-owner/run.js trials`. Each lost-owner trial runs `first`, then a `hold` step that loops until `carry-on.txt` appears. The probe adds an uncommitted file, then kills only what the trial names. Before the cancel it tries a fresh run, so the lock is seen to hold; after it, it lets the fresh run through.

The held step comes in two forms: one writes to standard output each second, as a model step does, and one writes nothing, in case a broken pipe was what ended it.

## Evidence

| Trial | Killed | `owner_lost` | Fresh run before the cancel | `cancel` | Files | Fresh run after |
|---|---|---|---|---|---|---|
| `killed-talks` | The owner, with `SIGKILL` | Yes | Turned away | `ok`, `cancelled`, `processStopped: false` | All kept, on the branch | Completed, same folder |
| `killed-quiet` | The same, with a step that writes nothing | Yes | Turned away | The same | All kept | Completed, same folder |
| `restart` | The owner, its step, the waker and the stream; then a new waker, and the stream from the saved cursor | Yes, on the new stream | Turned away | The same | All kept | Completed, same folder |

The row read `running` after everything died, and still `running` 10 seconds after a new waker started: `wake` passes it over, with `accepted: 0` on each pass.

The `terminal` line for a cancelled run came on the stream with `status: cancelled` and `cause: null`. A second cancel was refused: `Cannot cancel run with status 'cancelled'`.

| Control | Result |
|---|---|
| `live-owner`: an owner that answers | As released: `processStopped: true`, owner and step gone |
| `endpoint-gone`: the owner alive, its socket moved aside | Refused, `run … was not changed`, still `running`. With the socket back, the cancel stopped it |
| `child-run`: a parent and child sharing one owner, owner killed | Cancelling the parent took both |

`endpoint-gone` is why the patch asks for more than a silent endpoint. The sockets live in `/tmp`, which the system may clear of old files, so an endpoint can go while its owner runs on. The patch also needs `noExecutorCanWrite`, Archon's own proof that the recorded owner's process is gone from this host.

## What it means for the design

Section 9.5 stands, and R5 must allow for three things:

1. **A step outlives its owner.** In `killed-talks` and `killed-quiet` the step was alive and writing 4 seconds after its owner died, and in `child-run` it was alive after the cancel. A broken pipe didn't stop it. The cancel can't stop it: nothing in the run's record names it, and `processStopped: false` is the only sign. The probe killed it by hand. So R5 must stop the folder's processes before the fresh run, as All stop's `beforeCancel` does in `scripts/engine/stop.js`, or the old step and the new one write in one folder. A real model step may differ. No model step ran here, so that stays unknown, and the safe path doesn't depend on it.
2. **A refused start looks like a start.** `workflow run --branch … --detach` before the cancel printed "Started" and a run id. That run then cancelled itself, with `nodes: []`. "Workflow already active on this path" is only in that run's log under Archon's `logs/` folder. So R5 must confirm the cancel took first, as its plan says, and read a fresh run that ends cancelled with no steps as a start that didn't happen, not as a stop.
3. **The cancel can still refuse.** It does for an owner whose process is alive, one on another host, and one with no record. That includes a reused process id, which reads as alive, and a computer whose host name changed: macOS can change it with the network. Neither was tried. Both land on `a cancel refused leaves the run on a card, and starts nothing`.

Not tried: a loss in the moment a waker takes a paused run, which the patch's second read of the row is there for.

What changed with this check:

- `scripts/engine/archon/patch/paused-run-cancel.patch`: `cancelWithoutOwner` takes the run when the row still reads `running` and `noExecutorCanWrite` holds, through `cancelLost`.
- `CANCEL_PATCH_MARK` moved to the new text, so health finds an engine built before it and setup's step 2 offers the build, and `scripts/engine/pins.js` holds the new digests.
- Nothing in Wheelhouse calls the new path yet. Archon's own `cancel.test.ts` passes 19 of 20. The one failure, `refuses a run that is not running`, uses a paused run, and comes from the patch's first half.

## Needs the director

Nothing.
