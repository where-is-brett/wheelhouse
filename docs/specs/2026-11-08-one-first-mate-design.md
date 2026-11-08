<!-- docs/specs/2026-11-08-one-first-mate-design.md -->

# One First Mate per project: design (8 November 2026)

**Status:** decided. The director answered the three calls in section 5 on 8 November 2026 (1A, 2A, and 3A with an amendment), so no calls are open. Nothing is built. It builds on the core cut (`docs/specs/2026-11-07-core-cut-design.md`) and the way of working (`docs/specs/2026-11-07-director-way-of-working-design.md`), and changes neither. It agrees with the crew visibility design (`docs/specs/2026-11-08-crew-visibility-design.md`), whose helm sessions are feature sessions (section 6.7).

## 1. In plain words

The director opened two Claude Code sessions in one project on one computer, and they clashed. Wheelhouse guards against two **computers** running the work (the lock and the Take over here card, main design section 9), but not against two **sessions on the same computer**. Today any ordinary session opened in the project folder becomes a First Mate, so two windows means two First Mates, each sure it is the director's only voice.

This design makes the First Mate a seat that one session holds at a time. The session holding it is the First Mate. Any other session in the project is told, in its first lines, that the First Mate is in another window, and becomes an ordinary **aside** session that leaves Wheelhouse's work alone, with an offer to take the seat over. A session that crashed gives the seat up on its own. A session in a worktree never takes the seat, and `/wheelhouse:aside` keeps a main-folder session out of it.

Edits belong in a worktree. An aside session in the project's **main folder** can read, talk and look things up, but can't edit the product's files, as a front desk can't today: its edits would be invisible to the crew's file-overlap waits, and uncommitted changes in the main folder can tangle with the First Mate's checkout. An aside session in a **worktree** edits freely on its own branch, and when that branch touches files a live crew piece is changing, Wheelhouse warns the director before the two collide (section 6.6).

## 2. How two First Mates clash today

Traced on main at `4591aa04`.

**Why both become First Mates.** `sessionRole` (`scripts/lib/role.js`) answers `why`, `foreman`, a recorded role, `foreman` for the foreman's wake line, or `feature` for a `feature/<slug>` branch. Everything else is `front-desk`. The session start (`scripts/hooks/session-start.js`) then gives every such session `FRONT_DESK_LINE` ("This is the First Mate. Load wheelhouse:front-desk…"), and each one keeps the cross-computer lock: `keepLock` touches it, and the touch succeeds for both, because the lock is keyed by `computerId()` and both sessions share that id. So the cross-computer guard sees one computer and lets both through. Nothing records which session is the First Mate.

The record itself doesn't tear: every write goes through the one host helper per computer, so events are serialised. The clashes are in meaning, not bytes:

| # | What happens | Where | Effect on the director |
|---|---|---|---|
| F1 | **Cards split or show twice.** `cards` picks up to four waiting cards and then marks them asked (`markAsked`). A second window's `cards` skips cards marked asked, so the queue is split between windows. Two `cards` calls close together both pick the same card before either mark lands, so it's shown twice. | `scripts/frontdesk/cli.js` `cards`, `markAsked` | The director sees half the queue in each window, or the same card in both (the problem the one-card design set out to stop). |
| F2 | **Decisions answered in the "wrong" window.** Both sessions are front-desk and neither was started by a script, so `recordAnswer` records a typed reply from either. Numbers are stable (`scripts/decisions/pending.js`), so a reply never lands on a different decision, but window A goes on discussing a decision the director settled in window B, and a second answer meets "already answered". | `scripts/decisions/answer.js` | Confusing turns. No wrong answer is recorded. |
| F3 | **Stray replies from sessions that aren't Wheelhouse.** A research or design session in the folder is front-desk too. If the director types "B" there, answering that session's own question, and decision B is waiting, it's recorded as the director's answer to the decision. | `answer.js`, `role.js` | A real decision decided by accident. **The most serious one.** |
| F4 | **Double intake.** Each window runs intake on its own conversation. `similar` (`scripts/intake/similar.js`) only sees work already recorded, so one request typed into both windows, or two overlapping requests close together, become two pieces of work. | intake, `record work` | Two builds of one thing, or two that edit the same files and conflict at merge. |
| F5 | **Contradicting records.** Rulings, settings, briefs, amendments, pull-backs and drops come from two conversations that can't see each other's context. A amends w-12 while B drops it. B signs the brief from the version it read an hour ago, which overwrites A's change in between. | `cli.js` `record`, `pullBack`, `drop`, `writeSetting` | Lost updates and rulings that cancel each other, all signed as the director's. |
| F6 | **One shared input file.** A front desk with no scratchpad writes its command's JSON to `.wheelhouse/front-desk.json`, a single file per project. Two writing at once can leave one session's input under the other's command. | `scripts/lib/front-desk.js` `FRONT_DESK_INPUT` | A record built from the other window's input. Rare, since app sessions have a scratchpad. |
| F7 | **One-value state, last writer wins.** The running model (`keepRunningModel`), the usage card and the take-over card are each given to both windows. | `session-start.js` | The board names whichever window started last. Cards shown twice. |
| F8 | **Two windows, one Bosun.** There aren't two foremen: `startWatcher` refuses while `watcherRunning` finds the project's watcher (`scripts/foreman/start.js`), so one watcher, and therefore one foreman, runs per project. But both windows send it asks (`askBosun`, forwards) that can disagree. | `scripts/foreman/` | The Bosun gets contradicting steers. |
| F9 | **Non-Wheelhouse sessions are hobbled.** A research or design session in the main folder is told to load the front-desk skill, and `front-desk-writes.js` refuses its edits to the product's files. | `scripts/hooks/front-desk-writes.js` | The director can't use the folder for anything else. |

**A related finding.** `featureSlug` (`scripts/lib/role.js`) judges a Crew session by its branch alone (`feature/<slug>`). The Claude desktop app names its own worktree branches with a configurable prefix, `feature/` on this computer (for example `feature/agitated-mendeleev-bae7e1`), so an ordinary app session in a worktree is classed as Crew and given a Crew title. Such a session is `feature`, not `aside`, so the overlap warning (section 6.6) would never run for it. Section 8 makes the fix a step of this build, before the warning.

## 3. Goals, non-goals and anti-goals

**Goals**
- At most one First Mate per project at any moment, on one computer as across computers.
- A second session knows in its first lines that it isn't the First Mate, and why, and can take the seat with one reply.
- A First Mate that crashed or was closed doesn't block the next session for long, and never needs the director to delete a file.
- Sessions that aren't Wheelhouse work can be opened in the project: in the main folder to read, talk and look things up, in a worktree to edit as well.
- A worktree session's edits never collide with a crew piece's unseen: the director is warned first.

**Non-goals**
- Several First Mates working together, for example one per topic (section 4).
- Changing the cross-computer lock or its fencing counter.
- Guarding feature sessions or the foreman, which already have one owner each. A helm session (crew visibility design, section 9) is a feature session.
- Blocking a worktree session's edits or pull request. The overlap guard warns; the director decides.

**Anti-goals** (failures even if it technically works)
- The director's only working window loses the seat while they're still using it.
- A session is silently read-only, and the director only finds out when their request goes nowhere.
- A worktree session's pull request and a crew piece's both change one file, and the director first hears of it as a conflict at merge.
- A crash leaves the project with no First Mate until something is cleaned up by hand.

## 4. One First Mate, or several?

