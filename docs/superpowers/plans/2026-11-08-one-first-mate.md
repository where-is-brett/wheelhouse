<!-- docs/superpowers/plans/2026-11-08-one-first-mate.md -->
# One First Mate per project: build plan (8 November 2026)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task's implementer reads the spec sections the task names; the spec decides wording and behaviour, this plan decides files, names and tests.

**Goal:** One project, one First Mate: the first ordinary session in a project takes a per-project seat and is the First Mate; every other ordinary session is an `aside` session that can read and talk but never records for the director, and a worktree aside session is warned when its branch overlaps the crew's files.

**Architecture:** A new module, `scripts/lib/first-mate-seat.js`, keeps one seat file per project and judges whether its holder is still alive. `scripts/lib/role.js` gains a fifth role, `aside`, judged after `why`, `foreman` and `feature`. The hooks (session start, prompt, Stop, SessionEnd, the write guard) and the front desk's command take, refresh, hand over and release the seat, and refuse First Mate writes from any session that doesn't hold it. A new Stop hook, `scripts/hooks/aside-overlap.js`, checks a worktree aside branch against the dispatcher's `running` list with `clashCheck`.

**Tech Stack:** Node.js ES modules, `node --test`, Claude Code hooks (`hooks/hooks.json`).

**Spec:** `docs/specs/2026-11-08-one-first-mate-design.md` (approved, the director's calls in section 5: 1A, 2A and 3A as amended). Read with it: `docs/specs/2026-11-08-crew-visibility-design.md`, built at the same time.

## Global Constraints

- One branch and one pull request per part (Parts below), base `main`. Stack a part on another only where it needs it. Merge `origin/main` into the branch before opening its pull request. Never merge a pull request.
- No AI attribution anywhere: no `Co-Authored-By`, no "Generated with", no model names, no session links, in commits, pull requests, code or documents.
- British or Australian English. Dates as day month year. The director is "the director", they/them.
- Every file starts with a comment giving its repository-relative path (JSON exempt).
- No words such as "enhanced", "improved" or "fixed" in names, comments or user-facing text.
- Scripts and hooks in Node.js only, so they run on macOS and Windows.
- Run only the test files a task touches (`node --test <files>`); CI runs the whole suite.
- Don't touch `probes/haiku-trial/` or `tests/probes/haiku-trial/`.
- The crew visibility build changes `scripts/lib/role.js` and `scripts/hooks/session-start.js` at the same time. Keep changes there small and in their own functions. On a conflict, keep both behaviours. A helm session is a `feature` session: never `aside`, never the First Mate.
- The repository is public: no records of Wheelhouse's own use, no details of the director's other projects.
- Decision line: product behaviour, schema, public interfaces, cost and deletions are the director's, beyond what the spec already decides. Spec section 11 lists what is left to the builder; each such call goes under "Engineering calls" in the pull request.
- Constants from the spec: `RECENT_MS` = 30 minutes (reuse the one in `session-start.js`), `STALE_AFTER_MS` = 2 hours, `seenAt` written at most once a minute.

## Review Focus

1. **Two windows started at the same moment** (spec 6.8): exactly one takes the seat; the other is `aside`, never both First Mate. Pinned in Task 2 (`two takers at once: one wins`).
2. **A crashed window whose pid is reused** by another program: the seat is free, not held for ever. Pinned in Task 2 (`a reused pid frees the seat`).
3. **The front desk's command run from an aside window by the agent** (`cli.js record`, `cards`): refused with words that say why, never a silent success. Pinned in Task 6.
4. **A desktop `feature/...` branch Wheelhouse didn't make**: an aside session that may edit, not a feature session with a missing brief. Pinned in Task 1.
5. **The overlap warning in a broken worktree** (no main branch, git missing, desk unreadable): silent, never blocks a stop, never repeats a warning for the same piece and file. Pinned in Task 8.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/hooks/session-start.js` | modify | `madeFeatureSlug`: the branch's slug only when the worktree's feature folder and brief name it (Task 1); seat take and refresh at start, the aside line and its card, First-Mate-only notes (Task 4) |
| `scripts/lib/first-mate-seat.js` | create | The seat file: read, take, refresh, hand over, release; liveness of its holder (Task 2) |
| `scripts/lib/start-lock.js` | modify, maybe | Only if the stale-takeover rename is lifted into a shared helper (Task 2, builder's call) |
| `scripts/lib/role.js` | modify | `aside` in `ROLES`; the seat step in `sessionRole`; `holdsSeat` (Task 3) |
| `scripts/lib/front-desk.js` | modify | `ASIDE_LINE_MAIN`, `ASIDE_LINE_WORKTREE` and the moved-window line beside `FRONT_DESK_LINE` (Task 4) |
| `scripts/decisions/answer.js` | modify | `recordAnswer` records only for the seat holder (Task 5) |
| `scripts/hooks/prompt-record.js` | modify | Clicks and reply codes from the holder only; the window take-over click (Task 5) |
| `scripts/frontdesk/cli.js` | modify | Write commands refused unless `CLAUDE_CODE_SESSION_ID` holds the seat (Task 6) |
| `scripts/hooks/front-desk-writes.js` | modify | Guards the holder and main-folder aside sessions; lets worktree aside sessions edit (Task 7) |
| `scripts/hooks/board-context.js` | modify | Board and cards lines for the holder only; seat refresh (Task 7) |
| `scripts/hooks/card-check.js` | modify | Its Stop check for the holder only; seat refresh (Task 7) |
| `scripts/hooks/stop-guard.js` | modify | SessionEnd releases the seat this session holds (Task 7) |
| `scripts/engine/dispatcher.js` | modify | Its `running` list lifted into `crewRunning` (Task 8) |
| `scripts/state/events.js` | modify | The `aside-overlap` record kind (Task 8) |
| `scripts/hooks/aside-overlap.js` | create | The overlap warning on Stop for a worktree aside session (Task 8) |
| `adapters/claude-code/hooks.js`, `hooks/hooks.json` | modify | `aside-overlap.js` on Stop (Task 8) |
| `scripts/board/model.js` | modify | The side-branch overlap line (Task 8) |
| `commands/aside.md` | create | `/wheelhouse:aside`, in the form of `commands/stop.md` (Task 3) |
| Tests | create / modify | `tests/scripts/lib/first-mate-seat.test.js`, `tests/scripts/lib/role.test.js`, `tests/scripts/hooks/session-start.test.js`, `tests/scripts/hooks/prompt-record-reply.test.js`, `tests/scripts/hooks/prompt-record.test.js`, `tests/scripts/frontdesk/cli.test.js`, `tests/scripts/hooks/front-desk-writes.test.js`, `tests/scripts/hooks/board-context.test.js`, `tests/scripts/hooks/card-check-shown.test.js`, `tests/scripts/hooks/stop.test.js` (covers `stop-guard.js`), `tests/scripts/state/events.test.js`, `tests/scripts/engine/dispatcher.test.js`, `tests/scripts/hooks/aside-overlap.test.js`, `tests/e2e/front-desk.test.js` |

## Parts (branches and pull requests)

| Part | Tasks | Branch | Base | Needs |
|---|---|---|---|---|
| A | 1 | `build/one-first-mate-feature-slug` | `main` | nothing |
| B | 2 | `build/one-first-mate-seat` | `main` | nothing |
| C | 3, 4 | `build/one-first-mate-aside` | B (or `main` once B merges) | A, B |
| D | 5, 6, 7 | `build/one-first-mate-guards` | C | C |
| E | 8 | `build/one-first-mate-overlap` | C | C |
| F | 9 | `build/one-first-mate-e2e` | D and E merged | D, E |

A and B run side by side. D and E run side by side once C is open.

---

### Task 1: A feature session is one Wheelhouse made (Part A)

Spec: 6.3 (the role order), 6.8 cases 20 and 21, 8 (`featureSlug` built first).

**Files:**
- Modify: `scripts/hooks/session-start.js` (beside `featureSlug`, about line 230)
- Modify: `scripts/lib/role.js` (the `featureSlug(cwd) !== null` step)
- Modify: `scripts/hooks/board-context.js` (about line 378) and `scripts/hooks/session-start.js` (about line 838), where they mean "a Wheelhouse feature"
- Test: `tests/scripts/lib/role.test.js`, `tests/scripts/hooks/session-start.test.js`

**Interfaces:**
- Consumes: `featureSlug(cwd): string | null` (the branch parser, unchanged); `worktreeRoot(cwd)` from `scripts/hooks/kit.js`; `safeFeatureFolder(worktree): boolean` and `readBrief(worktree)` (throws when unreadable) from `scripts/feature/status.js`. Import from `feature/status.js`, never from `hooks/feature-status.js` (that imports `session-start.js` and would loop).
- Produces: `madeFeatureSlug(cwd: string): string | null` exported from `scripts/hooks/session-start.js`: the branch's slug when `cwd` is in a worktree whose `.wheelhouse/feature` folder is safe and whose brief's `work` equals the slug; null otherwise, and null on any read failure. `sessionRole` returns `'feature'` only when it is not null.

`featureSlug` keeps its raw meaning: `feature-status.js` compares it against the brief itself. Each other caller is the builder's call; list the ones changed under "Engineering calls".

- [ ] **Step 1: Write the failing tests**

In `tests/scripts/lib/role.test.js`:
- `a feature/ branch with no feature folder is not a feature session`: a temporary repository on `feature/login` with no `.wheelhouse/feature` → `sessionRole({...}) !== 'feature'` (today's `'front-desk'`; Task 3 makes it `'aside'`).
- `a feature/ branch whose brief names another piece is not a feature session`: brief `work: 'other'` → not `'feature'`.
- `a feature worktree Wheelhouse made is a feature session`: folder and brief `work: 'login'` → `'feature'`.
- `a helm worktree stays a feature session`: a worktree set up as the crew-visibility helm is (a made feature worktree with the helm's marker, whatever that spec gives) → `'feature'`. If the helm marker is not on `main` yet, write the case with a plain made feature worktree and leave a `// helm:` comment for the crew visibility build.

In `tests/scripts/hooks/session-start.test.js`:
- `madeFeatureSlug: null outside a repository, for an unsafe folder and for an unreadable brief`: three asserts of `=== null`.
- `madeFeatureSlug: the slug for a made feature worktree`: `=== 'login'`.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/lib/role.test.js tests/scripts/hooks/session-start.test.js`
Expected: the new tests FAIL (`madeFeatureSlug` is not exported; the bare branch is `'feature'`).

- [ ] **Step 3: Implement `madeFeatureSlug(cwd)` in `session-start.js`; use it in `role.js` and the callers that mean "a feature session"**

Same check as `featureWorktree` in `scripts/hooks/feature-status.js:48`, returning the slug.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/scripts/lib/role.test.js tests/scripts/hooks/session-start.test.js tests/scripts/hooks/board-context.test.js tests/scripts/hooks/why-role.test.js tests/scripts/lib/background.test.js`
Expected: PASS, with no change to the tests that already passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/session-start.js scripts/lib/role.js scripts/hooks/board-context.js tests/scripts/lib/role.test.js tests/scripts/hooks/session-start.test.js
git commit -m "A feature session is one whose worktree Wheelhouse made"
```

### Task 2: The seat (Part B)

Spec: 6.1, 6.2, 6.8 cases 1 to 6, 10 and 12, and 11 (the builder's calls).

**Files:**
- Create: `scripts/lib/first-mate-seat.js`
- Modify, maybe: `scripts/lib/start-lock.js` (only if its stale-takeover rename is lifted into a shared helper; then `tests/scripts/lib/start-lock.test.js` runs too)
- Test: `tests/scripts/lib/first-mate-seat.test.js`

**Interfaces:**
- Consumes: `pidAlive(pid)`, `processStartTime(pid)` from `scripts/watcher/waker.js`; `listProcesses()` from `scripts/engine/stop.js` (`[{pid, ppid, pgid, command}]`, empty on Windows); `wheelhouseHome()` from `scripts/lib/paths.js`.
- Produces, all in `scripts/lib/first-mate-seat.js`; every function takes a last `options = { home, alive, startTime, ancestor, now }` so tests inject the process table and the clock, as `scripts/foreman/start.js` does with `alive` and `now`:
  - `RECENT_MS` (re-exported from `session-start.js`, 30 minutes), `STALE_AFTER_MS = 2 * 60 * 60 * 1000`, `SEEN_EVERY_MS = 60 * 1000`.
  - `seatFile(project: string): string` → `<home>/projects/<project>/first-mate.json`.
  - `readSeat(project): Seat | null`, where `Seat = {session, pid, pidStart, folder, since, seenAt}` (`pid` and `pidStart` may be null); null when missing, unreadable or not whole.
  - `firstMatePid(options): Promise<{pid, pidStart} | {pid: null, pidStart: null}>`: the nearest Claude Code ancestor of this process and its start time; nulls where it can't be found (Windows today).
  - `seatFree(seat, options): Promise<boolean>`: the three rules of spec 6.2.
  - `seatInUse(seat, options): boolean`: `seenAt` within `RECENT_MS`.
  - `takeSeat(project, {session, folder}, options): Promise<{held: true, seat} | {held: false, seat}>`: a `wx` write; a stale or unreadable file is replaced by rename-then-check, so two takers never both win; `held` is true when this session holds it afterwards (including when it already did).
  - `holdsSeat(project, session, options): boolean`: the file names this session.
  - `refreshSeat(project, session, options): void`: rewrites `seenAt` when the file names this session and `seenAt` is older than `SEEN_EVERY_MS`; never throws.
  - `handOverSeat(project, {session, folder, from: {session, since}}, options): Promise<{moved: boolean, seat}>`: rewrites the seat for `session` only while it still names `from.session` with `from.since`; otherwise `moved: false` and the current seat (case 6).
  - `releaseSeat(project, session, options): void`: removes the file only while it names this session; never throws.

Hooks write the seat, never the helper (spec 6.1). No function here decides a session's role; Task 3 does.

- [ ] **Step 1: Write the failing tests** in `tests/scripts/lib/first-mate-seat.test.js`, each with its own temporary `home`:
- `takes a free seat`: `takeSeat` → `held === true`; `readSeat(...).session === 'a'`.
- `two takers at once: one wins`: `Promise.all` of two `takeSeat` calls for `'a'` and `'b'`, 50 rounds → exactly one `held === true` each round, and the file names that one.
- `a live holder keeps the seat`: `alive` true, `startTime` equal to `pidStart` → second `takeSeat` gives `held === false`, `seat.session === 'a'`.
- `a dead holder frees the seat`: `alive` false → `held === true` for `'b'` (case 2).
- `a reused pid frees the seat`: `alive` true, `startTime` different from `pidStart` → `held === true` for `'b'` (case 3).
- `no pid frees after two hours`: pid null, `seenAt` 2 hours and 1 second ago → free; 1 hour 59 minutes ago → held (case 4).
- `in use for thirty minutes`: `seatInUse` true at 29 minutes, false at 31 (case 4's flip).
- `a corrupt or empty file is taken over`: write `'{'` then `''` → `held === true` each time (case 5).
- `a stale hand-over is refused and names the holder`: seat moved to `'c'` → `handOverSeat(..., {from: {session: 'a', since}})` gives `moved === false`, `seat.session === 'c'` (case 6).
- `a hand-over moves the seat`: `moved === true`, `readSeat(...).session === 'b'`.
- `seenAt is written at most once a minute`: two `refreshSeat` calls 30 seconds apart → one write (compare `seenAt`); 61 seconds apart → two.
- `release removes only this session's seat`: `releaseSeat(project, 'b')` while `'a'` holds → file kept; `releaseSeat(project, 'a')` → `readSeat === null`.
- `works the same for a local project`: run `takes a free seat` and `a dead holder frees the seat` with a project whose record has `host: 'local'` (case 12).
- `the nearest Claude Code ancestor`: an injected table `[{pid: 10, ppid: 1, command: 'claude'}, {pid: 20, ppid: 10, command: 'node hook.js'}]` with this process as 20 → `pid === 10`; an empty table → `pid === null`.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/lib/first-mate-seat.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `scripts/lib/first-mate-seat.js` to the Interfaces above**

The rename-then-check: rename the stale file to a unique name, check the renamed copy is the stale one you judged, then `wx`-write; a taker that loses either step reads the seat again. Reuse `takeStartLock`'s rename steps if lifting them reads cleanly (builder's call, spec 11). Writes go through a temporary file and a rename except the first `wx`.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/scripts/lib/first-mate-seat.test.js` (and `tests/scripts/lib/start-lock.test.js` if it changed)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/first-mate-seat.js tests/scripts/lib/first-mate-seat.test.js
git commit -m "The First Mate's seat: one per project, judged by its holder's process"
```

