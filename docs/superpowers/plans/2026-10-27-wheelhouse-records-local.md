<!-- docs/superpowers/plans/2026-10-27-wheelhouse-records-local.md -->
# Records kept on this computer: implementation plan (parts 1, 2 and 5 of design section 24)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every project's record, and the director's personal settings, are local git repositories under `~/.wheelhouse` with no remote; nothing of Wheelhouse's records is pushed; projects set up on v0.1.x are imported on the first session start; public repositories can be set up.

**Architecture:** One opener, `openRecord(dir)`, generalises Lean's `leanState`: a git repository with no remote on the local branch `record`. `stateDir(project)` moves to `projects/<project>/record/` and `profileDir()` to `settings/`, so every reader of events follows without change; the old folders (`projects/<project>/state/`, `profile/`) are read only by the import. The helper stops cloning, syncing and pushing; the lock branch keeps its clone, which finds its remote from the project's record instead of the state clone.

**Tech Stack:** Node.js (ES modules), `node:test`, git.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, section 24 (24.1, 24.2, 24.3 items 1 to 5, 24.5, 24.6, 24.7 answer 2).

## Global Constraints

- British English; dates as 27 October 2026; a repository-relative path comment atop every file.
- No words such as "enhanced", "improved" or "fixed" in names or text; no model names; no AI attribution.
- The `wheelhouse-lock` branch stays exactly as it is (24.7, answer 2); touch `scripts/state/lock.js` only where it read the state clone.
- Writing an event still runs the secret scan (`scanContent` in `writeEvent`).
- Nothing on the host is deleted by this work; nothing of the old state clone or profile clone is deleted on this computer either (24.5 step 1).
- Run only the test files a change touches.

## Review Focus

1. **A v0.1.x computer with unpushed events in its state clone.** Import reads the clone's working files (`listEvents` on the old folder), not the remote, so an event committed and never pushed is imported. Test in Task 5.
2. **An imported signed event from another computer whose key isn't trusted here.** It is skipped and counted, never written. Test in Task 5.
3. **Import run twice, or by two session starts at once.** Ids already held are skipped; the import runs under the helper's `state:<project>` queue. Test in Task 5.
4. **A planted approval on main.** The gate reads only the local record and verifies against this computer's own key, so an approval file signed by an once-trusted other computer doesn't count for a merge. Test in Task 2.
5. **A Lean project's existing record at `state/`.** It has no remote and is imported like any other, so a Lean project keeps its history. Test in Task 5.

---

### Task 1: The local record opener and the new paths

**Files:**
- Create: `scripts/state/record.js`
- Modify: `scripts/lib/paths.js` (`stateDir`, `profileDir`, add `oldStateDir`, `oldProfileDir`)
- Modify: `scripts/lean/project.js` (`leanState` becomes a call of `openProjectRecord`)
- Test: `tests/scripts/state/record.test.js`, `tests/scripts/lean/project.test.js`

**Interfaces:**
- Produces: `RECORD_BRANCH = 'record'`; `openRecord(dir, { run, what, readme }) -> Promise<string>`; `openProjectRecord(project, { run }) -> Promise<string>`; `openSettings({ run }) -> Promise<string>`.
- Produces: `stateDir(project)` = `<home>/projects/<project>/record`; `oldStateDir(project)` = `<home>/projects/<project>/state`; `profileDir()` = `<home>/settings`; `oldProfileDir()` = `<home>/profile`.

- [ ] Tests: `openRecord makes a repository with no remote on the record branch`; `openRecord reuses its own repository`; `openRecord leaves alone a repository with a remote` (throws, folder untouched); `openRecord leaves alone a folder with files but no repository`; `openRecord reuses a Lean record on the old state branch name` (a repository with no remote on `wheelhouse-state` is accepted, so a Lean folder copied by hand still opens).
- [ ] Implement by moving `leanState`'s body into `openRecord`, with the branch check accepting `record` or `wheelhouse-state`.
- [ ] Run the two test files; commit.

### Task 2: The helper keeps records here

**Files:**
- Modify: `scripts/host/helper.js`, `scripts/host/helper-client.js`, `scripts/state/events.js`, `scripts/state/lock.js` (`ensureClone` only), `scripts/state/clone.js` (deleted), `scripts/state/backup.js` (deleted), `scripts/profile/store.js`
- Test: `tests/scripts/host/helper-state.test.js`, `helper.test.js`, `push-rules.test.js`, `helper-profile.test.js`, `helper-merge.test.js`, `tests/scripts/state/events.test.js`, `tests/scripts/state/lock.test.js`, and every helper test the change breaks.

**Interfaces:**
- Consumes: Task 1's openers.
- Produces: every state route opens the record (`openProjectRecord`) and never pushes; `/state/sync` answers `{ ok: true, pulled: 0, unpushed: 0 }`; `/state/clone` opens the record; `/profile/clone` opens the settings record and `/profile/write`, `/profile/record` write there with no push; `/profile/sync` answers `{ ok: true }`; `/profile/enrolments` and `/state/backup` are gone; `pushOwn` refuses the state branch (only the lock branch is pushed); `stateFresh` and its `STATE_BEHIND` reason are gone; the gate verifies with `[ownKey()]` only; `writeEvent({ project, event, dir, now })` takes no `push`, returns `{ path, pushed: false }`; `syncState` is gone; `ensureClone` in lock.js reads the remote from `readProject(project).remoteUrl`.

