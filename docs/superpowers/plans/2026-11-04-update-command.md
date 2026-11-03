<!-- docs/superpowers/plans/2026-11-04-update-command.md -->
# Updating Wheelhouse with one command: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan part by part. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/wheelhouse:update` finds a release, asks one card, moves the project's release through the usual reviewed change, installs it at every scope on this computer, hands over to the new helper, and records the update so the own-files look stays quiet. The director then starts a new session.

**Architecture:**
- The helper runs the update as a journalled job (`~/.wheelhouse/update/<project>/journal.json`) that carries on from where it stopped.
- The installed (old) version's code runs the job up to the install. The new version's code finishes it, from its new plugin folder, as a detached process.
- The session only runs `scripts/update/cli.js`, which talks to the helper, in the uninstall pattern: `plan`, `apply <hash>`, `status`.
- A computer on v0.2.6 or earlier gets there once by a Terminal paste (`cli.js bootstrap`).

**Tech Stack:** Node.js 22 (ES modules), `node:test`, git through `scripts/lib/safe-git.js`, the `claude` command through `scripts/lib/claude.js`. No dependency.

**Spec:** `docs/specs/2026-11-04-update-command-design.md`. The checks behind it are in `docs/checks/94-update-routes.md`.

**How to use this plan.**
- Each part is one fresh session, working from this file, the spec and the repository. Build parts run on the mid-sized model at medium effort, each with one final reader on the larger model at medium for parts 3, 4, 7 and 8.
- Each part ends with a pull request and one message to the main session.
- Run the test files a change touches; leave `npm test` to CI.
- Builders ask the main session, never the director.

## Global Constraints

- Every new file starts with its repository-relative path comment.
- British English. Dates as day month year (4 November 2026). The director is "the director", they/them.
- No model names and no AI attribution in code, comments, commits or pull requests.
- Scripts are Node.js, running on macOS and on Windows without administrator rights. Never `gh` or `glab` for anything the update needs.
- Nothing writes the project's committed `.claude/settings.json` in the main checkout. Its `ref` moves only by the reviewed change on `wheelhouse-release-<commit>` (or `wheelhouse-undo-<commit>`).
- `claude plugin marketplace add` is never run with `--scope project`. It rewrites the committed file (check 94).
- No process is ended by its name. A process is stopped only after the proofs of spec section 7.3 hold, and only after the director's card.
- The Update click is never the approval for the reviewed change (spec section 6.2, D3).
- The own-files skip list is exactly `.in_use` and `.orphaned_at` at the top of a plugin folder, by name.
- Latest is the highest plain `vX.Y.Z` tag. Pre-releases (`vX.Y.Z-<label>`) are only installed when named, and never announced.
- Release tags are not cut by any part.

## Review Focus

1. **Two updates started at once** (two sessions, or a session and the Terminal bootstrap): exactly one runs, and the other says one is under way. Part 5 adds `journal: a second lock is refused while the first is held`.
2. **The network drops between the catalogue move and the plugin update:** a second `apply` carries on, and never leaves the clone at the new tag while the installs stay old with no line. Part 6 adds `install: a failed plugin update after the catalogue moved puts the catalogue back`.
3. **A process number reused** by another program after the helper ended, or the helper's process belonging to another user: nothing is stopped. Part 4 adds `old helper: a reused pid stops nothing` and `old helper: another user's process stops nothing`.
4. **The director's own entries in `.claude/settings.local.json`** (their status line, their own allow rules) survive the update's refresh and its put-back. Part 8 adds `finish: the director's own local entries are kept`.
5. **All stop turned on while the job waits for the merge:** the job holds, installs nothing, and carries on only after it lifts. Part 7 adds `wait: All stop during the wait holds the install`.

## Order and what can run together

| Part | Name | Needs | Can run alongside |
|---|---|---|---|
| 1 | Versions and finding a release | none | 5, 12 |
| 2 | The own-files look | 1 | 3, 5, 6 |
| 3 | The helper's running record and retire for an update | 1 | 2, 5, 6 |
| 4 | Proving and stopping an old helper | 3 | 5, 6, 7 |
| 5 | The journal and the job | none | 1, 2, 3, 4, 12 |
| 6 | Installing on this computer, and putting back | 1, 5 | 2, 3, 4, 7 |
| 7 | The reviewed change and the waits | 1, 5 | 4, 6 |
| 8 | The second half | 2, 3, 4, 6 | 10 |
| 9 | The command, its cards and the helper's routes | 6, 7, 8 | 10 |
| 10 | The board's lines and the weekly look | 1, 5 | 8, 9, 11 |
| 11 | Bootstrap from v0.2.6 by Terminal | 9 | 10, 12 |
| 12 | Lean's update skill | none | any |
| 13 | Rehearsals, rulings and documents | all | none |