### Task 3: The aside role (Part C)

Spec: 6.3 (the order and the three kinds of aside), 6.8 cases 7, 10, 20 and 21.

**Files:**
- Modify: `scripts/lib/role.js`
- Modify: `scripts/hooks/board-context.js` (where it records the first prompt's role: record `'aside'` for `/wheelhouse:aside` and for a linked worktree that isn't a made feature)
- Create: `commands/aside.md`
- Test: `tests/scripts/lib/role.test.js`, `tests/scripts/hooks/board-context.test.js`

**Interfaces:**
- Consumes: `madeFeatureSlug(cwd)` (Task 1); `readSeat(project)` (Task 2); `projectOf(cwd)` and `worktreeRoot(cwd)` from `scripts/hooks/kit.js`.
- Produces:
  - `ROLES` gains `'aside'`.
  - `ASIDE_COMMAND = '/wheelhouse:aside'` exported from `role.js`.
  - `sessionRole({sessionId, env, prompt, cwd, seat})` stays synchronous. Order: env `why`; env `foreman`; a recorded role other than `'front-desk'`; the foreman wake line; `madeFeatureSlug(cwd) !== null` → `'feature'`; a prompt starting with `ASIDE_COMMAND` → `'aside'`; a linked worktree (`.git` a file) → `'aside'`; then the seat: `seat` (default `readSeat` of the cwd's project) null, unreadable or naming this session → `'front-desk'`; naming another session → `'aside'`. No session id, or no project: `'front-desk'` as today (case 10).
  - `asideKind({cwd}): 'worktree' | 'main'`: which aside line a session gets (Task 4 uses it).

The seat step only reads. Who may take a free seat is Task 4's (session start and the prompt hook); a recorded `'front-desk'` no longer outranks the seat, since a take-over (Task 5) moves the seat without rewriting the old window's record. A helm session is `'feature'` (case 21), and a why copy stays `'why'` (case 7).

`commands/aside.md`: front matter `description:` (one line: makes this window an ordinary session, never the First Mate), then `<!-- commands/aside.md -->`, then one or two lines telling the session to say it is now an ordinary session and to carry on with what the director asks.

- [ ] **Step 1: Write the failing tests**

In `tests/scripts/lib/role.test.js`:
- `aside is a role`: `ROLES.includes('aside')`.
- `the seat holder is the front desk`: `seat: {session: 'a'}`, `sessionId: 'a'` → `'front-desk'`.
- `another session's seat makes this one aside`: `seat: {session: 'b'}`, `sessionId: 'a'` → `'aside'`.
- `no seat is the front desk`: `seat: null` → `'front-desk'`.
- `a recorded front desk follows the seat`: role file `front-desk`, `seat: {session: 'b'}` → `'aside'`.
- `the aside command makes an aside`: `prompt: '/wheelhouse:aside'`, `seat: null` → `'aside'`.
- `a linked worktree that isn't a feature is aside`: `git worktree add` on `feature/desk` with no feature folder → `'aside'` (case 20).
- `a made feature worktree is a feature whatever the seat`: → `'feature'` with `seat: {session: 'b'}`.
- `why and foreman come before the seat`: env `why` → `'why'`; env `foreman` → `'foreman'`, each with `seat: {session: 'b'}`.
- `no session id is the front desk`: `sessionId: undefined`, `seat: {session: 'b'}` → `'front-desk'`.
- `asideKind`: the main checkout → `'main'`; a linked worktree → `'worktree'`.

In `tests/scripts/hooks/board-context.test.js`:
- `the aside command is recorded as aside`: first prompt `/wheelhouse:aside` → the role file holds `aside`.
- `a linked worktree's aside is recorded`: first prompt in a linked non-feature worktree → `aside` recorded.
- `a seat-made aside is not recorded`: seat held by another session → no role file written.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/lib/role.test.js tests/scripts/hooks/board-context.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the order above in `sessionRole`, `asideKind`, the recording in `board-context.js`, and `commands/aside.md`**

Keep the seat step in its own function in `role.js` (`seatRole(...)`), apart from anything the crew visibility build adds.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/scripts/lib/role.test.js tests/scripts/hooks/board-context.test.js tests/scripts/hooks/why-role.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/role.js scripts/hooks/board-context.js commands/aside.md tests/scripts/lib/role.test.js tests/scripts/hooks/board-context.test.js
git commit -m "An aside session: any ordinary session that doesn't hold the seat"
```

### Task 4: Session start takes the seat; the aside lines and card (Part C)

Spec: 6.1 (taking, `seenAt`), 6.3 (the aside lines, the card, what only the First Mate gets), 6.8 cases 1, 7, 8, 9, 10.

**Files:**
- Modify: `scripts/hooks/session-start.js` (`started`, after `keepLock` at ~807 and before `deskSession` at ~838; `readOnlyStart` at ~678 only reads; the take-over block at ~863; the model write at ~879)
- Modify: `scripts/state/card-lines.js` (the window take-over set line)
- Modify: `scripts/cards/compose.js` (`lineFor('take-over', …)` at ~268 and the title at ~149 take either target)
- Modify: `scripts/lib/front-desk.js` (the aside lines)
- Modify: `scripts/hooks/prompt-record.js` (a free seat is taken on the first prompt as well, for a session that started before the seat existed)
- Test: `tests/scripts/hooks/session-start.test.js`, `tests/scripts/cards/compose.test.js`

**Interfaces:**
- Consumes: `takeSeat`, `refreshSeat`, `readSeat`, `seatInUse`, `firstMatePid` (Task 2); `sessionRole`, `asideKind`, `ASIDE_COMMAND` (Task 3); `startedByScript(env)` from `scripts/decisions/answer.js:42`; `agoWords` in session-start.js.
- Produces:
  - `export const RECENT_MS` from session-start.js (Task 2's re-export reads it).
  - `seatTakeOverLine(session, since)` → `Take over the First Mate from window session ${session}, since ${since}`, and `SEAT_TAKEOVER_LINE` (session `[A-Za-z0-9_-]{1,128}`, since an ISO time), in card-lines.js; `SEAT_TAKEOVER_LINE` joins `SET_LINES`.
  - `composeCard({kind: 'take-over', target: {session, since}})` gives the seat line and the title `Move the First Mate to this window?`; a `{holder, counter}` target stays as it is.
  - `ASIDE_LINE_MAIN`, `ASIDE_LINE_WORKTREE`, `asideLine({ago, kind})` and `SEAT_MOVED_LINE` in `scripts/lib/front-desk.js`. The words are spec 6.3's and 6.4's, copied verbatim: the shared first sentence with "last active N minutes ago" from `agoWords`, then the main-folder or the worktree addition. `SEAT_MOVED_LINE = 'The First Mate moved to another window; this session is now an ordinary one'`.
  - `export async function keepSeat({project, input, env, lockFree, now, seat})` → `{role: 'front-desk' | 'aside', seat}` in session-start.js: its own function, apart from anything the crew visibility build adds.

`keepSeat`: no session id or `startedByScript(env)` → reads only (case 10). When the computer holds or can take the lock (`lockFree`: `keepLock` gave null, or the helper is down, case 9) it calls `takeSeat` with `firstMatePid()`'s pid and start time; when this session already holds it, `refreshSeat`. While another computer holds the lock it takes nothing (case 8): that session keeps today's computer take-over card and no seat. A compaction keeps the id and so the seat (case 7).

In `started`: `deskSession` is the role after `keepSeat`, not before. An aside session gets `asideLine` in place of `FRONT_DESK_LINE`; a seat-made aside in the main folder also gets the window take-over card (target `{session, since}` from the seat, recommend `LEAVE_LABEL` when `seatInUse`, else `TAKEOVER_LABEL`), composed as `takeOverNotes` composes the computer's. A command-made aside and a worktree aside get no card. The usage card, the computer take-over card, `keepRunningModel` and the setup note stay behind `deskSession` (only the First Mate gets them).

The prompt hook takes a free seat the same way on a prompt in a session whose role is `front-desk` and that doesn't hold it yet; it never takes one another session holds.

- [ ] **Step 1: Write the failing tests**

In `tests/scripts/cards/compose.test.js`:
- `a window take-over card names the session and since`: target `{session: 'abc', since: '2026-11-08T01:00:00.000Z'}` → the question holds `Take over the First Mate from window session abc, since 2026-11-08T01:00:00.000Z` and matches a `SET_LINES` entry.
- `a computer take-over card is as before`: target `{holder: '0a1b2c3d', counter: 2}` → `Take over the lock from computer 0a1b2c3d, counter 2`.

In `tests/scripts/hooks/session-start.test.js` (a temp home, a fake client whose `lock.read` gives no other holder):
- `the first session takes the seat`: `decide` with `session_id: 'a'` → `readSeat(project).session === 'a'`; the context holds `FRONT_DESK_LINE`.
- `a second session is aside`: seat held by live `'a'`; `decide` with `'b'` → the seat still names `'a'`; the context holds the aside line's first sentence and the window take-over card, and no `FRONT_DESK_LINE`.
- `the card recommends Leave it there while the seat is in use`: `seenAt` 5 minutes ago → `recommend` is `Leave it there`; `seenAt` 45 minutes ago → `Take over here`.
- `a worktree aside gets the worktree line and no card`: `decide` in a linked non-feature worktree → the worktree addition, no take-over card.
- `a command-made aside gets no card`: role recorded `aside` by the command → the main-folder line, no card.
- `no session id never takes the seat` and `a script-started session never takes the seat` (case 10): no seat file after `decide`.
- `a compaction keeps the seat`: holder `'a'`, `decide` with `source: 'compact'`, `session_id: 'a'` → front desk, seat unchanged but `seenAt` refreshed (case 7).
- `another computer's lock comes first`: `lock.read` names another computer → the computer take-over card, no seat file (case 8).
- `with the helper down the seat is still taken` (case 9).
- `only the First Mate writes the running model`: an aside session leaves no running-model file; the holder writes it.
- `RECENT_MS is exported`: equals `30 * 60 * 1000`.

In `tests/scripts/hooks/prompt-record.test.js`:
- `a front desk prompt takes a free seat`: no seat file, prompt in session `'a'` → seat names `'a'`.
- `a prompt never takes a held seat`: seat held by live `'b'` → unchanged.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/hooks/session-start.test.js tests/scripts/cards/compose.test.js tests/scripts/hooks/prompt-record.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement `seatTakeOverLine`, the compose branch, the aside lines, `keepSeat`, the wiring in `started` and the prompt hook's take**

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/scripts/hooks/session-start.test.js tests/scripts/cards/compose.test.js tests/scripts/hooks/prompt-record.test.js tests/scripts/lib/first-mate-seat.test.js tests/scripts/lib/role.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/session-start.js scripts/state/card-lines.js scripts/cards/compose.js scripts/lib/front-desk.js scripts/hooks/prompt-record.js tests/scripts/hooks/session-start.test.js tests/scripts/cards/compose.test.js tests/scripts/hooks/prompt-record.test.js
git commit -m "Session start takes the First Mate's seat; a second window is an aside"
```

### Task 5: Answers and clicks only from the seat; Take over here moves it (Part D)

Spec: 6.4, 6.5 (the `recordAnswer` and clicks rows), 6.7 (the helm's one alternative), 6.8 cases 6 and 11.

**Files:**
- Modify: `scripts/decisions/answer.js` (`recordAnswer` at ~106, the guard at ~111–112)
- Modify: `scripts/hooks/prompt-record.js` (`earned` at ~363; `takeOverOf` at ~327; `shownFor` at ~895; `decideReply` at ~920; the click loop in `decide` at ~1018–1034)
- Modify: `scripts/state/events.js` (`ACTIONS` at ~68, the action fields at ~101, the checks at ~229)
- Test: `tests/scripts/hooks/prompt-record-reply.test.js`, `tests/scripts/hooks/prompt-record.test.js`, `tests/scripts/state/events.test.js`

**Interfaces:**
- Consumes: `holdsSeat`, `readSeat`, `handOverSeat` (Task 2); `sessionRole` (Task 3); `seatTakeOverLine`, `SEAT_TAKEOVER_LINE`, `SEAT_MOVED_LINE` (Task 4); `TAKEOVER_LABEL` from `scripts/state/card-lines.js`.
- Produces:
  - `recordAnswer({..., seat})`: `seat` defaults to `readSeat(project)`. With a session id, it records only when the seat names this session (or through the helm alternative, if the crew visibility build has added it: keep it as that one alternative). Otherwise `{recorded: false}`, and when the words read as an answer to a waiting decision, a `note` that the First Mate is in another window, so nothing was recorded and the decision still waits (case 11; wording the builder's, in the form of the typed-replies-off note). No session id: today's behaviour.
  - An `action` record `seat-take-over` with fields `['session', 'since']`, its `label` `TAKEOVER_LABEL` and its `question` exactly `seatTakeOverLine(session, since)`, checked in events.js beside `take-over`. A separate action, so the helper's `takeOverClick` (`scripts/host/helper.js:1340`), which moves the git lock, never reads it.
  - `seatTakeOverOf(question, label, shown)` in prompt-record.js beside `takeOverOf`: the made record and `seatTakeOver: true`.

In `decide`: a click or a reply code from a session that doesn't hold the seat records nothing and adds a context line that the First Mate is in another window and the window's take-over card can move it here; the one exception is the window take-over click itself. That click is recorded, then `handOverSeat(project, {session, folder: input.cwd, from: {session, since}})` runs after the record is sent (in place of `api.lock.takeOver` for this kind). `moved` → a context line that this window is now the First Mate, with `FRONT_DESK_LINE`; refused → a line naming the current holder (case 6). `shownFor` gives no reply code for `SEAT_TAKEOVER_LINE`, as for `TAKEOVER_LINE`.

- [ ] **Step 1: Write the failing tests**

In `tests/scripts/hooks/prompt-record-reply.test.js`:
- `an aside session's typed answer records nothing and says why`: seat held by `'b'`, typed replies on, session `'a'` types `B` while decision 1 waits → no answer record; the context names the First Mate's other window (case 11).
- `the holder's typed answer records as today`: seat held by `'a'` → recorded.
- `no session id records as today`: `session_id` absent → recorded.

In `tests/scripts/hooks/prompt-record.test.js`:
- `a card click in an aside window is refused`: seat held by `'b'`, a shown card clicked in session `'a'` → no record; the context holds the refusal line.
- `the holder's card click records as today`.
- `Take over here moves the seat`: seat `{session: 'b', since: S}`, the window card shown in `'a'`, clicked → a `seat-take-over` record; `readSeat(...).session === 'a'`; the context holds `FRONT_DESK_LINE`; `api.lock.takeOver` not called.
- `a stale Take over here is refused and names the holder`: seat moved to `'c'` after the card showed `'b'` → seat still `'c'`; the context names `c` (case 6).
- `no reply code for the window take-over card`: the shown card's line carries no reply code.

In `tests/scripts/state/events.test.js`:
- `a seat-take-over action needs its set line`: a record whose question isn't `seatTakeOverLine(session, since)` → refused; a whole one → accepted.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/hooks/prompt-record-reply.test.js tests/scripts/hooks/prompt-record.test.js tests/scripts/state/events.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the `recordAnswer` guard, the `seat-take-over` action, `seatTakeOverOf`, the holder check on clicks and codes, and the hand-over after the click is sent**

Tests that call `recordAnswer` directly with a session id pass `seat` (or set one up), since a missing seat no longer records.

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/scripts/hooks/prompt-record-reply.test.js tests/scripts/hooks/prompt-record.test.js tests/scripts/state/events.test.js tests/scripts/frontdesk/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/decisions/answer.js scripts/hooks/prompt-record.js scripts/state/events.js tests/scripts/hooks/prompt-record-reply.test.js tests/scripts/hooks/prompt-record.test.js tests/scripts/state/events.test.js
git commit -m "Only the First Mate's window records answers and clicks; Take over here moves the seat"
```

### Task 6: The front desk's command writes only from the seat (Part D)

Spec: 6.5 (the two `cli.js` rows), 7 (`cli.test.js`), Review Focus 3.

**Files:**
- Modify: `scripts/frontdesk/cli.js` (`main` at ~1376, straight after the `COMMANDS` check)
- Test: `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- Consumes: `holdsSeat(project, session)` (Task 2); `projectOf(cwd)` from `scripts/hooks/kit.js` (as `readyIn` uses it).
- Produces, in `cli.js`:
  - `SEAT_WRITES`: a frozen list of the commands the seat guards. From spec 6.5: `cards`, `pull-cards`, `again`, `card`, `record`, `confirm`, `suggest`, `pull-back`, `drop`, `ask-bosun`. There is no `settings` command: settings change through `record` and `suggest`, so they are covered. Of the rest of `COMMANDS`, a command that writes a record, hands out a card or changes the board is a write (`undo`, `move`, `carry-on`, `archive`, `restore`, `premium-card` on a first reading); one that only reads is not (`views`, `decision`, `explain`, `similar`, `why`, `preview`, `premium-check`, `alerts`). Check `note`, `premium-check` and `alerts` against their handlers and list where each fell under "Engineering calls".
  - `SEAT_REFUSAL`: the refusal's words: the First Mate is in another window, so this window can look things up but not record or hand out cards; the director can move the First Mate here with that window's take-over card. Wording the builder's, within spec 6.5.
  - `seatRefusal({command, env, cwd}): string | null`: its own function. Null when `command` isn't in `SEAT_WRITES`, when `env.CLAUDE_CODE_SESSION_ID` is missing or empty (a script or test: today's behaviour), when the cwd is in no project, or when `holdsSeat` is true. Otherwise `SEAT_REFUSAL`. `main` throws `new CliError(seatRefusal(...))` when it isn't null, before the helper client is made.

