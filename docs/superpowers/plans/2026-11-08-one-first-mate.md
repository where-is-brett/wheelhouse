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
| `hooks/hooks.json` | modify | `aside-overlap.js` on Stop (Task 8) |
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
