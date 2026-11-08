<!-- docs/specs/2026-11-08-crew-visibility-design.md -->

# Crew visibility: design (8 November 2026)

**Status:** draft for the director. It replaces PR #370's design (`docs/specs/2026-11-07-watch-the-crew-design.md`, on `design/watch-crew`), as the core cut's section 4.4 asked, and keeps that design's setting name, levels, script and safety rules. It builds on the core cut (`docs/specs/2026-11-07-core-cut-design.md`) and the director's way of working (`docs/specs/2026-11-07-director-way-of-working-design.md`), and changes neither. On 8 November the director settled the first two calls of the first draft (section 13.1). One call is open: whether the director talks to worker sessions directly (section 13.2). It touches #400's one-First-Mate design (`docs/specs/2026-11-08-one-first-mate-design.md`, on `design/one-first-mate`), and section 13.2 says how the two agree.

## 1. In plain words

Every piece of work runs out of sight today: the Bosun (the foreman) and one Crew session per piece are started headless by the watcher, and what they print is thrown away. The director sees the First Mate, the Logbook, the daily digest and alerts.

This design lets the director choose how much of a piece they see **when they start it**, with a project default for when they don't say:

- **Background** (`off`): as today.
- **Steps**: the piece's latest step, and its last few, in plain words in the Logbook ("A Lookout is reviewing task 2", "Running the tests").
- **Transcript**: as steps, and a readable page of the piece's whole run so far, kept on this computer and opened outside the chat.
- **Steer it**: the director opens the piece's own session in a terminal and talks to it from the start.

Seeing never steers. Steering is a separate, deliberate action, **take the helm**, open at the start or at any time later: the piece pauses at its next quiet point, the director opens that same session in a terminal, talks to it directly, then hands it back, and the crew carries on from there.

## 2. Why

In the director's words: "All work is done in background sessions which I have no visibility over, that might be preferable for some work, but may not be the case for other types."

And on how it is chosen: visibility isn't decided by the kind of work. The director chooses it when starting each piece, and it is also a project setting, the default.

The way-of-working design already wants this. The director "may not look at everything all the time" but "visibility is needed", and "They can see everything when they want to, without being pushed everything" (its section 1). Its section 9 names PR #370, re-scoped, as the step-by-step view. The core cut makes the gap wider: with only the own engine, every build is a headless session the director can't open.

## 3. Goals, non-goals and anti-goals

**Goals**

- The director chooses, for each piece as they start it, how much of it they see, and can change it later.
- A project default covers the pieces they don't choose for.
- They can see what any piece is doing now, and what it has done, when they ask.
- They can step in and steer one piece directly, from its start or later, and hand it back.
- Watching costs no model tokens.

**Non-goals**

- A choice by kind of work. Lanes don't set the level; the director does, piece by piece.
- A new surface. The chat stays the one surface (way of working, section 3); the pane stays parked.
- Live crew sessions for every piece. The watcher keeps one way of running sessions (section 5).
- Steering from anywhere but this computer. Claude Code's Remote Control already reaches a running interactive session from the phone or claude.ai, so a helm session can be continued that way with nothing built (section 9.3). The phone gets alerts only (way of working, section 9).

**Anti-goals** (failures even if everything technically works)

- A view that can send anything to a crew session, or that a crew session can tell is open.
- A transcript, or text from one, that reaches a model's context or leaves this computer.
- Steering that leaves the First Mate blind: a call made, or a decision answered, at the helm that the decision record and the First Mate never hear of, so the director finds it later in a diff.
- Two processes writing one session.
- A piece lost, counted as stalled, or resumed twice because the director had the helm.
- The director pinged with progress because they chose to watch a piece.
- A question at the start of every piece. The choice is offered as a line the director can ignore.

## 4. What the director can see today

The crew, as Wheelhouse names it: the First Mate (the front desk), the Bosun (the foreman), the Crew (one feature session per piece), and, inside each feature session, its subagents: Crew members who build (`agents/builder.md`), Lookouts who review (`agents/reviewer.md`) and the tester (`agents/tester.md`).