A session id with no seat file at all is refused: by the time the agent runs the command, session start or the prompt hook (Task 4) has taken a free seat for the First Mate.

- [ ] **Step 1: Write the failing tests** in `tests/scripts/frontdesk/cli.test.js`, each with a temporary home and project, the seat set up with `takeSeat`:
- `every seat write is refused for a session that doesn't hold the seat`: for each of `SEAT_WRITES`, `main([command], {env: {CLAUDE_CODE_SESSION_ID: 'a'}, ...})` with the seat held by `'b'` → exit code 1, `err` holds `SEAT_REFUSAL`, and the fake client was never called.
- `the holder's writes go through`: `record` with a whole record on standard input and `cards`, session `'b'` holding → exit 0 and the record reached the client.
- `reads work for any session`: `views waiting`, `decision list`, `explain`, `similar`, `why` with session `'a'` while `'b'` holds → not refused (no `SEAT_REFUSAL` in `err`).
- `no session id keeps today's behaviour`: `record` with no `CLAUDE_CODE_SESSION_ID` and the seat held by `'b'` → exit 0.
- `outside a project nothing is refused`: a cwd in no project → `seatRefusal(...) === null`.

Existing tests that pass a session id to a write command (the `--here` cases) set up the seat for that id.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/frontdesk/cli.test.js`
Expected: the new tests FAIL (`SEAT_WRITES` is not exported).

- [ ] **Step 3: Implement `SEAT_WRITES`, `SEAT_REFUSAL` and `seatRefusal`, and the one check in `main`**

- [ ] **Step 4: Run them and see them pass**

Run: `node --test tests/scripts/frontdesk/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/frontdesk/cli.js tests/scripts/frontdesk/cli.test.js
git commit -m "The front desk's command records only from the First Mate's window"
```

### Task 7: The write guard, the board, the card check and the session's end follow the seat (Part D)

Spec: 6.4 (the moved window's one line), 6.5 (the `front-desk-writes.js`, `board-context.js` and `card-check.js` rows), 6.1 (release at SessionEnd, `seenAt` from hooks), 6.8 cases 2 and 13.

**Files:**
- Modify: `scripts/hooks/front-desk-writes.js` (the role check at ~181; `FRONT_DESK_NO_WRITES` at ~29)
- Modify: `scripts/hooks/board-context.js` (the role check at ~373–377)
- Modify: `scripts/hooks/card-check.js` (`decideStop` at ~326)
- Modify: `scripts/hooks/stop-guard.js` (the SessionEnd branch at ~210–218)
- Modify: `scripts/lib/first-mate-seat.js` (`handOverSeat` keeps `movedFrom`; `movedAway`)
- Test: `tests/scripts/hooks/front-desk-writes.test.js`, `tests/scripts/hooks/board-context.test.js`, `tests/scripts/hooks/card-check-shown.test.js`, `tests/scripts/hooks/stop.test.js`, `tests/scripts/lib/first-mate-seat.test.js`

**Interfaces:**
- Consumes: `refreshSeat`, `releaseSeat`, `readSeat`, `handOverSeat` (Task 2); `sessionRole`, `asideKind` (Task 3); `SEAT_MOVED_LINE` (Task 4); `roleFile(sessionId)` from `scripts/lib/role.js` (the session's own folder, `<home>/sessions/<id>/`).
- Produces:
  - `ASIDE_NO_WRITES(file)` in `front-desk-writes.js`, beside `FRONT_DESK_NO_WRITES`: this window isn't the First Mate and stands in the project's main folder, so it can't change the product's files here; to edit by hand, start a session in a worktree, whose changes reach main through the director's own pull request. Wording the builder's, within spec 6.5. `FRONT_DESK_NO_WRITES` gains the same pointer to a worktree session as its last sentence.
  - `decide` in `front-desk-writes.js`: refuses for role `'front-desk'` (as today, with `FRONT_DESK_NO_WRITES`) and for role `'aside'` when `asideKind({cwd}) === 'main'` (with `ASIDE_NO_WRITES`); lets role `'aside'` in a worktree through. Every other role as today. Refreshes the seat (`refreshSeat`) when the role is `'front-desk'`.
  - `handOverSeat` writes `movedFrom: from.session` into the new seat (a field spec 11 leaves to the builder). `refreshSeat` keeps it.
  - `movedAway(project, session, options): boolean` in `first-mate-seat.js`: true exactly once per move, when the seat's `movedFrom` names this session; the "told" mark is a file `seat-moved.json` in the session's own folder (`path.dirname(roleFile(session))`) holding the seat's `since`. Never throws (false on any failure).
  - `board-context.js`: when `movedAway` is true, the context is `SEAT_MOVED_LINE` (once). Board and cards lines stay behind `role === 'front-desk'`, which the seat now decides (Task 3), so an aside session gets none. The holder's prompt refreshes the seat.
  - `card-check.js` `decideStop`: already checks `role(...) === 'front-desk'`, which the seat now decides; the holder's Stop refreshes the seat.
  - `stop-guard.js`: on SessionEnd in a project, `releaseSeat(project, input.session_id)` in its own function (`releaseAtEnd`), before the SessionEnd return; never throws.

- [ ] **Step 1: Write the failing tests**

In `tests/scripts/hooks/front-desk-writes.test.js` (a temp home and project; the seat set up with `takeSeat`):
- `the holder may not write the product's files`: seat names the session, `Write` to `src/a.js` in the main folder → denied with `FRONT_DESK_NO_WRITES`, which now points to a worktree session.
- `a main-folder aside may not write the product's files`: seat held by another session → denied with `ASIDE_NO_WRITES` (case 13).
- `a worktree aside may write in its worktree`: a linked non-feature worktree, seat held by another → `undefined` (case 13).
- `an aside's own .wheelhouse notes stay allowed`: a main-folder aside writing `.wheelhouse/work/x.md` → `undefined`.