## Part 1: Versions and finding a release

**Files:**
- Create: `scripts/update/release.js`.
- Modify: `scripts/host/retire-helper.js` (full semantic version precedence); `scripts/lineage/release.js` (split the mirror's fetch and its tag checks out of `checkRelease` into an exported `fetchTag`, and keep `checkRelease`'s answers unchanged).
- Tests: `tests/scripts/update/release.test.js`, `tests/scripts/host/retire-helper.test.js`, `tests/scripts/lineage/release.test.js`.

**Interfaces (produces):**
- `compareVersions(a: string, b: string): -1 | 0 | 1 | null`. Semantic versioning precedence, a leading `v` allowed, a pre-release below its release. Null when either is unreadable. `isOlder(version, own)` becomes `compareVersions(version, own) === -1`.
- `listReleases({ run, url = WHEELHOUSE_URL }): Promise<{ tag, sha }[]>`, from `git ls-remote --tags` through `safeGit`, peeled tags preferred.
- `latestRelease(list): { tag, sha } | null`. The highest plain `vX.Y.Z`.
- `fetchTag({ ref, run, mirror }): Promise<{ ok: true, sha } | { ok: false, why }>`. Fetches the tag and the default branch into the mirror and checks the tag is on the default branch. **The tag ref stays in the mirror** (`refs/wheelhouse/tags/<tag>`) for part 2.
- `checkTarget({ tag, sha, run, mirror }): Promise<{ ok, why?, version, says, nodeFloor, claudeFloor }>`. `plugin.json`'s version must equal the tag less its `v`. `says` comes from `lineage/release.json` (null when it isn't there). The floors come from the manifest (`claudeCode.floor`, and a new `node.floor`).
- `tagTree({ tag, run, mirror }): Promise<Map<path, blobHash>>`.

- [ ] Tests:
  - `compareVersions('0.3.0-rc.1', '0.3.0') === -1`;
  - `compareVersions('v0.2.10', '0.2.9') === 1`;
  - `compareVersions('rc', '0.2.0') === null`;
  - `isOlder('0.2.6', '0.2.7') === true` and `isOlder('0.3.0-rc.1', '0.3.0') === true`;
  - `latestRelease` skips `v0.3.0-rc.1` and `v0.2` and picks `v0.2.10` over `v0.2.9`;
  - `checkTarget` refuses a tag whose `plugin.json` says another version, with `why` naming it;
  - `checkRelease`'s existing tests pass unchanged.
- [ ] Add `node: { floor: '22.0.0' }` to the manifest builder (`scripts/lineage/manifest.js`), and `says` to `lineage/release.json`'s documented shape.
- [ ] Commit: "Find Wheelhouse releases and compare versions in full".

## Part 2: The own-files look

**Files:**
- Modify: `scripts/health/own-files.js`, and where `scripts/host/helper.js` calls it (`guardLines`).
- Tests: `tests/scripts/health/own-files.test.js`.

**Interfaces:**
- Consumes: `tagTree` (part 1).
- Produces:
  - `pluginFoldersInUse({ claudeHome, projects }): { folder, version, projects: string[] }[]`, from `installed_plugins.json`.
  - `recordUpdate({ from, to, at, answer, wrote: { file, hash }[] })`, written by part 8.
  - `checkOwnFiles(...)`, which now keeps `{ folders: { [folder]: { version, files } }, others: { files }, updates: [...] }` and gives `{ changed, calm?: string }`.

