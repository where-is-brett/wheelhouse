<!-- docs/specs/2026-11-13-haiku-trial-method.md -->

# The Haiku trial: a faster way of running it

13 November 2026. A design for three changes to the Haiku trial kit (`probes/haiku-trial/`, design `docs/specs/2026-11-08-haiku-trial-design.md`): save and resume by wave, carry on past faults, and group the director's clicks. The director approved the aim; this is the how. The build plan is `docs/superpowers/plans/2026-11-13-haiku-trial-method.md`.

## 1. Why

Since 9 November there have been 28 runs. Four reached a score and none passed. Three habits make each fault expensive:

- **All or nothing from an empty project.** A fault in wave 4 costs setup and waves 1 to 3 again, about three hours, before the fix meets the same moment.
- **One fault per run.** The runner stops at the first fault (15 `throw new Stop` lines in `runner.js`), so each run finds one fault, gets one fix and needs a fresh run. The run logs show the same few stops again and again: "no running feature session names P3/P4" five times, "setup did not finish" three times, "fewer than N pull requests merged in time" twice.
- **The director's clicks block the run.** F6's lift, F5a and F5b each stop the runner on `io.ask` at a moment nobody chose, and runs have waited hours there.

The aim: one run finds every fault it can, the fixes are batched, and each batch is checked from the wave where it matters, in minutes rather than hours. A claim for the record still needs one whole run at the end.

## 2. What changes, in one paragraph each

**Save and resume.** At set points the runner keeps a snapshot of the run: the run folder, the transcripts and a copy of the GitHub side. A resume is a new *attempt* of the same run label: the failed attempt is moved aside (folder and repository renamed, nothing deleted), the snapshot is put back at the same paths, a fresh repository of the same name is pushed from the snapshot, and the run goes on from the snapshot's step. Pre-snapshot GitHub facts that cannot be copied (merged pull requests, their commits, statuses and checks) are answered from the snapshot's capture.

**Carry on.** Each step is either a foundation step (its failure stops the run, because nothing later can mean anything) or not (its failure is recorded as a finding and the run goes on). Inside steps, the places that stop today for want of one thing (a feature session, a merge count, a picker) record what was missing and let the step finish with what it has.

**Group the clicks.** The director's own clicks (the F6 lift, the F5a and F5b undo approvals) gather in sittings at points the director chooses, announced ahead with an estimated time, optionally held to a time window. The trial still never clicks for the director.

## 3. Save and resume

### 3.1 Why a resume reuses the label

A resumed run keeps the run's label, so it keeps the same run folder path, project folder path, repository name and Wheelhouse project name (`<owner>__haiku-trial-<label>`). The alternative, a new label with the records rewritten, is ruled out:

- Wheelhouse's records hold absolute paths and the repository's name: `projects/<name>/project.json` holds `folder`, `remoteUrl` and `repo`; `mirror.git` has the remote; the setup journal holds the project folder; git worktrees hold absolute paths.
- Director actions in the record are signed (`keys/signing.pem`). Rewriting them would be editing signed evidence.

So the paths stay fixed, and what changes is which attempt is at them.

### 3.2 Where snapshots are taken

| Point | When | Why here |
|---|---|---|
| `after-front-desk` (smoke) / `after-ntfy` (full) | end of wave 1 | setup is the slowest, flakiest step (three of the stops); every later fix skips it |
| `after-w2-audit` | end of wave 2 | before wave 3's requests |
| `before-f1` | wave 3, once P3's session is found | F1, F1b and F1c are the most often stopped steps |
| `after-w3-audit` | end of wave 3 | before wave 4's requests |
| `before-sitting-<n>` | before each director's sitting (section 5) | the faults around the clicks |
| `before-f4-check`, `before-s9-1` | wave 4 | the live decision script |
| `after-w4-audit` | end of wave 4 | before wave 5 and the score |

A snapshot point is a step boundary, never inside a step. The list is a constant in the kit (`SNAPSHOT_POINTS`), so `plan` prints it. A smoke run takes only the points on its own steps.

**Quiet or not.** Before an `after-` snapshot the runner waits up to 10 minutes for no feature, small, bug or quick session to be running (read from the record, as `tick` does). The snapshot notes `quiet: true` or the works still mid-build. A `before-` snapshot is taken at once and is usually not quiet. A resume from a snapshot that is not quiet brings those works back through Wheelhouse's own recovery (as a restart of the Mac does: on 13 November the desk's start brought the helper and watcher back unaided), and the resumed run says so (section 3.6).

### 3.3 What a snapshot holds

Snapshots live beside the run, outside every attempt: `~/.wheelhouse-trials/haiku-<label>.snapshots/<nn>-<point>/`.