In `tests/scripts/hooks/board-context.test.js`:
- `an aside session gets no board or cards lines`: seat held by another, a prompt with waiting cards → no board line, no cards line.
- `the old window is told once that the First Mate moved`: `handOverSeat` from `'a'` to `'b'`; a prompt in `'a'` → context `SEAT_MOVED_LINE`; a second prompt in `'a'` → not `SEAT_MOVED_LINE`.
- `the holder's prompt refreshes the seat`: `seenAt` 2 minutes old → newer after the prompt.

In `tests/scripts/hooks/card-check-shown.test.js`:
- `an aside session's Stop is not checked`: seat held by another, a paraphrased decision block → `undefined`.
- `the holder's Stop is checked as before`: seat names the session → sent back as today.

In `tests/scripts/hooks/stop.test.js`:
- `SessionEnd releases the seat this session holds`: seat names `'a'`, SessionEnd for `'a'` → `readSeat === null`.
- `SessionEnd leaves another session's seat`: seat names `'b'`, SessionEnd for `'a'` → unchanged.

In `tests/scripts/lib/first-mate-seat.test.js`:
- `movedAway is true once for the window the seat left`: after a hand-over from `'a'`, `movedAway(project, 'a')` → true, then false; `movedAway(project, 'b')` → false.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/hooks/front-desk-writes.test.js tests/scripts/hooks/board-context.test.js tests/scripts/hooks/card-check-shown.test.js tests/scripts/hooks/stop.test.js tests/scripts/lib/first-mate-seat.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the write guard's two cases, `movedFrom` and `movedAway`, the moved line and refresh in `board-context.js`, the refresh in `card-check.js` and `releaseAtEnd` in `stop-guard.js`**