| Role | How it runs today | What the director sees today |
|---|---|---|
| **First Mate** | The director's own chat session, in the project's main checkout | Everything: it is the chat |
| **Bosun** | A fresh headless `claude -p "Wheelhouse foreman: …"` at each wake (Shape 1, `scripts/watcher/waker.js`, `startForeman`), with no session id given, 60 minutes at most, output thrown away. Shape 2, the long foreman, is parked. After way-of-working part 10 a script makes the routine moves, so the Bosun wakes only for judgement | Only what it records: the Logbook's lines, cards and decisions, the digest |
| **Crew (feature session)** | `claude -p --session-id <id>` at its start, then `claude -p --resume <id>` at each later wake (`adapters/claude-code/sessions.js`), detached with no window (`spawnDetached`), in its own worktree. Each run ends when it reports; the next wake resumes the same session. 8 hours at most per run. Output is thrown away, except what the premium-model check keeps | The Logbook's line per piece: its state (writing its plan, building, paused, waiting), slice n of m, its pull request and review; its decision messages; "why" answers from a read-only copy of it (way of working, section 6.3); its proof note |
| **Crew members, Lookouts, tester** | Subagents inside the feature session. Each has its own transcript beside the session's | Only their results: the signed review and its findings, the tester's screenshots under `.wheelhouse/feature/screens/`, the proof note |

Two facts shape everything below. First, the crew is **not run with `--output-format stream-json`**: the brief for this design assumed so, but the waker runs plain `claude -p` and discards what it prints. Second, every run still writes its full transcript, one JSON event per line, to `<config folder>/projects/<folder>/<session id>.jsonl`, and each subagent's to `<config folder>/projects/<folder>/<session id>/subagents/agent-<id>.jsonl` (checked on this computer on 8 November 2026). The config folder is `~/.claude`, or `CLAUDE_CONFIG_DIR` when set. So everything a view needs is already on disk.

## 5. Approaches

| Approach | What it is | Trade-off | Outcome |
|---|---|---|---|
| **A. Read-only views plus taking the helm** | PR #370's levels and script, drawn in the chat's Logbook and a local page; steering is a separate handover of one paused piece to the director's own terminal | Safe by construction; no change to how the watcher runs sessions; the director steers one piece at a time, after a short pause | **Chosen** |
| B. Visible pieces run live | A visible piece runs from its start as an interactive Claude Code background session (`claude --bg`), which the director attaches to with `claude attach` and the watcher reads with `claude agents --json` | A second way of running sessions beside `-p`. A live background session can't be woken by `claude -p --resume`: Claude Code attaches instead, or exits with an error when output flags are passed, so every wake would need a new route. Unattended idle background sessions are stopped after about an hour, and all of them by a reboot, which the crash resume would read as losses. `--allowedTools` and `--session-id` are not documented for `--bg`, so the grants the waker passes could be lost. Claude Code refuses a second writer on one session, so the director and a wake would race. And it buys little: the read-only views show the same work without a process held open | Rejected |
| C. Read-only views only | PR #370 as the core cut re-scopes it, with no way to steer | Simplest; but the director wants to shape some work as it goes, which a decision message can't always carry | Rejected: the director asked for steering from this computer |

**On PR #370: build on it, close it in favour of this design.** Its setting (`watchCrew`, `off`/`steps`/`transcript`), its script (PR #370's `scripts/crew/watch.js`, named `scripts/crew/runs.js` here because `scripts/desk/watch.js`, the desk's change feed, already holds the name), the foreman's session id and its six safety rules carry over unchanged in substance. What changes is where the views are drawn (the core cut parked the pane), the Archon branch (gone, with `engineRoom`), the home of the setting (the project, not the profile), the choice per piece at its start, and the helm, which is new. One design is easier to build from than a design and a patch, so this one supersedes the 7 November file; PR #370 closes when this design is approved. *Designer's call.*

## 6. The choice

