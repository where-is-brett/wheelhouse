<!-- docs/specs/2026-11-09-haiku-failure-diagnosis.md -->

# Haiku trial: why it fails, and what would make it pass

Date: 9 November 2026. Diagnosis and design only. No Wheelhouse code changed and no trial was run.

## 1. The answer in brief

Haiku does not fail the trial because it is too small. Across eight runs I found only small slips that are genuinely Haiku's, and none of them stopped a run (section 4). The runs stop for two reasons.

1. **Wheelhouse asks the model to do things code should do, and some of those can't be done at all.**
   - Haiku had to hand-assemble the approve-work card from ids that `record work` prints misleadingly. If it uses the printed id, no card can ever pass the check (section 3.2).
   - When a feature's first push changes a CI file, the push is refused "until the director clicks its card". No code path makes that card, on any model (section 3.5).
   - Each card must be retyped character for character. Claude Code's own tool description tells the model to change the label (section 3.3).
2. **The trial kit stopped or misread every run** before most rows could be tried.
   - It typed into busy panes and open pickers.
   - It sent a command that waits for a click in a window nobody clicks.
   - It looked for feature sessions where this layout doesn't put them.
   - It picked a CI-only change for a row that Wheelhouse's own gate forbids (section 3.9).

In the clean run, `-c`, 27 of the 31 failed rows were never reached (section 5). The run stopped in wave 2 because P1 never got an approval card, so it never built (`haiku-diag-kit.md` §1; `K/runner.js:582`).

Eleven fixes are ranked in section 6. The top two are deterministic code. Together they unblock the wave-2 merges that every later wave waits on. Section 7 lists the rows I expect to pass after the fixes. Section 8 says what a re-run needs.

## 2. Sources and how they are cited

Seven readers went through the transcripts in parallel. Their full notes, with the same citations, are kept beside this work in the shared notes folder: `haiku-diag-run-{b,c,d,e,h}.md`, `haiku-diag-runs-f-g-09.md`, `haiku-diag-kit.md`. I spot-checked the code citations below against this branch (origin/main 4fa56e16).

| Short name | Path |
|---|---|
| `R-x` | `~/.wheelhouse-trials/haiku-2026-11-0N-x/` (the run folder; `R-09` is `haiku-2026-11-09`) |
| `c/T2`, `c/T7` | `R-c/transcripts/002-front-desk-43bf2fd3…jsonl` (the only real front desk), `007-front-desk-cc92b49d…jsonl` (the ci-node-24 feature session, mislabelled by the kit) |
| `h/004`, `h/005`, `h/001` | `R-h/transcripts/004-…` front desk, `005-…` ci-node-24 feature, `001-…` Bosun |
| `d/T` | `~/.claude-haiku-trial/projects/-Users-brett--wheelhouse-trials-haiku-2026-11-08-d-project/22290e8d-….jsonl` (setup) |
| `e/DESK`, `e/BSI`, `e/SHOP` | under `~/.claude-haiku-trial/projects/-Users-brett--wheelhouse-trials-haiku-2026-11-08-e-project…/`: `a0cb1d7c…` front desk, `--claude-worktrees-bank-statement-import/172932f7…`, `--claude-worktrees-shop-categories/8e1653d8…` |
| `b/T005`, `b/T009`, `b/T011`, `b/T019`, `b/T007` | `R-b/transcripts/005-…` First Mate; `009-…`, `010-…`, `007-…` Bosun; `011-…` categories feature; `019-…` ci-node-24 feature |
| `f-desk`, `f-P1`, `f-P2`, `f-CI`, `f-foreman`; `g-desk`, `g-CI`; `09-desk`, `09-CI` | the transcripts named in `haiku-diag-runs-f-g-09.md`, under `~/.claude-haiku-trial/projects/-Users-brett--wheelhouse-trials-haiku-2026-11-0…` |
| `K/…` | `probes/haiku-trial/…` (the kit) |
| `intake:N`, `FD:N`, `brief:N` | `skills/intake/SKILL.md`, `skills/front-desk/SKILL.md`, `templates/brief/brief.md` |
| `spec:N` | `docs/specs/2026-11-08-haiku-trial-design.md` |

A number after a transcript name is a jsonl line. Haiku's thinking blocks are empty in every transcript, so "why" is read from what it did and said. Wheelhouse line numbers are on this branch; the early runs staged an older plugin (-d staged f34f6e4), and the run notes cite lines in each run's own staged copy where they differ.

## 3. Each failure: the instruction, what Haiku did, and the sort

The sorts follow spec §12.1:
- (a) a kit or stand-in fault;
- (b) Wheelhouse asks the model for something code should do, or words it so that a small model misreads it;
- (c) a genuine Haiku limit.

I have been sceptical of (c) throughout.

### 3.1 Intake sized P1 "small" (runs -c, -e)

**Instruction.**
- intake:71 says "Start `superpowers:brainstorming`. Its size sets the lane". The table at intake:75-77 maps "do it" to Quick, "a small change" to Small and "a written design" to Feature.
- Those sizes come from the bundled brainstorming skill, where they describe *the conversation* ("in chat" against "a project with a written design"), not the amount of work (`~/.claude-haiku-trial/plugins/cache/wheelhouse/superpowers/7.0.0/skills/brainstorming/SKILL.md:129-140`).
- The same skill says to just do it when the request already holds everything (ibid. l.22-23).
- Nothing in Wheelhouse says what makes a request a feature.