- [ ] The skip: `.in_use` (a folder) and `.orphaned_at` at a plugin folder's top are never hashed. Test `own-files: Claude Code's bookkeeping makes no line` plants both and changes `.in_use/<pid>` between two looks.
- [ ] One entry per folder in use. A folder no install lists drops out. Test: two projects on `0.2.6` and `0.2.7` folders each keep their own entry, and the board line for a project names only its own folder.
- [ ] A version move is accepted only against the tag's tree, using `git hash-object` blob hashes, so a file that is a link is refused.
  - With an update record: accept, and give `calm: 'Wheelhouse was updated to v0.2.7 on 4 November 2026, approved by you'`.
  - Without one: accept on a match, with `calm: 'Wheelhouse moved to v0.2.7 outside the update command'`.
  - A mismatch is a watch line naming the kind.
  - Tests: `own-files: a moved version that matches its tag is calm` and `own-files: one changed file in a moved version is a watch line`.
- [ ] Files the update wrote (Copilot's, the add-on's) are accepted only at the recorded hashes. Test: a later edit to one of them is a watch line.
- [ ] An old `own-files.json` (the flat shape) is read once and replaced, with no line.
- [ ] Commit: "Look at the plugin folders in use and accept a moved version only when it matches its tag".

## Part 3: The helper's running record and retire for an update

**Files:**
- Modify: `scripts/host/helper.js` (`/health`, `/helper/retire`), `scripts/host/helper-main.js` (write and remove the record), `scripts/hooks/session-start.js` (`ensureHelper` uses `compareVersions`), `scripts/lib/paths.js` (`helperRecordFile()`).
- Tests: `tests/scripts/host/helper-retire.test.js` (new), `tests/scripts/hooks/session-start.test.js`.

**Interfaces (produces):**
- `~/.wheelhouse/helper.json`: `{ pid, startTime, version, root, address }`. It is written once the helper listens and removed when it closes. `startTime` comes from `processStartTime` (`scripts/watcher/waker.js`).
- `/health` adds `pid`.
- `POST /helper/retire { forUpdate: true }` gives `{ ok: true, retired: true }` at once. The helper then refuses new work with `'Wheelhouse is updating; try again in a minute'`, finishes the work already running, and closes. Without `forUpdate` it behaves as today.

- [ ] Tests:
  - the record is written after listen and gone after close;
  - `/health` gives the record's pid;
  - retire with `forUpdate` on a busy helper answers `retired: true`, refuses a new `/pr/open` with the set line, and closes once the running request ends;
  - a session start with an `rc` helper running and the final release installed retires it.
- [ ] One-release-back test: start this helper and replay the previous release's client calls (the session start's `/health`, `/state/...` reads, the front desk's `cards`) from a fixture recorded from v0.2.6's `helper-client.js`. Every call answers ok.
- [ ] Commit: "Keep a running record of the helper, and let an update retire it while it is busy".

## Part 4: Proving and stopping an old helper

**Files:**
- Create: `scripts/update/old-helper.js`.
- Tests: `tests/scripts/update/old-helper.test.js`.

**Interfaces:**
- Consumes: `helperRecordFile`, `/health`'s `pid` (part 3); `processStartTime`.
- Produces:
  - `proveRecorded({ client, read, startTime, alive }): Promise<{ pid } | { why }>`. All three must agree: the record, the start time to the second, and `/health`'s pid.
  - `findByAddress({ address, platform, run, user }): Promise<{ pid } | { why }>`.
    - macOS: `lsof -t <address>`, then `ps -o user=,lstart=,command= -p <pid>`. Exactly one pid. Its user is this user. Its command is Node.js running `<claude plugins cache>/wheelhouse/wheelhouse/<v>/scripts/host/helper-main.js`, with `<v>` the version `/health` reported.
    - Windows: the named pipe's server process through PowerShell's `GetNamedPipeServerProcessId`. When PowerShell refuses (constrained language) or anything fails, `{ why: 'not told' }`.
  - `stopProved({ pid, platform, kill, wait }): Promise<{ stopped } | { why }>`. `SIGTERM` on macOS; `process.kill(pid)` on Windows. It then waits for the address to go quiet.
- [ ] Tests, each with stand-ins for `run`, `kill` and the clock:
  - `old helper: a reused pid stops nothing` (start time after the record);
  - `old helper: another user's process stops nothing`;
  - `old helper: two processes at the address stop nothing`;
  - `old helper: a command outside the plugin cache stops nothing`;
  - `old helper: a version other than the one reported stops nothing`;
  - Windows `not told` gives the restart line;
  - a grep test: the file never calls `pkill`, `killall`, `taskkill /IM` or `pgrep`.
- [ ] Commit: "Prove an old helper is Wheelhouse's own before it may be stopped".

## Part 5: The journal and the job