### 6.1 The project default: `watchCrew`, "Watch the crew"

In the advanced group, kept in the **project's** settings (`home: 'project'`), because how much the director wants to see differs by project. Levels: `off`, `steps`, `transcript`. One value for the whole project; nothing per lane. A value that can't be read counts as `off`, as `typedReplies` does.

**The default is `steps`.** *Designer's call, as the director asked.* Because:

- The director asked for visibility, and background is what prompted the complaint. A default of `off` would leave every piece they don't choose for exactly where they started.
- `steps` pushes nothing. It changes only what the Logbook shows when the director opens it, so it can't break "without being pushed everything".
- It costs no model tokens to make, and about 20 to 40 tokens per running piece to show, only when the Logbook is shown (section 10).
- `transcript` as a default adds nothing until asked: the page is written only on request, at either level. Its only difference is that "watch <work>" works without first raising the piece, which costs one line of the director's words at `steps` anyway (section 6.2).

Steering is not a project default. It costs the director's attention, so it is chosen piece by piece.

### 6.2 The choice for one piece, at its start

When the director brings new work, the intake's message that confirms it (way of working, section 5) carries one line naming the level the piece will get, stated, not asked:

```
Watch: steps. Say "background", "full transcript" or "I'll steer it" to change.
```

The director can ignore it, which keeps the project default, or answer in their own words as they approve the work. The First Mate records a `watch` event (`{ work, level }`), which beats the project's value for that piece until it closes. The choices:

| The director says | Level for the piece |
|---|---|
| nothing | the project default |
| "background", "don't show me this one" | `off` |
| "steps", "keep me posted" | `steps` (still pull, never push) |
| "full transcript", "show me everything" | `transcript` |
| "I'll steer it", "let me drive this one" | `transcript`, and the helm from the start (section 9.1) |

**Later**, the same words at the front desk change it for a running piece ("show me everything on login-retry", "stop showing that one"); "take the helm of login-retry" takes the helm (section 9). "watch <work>" on a piece at `steps` or `off` raises it to `transcript` and opens the page. *Designer's call.*

The Bosun serves every piece, so it follows the project default alone. *Designer's call.*

### 6.3 What each level shows, per role

The levels only change what the director can **pull**. Nothing is pushed: no alert, digest line or message is sent because a step happened (anti-goal).

| Role | `off` | `steps` | `transcript` |
|---|---|---|---|
| **First Mate** | The chat | The chat | The chat |
| **Bosun** | Its records, as today | One Logbook line while it runs: "The Bosun is deciding what to do about login-retry's stuck review" | As `steps`, and its run can be opened like a piece's |
| **Crew** | The Logbook's state line, as today | The state line gains the latest step ("Changing `src/login.ts`", "Waiting for its next wake"); the Logbook's build view lists the last five steps under each running piece | As `steps`, and "watch login-retry" opens the run so far (section 7.3) |
| **Crew members, Lookouts, tester** | Their results, as today | Their steps appear under their piece, named by role: "A Crew member is building task 3", "A Lookout is reviewing task 2", "The tester is trying the sign-in page" | Their runs appear in the piece's page, each under its own heading |

**Taking the helm** (section 9) is not a level. It is an action on one piece, open to the director at any level, including `off`, at the start or later.

## 7. How the views work

### 7.1 Finding a run

- **A feature session's** id is already kept by the waker (its session record). Its transcript is found by id alone, `<id>.jsonl` anywhere under `<config folder>/projects/`, so the reader doesn't depend on how Claude Code names the folder for a worktree path.
- **The Bosun** has no id today. The waker gives each fresh foreman `--session-id <uuid>` and keeps it in the foreman's running record, as PR #370 proposed. It costs nothing.
- **Subagents** are the files under `<id>/subagents/`. Each subagent's first prompt names its kind (the Lookout's begins with the review it was asked for), and the session's own transcript records each subagent call with its agent type, which is how the reader names the role.

### 7.2 Steps