**What Haiku did.**
- **-c.**
  - It loaded brainstorming (c/T2:104), then dropped it at once: "The brainstorming questions would go to you as plain text, and Wheelhouse asks every question as a card … I'm writing it up as a small visible change" (c/T2:111).
  - It recorded `small` (c/T2:125, 132), straight after telling the director the work "will get a written design before anything is built" (c/T2:103).
  - Brainstorming's opening asks for "one open question" in chat. That clashes with intake:13 and FD:15 ("never ask … in plain text"). The First Mate's context holds no override for brainstorming. That override exists only in feature briefs (`haiku-diag-run-c.md` Q1).
- **-e.**
  - It never loaded brainstorming. P1 arrived mid-turn while the desk was blocked on `alerts ntfy` (e/DESK l.77-82).
  - Its reason: "I sized it as a small change because the spec is complete and the pieces are few" (e/DESK l.181).
  - P1's text is a full spec (page, columns, date format, duplicate rule, messages, home-page list), so brainstorming's own table points at "small".
- Neither run used `cli.js similar` (intake:22), the nine questions (intake:26) or the watch line (c/T2 has no `similar` call; e/DESK Bash calls at l.76-265 contain none).

**Sort.**
- **(b)** mainly. The lane hangs on a word borrowed from a skill that measures something else. That skill's procedure also breaks a Wheelhouse rule, with no override in the desk's context.
- **(a)** in part. The kit's P1 is so complete that "small" is a fair reading of the rule as written, and in -e the kit typed P1 into a busy turn.
- **(c)**, mild. In -c Haiku told the director one lane and recorded another. That breaks intake:28, "Say 'quick', 'small' or 'feature' only for the lane you recorded".

### 3.2 P1 and P2 got no approve-work card (runs -c, -h)

**Instruction.**
- The only place that shows a target shape is the bug route: `{"work": "<id>", "lane": "bug", "hash": "<the hash record printed>", "shownFirst": true}` (intake:65). There, `<id>` is defined four lines up as "a short slug you choose" (intake:61).
- The change route just says "an `approve-work` card (lane `small`, with `shownFirst`)" (intake:76-77).
- FD:109 gives `what` as "Work <id>: …".

**What `record work` prints.**
- It prints `{ id, pushed, hash, recordHash }` (`scripts/frontdesk/cli.js:1126`, with `answered` at :1091).
- That `id` is the *event* uuid. The work's id is the slug Haiku itself sent. `views/work.json` shows `"key": "statement-import", "id": "663f62ed-…"` (`haiku-diag-run-h.md` §1).
- Other record commands print `work: <slug>` as well (cli.js:822, 882). `record work` does not.

**What Haiku did.**
- It used the printed uuid as `target.work`: c/T2:138-152 and h/004:124, 161.
- The card check first answered "An approve-work card's what must name the work 65b530ed-b8e7-…, as its set line does" (c/T2:153; h/004:220). This comes from `scripts/cards/compose.js:339`.
- Haiku obeyed and put the uuid in `what`. The check then answered "names commit 65b530ed, not the commit its set line names" (c/T2:176; h/004:246).
  - The cause is the hex scan at compose.js:354-358, `\b[0-9a-f]{7,64}\b`. Its `\b` matches at the uuid's hyphen, so the first group reads as a commit.
  - So once the uuid is the work id, **no wording can pass**. The first refusal demands the uuid and the second rejects it.
- In -h Haiku tried 11 times, then reported correctly: "The approval cards fail … This needs a look at the helper" (h/004:355).
- In -c it gave up after two tries, guessed "the card is probably meant to come from the build" (c/T2:218), and never tried P2's card.
- P2's `dependsOn` also held the uuid (h/004:153, 157).
  - `scripts/state/events.js:541` accepts it.
  - The queue matches dependencies by slug (`scripts/engine/dispatcher.js:189`, `scripts/foreman/queue.js:138`), so P2 would never have started even if approved.
- No recovery followed. `cards` returned `"questions": []` (c/T2:343). Three stand-in check-ins surfaced only the CI decision (c/T2:284, 328, 372).
  - Nothing tells the desk that a work is waiting with no card. The kit's stand-in counts only cards and questions (`K/runner.js:399-405`), so it never noticed either.

**Smaller slips in -h.**
- `CLI="node …"; $CLI card` gave exit 127 twice (h/004:180, 240). This is (c), minor.
- One run from the scratchpad folder (h/004:252). Also (c), minor.
- `sed -i ''` was refused by the front-desk write hook (h/004:273-279). That is a code bug: `scripts/hooks/front-desk-writes.js:150-156` drops the empty suffix instead of the script, so the script is judged a project file.

**Sort.**
- **(b)**, firmly:
  - a misleading printed `id`;
  - `<id>` is undefined on the change route;
  - two checks that can't both be met;
  - refusal text that leads the model further from the fix;
  - no nag for a work with no card.
- (c) for not doubting the copied id, but I would not expect a larger model to doubt it reliably either.

### 3.3 Reworded cards (run -d setup; run -e desk)

**Instruction.**
- `skills/setup/SKILL.md:34`: ask the card "exactly as printed, with nothing changed, added or left out". The same line ends "Never read out a hash, a set line or JSON".
- FD:61 has the same rule for the desk.
- Claude Code's AskUserQuestion tool description, which is in the transcript at d/T:34 and d/T:50, says: "If you recommend a specific option … add "(Recommended)" at the end of the label". Wheelhouse puts "Recommended:" at the start of the description instead.

