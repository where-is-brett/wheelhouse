<!-- docs/specs/2026-11-08-crew-visibility-design.md -->

# Crew visibility: design (8 November 2026)

**Status:** draft for the director. It replaces PR #370's design (`docs/specs/2026-11-07-watch-the-crew-design.md`, on `design/watch-crew`), as the core cut's section 4.4 asked, and keeps that design's setting name, levels, script and safety rules. It builds on the core cut (`docs/specs/2026-11-07-core-cut-design.md`) and the director's way of working (`docs/specs/2026-11-07-director-way-of-working-design.md`), and changes neither. Section 13 holds the three calls that are the director's.

## 1. In plain words

Every piece of work runs out of sight today: the Bosun (the foreman) and one Crew session per piece are started headless by the watcher, and what they print is thrown away. The director sees the First Mate, the Logbook, the daily digest and alerts.

This design lets the director choose how much of the crew they see, per project and per kind of work, and change it for one piece:

- **Background** (`off`): as today.
- **Steps**: each piece's latest step, and its last few, in plain words in the Logbook ("A Lookout is reviewing task 2", "Running the tests").
- **Transcript**: on request, a readable page of a piece's whole run so far, kept on this computer and opened outside the chat.

Seeing never steers. For steering there is a separate, deliberate action, **take the helm**: the piece pauses at its next quiet point and the director opens that same session in a terminal, talks to it directly, then hands it back, and the crew carries on from there.

## 2. Why

In the director's words: "All work is done in background sessions which I have no visibility over, that might be preferable for some work, but may not be the case for other types."

The way-of-working design already wants this. The director "may not look at everything all the time" but "visibility is needed", and "They can see everything when they want to, without being pushed everything" (its section 1). Its section 9 names PR #370, re-scoped, as the step-by-step view. The core cut makes the gap wider: with only the own engine, every build is a headless session the director can't open.

## 3. Goals, non-goals and anti-goals

**Goals**

- The director can see what any piece is doing now, and what it has done, when they ask.
- They choose per project how much shows by default, by kind of work, and can change it for one piece.
- They can step in and steer one piece directly when a decision message isn't enough, and hand it back.
- Watching costs no model tokens, and nothing changes for a project that leaves the setting alone.

**Non-goals**

- A new surface. The chat stays the one surface (way of working, section 3); the pane stays parked.
- Live crew sessions for every piece. The watcher keeps one way of running sessions (section 5).
- Watching or steering from the phone by default. The phone gets alerts only (way of working, section 9). Section 13.2 asks whether to add a phone route for steering.

**Anti-goals** (failures even if everything technically works)

- A view that can send anything to a crew session, or that a crew session can tell is open.
- A transcript, or text from one, that reaches a model's context or leaves this computer.
- Steering that answers a decision or makes a director-level call outside the decision record, so the director finds it later in a diff.
- Two processes writing one session.
- A piece lost, counted as stalled, or resumed twice because the director had the helm.
- The director pinged with progress because they turned the steps on.

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
| C. Read-only views only | PR #370 as the core cut re-scopes it, with no way to steer | Simplest; but the director's "may not be the case for other types" includes work they want to shape as it goes, which a decision message can't always carry | Kept as option A of section 13.2 |

**On PR #370: build on it, close it in favour of this design.** Its setting (`watchCrew`, `off`/`steps`/`transcript`), its script (PR #370's `scripts/crew/watch.js`, named `scripts/crew/runs.js` here because `scripts/desk/watch.js`, the desk's change feed, already holds the name), the foreman's session id and its six safety rules carry over unchanged in substance. What changes is where the views are drawn (the core cut parked the pane), the Archon branch (gone, with `engineRoom`), the home of the setting (the project, not the profile, so it can differ per project and per lane), and the helm, which is new. One design is easier to build from than a design and a patch, so this one supersedes the 7 November file; PR #370 closes when this design is approved. *Designer's call.*

## 6. The setting

### 6.1 `watchCrew`, "Watch the crew"

In the advanced group, kept in the **project's** settings (`home: 'project'`), because how much the director wants to see differs by project. Levels: `off`, `steps`, `transcript`. Its value is either one level for every lane, or a level per lane:

```
watchCrew: steps                                   every lane at steps
watchCrew: { quick: off, small: off, bug: off, feature: steps }
```

A lane the map doesn't name, and a value that can't be read, count as `off`, as `typedReplies` does. The Bosun serves every lane, so it takes the highest level any lane has: with features at `steps`, its line shows. *Designer's call.* In the chat it reads as one line: "Watch the crew: features at steps, other work in the background." The default is section 13.1's call; the recommendation is the per-lane map above.

### 6.2 For one piece

The director can change it for one piece in their own words at the front desk: "show me everything on login-retry", "stop showing that one". The First Mate records a `watch` event (`{ work, level }`), which beats the project's value for that piece until it closes. The intake's message for new work says the level the piece will get when it isn't `off`, in one line, so the director can change it as they approve the work. *Designer's call.*

### 6.3 What each level shows, per role

The levels only change what the director can **pull**. Nothing is pushed: no alert, digest line or message is sent because a step happened (anti-goal).

| Role | `off` | `steps` | `transcript` |
|---|---|---|---|
| **First Mate** | The chat | The chat | The chat |
| **Bosun** | Its records, as today | One Logbook line while it runs: "The Bosun is deciding what to do about login-retry's stuck review" | As `steps`, and its run can be opened like a piece's |
| **Crew** | The Logbook's state line, as today | The state line gains the latest step ("Changing `src/login.ts`", "Waiting for its next wake"); the Logbook's build view lists the last five steps under each running piece | As `steps`, and "watch login-retry" opens the run so far (section 7.3) |
| **Crew members, Lookouts, tester** | Their results, as today | Their steps appear under their piece, named by role: "A Crew member is building task 3", "A Lookout is reviewing task 2", "The tester is trying the sign-in page" | Their runs appear in the piece's page, each under its own heading |

**Take the helm** (section 9) is not a level. It is an action on one piece, open to the director at any level, including `off`.

## 7. How the views work

### 7.1 Finding a run

- **A feature session's** id is already kept by the waker (its session record). Its transcript is found by id alone, `<id>.jsonl` anywhere under `<config folder>/projects/`, so the reader doesn't depend on how Claude Code names the folder for a worktree path.
- **The Bosun** has no id today. The waker gives each fresh foreman `--session-id <uuid>` and keeps it in the foreman's running record, as PR #370 proposed. It costs nothing.
- **Subagents** are the files under `<id>/subagents/`. Each subagent's first prompt names its kind (the Lookout's begins with the review it was asked for), and the session's own transcript records each subagent call with its agent type, which is how the reader names the role.

### 7.2 Steps

`scripts/crew/runs.js` reads the tail of each file (capped, as `readCapped` does elsewhere), parses the events and turns them into plain lines: a tool use becomes a verb on its target ("Reading `src/login.ts`", "Running the tests", "Asking a Lookout to review task 2"), and the assistant's text is cut to its first sentence. Unknown events are skipped, so a change in Claude Code's event format shows less and never breaks. The verbs go through the glossary's plain words, as the Logbook's other lines do.

The Logbook (`scripts/desk/views.js`, `workLines` and the build tab) asks the script for each running piece when the project's level, or the piece's own, is `steps` or above. It runs only when the Logbook is drawn: at `off` it never runs and no transcript is opened. Steps are kept out of the desk's change feed (`scripts/desk/watch.js`) and its snapshot, so a new step is never a change the desk reports.

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
6. **Off means off.** At `off`, nothing is read.

### 8.2 The helm

7. **Only the director takes the helm,** by their own words at the front desk. An agent may suggest it in a decision's "Meanwhile" or "why" answer; it never takes it.
8. **One writer.** The watcher starts nothing for a piece while the director holds it, and the director's session opens only once the piece's own run has ended (section 9.2). Claude Code also refuses a second process on one session, which is the backstop.
9. **The guards still hold.** The director's session is the same feature session, in the same worktree, so Wheelhouse's hooks run as in any feature session: the protected files, the build-command guards and the gate are unchanged. A permission Claude Code asks the director for there is theirs to give, as in any session of theirs.
10. **What the director says is logged, not merged silently.** The piece's decision log gets a line for the helm ("The director steered this piece from 14:02 to 14:31") and the session writes, in its own words, what it was told to change. A director-level call made at the helm still goes through the decision record (section 13.3).