- `run/`: copies of `project/` (with `.git` and the worktrees), `wheelhouse-home/` (sockets left out), `plugin/`, `state.json` and `run-log.jsonl`. After the copy every `.jsonl` file is read back; a torn last line (a write caught half way) is cut and noted in the meta.
- `transcripts/`: the trial's transcripts as `findTranscripts` lists them, kept with their paths relative to the Claude config folder's `projects` folder.
- `github/mirror.git`: `git clone --mirror` of the repository, without `refs/pull/*`.
- `github/capture.json`: the GitHub reads the kit makes, recorded as `{ path: response }` for everything that exists at the snapshot: the pull list, each pull request's commits, each commit's detail and statuses, each main commit's pulls (`commits/<sha>/pulls`, which the score reads), the workflow runs and the branch list.
- `github/settings.json`: the repository's merge settings (`allow_squash_merge`, `allow_merge_commit`, `allow_rebase_merge`, `allow_auto_merge`, `delete_branch_on_merge`), the default branch, the protection of `main` and the rulesets (setup turns protection on: `host-facts.json` says `protection: on`).
- `github/open.json`: the pull requests open at the snapshot: number, head, base, title, body, draft.
- `meta.json`: label, point, step, time, attempt, the staged plugin's commit, the highest issue or pull request number (`maxNumber`), `quiet`, the works mid-build, torn lines.

A snapshot is about 20 to 40 MB (a whole run folder today is 35 MB), so a full run's snapshots stay under half a gigabyte. They hold the trial's signing key, so they stay on this computer, like the run folders, and never go into a repository.

### 3.4 Resuming

`node probes/haiku-trial/runner.js resume --date <label> --snapshot <nn-point> [--keep-plugin]`

1. **Check.** The snapshot exists and is for this label; `gh` is signed in; the owner is set. Nothing is touched yet.
2. **Stop the attempt.** `restore --force` on the current attempt (its tmux sessions, product, tunnel, helper, watchers and foremen).
3. **One go.** One question names everything outward: "Resume `<label>` from `<snapshot>`: rename the repository `haiku-trial-<label>` to `haiku-trial-<label>-a<n>`, create a fresh public `haiku-trial-<label>` from the snapshot, install the plugin staged from this checkout (`<sha>`) and spend tokens. Answer go." Anything else leaves everything as it was.
4. **Move the attempt aside.** The run folder becomes `haiku-<label>-a<n>`, with that attempt's transcripts moved into its `transcripts-moved/` from the config folder. The repository is renamed to `haiku-trial-<label>-a<n>` (renaming deletes nothing; its pull requests stay readable there). `n` is the next free attempt number, kept in the snapshots folder's `attempts.jsonl`.
5. **Put the snapshot back.** `run/` is copied to the run folder; the transcripts go back into the config folder.
6. **The fresh repository.** In this order:
   1. create `haiku-trial-<label>` (public, same description);
   2. push every branch and tag from `mirror.git`, so `main` and every branch have the same commits and the same SHAs as at the snapshot (the seed commit, merge commits and undo targets all resolve);
   3. line up the numbers: for each number from 1 to `maxNumber`, an open pull request in `open.json` is opened again from its pushed head (and must get its own number, or the resume stops), and every other number is taken by an issue titled "Stands for #<n> in attempt <n>, resumed from <snapshot>" and closed at once. Paced at one a second, under GitHub's limit on making content. Any pull request made after the resume then gets a number the record has never used;
   4. apply `settings.json`: merge settings, then the protection of `main` and the rulesets, last, so the pushes are not refused.