- [ ] **Step 4: Run them and see them pass**

Run: the Step 2 command.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/front-desk-writes.js scripts/hooks/board-context.js scripts/hooks/card-check.js scripts/hooks/stop-guard.js scripts/lib/first-mate-seat.js tests/scripts/hooks/front-desk-writes.test.js tests/scripts/hooks/board-context.test.js tests/scripts/hooks/card-check-shown.test.js tests/scripts/hooks/stop.test.js tests/scripts/lib/first-mate-seat.test.js
git commit -m "The write guard, the board and the card check follow the seat; the seat is let go at the session's end"
```

### Task 8: The overlap warning for worktree asides (Part E)

Spec: 6.6 (copy the example warning verbatim as the wording's model), 6.8 cases 14–19, 7 (`aside-overlap.test.js`, `dispatcher.test.js`).

**Files:**
- Modify: `scripts/engine/dispatcher.js` (lift the `running` list at ~70–88 into `crewRunning`; `dispatch` calls it)
- Modify: `scripts/state/events.js` (`PLAIN_KINDS` and `PLAIN_SHAPES` gain `aside-overlap`)
- Modify: `scripts/board/model.js` (the overlap line)
- Create: `scripts/hooks/aside-overlap.js`
- Modify: `adapters/claude-code/hooks.js` and `hooks/hooks.json` (a third command in the Stop entry, after `feature-status.js`, same `node-floor.cjs` form, timeout 10; `hooks.json` must equal the adapter's registration)
- Test: `tests/scripts/engine/dispatcher.test.js`, `tests/scripts/state/events.test.js`, `tests/scripts/board/model.test.js`, `tests/scripts/hooks/aside-overlap.test.js` (new)

**Interfaces:**
- Consumes: `sessionRole`, `asideKind` (Task 3); `clashCheck({files, running, hotFiles})` from `scripts/foreman/queue.js`; `deskClient`, `unreached` from `scripts/desk/client.js`; `projectOf`, `runAndExit` from `scripts/hooks/kit.js`.
- Produces:
  - `crewRunning({work, runs, reports, features, waiting, reserved, returning, admitted, stoppedFeatures, settings}): Array<{work: string, files: string[]}>` exported from `dispatcher.js`, with the same defaults as `dispatch`. `dispatch` uses it, so its holds don't change. It also returns the `live` list `dispatch` needs further down, or `dispatch` keeps computing `live` itself; the builder's call, as long as there is one copy of each rule.
  - The `aside-overlap` plain kind: `{ must: ['branch', 'pieces', 'files', 'at'], may: [] }`. `pieces` and `files` are arrays of strings.
  - `asideFiles({cwd, base, run}): string[] | null`: `git merge-base HEAD <base>`, `git diff --name-only <mergeBase>`, and `git status --porcelain` (the path after the status columns; for a rename, the new path), deduplicated and capped at `FILES_CAP = 500`. `run` is an injectable `execFileSync`-like function. Null when any git call fails.
  - `mainBranchOf({cwd, views, run}): string | null`: the project's recorded base branch from the settings view, then `origin/HEAD` resolved with `git symbolic-ref`, then null.
  - `overlapWords(clashes): string`: one sentence per piece, the spec 6.6 example's shape: "Heads up: this branch changes `<files>`, which the crew piece <piece> is also changing. Merging both will conflict. You could wait for <piece> to merge and then bring this branch up to date, or ask the First Mate to hold it." Two or more files are joined with commas and "and".
  - `warnedFile(cwd): string` → `<worktree>/.wheelhouse/aside-overlap.json` holding `[{work, file}]`.
  - `decide(input, {env, cwd, desk, run, now, role, kind}): Promise<{systemMessage, decision: 'block', reason} | undefined>`. Undefined unless `role(...) === 'aside'` and `kind({cwd}) === 'worktree'`; undefined when the input's `stop_hook_active` is true; undefined when the desk is unreached or git fails. On a new (piece, file) pair: writes the record through the desk (`kind: 'aside-overlap'`, `branch` from `git rev-parse --abbrev-ref HEAD`, the new pairs' pieces and files, `at`), adds the pairs to the warned file, and returns the `systemMessage` and the block, both with `overlapWords` of the new pairs only. The warned file keeps only pairs whose piece is still in `running`, so a piece that ends and comes back warns again.
  - `crewRunning`'s inputs in the hook: `work`, `runs`, `reports`, `features` and `settings` from the desk's views read; `waiting` from the waiting view's cards; `reserved`, `returning` and `admitted` empty, since those live in the dispatcher's own process. A recorded piece's planned files (`e.files`) still count. Engineering call: listed in the PR.
  - The board line in `boardModel`: for each `aside-overlap` record of the last 7 days whose pieces haven't ended, "A side branch (<branch>) overlaps <pieces>". Placement next to the held-back lines; the builder matches how `heldBackLine` lines are carried.

- [ ] **Step 1: Write the failing tests**

In `tests/scripts/engine/dispatcher.test.js`:
- `crewRunning gives the dispatcher the same holds`: a live piece with files and a waiting piece clashing with it → `dispatch` holds the waiting piece as before; `crewRunning` of the same inputs → both pieces with their files.

In `tests/scripts/state/events.test.js`:
- `aside-overlap needs branch, pieces, files and at`: a full record → accepted; one missing `pieces` → refused.

In `tests/scripts/board/model.test.js`:
- `the board shows a side branch that overlaps a piece`: an `aside-overlap` record naming a live piece → the line naming the branch and the piece; the piece ended → no line.

In `tests/scripts/hooks/aside-overlap.test.js` (a temp git repo with `main` and a linked worktree on `side`; a desk stub returning views and recording writes; `role` and `kind` passed in):
- `a committed shared file warns once and writes the record` (case 14): `side` commits `src/login.ts`; a piece plans `src/login.ts` → `systemMessage` and `reason` both contain "src/login.ts" and the piece's id, `decision === 'block'`; one `aside-overlap` write with `pieces: [id]`, `files: ['src/login.ts']`.
- `the next turn with nothing new says nothing` (case 14): a second `decide` → `undefined`, no write.
- `an uncommitted file warns` (case 15).
- `an untracked file warns` (case 15).
- `a hotFiles match warns` (case 16): `hotFiles: ['migrations/*']`, the aside adds `migrations/002.sql`, the piece plans `migrations/003.sql` → warned.
- `no clash says nothing`.
- `an ended piece drops out` (case 17): the piece's report says merged → `undefined`.
- `a new piece warns at the next Stop` (case 18): after a warning, a second piece planning the same file → warned for that piece only.
- `a desk that can't be read says nothing` (case 19): desk returns unreached → `undefined`, no throw.
- `git failing says nothing` (case 19): `run` throws → `undefined`.
- `stop_hook_active says nothing`: the block is never asked for twice in one turn.
- `it does nothing outside a worktree aside`: role `'front-desk'`, role `'aside'` with kind `'main'`, role `'feature'` (also a helm session), role `'why'` → each `undefined`.
- `the base branch falls back to origin/HEAD`: no recorded base branch → `mainBranchOf` gives `origin/HEAD`'s target.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/scripts/engine/dispatcher.test.js tests/scripts/state/events.test.js tests/scripts/board/model.test.js tests/scripts/hooks/aside-overlap.test.js`
Expected: the new tests FAIL (`aside-overlap.test.js` with "Cannot find module").

