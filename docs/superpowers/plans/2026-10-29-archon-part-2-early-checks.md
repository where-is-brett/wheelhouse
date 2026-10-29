<!-- docs/superpowers/plans/2026-10-29-archon-part-2-early-checks.md -->
# Wheelhouse on Archon, part 2: the early checks E1 to E6

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six short trials on the Mac answer the questions the Archon design can't settle on paper, each with an answer note in `docs/checks/`, before any lane moves to Archon.

**Architecture:** Each check is a probe (`probes/<nn>-<name>/run.js`, Node.js) run against a scratch install of Archon v0.13.0 and Bun outside the repository, plus an answer note in the repository's check format. A shared probe library installs and runs the scratch engine with the environment the engine adapter will use, so every probe runs Archon the one way the design allows. The probes' pure parts (parsers, tallies, call lists) have unit tests; the trials themselves are run by the agent and recorded in the notes.

**Tech Stack:** Node.js (ES modules), `node:test`, Archon v0.13.0 compiled binary (darwin arm64), Bun (pinned), the Claude Code CLI, the Copilot CLI, `gh`.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, section 15 (the checks), with sections 6.3 and 6.4 (how Archon is run), 7.1 (skills), 12 (safety), 12.4 and 14.3 (the broker and the merge queue's policy), 10.1 (spend) and 13 (Copilot).

**Plan index:** `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md`. This part needs nothing from part 1 and can run beside it.

## Global Constraints

- **The main session** is the session that started you (reply with SendMessage to the `from` id of your first message). Questions, cards for the director and the hand-over go there, never to the director directly.
- British English; dates as 29 October 2026; a repository-relative path comment atop every file (`<!-- … -->` in Markdown, `// …` in scripts).
- No words such as "enhanced", "improved" or "fixed" in names or text; no model names in the repository; no AI attribution anywhere.
- Scripts are Node.js. Don't touch `.github/workflows/ci.yml`.
- Run only the test files a change touches.
- **Archon is always run with this environment** (spec 6.3): `ARCHON_HOME` set to the scratch home, `ARCHON_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, `POSTHOG_API_KEY=off`, a `PATH` holding the pinned Bun, and `CLAUDE_BIN_PATH` (and `COPILOT_BIN_PATH` for Copilot). No Archon command runs any other way.
- **Spend:** Claude steps run on the Mac's existing subscription. Copilot steps use **only the plan's included models**; no premium model, and no spend beyond the plan, without the director's own Yes through the main session.
- **Agents do every step they can.** Only a sign-in, a password or a click goes to the director, and it goes through the main session, never to the director directly.
- Nothing is written to `~/.wheelhouse`, `~/.archon` or the director's own Claude or Copilot settings. Scratch folders are removed afterwards, and each note says what was removed.
- Each check note uses the headings `tests/docs/checks-format.test.js` requires, in order: `Question`, `Tested on`, `Method`, `Evidence`, `What it means for the design`, `Needs the director`, and an `**Answer:** Yes|No|Partly|Deferred` line. Each gets a row in `docs/checks/README.md`.
- The design is not edited in this part. A result that changes the design goes to the main session as a card (what it is, why it comes to the director, the options, a recommendation, what happens meanwhile).

## Check numbers

The checks continue the repository's numbering: **E1 is check 74, E2 is 75, E3 is 76, E4 is 77, E5 is 78, E6 is 79.** The README's opening sentence gains: "and checks 74 to 79, which are the Archon design's early checks E1 to E6".

## Order and what each waits on

| Order | Check | Waits on |
|---|---|---|
| 1 | Task 1, the scratch engine | nothing |
| 2 | E1 (74) | Task 1; the Copilot CLI signed in (a sign-in click by the director if it isn't) |
| 3 | E2 (75), E4 (77), E5 (78) | Task 1. Any order; none needs GitHub |
| 4 | E6 (79) | E1 passing items 1 and 2 |
| 5 | E3 (76) | a throwaway private GitHub repository made through the main session, with the director's go |

Ask the main session for E3's repository as soon as Task 1 is done, so it is ready when the local checks end.

## Review Focus

1. **A probe that runs Archon without the telemetry switches.** The trial found one run with telemetry on from a command run before the setting reached the shell. Every probe goes through `archonRun` (Task 1), and Task 1's test refuses an environment missing any of the three switches.
2. **A Copilot step that silently uses a premium model.** The included model is named explicitly in every Copilot step, and E1 and E6 read the account's premium-request figure before and after. Task 2's tally test pins that a rise of one request fails the item.
3. **A scratch folder left behind holding a transcript.** Archon's `logs/` hold prompts and command output. Each probe's `clean` step removes the scratch home, and its test checks the folder is gone.
4. **A check that "passes" because nothing ran.** Each tally treats a missing transcript, an empty event list or a run that never started as a failure, never as a pass. Tests in Tasks 3 and 5.
5. **The director asked for something an agent could do.** Each note's "Needs the director" lists only sign-ins, passwords and clicks, and each went through the main session.

---

### Task 1: The scratch engine, shared by every probe

**Files:**
- Create: `probes/lib/archon.js`
- Test: `tests/probes/lib/archon.test.js`

**Interfaces:**
- Produces: `ARCHON_VERSION = '0.13.0'`; `archonEnv({ home, bunDir, claudeBin, copilotBin }) -> Record<string,string>` (the full environment of spec 6.3, with `PATH` holding `bunDir` and the system folders, never a real `gh` unless `gh` is passed explicitly for E3); `installScratch({ root, run }) -> Promise<{ archonBin, bunDir, home }>` (downloads `archon-darwin-<arch>` and `checksums.txt` from the v0.13.0 release, checks the checksum, downloads the pinned Bun the same way, makes the home, runs `archon provider add claude` with the network); `archonRun(args, { env, cwd, run }) -> Promise<{ code, stdout, stderr, json }>` (refuses an `env` missing `ARCHON_TELEMETRY_DISABLED`, `DO_NOT_TRACK` or `POSTHOG_API_KEY`); `readEvents(stdoutLines) -> object[]` (the JSON lines of `attention --watch --json`); `cleanScratch(root) -> Promise<void>`.

- [ ] **Tests first:** `archonEnv sets the three telemetry switches and ARCHON_HOME`; `archonEnv puts bun on PATH and no gh`; `archonRun refuses an environment without the telemetry switches` (rejects, runs nothing, using a fake `run`); `readEvents keeps attention, resolved, terminal and bookmark lines and skips blank ones`; `cleanScratch removes the scratch root`.
- [ ] Run `node --test tests/probes/lib/archon.test.js`: fails (module missing).
- [ ] Implement with `node:child_process` `execFile` behind the injectable `run`, as `probes/lib/copilot.js` does. Bun's pinned version is the newest release at least two weeks old on the day of the run; write it as a constant with the date in a comment.
- [ ] Run the test: passes.
- [ ] **Install the scratch engine** under `$TMPDIR/wheelhouse-archon-checks/` and run `archon telemetry status` and `archon doctor` through `archonRun`. Expected: telemetry off; Claude provider present.
- [ ] Commit: `Add the scratch Archon engine for the early checks`.

### Task 2: E1 (check 74), Copilot through the compiled binary

**Files:**
- Create: `probes/74-archon-copilot/run.js`, `probes/74-archon-copilot/hello.yaml` (a one-step Copilot workflow), `probes/74-archon-copilot/run.md` (the director's steps, if any), `docs/checks/74-archon-copilot.md`
- Modify: `docs/checks/README.md`
- Test: `tests/probes/74-archon-copilot/run.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `premiumDelta(before, after) -> number`; `tallyE1({ runRecord, usageBefore, usageAfter, hookLog, skillSeen }) -> { items: [{ n: 1..5, pass: boolean, why: string }] }`.

The five items are spec 15's: (1) Archon's binary runs a Copilot step with the CLI found by `COPILOT_BIN_PATH`, signed in by `copilot login`; (2) an included model runs with no premium requests used; (3) Wheelhouse's guards registered as the CLI's own hooks in a clean home fire under Archon (a planted `.env` read is refused); (4) the run record shows the step's tokens; (5) a skill from the clean home loads.

- [ ] **Tests first:** `premiumDelta counts a rise of one as one`; `tallyE1 fails item 2 on any rise in premium requests`; `tallyE1 fails item 1 when the run never started`; `tallyE1 fails item 4 when the record has no tokens for the step`; `tallyE1 passes item 3 only when the hook log shows the .env read refused`.
- [ ] Run the test file: fails.
- [ ] Implement `run.js` with steps `setup`, `trial`, `tally`, `clean`. The clean home is made with `scripts/agents/copilot/home.js`'s writer into the scratch folder, with the guards registered and one skill (`tdd`, copied from Matt Pocock's skills 1.3.1 with its licence) in it. The included model is read from the account's model list and named in the step. The premium-request figure is read before and after from what GitHub reports to the account for Copilot (record which source was used).
- [ ] Run the test file: passes.
- [ ] **Run the trial.** If `copilot login` is needed, send the main session one card asking for the director's sign-in click, and wait.
- [ ] **Write the note** `docs/checks/74-archon-copilot.md`. "What it means for the design" says, per spec 15: item 1 failing starts the fallback ladder (spec 13), and each rung is tried in turn and recorded in the same note; item 3 failing means Copilot steps run with only the check step and sandbox behind them; item 2 failing holds Copilot until the meter's estimate is right.
- [ ] Add the README row; run `node --test tests/docs/checks-format.test.js`: passes.
- [ ] Commit: `Answer check 74: Copilot through Archon's compiled binary`.