## 9. Taking the helm

### 9.1 What the director does

1. At the front desk: "take the helm of login-retry" (or "let me steer login-retry").
2. The First Mate answers with when it is ready ("now", or "when its current step ends, about 10 minutes from what it's doing"), and, once ready, one command to open it, in a `bash` block the Claude app can run with one click:
   ```bash
   node <plugin root>/scripts/crew/helm.js open login-retry
   ```
   This opens the piece's own session, interactive, in the terminal: the same session id, worktree, model, permission mode and grants the waker would give it, through the adapter (a `featureHelmCall` beside `featureResumeCall`, with no `-p` and no prompt).
3. The director talks to it as to any Claude Code session. It has its whole context: its brief, plan, decisions and everything it has done.
4. To hand back, the director leaves the session (`/exit`, or closes the terminal), or says "hand back login-retry" at the front desk. Leaving is the usual signal, so a piece is never left held by a forgotten window; the next Logbook says it was handed back. *Designer's call.*

### 9.2 What the engine does

- **Taking:** the First Mate records a `helm` event (`{ work, at }`), and the helper writes a hold file in the watcher's folder (`helm/<work>.json`). `watch`, `helm` and `helm-ended` are new record kinds, registered as the others are; they are requests, not decisions, so the typed-reply and answer paths don't read them.
- **One gate, every path.** A new check, `helmHeld(project, work)`, in one module, is asked by every path that starts, wakes or moves a session or branch for a piece: the waker's start and wake sites (beside `controlHeld`, which checks the files that steer agents and is a different hold), the crash resume (`resume.js`), the routine moves (`routine.js`) and the Bosun's `act` commands (start, build, resume, pause and merge). A held piece is not started, woken, resumed, paused or merged: the director is changing its branch. Wakes queue as they do while a session runs. Records, signed reviews and the Logbook carry on as usual. *Designer's call.*
- **Waiting for the quiet point:** when a run is live, the hold waits for it to end. Runs end at each report, so this is usually minutes; it can be up to the run's 8-hour limit. The director may say "now". That is a new per-run stop, not All stop: it ends that piece's recorded process (checked by its start time, as `stateOf` checks it), clears its running record, sends its wakes again, and writes no lost marker, so the crash resume doesn't start it. The step in flight is cut off and the session keeps everything before it. *Designer's call.*
- **While held:** the piece shows "with the director since 14:02". It **keeps its building slot**, so taking the helm never raises the pace above three, as a waiting piece keeps its slot (way of working, section 6.4). The stuck check skips it, and the reliability bar records nothing for it: it is held on purpose (`scripts/watcher/reliability.js`, "stalled" counts only pieces not held on purpose). The digest lists it under what is waiting, so a long hold is seen.
- **Handing back:** a second `SessionEnd` command, beside the stop guard (`scripts/hooks/stop-guard.js`) in `hooks/hooks.json`, records `helm-ended` when the ending session's id has the `feature` role (`scripts/lib/role.js`) and a hold file names that id; "hand back" at the front desk does the same once the session's process has gone. The hold file is removed and the waker wakes the piece with one line: "The director steered you directly; your transcript has what they said. Carry on from there." The queued wakes go with it.
- **Recovery:** a watcher that restarts reads the hold file and leaves the piece alone. A reboot while held leaves the hold in place and the session on disk; the director can open it again, or hand it back. A hold with no `helm` event behind it (a file left by a crash mid-take) is removed at the watcher's start.
- **All stop** stops Wheelhouse's own starts, as today. A helm session is the director's own, so All stop leaves it running and says so in its answer.
- **"Why"** still works while held: it copies the session, which the director's session doesn't block.
- **The Bosun** can't be taken. It acts on the board for every piece, and steering it directly would go round the decision line. Subagents can't either: they live inside their piece.