**What Haiku did.**
- **-d, plan card.** Same question, but the label became "Go ahead (Recommended)" and the description was trimmed (d/T:63).
- **-d, step 2 card.** It also dropped "To know more, just ask." and the set line "Set up step 2 as listed, db45c868d5d9" (d/T:149). That is the hash line, the very thing the neighbouring sentence says never to read out.
- **-d, matching.** Clicks are matched on the exact question, header, labels and descriptions (`scripts/lib/setup-clicks.js:299-303`, :322-339; `scripts/hooks/prompt-record.js:539-561`). So both clicks were dropped silently. No `setup/clicks/` or `dropped.log` exists (`haiku-diag-run-d.md` §2).
- **-d, refusals.** `apply 2` was refused twice with the generic "this step needs the director's click on its card, from the last 10 minutes" (d/T:162, 177; `scripts/setup/engine.js:120`).
  - The reworded-card refusal never ran, because `scripts/hooks/card-check.js:355` returns early outside a recorded project.
  - Haiku then told the director to click in "the setup view" (d/T:184), which doesn't exist. SKILL.md:79 says to ask again; :86 says to stop after the same refusal twice.
- **-e.** The desk's first two picker calls were refused: "a waiting card reworded: its question is not worded as printed" (e/DESK l.138, l.144). It had dropped the last line and the "because …" tail. The third call matched (e/DESK l.153). This time the hook caught it, but the error did not say *which* part differed.

**Sort.**
- **(b).** Wheelhouse asks the model to copy about 1 KB of text exactly, while the tool's own instructions tell it to change the label. A hook could hand the stored card to the picker instead (fix 3).
- **(a)** for -d. The kit at that commit (ac573730) had no picker answering at all. It was added in 6d16f777. The session then sat idle for about 39 minutes (`haiku-diag-run-d.md` §3, §4).
- **(c)**, small. In -d Haiku made a card of its own after misreading the live-data choice (d/T:95), which breaks setup SKILL.md:41.

### 3.4 Design questions went to chat, and the approved design was edited (run -b)

The report was half right: the approval was not cancelled. The design file's hash stopped matching the approval, so the Bosun refused to start the work.

**Sequence.**
- Haiku wrote the design with a line it made up, "Status: draft, waiting for the director's approval" (b/T005:125).
- It then asked three questions in plain chat (b/T005:132).
  - Against this: FD:15 and intake:13.
  - For it: intake:17 ("an answer to brainstorming's question") and brainstorming's "Bring the 'theirs' pile in one message".
  - No hook enforces the no-chat-questions rule.
- The stand-in answered with a blanket "Go with what you recommend on each question, and take it to a card" (b/T005:243).
- The work was recorded with hash `dfa36ee1` and approved at 19:19:05 (b/T005:325; event `b2393321`).
- At 19:55:09, Haiku replaced its own "Status: draft …" line with "Status: approved by the director's click …" (b/T005:392-394).
  - It was reacting to `decision show 2`, which said the file says draft (b/T005:380).
  - The reader restored the old line and re-hashed the file: it gives exactly `dfa36ee1` (`haiku-diag-run-b.md` §1). So this edit alone moved the hash.
- `scripts/foreman/wake.js:329` then reported "is not the one approved: it has changed since". Every later wake offered no start (b/T007:47, and b/T004, b/T003).
  - The decision raised offered only Wait or Look again (b/T007:58).
  - Haiku wrongly told the director that "1 B" would bring a fresh approval card (b/T005:482).
  - Nothing re-recorded or re-approved the work before the run stopped.

**Instructions that pointed the wrong way.**
- intake:55 and :112 tell the desk to *edit the approved document in place* and replace its approval line. That belongs to the amendment route, which also needs `record amendment` and an `amend` card. Haiku did neither.
- intake:55 says the approved text "stays in git at the hash", but intake:59 says "Git leaves `.wheelhouse/` out". The two contradict each other.
- The front-desk write hook allows any write under `.wheelhouse/` (`scripts/hooks/front-desk-writes.js:26`).

**The same run also showed:**
- **PR #2's merge card was never shown.** At 19:18:15 `cards` printed it and recorded it as asked (b/T005:252; event `dfa7f37c`; behaviour stated in the comment above `card()`, `scripts/frontdesk/cli.js:622-631`). Haiku then showed only the import card (b/T005:325), and later `cards` calls returned nothing.
- **The Bosun's decision 1 recommended "Waiting".**
  - The design set no appetite and no `wheelhouse-slices` block (`skills/foreman/SKILL.md:43-45`).
  - Its first `ask` was refused because an option's text was over 300 characters (b/T009:69). The retry flipped the recommendation, which it later admitted (b/T009:85).
  - A duplicate decision followed (b/T010:77).
- **ci-node-24 hit the CI-file refusal** (b/T019:174-309). See 3.5.

**Sort.**
- **(b)** for:
  - the chat questions (clashing skills, no enforcement);
  - an approved file left editable, with a self-written status line;
  - the intake:55 / :59 contradiction;
  - `cards` marking a card asked when it is printed;
  - no appetite rule at record time.
- **(c)** for:
  - the flipped recommendation;
  - skipping `record amendment`;
  - telling the director that "1 B" re-approves;
  - claiming a push that hadn't happened (b/T005:298, 331).