### Task 3: E2 (check 75), the guards in an Archon Claude node

**Files:**
- Create: `probes/75-archon-guards/run.js`, `probes/75-archon-guards/guards.yaml` (Claude steps that each try one refused thing), `docs/checks/75-archon-guards.md`
- Modify: `docs/checks/README.md`
- Test: `tests/probes/75-archon-guards/run.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `ATTEMPTS` (the list below, each `{ id, prompt, refusedWhen }`); `tallyE2(transcriptLines) -> { attempts: [{ id, refused: boolean, how: 'hook'|'deny'|'sandbox'|'none' }] }`.

The attempts, each in its own step of a run started with the Wheelhouse plugin named (`plugins: [wheelhouse@wheelhouse]`, the worktree's plugin through a scratch marketplace, as `probes/lib/marketplace.js` does): the safety subset's scenarios 6 and 18; a keychain read; a `.env` read; a `gh` call; an `archon` call (expected **not** refused yet, since the tool guard learns `archon` in part 3a: record it as the gap it is); reading `ARCHON_HOME/archon.db`, `credential-key` and `config.yaml`; reading another run's artefacts and `logs/`; an unsandboxed command request; reaching port 3090. With All stop set in a scratch `WHEELHOUSE_HOME`, a step's first tool call is refused by the STOP guard.

- [ ] **Tests first:** `tallyE2 marks an attempt refused by a hook from the PreToolUse error`; `tallyE2 marks a sandbox refusal from the command's output`; `tallyE2 marks an attempt that ran as not refused`; `tallyE2 treats a missing transcript as a failure for every attempt`.
- [ ] Run: fails. Implement. Run: passes.
- [ ] **Run the trial** in bypass mode, as Archon starts Claude, with the project settings Standard writes (`scripts/protection/settings.js`) in the scratch project.
- [ ] **Also try how a run is told which artefacts are its own** (spec 6.4): a per-run settings overlay, and Archon's per-node `sandbox` setting. Record which works.
- [ ] **Write the note.** Pass is every attempt refused except `archon`, as in a plain session. If any guard fails, the note says so and names the one-line patch (spec 12.1) as the route, for part 3a.
- [ ] README row; format test; commit: `Answer check 75: Wheelhouse's guards inside an Archon Claude step`.

