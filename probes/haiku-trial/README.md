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
4. **Haiku usage:** the go on the install is also the go to spend tokens. Every session the trial starts runs on Haiku.

Environment: `HAIKU_TRIAL_CLAUDE` is the full path to `claude`, `HAIKU_TRIAL_GH_OWNER` the account for the test repository, `HAIKU_TRIAL_PREVIEW` one of the three modes above, `HAIKU_TRIAL_CONFIG_DIR` the trial's own Claude config folder. The front desk and setup sessions start with it as `CLAUDE_CONFIG_DIR`, and the audit reads transcripts from its `projects` folder instead of `~/.claude`. The seeded project's settings run every session on Haiku and turn the advisor tool off (`CLAUDE_CODE_DISABLE_ADVISOR_TOOL`), since another model answers it, and Claude Code's feedback survey off (`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY`), whose number keys would take a typed reply such as `1 A`; the audit counts any advisor call against the run.

With `tunnel`, the runner checks for `cloudflared` before it creates anything and stops with a message if it is missing.

## The trial's own Wheelhouse home

Wheelhouse keeps its records, events, helper socket and engine state under `WHEELHOUSE_HOME`. The runner sets it itself, to `<run folder>/wheelhouse-home` or to `HAIKU_TRIAL_WHEELHOUSE_HOME` when that is set, and passes it to the front desk and every process it starts, so the trial's helper and its feature sessions never meet your running helper or your projects. It refuses to run if the folder is, is inside, or holds `~/.wheelhouse`. You do not need to export `WHEELHOUSE_HOME` yourself.

The runner works with two names for the project: the **folder** (`<run folder>/project`, for git, tmux and transcripts) and the **name** Wheelhouse keeps its records under (`<owner>__haiku-trial-<date>`, from `projectSlug`). The real host refuses one where it wants the other.

## The director's three steps

1. The preview sign-in, only with `vercel`.
2. One short helper-window sitting of about 5 minutes: the two undo approvals (F5a, F5b) and, if the runner cannot click it, the All stop lift (F6). The runner asks for each.
3. The review at the end (`review-card`): a card that fits a phone, with the steps behind "Show the steps" and a generated `try-me.csv` of 41 rows to import. The card is written to the run folder.

## Running and resuming

```
node probes/haiku-trial/runner.js full [--from <step>] [--out <folder>] [--until <step>]
node probes/haiku-trial/runner.js smoke
```

### Naming a run

A run is named by a label, by default today's date from the clock: the test repository is `haiku-trial-<label>`, the project and the run folder (`~/.wheelhouse-trials/haiku-<label>`) follow it, and so do the ntfy topic and the summary file name. A second run on the same day would meet the first one's repository and resume its log, so give it a label of its own:

```
node probes/haiku-trial/runner.js smoke --date 2026-11-08-b
HAIKU_TRIAL_DATE=2026-11-08-b node probes/haiku-trial/runner.js smoke
```

The label is `YYYY-MM-DD` with an optional `-suffix` of lowercase letters and digits (up to 20), so every name made from it stays valid; anything else is refused with the usage line before anything is built. `--date` beats `HAIKU_TRIAL_DATE`. Pass the same label to `restore` (`restore --date 2026-11-08-b`) to find that run's folder, and `plan --date 2026-11-08-b` prints the repository and folder the label gives. A label that already has a run folder resumes that run; a new label starts a fresh one, with a new staged plugin.

Each step appends to `run-log.jsonl` in the run folder, and a step that finishes appends a `done` entry. A run with no `--from` goes on after the last finished step. The run's own state (pieces, fault results, replies) is kept in `state.json` beside the log.

## restore

`node probes/haiku-trial/runner.js restore [--date <label>]` stops what the run started, as its log records it: the `haiku-trial-*` tmux sessions, the product process, the tunnel process, and the trial's own helper, watchers and foremen under the trial home (the helper only while it is still the process its record names). It never touches `~/.wheelhouse` and deletes nothing: no repository, no Vercel project, no folder.

