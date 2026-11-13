<!-- probes/haiku-trial/README.md -->
# The Haiku trial kit

The kit runs Wheelhouse on Haiku alone, on a throwaway spending tracker, and scores what comes out. The design is `docs/specs/2026-11-08-haiku-trial-design.md`. The runner plays the director with a set script of words, injects the faults, reads the 45 path rows, scores the product and writes the results. It is a script, so it costs no tokens itself.

Nothing in the kit runs by itself. Building it created no repository, no preview and no session.

## Full against smoke

- **Full** (`full`): setup, pieces P1 to P8, every fault, the wait past midnight and the director's review. About 5 hours of waves plus the wait for midnight.
- **Smoke** (`smoke`): setup, then P1, P2 and P6 together, then P4 with steps 1, 2 and 4 of the live decision script. It scores only reconciliation and the project's own tests, with no pass bar. It leaves out undo, so it needs no director once the go is given. Use it after a change to prompts or checks, never for the tag.

`node probes/haiku-trial/runner.js plan` prints both plans and spends nothing.

## What waits for the director's go

The runner stops and asks before each of these, and goes on only for the answer `go`:

1. **The GitHub repository** (`create-repo`): a public repository named `haiku-trial-<date>` under `HAIKU_TRIAL_GH_OWNER`.
2. **The preview** (`create-preview`, full only): `HAIKU_TRIAL_PREVIEW` is `vercel` (the director connects Vercel to the repository, with Deployment Protection off), `tunnel` (the runner starts the app and a Cloudflare quick tunnel) or `none` (the pictures rows are not covered).
3. **The staged plugin install** (`install`): the staged copy of this checkout, without this kit (`probes/haiku-trial/`) and `tests/`, goes in as `wheelhouse@wheelhouse` from the copy's own marketplace (named `wheelhouse`, as setup expects for the plugin and its pins). It goes in through `claude plugin marketplace add` and `claude plugin install`, after `claude plugin uninstall` takes out any copy an earlier run left (an install of the same version keeps the old copy as it is). The run then checks Claude Code's record of installed plugins and stops unless the installed copy is the commit it staged. `HAIKU_TRIAL_CONFIG_DIR`, when set, keeps the install out of the director's own configuration.
4. **A resume** (`resume`): one question names everything outward (the repository renamed to `haiku-trial-<label>-a<n>`, a fresh public one made from the snapshot, the plugin installed and tokens spent), and anything but `go` leaves everything as it was. See "Snapshots and resume".
5. **Model usage:** the go on the install is also the go to spend tokens. Every session the trial starts runs on Haiku, or on Sonnet when the run was given `--model sonnet` (see "Running on Sonnet").

Environment: `HAIKU_TRIAL_CLAUDE` is the full path to `claude`, `HAIKU_TRIAL_GH_OWNER` the account for the test repository, `HAIKU_TRIAL_PREVIEW` one of the three modes above, `HAIKU_TRIAL_CONFIG_DIR` the trial's own Claude config folder. The front desk and setup sessions start with it as `CLAUDE_CONFIG_DIR`, and the audit reads transcripts from its `projects` folder instead of `~/.claude`. The seeded project's settings run every session on the run's model (Haiku unless `--model sonnet`) and turn the advisor tool off (`CLAUDE_CODE_DISABLE_ADVISOR_TOOL`), since another model answers it, and Claude Code's feedback survey off (`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`), whose number keys would take a typed reply such as `1 A`; the audit counts any advisor call against the run.

With `tunnel`, the runner checks for `cloudflared` before it creates anything and stops with a message if it is missing.

## The trial's own Wheelhouse home

Wheelhouse keeps its records, events, helper socket and engine state under `WHEELHOUSE_HOME`. The runner sets it itself, to `<run folder>/wheelhouse-home` or to `HAIKU_TRIAL_WHEELHOUSE_HOME` when that is set, and passes it to the front desk and every process it starts, so the trial's helper and its feature sessions never meet your running helper or your projects. It refuses to run if the folder is, is inside, or holds `~/.wheelhouse`. You do not need to export `WHEELHOUSE_HOME` yourself.

The runner works with two names for the project: the **folder** (`<run folder>/project`, for git, tmux and transcripts) and the **name** Wheelhouse keeps its records under (`<owner>__haiku-trial-<date>`, from `projectSlug`). The real host refuses one where it wants the other.

## The director's four steps