### 9.3 What "visible" means on each surface

| Surface | Watching | Steering |
|---|---|---|
| **Terminal** | Steps in the chat's Logbook; the page; `runs.js --follow` | Yes: the helm command opens the session in the terminal |
| **Claude desktop app** | The same, in the chat; the page opens in the app's file pane | Yes, through the app's terminal panel (the one-click Run). Claude Code's documentation says the app's sidebar lists only sessions the app runs itself, so a crew session never appears there as a session row |
| **Phone (the Claude app)** | Nothing new: alerts say only that something waits (way of working, section 9). Transcripts stay on the computer (rule 5) | Not by default. Claude Code's Remote Control can continue a running local interactive session from the phone or claude.ai/code, while the computer stays on (Pro, Max, Team and Enterprise plans; not with an API key). Section 13.2 asks whether the helm command should open with it |

## 10. Costs

| What | Model tokens | Other cost |
|---|---|---|
| `off` | None | None |
| `steps` | Making the lines: none, a script does it. Showing them: each line is in the First Mate's context when the Logbook is shown, about 20 to 40 tokens per running piece | A capped file read per running piece when the Logbook is drawn |
| `transcript` page | None: it is written to a file; the chat gets one line | A file of the run's size in `.wheelhouse/watch/`, removed when the piece closes |
| Bosun's session id | None | None |
| Taking the helm | Each message the director sends costs about what one wake of that piece costs: the session re-reads its own context, mostly from cache, on the piece's model. On a Max plan this comes out of the same usage window as the crew | The piece is paused while held. The real cost is the director's attention, which way-of-working section 1 names as the limit |

**The pace limit of three is unchanged.** Watching starts nothing. A held piece counts as one of the three, so steering never adds a fourth session, and the director's own session is the piece's session, not an extra one.

## 11. Fit with the way of working

- **Pull, not push.** The levels change only what the Logbook and the page show. The digest and alerts are unchanged (its section 9).
- **The decision line stands.** Steering is how the director shapes a piece as it goes; it is not how they answer decisions. Decisions keep their shape (its section 6.2) and their one place to be answered (section 13.3).
- **"Why" and the helm differ.** "Why" asks a read-only copy and never changes the work (its section 6.3). The helm is the one route by which the director's words reach a running piece directly, and it is logged (rule 10).
- **Waiting doesn't stop the work** (its section 6.4). Taking the helm does stop that one piece, by the director's own choice, and the others go on.
- **The phone limit.** Nothing here sends content to the phone. Steering from the phone is section 13.2's option C, opt-in.
- **Typed replies** (its section 6.1): the helm session is a feature session, not the front desk, so typed replies never count there today. Section 13.3 asks whether that should stay so.

## 12. What changes