`scripts/crew/runs.js` reads the tail of each file (capped, as `readCapped` does elsewhere), parses the events and turns them into plain lines: a tool use becomes a verb on its target ("Reading `src/login.ts`", "Running the tests", "Asking a Lookout to review task 2"), and the assistant's text is cut to its first sentence. Unknown events are skipped, so a change in Claude Code's event format shows less and never breaks. The verbs go through the glossary's plain words, as the Logbook's other lines do.

The Logbook (`scripts/desk/views.js`, `workLines` and the build tab) asks the script for each running piece whose level is `steps` or above. It runs only when the Logbook is drawn: for a piece at `off` it never runs and no transcript is opened. Steps are kept out of the desk's change feed (`scripts/desk/watch.js`) and its snapshot, so a new step is never a change the desk reports.

### 7.3 The transcript page

"watch <work>" at the front desk, or `/wheelhouse:logbook watch <work>`, has the script write the run so far as a readable Markdown page in the project's `.wheelhouse/watch/<work>.md`, which setup already keeps out of git (`WHEELHOUSE_LINE`). The page holds what the session said, each tool it used with a one-line summary of the result, and each subagent's run under its own heading, newest at the bottom. The chat gets **one line**: the page's path, and the command that follows the run live in a terminal (`node <plugin root>/scripts/crew/runs.js --follow <work>`). The transcript itself never enters the chat.

Why a file and not the chat: anything a command prints into the chat goes into the First Mate's context, and a run's transcript is tens of thousands of tokens of other people's file contents. A file costs nothing, opens in the Claude app's file pane (it is inside the project folder) or any editor, and is written again each time it is asked for. A page is removed when its piece closes. *Designer's call.*

## 8. Safety

### 8.1 A watcher can't answer or steer

PR #370's six rules, kept in substance. After way-of-working section 6.1, "card" reads as "decision message".

1. **No path back.** The view has no input, and nothing in it sends anything to a crew session. It never starts, resumes or messages a session; it only opens files for reading. Stopping a build stays where it is today.
2. **Read-only by construction.** The script opens a transcript with a read-only flag, refuses a link or anything not a plain file, and writes only its own page. A crew session can't tell it is being watched.
3. **Data, not instructions.** Transcript text is shown as escaped text and never handed to a model, so nothing a crew session wrote, or a web page it read, can act through the view.
4. **Decisions stay decisions.** A piece waiting on the director shows "Waiting for your answer to decision 2" in its steps and on its page, never the question as something to answer there.
5. **Kept on this computer.** Transcripts hold file contents and command output. The views show them only on this computer: nothing goes to the board's records, the repository, the digest, an alert or a remote. Lines that look like keys or tokens are masked.
6. **Off means off.** For a piece at `off`, nothing is read.

### 8.2 The helm

7. **Only the director takes the helm,** by their own words at the front desk, at a piece's start or later. An agent may suggest it in a decision's "Meanwhile" or "why" answer; it never takes it.
8. **One writer.** The watcher starts nothing for a piece while the director holds it, and the director's session opens only once the piece's own run has ended (section 9.2). Claude Code also refuses a second process on one session, which is the backstop.
9. **The guards still hold.** The director's session is the same feature session, in the same worktree, so Wheelhouse's hooks run as in any feature session: the protected files, the build-command guards and the gate are unchanged. A permission Claude Code asks the director for there is theirs to give, as in any session of theirs.
10. **The First Mate is never blind.** The piece's decision log gets a line for the helm ("The director steered this piece from 14:02 to 14:31"). What the director says or decides at the helm reaches the First Mate as section 13.2's answer sets out; under its recommendation, a helm note on hand-back and decision records marked `where: 'helm'`.

## 9. Taking the helm

### 9.1 What the director does