**Files:**
- Create: `scripts/update/journal.js`, `scripts/update/job.js`.
- Tests: `tests/scripts/update/journal.test.js`, `tests/scripts/update/job.test.js`.

**Interfaces (produces):**
- `openJournal(project): { read(), mark(step, state, data?), lock(): release | null, folder }`. Steps: `checks`, `change`, `merged`, `idle`, `backup`, `catalogue`, `installs`, `verify`, `finish`, `done`. States: `todo | running | done | failed`. The lock is one per computer, `~/.wheelhouse/update/lock`, holding `{ pid, startTime, project }`; a lock whose process has gone is taken over.
- `runJob({ project, target, steps, journal }): Promise<{ ok, line, step }>`. It runs the steps in order, skips the done ones, and stops at the first failure with its line.
- `backup(journal, files: string[])` and `restore(journal)`: copies into `<journal folder>/backup/` and back.

- [ ] Tests:
  - `journal: a second lock is refused while the first is held`;
  - a stale lock (dead pid) is taken over;
  - a job stopped after `catalogue` carries on at `installs` and never runs `catalogue` twice;
  - `restore` puts back each file byte for byte, and removes a file that wasn't there before;
  - a journal written by a newer version is read as "carry on with the newer Wheelhouse" and never rewritten.
- [ ] Commit: "Run the update as a journalled job that carries on from where it stopped".

## Part 6: Installing on this computer, and putting back

**Files:**
- Create: `scripts/update/install.js`.
- Modify: `scripts/lineage/release.js` (`reinstall` takes `scopes: ('project' | 'user')[]`, default `['project']`).
- Tests: `tests/scripts/update/install.test.js`, `tests/scripts/lineage/release.test.js`.

**Interfaces:**
- Consumes: `openJournal`, `backup`, `restore` (part 5); `checkTarget` (part 1).
- Produces:
  - `installsOf({ claudeHome, projectDir }): { plugin, scope, projectPath? }[]`, from `installed_plugins.json`, for the plugins the release's catalogue lists.
  - `accountFollowers({ claudeHome, projects }): string[]`: the registered projects with no project-scope install of their own.
  - `moveCatalogue({ tag, scope: 'user' | 'local', run, resolved, projectDir }): Promise<{ ok, why? }>`. Runs `claude plugin marketplace add <address recorded in known_marketplaces.json>#<tag> --scope <scope>`. On refusal it falls back to the `ref` edit and `claude plugin marketplace update wheelhouse`. It then checks the clone's HEAD is the tag's commit.
  - `installRelease({ project, target, journal, run }): Promise<{ ok, line }>`. Spec section 6.4 steps 1 to 5. The scope is `user` only when the account names the catalogue and `accountFollowers` is empty; otherwise it is `local` and the user install is left alone.
  - `putBack({ previous, journal, run }): Promise<{ ok, line }>`. Restores the backups and reinstalls `previous` at each scope moved.
- [ ] Tests, with a fake `claude` that records argv and answers as check 94 saw:
  - argv never contains `--scope project` for `marketplace add`;
  - with a follower project, the user install and the account `ref` stay;
  - `install: a failed plugin update after the catalogue moved puts the catalogue back`;
  - the same plugin version at two commits goes by uninstall then install;
  - a project settings file Claude Code rewrote is put back.
- [ ] Commit: "Install a release at every scope on this computer, and put it back on failure".

## Part 7: The reviewed change and the waits

**Files:**
- Create: `scripts/update/change.js`.
- Modify: `scripts/host/helper.js`. Add a provenance kind, `update` (`{ release, commit }`), accepted by the gate only on `RELEASE_BRANCH`. A non-pins-only release branch merges only with the director's approval card answered for that commit: in Claude Code the signed card answer, with another agent a `CONFIRMED_STEPS` window step named `release-<commit>`.
- Modify: `scripts/host/local/queue.js` for the local queue's same rule.
- Tests: `tests/scripts/update/change.test.js`, `tests/scripts/gate/release-approval.test.js` (new).

**Interfaces:**
- Consumes: `releaseChange`, `releaseBranch`, `undoBranch`, `settingsText`, `canInstall`.
- Produces:
  - `openChange({ project, target, previous, put: 'release' | 'undo' }): Promise<{ ok, pr?, skipped?: 'merged' | 'before-step-7', line }>`;
  - `waitMerged({ project, target }): Promise<{ merged } | { waiting: line } | { closed: line }>`, which checks the main checkout's settings name the tag;
  - `waitIdle({ project }): Promise<{ idle } | { waiting: line }>`;
  - the card the job raises for approval, named `release-<commit>`, with options **Approve** and **Not now**.
