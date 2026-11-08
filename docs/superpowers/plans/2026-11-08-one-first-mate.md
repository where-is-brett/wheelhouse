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
| `scripts/hooks/session-start.js` | modify | `featureSlug` checks the worktree's feature folder and brief (Task 1); seat take and refresh at start, the aside line and its card, First-Mate-only notes (Task 4) |
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
| `scripts/hooks/aside-overlap.js` | create | The overlap warning on Stop for a worktree aside session (Task 8) |
| `hooks/hooks.json` | modify | `aside-overlap.js` on Stop (Task 8) |
| `skills/aside/SKILL.md` or `commands/aside.md` | create | `/wheelhouse:aside`, whichever form the plugin's other commands take (Task 3) |
| Tests | create / modify | `tests/scripts/lib/first-mate-seat.test.js`, `tests/scripts/lib/role.test.js`, `tests/scripts/hooks/session-start.test.js`, `tests/scripts/decisions/answer.test.js`, `tests/scripts/hooks/prompt-record.test.js`, `tests/scripts/frontdesk/cli.test.js`, `tests/scripts/hooks/front-desk-writes.test.js`, `tests/scripts/hooks/board-context.test.js`, `tests/scripts/hooks/card-check.test.js`, `tests/scripts/hooks/stop-guard.test.js`, `tests/scripts/engine/dispatcher.test.js`, `tests/scripts/hooks/aside-overlap.test.js`, `tests/e2e/front-desk.test.js` |

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