**Exactly one per project** (the director's call 1, answered A). The First Mate exists to be the director's one voice: it holds the waiting list, numbers the decisions, keeps the rulings consistent and runs intake against everything already asked. Every failure in section 2 comes from splitting that voice. One per topic would need intake to route each request to a topic's First Mate, decisions to be numbered and shown per topic, and rulings to be scoped, which is a new design and the opposite of the way-of-working's aim of fewer things reaching the director. The director can still open as many *other* sessions as they like (section 6.5).

## 5. The director's calls (decided 8 November 2026)

Each was put in the decision shape of the way-of-working design, section 6.2, and is kept here as asked, with the answer after it.

| Call | Answer |
|---|---|
| 1. How many First Mates | **A**, exactly one per project, as recommended. |
| 2. What a second session becomes | **A**, an ordinary `aside` session with a Take over here offer, as recommended. |
| 3. How side sessions stay out of the seat | **A, amended.** Worktree sessions never take the seat, and `/wheelhouse:aside` opts out in the main folder, as recommended. On top of that: an aside session in the main folder keeps today's `front-desk-writes` refusal of product edits (it can read, talk and look things up); edits belong in a worktree session, which edits freely on its own branch; and a new guard warns the director when a worktree aside session's branch or pull request touches files a live crew piece is changing. The reason: an aside session's edits are invisible to the crew's file-overlap waits, and uncommitted edits in the main folder can tangle with the First Mate's checkout. |

The amendment changes call 2's option A in one place: a main-folder aside session doesn't "edit like any Claude Code session". Sections 6.3, 6.5 and 6.6 carry it.

---

```
Decision needed: How many First Mates may a project have at once?   (holds up: building this design)
Why now: two First Mates on one computer clash today (double intake, split cards, a decision answered from the wrong window). The fix depends on whether more than one is ever allowed.

A. Exactly one per project. Small build (a seat file and checks at about six points). Can be undone: removing the check brings today's behaviour back.
B. One per topic (for example, one for the app and one for the website). Large build: intake routing, decisions and rulings scoped per topic. Hard to undo once records are scoped.
C. Several, unguarded, with a warning line in each. Smallest build (one line). Undoable, but every clash in today's list stays.
A (recommended).
Recommended because: the First Mate is worth having because it is one voice that sees every request and decision. Two voices are what broke. You can still open other sessions for research or design; they just don't run Wheelhouse's work.

Meanwhile: nothing is built until you answer.
Reply A, B, C, "why", or your own words.
```

---

```
Decision needed: What should a second session in the project become while the First Mate is open elsewhere?   (holds up: building this design)
Why now: with one First Mate, any other session needs a defined part. Today it silently becomes a second First Mate.

A. An ordinary session (recommended). Its first lines say the First Mate is in another window and offer "Take over here". It can research, design and edit like any Claude Code session, but can't record work, answer decisions or show cards. Medium build. Undoable.
B. A read-only First Mate, as on a second computer today: it shows the Logbook and the waiting decisions, refuses everything else, and offers "Take over here". Medium build. Undoable. The folder stays unusable for other work.
C. Refused: it says to use the other window and does nothing else. Small build. Undoable. Opening a research session in the folder no longer works.
Recommended because: you open extra windows for other jobs, not to watch the Logbook twice. A lets those windows work, keeps Wheelhouse's records in one hand, and still lets you move the First Mate with one reply.

Meanwhile: nothing is built until you answer.
Reply A, B, C, "why", or your own words.
```

---

```
Decision needed: How does a session that isn't Wheelhouse work (research, design) stay out of the First Mate's seat when it's the first one open?   (holds up: building this design)
Why now: if the First Mate isn't running, the first session opened takes the seat, so a research session opened first would become the First Mate.

A. Both rules (recommended): only a session in the project's main folder can be First Mate, so one in a Claude Code worktree never is; and in the main folder, typing /wheelhouse:aside as the first message keeps a session ordinary. Small build. Undoable.
B. The command only: any session in the project may become First Mate unless /wheelhouse:aside is its first message. Small build. Undoable. Easy to forget.
C. The folder only: worktree sessions never are, main-folder sessions always are. Smallest build. Undoable. No way to open a plain session in the main folder.
Recommended because: you usually do side work in a worktree, which then just works with nothing to remember, and the command covers the rare plain session in the main folder.

Meanwhile: nothing is built until you answer.
Reply A, B, C, "why", or your own words.
```

---

Sections 6 and 7 are written for the answers: **1A, 2A and 3A as amended**. Section 9 keeps what the other options would have changed, for the record.

## 6. The design

### 6.1 The seat

A new module, `scripts/lib/first-mate-seat.js`, keeps one file per project at `<wheelhouse home>/projects/<project>/first-mate.json`:

```json
{ "session": "<Claude Code session id>", "pid": 4242, "pidStart": "2026-11-08T09:12:03Z",
  "folder": "/Users/…/project", "since": "2026-11-08T09:12:04Z", "seenAt": "2026-11-08T10:40:51Z" }
```

- **Taken** with the same exclusive-file pattern as `scripts/lib/start-lock.js`: write with `wx`, and when the file exists, judge the holder. A stale holder is replaced by rename-then-check, so two sessions starting together never both win. *Designer's call:* reuse `takeStartLock`'s rename logic, not the git lock: a remote round trip at every session start is slow, needs the network and adds nothing on one computer.
- **Written by the hooks**, which run outside the session's sandbox (as `markManaged` writes the home today), not through the helper, so a session can tell whether it's the First Mate while the helper is down.
- **Kept fresh**: every hook that runs for the holder (SessionStart, UserPromptSubmit, Stop, and the front-desk-writes PreToolUse check) rewrites `seenAt`, at most once a minute.
- **Given up** by the holder's SessionEnd hook (`stop-guard.js` already runs on SessionEnd), which removes the file only while it still names that session.

**How it sits with the cross-computer lock.** The git lock says which **computer** runs the work. The seat says which **session** on that computer is the First Mate. A session only takes the seat when its computer holds or can take the lock (`keepLock` returns null). A session on a computer that doesn't hold the lock gets today's Take over here card for the computer, unchanged, and takes the seat only once the director takes over. The take-over card's words (`TAKEOVER_LABEL`, `composeCard` kind `take-over`) are reused for the seat's own offer, with "window" in place of "computer".

### 6.2 Liveness and stale seats

A seat is **free** when any of these holds:
1. No file, or the file can't be read or isn't whole (it's taken over, as a broken lock is in `checkLock`, never trusted).
2. The holder's process is gone. At claim, the hook records the nearest ancestor process that is Claude Code (read from the process table, as `scripts/engine/stop.js` already does), with its start time. It's gone when that pid isn't running, or is running with another start time (a reused pid, judged as `stopWatcher` judges one).
3. No pid could be recorded, and `seenAt` is older than `STALE_AFTER_MS` (two hours, as for the git lock).

Otherwise the seat is **held**. A held seat counts as **in use** when `seenAt` is within 30 minutes (`RECENT_MS`, as for the computer card). That only changes which option the offer recommends (section 6.3). A seat is never taken from a session that is still running unless the director says so.

After a crash, case 2 frees the seat at the next session start. With no pid, case 3 frees it within two hours, and the director can take it at once with the offer. Nothing is ever deleted by hand.

### 6.3 What each session is told at its start

`sessionRole` gains a fifth role, **`aside`**: a session in the project that isn't the First Mate, the foreman, a feature or a why copy. The order of judging becomes: `why`, `foreman` (environment, recorded, wake line), `feature` (a helm session included, section 6.7), then the **seat**:

- A session in a linked worktree that isn't a Wheelhouse feature → `aside` (call 3A). Recorded once, like any role. "Isn't a Wheelhouse feature" needs the `featureSlug` fix in section 8, which builds first.
- A session whose first prompt is `/wheelhouse:aside` → `aside`, recorded.
- Otherwise the session start tries the seat. Taken or already held by this session → `front-desk`. Held by another live session → `aside`.

`aside` is **not** recorded at the session start when it came from a held seat. It is worked out again at each hook, so a session that takes over, or whose holder ends, becomes the First Mate without restarting.

The session start gives an aside session, in place of `FRONT_DESK_LINE`:

> This session isn't the First Mate: it is in another window, last active 4 minutes ago. Work here as an ordinary session, and leave Wheelhouse's records to the First Mate. If the director asks for Wheelhouse work (a request to build, a decision, a card), say the First Mate is in another window, and offer this card…

…followed by a take-over card for the seat (kind `take-over`, target `{ session, since }`), recommending **Leave it there** when the seat is in use and **Take over here** when it isn't.

What follows the first sentence depends on where the session is:

- **In the main folder** (a held seat or `/wheelhouse:aside`), the line adds: "Here you can read, talk and look things up, but not edit the product's files. For edits, start a session in a worktree." The command-made aside gets no card; the seat-made one gets the card above.
- **In a worktree**, the line adds: "Edit freely on this branch. If it touches files a crew piece is changing, you'll be told." No card: a worktree session can't take the seat.

Only the First Mate gets the usage card, the take-over card for another computer, the running-model write (F7) and the setup notes for the front desk.

### 6.4 Taking over

The director's **Take over here** in an aside session is recorded by the prompt hook as a click, as today. The hook then rewrites the seat to name this session, but only while it still names the holder and `since` the card showed (the same fencing `takeLock`'s `over` does), so a stale card can't take a seat that has since changed hands. The next hook in the old window finds it is no longer the holder. It gets one line, "The First Mate moved to another window; this session is now an ordinary one", and is `aside` from then on. A turn the old window is in the middle of finishes, but any Wheelhouse write it then tries is refused (section 6.5).

### 6.5 What the seat guards

The seat is checked where a First Mate acts, so an aside session's attempt is refused with a line saying why, not left unguarded:

| Point | Today | With the seat |
|---|---|---|
| `recordAnswer` (`scripts/decisions/answer.js`) | front-desk, not script-started | also: the seat names this session. Closes F2 and F3. The crew visibility design adds one alternative for a helm session (section 6.7). |
| Card clicks and reply codes (`prompt-record.js`) | any front-desk session | only the holder's. A click in an aside window is refused with the take-over line. |
| `cli.js` writes: `cards`, `pull-cards`, `again`, `card`, `record`, `confirm`, `suggest`, `pull-back`, `drop`, `ask-bosun`, settings | any caller | the CLI reads `CLAUDE_CODE_SESSION_ID` (as `note` and `--here` already do) and refuses unless that session holds the seat. Closes F1, F4, F5, F8. With no session id (a script or test), today's behaviour. |
| `cli.js` reads: `view`, `decision list`/`show`, `explain`, `similar`, `why` | any | unchanged, so an aside session can look things up. |
| `front-desk-writes.js` | refuses product writes for every front-desk session | refuses them for the holder **and for every aside session in the main folder** (call 3, amended), with a line that says to start a session in a worktree for edits. An aside session in a worktree isn't refused: it edits on its own branch, and its changes reach main through the director's own pull request, which Wheelhouse already treats as by-hand work. F9 is closed for reading, talking and looking things up in the main folder, and for edits in a worktree. |
| A worktree aside session's turn ending (Stop) | nothing | the overlap check (section 6.6): a warning when its branch, or its uncommitted changes, touch files a live crew piece is changing. It never blocks. |
| `board-context.js`, `card-check.js` Stop check | every front-desk session | holder only. |
| `.wheelhouse/front-desk.json` | one per project | unchanged: with one First Mate it has one writer (F6). |

Protections that apply to every session stay as they are for aside sessions: STOP, the lineage hold, protected tests and the merge gate.

### 6.6 The overlap warning

**Why.** The crew waits for file overlaps among its own pieces: the dispatcher (`scripts/engine/dispatcher.js`) holds a piece whose files clash with a running one, using `clashCheck` (`scripts/foreman/queue.js`). A worktree aside session isn't a piece, so its branch is invisible to that wait. Left alone, the director first hears of the clash as a conflict at merge.

**Where.** *Designer's call:* the aside session's **Stop** hook, as a new script `scripts/hooks/aside-overlap.js` beside `card-check.js` and `feature-status.js` in `hooks/hooks.json`. It's the cheapest sound point: Stop runs after every turn, so the warning comes in the turn that made the overlap, before any pull request exists, and it also covers the turn that opens one (the turn's `gh pr create` ends in a Stop like any other). A PreToolUse check on `gh pr create` alone was considered and rejected: it warns only at the end, after the work is done, and misses a pull request opened another way (the app's button, the web). A check at the helper's PR watch was rejected too: it sees only pushed branches, so it warns later still.

**What it does**, only in a worktree session whose role is `aside` (never in the First Mate, a main-folder aside, the foreman, a feature or a helm session, or a why copy):

1. **The aside's files:** the files its branch changes since it left main (`git diff --name-only` against the merge base with the project's main branch), plus its uncommitted and untracked files (`git status --porcelain`). Capped, as other hooks cap what they read.
2. **The crew's files:** the same set the dispatcher passes to `clashCheck` as `running`: each live and waiting piece with its planned files, and each reservation whose work hasn't ended. Read through the desk, as `board-context.js` reads the board. *Designer's call:* lift the dispatcher's `running` list into one function both use, so the two can't drift.
3. **The check:** `clashCheck({ files, running, hotFiles })` with the project's `hotFiles` setting, so two new migrations count as a clash here as they do for the crew.
4. **The warning,** when there's a clash it hasn't already warned of: a `systemMessage`, which Claude Code shows the director in that window, naming each piece and file, for example:

   > Heads up: this branch changes `src/login.ts`, which the crew piece login-retry is also changing. Merging both will conflict. You could wait for login-retry to merge and then bring this branch up to date, or ask the First Mate to hold it.

   It also asks the session (Stop's `decision: block` with the same words as `reason`, once per new clash) to say so in its reply, so the warning sits in the conversation and not only in the app's banner. *Designer's call:* the block is used only for the first warning of each clash, so a turn is never held twice for the same overlap.
5. **Once per clash:** the pairs (piece, file) it has warned of are kept in a small file under the session's own `.wheelhouse` in the worktree, so it warns again only for a new piece or a new file. A piece that ends drops out of `running` and so out of the warning.
6. **The First Mate hears of it** through one record, `aside-overlap` (`{ branch, pieces, files, at }`), written through the helper like any record, so the board shows "a side branch overlaps login-retry" and the First Mate can raise it if the director asks how a piece is going. *Designer's call:* a record and not a card, because the director has already been told in the window that made the overlap; a card would tell them twice.

**What it never does:** block an edit or a pull request, change the crew's plan, or hold a piece. The director decides.

**When it can't tell:** with the helper down and the desk unreadable, or git failing, it says nothing and lets the turn end (it informs, as `board-context.js` does). The next Stop tries again.

### 6.7 Agreement with the crew visibility design

The crew visibility design (`docs/specs/2026-11-08-crew-visibility-design.md`, merged on main) lets the director talk to a running piece's own session, "taking the helm", and records what they decide there with `where: 'helm'`. The two designs agree:

- **A helm session is `feature`,** judged before the seat (this design's order: `why`, `foreman`, `feature`, then the seat). It is never `aside` or `front-desk`, never takes or contests the seat, and never gets the aside line, the take-over card or the overlap warning. It is the crew piece itself, so its files are already in the crew's `running` list.
- **`recordAnswer` keeps one alternative to the seat** for the helm: a reply records when the session is the one a helm hold file names, the decision is that hold's piece's own, the reply names the decision's number, and a person typed it (crew visibility, section 9.4). Every other non-holder reply is refused as section 6.5 says. F3 stays closed, because only the director's "take the helm" makes a hold file.
- **The order of building** follows that design: the seat lands first; the helm's answer path is added after it as that one alternative.
- **The `featureSlug` fix** (section 8) narrows `feature` to worktrees Wheelhouse made. A helm session runs in its piece's own worktree, which Wheelhouse made, so it stays `feature`.

### 6.8 Failure cases the builder must cover

1. Two sessions start within milliseconds: exactly one holds the seat. The other is aside and gets the offer.
2. The holder's process is killed (no SessionEnd): the next session takes the seat at once (pid gone).
3. The pid is reused by another process: judged gone by its start time.
4. No pid can be found (a platform or permission gap): the seat frees after two hours of no `seenAt`, and the offer recommends Take over here after 30 minutes.
5. The seat file is corrupt, empty or half written: taken over, never trusted.
6. A stale take-over card (the seat changed hands since it was shown) is refused with the current holder named.
7. Compaction and resume keep the session id and so keep the seat. A `--fork-session` copy has a new id and is aside, and a why copy stays `why`.
8. The holder's computer loses the git lock to another computer: the seat stays, but `keepLock`'s refusal stands, so it can't merge or push (unchanged behaviour). On the next start it gets the computer card first.
9. The helper is down: the seat still works (hooks write it). Writes are refused by the helper as today.
10. Headless sessions with no `CLAUDE_CODE_SESSION_ID`, and script-started sessions (`startedByScript`), never take the seat.
11. An aside session's typed "B" while decision B waits: nothing is recorded, and the note says the First Mate is in another window.
12. Git-alone projects (`host: 'local'`, no lock branch): the seat works the same, since it doesn't depend on the lock branch.
13. A main-folder aside session tries to edit a product file: refused, with the line to start a worktree session. The same edit in a worktree aside session goes through.
14. A worktree aside session's turn changes a file a live crew piece plans to change: the director is warned once, a record is written, nothing is blocked. The next turn, with no new clash, says nothing.
15. The overlap comes only from an uncommitted or untracked file: still warned.
16. The overlap is through `hotFiles` (two new migrations, no shared file): warned, as the crew would hold.
17. The crew piece ends (merged or closed): it drops out, and no warning follows.
18. A new piece starts that clashes with files the aside branch already changed: warned at the aside session's next Stop. *Designer's call:* the warning follows the aside's turns; a piece started while the aside window is idle is caught when the director next uses that window, and the dispatcher never sees aside branches either way.
19. The desk can't be read, or git fails: no warning, no error, the turn ends.
20. A desktop worktree on a `feature/…` branch that Wheelhouse didn't make: `aside`, not `feature` (after the `featureSlug` fix), so it gets the warning.
21. A helm session: `feature`, never `aside`; no aside line, no warning, and its numbered answers to its own piece's decisions record as the crew visibility design says.

## 7. Tests

**Extend**
- `tests/scripts/lib/role.test.js`: the `aside` role from a worktree, the command and a held seat; a seat-derived `aside` isn't recorded; the order with `why`, `foreman` and `feature`; a helm session stays `feature` (case 21); a `feature/…` branch Wheelhouse didn't make is `aside` (case 20).
- `tests/scripts/lib/start-lock.test.js`: if the rename logic is lifted into a shared helper, its existing cases run against both users.
- `tests/scripts/hooks/session-start.test.js`: the second session gets the aside line and the seat's take-over card, not `FRONT_DESK_LINE`, the usage card or the model write; the recommendation flips at 30 minutes; the computer card still comes first when another computer holds the lock; a main-folder aside's line says it can't edit and points to a worktree; a worktree session gets the worktree line and no card.
- `tests/scripts/hooks/prompt-record-reply.test.js`: a typed reply in an aside session records nothing and says why (cases 11, 2); the holder's reply records as today; a numbered reply in a helm session still records with `where: 'helm'` once that path is built (case 21).
- `tests/scripts/hooks/prompt-record.test.js`: a card click in an aside window is refused; Take over here moves the seat and is fenced (case 6).
- `tests/scripts/frontdesk/cli.test.js`: every write command refuses for a non-holder session id and works for the holder; reads work for both; no session id keeps today's behaviour.
- `tests/scripts/hooks/front-desk-writes.test.js`: product writes are refused for the holder and for a main-folder aside session (with the worktree line), and allowed for a worktree aside session (case 13).
- `tests/scripts/engine/dispatcher.test.js`: the lifted `running` list gives the dispatcher the same holds as before.
- `tests/scripts/hooks/board-context.test.js` and `card-check-shown.test.js`: holder only.
- `tests/e2e/front-desk.test.js`: two sessions in one project, end to end. One records work, the other's `record work` is refused, Take over here moves the seat, and the first session's next write is refused.

**New**
- `tests/scripts/lib/first-mate-seat.test.js`: cases 1–6 and 12 against a temporary home, with the process table and clock passed in, as `start.js`'s `alive` and `now` are.
- `tests/scripts/hooks/aside-overlap.test.js`: cases 14–19 against a temporary git repository with a branch and a desk stub: a shared committed file, an uncommitted one, an untracked one, a `hotFiles` match, no clash, an ended piece, a second Stop with nothing new (silent), a new piece (warned), the desk or git failing (silent); the `aside-overlap` record's shape; that it does nothing for the holder, a main-folder aside, a feature, a helm session and a why copy.
- `tests/e2e/front-desk.test.js` gains a worktree aside session whose branch edits a file a recorded piece plans to change: the warning appears once and the board shows the overlap.

## 8. The `featureSlug` fix, and follow-ups

**Built first, as part of this design.** `featureSlug` (`scripts/lib/role.js`) also checks that the worktree is one Wheelhouse made for a piece: its `.wheelhouse/feature` folder and brief are there and name the branch's piece, as `feature-status.js` already checks before it acts. A desktop worktree on a `feature/…` branch then reads as `aside`, which the worktree rule (call 3) and the overlap warning (section 6.6) both depend on. *Designer's call:* reuse `feature-status.js`'s check rather than ask the desk, so the role is known with the helper down.

**Follow-ups, outside this design**
- Showing the First Mate's window on the board and in the mod's pane ("First Mate: the session started 09:12").
- Feeding aside branches into the dispatcher's clash wait, so the crew holds a new piece that would collide with a side branch. Not asked for: the director chose a warning, and an aside branch has no plan or end the dispatcher could wait on.

## 9. Under the other answers (not chosen, kept for the record)

- **1B (one per topic):** this design doesn't fit, and topic routing needs a design of its own first.
- **1C (several, warned):** only the warning line from section 6.3, with no seat.
- **2B (read-only First Mate):** as written, except `front-desk-writes.js` keeps refusing aside sessions, and the aside line says to show the Logbook and decisions and refuse other work, as the computer card's "meanwhile" does.
- **2C (refused):** the aside line says to use the other window, and the hooks refuse every tool but reading.
- **3B / 3C:** drop the command or the worktree rule from section 6.3.

## 10. Approaches considered

- **A local seat file keyed by session id, with process liveness** (chosen). It works offline, gives an instant answer at session start, and its crash recovery is exact when the pid is known.
- **Put the session id in the git lock** (`lock.json` gains `session`). One lock for both, but it adds a network round trip and a push at every session start and on take-over, and a remote write to find out who on *this* computer is the First Mate. Rejected.
- **A lease held by the host helper** (sessions register over its socket). Liveness is easy while the helper runs, but the seat would vanish whenever the helper restarts (updates restart it) and couldn't be judged while it's down. Rejected, though the helper may *read* the seat for the board.
- **A warning only** (call 1C). Cheapest, but every clash stays.

## 11. Left to the builder

The seat's exact file name and fields, the one-minute write throttle, how the ancestor process is found on Windows (a missing pid falls back to case 3), the aside line's final wording within section 6.3's meaning, and whether `takeStartLock`'s rename logic is lifted into a shared helper or reused as it is. For the overlap warning: its wording within section 6.6's meaning, the cap on files read, the name and place of the warned-pairs file, and how the main branch's name is found (the project's recorded base branch, falling back to `origin/HEAD`).