## Where results go

Raw results stay outside every repository, in `~/.wheelhouse-trials/haiku-<label>/`: the run log, transcripts, event export, pane captures and usage. The public summary is written to `summary/<date>-haiku-trial-results.md` in that folder. Copy it to `docs/trials/` after the director has labelled each failure, as the design's section 12 says.

## What the runner cannot supply in this build

The signal rows read optional context. The runner supplies `faults` (F1, F1b, F1c), `ntfy`, `mainCi`, `branches`, `digestAt`, `pieces[id].change`, `.prs` and `.gate`, `pieces.P5.redAtFirstCommit`, `panes.replies`, `panes['front-desk']` and `config`. Some of it cannot come from the code in this build, and the rows say so rather than pass:

- **Rows 10 and 35:** row 10 reads signed `review` records and the roles in each run's `cost` record; with none it is not covered, not failed. A routine move leaves no record the runner reads, so row 35 is always not covered and only reports what `reliability.jsonl` holds.
- **Row 14:** it passes on exit 2 and a send-back, as the design's F1 says. P4's own send-backs, read from its `questions.jsonl` while its session runs, go in the evidence.
- **Row 30:** the gate's reading of P8 is taken from the pull request's files and diff through `visibleFromChange`.
- **Work-ready:** the watcher's `work-ready` is never written to the event log, so rows 4 and 7 read the records it is made from (a quick or bug work not shown first, and a signed `approve-work`), and row 34 reads P7 starting after the foreman was killed.
- **Card answers:** the stand-in director answers plan, approval and confirm cards, and the decisions builds raise, with the option each card recommends (`stand-in.js`). A card the front desk shows as a picker gets the cursor moved to that option and Enter, once the picker on screen is that card; a decision shown in the chat gets its typed reply, such as `1 A`, with the number the desk gave it. P4's decisions are left to the live decision script. In the 2026-11-08-e smoke run the cards stored their options as plain strings, which the first version of this missed.
- **Pickers no card stands for:** a picker that stays open in the front desk for 3 minutes with no card in the record behind it (setup's phone card when setup carries on in the desk, or a question of the desk's own) gets the recommended option, or the first, and a note. Never during a step that is the director's own. Setup counts as done only once no picker is open, since its last words also open the phone card.
- **Questions in the chat:** when a request makes no work and the desk's reply asks questions with no picker open, the stand-in answers once: "Go with what you recommend on each question, and take it to a card." A piece whose work appears after its typing wait is linked to the first new work made after it was typed, and F3 follows that link.
- **Check-ins:** the desk shows waiting cards and decisions when the director writes to it. With the desk idle for three minutes and a card or question waiting in the record, the stand-in types "Anything waiting for me?", at most every ten minutes, and never during a director's step.
- **F3:** when P1 has no running feature session to kill (intake sized it smaller), F3 is noted as not exercised and the run goes on.
- **Setup:** the stand-in director answers setup's cards (Go ahead, per-step, confirm-all, baseline, trust) in the setup session: from the record, and as the pickers setup shows in the pane, where it moves the cursor to the option marked "(Recommended)" (the first option when none is) and sees it highlighted before Enter, noting each answer in the run log. It answers the folder-trust prompt with "Yes, I trust this folder" (its first choice is "No, exit", so the runner moves down to Yes and sees it highlighted before Enter), starts the session again once when setup says it needs a new session, and ends on the engine's own wording ("Every step is done." or the phone-notifications line). None of this has met a live session: read the setup pane captures after the first smoke. A tmux session the run started that ends by itself stops the run at once, naming the session.
- **The digest and alert settings:** the runner asks for the digest in plain words and types `alerts ntfy <topic>`. Their wording has not met a live session.
- **Engine transcripts:** the runner passes the project's queue folder under the engine directory to `findTranscripts`, or the engine directory itself if there is no such folder.
- **P5 not covered:** if the spare bug cannot be applied, row 6 is reported as not covered with the reason, and other rows that need P5 will fail.