- [ ] Tests first: `a state write is committed to the record and not pushed`; `/state/sync answers nothing to do`; `a push of the state branch is refused`; `a profile write goes to settings with no remote`; `the gate does not count an approval signed by another trusted computer`; `the lock clone finds its remote from the project's record`.
- [ ] Implement; delete `clone.js`, `backup.js` and their tests; drop the profile's push, pull, clone and enrolment code from `profile/store.js`, keeping `writeProfileViews` and `readProfileViews`.
- [ ] Run the touched tests; commit.

### Task 3: Setup and uninstall stop making and removing the state branch and the profile

**Files:**
- Modify: `scripts/setup/host.js`, `scripts/setup/computers.js` (retired), `scripts/setup/uninstall.js`, `scripts/setup/uninstall-run.js`, `scripts/setup/own-app.js` where it names the profile, `skills/setup/SKILL.md`
- Test: `tests/scripts/setup/host.test.js`, `computers.test.js` (deleted), `uninstall.test.js`, `joining-run.test.js`, `own-app.test.js`, `tests/e2e/setup.test.js`

**Interfaces:**
- Consumes: `openProjectRecord`, `openSettings`.
- Produces: setup's step 3 makes no profile repository, writes no `profile.json`, publishes no enrolment, clones no state; it opens the project's record and the settings record; `productBranchOn` is gone; a repository that isn't private is accepted (`mustBePrivate`, `notPrivate`, the not-private card gone); joining finds a project by its state branch **or** by `.claude/wheelhouse.json` on its default branch. Uninstall offers no card to delete the state branch or the profile repository and leaves `projects/<project>/record/` in place unless the director clicks its level-4 card (**Keep it** recommended).

- [ ] Tests first: `step 3 makes no profile repository`; `step 3 opens the record and pushes no state branch`; `a public repository is set up`; `uninstall offers no state-branch or profile card`; `uninstall keeps the private record by default`.
- [ ] Implement; run the touched tests; commit.

### Task 4: Trust it, the hourly fetch, the weekly backup and the watcher's sync retired

**Files:**
- Modify: `scripts/hooks/session-start.js`, `scripts/lib/trust-clicks.js` (deleted), `scripts/hooks/prompt-record.js`, `scripts/state/card-lines.js`, `scripts/jobs/weekly.js`, `scripts/jobs/weekly-main.js`, `scripts/watcher/sources.js`
- Test: `tests/scripts/hooks/session-start.test.js`, `prompt-record.test.js`, `tests/scripts/jobs/weekly.test.js`, `tests/scripts/watcher/sources.test.js`, `tests/scripts/mod/press.test.js`, `buttons.test.js`

**Interfaces:**
- Produces: the session start hands no trust card and asks for no enrolments; the weekly job checks the sources only; the watcher's observation never asks for `/state/sync`. The `trust` action kind stays readable in old records.

- [ ] Tests first: `the session start hands no trust card`; `the weekly job makes no backup`; `an observation asks for no sync`.
- [ ] Implement; run; commit.

### Task 5: Import from v0.1.x

**Files:**
- Create: `scripts/state/import.js`
- Modify: `scripts/host/helper.js` (`/state/import`, `/profile/import`), `scripts/host/helper-client.js`, `scripts/hooks/session-start.js`
- Test: `tests/scripts/state/import.test.js`, `tests/scripts/hooks/session-start.test.js`

**Interfaces:**
- Produces: `importEvents({ from, to, enrolled, now }) -> Promise<{ imported: number, held: number, unsigned: number }>`: every event `listEvents(from)` reads is written to `to` at its own `eventPath` with its own id, unless an event with that id is in `to` (held) or it is a signed kind whose signature `verify(event, enrolled)` refuses (unsigned); one commit for the lot; nothing pushed; `from` untouched. The helper's `/state/import { project }` runs it from `oldStateDir(project)` into the record under `state:<project>` and keeps `projects/<project>/imported.json` `{ at, imported, held, unsigned }`; `/profile/import` does the same from `oldProfileDir()` into settings, keeping `settings-imported.json`. The session start calls both once when the old folder is there and no mark is, and says one line when anything was imported.

- [ ] Tests first: `an unpushed event in the old clone is imported` (Review Focus 1); `a signed event from an untrusted key is skipped` (2); `importing twice adds nothing` (3); `a Lean record at state/ is imported` (5); `the old folder is left as it was`; `the session start imports once and says so`.
- [ ] Implement; run; commit.

### Task 6: The design and the data note

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md` (sections 9, 11, 12, 15, 21, 22 and 24), `docs/data.md`, `HANDOVER.md` lines naming the state branch or the profile, `SECURITY.md` if it names them.

- [ ] Mark parts 1, 2 and 5 as built in 24.6 and the section's preamble; say part 3's rulings and designs stay in the private record until it ships, and that the delete cards of 24.5 step 4 and joining by `.claude/wheelhouse.json` alone come with part 4.
- [ ] In sections 9, 11, 12, 15 and 21 and `docs/data.md`, describe the local record and settings in place of the state branch and the profile; the lock branch stays.
- [ ] Commit.