- **(a)** for the stand-in always taking the recommended answer, and the 33-minute idle gap from 19:21 to 19:54.

### 3.5 A CI-file push has no card to click (runs -b, -c, -f, -g, -h, -09)

**This happened in every run that built P6.**
- `open-pr` was refused with "The branch was not pushed: the branch changes a CI file, so it needs the director's click on its card" (c/T7:183; h/005:297; b/T019:174; f-CI:376; g-CI:264; 09-CI:244). The text comes from `scripts/host/helper.js:653`.
- The push guard needs a signed `ci-push` action for exactly this branch and sha within `CLICK_MS` (helper.js:1353-1360, :1505-1520).

**What Wheelhouse does with it.** Nothing makes that card for a first push.
- The pending CI-push entry, and the `ciPush` reply that leads to a card, are written in one place only: the update-branch path for an *open* pull request (helper.js:3130-3133). The foreman reads it only at merge time (`scripts/foreman/act.js:1430-1435`).
- The `/ci-push/line` route (helper.js:5089) has no caller in `scripts/`.
- The feature CLI turns the refusal into a plain error (`scripts/feature/cli.js:579`).

**What Haiku did.** Exactly what the brief says, every time.
- brief:142: "if a tool or an action is refused to you, do not ask for it in chat. Write a question … and pause".
- It raised `q-ci-node-24-1` and waited (c/T7:188-194; f-CI:381 "I'm not going to push around that gate"; 09-CI:249).
- In -c the stand-in answered with a typed `1 A`. That is an answer to a decision, not a signed ci-push click (c/T2:307).
  - The answer made the session commit a decision record, which moved the head (c/T7:230). Any sha-bound click would have gone stale anyway.
  - After a second question and a second refusal, it sent `stuck` (c/T7:351).
  - The stuck note woke nobody. `scripts/watcher/core.js:317` emits `stuck-note`, but the only wakes are at 20:22, 20:59 and 21:01 (`haiku-diag-run-c.md` Q3).

**Sort.** **(b)**, and really a code bug that affects every model. The refusal points to a card that cannot exist.

### 3.6 Row 43: ntfy needs a click in the helper's window (runs -c, -e, -g, -h)