1. At the front desk: "take the helm of login-retry" (or "let me steer login-retry"), or "I'll steer it" as they start a piece (section 6.2).
2. The First Mate answers with when it is ready ("now", or "when its current step ends, about 10 minutes from what it's doing"), and, once ready, one command to open it, in a `bash` block the Claude app can run with one click:
   ```bash
   node <plugin root>/scripts/crew/helm.js open login-retry
   ```
   This opens the piece's own session, interactive, in the terminal: the same session id, worktree, model, permission mode and grants the waker would give it, through the adapter (a `featureHelmCall` beside `featureResumeCall`, with no `-p`).
3. The director talks to it as to any Claude Code session. It has its whole context: its brief, plan, decisions and everything it has done.
4. To hand back, the director leaves the session (`/exit`, or closes the terminal), or says "hand back login-retry" at the front desk. Leaving is the usual signal, so a piece is never left held by a forgotten window; the next Logbook says it was handed back. *Designer's call.*

**Steering from the start.** For a piece the director chose to steer, the watcher does everything it does at a start except launch: it makes the worktree, writes the brief, records the session id it will use and takes the hold at once. The helm command then starts the session interactively, with `--session-id <id>` and the brief's first prompt (the adapter's `featureHelmCall` in its starting form), so the director is there from its first step. The piece takes its building slot only when the director opens it, so an unopened choice holds nothing; it waits on the board as "ready for you to steer". *Designer's call.*

### 9.2 What the engine does

- **Taking:** the First Mate records a `helm` event (`{ work, at }`), and the helper writes a hold file in the watcher's folder (`helm/<work>.json`), naming the piece's session id. `watch`, `helm` and `helm-ended` are new record kinds, registered as the others are; they are requests, not decisions, so the typed-reply and answer paths don't read them.
- **One gate, every path.** A new check, `helmHeld(project, work)`, in one module, is asked by every path that starts, wakes or moves a session or branch for a piece: the waker's start and wake sites (beside `controlHeld`, which checks the files that steer agents and is a different hold), the crash resume (`resume.js`), the routine moves (`routine.js`) and the Bosun's `act` commands (start, build, resume, pause and merge). A held piece is not started, woken, resumed, paused or merged: the director is changing its branch. Wakes queue as they do while a session runs. Records, signed reviews and the Logbook carry on as usual. *Designer's call.*
- **Waiting for the quiet point:** when a run is live, the hold waits for it to end. Runs end at each report, so this is usually minutes; it can be up to the run's 8-hour limit. The director may say "now". That is a new per-run stop, not All stop: it ends that piece's recorded process (checked by its start time, as `stateOf` checks it), clears its running record, sends its wakes again, and writes no lost marker, so the crash resume doesn't start it. The step in flight is cut off and the session keeps everything before it. *Designer's call.*
- **While held:** the piece shows "with the director since 14:02". It **keeps its building slot**, so taking the helm never raises the pace above three, as a waiting piece keeps its slot (way of working, section 6.4). The stuck check skips it, and the reliability bar records nothing for it: it is held on purpose (`scripts/watcher/reliability.js`, "stalled" counts only pieces not held on purpose). The digest lists it under what is waiting, so a long hold is seen.
- **Handing back:** a second `SessionEnd` command, beside the stop guard (`scripts/hooks/stop-guard.js`) in `hooks/hooks.json`, records `helm-ended` when the ending session's id has the `feature` role (`scripts/lib/role.js`) and a hold file names that id; "hand back" at the front desk does the same once the session's process has gone. The hold file is removed and the waker wakes the piece with its hand-back line (section 13.2 sets what it asks). The queued wakes go with it.
- **Recovery:** a watcher that restarts reads the hold file and leaves the piece alone. A reboot while held leaves the hold in place and the session on disk; the director can open it again, or hand it back. A hold with no `helm` event behind it (a file left by a crash mid-take) is removed at the watcher's start.
- **All stop** stops Wheelhouse's own starts, as today. A helm session is the director's own, so All stop leaves it running and says so in its answer.
- **"Why"** still works while held: it copies the session, which the director's session doesn't block.
- **The Bosun** can't be taken. It acts on the board for every piece, and steering it directly would go round the decision line. Subagents can't either: they live inside their piece.