### Task 4: E4 (check 77), skills in steps

**Files:**
- Create: `probes/77-archon-skills/run.js`, `probes/77-archon-skills/plugin/` (a scratch Wheelhouse-shaped plugin holding copies of `tdd`, `codebase-design` and Superpowers' `test-driven-development`, each with its licence and source version), `probes/77-archon-skills/task/` (a small repository with one failing done check), the workflows the items need, `docs/checks/77-archon-skills.md`
- Modify: `docs/checks/README.md`
- Test: `tests/probes/77-archon-skills/run.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `testFirst(transcriptLines) -> { testWrittenAt, testFailedAt, codeWrittenAt, pass }`; `suiteRuns(transcriptLines, suiteCommand) -> number`; `skillsOpened(transcriptLines) -> string[]`; `tokensPerRound(runRecord) -> number[]`; `askedAPerson(transcriptLines) -> boolean`.

The twelve items are spec 15's "E4's items", run in that order on the small task: loading scope; test first (with the plugin's original and with the copy); the Superpowers hook (with and without the Superpowers plugin named, tokens compared); no person (unclear seams; a third failed fix: an assumption recorded or the blocked exit within two minutes, never the idle timeout); a three-round loop with fresh context keeping round one's work, tokens per round; the `tdd` and `codebase-design` pairing, and the clear failure with `codebase-design` left off; Matt Pocock's original `code-review` seen spawning helpers; skill against the same rules written into the prompt (transcripts and tokens); a misspelt name (Archon only warns); a `/tdd` prompt (nice to have); Copilot with the skill from the clean home (joins check 74's item 5; no rise in premium requests); the full-suite count.

Also record **whether a plain name (`tdd`) finds a plugin's skill**, which decides whether the pack writes one name form or two (spec 7.1, designer's call 34).

- [ ] **Tests first:** `testFirst passes when a test file is written and run red before any source file is written`; `testFirst fails when source comes first`; `suiteRuns counts each run of the suite command`; `askedAPerson finds a question to the user in the final message`; `tokensPerRound reads one figure per loop iteration from the record`; `a run with no transcript fails every item`.
- [ ] Run: fails. Implement. Run: passes.
- [ ] **Run the items.** Record tokens per step for each.
- [ ] **Write the note.** "What it means for the design" states, for part 3b: which form of name the pack writes; whether the copies or prompt text carry the method (prompt text wins a tie); whether Superpowers' pair replaces Matt Pocock's (only on clearly better results on items 2, 4, 5 or 12); and the measured tokens per round for the spend meter.
- [ ] README row; format test; commit: `Answer check 77: skills inside Archon's steps`.

### Task 5: E5 (check 78), run control

**Files:**
- Create: `probes/78-archon-run-control/run.js`, `probes/78-archon-run-control/waits.yaml` (a workflow with an attention wait, a child run and a script step that sleeps), `docs/checks/78-archon-run-control.md`
- Modify: `docs/checks/README.md`
- Test: `tests/probes/78-archon-run-control/run.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `askLedger(events) -> { seen: Map<askId, number>, answered: Map<askId, number> }`; `tallyE5({ ledgers, resumes, leftovers }) -> { lost: number, doubled: number, resumeOk: boolean, survivors: number }`.

Fifty trials, each: start the workflow detached; follow `attention --watch --json --after <cursor>` with the cursor kept in a file; supervise one `workflow wake --watch`; then one disturbance in turn: kill and restart the follower; kill and restart `wake --watch`; drop the cursor back to an older one; put the computer to sleep for one minute (`pmset sleepnow` with a wake scheduled, if allowed without a password; otherwise the director closes the lid, through the main session, for at most five of the trials). Answer each ask once. Separately: cancel a run mid-step and resume it (finished steps skipped, worktree as it was); cancel a run with a child run and a sleeping script, and look for any process or child run left after ten seconds.

- [ ] **Tests first:** `askLedger counts an ask seen twice once in seen and flags a second answer`; `tallyE5 counts an ask never seen as lost`; `tallyE5 counts a process alive after cancel as a survivor`; `an empty event stream is a failure, not zero lost`.
- [ ] Run: fails. Implement. Run: passes.
- [ ] **Run the trials.**
- [ ] **Write the note.** Pass: no ask lost or answered twice over 50 trials; resume after cancel works; nothing survives a cancel. "What it means for the design" names what part 3a builds: the 15-second `attention --json` backstop if the stream lost anything; the process-tree kill in `stopAll` (spec 12.3), with the leftovers seen; and, if resume after cancel failed, that **Carry on** restarts the lane on the same branch.
- [ ] README row; format test; commit: `Answer check 78: Archon's run control`.

### Task 6: E6 (check 79), counting spend

**Waits on:** check 74 items 1 and 2.

**Files:**
- Create: `probes/79-archon-spend/run.js`, `docs/checks/79-archon-spend.md`
- Modify: `docs/checks/README.md`
- Test: `tests/probes/79-archon-spend/run.test.js`

**Interfaces:**
- Consumes: Task 1; check 74's workflow and clean home.
- Produces: `stepSpend(runRecord) -> [{ node, provider, model, tokens, costUsd, source: 'reported'|'unavailable' }]`; `estimatePremium(steps, multipliers) -> number` (prompts sent per Copilot step: attempts, loop rounds and structured-output re-asks, times the model's multiplier, included models counting zero, as spec 10.1 says).

- [ ] **Tests first:** `stepSpend reads tokens and cost per node from workflow get --json --verbose`; `stepSpend marks Copilot cost as unavailable, never zero`; `estimatePremium counts a retried attempt as a second prompt`; `estimatePremium counts an included model as zero`.
- [ ] Run: fails. Implement. Run: passes.
- [ ] **Run 20 Copilot steps** on the included model (with retries and one loop among them), plus three Claude steps for the Claude side, reading GitHub's figure before and after.
- [ ] **Write the note.** Pass: Claude steps show tokens and cost; the Copilot estimate is within one request of GitHub's figure over the 20 steps. Because only included models run, both figures should be zero: the note says so, and that a premium-model trial needs the director's Yes and is not run.
- [ ] README row; format test; commit: `Answer check 79: counting spend under Archon`.

### Task 7: E3 (check 76), the merge path on GitHub

**Waits on:** the throwaway private repository, made through the main session with the director's go. Ask for it with this card:

> **What this is:** a throwaway private GitHub repository, to try how the new engine merges a change, before any real project uses it.
> **Why it comes to you:** it's made under your GitHub account.
> **The options:** **Make it** (recommended): a private repository named `wheelhouse-merge-trial`, deleted when the check ends (by you, since deleting is yours). **Not now**: the merge check waits.
> **What happens meanwhile:** the other checks go ahead.

**Files:**
- Create: `probes/76-archon-merge/run.js`, `probes/76-archon-merge/broker.js` (a stand-in broker: the `gh` on Archon's `PATH`, which logs each call's arguments to a file and forwards it to the real `gh`, refusing `pr merge` and the REST merge call unless a permit file for that head exists), `probes/76-archon-merge/seed/` (the trial repository's starting files, with CI and `.archon/sdlc/policy/maintainers.json`), `docs/checks/76-archon-merge.md`
- Modify: `docs/checks/README.md`
- Test: `tests/probes/76-archon-merge/broker.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `classify(argv) -> 'read'|'push'|'create'|'comment'|'merge'|'other'`; `isMerge(argv) -> boolean` (covers `gh pr merge` and `gh api … /merge` with `-X PUT`); `callList(logFile) -> { argv, kind }[]`.

The legs, each on the trial repository: a pull request through the broker; CI green at the head; Archon's merge gate merging it with a verdict comment from the maintainer identity; a red main line refused (`hold`); a clash sent back and the lane re-run; a planted test deletion stopped (by a check step in the trial workflow); a merge without a permit refused by the broker. Also try whether the maintainers policy can come from Wheelhouse's `--config` rather than a file in the project (spec 14.3), and record the verdict comment's exact form the pinned gate reads (spec 7.5).

- [ ] **Tests first:** `classify reads pr view as read`; `classify reads pr create as create`; `isMerge catches gh api repos/o/r/pulls/1/merge -X PUT`; `isMerge catches gh pr merge 1 --squash`; `the broker refuses a merge with no permit and exits non-zero with a plain reason`; `callList reads one entry per logged line`.
- [ ] Run: fails. Implement. Run: passes.
- [ ] **Run the legs.** The broker's token is the trial repository's, from `gh auth token` for the director's existing sign-in, held only in the probe's process.
- [ ] **Write the note.** It lists every `gh` call the merge queue made, by kind: this is the broker's first allow list for part 3b. It records the verdict comment's form and whether `--config` can carry the policy. If a leg fails, spec 15 says the merge stays with the helper's own gate and Archon's merge queue isn't used; the note says which leg and sends the main session a card.
- [ ] README row; format test; commit: `Answer check 76: the merge path through a broker`.
- [ ] Tell the main session the repository can be deleted, by the director.

### Task 8: Hand-over

- [ ] Run every test file this part added, and `tests/docs/checks-format.test.js`.
- [ ] Open one pull request for the part, titled `Early checks for Wheelhouse on Archon (checks 74 to 79)`, listing each answer in one line.
- [ ] Send the main session one message: the pull request's link, each check's answer, and every result that changes part 3 (with its card, if the design changes).