- `scripts/settings/catalogue.js`: `watchCrew: { label: 'Watch the crew', group: 'advanced', levels: ['off', 'steps', 'transcript'], default: <section 13.1>, home: 'project', byLane: true }`. The catalogue learns a per-lane value, read through one helper that gives the level for a piece (its own `watch` event, else its lane's, else `off`). The main design's settings list gains it.
- `scripts/crew/runs.js` (new): finds, reads and summarises a run and its subagents; writes the page; `--follow`.
- `scripts/crew/helm.js` (new): takes, opens and hands back; the hold file.
- `adapters/claude-code/sessions.js`: `featureHelmCall`, the interactive call.
- `scripts/watcher/waker.js`: the foreman's `--session-id`; `helmHeld` at each start and wake site; the per-run stop for "now"; the hand-back wake. `scripts/watcher/resume.js`, `routine.js` (its moves and stuck check), `reliability.js` and the Bosun's `act` commands ask `helmHeld` too.
- The state layer: the `watch`, `helm` and `helm-ended` record kinds.
- `scripts/desk/views.js`: steps in `workLines` and the build tab; "with the director".
- The front desk skill: the watch, helm and hand-back phrases; `/wheelhouse:logbook watch <work>`.
- Hooks: the `SessionEnd` hand-back; the decision-log line at the helm.
- The main design's safety section gains section 8's ten rules. `engineRoom` goes with Archon in core cut part 4, as the core cut says.
- `docs/data.md`: the watch pages and the hold file.

## 13. Decisions for the director

### 13.1

```
Decision needed: how much of the crew shows by default in each project?   (holds up: the setting's default)
Why now: the default decides what every project you don't touch looks like.

A. Everything in the background, as today. No cost. Undo: change the setting.
B. Quick, small and bug work in the background; features at steps (recommended).
   About 20-40 tokens per running feature each time you open the Logbook. Undo: change the setting.
C. As B, but features at transcript. Same tokens as B; a page file per feature on disk. Undo: change the setting.
D. As B, and the intake asks for each new feature whether you want to steer it yourself.
   One more question per feature. Undo: change the setting.
Recommended because: features are where you'd want to glance at what's happening; quick
work is over before a step would tell you anything. The full page is one request away at B,
and D adds a question to every feature, which is the pinging you asked to avoid.

Meanwhile: nothing waits on this; the design is written for B.
Reply A, B, C, D, "why", or your own words.
```

### 13.2

```
Decision needed: should you be able to step in and steer a piece directly?   (holds up: building the helm)
Why now: watching is safe by design; steering is the one route that changes a running piece.

A. No: watch only, and change course through decisions and new requests. Saves about a third of this build.
   Undo: add the helm later.
B. Yes, from this computer: "take the helm" pauses the piece and opens it in a terminal (recommended).
   The piece pauses while you hold it; each message costs about one wake. Undo: a setting turns it off.
C. As B, and the helm also opens with Remote Control, so you can steer from the phone or claude.ai.
   Needs the computer on and a Pro, Max, Team or Enterprise plan. Undo: a setting turns it off.
Recommended because: some work is easier to shape by talking to it than by answering
decisions, and a paused handover keeps one writer and the crew's records intact. Steering
from the phone invites checking in on progress, which your way of working keeps off the phone;
it is one switch to add once B has proved itself.

Meanwhile: the steps and the page are built first; they don't depend on this.
Reply A, B, C, "why", or your own words.
```

### 13.3

```
Decision needed: can what you say at the helm answer a decision that piece is waiting on?   (holds up: the helm's build)
Why now: at the helm you'll talk to the piece that asked; answering there would feel natural.

A. No: decisions are answered at the front desk only. If you answer at the helm, the piece
   says "please answer decision 2 at the front desk" (recommended). Nothing to build. Undo: choose B later.
B. Yes: a reply at the helm is recorded as your answer, as a typed reply at the front desk is.
   A second place where your words are signed as decisions. Undo: a setting turns it off.
Recommended because: one place to answer keeps "one decision, one answer" simple and keeps
every decision in the record you read later. The typed-reply safeguards were designed for the
front desk; extending them to crew sessions widens the gap they close.

Meanwhile: built as A; B can follow without rework.
Reply A, B, "why", or your own words.
```

## 14. Left to the builder

- The step verbs and how a subagent's role is read from its transcript, within section 7.
- The page's layout and its size cap; how masking finds keys and tokens.
- How the helm command finds the plugin root, and how it looks on Windows (`cmd.exe`).
- How "hand back" learns the director's process has gone when they left without `SessionEnd` running (a killed terminal): a pid the helm command records, checked as the waker checks its own.
- Whether `--follow` polls or watches the file.
- A probe, before the helm ships, that `claude --resume <id>` interactive keeps the grants and mode the adapter passes.

## 15. A rough order for the build

Nothing here waits for core cut part 4: the own engine is the only engine since part 3B, so the Archon branch simply isn't built.

1. **The foreman's session id** and `scripts/crew/runs.js`'s reader, with section 8.1's rules as tests.
2. **`watchCrew`** in the catalogue, per lane and per piece.
3. **Steps** in the Logbook.
4. **The transcript page** and `--follow`.
5. **The helm** (if section 13.2 is B or C): the hold, the open command, the hand-back, the watcher's skips, and section 8.2's rules as tests.

Parts 3 and 4 touch separate files and can run side by side.