### 9.3 What "visible" means on each surface

| Surface | Watching | Steering |
|---|---|---|
| **Terminal** | Steps in the chat's Logbook; the page; `runs.js --follow` | Yes: the helm command opens the session in the terminal |
| **Claude desktop app** | The same, in the chat; the page opens in the app's file pane | Yes, through the app's terminal panel (the one-click Run). Claude Code's documentation says the app's sidebar lists only sessions the app runs itself, so a crew session never appears there as a session row |
| **Phone (the Claude app)** | Nothing new: alerts say only that something waits (way of working, section 9). Transcripts stay on the computer (rule 5) | Nothing built. A helm session is an ordinary running interactive session, so Claude Code's Remote Control (`/remote-control` inside it) can already continue it from the phone or claude.ai/code while the computer stays on (Pro, Max, Team and Enterprise plans; not with an API key). That is enough for a start |

## 10. Costs

| What | Model tokens | Other cost |
|---|---|---|
| `off` | None | None |
| `steps` (the default) | Making the lines: none, a script does it. Showing them: each line is in the First Mate's context when the Logbook is shown, about 20 to 40 tokens per running piece at `steps` or above | A capped file read per such piece when the Logbook is drawn |
| `transcript` page | None: it is written to a file; the chat gets one line | A file of the run's size in `.wheelhouse/watch/`, removed when the piece closes |
| The choice at start | One line in the intake's message, about 20 tokens | None |
| Bosun's session id | None | None |
| Taking the helm | Each message the director sends costs about what one wake of that piece costs: the session re-reads its own context, mostly from cache, on the piece's model. On a Max plan this comes out of the same usage window as the crew. The hand-back adds one short wake | The piece is paused while held. The real cost is the director's attention, which way-of-working section 1 names as the limit |

**The pace limit of three is unchanged.** Watching starts nothing. A held piece counts as one of the three, so steering never adds a fourth session, and the director's own session is the piece's session, not an extra one. A piece chosen for steering takes its slot only once opened.

## 11. Fit with the way of working

- **Pull, not push.** The levels change only what the Logbook and the page show. The digest and alerts are unchanged (its section 9).
- **No new question.** The choice at start is a stated line in a message the intake already sends; the director answers it only to change it.
- **The decision line stands.** Decisions keep their shape (its section 6.2). Where they may be answered is section 13.2's call; under its recommendation the First Mate stays the one place they are tracked, even when one is answered at the helm.
- **"Why" and the helm differ.** "Why" asks a read-only copy and never changes the work (its section 6.3). The helm is the one route by which the director's words reach a running piece directly, and it is logged (rule 10).
- **Waiting doesn't stop the work** (its section 6.4). Taking the helm does stop that one piece, by the director's own choice, and the others go on.
- **The phone limit.** Nothing here sends content to the phone. Remote Control is the director's own reach into a session they opened; Wheelhouse doesn't start it.
- **Typed replies** (its section 6.1): their safeguards were built for the front desk. Section 13.2's option A adds one narrow case, the piece's own decisions answered by number in the helm session, and says why the gap is no wider.

## 12. What changes