1. The preview sign-in, only with `vercel`.
2. **The phone-alerts click (`ntfy`, full run only), early in wave 1.** The runner announces it: it asks, you answer `ready`, and it types `alerts ntfy <topic>`, which opens a helper window titled "Wheelhouse: phone alerts" that waits 120 seconds for a Yes click and saves nothing without one. Click Yes, and switch ntfy on under Notifications in the front desk. Without the click the run goes on and row 43 is "not covered", never failed.
3. **The sittings** (full run only): by default one sitting of about 10 minutes, after `w4-type`, with three clicks in the helper window: the All stop lift (F6) and the two undo approvals (F5a, F5b). See "The director's sittings".
4. The review at the end (`review-card`): a card that fits a phone, with the steps behind "Show the steps" and a generated `try-me.csv` of 41 rows to import. The card is written to the run folder.

## Carrying on past faults

A step is either a foundation step or not. A foundation step stops the run when it fails, because nothing after it can mean anything: `stage`, `create-repo`, `install`, `seed`, `setup-s0`, `front-desk`, and the missing `HAIKU_TRIAL_GH_OWNER`. Any other step that throws is recorded as a **finding** (`{ step, what, at }` in `state.findings` and the run log) and the run goes on. Its log entry is `done` with `outcome: 'failed'`, so `--from auto` moves past it, and `--from <step>` runs it again.

A step that needs another (`needs: ['f1']`) is skipped, with a finding, when the step it needs failed or was skipped. Inside steps, the places that used to stop for want of one thing (a feature session, a merge count, a picker) record what was missing and let the step finish with what it has. A fault step that could not run says why, and the rows that read it say "not covered: <why>".

`run` returns `{ done, findings, failed, skipped, stoppedAt?, why? }`. The exit code is 1 when the run stopped or found anything. The summary has a **Findings** section: each finding, its step, and the rows it leaves uncovered. A run with a finding that loses the claim (such as a session on another model) says at the top that it cannot pass, and goes on finding faults.

## Snapshots and resume

At set points between steps the runner keeps a snapshot, so a fix can be checked from the wave where it matters rather than from an empty project. `node probes/haiku-trial/runner.js plan` prints the points (a `#` marks the steps that have one):

| Point | When |
|---|---|
| `after-front-desk` (smoke), `after-ntfy` (full) | end of wave 1 |
| `after-w2-audit` | end of wave 2 |
| `before-f1` | wave 3, before F1 |
| `after-w3-audit` | end of wave 3 |
| `before-sitting-<n>` | before each sitting |
| `before-f4-check`, `before-s9-1` | wave 4 |
| `after-w4-audit` | end of wave 4 |

An `after-` snapshot first waits up to 10 minutes for no feature, small, bug or quick session to be running, and notes `quiet` in its meta. A `before-` snapshot is taken at once and is usually not quiet. A snapshot that fails is a finding, never a stop.

**What a snapshot holds.** Snapshots live outside every attempt, in `~/.wheelhouse-trials/haiku-<label>.snapshots/<nn>-<point>/`:

- `run/`: the project (with `.git` and worktrees), the trial's Wheelhouse home (sockets left out), the plugin, `state.json` and `run-log.jsonl`. Every `.jsonl` file is read back after the copy; a torn last line is cut and noted in the meta.
- `transcripts/`: the trial's transcripts, kept by their paths under the Claude config folder's `projects` folder.
- `github/`: a mirror clone of the repository without `refs/pull/*`, `capture.json` (the GitHub reads the kit makes, recorded as `{ path: response }`), `settings.json` (merge settings, default branch, protection of `main`, rulesets), `open.json` (the open pull requests).
- `meta.json`: label, point, step, time, attempt, the staged plugin's commit, the highest issue or pull request number, `quiet`, the works mid-build, torn lines.

A snapshot is 20 to 40 MB. It holds the trial's signing key, so it stays on this computer and never goes into a repository.

**Resuming.**

```
node probes/haiku-trial/runner.js resume --date <label> --snapshot <nn-point> [--keep-plugin]
```

With no `--snapshot` it lists the snapshots. It refuses while the label's tmux sessions are alive, then asks one question that names everything outward (the one go). On `go` it stops the attempt (`restore --force`), moves it aside (the run folder becomes `haiku-<label>-a<n>`, its transcripts go to its `transcripts-moved/`, the repository is renamed to `haiku-trial-<label>-a<n>`; nothing is deleted), puts the snapshot back at the same paths, builds a fresh public repository of the same name (every branch pushed from the mirror, each number from 1 up taken by a reopened pull request or a closed placeholder issue, the settings applied last), stages and installs the plugin from this checkout (`--keep-plugin` reinstalls the snapshot's copy instead), starts a fresh front desk, and goes on from the step after an `after-` point, or from the step itself for a `before-` point. A number that does not come back as the one wanted stops the resume with the reason.

