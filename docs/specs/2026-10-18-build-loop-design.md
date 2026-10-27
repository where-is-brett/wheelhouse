<!-- docs/specs/2026-10-18-build-loop-design.md -->

# Wheelhouse: the build loop and lineage

**Status:** approved by the director on 18 October 2026. It completes the main design, `docs/specs/2026-10-17-wheelhouse-design.md`, which left open how the foreman runs work from approval to merged code. Where the two differ, this document wins; the main design's sections 4, 5.4, 7, 8, 10 and 12.4 point here.

**What it covers:**

- how the front desk sorts everything that arrives (the intake);
- the three lanes, and which skill runs where;
- one foreman per project and one Claude session per feature, and the files and script between them;
- running independent features side by side;
- lineage: what Wheelhouse builds on, what it changes on top, and what built each pull request.

**Inputs:**

- the director's steering over 17 and 18 October 2026;
- two independent reviews, one of the build loop and one of lineage, each with its own research (appendix A);
- the visual page the director approved, whose diagrams this document follows: https://claude.ai/artifact/BPHxgGWFa91LCqSG6A4y1x
- the first version's measured costs, from private notes on its run on the pilot project;
- Superpowers 7.0.0 and Matt Pocock's skills as installed on 18 October 2026, read file by file.

**Marks:** *Designer's call* marks a choice the director may override; section 17 lists them. Section 18 lists what the director decided.

## 1. Intent

The first version's build loop worked: 134 pull requests merged, and reviews caught 28 paths to a wrong figure. What it cost was attention and tokens. The coordinator's context sat around 317,000 tokens, 76% of its turns were woken by worker traffic (124 of them did nothing), and long-lived branches produced 66 merge-conflict messages.

This design keeps the loop and changes how it is run:

- **The coordinator is thin.** One foreman per project starts work, checks for clashes, passes questions on and merges. It never builds.
- **Each feature is its own Claude session**, with its own worktree, branches and ledger, running Superpowers' own loops inside.
- **Between them are files and a script, not chat.** A script that costs no tokens watches the files and CI, and wakes the foreman only when it has something to do.
- **Superpowers and Matt Pocock's skills are used as they are.** Wheelhouse adds a thin, written layer of instructions on top, and tracks every upstream change before it reaches work (section 14).

**Goals**, on top of the main design's:

1. Independent features build in parallel (for example, a tool's optimisation algorithm and its change-list export).
2. The director is asked only at four moments: approving a brief or design, a question card, a preview, and the briefing.
3. Every lane leaves a permanent record.
4. An update to Superpowers, Matt's skills or Claude Code never reaches running work untested.

**Non-goals:** several projects at once (budgets are per project, and the director usually works on one); agent teams (experimental, and they cannot be nested); copying or editing either skill kit.

## 2. Shape

| Part | What it is | Talks to |
|---|---|---|
| **Front desk** | The one session the director talks to. Sorts what arrives, shapes work with brainstorming, writes approvals and answers into state. Never builds | The director, and the state files |
| **State files** | The state branch (main design, section 9) | Read by everyone; written only as section 9 allows |
| **Foreman** | One per project. Queues work, writes briefs, starts and closes feature sessions, checks for clashes, passes questions on, merges through the gate. Starts fresh at every wake. Never builds | State, the feature files, the helper |
| **Feature sessions** | One Claude session per feature (or per bug, section 5.3). Plans and builds with Superpowers' loop for its lane | Only its own feature files |
| **Watcher** | A Node.js script that reads the feature files, state, CI and mergeability. Costs no tokens. A background process outside any session, as check 27 found on the Mac (section 11) | Wakes the foreman, or a feature session |
| **Helper and gate** | The only route to the host (main design, sections 11 and 12.3) | The host |

**The front desk and the foreman never talk directly.** The front desk writes signed records into state (an approval, an answer, a change to running work, STOP). The watcher sees the new event and wakes the foreman. The foreman writes questions, outcomes and reports into state, and the front desk reads them for cards and the briefing. This replaces the main design's one-line cross-session message from the front desk to the foreman. *Designer's call.*

**Every merge needs a signed review.** The built gate requires a signed CLEAN review from Wheelhouse's reviewer on every merge except a restore (the state-and-host plan's ruling 15), and this design keeps that. Reviews of a critical area or a guardrail use the most capable model; the rest use the mid-sized one (main design, section 8). *Designer's call*, keeping the built check rather than loosening it for the quick lane.

**Pace.** At most three feature sessions build at once, and at most one of them is in the feature lane, unless the director says otherwise. New work joins the back of the queue unless the director gives it a place. When Claude's five-hour usage window runs tight, the foreman pauses the newest work first. *Designer's call.*

## 3. The intake: what the front desk does with everything that arrives

The front desk does not wait for a skill to recognise itself. Superpowers' brainstorming claims any creative work and would swallow bug reports too, so the front desk's playbook routes first and then starts the skill for that route by name. It tells the director the route in one line, so they can correct it ("I've treated this as a bug; say if it's a change").

**First, two checks:**

1. **Split** a message that holds several requests, and route each one.
2. **Check** each against open work, the ideas list and the rejection log, so a duplicate merges with what exists and a past rejection is flagged.

**Then nine questions, in order. The first yes decides the route:**

| # | Question | Route | Ends as |
|---|---|---|---|
| 1 | Is something live harming users? Includes a leaked secret or a weakness being exploited | **Incident** | Contained at once (level 2, main design section 6), every other merge frozen (section 12), the director told, then a bug for the cause and a short no-blame note in state. A security report is kept private |
| 2 | Is it an answer to something waiting? | **Answer** | Recorded as a signed record; that feature resumes |
| 3 | Is it about work already running? Steering ("make it CSV", "pause it", "do that one first"), or a standing ruling | **Running work** | The front desk reads it back in one line. For an amendment the front desk's command makes that line: `record amendment` refuses an amendment without its read-back (what it does, what it leaves out, and when it is done) and prints the route line and the read-back as one, which the front desk says first (section 17). A change to what an approved brief or design builds needs the director's click, because it amends an approval. Before it asks the `amend` card, the front desk writes the changed document in place, in the one file the work names, and replaces its approval line with one that stays true after the click ("Changed since the director's approval; the change card decides it."); the approved text stays in git at the hash the approval names, and the amendment records the changed document's hash. After the click, the foreman amends the brief and the session reads it (section 9). A ruling goes into the rulebook (main design, section 5.4) |
| 4 | Is something not working as expected? | **Bug** | A bug session (section 5.3) |
| 5 | Is it a question, or a musing? | **Question** | Answered; nothing is built. A bug if the answer shows one |
| 6 | Is it about accounts, secrets or settings? | **Runbook** | A step the director clicks; agents never handle secrets |
| 7 | Is it a routine chore? ("rerun the refresh", "export this data") | **Chore** | A standard step the project has approved in advance (level 2), or the quick lane |
| 8 | Is it for later? Includes an outside notice with nothing to do yet (a supplier retiring something, a bill or quota warning) | **Later** | The ideas list (main design, section 7.6). A notice that needs a decision soon becomes a card |
| 9 | Otherwise | **Change** | Brainstorming shapes and sizes it (section 4) |

**Alongside any route:** Matt's `domain-modeling` whenever a new term or domain decision appears; Matt's `prototype` when a change is visible, after it is sized and before the director approves it (main design, section 7.3).

This list replaces the classification table in the main design's section 5.4, whose four kinds now map onto it: a musing is route 5, an instruction is route 3 or 9, a ruling is route 3, and a conflict with a standing rule is flagged by the second check.