- `scripts/settings/catalogue.js`: `watchCrew: { label: 'Watch the crew', group: 'advanced', levels: ['off', 'steps', 'transcript'], default: 'steps', home: 'project' }`. One helper gives the level for a piece: its own `watch` event, else the project's value. The main design's settings list gains it.
- `scripts/crew/runs.js` (new): finds, reads and summarises a run and its subagents; writes the page; `--follow`.
- `scripts/crew/helm.js` (new): takes, opens and hands back; the hold file; the starting form for "I'll steer it".
- `adapters/claude-code/sessions.js`: `featureHelmCall`, the interactive call, in a resuming form and a starting form.
- `scripts/watcher/waker.js`: the foreman's `--session-id`; `helmHeld` at each start and wake site; the start without a launch for a piece steered from the start; the per-run stop for "now"; the hand-back wake. `scripts/watcher/resume.js`, `routine.js` (its moves and stuck check), `reliability.js` and the Bosun's `act` commands ask `helmHeld` too.
- The state layer: the `watch`, `helm` and `helm-ended` record kinds, and, under section 13.2 A, `helm-note`.
- `scripts/desk/views.js`: steps in `workLines` and the build tab; "with the director"; "ready for you to steer".
- The intake: the "Watch:" line in its confirming message.
- The front desk skill: the watch, helm and hand-back phrases; `/wheelhouse:logbook watch <work>`.
- Hooks: the `SessionEnd` hand-back; the decision-log line at the helm.
- Under section 13.2 A only: `scripts/decisions/answer.js` and `scripts/hooks/prompt-record.js` gain the helm case, and decision records gain `where: 'helm'` beside `where: 'chat'`.
- The main design's safety section gains section 8's ten rules. `engineRoom` goes with Archon in core cut part 4, as the core cut says.
- `docs/data.md`: the watch pages, the hold file and the helm note.

## 13. Decisions for the director

### 13.1 Decided on 8 November 2026

- **How the level is chosen:** by the director for each piece as they start it, with a project setting as the default; no defaults by kind of work. The default, the designer's call as asked, is `steps` (section 6.1).
- **Steering:** from this computer only. Remote Control already gives remote access to a running interactive session, which covers the phone for a start; nothing is built for it (section 9.3).

### 13.2 Talking to worker sessions directly

The director, in their own words: "whether i should talk to worker sessions directly - it is a freedom i think shouldnt be taken away but it kind of bypasses the first mate."

```
Decision needed: should you talk to worker sessions directly?   (holds up: the helm's build)
Why now: the helm lets you talk to a piece's own session; what you say there goes round the First Mate unless it's recorded.

A. Yes, and it's recorded so the First Mate isn't blind (recommended). At the helm you steer the build,
   make calls and answer that piece's own decisions. On hand-back the piece writes a short note of what
   you said, which the First Mate reads; a call you make there becomes a decision record, and an answer
   by number to its own waiting decision is recorded as yours, both marked "at the helm".
   Cost: medium, the note is small; the answer path needs one narrow exception in #400's guard.
   Undo: a setting turns helm answers off and leaves you at B; answers already recorded stay.
B. Yes, to steer the build only. Decisions are still answered at the First Mate; if you answer one at the
   helm, the piece points you there. The hand-back note is still written.
   Cost: small. Undo: move to A later without rework.
C. No. You steer only through the First Mate: it records what you want changed and wakes the piece with
   your words. No helm at all.
   Cost: the smallest; saves about a third of this build. Undo: add the helm later.
Recommended because: you said the freedom shouldn't be taken away, so C is out; and B makes you
repeat yourself at the First Mate for a decision you have just settled with the piece that asked it.
A keeps the freedom and gives the First Mate the same record it would have had: every call and
answer is in the decision record, and the note says what changed. Taking the helm is a deliberate
act on one named session, not a stray reply in some other window, so it isn't the clash #400 guards.

Meanwhile: the steps, the page and the helm itself are built first; only the answer path waits on this.
Reply A, B, C, "why", or your own words.
```

**How option A works.**

- **The helm note.** The hand-back wake asks the piece, first, to write a short note of what the director said at the helm: what they asked it to change, and any call they made, in at most five lines in its own words. It is a `helm-note` record, written through the helper as the piece's other records are. The First Mate reads it at its next turn with the board's other news ("While you had the helm of login-retry: …") and treats it as data, as any record. If the piece never writes it, the Logbook says "no note from the helm" and the decision-log line still stands. *Designer's call.*
- **Calls made at the helm.** When the director makes a director-level call there ("keep the old login page for now"), the piece records it as a decision, asked and answered at once, with `where: 'helm'` and the director's words. It appears in the decision record like any other, so the First Mate and the director's later reading see it.
- **Answers at the helm.** A reply in the helm session answers a decision only when all of these hold: it is that piece's own waiting decision; the reply names its number ("decision 2: B"), so a bare letter never counts; the session is the one the hold file names; and a person typed it (Claude Code's entrypoint is not a script's). The `UserPromptSubmit` hook (`scripts/hooks/prompt-record.js`) records it, as it records a typed reply at the front desk, with `where: 'helm'`, so the words are the director's own and never the piece's summary of them. *Designer's call.*