The label is reused, so paths, repository name and the project's name in Wheelhouse's records stay the same, and the director's signed actions in the record stay as they were signed.

After a resume the runner reads GitHub relative to the snapshot: lists (`pulls`, workflow runs) join the captured items with the live ones made after it, and reads of a captured pull request's commits, or a captured commit's detail, statuses and pull requests, come from the capture. Everything else, and every write, goes to the live repository. The score's own-tests reads (`gh pr list --state merged` and `gh run list --status completed`, which are not API reads) are answered the same way: merges and the latest completed run on `main` from before the snapshot come from the capture, joined with what is live. A list of either kind that asks for other fields or flags goes live as it is.

**What a resumed run cannot claim.** A resumed run is for finding and checking fixes. Its summary says, at the top, "Resumed from `<snapshot>` (attempt n). Not a run for the record: a passing claim needs one whole run." and lists:

- **Two builds of Wheelhouse.** Steps before the snapshot ran on the plugin staged then; steps after it on the plugin staged at the resume. Rows whose evidence lies wholly before the snapshot are marked "carried from the snapshot (plugin `<sha>`)".
- **A restart in the middle.** Works mid-build at a snapshot that is not quiet came back through Wheelhouse's recovery. Rows 33 and 34 (F3, F3b) and the reliability log may show restarts that a whole run would not have had.
- **A new front desk.** The desk's conversation starts again at the resume; rows read from the desk pane cover only what it said after.
- **GitHub history from the capture.** Merged pull requests before the snapshot, their reviews, statuses, checks and comments exist only in the capture and in the renamed repository. A placeholder issue stands at each of their numbers. If Wheelhouse itself reads one of them from GitHub (for example `gh pr view <n>`) it finds an issue, not a pull request; the kit cannot see such reads, so any finding about an old pull request after a resume is checked again in a whole run.
- **CI history starts again.** The pushes start the repository's workflows afresh on the pushed heads; earlier runs are in the capture only.
- **Cost and time.** Usage and the clock are reported for the resumed part, with the snapshot's figures beside them, never summed into one figure for the trial.
- **The score.** It is measured as usual on `main`, and reported as "would pass" or "would not pass", never "passed".

## The director's sittings

The director's own clicks (the F6 lift and the F5a and F5b undo approvals) gather in **sittings**: one step, `sitting-<n>`, does the typed parts of every click in it and waits for the director's signed clicks together. The trial never clicks for the director: it types, and watches the record for the signed action (`lift-stop`; `undo-merge` or `keep-main` naming the merge). Each click waits up to 15 minutes and there is no "done" question: the signed action is the answer.

- **`--sitting <point>`** (repeatable) places a sitting. The points are `w3` (after `f1c`, the original moment for F6 and F5a), `w4` (after `w4-type`) and `end` (after `w5-midnight`). The default is one sitting at `w4`, the first point where all three clicks can be done together. A click goes in the first sitting where it can be ready: F6 and F5a from `w3`, F5b from `w4`. `--sitting w3 --sitting w4` keeps the original order.
- **Asked once.** Without a window, the sitting asks once when its point comes: "Sitting 1: 3 clicks in the helper window, about 10 minutes. Answer ready when you are at the screen."
- **`--window HH:MM-HH:MM`** (repeatable, local time, such as `22:00-02:00` across midnight) holds the sittings to the director's windows. A sitting does not ask: if its point comes inside a window it starts at once; before a window it keeps looking (the stand-in still answers cards and checks in) until the window opens; with every window past it is skipped with a finding.
- **`director.md`** in the run folder lists each sitting still to come, its clicks, a time range ("between 14:10 and 16:40 today") and how long it takes. It is written at the start of a run, at the end of each wave and on a resume, and its first line goes to the log. The early edge is the sum of the remaining steps' typical times, the late edge the sum of their time limits.
- **A click that does not come** is a finding, never a stop: the rows that need it say "not covered". A lift that does not come leaves All stop on, so the sitting then asks once in the terminal, "All stop is still on: lift it in the helper window when you can", and waits for that before anything else. A stop that an earlier part of the sitting left on (for example an F6 that failed half way) is lifted before the next click.
- **F5a's target.** Before it types the undo, the runner checks whether a later commit on `main` touched P6's file; if so it records "F5a will clash: `<commit>` touched `<file>`" as a finding, so the row's failure is read as the kit's.