- [ ] Tests:
  - a pins-only release merges on review alone;
  - a non-pins-only release without the card answer is refused, and with it merges;
  - an answer for another commit doesn't count;
  - a closed change ends the job with nothing installed;
  - `wait: All stop during the wait holds the install`;
  - a project before setup's step 7 skips the change;
  - a change already merged on another computer is skipped.
- [ ] Commit: "Open the release's reviewed change and wait for it and for work in progress".

## Part 8: The second half

**Files:**
- Create: `scripts/update/finish.js` (run as `node <new folder>/scripts/update/finish.js <project>`).
- Tests: `tests/scripts/update/finish.test.js`.

**Interfaces:**
- Consumes: `refreshLocal` (`scripts/setup/local-refresh.js`), `updateLocked`, the Copilot file writers setup uses, the engine's update step, `recordUpdate` (part 2), `proveRecorded`, `findByAddress`, `stopProved` (part 4), `stopWatcher` and `startWatcher` (`scripts/foreman/start.js`), and the journal.
- Produces: `finish({ project, journal }): Promise<{ ok, line, asks?: card[] }>`. In order:
  1. The refreshes of spec section 6.5. Locked only where this computer has it. The engine only when its pins moved.
  2. `recordUpdate` with every file written and its hash.
  3. The hand-over of spec section 7.2. A v0.2.5 or v0.2.6 helper that refuses as busy is asked again every ten seconds for two minutes. A helper that answers `unknown request`, or is still busy after that, gives an `asks` card from part 9 and waits in the journal for the answer.
  4. The watcher is restarted from the new folder.
  5. `done`, with the last line. It adds a line when the release carries a newer VS Code add-on (install it by hand) or the project runs a Shape 2 foreman (restart it).
- [ ] Tests:
  - `finish: the director's own local entries are kept`;
  - Locked's step runs only with Locked present;
  - with a v0.2.2 helper stand-in, the card is asked and nothing is stopped before its answer;
  - **Leave it** finishes with the restart line;
  - the watcher is stopped only through `stopWatcher`.
- [ ] Commit: "Finish an update from the new version's own code".

## Part 9: The command, its cards and the helper's routes

**Files:**
- Create: `commands/update.md`, `scripts/update/cli.js`, `scripts/update/cards.js`.
- Modify:
  - `scripts/host/helper.js`: routes `/update/plan`, `/update/apply`, `/update/status`, `/update/answer`. The job starts detached, as uninstall's does, and `apply` refuses under All stop.
  - `scripts/protection/settings.js` (`localSettings`): the allow rule for `scripts/update/cli.js` beside setup's.
  - `scripts/hooks/lineage-hold.js`: let `cli.js`'s four forms through.
  - `skills/front-desk/SKILL.md` and `skills/setup/SKILL.md`: "update Wheelhouse", in any words, goes to `/wheelhouse:update`.
- Tests: `tests/scripts/update/cli.test.js`, `tests/scripts/update/cards.test.js`, `tests/scripts/hooks/lineage-hold.test.js`.

**Interfaces:**
- Consumes: parts 5 to 8.
- Produces:
  - `cli.js` forms `plan [<tag>]`, `apply <hash>`, `status` and `answer <card> <label>`, each giving JSON `{ card?, asks?, hash?, lines, started? }`;
  - `cards.js`: `updateCard({ from, to, says, approval, locked, others })` and `stopCard({ version })`, worded as spec sections 4 and 7.3, with **Update** and **Stop it** recommended.
- [ ] `commands/update.md`, in `commands/uninstall.md`'s style:
  1. Run `plan`.
  2. Ask its card exactly as given.
  3. Only on **Update**, run `apply <hash>`.
  4. Run `status` about once a minute, saying nothing between, and ask any `asks` card as given.
  5. Show the last lines as they are.
  6. When nothing is newer, say the one line and stop.
- [ ] Tests:
  - a hash from another plan is refused;
  - `plan` with nothing newer gives the one line and no card;
  - `plan v0.2.5` on a computer with v0.2.7 gives a put-back card;
  - `plan v0.2.6` gives the refusal "can't be put back by this command";
  - `apply` under All stop says "Lift All stop first";
  - a feature session's `apply` is refused;
  - the lineage hold lets the four forms through and nothing else new.
