<!-- docs/specs/2026-11-08-haiku-trial-design.md -->

# The Haiku trial

8 November 2026. A design for a test project and a trial script that show Wheelhouse works when every model role is bound to Haiku. The trial kit built from it is in `probes/haiku-trial/` (plan `docs/superpowers/plans/2026-11-08-haiku-trial-kit.md`).

## 1. Why, and when it runs

Wheelhouse makes many small, checked steps: intake, plans, cards, decisions, the gate, proof notes, merges and undo. If those steps hold up on the smallest model, they hold up on the larger ones, and a director on a tight usage budget can run Wheelhouse at its cheapest setting. The trial is the evidence for that claim.

It runs from `main` after step 9 of the director's way of working (the digest and alerts) has merged, and before the v0.3.0 tag. The tag then means "works on Haiku", with any known limits written beside it.

**Passing means three things together:**

1. **Path success.** Every in-scope path in section 6 shows its pass signal.
2. **End-product quality.** The finished spending tracker scores at or above the pass bar in section 10.
3. **The director's verdict.** The director tries the product for 15 minutes or less (section 11) and says it is good enough.

A run that passes 1 and 2 but not 3 holds the tag. The director's word is the last check.

## 2. Goals, non-goals and anti-goals

**Goals**

- Cover every path of the core that a model drives, plus its failure and recovery, at the least token and clock cost that still gives a clear signal.
- Name each path, the piece that drives it, and what is observed to call it a pass.
- Sort each failure: a Wheelhouse prompt or check to mend, or a genuine Haiku limit to record as a known floor.
- Show the agents write real tests in the test project and keep them.
- Score the finished product, separately from path success.
- Run the decision path live with typed replies on (the default since #394). This is the first live check of that path; the card-path tests pin typed replies off.

**Non-goals**

- Parked pieces (section 13).
- Other hosts. GitLab and the local host keep their existing end-to-end tests. This trial runs on GitHub only.
- Windows. Its own sittings cover it.
- Measuring larger models. A later run can reuse the kit with another model, but this design does not plan one.

**Anti-goals.** Any of these would make the trial worthless even if every check came out green:

- A green run that hid a non-Haiku model somewhere. The model audit in section 4.3 is a hard fail.
- A trial that only checks code merged. The product has to work, and the director has to agree.
- Real financial data anywhere. All data is generated.
- Wheelhouse records or anything about the director's other projects in a public repository.
- Needing the director for anything an agent can do. Only sign-ins, clicks the design reserves for the director (the undo approvals and, if the runner can't click it, the All stop lift, all in the helper window), and the final review go to them.

## 3. Approaches

| Approach | What it is | Trade-off |
|---|---|---|
| A. One long real run | The director stand-in types every request into a Haiku front desk, one after another, and waits for each to finish. | The most realistic, and the slowest: about a day of clock time. Faults land wherever they happen to, so the signals are hard to pin down. |
| B. Scripted world | Reuse `tests/helpers/director-world.js` with the fake engine. | Cheap and repeatable, but no model runs, so it says nothing about Haiku. The existing tests already do this. |
| **C. Staged real run (chosen)** | Real Haiku sessions for every model-driven path. A Node runner stages pieces in waves so that up to three run at once, injects each fault at a known moment, and reads every signal from the event log, GitHub and transcripts. | Close to real use, with each fault at a fixed point. Costs a kit to build: the runner, the seed project and the checks. |

C is chosen because the claim is about Haiku in real use, which rules out B, and A takes too long and gives fuzzy signals for faults. C's kit can be reused for later model trials.

## 4. Binding every role to Haiku

### 4.1 The test project's settings

- **Wheelhouse routing.** Setup runs with `WHEELHOUSE_SETUP_MODEL=haiku` on a fresh configuration, which writes Haiku into every routing role in `.claude/wheelhouse.json`:
  - `frontDesk`, `foreman`, `builder`, `reviewer`, `reviewerCritical`, `tester`, `mechanical`, `feature` and `builderCritical`;
  - the `tiers.pins` for `mostCapable` and `midSized`.
  - Premium stays off.
- **Claude Code's own default.** The test project's `.claude/settings.json` sets `"model": "haiku"`, and its `env` sets `CLAUDE_CODE_SUBAGENT_MODEL=haiku`. These reach every session opened in the project, however it was started:
  - the why fork, which runs on the CLI's default model;
  - subagents, where builder, reviewer and tester get their model only as prompt text;
  - any fallback to `'default'`.
- **The front desk** is started with `claude --model haiku`. `front-desk-model.js` only warns, so the audit below is what catches a mistake.

### 4.2 Why both layers

Foreman and feature sessions get a `--model` flag from routing, but the other roles are named in prompt text. Without the Claude Code default, a subagent the builder starts could run on the session's default model. The settings file closes that gap. The model audit below proves it was closed.

### 4.3 The model audit (a hard fail)

At the end of every wave, the runner reads every transcript the trial produced:

- the interactive front desk's `.jsonl` under `~/.claude/projects/<test project>/`;
- the foreman's and feature sessions' stream-json logs;
- the why forks;
- subagent transcripts.

Every assistant message's `model` must be a Haiku model. One message from any other model fails the whole run, and the report names the session and its role.

The same pass checks that no session read anything under the kit's held-back folder. This is the peek check for section 10.

## 5. The test project: a spending tracker

### 5.1 Why this project

| Candidate | Paths it reaches | Signal on quality | Cost | Verdict |
|---|---|---|---|---|
| **Spending tracker** (CSV import, categories, monthly dashboard) | Visible pages, invisible logic, a data import (the proof note's data section), natural director-kind decisions (what a re-categorise does), a natural bug (refund signs) | Strong: totals either reconcile to the cent or they don't | Small: three pages and one library | **Chosen** |
| Reading list or to-do app | Pages and forms; no data import; few director-level decisions | Weak: little to compute | Small | Dropped: too little signal |
| Command-line tool | Command-line entry points only; no pages, so no previews | Medium | Small | Dropped: misses previews and the visible gate |
| Club booking form | Pages, forms and data | Medium: validation, not arithmetic | Medium | Dropped: less signal for more pages |

The spending tracker uses **generated data only**. The generator draws transactions from a fixed table of made-up merchants, each with a known category, so it also knows the right answer for every total.

### 5.2 Stack and layout

The stack is plain JavaScript, so the step 8 visibility detector reads it confidently; it treats much Python as unsure.

| Piece | Choice | Why |
|---|---|---|
| Runtime | Node 22 | Matches Wheelhouse; scripts are Node |
| Server | `node:http` plus a small router, or Express (the builders' call, logged as `library-in-stack`) | Small surface; no build step |
| Pages | Server-rendered HTML from modules under `src/pages/` | See below |
| Database | `node:sqlite` (built in; no native build). On a host without it, `sql.js` (the builders' call) | Runs the same on the Mac and on a preview host |
| Tests | `node --test`; end-to-end tests start the server and use `fetch` | No browser download in the project; Haiku handles it well |
| CI | GitHub Actions on a public repository: `npm ci && npm test` | Free minutes; the gate's checks need it |

**Pages live under `src/pages/`, one module per page** (`index.js`, `import.js`, `month.js`, `edit.js`), each exporting a render function that returns HTML. This is not a style preference. Wheelhouse finds pages by path:

- The visibility detector (`scripts/gate/visible.js`) marks `**/pages/**` as a page.
- The preview finder (`touchedPages` in `scripts/engine/preview.js`) reads page addresses only from `app/`, `pages/`, `routes/` or `public/`, with or without `src/` in front.

A `views/` folder of EJS templates would pass the visibility gate but give no previews. Dynamic routes are skipped by the preview finder, so the edit page is addressed `/edit?id=…`, not `/edit/:id`.

### 5.3 The seed

The kit commits a small seed so that no tokens go on scaffolding:

- `package.json`, with `start` and `test` scripts;
- `src/server.js`, with a home page that says "Nothing imported yet";
- `src/lib/money.js`, with `parseAmount`;
- `scripts/make-statement.js`, the generator;
- `data/sample-statement.csv`: three months from seed 42, with refunds, quoted descriptions holding commas, and dates at month ends;
- one smoke test;
- the CI workflow;
- `.claude/settings.json` as in section 4.1;
- a README.

`parseAmount` carries one planted bug: it drops the sign of an amount written in brackets, `(40.00)`, so a refund counts as spending. The import piece's request says to use the existing `parseAmount`, so the bug survives into the product until the bug piece (P5) finds it.

If a builder fixes it early, the runner notes "planted bug fixed early" and switches P5 to the spare planted bug, which is held in the kit and applied before P5 starts: a month-end date read in UTC slips into the next month. Either way the bug lane runs.

### 5.4 The product spec (given to intake, piece by piece)

1. **Import a statement.** At `/import`, a form uploads a CSV with the field name `statement`.
   - The CSV has the columns `Date, Description, Amount`, with dates as DD/MM/YYYY. Brackets or a minus sign mean money coming back.
   - After an upload, the page says how many rows were added and how many were skipped as duplicates. Importing the same file twice adds nothing.
   - A file that isn't a statement gets a plain error saying what's wrong.
2. **Categorise.** Each transaction gets a category from merchant rules in `src/lib/categories.js`:
   - Groceries, Eating out, Transport, Bills, Shopping, Health, Income or Other;
   - a description no rule matches is Other.
3. **Monthly dashboard.** At `/month?m=YYYY-MM`:
   - a table with one row per category, showing the total spent and the change from the month before;
   - a grand total, with money back netted off;
   - links to the previous and next months.
   - Each total cell carries `data-category` and `data-total` (a plain decimal), so the held-back checks can read it.
4. **Re-categorise.** From the dashboard, any transaction can be moved to another category.
   - Whether that also makes a rule for the merchant is left open on purpose. It is a `behaviour` decision, which belongs to the director.
5. **Export.** The dashboard has a "Download this month" link that gives a CSV of that month's transactions with their categories.

The server honours `PORT` and `LEDGER_DB` (the database file's path, or `:memory:`). These two, the upload field's name and the `data-` attributes are the contract the held-back checks rely on. They go into the requests word for word.

### 5.5 Where previews come from

On the own engine, a preview is a picture of the host's preview deployment, taken by the helper:

1. `adapter.previewUrl(headSha)` reads GitHub deployment statuses.
2. `scripts/pictures/shoot.js` photographs public https addresses only, never localhost.

So the test project needs per-pull-request deployments. In order of preference:

1. **Vercel (free tier) connected to the public repository,** with Deployment Protection off for previews.
   - Vercel writes the GitHub deployment statuses that `previewUrl` reads, and the preview seeds an in-memory database from the sample CSV.
   - It needs **one sign-in by the director**: connecting Vercel to GitHub, about 3 minutes, once. It can be reused by later trials.
2. **A runner-made preview,** if the director would rather not connect Vercel. For each pull request head, the runner:
   - starts the app;
   - opens a Cloudflare quick tunnel (a public https address with no account);
   - posts a GitHub deployment and status with that address.

   No director step is needed. It is less like a real project's set-up.
3. **No previews.** Mark "What it looks like" and the pictures path **not covered**, and say so beside the tag.

## 6. Coverage: every path, the piece that drives it, and its signal

Pieces P1 to P8 are in section 7, and faults F1 to F6 are in section 8.

Every signal is read by the runner, from one of these:

- the project's event log, through the helper's views;
- GitHub, through `gh api`;
- the tmux pane's text;
- transcripts.

| # | Path | Piece | Pass signal |
|---|---|---|---|
| 1 | Setup: all ten steps on a fresh project, GitHub host, Standard protection | S0 | Setup ends with its done line; `.claude/wheelhouse.json` has Haiku in every role; health check all pass |
| 2 | Front desk on Haiku: session start, command named, plain replies | S0, every piece | Session-start context present; no reply over the phone limit; model audit |
| 3 | Intake: nine questions, lane chosen | P1–P8 | `intake` event per request with lane as the table in section 7 expects |
| 4 | Lane: quick (starts unapproved, no plan) | P6 | No plan file; `work-ready` with no approval card |
| 5 | Lane: small | P2, P4, P7 | Plan written; approval card only if visible |
| 6 | Lane: bug (starts unapproved, no plan; reproduce first) | P5 | First commit on the branch is a failing test; then the fix |
| 7 | Lane: feature, plan approval card | P1, P3 | `needsApproval`; a card answered through the question picker; `work-ready` after |
| 8 | Card path with typed replies on (picker still works) | P1, P3 | The plan card is answered by picker and signed |
| 9 | Foreman: start, pace 3, feature lane 1 | waves 2–3 | Never more than 3 building at once, never more than 1 feature lane |
| 10 | Feature session on Haiku: plan, build, tests, review, tester | P1–P8 | Pull request opened with tests; review and tester steps in the session's log |
| 11 | Own-engine slices: each slice its own plan and pull request | P3 (`--slices 2`) | Two pull requests, each with its own plan, merged in order |
| 12 | Same-file clash wait | F4 (P4 vs P7) | The wait text "… waits: its plan touches src/pages/month.js, which … is changing" and a start only after the other merges |
| 13 | Decision raised by an agent, right shape | P4 | A `decision` with 2–4 options, each with cost and undo, a recommendation, a because and a meanwhile; within the phone limit |
| 14 | Shape check sends back a wrong-shaped decision | F1 | Exit code 2 and `sentBack`; the agent sends a right-shaped one within `STUCK_AFTER` (3) tries |
| 15 | Stuck after three send-backs | F1b | Plain `stuck --why` message reaches the front desk |
| 16 | Hold while a decision waits | P4 | Commit status `wheelhouse/decision` "Waiting on decision n"; gate reason `waiting-on-decision`; no merge |
| 17 | `wait-for` frees the slot | P4 | Another piece starts while P4 waits |
| 18 | Typed reply recorded, live | P4, section 9 | `decision-answer` with `where: 'chat'`; status flips to "No decision waiting"; P4 carries on and merges |
| 19 | Typed reply edge cases | section 9 | Ambiguous, already-answered, beyond-options and `why n`: each gives its note and records nothing |
| 20 | Private answer on a public project | section 9 | "2 B private" records with `private: true`; no file in the project's `docs/decisions` for it |
| 21 | Why fork on Haiku | section 9 | `why decision n` answers within 100 seconds with text that isn't a fallback |
| 22 | Line: agent logs its own call | P2, P3 | At least one `agent-call` event, in `feature log` |
| 23 | Line refuses a director kind | F1c | The refusal text `"behaviour" is the director's to decide…` |
| 24 | `pull-back` of a logged call | W4 | A ruling waits for the director's confirm card |
| 25 | Proof note: all headings | every merged pull request | Pull request body has What changed, Why, Decided on its own, Decisions followed, How it was checked, What it looks like, The data before and after |
| 26 | Proof note: pictures | P1, P3, P4, P7 | "What it looks like" has desktop and phone pictures of the touched pages (if section 5.5 gives previews) |
| 27 | Proof note: data before and after, test route | P1 | Section present, route `test` |
| 28 | Visible change waits for the director | P1, P2, P3, P7 | No `self-merged` event; an approval card; merge after it |
| 29 | Self-merge, case `internal` | P6 | `self-merged` event with reason `internal` |
| 30 | Gate reads visible text the intake missed | F2 (P8) | Intake `visible:false`, gate `visible:true` with a text reason; no self-merge; an approval card |
| 31 | Records: decision files | P4 | `docs/decisions/…` file for the answered decision |
| 32 | Records: daily batch, self-merged | W5 | Branch `wheelhouse/decisions-<date>` opened at the first tick after local midnight; `self-merged` reason `decision-records` |
| 33 | Crash: lost feature session resumed | F3 | `resumed` incident; the session carries on from its branch; the piece merges |
| 34 | Crash: lost foreman recovered | F3b (full only) | Within 10 minutes the watcher re-raises `work-ready` (`recovered: true`) for the approved piece, and it starts. A `lost` row in `reliability.jsonl` (still unstarted 30 minutes after a raise) is a finding |
| 35 | Routine moves handled without the foreman | all waves | Routine reports settled by the watcher; foreman woken only for judgement kinds; `reliability.jsonl` rows |
| 36 | Undo, clean | F5a | After the director's click in the helper window: "Take back: …" pull request on `wheelhouse/undo-…`; merged; the Node 24 entry gone from `main`'s CI workflow |
| 37 | Undo that clashes with later work | F5b | After the director's click: the reply "The undo clashes with later work, so nothing was changed: it is now a decision for the director", and a card "Undo of the merge <sha> clashes with later work"; nothing pushed |
| 38 | All stop | F6 | Stop set from the typed words "all stop"; no new starts; a merge refused with "All stop is on" |
| 39 | Undo refused under All stop | F6 | An `undo` typed while stopped is denied by the stop-guard hook ("All stop is on"); nothing pushed and no undo branch |
| 40 | Lift All stop | F6 | Lift card in the helper window; starts resume |
| 41 | Incident freezes merges | W5 (full only) | `record incident`; a merge refused; then lifted |
| 42 | Digest at `digestAt` | W4 | Digest arrives in the chat at the set time (runner sets `digestAt` 10 minutes ahead) |
| 43 | Alert for a waiting decision (ntfy) | P4 | ntfy topic receives "1 decision waits in <project>" |
| 44 | Project's own tests written and kept | all | Section 10.4 |
| 45 | Model binding | all | Section 4.3 audit clean |

Names for rows 42 and 43 come from the step 9 plan (`digestAt`, `digestDue`, `alertText`, `sendAlert`, `alerts ntfy <topic>`). **Check them against step 9 as merged** before building the runner.

## 7. The trial script

### 7.1 Who does what

- **The runner** is a Node script in the kit (`probes/haiku-trial/`). It:
  - drives an interactive Haiku front desk in tmux with `send-keys` and reads the pane with `capture-pane`;
  - plays the director using a fixed script of words, answers and picker choices;
  - injects the faults;
  - checks each signal;
  - writes the results.

  It never edits the test project's code itself; only the agents do. The runner is not a model, so it costs no tokens.
- **The director stand-in** is the runner typing into the front desk. This is the design's known typed-reply gap: words sent into the front desk by another program are signed as the director's. It is accepted here because it is a trial on a throwaway project. The director's own typed answer in section 11 is the true check of that path.
- **The director** does three things:
  1. the preview sign-in (section 5.5, option 1);
  2. one short helper-window sitting in W3 and W4: the two undo approvals (F5a, F5b), which only the director's signed click gives, and the All stop lift if the runner cannot click it (F6). The runner tells them when each is ready, and it batches them so that the sitting is about 5 minutes all told;
  3. the review in section 11.

  Without the undo click, the expected sign is the card that sends the director to the helper window (`needs: 'window'`), and rows 36 and 37 are not covered.

### 7.2 Pieces

The cost shown for each piece is planning figures for Haiku: all tokens (mostly cache reads) and clock time. The first run replaces them with measured ones; the runner reads usage from every session's stream-json.

| Piece | Request (director's words, abridged) | Lane, visible | Paths exercised | Expected | Cost |
|---|---|---|---|---|---|
| S0 | Setup on the seeded repository | — | 1, 2 | Setup done; roles all Haiku | ~1M, 15 min |
| P1 | "Let me upload my bank statement and see it imported" | feature, visible | 3, 7, 8, 10, 25–28 | Plan card answered; pull request with unit tests for parsing and an end-to-end test of the upload; pictures of `/import`; data section; approval card; merged | ~6M, 45 min |
| P2 | "Sort transactions into categories by shop name" | small, visible (the category names are on-screen text) | 5, 10, 22, 28 | Approval card; unit tests per category; merged | ~3M, 25 min |
| P3 | "A page per month with totals by category and change from last month", `--slices 2` | feature, visible | 7, 11, 22, 25, 26, 28 | Two slices, two pull requests, each approved | ~9M, 60 min |
| P4 | "Let me move a transaction to a different category" | small, visible | 13, 16–18, 31, 43 | Agent raises the director-kind decision (does it make a rule?); waits; typed answer; carries on; approval; merged | ~4M, 35 min |
| P5 | "A $40 refund shows as spending" | bug | 6 | Failing test first; fix; merged | ~3M, 20 min |
| P6 | "Make CI also run on Node 24" | quick, not visible | 4, 29 | Touches only `.github/workflows/`; self-merged `internal`, no plan | ~1M, 8 min |
| P7 | "A button to download this month as a spreadsheet" | small, visible | 12, 26, 28 | Waits behind P4 for `src/pages/month.js` (F4); then built, approved, merged | ~3M, 25 min |
| P8 | "Rename the category key 'eating_out' to 'dining' in `src/lib/categories.js`, and touch nothing else. Nobody sees this." (The request also changes its label to "Dining".) | small, said not visible | 30 | Intake takes the director's word (not visible); the gate finds the changed label string and holds it for approval. Confined to `src/lib/`, so the gate's reason is changed text in code, not a page path | ~2M, 15 min |

### 7.3 Waves and parallel order

Pace is 3 building at once, with 1 in the feature lane.

| Wave | Runs | Faults injected | Why this order |
|---|---|---|---|
| W1 | S0 | — | Everything stands on setup |
| W2 | P1 (feature), P2 (small), P6 (quick) | F3: kill P1's feature session after its first commit | One of each lane at once; the killed session must come back while two others carry on |
| W3 | P3 (feature, 2 slices), P5 (bug), P8 (small) | F1 into P3's session; F2 is P8 itself; F6 All stop, with an undo refused while stopped; after the lift, F5a undo P6 | P5 needs P1's import; P3 needs P2's categories; F6 proves undo is refused while stopped, and F5a then undoes cleanly |
| W4 | P4, P7 | F4: P7 waits on P4's file; F3b kill the foreman before it starts P7 (full only); the live typed decision (section 9); F5b undo P2; `pull-back`; digest | P4 and P7 both touch the dashboard. P7 is approved and unstarted when P4 merges, which is what recovery needs. F5b lands on P2 after P3 builds on it, so it must clash |
| W5 | — (no model) | incident (full only); the daily batch after midnight | Cheap checks that only need time |
| W6 | Quality score (section 10), then the director's review (section 11) | — | The product is finished |

Wave 3 starts once wave 2 has merged. Within a wave, the queue and pace decide the order: the runner types the requests at the start of the wave and lets Wheelhouse schedule them.

## 8. Deliberate faults

| Fault | How the runner makes it | When | Expected | Path rows |
|---|---|---|---|---|
| **F1** Wrong-shaped decision | The runner, not P3's agent, sends the wrong shape. In P3's feature session environment (a copy of its `WHEELHOUSE_*` variables, its worktree as the working folder, and the same sandbox), it calls the feature CLI's `ask` with one option, no undo and no meanwhile. It uses its own stand-in question text, so P3's real trail in `questions.jsonl` stays clean | W3, while P3 slice 1 builds | Exit 2 and `sentBack`. P3 itself is untouched and goes on | 14 |
| F1b | The same stand-in question, sent wrong as tries 2 and 3 | right after F1 | Stuck at the third try: the stuck message, `stuck --why` | 15 |
| F1c | The feature CLI's `log` with kind `behaviour` | right after F1b | The refusal text pointing to `ask --about behaviour --level 3` | 23 |
| (natural) | P4's real decision | W4 | Haiku's own first try is recorded: right shape first time, or how many send-backs it took. A send-back that ends in a right shape passes; a stuck ending is a finding. If P4's agent raises no behaviour decision at all, that is a finding too, and the runner raises it in P4's environment as a fallback so that section 9 still runs | 13, 14 |
| **F2** Visible text hidden in code | P8's request calls a label change internal, and the stand-in answers intake's visibility question "No, nobody sees this" | W3 | Intake `visible:false`; gate `visible:true` (a changed string literal in `src/lib/categories.js`); no self-merge | 30 |
| **F3** Killed feature session | `kill -9` on P1's `claude -p` process once its branch has a first commit | W2 | `resumed` incident; carry-on from the branch; P1 merges; resume count at most 3 (`RESUME_LIMIT`) | 33 |
| F3b (full only) | `kill -9` on the foreman during the tick after P4 merges, before it starts the approved P7 | W4 | Within 10 minutes the watcher re-raises `work-ready` (`recovered: true`) and P7 starts; a `lost` row in `reliability.jsonl` is a finding | 34 |
| **F4** Same-file clash | P4 and P7 typed together; both plans touch `src/pages/month.js` | W4 | The wait text; P7 starts after P4 merges; no merge conflict | 12 |
| **F5a** Undo, clean | Front desk `undo <P6 merge sha>` (the full sha), typed after the lift; the director approves it in the helper window | W3, after F6 | "Take back: …" pull request, merged; the Node 24 entry gone from `main`'s CI workflow | 36 |
| **F5b** Undo that clashes | `undo <P2 merge sha>` after P3 has changed `src/lib/categories.js`; the director approves it in the helper window | W4 | After the click (the helper makes the revert only once the undo is approved, in `scripts/host/undo.js`), the clash reply and card; nothing pushed | 37 |
| **F6** All stop | The stand-in types "all stop", then `undo <P6 merge sha>` | W3, once P3 slice 1 is building | Stop set; no new start for 5 minutes; a merge refused with "All stop is on"; the undo denied by the stop-guard hook; then the lift | 38–40 |

P3 keeps building during F6; All stop stops new starts and merges, not running sessions. Its merge waits until the lift.

## 9. The live decision path with typed replies on

This is the first live check of typed replies, so it gets its own script inside W4. P4's decision is "Should moving one transaction also make a rule for that shop?", raised by the agent as a director-kind `behaviour` call at level 3.

1. **Raised.** The front desk shows decision 1 in the chat. The status on P4's head reads "Waiting on decision 1". An ntfy alert arrives (row 43).
2. **The edge cases first,** each typed by the stand-in; each must record nothing and give its note:
   - `3 A`: no such decision;
   - `1 E`: beyond the options;
   - `why 1`: answered by the why fork in 100 seconds or less.
3. **A second decision is raised by the runner.** It is right-shaped, with its own question text, and goes through the feature CLI in P4's own environment (P7 has no session while it waits), so that a bare `A` is ambiguous between them. The stand-in types `A` and must get the "which one" note.
4. **The answer.** The stand-in types `1 B` (make no rule; move just this one). Expected:
   - a `decision-answer` with `where: 'chat'` and label B;
   - the status on P4's head no longer names decision 1;
   - its proof note, when it comes, lists the decision under "Decisions followed";
   - a `docs/decisions` file appears.
5. **Private.** The stand-in types `2 B private` to decision 2. It is recorded with `private: true`, and no project file is written for it. This matters because the project is public. The status then reads "No decision waiting", and P4 carries on and builds B.
6. **Already answered.** The stand-in types `1 A`. The note says when and how decision 1 was answered, and nothing is recorded.
7. **The director's own typed answer** comes in section 11, step 7, on a third decision the runner raises in W6, after the steps above. That is the one reply in the trial typed by a person.

**Why tmux:** a reply records only when the session is an interactive front desk not started by a script. That means `CLAUDE_CODE_ENTRYPOINT` is not `sdk-…` and no `WHEELHOUSE_*` starter variable is set. The runner starts that session in tmux with a clean environment. Before step 2 it checks typed replies are on with `typedRepliesOn(project)` from `scripts/decisions/answer.js`, or from the session-start context, not from the pane's look.

## 10. End-product quality

Scored at the end, separately from path success. It is 100 points.

### 10.1 Held-back checks (40 points)

A suite the agents never see. It lives in the kit and is excluded from the plugin's install, and the peek check in section 4.3 confirms no session read it.

- It starts the app on `main` with `LEDGER_DB=:memory:` and imports a second generated statement (seed 7, four months).
- That statement holds every awkward case:
  - refunds in brackets and with a minus sign;
  - a byte-order mark;
  - quoted commas;
  - a duplicate row;
  - month-end dates;
  - an unknown merchant.
- It also tests: import twice adds nothing; a bad file gets an error; the edit moves one row; export gives the right rows.
- About 25 checks. Score = share passed × 40.

### 10.2 Data reconciliation (15 points, all or nothing)

For each of the four months, every `data-total` on `/month` must equal the generator's own expected total, to the cent, and so must the grand total. Any miss scores 0, because a money tool that is wrong by a cent is wrong.

### 10.3 Acceptance checklist (15 points)

Written from the spec in section 5.4 before the trial, and kept in the kit. There are 15 items, one point each, checked by the runner against the running app. Examples:

- empty state wording;
- the "added n, skipped n" message;
- previous and next month links;
- the download link's file name names the month;
- every form field has a label;
- the page title names the page.

### 10.4 The project's own tests (15 points)

- **Written (5).**
  - Unit tests exist for parsing, categorising and the month totals.
  - At least one end-to-end test each for the upload and the dashboard.
  - Every piece that changed `src/` added or changed a test.
- **Green (3).** `npm test` passes on `main` in CI.
- **Kept (4).**
  - No test file was deleted in the history: `git log --diff-filter=D -- tests/` is empty.
  - No `.skip`, `todo` or `{ skip` appears in `tests/`.
  - The test count only rose across merges.
- **Bite (3).** The runner flips the refund sign in `parseAmount` and the category of one rule, one at a time. The project's own tests must fail on each.

### 10.5 Accessibility (10 points)

axe-core runs, through the kit's `playwright-core` on the installed Chrome, on `/`, `/import`, `/month` and `/edit`. The project itself needs no browser.

- No serious or critical violations scores 10.
- Each distinct serious rule costs 2 points; a critical one scores 0.

### 10.6 Code health (5 points)

One point each:

- no file over 300 lines;
- no `TODO` or `FIXME` left;
- no dependency listed but unused;
- `npm audit --omit=dev` shows no high finding;
- a fresh clone runs `npm ci && npm test && npm start` as the README says.

### 10.7 Pass bar

All of the following:

- an overall score of 80 or more;
- reconciliation full (15);
- held-back checks at 90% or more;
- no critical accessibility violation.

The score and each part go into the results (section 12) beside the director's verdict.

## 11. The director's hands-on review (15 minutes or less)

When W6's score is in, the front desk raises one card in the decision shape. In the chat it reads like this.

> **Check the spending tracker Wheelhouse built on Haiku**
>
> **What this is.** The trial's last step: you try the finished product for about 15 minutes. Score: <n>/100 (pass bar 80), <paths passed>/<paths in scope> paths passed. <one line on any known floor>.
>
> **Why it comes to you.** Whether this is good enough to tag v0.3.0 as "works on Haiku" is your call.
>
> **Try this,** at <the production address>:
>
> 1. Open the home page. *Good:* three months listed, no errors.
> 2. Open last month. *Good:* totals by category, a grand total, and a change from the month before.
> 3. Import `try-me.csv`, from the link on the card; it is generated and has no real data. *Good:* "added 41, skipped 0", and a new month appears.
> 4. Import it again. *Good:* "added 0, skipped 41".
> 5. Find the $40 refund in that month. *Good:* it lowers Shopping, not raises it.
> 6. Move one transaction to another category. *Good:* it moves, and the totals change to match.
> 7. In the chat, type your answer to decision <n> (a small question the trial kept for you). *Good:* the reply says it is recorded.
> 8. Open the tracker on your phone. *Good:* readable without zooming sideways.
> 9. Open one merged pull request's description. *Good:* you can tell what changed and why without reading code.
>
> **Options**
>
> - **A. Good: tag it as "works on Haiku".** Cost: none. Undo: the tag can be moved before release notes go out.
> - **B. Works, but not good enough to claim.** Tag v0.3.0 without the Haiku claim, and record what fell short as known floors. Cost: the claim waits for a later run. Undo: a later run can add it.
> - **C. Not yet: hold the tag.** Say what is wrong, and it goes to intake as bugs. Cost: the tag waits. Undo: answer again after the fixes.
>
> **I recommend** A if the score passed and every path passed; B if the score passed but a path failed on a Haiku limit; C otherwise.
>
> **Meanwhile:** nothing builds; the tracker stays up for you.

The card has to fit the phone limit (1,400 characters or 18 lines). The steps therefore sit behind a "Show the steps" link, a short page the runner writes next to the tracker. The card shows the options and the recommendation.

Their answer, any words they add, and the time they took are recorded with the score. Step 7 is the live typed-reply check with a person typing.

## 12. Failure classification and where results go

### 12.1 Sorting a failure

Each failed signal gets one of three labels, decided by the order below.

1. **Kit fault.** The runner or a check is wrong: a bad selector, a timing, a wrong name from step 9. Mend the kit and re-run that wave. Not a finding.
2. **Wheelhouse fault (mend it).** The model did something reasonable and Wheelhouse's prompt, check or wording led it astray, missed it, or gave it no way out. The test is whether a clearer instruction, a check, or a plainer note would let Haiku pass. Examples:
   - a send-back note Haiku can't act on;
   - a skill step that assumes context Haiku lacks;
   - a check that fires on a right answer.

   It becomes a bug through intake, with the trial's evidence attached.
3. **Haiku floor (record it).** Wheelhouse gave clear, correct instructions and checks, and Haiku still could not do it after the allowed retries. Examples:
   - a decision stuck after three send-backs on a fair note;
   - a plan that misses half the spec twice.

   It is recorded as a known floor, with the role it affects and a suggestion: pin that role to a larger model.

To tell 2 from 3, re-run just that piece once with only the failing role moved up to the mid-sized model. If it passes, and the transcript shows Haiku misread a clear instruction, it is a floor. If the instruction itself was unclear, it is a Wheelhouse fault whichever model passes.

### 12.2 Where results go

- **Raw results** stay on the Mac, outside every repository, in `~/.wheelhouse-trials/haiku-<date>/`:
  - transcripts and stream-json;
  - the event log export;
  - pane captures;
  - the runner's signal log;
  - usage per session.
- **A public summary** goes in Wheelhouse at `docs/trials/<date>-haiku-trial-results.md`. It holds:
  - each path row and its result;
  - each failure, its label and its follow-up;
  - the known floors;
  - the quality score by part;
  - the director's verdict as an option letter, with their added words only if they agree;
  - measured cost and time.

  It names nothing private. The test project is public and its data is generated.
- **Known floors** also go in one line each in the v0.3.0 release notes.

## 13. Out of scope

- **Parked** (`docs/parked.md`):
  - the mod (pane, status line, courier);
  - Copilot and Lean;
  - Archon and the engine side, including the slices switch demo, `milestones`, `scripts/engine/feature.js`, `flag.js` and `preview.js --flag-on`;
  - the VS Code add-on;
  - delegation and concept learning;
  - screenshot approvals;
  - Windows Locked;
  - unattended goals.
- **Not this trial:**
  - GitLab and local hosts;
  - Windows;
  - the update command (covered by release checks);
  - Telegram alerts (ntfy covers the alert path cheaply);
  - the data route `real` (never with real data);
  - `pull-back --change` (it starts a whole piece for a path the plain `pull-back` already shows);
  - Locked protection.
- **Previews,** only if section 5.5 falls back to option 3.

## 14. Cost and time

All figures are planning figures for Haiku. Most tokens are cache reads, so the real usage weight is much lighter than the raw count suggests. The first run's measured figures replace these.

| | Model sessions | Tokens (all kinds) | Clock time |
|---|---|---|---|
| **Full trial** (S0, P1–P8, faults, W5, W6) | ~10 feature sessions, foreman ticks, one front desk, about 6 why and review forks | ~35–45M | ~5 hours of waves, plus the wait past midnight for the daily batch (no model), plus the director's 5-minute helper-window sitting and 15-minute review |
| **Smoke** (below) | 4 feature sessions | ~12–15M | ~1.5 hours |

The runner and every check cost no tokens. The quality score has no model in it.

### 14.1 Smoke subset

For a quick look after a change to prompts or checks, not for the tag.

| Smoke piece | Covers |
|---|---|
| S0 setup | 1, 2, 45 |
| P1 import, with F3 kill | 3, 7, 8, 10, 25–28, 33 |
| P2 categorise | 5, 22, 28 |
| P4 re-categorise, with section 9 steps 1, 2 and 4 | 13, 16–18, 21, 31 |
| P6 quick | 4, 29 |

It runs in three steps: S0, then P1, P2 and P6 together, then P4. It gives a reduced score, sections 10.2 and 10.4 only, with no pass bar. It leaves out undo, which needs the director's click, so the smoke needs no director at all.

## 15. What the builder decides, and calls made here

**Calls made in this design** (the director can overturn any):

- The spending tracker, plain Node, pages under `src/pages/`.
- GitHub only, with a public test repository.
- Vercel for previews, with the tunnel and "not covered" as fallbacks.
- The runner plays the director, except for the three director steps in section 7.1.
- The score's weights and the pass bar.
- Results split between a private folder and a public summary.

**Left to the builder**

- The kit's file layout under `probes/haiku-trial/`, and how it is kept out of the plugin's install (the peek check backs this up).
- The router library and the `sql.js` fallback in the seed.
- How the runner waits for each signal: polling the helper's views versus tailing the event log.
- Whether the helper window's All stop lift can be clicked by the runner in a headless browser, or must be the director's click. The undo approvals are the director's signed clicks either way, so the lift joins them in the one sitting if it can't be the runner's.
- Test hooks to make the daily batch and the digest come sooner, if they exist after step 9. If not, the run waits for the clock.
- Names from step 9: check `digestAt`, `alertText`, `sendAlert` and `alerts ntfy <topic>` against what merged.
- Where the runner takes each kill target's process id (F3, F3b): the watcher's folder, or the session found by its `WHEELHOUSE_SESSION`.
- Who runs the watcher during the trial, and its tick period. Row 34's 10 minutes assumes the usual period.
- How the runner calls the feature CLI in a session's place (F1, section 9 step 3): that session's worktree as the working folder and the same sandbox, as well as its environment.
- Whether `scripts/engine/preview.js`'s local preview command works on the own engine. If it does, it may be a simpler stand-in for option 2 in section 5.5.

**Next:** a build plan for the kit (`superpowers:writing-plans`), then the build, then the run after step 9 merges.