**Agreement with #400.** Checked against `docs/specs/2026-11-08-one-first-mate-design.md` on `design/one-first-mate`:

- **The roles don't change.** A helm session keeps the `feature` role: it is judged `feature` before the seat is (#400's order: `why`, `foreman`, `feature`, then the seat), so it is never `aside` or `front-desk`, and never takes or contests the seat. #400 leaves feature sessions out of its scope because they "already have one owner each"; the hold file is how the helm keeps that true.
- **One exception to one guard.** #400's `recordAnswer` records only when the session is front-desk, not started by a script, and named by the seat. Option A adds one alternative, not a loosening: the session is the one a hold file names, and the decision belongs to that hold's piece. The script check splits in two: the entrypoint test still applies (a person must be typing), while the starter-variable test is replaced by the hold file, because the helm command sets the piece's `WHEELHOUSE_ROLE` so its hooks run as a feature session's.
- **F3 stays closed.** #400's most serious clash is a stray reply in a session that isn't Wheelhouse's being recorded as a decision. A helm answer needs a hold file naming that exact session id, which only the director's "take the helm" creates, and a numbered reply to that piece's own decision. A desktop worktree on a `feature/` branch, which #400 notes is mistaken for a Crew session, has no hold file, so it can't answer anything. #400's follow-up on `featureSlug` makes that stronger and isn't needed for this.
- **One decision, one answer.** Decision numbers are stable, and a second answer to one already given meets "already answered", whether it came from the chat or the helm, so the First Mate and the helm can't both decide it.
- **The 6.1 gap is no wider.** Typed replies are guarded because a script could type into the First Mate's session. While a piece is held, no script sends it a prompt (every start and wake asks `helmHeld`), so the helm session's only prompts are the director's.
- **Order of building.** The helm answer path builds after #400's seat, as an exception to its guard; until #400 lands, the helm is built at B's behaviour and A's answer path follows.

Under B, the answer path and the `recordAnswer` exception aren't built; the helm note and decision records for calls made at the helm still are. Under C, sections 8.2 and 9 aren't built; the First Mate records a `steer` request with the director's words and wakes the piece with them.

## 14. Left to the builder

- The step verbs and how a subagent's role is read from its transcript, within section 7.
- The page's layout and its size cap; how masking finds keys and tokens.
- The intake's exact "Watch:" line and the phrases it understands, within section 6.2.
- How the helm command finds the plugin root, and how it looks on Windows (`cmd.exe`).
- How "hand back" learns the director's process has gone when they left without `SessionEnd` running (a killed terminal): a pid the helm command records, checked as the waker checks its own.
- Whether `--follow` polls or watches the file.
- The helm note's wording, within five lines.
- A probe, before the helm ships, that `claude --resume <id>` and `claude --session-id <id> "<prompt>"`, interactive, keep the grants and mode the adapter passes, and that the hooks see a terminal entrypoint there.

## 15. A rough order for the build

Nothing here waits for core cut part 4: the own engine is the only engine since part 3B, so the Archon branch simply isn't built.

1. **The foreman's session id** and `scripts/crew/runs.js`'s reader, with section 8.1's rules as tests.
2. **`watchCrew`** in the catalogue, the `watch` event and the intake's "Watch:" line.
3. **Steps** in the Logbook.
4. **The transcript page** and `--follow`.
5. **The helm**, taken later and from the start: the hold, the open command, the hand-back, the watcher's skips, the helm note, and section 8.2's rules as tests (unless section 13.2 is C).
6. **Answers at the helm** (section 13.2 A only), after #400's seat has landed.

Parts 3 and 4 touch separate files and can run side by side.