- [ ] Commit: "Add /wheelhouse:update and the helper's update routes".

## Part 10: The board's lines and the weekly look

**Files:**
- Modify: `scripts/board/health.js`, `scripts/board/inputs.js`, `scripts/host/helper.js` (`guardLines`: the weekly look and the job's state), `scripts/hooks/session-start.js` (the one confirming line, from the update record).
- Create: `scripts/update/declined.js`.
- Tests: `tests/scripts/board/health.test.js`, `tests/scripts/update/declined.test.js`.

**Interfaces:**
- Consumes: `listReleases`, `latestRelease` (part 1); the journal (part 5).
- Produces: `declined(project): { tag } | null` and `decline(project, tag)`, both under the project's folder in the Wheelhouse home.

- [ ] Lines, word for word as spec section 14. Each with its test:
  - the version line with "(updated <date>)" for a week;
  - "<tag> is out; type /wheelhouse:update when you want it", not for a declined tag nor a pre-release, from a look at most weekly;
  - the three part-way lines;
  - "This project names <a> but this computer has <b>…";
  - the one confirming line, at the first session after `done`, naming the session's version and the helper's.
- [ ] Commit: "Say on the board when a release is out and how an update stands".

## Part 11: Bootstrap from v0.2.6 by Terminal

**Files:**
- Modify: `scripts/update/cli.js` (form `bootstrap <project folder>`), `README.md` (an "Updating" section with one line for macOS and one for Windows PowerShell, and the hand steps below them).
- Tests: `tests/scripts/update/bootstrap.test.js`.

**Interfaces:**
- Consumes: `checkTarget`, `runJob`, `installRelease`, `finish`, `openChange`, `putBack`.
- Produces:
  - `bootstrap({ projectDir, ask })`, where `ask` reads a typed `1` or `2` from standard input.
  - The order is turned round, as in spec section 13: checks, install, finish (hand-over), then `openChange` through the new helper.
  - A change refused or closed calls `putBack`.
- [ ] The README lines. The Mac line clones the tag into `~/.wheelhouse/update/bootstrap/<tag>` with `git clone --depth 1 --branch <tag>`, then runs `node …/scripts/update/cli.js bootstrap "$PWD"`. The Windows line does the same in PowerShell. Both are run in the project's folder.
- [ ] Tests:
  - a typed answer other than 1 or 2 asks again;
  - nothing is installed before the tag checks out;
  - a closed change after install puts the computer back;
  - the old helper goes through part 4's paths.
- [ ] Commit: "Let a computer on v0.2.6 or earlier update once from Terminal".

## Part 12: Lean's update skill

**Files:**
- Create: `adapters/copilot/home/skills/wheelhouse-update/SKILL.md`.
- Modify: `adapters/copilot/home/MANIFEST.txt`, regenerated with `npm run copilot-home`.
- Tests: the existing Copilot kit tests (`tests/scripts/agents/copilot/*.test.js`) pass with the new skill listed.

- [ ] The skill follows spec section 12.1 step by step, with a Mac block and a PowerShell block per step, in `adapters/copilot/skills/setup-lean/SKILL.md`'s style.
  - Every replaced file is checked with `git hash-object` against `MANIFEST.txt` before anything is replaced.
  - The previous tag's folder is kept.
  - The project's own files change only through Lean's change and the director's click.
- [ ] Commit: "Add Lean's update skill".

## Part 13: Rehearsals, rulings and documents

**Files:**
- Create: `docs/checks/95-update-rehearsal.md`, `probes/95-update/run.md` (the Windows sheet).
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md` (the rulings of spec section 18, in section 21 or 22 as each is), `docs/data.md` (`~/.wheelhouse/update/`, `helper.json`), `HANDOVER.md` if it names updating.

- [ ] The Mac rehearsal against the real GitHub, in a scratch project. It covers:
  - adding again with the recorded `github` address form at a new tag (check 94's open question);
  - v(n) to v(n+1) with a v0.2.2 helper running;
  - a failure injected after each journal step, then carrying on;
  - a put-back;
  - the own-files look the day after, with no line.
- [ ] The Windows sheet for the director's sitting: tags without `gh`, the pipe's server process without administrator rights, line endings in the cache, one update end to end.
- [ ] Commit: "Rehearse the update and add its rulings to the design".