7. **The plugin.** By default the plugin is staged again from this checkout and installed (the existing `stage` and `install` steps run again), since a resume is for checking fixes. `--keep-plugin` reinstalls the snapshot's staged copy instead. Either way the install check (the installed copy is the staged commit) still applies.
8. **Go on.** `state.resumedFrom` records the snapshot, the attempt, the plugin before and now, `maxNumber`, `quiet` and the works mid-build. The runner starts a fresh front desk (the `front-desk` step again; the director may open a new desk at any time, and Wheelhouse's helper and watcher come back with it) and goes on from the step after an `after-` point, or from the step itself for a `before-` point.

### 3.5 Counts relative to the snapshot

A resumed run's `io.gh` is wrapped (`snapshotGh`):

- **Lists** (`pulls?state=all`, `actions/runs`) answer the capture's items joined with the live repository's items numbered above `maxNumber` (pull requests) or made after the snapshot (runs). A pull request opened again at its own number is taken live, not from the capture.
- **Items** (`pulls/<n>/commits` for `n ≤ maxNumber` not reopened; `commits/<sha>`, `commits/<sha>/statuses` and `commits/<sha>/pulls` for a SHA in the capture) answer from the capture.
- Everything else, and every write, goes to the live repository.

So `mergedPulls`, `waitMerged`, `pullOf`, `p6Sha`, `gatherContext` and the score count the whole run's pull requests without any change of their own: a wave-3 merge wait after a resume from `after-w2-audit` still asks for the same total.

### 3.6 What a resumed run cannot claim

A resumed run is for finding and checking fixes. Its summary says, at the top: "Resumed from `<snapshot>` (attempt n). Not a run for the record: a passing claim needs one whole run." And it lists, plainly:

- **Two builds of Wheelhouse.** Steps before the snapshot ran on the plugin staged then (`<sha>`); steps after it on this one. Rows whose evidence lies wholly before the snapshot are marked "carried from the snapshot (plugin `<sha>`)".
- **A restart in the middle.** Works mid-build at a snapshot that is not quiet came back through Wheelhouse's recovery. Rows 33 and 34 (F3, F3b) and the reliability log may show restarts that a whole run would not have had.
- **A new front desk.** The desk's conversation starts again at the resume; rows read from the desk pane cover only what it said after.
- **GitHub history from the capture.** Merged pull requests before the snapshot, their reviews, statuses, checks and comments exist only in the capture and in the renamed repository. A placeholder issue stands at each of their numbers. If Wheelhouse itself reads one of them from GitHub (for example `gh pr view <n>`) it finds an issue, not a pull request; the kit cannot see such reads, so any finding about an old pull request after a resume is checked again in a whole run.
- **CI history starts again.** The pushes start the repository's workflows afresh on the pushed heads; earlier runs are in the capture only.
- **Cost and time.** Usage and the clock are reported for the resumed part, with the snapshot's figures beside them, never summed into one figure for the trial.
- **The score.** It is measured as usual on `main`, and reported as "would pass" or "would not pass", never "passed".

## 4. Carry on past faults

### 4.1 Two kinds of step

- **Foundation steps** stop the run when they fail, because nothing after them can mean anything: `stage`, `create-repo`, `install`, `seed`, `setup-s0`, `front-desk`, and the missing `HAIKU_TRIAL_GH_OWNER` check.
- **Every other step** that throws (a `Stop` or any other error) is recorded as a finding, `{ step, what, at }` in `state.findings` and the run log, and the run goes on to the next step. Its log entry is `done` with `outcome: 'failed'`, so `--from auto` moves past it; `--from <step>` runs it again.
- **A step that needs another** says so (`needs: ['f6-stop']`). When a needed step failed or was skipped, the step is skipped with "skipped: needs `<step>`, which failed", and that is a finding too.

`run` returns `{ done, findings, stoppedAt?, why? }`; the exit code is 1 when the run stopped or found anything.

### 4.2 The stop sites today

The brief counted 16; there are 15 `throw new Stop` lines in `runner.js` today. Each one, and what happens instead:

| Line | Today | Instead |
|---|---|---|
| 152, 154 `ghDo` | a failed create or merge stops | stays a throw; in `create-repo` it stops (foundation); in the spare bug's pull request it makes P5 not covered (`p5Why`) and the run goes on |
| 176 `mustBeAlive` | a session that ended by itself stops | the setup session: stays (setup is a foundation step). The front desk: started again once per wave, as a director would open it again, and a finding; a second loss in one wave stops |
| 246 `waitMerged` | a short wave stops (waves 3, 4, smoke 4) | every wave is soft, as wave 2 is now; the shortfall adds up in `state.shortfall`, and later waits ask for that many fewer |
| 405 trust prompt | stops | stays: a session that cannot start stops a foundation step; elsewhere (the desk started again) it is a finding |
| 431 `answerPicker` | stops | returns false and records the picker once; the stale-picker and check-in logic go on. In setup, setup's own time limit decides |
| 511 `pieceEnv` | no session after 40 minutes stops | returns null and records it; the piece is remembered as having no session, so F1b, F1c and later P4 steps do not wait another 40 minutes (a session that turns up later is still found, without a wait) |
| 527 audit | another model stops | a finding with `claimLost: 'model audit'`: the run can no longer pass, but goes on finding faults |
| 566, 570 install | stops | stays (foundation) |
| 629 setup | stops | stays (foundation) |
| 913, 916 decision 3 | stops | a finding; `decisionN` stays null |
| 925 review card | stops | the card is shown without the typed-answer step; that row is not covered, with the reason |
| 1059 owner | stops | stays |

### 4.3 What the rows say

A fault step that could not run records `faults.<id> = { notExercised: <why> }` (F1, F1b, F1c, F3 as now, and the s9 steps with no decision 1). Rows 14, 15 and 23 read `notExercised` as "not covered: `<why>`". Rows 36 to 40 already say "not covered: the run stopped before…" when their step never logged; with carrying on they also read a failed step's finding. The summary gains a **Findings** section: each finding, its step, and the rows it leaves uncovered; and a run with `claimLost` says at the top that it cannot pass.

## 5. Group the director's clicks

### 5.1 The clicks

| Click | What the runner does first | Time-critical? |
|---|---|---|
| **Lift All stop** (F6) | types `all stop`, then `undo <P6 sha>` (refused under the stop), waits 5 minutes, types `lift all stop` | yes: All stop holds every merge and start until the lift, and the lift needs the director's signed click (`scripts/desk/acts.js`: "Lifting All stop needs the director's signed Lift All stop") |
| **Approve the undo of P6** (F5a) | types `undo <P6 sha>` after the lift | no: the card waits in the record |
| **Approve the undo of P2** (F5b) | types `undo <P2 sha>` once P2 and P3 have merged | no: the card waits in the record |

The phone-alerts click (wave 1) and the review (wave 6) are already announced and are not part of a sitting. The runner still never clicks: it types, and watches the record for the director's signed action (`lift-stop`; `undo-merge` or `keep-main` naming the merge).

### 5.2 Sittings

The three clicks move out of the step list into **sittings**: one step, `sitting-<n>`, does the typed parts of every click in it and waits for the director's clicks, together.

- **Where.** `--sitting <point>` places a sitting; points are `w3` (after F1c, while P3 builds, the design's original moment for F6 and F5a), `w4` (after `w4-type`, while P4 builds) and `end` (before `score`). The default is one sitting at `w4`: the first point where all three clicks can be done together. A click goes in the first sitting where it can: F6 needs a work building and P6 merged; F5a needs the lift; F5b needs P2 and P3 merged. `--sitting w3 --sitting w4` keeps the original order (F6 and F5a in wave 3, F5b in wave 4).
- **The change from section 7.3 of the trial design.** With the default, F6 and F5a happen in wave 4 while P4 builds, not in wave 3 while P3 builds. All stop is still set while a session builds and while a merge waits, so rows 38 to 40 test the same thing. A whole run for the record may use `--sitting w3 --sitting w4` to keep the original order.
- **F5a's target.** Before it types the undo, the runner checks whether any later commit on `main` touched P6's files (run r's F5a clashed because a later piece edited `tests/money-edge.test.js`). If so, it records "F5a will clash: `<commit>` touched `<file>`" in the findings and goes on, so the row's failure is read as the kit's, not Wheelhouse's.

### 5.3 Announced ahead

At the start of the run, at the end of each wave and on a resume, the runner writes `director.md` in the run folder and prints its first line:

- each sitting still to come: its clicks, an estimate ("between 14:10 and 16:40 today"), and about how long it takes (5 minutes for one click, 10 for three);
- the estimate is the sum of the remaining steps' typical times (`TYPICAL_MS`, from the finished runs' logs) for the early edge, and of their time limits for the late edge.

### 5.4 Asked once, or held to a window

- **Without a window** (the default), the sitting asks once when its point comes: "Sitting 1: three clicks in the helper window, about 10 minutes. Answer ready when you are at the screen." Then the runner does each typed part and tells the director what to click next (`io.log`), watching the record. It does not ask "done": the signed action is the answer. Each click waits up to 15 minutes.
- **With `--window HH:MM-HH:MM`** (repeatable, local time), the sitting does not ask: if its point comes inside a window it starts at once; before a window it keeps looking (the stand-in still answers cards and checks in) until the window opens, then starts; with every window past it is skipped. The director chose the time, so the wait is theirs; builds carry on meanwhile.
- **A click that does not come** is a finding, never a stop: the rows that need it are "not covered: the director's click did not come in sitting n". A skipped F6 lift leaves All stop on, so the sitting then asks once in the terminal, "All stop is still on: lift it in the helper window when you can", and the run waits for that lift before anything else; that is the one wait that cannot be avoided, and it is announced.

## 6. What stays as it is

- The script of words, the faults' expected outcomes, the 45 rows and the score (trial design sections 6, 8, 10).
- The director's go before anything is created, and the trial's own Wheelhouse home and config folder.
- `restore` stops what an attempt started and deletes nothing.
- No snapshot or resume touches a run that is going on: the runner refuses `resume` while the label's tmux sessions are alive, unless `restore` stopped them in step 2 of the resume itself.

## 7. Out of scope

- Deleting renamed repositories or archived attempts. They wait for the director's word.
- Copying merged pull requests into the fresh repository. GitHub has no way to do it; section 3.5 reads them from the capture instead.
- Resuming a run that began before this build: it has no snapshots.