## 4. Lanes

Brainstorming sizes the work; the lane only goes up. These three lanes are Wheelhouse's own mapping onto the two kits, not sizes either kit defines. Superpowers' brainstorming has its own three sizes ("do it", "a small change" and "a written design"); the front desk never takes the first, because it never builds.

| Lane | When | Shaped by | The director approves | Loop in the session | Review |
|---|---|---|---|---|---|
| **Quick** | Clear, small, reversible; recognisable at a glance | The front desk writes a short brief | Nothing, unless it changes what users see (shown first, main design 7.3) | No plan. Matt's `tdd`, then Matt's `code-review`, then a commit (section 6) | Matt's `code-review`, then Wheelhouse's signed reviewer on the PR head |
| **Small** | Clear intent, a few choices, one area | Brainstorming, a short brief in chat | The brief, by a card click | `writing-plans`, then `executing-plans` | One review at the end, then Wheelhouse's signed reviewer on the PR head |
| **Feature** | New of its kind, many open questions, or a critical area | Brainstorming, a written design (main design, section 7.4) | The design, by a card click | `writing-plans`, one plan per slice, then `subagent-driven-development` | Every task, the whole branch, the tester (section 8), then Wheelhouse's signed reviewer on the PR head |

**The director approves designs and briefs, not plans.** A plan is how the builder carries out what the director already approved; it changes nothing they would judge. (The director's decision, 18 October 2026.)

**Splitting big work is Superpowers' own.** Brainstorming says when a request is several independent projects, agrees an order with the director and shapes each separately. Where one design is still big, the `writing-plans` scope check suggests one plan per part. Each extra plan goes back to the foreman as queued work, citing the same design; that hand-back is Wheelhouse's addition, since Superpowers itself takes the parts one at a time. Matt's `to-tickets` is not used: tickets do not feed `writing-plans`.

**Slices.** In the feature lane each slice is its own plan, because a Superpowers loop finishes a plan once. **One session carries a feature's slices in turn:** while slice n's pull request waits, it may plan slice n+1, and it builds slice n+1 once slice n has merged; between wakes it costs nothing. Extra plans from the scope check that are separate parts of the product, not slices, become separate features in the queue. Pace limits count features, not slices, and the clash check runs on each slice's plan before it builds. *Designer's call.* Each slice is one pull request, behind a feature flag, under about 600 lines (main design, section 7.4). Switching a flag on for users is the director's decision (level 3); flags no longer needed are removed in a later slice.

## 5. Skills: which one, where, and when

### 5.1 The map

| When | Where | Skill | What it does there |
|---|---|---|---|
| A change arrives | Front desk | Superpowers `brainstorming` | Shapes and sizes it; a written design or a brief |
| A change is visible | Front desk | Matt `prototype` | A throwaway preview before approval |
| A new term or domain decision | Any | Matt `domain-modeling` | Adds it to the project's glossary |
| Always | Foreman | Wheelhouse's foreman playbook | Queue, brief, clash check, questions, merge; no Superpowers or Matt skills |
| The session opens | Feature session | Wheelhouse override (section 7) | Read from the brief before any skill |
| Then | Feature session | Superpowers `using-git-worktrees` | Confirms it is in its own worktree, never on the default branch |
| Before any code (small and feature lanes) | Feature session | Superpowers `writing-plans` | Turns the design or brief into a plan |
| Building a feature | Feature session | Superpowers `subagent-driven-development` | A fresh builder and reviewer per task, then a whole-branch review |
| Building a small change | Feature session | Superpowers `executing-plans` | One session does every task; one review at the end |
| Every task | Feature session | Superpowers `test-driven-development` | The failing test first |
| Any bug or unexpected failure | Feature or bug session | Superpowers `systematic-debugging` | The root cause before any fix |
| Several unrelated failures at once | Feature session | Superpowers `dispatching-parallel-agents` | Investigates them side by side |
| Review | Feature session | Superpowers `requesting-code-review` and `receiving-code-review` | A fresh reviewer; each finding checked before acting |
| Before saying anything is done | Feature session | Superpowers `verification-before-completion` | Runs the checks and reads the output |
| Main has moved and the branch conflicts | Feature session | No skill: the brief's conflict rule | Matt removed `resolving-merge-conflicts` in v1.3.0 and Superpowers has none; the session merges the default branch in, resolves each conflict so both sides' intent survives, then re-checks and has the result reviewed |
| The work is finished | Feature session | Superpowers `finishing-a-development-branch`, as the override changes it | Opens the PR through the helper; never merges |
| A quick change | Feature session | Matt `tdd`, then Matt `code-review` | The quick lane's loop (section 6) |

### 5.2 Not used

- Matt's `triage`: a GitHub label workflow that posts to and closes issues, which only the helper may touch; the intake already sorts. Claude also cannot start it.
- Matt's `/implement` as a skill: Claude cannot start it (section 6).
- Matt's `diagnosing-bugs`: Superpowers' `systematic-debugging` covers every bug, reported or found while building. One debugging skill everywhere. (The director's decision, 18 October 2026.)
- Matt's `grill-me`, `grill-with-docs`, `to-spec`, `to-tickets` and `wayfinder`: brainstorming already shapes and splits the work.
- Matt's `tdd` and `code-review` outside the quick lane: Superpowers' own are used there.
- Superpowers' `writing-skills`: for building Wheelhouse, not the director's product.
- Agent teams.

### 5.3 A bug's path

A bug gets a short session of its own, so build traffic stays out of the director's conversation:

1. The front desk writes the bug request into state; the foreman starts a bug session with a brief.
2. The session runs `systematic-debugging`: it reproduces the bug and finds the cause before any fix.
3. **Cannot reproduce:** a card asks the director, or the reporter, for what is missing.
4. **Works as designed:** it becomes a question or a change, back through the intake.
5. **Cause obvious, one-step fix:** the same session carries on in the quick lane, with a regression test, and opens a PR.
6. **Bigger:** the session writes its reproduction test and findings into its report, and the work joins the queue as a small change.
7. **Harming users now:** route 1, then this path for the cause.

## 6. The quick lane without `/implement`

Matt's `/implement` and `triage` are marked so that only a person can start them; Claude cannot (`disable-model-invocation`, verified on the installed copies). `/implement` itself is five lines: use `tdd` at agreed seams; typecheck and run single test files regularly; run the full suite once at the end; use `code-review`; commit. Matt's `tdd` and `code-review` carry no such mark.

So the quick-lane brief carries `/implement`'s five lines word for word, and the session starts Matt's `tdd` and `code-review` by name. Nothing is copied into Wheelhouse and nothing of Matt's is changed. The five lines are recorded in the register as carried text (section 14.3), so a change upstream is noticed.

## 7. The Wheelhouse override

Superpowers' loops come with house rules that clash with the gate and the decision levels. Superpowers lets the user's instructions win over its own, so Wheelhouse writes its rules down once and every brief carries them, read before any skill. Superpowers' files are never edited.

| Superpowers' rule (7.0.0) | Wheelhouse's rule | Why |
|---|---|---|
| `subagent-driven-development`: up to five fix rounds per task, after which the controller decides open findings itself | Three fix rounds at most; then the open findings go to the director as one card (main design, section 6's triggers) | The design's round cap. The first version merged over a reviewer's block |
| `executing-plans`: one fix pass after the final review, with no re-review | Every fix is re-reviewed. The last review before a merge is Wheelhouse's own signed reviewer, on the PR's head commit, for every PR, as the built gate requires | The gate needs a CLEAN signed review of exactly what merges. Superpowers' reviewer is a general-purpose subagent, which can write and whose report the report-check hook does not sign |
| Both loops: "Rulings, not stalls"; the loop stops only for its own few reasons | Anything at decision level 3 or 4 is a question, never a ruling the session makes itself (section 10). Reversible matters below level 3 are still ruled and recorded | The director decides what users see, settings and the guardrails |
| `writing-plans` ends by asking the human partner to review the plan; `finishing-a-development-branch` offers a menu (merge locally, push, keep, discard) and waits | Nothing waits for a person in chat. Plans go straight to building (section 4). Finishing means: open the PR through the helper, then own it until it merges (section 11) | Nobody is in the feature session's chat. Only the helper reaches the host |
| Brainstorming's quick size: "do it"; and after a written design, brainstorming invokes `writing-plans` itself | Not taken at the front desk: a quick change goes to the quick lane, and an approved design or brief goes to the foreman's queue, never to `writing-plans` at the front desk | The front desk never builds or plans |
| `subagent-driven-development` picks each subagent's model itself (the least powerful that can do the job) | Every subagent's model comes from the project's routing table (main design, section 8) | One routing table; nothing else names a model |
| Superpowers' per-task and whole-branch reviewers are general-purpose subagents, which can write | Those reviews use Wheelhouse's read-only reviewer agent | Reviewers can read but not write (main design, sections 4 and 8) |

**Each rule has an evaluation scenario** (section 15), and the first one tests that Superpowers really does let these instructions win over the text its own session-start hook adds. The override is written into the brief template, not a skill, so it is read in every session whatever skills load. Each rule names the sentence it overrides, so a change upstream is noticed (section 14.3).

## 8. One feature, start to finish

1. **Approved work arrives.** Brainstorming has sized it and the director has approved the design (feature) or brief (small) by a card click, recorded as a signed approval in state. Quick work needs no approval unless it is shown first.
2. **The foreman writes the brief and opens a session.** The brief names the lane, the done contract, the appetite and token budget, the rulings that apply, the model and the override. The session gets its own worktree and branches. It may open while others are building, because planning changes nothing.
3. **The session plans** (small and feature lanes) with `writing-plans`. Extra plans from the scope check go back to the foreman as queued work. Each plan's file map becomes that work's list of touched files.
4. **The foreman checks for clashes before it builds** (section 12). It also checks pace and whether the work needs another feature's work first. If any check fails, the session waits with its plan ready.
5. **The done contract becomes tests** before any code, so passing means done in the director's terms.
6. **The session builds** with its lane's loop (section 4), under the override.
7. **Feature lane: a tester tries the product.** A read-only session clicks through the preview deployment, or Playwright screenshots from the worktree where there is none, against the done contract, before anything is shown to the director. It reports findings like a reviewer. Quick and small lanes rely on step 5's tests. *Designer's call*, to keep its cost to the lane where it pays. The tester has a sandboxed `Bash`, for Playwright, and writes only screenshots and notes, in `.wheelhouse/feature/screens/`. *Designer's call.*
8. **Each slice goes up as a pull request, and the session owns it.** Through the helper, on a plain branch, never the default branch. The session can't push itself, so its `open-pr` command pushes the branch through the helper and then opens the pull request, and its `push` command sends later fixes the same way. When the host's branch has moved on (the gate brought it up to date), a push is turned down, and its `pull` command brings the host's branch in: the helper fetches it into its own mirror, brings it together with the worktree's branch there (a fast-forward or a plain merge, refused on a conflict), and hands back only the commits, which the session's own git brings in. *Designer's call.* Red CI, review findings or a conflict after main moves wake the session to fix them (section 11). The session never merges.
9. **The watcher sees it is ready:** CI green on the exact head commit, a signed CLEAN review, still mergeable. Only then does it wake the foreman.
10. **The gate brings it up to date, then the foreman merges** (section 12).
11. **The feature closes.** The session writes its report, including every ruling from its Superpowers ledger (section 13); the foreman records the outcome in state and closes the session. The front desk tells the director in the next briefing.

## 9. The feature files

Four files sit between the foreman and each feature session, in a git-ignored folder at the root of the session's worktree, `.wheelhouse/feature/`. A feature session may write only inside its worktree (main design, section 12.2), so the files live there, not on the state branch; the foreman copies what matters into state. *Designer's call.*

| File | Written by | Holds | Read by |
|---|---|---|---|
| **Brief** | Foreman | Goal, lane, done contract, appetite and token budget, the rulings that apply, the model, what to do when blocked, the override; for the quick lane, `/implement`'s five lines. Amended when the director steers the feature, with a note of what changed | The session, at start and when the watcher says it changed |
| **Status** | A script, from the session's Superpowers ledger and `git log` | Phase, task n of m, waiting on, head commit, PR, tokens used, last update. Small and machine-readable | The watcher, constantly; the foreman, when woken |
| **Questions** | The session | One entry per question: what, why it matters, the options, a recommendation | The watcher, then the foreman |
| **Report** | The session | About 300 words at the end: what shipped, tests, assumptions, concerns, and every ruling from its ledger | The foreman, once |

The session spends no turns writing its status: the script builds it. *Designer's call*, following the lineage review. A hook runs the script, reading the ledger and the `.git` files directly, at most once every five seconds. Tokens used stay unknown until the usage receiver's store fills them (a later plan), and the appetite's token check waits for that. *Designer's call.*

**Their formats.** The brief and the report are Markdown, each with a JSON block a script reads; the status is JSON; the questions are JSON lines, one question to a line. The session copies each ruling from its Superpowers ledger into the folder as the ledger gains it, not only at the end, because Superpowers deletes its workspace when it finishes. *Designer's call.*

## 10. When a feature needs the director

1. **The session writes the question and pauses that feature.** Reversible questions below level 3 it settles itself and records as assumptions (main design, section 7.5). Under the override, anything at level 3 or 4 is a question.
2. **The watcher wakes the foreman**, which records the question in state, linked to the feature.
3. **The front desk asks once, on a card**, at its next turn with the director. It stays on the waiting-on-you list until answered. Other features carry on.
4. **The answer is a signed record.** The watcher sees it and wakes that one session, which reads the signed record. A relayed message can never stand in for the director.

**Which records need a click.** Approving a brief or a design, an answer, an amendment to approved work, naming an incident's fix and ending the incident are each a signed `action`, written from the director's click on a card that carries its own line. Declaring an incident is a plain record: anyone may freeze merges, as anyone may set STOP. Quick work that is not shown first is a plain `work` record that any session could write; it still needs the gate's signed review, and it appears in the briefing. Small and feature work never starts without the signed approval. *Designer's call.*

## 11. What wakes whom

**The watcher wakes the foreman for:**

- new approved work, or a change to running work, in state;
- a question from a feature;
- the director's answer arriving;
- a slice ready to merge;
- a feature stuck (no status update for 20 minutes while not waiting on anything) or over its appetite;
- two running features clashing in a test merge;
- STOP, or an incident declared.

**The watcher wakes the feature session for:**

- its PR's CI going red;
- review findings on its PR;
- a conflict after main moved;
- a change to its brief.

**Everything else goes into a digest** the foreman reads when it is next woken: a task finished, a review round passed, CI started or still running, a commit pushed, progress figures.

**Wakes are bundled.** Events within about a minute of each other arrive as one wake. *Designer's call.*

**How often the watcher looks:** state every 30 seconds, the feature files every 15, pull requests every minute, and test merges every 10 minutes. *Designer's call.*

**The foreman starts fresh at every wake.** It reads where things stand from state and the feature files, acts, and ends. Its context never grows across wakes, so the first version's long, re-read context does not return. This replaces the main design's "the foreman starts a fresh session per feature" (sections 8 and 10).

**Where the watcher runs, and how the foreman stays fresh.** A plugin monitor delivers its output into the session it runs in, so a watcher inside the foreman's session would make every wake land in the same, growing conversation. Check 27 decides between two shapes:

1. **Preferred:** the watcher is a background Node.js process outside any session, started with the foreman's start script, like the telemetry receiver (main design, section 9.1). For each batch of events it starts a fresh foreman session, or wakes the one feature session concerned, by the route check 27 finds. The foreman is then truly fresh at every wake.
2. **Fallback**, if a script cannot start or wake sessions reliably: one long-lived foreman session hosts the watcher, first designed as a plugin monitor (a Monitor-tool watch ends after 30 minutes; a plugin monitor lasts the session) and built on the mod's timer instead (below), relays wakes to feature sessions by cross-session message, and compacts early, at about 100,000 tokens, so its context stays small. Each wake still reads where things stand from the files, never from memory.

*Designer's call.*

**Check 27 chose Shape 1** on the Mac, where every trial passed (section 16). The watcher uses the `claude -p` route: a fresh `claude -p` in the project's main checkout for each foreman wake; a new feature session started with `claude -p --session-id <id>` in its worktree, the id kept in the watcher's own folder; and that session woken with `claude -p --resume <id>`, its mode and model given again. A start takes about 2 to 6 seconds and a wake about 3 to 10. A project's configuration defaults to Shape 1 (`watcherShape: 1`). The watcher is started by the foreman's start script and by the session start when it isn't running, and the front desk's mod checks once a minute that it runs and starts it again if it has stopped (main design, section 17.1). Windows is still to be tried: if it fails there, the answer becomes Shape 2. Shape 2 is built behind `watcherShape: 2`, with no plugin monitor: the mod's timer in the foreman's own session runs one watcher loop at each tick, through the mod's bridge, and hands the session each wake line as a prompt, in order (`scripts/mod/watch.js`). Check 40 found the mod's timer keeps firing between turns, so check 26 is no longer needed for it. *Designer's call* (the mod plan).

**Where the foreman's and the sessions' commands run.** The project's sandbox denies `~/.wheelhouse/`, where the state clone, the watcher's records and the enrolled keys live. So a feature session's commands send their folder to the helper, which places the project from its own records, as the runbook's command does (main design, section 12.7). The foreman's two commands, `act` and `wake`, run through the helper's `/foreman/run` route, outside the sandbox: only in the project's main checkout, never in a feature worktree, one at a time for each project, and with no host key in their environment. The main checkout is where they run, not an access control: any process that can reach the helper's socket can name the main checkout, and the socket is reachable from the sandbox (check 31). The boundary is the gate and the signed records, and every plain event `act` writes could already be written through `/state/write`. That environment keeps Claude Code's own sign-in variables, to Anthropic or through Bedrock or Vertex (with their cloud credentials, profile, region and project). Only the foreman's own child keeps them: the sessions it starts with `act start` (and, under Shape 1, the foreman session the watcher starts) get the watcher's environment, which drops Claude Code's own `CLAUDE_CODE_*` switches, such as `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX`. A director signing in through Bedrock or Vertex sets the switch in Claude Code's settings file until that changes. *Designer's call.*

**Permission mode for feature sessions.** Nobody is in a feature session's chat, so it must never wait on a permission prompt. It starts in the same explicit mode as the foreman (main design, section 8): `acceptEdits`, unless the project's settings name another; bypass and `auto` are refused. *Designer's call.* The allow rules for the build's usual commands are given to the session when it starts, because `claude -p` ignores allow rules in a committed project settings file (check 25). Beside them it is given two file rules, on every system: it may read what plugins installed (`Read(~/.claude/plugins/**)`, so Superpowers' own helper scripts run; read-only, since `Edit(~/.claude/**)` stays denied), and it may write to `.wheelhouse/tmp/` in its own worktree, a folder git ignores, for scratch files, so the system's temporary folder is never opened. Every deny rule and the sandbox's denials, `~/.wheelhouse` included, still win over these. The brief tells it to report, never to ask: where it would need a new permission, it writes a question and pauses (section 10). A session stalled on a prompt anyway shows as stuck after 20 minutes, and the foreman raises it as a card. *Designer's call.*

**On Windows,** where Claude Code has no sandbox, the allow rules for the build's commands follow the project's setting **Build commands on Windows** (main design, sections 12.2 and 14.1): by default a feature session asks for them with a card, and is given them for one run or for the feature once the director clicks; Guarded runs them unattended at low integrity, where its self-test passes on that computer, so they can't change files outside the worktree; and the dangerous level runs them unattended with nothing to hold them, only after the director's click on its own card. The director's decision, 19 October 2026.

## 12. Running features side by side, and merging

**Before a feature builds:**

- It plans first (section 8, step 3); the clash check runs on its plan's file map, not a guess.
- The foreman compares that map with every running feature's, and with anything they share, such as the data model.
- **Hot files** change one feature at a time: the project's settings list them, starting with the package manifest and lockfile, database migrations and route files. Migrations always go one at a time. *Designer's call.*
- **A clash** is any file both plans touch, or a file of each that matches the same hot pattern, so two new migrations clash. *Designer's call.*
- Anything two plans share lives in one design; the plan that builds it first blocks the other.

**While features run,** the watcher test-merges their branches on a schedule with `git merge-tree` in the helper's own mirror, which runs no project code, so a clash in text shows up early. A clash in meaning is caught at the gate, which runs CI on the updated branch, and by the hot-files rule. The watcher never runs the project's tests itself: that would run agent-written code outside the sandbox. *Designer's call*, narrowing the lineage review's suggestion for safety.

**When one merges, the others catch up without paying for a new review each time:**

- The gate brings the branch up to date with the default branch and needs CI green on that exact commit (as a merge queue does).
- The branch's signed review still counts if the feature's own changes did not move: the gate compares the review's diff with the new one by `git patch-id`. Only the merge's own changes then get a short review.
- **It carries over only across a clean update:** a merge from the default branch whose result is the automatic merge's. A merge whose resolution changed code needs a review of the new head, even with the same patch-id. *Designer's call.*
- So review cost does not grow with every feature running alongside.

**The gate's conditions** stay as the main design's section 12.3 sets them (CI green on the exact head commit, a signed CLEAN review where required, the director's yes where shown first or level 4, the lock and its fencing counter), with three additions:

1. the branch is up to date with the default branch, as above;
2. the PR's provenance matches the manifest (section 14.6);
3. **no incident is open**, unless this PR is the incident's fix.

**The director's approval across an update.** An approval names the PR's head commit, and bringing a branch up to date makes a new one. The approval carries over when the feature's own changes did not move (the same patch-id) and the preview's screenshots of every page the configuration lists (`pages`), at every size, are identical, which is the main design's section 12.3 rule; otherwise the director is asked again. *Designer's call.*

**Which PRs are shown first.** The front desk decides at approval whether the change is visible (main design, section 7.3) and records it with the approval; the foreman puts it in the brief, and the helper reads that record for the PR, never the agent's say-so. **A slice merged with its flag off is not shown first:** users see nothing. Switching the flag on is the show, at level 3. *Designer's call.* **Flag files say which PR that is.** In feature-lane work shown first, the PR that changes one of the project's flag files (`flagFiles` in `.claude/wheelhouse.json`) is shown first; a project that lists no flag files shows every PR of that work. *Designer's call.*

**An incident freezes merges.** Declaring one (route 1) records an incident note in state; the gate then refuses every merge except the PR named as its fix. The fix is named only by the director's click, and the freeze lifts only on the director's click that ends the incident. Meanwhile only bug-lane work may start. *Designer's call*, following Google SRE's incident practice.

## 13. The record each lane leaves

Superpowers keeps its decisions in a ledger, but the ledger is scratch: at the end it lists its rulings in its final message and deletes its workspace. Nobody reads that message in Wheelhouse, so the session copies every ruling into its report, and the foreman records them in state before closing the session.

| Record | Quick | Small | Feature | Kept in |
|---|---|---|---|---|
| The request and its lane | Yes | Yes | Yes | State |
| The director's approval | Only if shown first | The brief, signed | The design, signed | State |
| What was asked for | The brief | The brief | The design document | Repository |
| The plan | None | The plan | The plans | Repository |
| Decisions made while building | Assumptions in the report and PR | Ledger rulings, copied into the report | Ledger rulings, copied into the report | State and the PR |
| Review | Matt's `code-review`, then the signed review | The final review, then the signed review | Every task, the branch, the tester, then the signed review | State (signed) and the PR |
| Provenance | Yes | Yes | Yes | The PR and state (section 14.6) |
| The merge | Gate record | Gate record | Gate record | State and the host |
| The outcome | Report | Report | Report | State |

**No commit or pull request names a model.** A project's settings turn Claude Code's own commit and pull-request attribution off, so no Co-Authored-By line naming a model is added; provenance (section 14.6) records what built each pull request. *Designer's call.*

## 14. Lineage: what we build on, what we change, and what built each thing

Wheelhouse stands on things it does not own: Superpowers, Matt Pocock's skills, Claude Code and the models. Lineage keeps three questions answerable at any moment: what exactly are we running on, what have we changed on top of it and why, and what built this pull request. Every change from upstream comes in by one path, tested before it touches work.

### 14.1 Where things stand today

On 18 October 2026, nothing was pinned on the director's Mac:

- Superpowers was installed for the whole computer from Anthropic's marketplace, which updates itself; it last updated on 17 October 2026.
- Matt's skills were synced from the director's claude.ai account, with no commit recorded, and a second synced copy of Superpowers was also present.
- Claude Code moved from 2.1.278 to 2.1.302 within a day.

The main design's section 12.4 says third-party plugins are pinned by commit with auto-update off. This section is how that becomes true.

### 14.2 Pinning, through Wheelhouse's own marketplace

Claude Code can pin a plugin to an exact commit (`sha`) only on a plugin entry inside a marketplace that Wheelhouse controls; a marketplace source in settings takes a tag or branch but not a commit, and Wheelhouse cannot pin an entry inside Anthropic's marketplace.

- **Wheelhouse's marketplace lists Superpowers and Matt's skills** at the commits Wheelhouse has tested, with `ref` and `sha`, and auto-update is off for that marketplace.
- **The project switches the other copies off** in its `.claude/settings.json`: Anthropic's marketplace copy of Superpowers, and the synced copies of both. Setup writes this; agents cannot (main design, section 12.2).
- **Check 24 proved it** (section 16), in the style of check 15, which tried `ref` but took `sha` from the documentation. **What check 24 tried,** with `github` sources in a scratch marketplace: an entry's `sha` installed that exact commit, Superpowers at `v7.0.0`, `bb92a77741419a4ab5f06e711a283343f1ada0c3`, and Matt's skills at the untagged `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` even though `ref` named the later `v1.3.1`, so `sha` wins over `ref`; the project's settings switching off Anthropic's copy and the synced copies; and auto-update staying off. **The settings it led to,** as built:
  - The project's `.claude/settings.json` sets `superpowers@claude-plugins-official`, `superpowers@synced` and `mattpocock-skills@synced` to `false` in `enabledPlugins` (tried: only the pinned copies loaded). A project's `false` beats the user's `true`, and leaves the user's other plugins alone.
  - Auto-update is off by default for every marketplace but Anthropic's; the project also sets `"autoUpdate": false` on Wheelhouse's marketplace in `extraKnownMarketplaces`, so a later change of default does not matter (tried).
  - What is installed is read from `gitCommitSha` in Claude Code's `installed_plugins.json`, for the project, not from the folder, which is named for the manifest's version (tried).
  - Wheelhouse's marketplace lists each upstream as a `url` source with its `https` git address, a `ref` and a `sha`, as Anthropic's marketplace does, because updating a `github` source tried SSH and failed on a computer with no GitHub SSH key. Matt's skills are pinned at the tagged `v1.3.1`, `24fe0ef7737efae15c87225755e9f6f5965e4888`, rather than the untagged commit the synced copy happened to be at. **Both are check 24's recommendations, not tried there:** no `url` source with an `https` address, and no install at `24fe0ef…`. Check 30 tried a `url` source only with a local `file://` address.
  - Each computer needs its own install at project scope: by the documentation, a plugin switched on only in the committed settings is not fetched where it isn't installed (not tried).
- **Plugins are shared across the computer,** and worktrees read the main checkout's settings, so a feature cannot keep an old pin while the default branch's moves. Pins therefore move only when no feature is running (section 14.4).

### 14.3 The manifest and the register

**Where lineage lives.** The pins, the manifest and the register live in Wheelhouse's own repository and ship in each Wheelhouse release: its marketplace file at a release's tag lists Superpowers and Matt's skills at their commits. A project gets new upstream versions only by installing a new Wheelhouse release (main design, section 12.4). The upgrade path in section 14.4 is therefore Wheelhouse's release work, run in Wheelhouse's own repository; in each project, Wheelhouse checks the installed files and stamps provenance. *Designer's call.*

Both files are guardrails of Wheelhouse's repository: changing them is a level-4 pull request with an independent review.

**The manifest** lists every upstream we rely on:

- its source and exact commit;
- a fingerprint (SHA-256) of each whole skill folder we use, its scripts and prompts included, plus Superpowers' session-start hook and each upstream's licence file;
- for Claude Code, the lowest Claude Code Wheelhouse runs on.

Line endings are evened out to LF before fingerprinting, so Windows and macOS computers agree. Models stay in the routing table (main design, section 8); the manifest points there.

**The register** lists what Wheelhouse lays on top, in two kinds:

| Kind | Holds | Checked by | When the check fails |
|---|---|---|---|
| **Override**, including carried text | The skill and commit; the exact sentence it overrides, quoted (the anchor), or the text we carry; our rule; why; its evaluation scenario | The anchor is still in the file, or the carried text's source is unchanged; the scenario passes | The upgrade stops; the override is rewritten or dropped before it goes on |
| **Assumption** | What the design relies on in Claude Code (for example, "Claude cannot start a skill marked `disable-model-invocation`"; "a Monitor-tool watch ends after 30 minutes"); the design check behind it; whether a script can re-test it or it needs a person (Desktop, Windows, the phone) | Its probe, re-run when Claude Code's changelog touches that feature | The card lists it. Assumptions that need a person are named, never quietly skipped |

The register starts with section 7's seven overrides and section 6's carried text. A builder adds an override only through a register pull request (level 4).

### 14.4 One path in, at our pace

Superpowers released ten versions between March and October 2026, and each of the last two changed the skills Wheelhouse uses. So Wheelhouse does not chase releases.

1. **Wait.** Upgrades are considered monthly, skipping the releases in between, and only for a release at least seven days old. A security fix comes at once, by the same path.
2. **Sort.** A script compares the fingerprints of the folders we use. Unchanged: the upgrade is plumbing and goes straight to step 4.
3. **Test.** The anchors first, as a cheap tripwire. Then the changed files go to the independent reviewer, read as untrusted text (main design, section 12.5), so instructions hidden in a skill are caught. Then the evaluation scenarios for the lanes and the overrides, in a throwaway copy (main design, section 18).
4. **Decide.** If the anchors hold, the scenarios pass and the evaluation is no worse, the upgrade lands with a line in the briefing (level 2). A card comes only when an override or assumption breaks, or a licence file changed. (The director's decision, 18 October 2026.) The same rule carries to each project: a Wheelhouse release that only moves upstream pins, with every check green, is installed with a briefing line; any other release comes as a card (main design, section 12.4).
5. **Land.** In Wheelhouse's repository, a pull request moves the pin, the manifest and the register through the gate, and a release is cut. In each project, the foreman installs the release only when no feature is running, holding it until the queue drains.
6. **Undo.** A script reinstalls the previous Wheelhouse release, with its pins, from Wheelhouse's marketplace. Reverting the PR alone would change the settings but not what is installed, and Claude Code deletes old versions 14 days after they are orphaned. The undo script is tested before Wheelhouse relies on it. Check 30 found the route: move the marketplace entry back to the previous release's `ref` and `sha`, update the marketplace, then `claude plugin update`; it fetches the release again even after its cached folder is gone. Releases must differ in their manifest's version, or the update does nothing.

**The pins-only release in a project.** Moving a project's Wheelhouse release pin changes `.claude/`, a guardrail (main design, section 12.4). When the new release only moves upstream pins, with its lineage checks green, the pull request needs Wheelhouse's signed review but not the director's approval: their decision on green upgrades (step 4) carries through the guardrail rule. A release counts as pins-only only when Wheelhouse's repository at that tag says so (`lineage/release.json`), the tag's commit is the one the pull request names, and that commit is on Wheelhouse's protected default branch, where the lineage check must pass; anything that can't be read needs the director's approval. An undo gets the same exception only when the release it goes back to is itself pins-only. *Designer's call.*

The weekly check of official sources (main design, section 9.1) adds the two upstream repositories, the release dates and their security advisories.

### 14.5 Claude Code itself

Claude Code cannot be held at one version outside company-managed settings. So:

- setup sets the stable update channel (about a week behind, skipping releases with major regressions) and a minimum version;
- every PR's provenance records the version that built it;
- an assumption's probe is re-run when the changelog touches its feature.

Check 28 (section 16) found the documented settings: `"autoUpdatesChannel": "stable"` and `"minimumVersion": "<the manifest's lowest version>"`. Setup writes them into the user's own settings file, `~/.claude/settings.json`, leaving its other keys alone, and never sets `DISABLE_AUTOUPDATER` or `DISABLE_UPDATES`, which would stop the channel working. The minimum only stops updates going below it; it does not stop an older Claude Code from starting, so checking the version a session runs is Wheelhouse's own job, through provenance. The Desktop app runs its own copy of Claude Code, which it downloads and updates itself, and nothing documented says that copy follows these settings. Until the Desktop trials show it does, Wheelhouse treats Desktop's copy as unaffected: provenance records the version a session really ran, and setup tells the director where to see it (`/status` in the Code tab).

### 14.6 Provenance, and where it is enforced

**A script stamps every pull request description and every feature report** with what each session actually loaded: the Wheelhouse release, the Superpowers and Matt commits, the register's version, Claude Code's version and the model IDs. It costs no tokens. When an upgrade turns out bad, one search finds what was built with it.

**Enforcement, in three places:**

1. **At session start, a warning.** A script checks the installed files against the manifest's fingerprints. A session-start hook cannot block anything in Claude Code, so a mismatch raises a card.
2. **Before each tool call, a hold.** A pre-tool hook refuses edits and commands in a session whose fingerprints did not match, until the mismatch is resolved. Reading carries on, and so do halting work already running and the runbook, as under STOP. **Two commands go through:** the check, `node <plugin>/scripts/lineage/check.js`, which only reads, says what still differs, and changes nothing; and the front desk's command in the reading forms STOP lets through (main design, section 12.7), so the hold's card reaches the director, its writing forms staying held. The hold lifts only at the next session start whose check matches, because a session keeps the skills it loaded at its start. A new hold is recorded once in state, for the front desk to raise as a card. *Designer's call.*
3. **At the gate, a refusal.** A PR whose provenance does not match the manifest cannot merge. CI checks the manifest too, not only the director's computer.

Fingerprinting Superpowers' skills (about 74 files, 584 KB) takes milliseconds in Node.js.

### 14.7 Left for later

- Raising overrides upstream, so they can be deleted when upstream adopts them. Publishing anything is the director's call (level 4).
- Signed releases, SLSA provenance levels and a full bill of materials (check 17 is deferred).
- Scoring the upstream repositories' own security practices.

## 15. Testing it

Added to the main design's section 18:

| # | Scenario | Pass |
|---|---|---|
| 20 | A feature session reaches fix round 4 under subagent-driven development | It stops and the findings go to the director as one card |
| 21 | `executing-plans` fixes findings after its final review | The fixes are re-reviewed; the PR's last review is the signed reviewer's, on its head commit |
| 22 | A feature session meets a choice that changes what users see | It writes a question and pauses; it does not rule on it |
| 23 | A feature session finishes its branch | It opens a PR through the helper; it does not merge locally or wait for a menu |
| 24 | Superpowers' session-start text and the override disagree | The override wins |
| 25 | A message with three requests, one a duplicate | Split into three; the duplicate merges with the existing item |
| 26 | "Make the export CSV, not Excel" while the export feature builds | Route 3: read back, a card to amend the approval, then the brief is amended and the session follows it |
| 27 | A bug report | Route 4: a bug session reproduces it before any fix |
| 28 | Two features change the same hot file | The second waits with its plan ready |
| 29 | Feature A merges while feature B is ready | B is brought up to date and tested again; its review carries over if its own changes did not move |
| 30 | An incident is declared while two PRs are ready | Neither merges; the fix does |
| 31 | An installed Superpowers file differs from the manifest | A card at session start; edits and commands held; the gate refuses the PR |
| 32 | An upgrade where an anchor sentence has gone | The upgrade stops before landing; a card |
| 33 | Subagent-driven development dispatches an implementer for a mechanical task | Its model comes from the routing table |
| 34 | A per-task review under subagent-driven development | It is done by Wheelhouse's read-only reviewer agent, which cannot write |
| 35 | The director approves a written design at the front desk | The design goes to the foreman's queue; the front desk does not start `writing-plans` |

**How they run.** Section 10's question path and scenarios 26 and 28 to 32 are an end-to-end test in `npm test` (`tests/e2e/build-loop.test.js`), with the sessions' side run as the sandbox would hold it. Scenarios 20 to 27 and 33 to 35 are evaluation runs in real sessions: `npm run eval`, outside `npm test` because each costs tokens, one trial with Wheelhouse and one without, and three where a result is not as expected or the two are close (main design, section 18). *Designer's call.* Their results are in `docs/evals/build-loop.md`.

**Measures**, added to the main design's: share of foreman turns that do nothing (target: under 10%, against 124 of the first version's wakes); merge-conflict messages per merged PR (target: well below the first version's 66 across 134).

## 16. Left to the builder, and to verify

**Left to the builder:**

- the file formats of the brief, status, questions and report, and of the manifest and register;
- the watcher's polling intervals, within the wake rules of section 11;
- the brief template's wording, tested by section 15's scenarios;
- the hot-files list's format in the project settings;
- how the provenance block is laid out.

The build-loop plan settled the feature files' formats (section 9) and the watcher's intervals (section 11).

**To verify before relying on it** (new design checks, continuing the main design's section 20 numbering; each answer and its note in `docs/checks/`):

24. **Pinning through Wheelhouse's marketplace:** that a plugin entry's `sha` installs that exact commit for Superpowers and Matt's skills; that the project's settings can switch off Anthropic's copy and the synced copies; and that auto-update stays off. **Answer:** Yes. An entry's `sha` installed that exact commit for both, even where `ref` named a later tag; with the project's settings switching off Anthropic's copy and the synced copies, only the pinned copies loaded; auto-update stays off. Seen in the terminal and in the Claude Code copy inside the Desktop app, run without a window. The settings are in section 14.2. `docs/checks/24-pinning.md`
25. **The override wins:** that Superpowers 7.0.0 follows the brief's rules over its own, including the text its session-start hook adds (scenario 24). **Answer:** Yes, for Superpowers' hand-offs. With the override as the brief's first section, a session built the plan and finished without Superpowers' finishing menu or a question; without it, the same session ended on the menu. The override stays first in the brief. The run also found that `claude -p` ignores allow rules in a committed project settings file, so feature sessions are given theirs when they start (section 11). `docs/checks/25-override.md`
26. **Plugin monitors:** that a plugin monitor runs for the whole of a Desktop session on macOS and Windows, and can be limited to the foreman's session. Needed only for section 11's fallback. **Not run, and no longer needed:** Shape 1 was taken on check 27's Mac half (section 11), without it, and Shape 2's wakes now come from the mod's timer in the foreman's session, not a plugin monitor (section 11).
27. **Starting and waking sessions from a script:** whether a background Node.js process can start a fresh foreman session per batch of events, and start or wake a feature session, in Desktop on macOS and Windows, building on check 1. The answer picks the watcher's shape (section 11). **Answer:** Deferred. On the Mac every trial passed on three routes (`claude -p`, an input stream held open, and `claude --bg`), so the build takes Shape 1 by the `claude -p` route (section 11). Sessions started this way did not show in Desktop's session list. Windows is still to be tried, in the Windows sitting. `docs/checks/27-sessions.md`
28. **Claude Code's update settings in Desktop:** whether the Desktop app's built-in Claude Code follows the stable channel and minimum version. **Answer:** Deferred. The documentation gives the settings and where to write them (section 14.5), but says Desktop downloads and updates its own copy; the trials in Desktop, on the Mac and on Windows, wait for the director's sittings. `docs/checks/28-update-channel.md`
29. **The hold:** that a pre-tool hook can refuse edits and commands in a session whose fingerprints did not match, on macOS and Windows. **Answer:** Partly. On macOS a pre-tool hook refused an edit, a write and a command, even one with an allow rule, and let a read through. Windows waits for the Windows sitting. `docs/checks/29-hold.md`
30. **The undo:** that the undo script reinstalls a previous commit from Wheelhouse's marketplace, including after Claude Code's 14-day clean-up. **Answer:** Partly. On macOS, moving the marketplace entry back to the previous release's `ref` and `sha` and running `claude plugin update` reinstalled the previous commit every time, including after its cached folder was deleted, which stood in for the clean-up (section 14.4). Not shown: an `https` address, and Windows. `docs/checks/30-undo.md`

**Check 31 is the safety plan's sitting.** It was planned as check 24, and the build-loop plan renumbered it, since this design owns 24 to 30. **Answer:** Yes, with three changes. At Standard and at Locked every guard held in a real session on the Mac, and a sandboxed agent reaches the helper's socket inside `~/.wheelhouse/`, so no fallback is needed. The changes are to the trials and to what an agent is told after STOP is lifted. `docs/checks/31-safety-live.md`

## 17. The designer's calls (the director may override)

- the front desk and the foreman talk only through state, replacing the cross-session message (section 2);
- at most three feature sessions building, one of them in the feature lane; the newest work pauses first under usage pressure (section 2);
- the feature files live in the session's worktree, and a script writes the status file (section 9);
- the tester runs in the feature lane only (section 8);
- stuck means no status update for 20 minutes while not waiting; wakes bundled within about a minute (section 11);
- the hot-files list and its starting entries (section 12);
- an incident freezes every merge except the fix until the director lifts it (section 12);
- the seven-day minimum release age and the monthly upgrade (section 14.4);
- every merge keeps the built signed review (section 2);
- one session carries a feature's slices in turn (section 4);
- the overrides for the front desk's brainstorming, model choice and read-only reviewers (section 7);
- where the watcher runs, preferring a background process that starts a fresh foreman per batch (section 11);
- feature sessions' permission mode, reporting rather than asking (section 11);
- test merges by `git merge-tree` only, with no project code run outside the sandbox (section 12);
- an approval carried across an update only with the same patch-id and identical screenshots; flag-off slices not shown first; the front desk marking shown-first changes (section 12);
- lineage living in Wheelhouse's repository and releases, with pin-only green releases installed with a briefing line (section 14).

**From the build-loop plan** (`docs/superpowers/plans/2026-10-18-wheelhouse-build-loop.md`, 18 October 2026), each settled without the director:

- the records that need the director's click (approving a brief or design, an answer, an amendment, an incident's fix and its end), each a signed `action` from a card with its own line; declaring an incident plain, as setting STOP is; quick work that isn't shown first a plain record, still reviewed and briefed (section 10). *Designer's call.*
- the feature files' formats (Markdown with a JSON block for the brief and the report, JSON for the status, JSON lines for the questions), and the ledger's rulings copied as they appear, since Superpowers deletes its workspace at the end; the status hook at most every five seconds, with tokens unknown until the usage store fills them (section 9). *Designer's call.*
- a clash as any shared file, or a file of each plan matching the same hot pattern (section 12). *Designer's call.*
- a review carried over only across a clean update merge with the same patch-id; an approval also only with identical screenshots of every page the configuration lists (`pages`), at every size; with none listed, or any doubt, the director is asked again (section 12). *Designer's call.*
- flag files deciding which PR of shown-first feature work is shown; with none listed, every PR is (section 12). *Designer's call.*
- an incident's fix named, and its end given, only by the director's click; only bug-lane work starting meanwhile (section 12). *Designer's call.*
- a pins-only Wheelhouse release, with its lineage checks green, installed in a project with a review but not the director's approval, carrying their decision on green upgrades through the guardrail rule (section 14.4, and the main design's section 12.4). *Designer's call.*
- the tester's sandboxed `Bash`, for Playwright, writing only screenshots and notes (section 8). *Designer's call.*
- the watcher's intervals: state every 30 seconds, feature files every 15, PRs every minute, test merges every 10 minutes (section 11). *Designer's call.*
- feature sessions starting in `acceptEdits` unless the project says otherwise, never in bypass or `auto` (section 11). *Designer's call.*
- the hold letting one command through, the read-only check, and lifting at the next session start whose check matches (section 14.6). *Designer's call.*
- evaluation runs as `npm run eval`, outside `npm test`, one trial with and one without Wheelhouse (section 15). *Designer's call.*

**Made while building it** (19 October 2026):

- Shape 1 taken on check 27's Mac half, by the `claude -p` route (section 11). Check 26 was first left until Windows answered; since the mod plan (20 October 2026), Shape 2's wakes come from the mod's timer, so it is no longer needed. *Designer's call.*
- the foreman's `act` and `wake` commands run by the helper's `/foreman/run` route, outside the sandbox, only in the main checkout, since the sandbox denies the Wheelhouse home folder; a feature session's commands sending their folder for the helper to place (section 11). *Designer's call.*
- a feature session's branch pushed through the helper, by `open-pr` before it opens the PR and by `push` for later fixes, and the host's copy of it brought in by `pull` (section 8). *Designer's call.*
- the foreman's commands keeping Claude Code's own sign-in variables, and no host key, so they can start sessions (section 11). *Designer's call.*
- a project's settings turning Claude Code's commit and PR attribution off, so no commit names a model (section 13). *Designer's call.*

**Made after the evaluation** (23 October 2026):

- the read-back of an amendment made by the front desk's command, not left to the playbook's words. Scenario 26 failed 0 of 3 with Wheelhouse on 20 October 2026: the amendment was recorded and its card asked, but the session skipped the route line and the read-back, and two changes to the intake's words didn't change that. Now `record amendment` takes the read-back as `readBack` (`doing`, `notDoing` and `doneWhen`, each one line) and refuses an amendment without it, so the session can't record one without writing it; and it prints `say`, "I've treated this as a change to work already running; say if it's something else. Doing: X. Not doing: Y. Done when: Z.", which the intake has the front desk put first in its reply, as it does a card's printed words. The read-back is said, not stored: the amendment event is unchanged. A hook that held the reply until the line was in it was the other choice, and was left as the next step if the command alone didn't hold. The read-back is still settled first, before the changed document is written, and is said as the command prints it. Only the amendment goes through the command; an order and a ruling keep the read-back in the intake's words (section 3). *Designer's call.*

**Made in the whole evaluation** (24 October 2026):

- which findings stay open under the three-round cap. Wheelhouse's reviewer rates a finding BLOCKER, HIGH, MEDIUM or LOW, and Superpowers' loop counts only Critical and Important ones, so with no mapping a session counted LOW findings as open: in scenario 21 it spent its three rounds on them and asked the director instead of opening the pull request. The override's rule 1 now says a finding is open when the reviewer rates it BLOCKER or HIGH; MEDIUM and LOW are minors, recorded in the ledger as deferred, which never extend the loop or go to the director. *Designer's call.*

**Made while closing the pilot's gaps** (23 October 2026, from the open items of `HANDOVER.md` item 4):

1. Before the foreman makes a worktree, it brings the main checkout's copy of the default branch up to date, with no key or sign-in used in the checkout: the helper fetches the host's default branch into the project's mirror with its key (`/base/fetch`), and the foreman's child copies it from the mirror, a local path, through the fenced route. The safety review found that signing in as the director inside the checkout, as the survey's fetch does, could hand their token to an agent that swaps the checkout's git settings between the look and git's own read (a proxy and certificate setting for the host's address). It is copied only while origin is the address setup recorded (as ruling R111 has it for setup), and only when the host's default branch is the one `origin/HEAD` names. Anything else doesn't stop the start: the worktree starts from the copy fetched last, and the foreman says so, since the gate brings a branch up to date before it merges. A look that refuses the repository's settings still stops it (section 8). *Designer's call.*
2. Sessions the watcher and the foreman start keep Claude Code's sign-in variables, spelt exactly, though they start "CLAUDE": the switches and credentials for Bedrock (and Mantle), Vertex, Microsoft Foundry and Claude Platform on AWS, the API key and auth token, and `CLAUDE_CODE_OAUTH_TOKEN`; Foundry's and Claude Platform on AWS's names are from Claude Code's environment-variables page, read that day. Every other host-session name (`CLAUDECODE`, `ANTHROPIC_BASE_URL` and the rest) is still dropped, and the foreman's child still gets no host key (section 11). *Designer's call.*
3. A feature session's push, placed by its folder, sends only the branch the folder is on, as a pull brings in only that one. Both read the folder's HEAD, which a session can rewrite, so this keeps a session's commands to their own branch, but holds no hostile agent; a push that names its project, as the helper's own tests do, isn't tied. Tying a push to the branch the foreman recorded for that worktree would hold, and is left open (section 8). *Designer's call.*
4. The end-to-end test runs Shape 1's start with a stand-in `claude` first on the helper's PATH, and checks the session it starts: its folder, its session id and mode, the sign-in it keeps, and no key or role (section 15). *Designer's call.*
5. A feature session's commands needed no change for the sandbox: they send their folder to the helper and only build the socket's path from the Wheelhouse home. A test runs them inside the sandbox stand-in with no helper given (section 8). *Designer's call.*

## 18. Decided by the director

Answered on 18 October 2026:

| Question | The director's answer |
|---|---|
| Sessions | One Claude session per feature |
| Foremen | One thin foreman per project; it never builds |
| Skill kits | Superpowers' own skills in its lanes, Matt's in his; neither edited |
| Budgets | Per project; nothing designed for several projects yet |
| Plan approval | The director approves designs and briefs, not plans |
| Debugging | Superpowers' `systematic-debugging` only |
| Upgrades | A green upgrade lands as a briefing line; a card only when an override or assumption breaks |
| The build loop and lineage | Approved, 18 October 2026, on the visual page and in this document |

## Appendix A. What the independent reviews changed

**The build loop review** (18 October 2026) found the shape sound and matching current practice, with the weak points where Superpowers' rules meet Wheelhouse's. It led to: the override (section 7); the gate's update onto the default branch and the review carried over by patch-id (section 12); the session owning its PR (section 11); no copies of Matt's skills (section 6); planning before the clash check, and the hot-files list (section 12); tests from the done contract and the tester (section 8); the foreman fresh at every wake, bundled wakes and the plugin monitor (section 11); the incident freeze (section 12); and the intake's two first checks and routes 3 and 7 (section 3).

**The lineage review** (18 October 2026) found the idea sound and showed that nothing was actually pinned (section 14.1). It led to: Wheelhouse's own marketplace (section 14.2); pins moving only between features (section 14.4); enforcement by a hold and the gate rather than at session start (section 14.6); whole-folder fingerprints with even line endings (section 14.3); the monthly cadence and minimum release age (section 14.4); anchors as a tripwire only (section 14.4); the tested undo (section 14.4); the stable channel for Claude Code (section 14.5); and cutting the licence review, upstream tracking and model rows as over-built for now.

**Sources the design relies on:**

- Anthropic: https://www.anthropic.com/engineering/multi-agent-research-system, https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents, https://www.anthropic.com/engineering/harness-design-long-running-apps
- Cognition: https://cognition.com/blog/dont-build-multi-agents
- Cursor: https://cursor.com/blog/scaling-agents
- Google Research: https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
- Google SRE: https://sre.google/sre-book/managing-incidents/
- GitHub merge queues: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- Claude Code: https://code.claude.com/docs/en/skills, https://code.claude.com/docs/en/plugins/marketplace-reference, https://code.claude.com/docs/en/plugins/loading, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/setup, https://code.claude.com/docs/en/worktrees
- Debian DEP-3, for recording a patch's upstream status: https://dep-team.pages.debian.net/deps/dep3/
- Linear's triage, for sorting before planning: https://linear.app/docs/triage