- [ ] **Step 3: Implement `crewRunning`, the record kind, the board line, `scripts/hooks/aside-overlap.js` (its `main` reads stdin with `runAndExit`, as `card-check.js` does) and the hooks.json entry**

- [ ] **Step 4: Run them and see them pass**

Run: the Step 2 command, plus `node --test tests/scripts/agents/claude-registration.test.js` (it reads hooks.json).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/engine/dispatcher.js scripts/state/events.js scripts/board/model.js scripts/hooks/aside-overlap.js adapters/claude-code/hooks.js hooks/hooks.json tests/scripts/engine/dispatcher.test.js tests/scripts/state/events.test.js tests/scripts/board/model.test.js tests/scripts/hooks/aside-overlap.test.js
git commit -m "A worktree aside is warned once when its branch overlaps a crew piece"
```

### Task 9: Two windows, end to end (Part F)

Spec: 7 (the two `tests/e2e/front-desk.test.js` entries).

**Files:**
- Test: `tests/e2e/front-desk.test.js`

**Interfaces:**
- Consumes: everything above, through the real hooks and `cli.js`, as the file's existing cases drive them.

- [ ] **Step 1: Write the tests**

In `tests/e2e/front-desk.test.js`, with the file's existing temp home, project and helper:
- `two windows: only the seat holder records`: session `a` starts (SessionStart) and takes the seat; `a` runs `cli.js record work` → exit 0; session `b` starts → its context has the aside line and the take-over card; `b` runs `cli.js record work` → non-zero, `SEAT_REFUSAL` on stderr; `b` clicks "Take over here" (`seatTakeOverLine`) → the seat names `b`; `b`'s `record work` → exit 0; `a`'s next `record work` → refused, and `a`'s next prompt gets `SEAT_MOVED_LINE`.
- `a worktree aside overlapping a recorded piece is warned once`: a recorded piece planning `src/a.js`; a linked worktree whose branch commits `src/a.js`; Stop in that session → a `systemMessage` naming the piece and `src/a.js`; a second Stop → nothing; the board view shows the overlap line.

- [ ] **Step 2: Run them**

Run: `node --test tests/e2e/front-desk.test.js`
Expected: PASS. A failure here is a bug in Tasks 1–8: fix it in the part it belongs to, on this branch, and say so in the PR.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/front-desk.test.js
git commit -m "Two windows in one project, end to end"
```