## Running and resuming

```
node probes/haiku-trial/runner.js full [--from <step>] [--out <folder>] [--until <step>] [--model <haiku|sonnet>] [--sitting <point>] [--window <HH:MM-HH:MM>]
node probes/haiku-trial/runner.js smoke
```

### Running on Sonnet

`--model sonnet` runs the same kit on Sonnet: the seed's project settings (`model` and `CLAUDE_CODE_SUBAGENT_MODEL`), the setup session (`WHEELHOUSE_SETUP_MODEL`), the front desk (`claude --model`), the model audit, rows 1 and 45 and the summary all follow it. The default is `haiku`. The run keeps its model in `state.json`: a resume with no `--model` stays on it, and a different `--model` stops the run before anything is touched, so give a run on the other model its own `--date`. Any other value is refused with the usage line.

Run it once, on a label of its own, to tell kit faults from model faults: a row that fails the same way on both is the kit's or Wheelhouse's; one that fails only on Haiku is the Haiku floor. The summary says which model the run was on and does not make the Haiku claim for a Sonnet run.

### Naming a run

A run is named by a label, by default today's date from the clock: the test repository is `haiku-trial-<label>`, the project and the run folder (`~/.wheelhouse-trials/haiku-<label>`) follow it, and so do the ntfy topic and the summary file name. A second run on the same day would meet the first one's repository and resume its log, so give it a label of its own:

```
node probes/haiku-trial/runner.js smoke --date 2026-11-08-b
HAIKU_TRIAL_DATE=2026-11-08-b node probes/haiku-trial/runner.js smoke
```

The label is `YYYY-MM-DD` with an optional `-suffix` of lowercase letters and digits (up to 20), so every name made from it stays valid; anything else is refused with the usage line before anything is built. `--date` beats `HAIKU_TRIAL_DATE`. Pass the same label to `restore` (`restore --date 2026-11-08-b`) to find that run's folder, and `plan --date 2026-11-08-b` prints the repository and folder the label gives. A label that already has a run folder resumes that run; a new label starts a fresh one, with a new staged plugin.

Each step appends to `run-log.jsonl` in the run folder, and a step that finishes appends a `done` entry. A run with no `--from` goes on after the last finished step. The run's own state (pieces, fault results, replies) is kept in `state.json` beside the log.

## restore

`node probes/haiku-trial/runner.js restore [--date <label>]` stops what the run started, as its log records it: the `haiku-trial-*` tmux sessions, the product process, the tunnel process, and the trial's own helper, watchers and foremen under the trial home (the helper only while it is still the process its record names). While a feature session is still running (read from Wheelhouse's own records under the trial home) it keeps the helper, the watchers and the foremen and reports them as `kept`, so a restore never tears down the helper under a build; `restore --force` stops them anyway. It never touches `~/.wheelhouse` and deletes nothing: no repository, no Vercel project, no folder.

## Where results go

Raw results stay outside every repository, in `~/.wheelhouse-trials/haiku-<label>/`: the run log, transcripts, event export, pane captures and usage. The public summary is written to `summary/<date>-haiku-trial-results.md` in that folder. Copy it to `docs/trials/` after the director has labelled each failure, as the design's section 12 says.

## What the runner cannot supply in this build