- The kit's first message in each run was `alerts ntfy <topic>` (h/004:75; c/T2:11).
- `doAlertsNtfy` opens a native "Wheelhouse: phone alerts" window and saves nothing without a Yes click (helper.js:4054-4071). That is deliberate: "no agent can press" (helper.js:4052).
- The command blocked the desk for 120 s and failed: "the director did not click Yes in the helper's window" (h/004:366-367; c/T2:276; e/DESK l.154, 164).
- Alerts also need ntfy switched on under Notifications (helper.js:4046-4049; the desk's own hint at cli.js:1346). The kit sets neither.
- Haiku handled it well. It did not retry, and it told the director (h/004:372).
- The trial design lists only the undo and lift clicks as director clicks (spec:255).
- **Sort: (a).** The click was never planned. Typing it first also blocked the desk during P1 and P2 (3.1, 3.7).

### 3.7 Kit faults that stopped or skewed runs

Each of these is **(a)**:

- **Typing into busy panes and open pickers.**
  - -e: P2 sat for 16m37s and P6 never arrived at all (e/DESK l.184; `haiku-diag-run-e.md` §2).
  - -g: P1 was typed into setup's open phone picker and lost. It appears in no transcript (g-desk l.115-116, 172).
  - -c: P1 and P2 arrived mid-turn (c/T2:81, 164).
- **One paste per request in -09.** Claude Code wraps a paste as `<pasted_content>`. The desk then declined P1 and P2 as "pasted text, not in your own words" (09-desk:94, 126), following FD:3 and :188. Kit commit 23b07f90 fixed the typing. Wheelhouse's side of this is in 3.8.
- **F3 stops the run instead of noting it.**
  - When P1 has no first commit, F3 throws `Stop` (`K/runner.js:582`). The run then skips W3-W5, and the operator re-ran `--from score` (`R-c/run-log.jsonl:35-36`; `haiku-diag-kit.md` §1).
  - In -e, F3 missed a live P1 session one second after PR #2 opened. Wheelhouse's own record held its pid (`watcher/running/feature-bank-statement-import.json`; e/BSI l.1111-1126).
  - In -f the kit looked only at GitHub. A build pushes only at `open-pr`, yet the local branch had six commits (`haiku-diag-runs-f-g-09.md` Q1).
- **The helper was torn down while sessions still worked.** In -e and -f, `open-pr` failed with "the host helper could not be reached" (e/BSI l.1153; e/SHOP l.290; f-P1:1211).
- **Feature sessions are read from the own-engine layout.**
  - The kit reads `kind: 'run'` events and `.wheelhouse/worktrees` (`K/runner.js:182-186`; `K/audit.js:62-65`; `K/faults.js:52`).
  - These runs wrote `feature` events and used `.claude/worktrees` (`R-c/events.jsonl:10`).
  - Results: row 9 is "not covered", every transcript is labelled "front-desk", and row 45 says "no transcript was found for feature, foreman", even though all five such files are on `claude-haiku-5-5` (`haiku-diag-kit.md` §2).
- **Scoring artefacts.**
  - Row 19 counts "answered twice" across three different decisions, each numbered 1 (`K/signals.js:399-405`).
  - Row 4 passes with no pull request.
  - Row 44 credits the untouched seed.
  - Rows 36-38 and 40 return `no()` when unreached, where the design says "not covered" (spec:258).
  - Row 2 judged one captured reply, and that reply was a spinner (`haiku-diag-kit.md` §4).
- **The wrong piece for row 29.**
  - P6 is "Touches only `.github/workflows/`; self-merged `internal`" (spec:300).
  - But CI files are guardrails (`scripts/gate/guardrails.js:70`, :234). Self-merge `internal` requires `guardrails` false (`scripts/gate/conditions.js:144-161`).
  - So row 29 cannot pass on that piece, by design, on any model.

### 3.8 Smaller Wheelhouse faults met along the way

- **"Pasted" means data (FD:3, :188).**
  - -09 declined the director's own pasted requests (09-desk:94). -f and -g took identical pastes as requests (f-desk l.77-120; g-desk l.178).
  - The same wording gives different behaviour from run to run. A real director pasting a long brief would hit it.
  - **(b).**
- **Review rounds with no wake.**
  - templates/brief/override.md:9 says "You defer minors only when Wheelhouse's wake says the review leaves only minors; never judge a finding's severity yourself". No such wake arrives inside a build.
  - f-P1 fixed MEDIUMs and LOWs through seven Lookout rounds over about 35 minutes ("The one MEDIUM is a real gap … so I'll fix it", f-P1:713; rounds at 553-1063).
  - **(b).**
- **Full model id in wakes.**
  - The wake's subagent lines carry the resolved model id (`scripts/routing/in-force.js:120`, from `thoroughness.js:84-97`). The Agent tool accepts only `sonnet|opus|haiku|fable`.
  - Every Lookout dispatch was rejected once and retried with `haiku` (e/BSI l.663; e/SHOP the same).
  - **(b).**
- **Loopback blocked.** HTTP tests failed with `listen EPERM` on loopback under the sandbox that setup wrote (f-P1:467, 479). That blocks preview pictures (row 26) too. **(b)**, config.
- **Skill against hook.** The upstream `executing-plans` skill told the session to run `sdd-workspace`, and the hook refused it (e/BSI l.178). **(b).**

### 3.9 What worked on Haiku

These are worth stating, because they lower the odds for the unreached rows.

- **Foreman.** It started work on wake (f-foreman:69-85; `R-c` three `acted` rows, `haiku-diag-kit.md` §2).
- **Small lane.** A small feature went end to end to a pull request with a signed review, in -f and -g (f-P2:135-418; g-foreman:60-61).
- **Logged calls.** A feature session logged its own calls (h/005:124-136, 257; `R-h/events.jsonl:11-13`).
- **Hook refusals.** Haiku obeyed every one without routing round them (f-P2:40, 105).
- **Shaped questions.** Every CI session wrote an `ask` in the right shape and waited (f-CI:381; g-CI:269).

## 4. The sort, in one table

| # | Failure | Runs | (a) kit | (b) Wheelhouse | (c) Haiku |
|---|---|---|---|---|---|
| 1 | P1 sized small | c, e | over-complete P1; mid-turn typing | lane hangs on brainstorming's word; brainstorming breaks the no-chat rule; no override | said one lane, recorded another (c) |
| 2 | No approve-work cards | c, h | stand-in blind to works with no card | `record work` prints the event uuid as `id`; two checks no uuid can pass; no recovery | didn't doubt the copied id; shell slips (h) |
| 3 | Reworded cards | d, e | no picker answering in -d | copy-exact design against a tool description that says to change it; no refusal in setup; silent drop | own card from a misread choice (d) |
| 4 | Chat questions; approved design edited | b | blanket answers; idle gap | clashing skills; editable approved file; self-written status line; intake:55 vs :59; printing marks cards asked | skipped `record amendment`; flipped recommendation; false "pushed" |
| 5 | CI push with no card | b, c, f, g, h, 09 | none | the card is never made; decision commits move the head; stuck note wakes no one | none |
| 6 | Row 43 ntfy | c, e, g, h | unplanned helper-window click | none | none |
| 7 | Pasted requests declined | 09 | one paste per request | "pasted = data" keyed on form, not source | none |
| 8 | Run stops after W2 | all | F3 throws Stop; F3 and audit look in the wrong place; helper torn down; P6 can't self-merge | none | none |
| 9 | Review loop overruns | f | none | severity rule waits for a wake that never comes | none |

**Genuine Haiku limits found:** small and recoverable ones only. These are in rows 1-4 of the table, plus a 28-versus-27 shop count that it caught itself (e/SHOP l.175) and a stale "still queued" claim (e/DESK l.286). None of them stopped a run.

## 5. Rows not covered or never reached: predicted next failures

Rows are numbered as in the trial design (spec:192-236).

**Why they weren't reached.** Waves 3-5 start only after `w2-merge-wait`, which needs three merged pull requests (`K/runner.js:590-591`). In every run, P1 couldn't be approved (3.2, 3.4) or P6 couldn't be pushed (3.5). So every row tied to P3-P5, P7, P8 or to F1-F6 was never tried.

**The 10 "not covered" rows in -c** (`haiku-diag-kit.md` §2):
- 14, 15, 23: "F1 was not run" (W3).
- 25: nothing merged.
- 34: F3b sits in W4.
- 35: always unknown, by design.
- 41: no incident step.
- 42: digest step not run.
- 9: the kit reads `run` events.
- 45: transcript labels.

None of these is evidence about Haiku.

Predictions once fixes 1-4 and the kit fixes are in. The **risk** column says what is most likely to fail next, from what Haiku did with the same mechanism elsewhere.

| Row | What it needs | Prediction | Risk and evidence |
|---|---|---|---|
| 3, 5, 6 | intake per piece | pass with fix 4 | lane drift without fix 4 (3.1). The bug lane uses a slug the model chooses (intake:61), so it avoids the uuid trap |
| 7, 8 | plan card for P1 and P3, picker-signed | pass with fixes 1 and 3 | the same copy-exact risk as 3.3 |
| 9 | pace 3, one feature lane | pass | the foreman worked (3.9); the kit must read `feature` events |
| 10 | feature session: plan, build, tests, review, tester | likely pass | review overrun (3.8, f-P1); loopback EPERM (f-P1:467) |
| 11 | slices | **at risk** | the design needs a `wheelhouse-slices` block (intake:77, 81); -b's design had none (`haiku-diag-run-b.md` §2). Code should check this at record time (fix 5) |
| 12 | same-file wait | pass | dispatcher code, not the model |
| 13, 16-18, 20, 31 | P4's decision: shape, hold, wait-for, typed reply, private, record file | mostly pass | `ask` was shaped right in -c, -f, -g and -09 (3.5). Risk: an option over 300 characters, and a flipped recommendation on retry (b/T009:69, 85) |
| 14, 15, 23 | send-back, stuck, refusal of a director kind | pass | all code-side checks |
| 19 | typed-reply edge cases | pass after the kit's row-19 fix | the kit's false "answered twice" |
| 21 | `why decision n` within 100 s | uncertain | not observed. It is a fork answering from records; Haiku answered other read-backs fine |
| 22 | agent-call | pass | h/005:124-136 |
| 24 | pull-back gives a ruling card | **at risk** | the desk composes the confirm card, the same mechanism as 3.2 and 3.3. Fixes 1 and 3 cover it |
| 25 | proof-note headings | pass | code builds the note (`scripts/proof/note.js`) |
| 26 | pictures | **at risk** | needs a preview server under the sandbox; loopback EPERM (f-P1:467). Fix 10 |
| 27 | data before and after (P1, test route) | pass if P1 is a feature with a design | depends on fix 4 |
| 28 | visible change waits for a card | **at risk** without fix 6 | the PR card was printed, marked asked and never shown (b/T005:252, 325) |
| 29 | self-merge internal | **cannot pass on P6** | CI files are guardrails (3.7). Choose another piece |
| 30 | gate reads visible text | pass | gate code |
| 32 | daily batch | pass | the helper's own batch (`conditions.js:140-151`) |
| 33 | lost session resumed | pass after the kit's F3 fix | the kit couldn't find `.claude/worktrees` sessions |
| 34, 35 | foreman lost; routine moves | pass, and 35 is reported as unknown by design | watcher code |
| 36, 37, 40, 43 | helper-window clicks | pass only if the director clicks during the sitting | `K/runner.js:648-667, 719-725`; 43 is also unplanned (3.6) |
| 38, 39 | All stop, typed | pass | typed words and hook |
| 41 | incident freeze and lift | uncertain | `lift-incident` isn't in the stand-in's `PICKED` (`K/stand-in.js:7`) |
| 42 | digest | pass | code |
| 44 | own tests | needs a real kit signal | today it credits the seed |
| 45 | model audit | pass after the kit's labelling fix | every turn checked was `claude-haiku-5-5` (`haiku-diag-kit.md` §2) |

**The general prediction.** Wherever Wheelhouse makes the model copy an id, a hash or a card, Haiku will slip. Wherever code produces the artefact and the model passes it on, Haiku has done fine. The rows marked at risk are all of the first kind.

## 6. Fixes, ranked by rows unblocked

Each fix prefers code to rewording. "Larger models" says what changes for Sonnet or Opus.

### Fix 1: code composes the approve-work card (rows 5, 7, 8, 10, 26-28, and every later wave)

**Change.**
- `record work` composes the approve-work card itself, as `record ruling` already returns a confirm card. It prints `{ work: "<slug>", hash, card }`, and the desk asks `card` as printed.
  - The event uuid is renamed `eventId`, or dropped from the output.
  - `shownFirst` and `visible` come from the record, as `card()` already forces for visible work (cli.js:648).
- Refuse uuid-shaped ids:
  - in `target.work` and `dependsOn` (`scripts/state/events.js:541`; `ID` in `scripts/state/card-lines.js:230`);
  - with the message "the work id is the slug you recorded it under: statement-import".
- In `whatProblem` (compose.js:354-358), skip hex tokens that sit inside `target.work`.
- `cards` lists each work that is waiting for approval with no waiting card, re-composed, so a lost card comes back on the next visit.

**Skill text.**
- intake:76-77 and FD:109 drop the hand-built target and say: "ask the `card` that `record work` printed".
- intake:61 and :65 keep `<id>` defined as the slug.

**Files.** `scripts/frontdesk/cli.js` (record work, about :1091-1126; `cards`), `scripts/cards/compose.js`, `scripts/state/events.js`, `scripts/state/card-lines.js`, `skills/intake/SKILL.md`, `skills/front-desk/SKILL.md`.

**Tests.**
- `record work` for a visible small and a feature returns a card that `whatProblem` accepts as printed.
- A uuid in `target.work` or `dependsOn` is refused, and the message names the slug.
- `what` containing the work slug plus the doc hash passes.
- `cards` re-offers an unapproved work that has no waiting card.

**Larger models.** Fewer tool calls and no failure mode. Nothing they do today depends on the old output.

### Fix 2: a CI-file push raises its card (row 29's piece, the W2 merge count, rows 36-37)

**Change.**
- When `/push` or `/pr/open` refuses for `ciFile` (helper.js:1505-1520), write the pending CI-push entry and return `ciPush: {branch, sha}`, exactly as update-branch does (helper.js:3130-3133).
- `scripts/feature/cli.js` (open-pr, :579 and :638 on) turns that reply into the `ci-push` card through the same `gateAsks` path the foreman uses (act.js:1430-1435), so `cards` hands it to the desk. Then it waits on it.
- The brief gets one line: "a CI-file refusal raises its own card: run `wait-for`, don't `ask`".
- Decision records must not stale the click. Either commit them before the card is raised, or let `ciClick` accept a later head whose added commits touch only `docs/decisions/`.
- `/ci-push/line` (helper.js:5089) is then either used or removed.

**Files.** `scripts/host/helper.js`, `scripts/feature/cli.js`, `scripts/foreman/act.js`, `templates/brief/brief.md`.

**Tests.**
- A first push of a branch that changes `.github/workflows/ci.yml` writes a pending entry and returns `ciPush`.
- `cards` then holds a `ci-push` card. A signed click lets the same sha push.
- A decision-record-only commit after the click still pushes.

**Larger models.** This deadlock hits every model today (3.5). The fix is model-neutral.

### Fix 3: the card-check hook hands over the stored card (rows 1, 7, 8, 24, 28, and every card)

**Change.**
- In `scripts/hooks/card-check.js`, a PreToolUse call to AskUserQuestion that matches one waiting card returns `hookSpecificOutput.updatedInput` set to that card, exactly as stored. A match is the same set line, or else the same first question line.
  - Then wording no longer matters.
  - Wheelhouse doesn't use `updatedInput` anywhere yet (grep of `scripts/`). Before building on it, check with a ten-minute probe that Claude Code honours it for AskUserQuestion.
- As a fallback, or alongside it:
  - accept a trailing "(Recommended)" on labels when matching (`setup-clicks.js:299-303`, `prompt-record.js:539-561`);
  - make the refusal name the part that differs;
  - run the check in folders being set up, by removing the early return at card-check.js:355 for setup cards.
- Have Wheelhouse cards put "(Recommended)" on the label themselves, so the card and the tool description agree.

**Files.** `scripts/hooks/card-check.js`, `scripts/lib/setup-clicks.js`, `scripts/hooks/prompt-record.js`, `scripts/cards/compose.js` (labels), setup's card builder.

**Tests.**
- A picker call with "(Recommended)" and a trimmed description is replaced by the stored card, and its click is kept.
- A setup-folder rewording is refused at asking time, naming the field that differs.

**Larger models.** They rarely reworded. This removes the remaining risk and the retries.

### Fix 4: the lane comes from facts, not a borrowed word (rows 3, 7, 8, 11, 27)

**Change.**
- The brief written at intake carries a short checklist the model fills: does the work add a page or route, store or change data, parse input, or touch more than one area? (yes or no each).
- `record work` refuses `small` or `quick` when any answer is yes: "this is a feature: it adds a page and stores data".
- Give the First Mate a brainstorming override. When the request already answers the questions, brainstorming's chat questions are skipped. Any question that remains goes through `card`, never chat.
- intake:71-77 says the size comes from the checklist.

**Files.** `skills/intake/SKILL.md`, `scripts/frontdesk/cli.js` (record work), the First Mate's context (`skills/front-desk/SKILL.md`, or its session-start text).

**Tests.**
- A brief that adds a page plus a parser is refused as `small`.
- A brief with no such facts records `small`.

**Larger models.** Lanes become consistent across models. Some borderline "small" requests become features, at the cost of a design.

### Fix 5: approved documents are locked; slices are checked at record time (rows 7, 10, 11)

**Change.**
- The front-desk write hook refuses writes to a `.wheelhouse/work/<id>.md` whose hash has a signed approve-work. The refusal says: "changing an approved design is an amendment: `record amendment`".
- Keep the approved text in the record, so intake:55's promise holds even though git leaves `.wheelhouse/` out (intake:59).
- Status lines are not written into designs. Status comes from `views`.
- When `wake.js:329` finds drift with no amendment, the decision offers "Restore the approved text" or "Re-approve the change", not just Wait or Look again.
- `record work` for a feature refuses a design with no appetite or `wheelhouse-slices` block (`skills/foreman/SKILL.md:43-45`).

**Files.** `scripts/hooks/front-desk-writes.js`, `scripts/frontdesk/cli.js`, `scripts/foreman/wake.js`, `skills/intake/SKILL.md`.

**Tests.**
- An edit to an approved design is refused.
- An amendment goes through.
- A feature record with no slices block is refused with the words to add.

**Larger models.** They can no longer silently break their own approval either.

### Fix 6: a card counts as asked only when the picker shows it (row 28 and every pull-request card)

**Change.**
- `card()` and `cards` stop recording a card as asked when they print it (cli.js:622-631).
- The `shown` event that prompt-record writes is the mark instead.
- `cards` keeps returning a printed but unshown card.

**Files.** `scripts/frontdesk/cli.js`, `scripts/hooks/prompt-record.js`.

**Test.** Printed twice and never shown, the card comes back both times. Once shown, it carries `alreadyAsked`.

**Larger models.** No change in behaviour, but no lost cards.

### Fix 7: stuck notes and orphaned works wake someone (recovery for rows 10, 29)

**Change.**
- A `stuck-note` (`scripts/watcher/core.js:317`) wakes the Bosun.
- The desk's session-start or turn briefing lists works that are waiting for approval with no card (this pairs with fix 1).

**Files.** `scripts/watcher/core.js`, the desk briefing hook.

**Test.** A stuck note produces a foreman wake.

**Larger models.** Model-neutral.

### Fix 8: "pasted" keyed on the source, not on how the text arrived (all intake rows in a pasting run)

**Change.**
- Text in the director's own turn is the director's, pasted or not.
- Data means a session report, a tool result, a bot's or a web page's words.
- Reword FD:3 and :188 to say so.

**Files.** `skills/front-desk/SKILL.md`.

**Larger models.** -f and -g already read the paste this way, and so would larger models. This removes the variance.

### Fix 9: code says when only minors are left (rows 10, 26 timing)

**Change.**
- The feature CLI's review step reads the Lookout's verdict and prints "only minors left: defer them, stop the loop" after round three.
- override.md:9 then points at that line instead of a wake that never comes.

**Files.** `scripts/feature/cli.js`, `templates/brief/override.md`.

**Larger models.** Shorter review loops for them too.

### Fix 10: smaller code fixes

- **Model alias.** Wakes give the Agent alias (`haiku`, `sonnet`, `opus`), not the full id (`scripts/routing/in-force.js:120`).
- **Loopback.** Setup's sandbox allows loopback binding, so tests and previews can listen (f-P1:467). Needed for rows 10 and 26.
- **BSD sed.** Fix `sed -i ''` parsing (`scripts/hooks/front-desk-writes.js:150-156`).
- **sdd-workspace.** The brief tells sessions not to run it.

### Fix 11: kit changes (all (a))

1. **Wait before typing.** Type only when the desk is idle with no open picker, and type rather than paste.
2. **Plan the ntfy click.** Either add the ntfy Yes click to the director's sitting and switch ntfy on under Notifications, or drop row 43's dependence on it (3.6).
3. **F3.**
   - Find sessions from Wheelhouse's `watcher/running/*.json` and `.claude/worktrees`.
   - Count local commits.
   - When F3 can't fire, note it and go on, rather than throwing `Stop` (`K/runner.js:582`).
4. **Teardown.** Keep the helper alive until every feature session has ended.
5. **Read this layout.** Read `feature` events. Label transcripts by role, from `WHEELHOUSE_ROLE` or the session-start text, for rows 9, 17, 38, 40 and 45.
6. **Row 29.** Use an internal non-CI piece, for example a refactor of a helper module with tests. Give P6 a `ci-push` card answered by the stand-in. `ci-push` is already in `PICKED`.
7. **Scoring.**
   - Fix row 19's false positive.
   - Row 4 must see a merged pull request.
   - Row 44 must score agent-written tests.
   - Unreached rows 36-38 and 40 report "not covered".
   - Row 2 must capture finished replies.
8. **Waiting work.** The stand-in checks in when a work waits for approval with no card.

## 7. Rows expected to pass after the fixes

**With fixes 1-7 and 10, plus the kit fixes, on Haiku alone, I expect to pass:**
- 1-10, 12-20, 22, 23, 25, 27-35, 38, 39, 42, 44 and 45.
- Row 29 counts only after the piece changes. Row 35 is reported, not scored.

**At risk, but expected to pass with fixes 3, 5, 6 and 10:**
- 11 (slices);
- 24 (pull-back card);
- 26 (pictures, needs loopback);
- 28 (pull-request card shown).

**Uncertain:**
- 21 (why fork; not yet observed);
- 41 (incident lift; the stand-in can't answer it).

**Need the director in the sitting:**
- 36, 37 and 40 (helper-window clicks);
- 43 (the ntfy click), unless the kit drops it.

**The minimum for the run to get past W2** is fix 1, fix 2, and kit fixes 1, 3 and 4. Without fix 1, P1 and P2 are never approved. Without fix 2, P6 never merges, so the three merges W2 waits for (`K/runner.js:591`) can't happen.

## 8. What a re-run needs

1. **Wheelhouse.**
   - Fixes 1 and 2 merged, at least. Fixes 3-7 and 10 for the later rows.
   - Run the ten-minute `updatedInput` probe before building fix 3 on it.
2. **Kit.** Fix 11, items 1-8. Keep the stand-in's picker answering (6d16f777 and later).
3. **Director's sitting.** About 15 minutes on hand for:
   - the ntfy Yes click (early in W1, before any piece is typed);
   - the undo clicks (F5a, F5b);
   - the All stop lift (F6).
4. **A clean model audit.** Every role on Haiku, as `.claude/wheelhouse.json` already sets it in these runs (row 1).
5. **Run the full flow, not `--from score`.** A stop in W2 should be a note, not an end, so later waves still give evidence.
6. **Compare across models.** Run the same kit once on Sonnet, to tell kit faults from model faults. Every (b) fault above should show up there too, or not at all.