The signal rows read optional context. The runner supplies `faults` (F1, F1b, F1c), `ntfy`, `mainFiles` (package.json and P6's test file on main), `branches`, `digestAt`, `pieces[id].change`, `.prs` and `.gate`, `pieces.P5.redAtFirstCommit`, `panes.replies`, `panes['front-desk']` and `config`. Some of it cannot come from the code in this build, and the rows say so rather than pass:

- **Rows 10 and 35:** row 10 reads signed `review` records and the roles in each run's `cost` record; with none it is not covered, not failed. A routine move leaves no record the runner reads, so row 35 is always not covered and only reports what `reliability.jsonl` holds.
- **Row 14:** it passes on exit 2 and a send-back, as the design's F1 says. P4's own send-backs, read from its `questions.jsonl` while its session runs, go in the evidence.
- **Row 30:** the gate's reading of P8 is taken from the pull request's files and diff through `visibleFromChange`.
- **Work-ready:** the watcher's `work-ready` is never written to the event log, so rows 4 and 7 read the records it is made from (a quick or bug work not shown first, and a signed `approve-work`), and row 34 reads P7 starting after the foreman was killed.
- **Card answers:** the stand-in director answers plan, approval and confirm cards, and the decisions builds raise, with the option each card recommends (`stand-in.js`). A card the front desk shows as a picker gets the cursor moved to that option and Enter, once the picker on screen is that card; a decision shown in the chat gets its typed reply, such as `1 A`, with the number the desk gave it. P4's decisions are left to the live decision script. In the 2026-11-08-e smoke run the cards stored their options as plain strings, which the first version of this missed.
- **Pickers no card stands for:** a picker that stays open in the front desk for 3 minutes with no card in the record behind it (setup's phone card when setup carries on in the desk, or a question of the desk's own) gets the recommended option, or the first, and a note. Never during a step that is the director's own. Setup counts as done only once no picker is open, since its last words also open the phone card.
- **Questions in the chat:** when a request makes no work and the desk's reply asks questions with no picker open, the stand-in answers once: "Go with what you recommend on each question, and take it to a card." A piece whose work appears after its typing wait is linked to the first new work made after it was typed, and F3 follows that link.
- **Check-ins:** the desk shows waiting cards and decisions when the director writes to it. With the desk idle for three minutes and a card, a question, or a visible work with no approve-work card yet waiting in the record, the stand-in types "Anything waiting for me?", at most every ten minutes, and never during a director's step.
- **F3 and the audit find sessions by Wheelhouse's records.** A feature session is found from `<home>/projects/<project>/watcher/running/feature-<work>.json` (state running, a process id that runs), then by scanning `claude -p` processes; the worktree may be under `.wheelhouse/worktrees` or `.claude/worktrees`, and the audit labels both. Feature progress is read from `feature` events (`started`, `planned`, `building`, `paused`, `closed`) as well as `run` events. F3 takes the project name, not the folder.
- **F3:** when P1 has no running feature session to kill (intake sized it smaller), F3 is noted as not exercised and the run goes on; it is a note, not a stop.
- **Wave 2 is a note, not a stop.** If fewer than three wave-2 pull requests merge in time, `w2-merge-wait` notes the shortfall and goes on; the later merge waits ask for that many fewer.
- **Typing waits.** Anything the stand-in types to the front desk (a request, a decision reply such as `1 A`, a check-in, a fault's words) waits until the desk is idle (no spinner, no "esc to interrupt") for three seconds and no picker is open, and each request is one paste, one line, so the terminal never wraps it. A picker keeps being answered while typing waits, so a closed picker never takes typed text. After ten minutes of a busy desk it types anyway and notes it.
- **P6 is a tests-only change.** The old P6 ("Make CI also run on Node 24") changed a CI workflow, which Wheelhouse's own gate treats as a guardrail, so it could never self-merge as `internal`. P6 now asks for tests of `parseAmount` in one new file, `tests/money-edge.test.js`, with no other file touched. Row 36 checks that the take-back removed that file from main; with main unreadable it is "not covered".
- **Rows that are "not covered" rather than failed:** 36, 37, 38 and 40 when the run stopped before their faults (F5a, F5b, F6 and its lift) or the sitting that held them failed, was skipped or did not get the click, 43 without the ntfy click, and 36 when main cannot be read.
- **Scoring changes:** row 2 judges finished replies, not a spinner; row 4 needs a merged pull request; row 19 counts an answer per decision, not per number; row 44 and the project's own tests give no "written" credit for the seed's own test file, only for tests the builders wrote.
- **Setup:** the stand-in director answers setup's cards (Go ahead, per-step, confirm-all, baseline, trust) in the setup session: from the record, and as the pickers setup shows in the pane, where it moves the cursor to the option marked "(Recommended)" (the first option when none is) and sees it highlighted before Enter, noting each answer in the run log. It answers the folder-trust prompt with "Yes, I trust this folder" (its first choice is "No, exit", so the runner moves down to Yes and sees it highlighted before Enter), starts the session again once when setup says it needs a new session, and ends on the engine's own wording ("Every step is done." or the phone-notifications line). None of this has met a live session: read the setup pane captures after the first smoke. A tmux session the run started that ends by itself stops the run at once, naming the session.
- **The digest and alert settings:** the runner asks for the digest in plain words and types `alerts ntfy <topic>`. Their wording has not met a live session.
- **Engine transcripts:** the runner passes the project's queue folder under the engine directory to `findTranscripts`, or the engine directory itself if there is no such folder.
- **P5 not covered:** if the spare bug cannot be applied, row 6 is reported as not covered with the reason, and other rows that need P5 will fail.
