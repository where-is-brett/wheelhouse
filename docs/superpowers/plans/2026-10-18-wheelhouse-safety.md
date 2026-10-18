<!-- docs/superpowers/plans/2026-10-18-wheelhouse-safety.md -->

# Wheelhouse safety: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build what keeps agents inside the lines: the helper's routes for state and the lock, the merge gate's conditions worked out from a pull request's changed files, STOP and bypass in the helper, the hooks, the Standard and Locked settings, and the runbook; and close the items the state-and-host plan parked.

**Architecture:** The helper stays the one program that holds keys and reaches the host; this plan moves every state and lock write behind it, and teaches it to read STOP, bypass and the guardrails itself, so a lying caller gains nothing. The hooks are small Node.js scripts under `scripts/hooks/`, each a pure `decide(input, deps)` with a thin entry, registered by the plugin's `hooks/hooks.json` (Standard) and, for Locked, copied with the rest of `scripts/` into the administrator-only folder and named in `managed-settings.json`. Settings are built by functions, never hand-written, so setup and the tests use the same source.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies. `git`, `gh` and `glab` as child processes; `git http-backend` for the stand-in host that wants a key.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, sections 9 (state, the lock, signed records), 10 (the context gauge and PreCompact guard), 11 (the helper), 12 (safety, all of it) and 17.2 (build order, "safety"). Read with `HANDOVER.md` (next steps, step 3), the check notes `docs/checks/08`, `10`, `11`, `12` and `18`, and the state-and-host ledger, `.superpowers/sdd/2026-10-18-wheelhouse-state-and-host/progress.md` (Rulings 11 to 21 and every "minor (deferred)" line).

## Scope

The third plan, and the "safety" line of design section 17.2. Its first items are the two HANDOVER step 3 names: helper routes for state and the lock (Ruling 19), and working out `approvalRequired` and `touchesGuardrails` from a pull request's changed paths (Ruling 15). It also takes every item the state-and-host plan parked (the table below).

It builds no agent, skill, board or setup screen, and not the data note (design section 12.8), which ships with setup. Where those will call something this plan builds (the front desk asking for a card, setup writing settings, the board's health line), this plan builds the function and its test, and the later plan calls it. The mod is not built here; the prompt record works from card clicks alone until it is (check 8).

## Decisions for the director

Answered by the director on 18 October 2026, with the plan's approval (to run subagent-driven):

- **Card A, changes to CI: "One click from me."** A CI file decides what runs on the host's computers, with the project's CI secrets; on GitLab, and with the quick connection, a pushed branch would run its own CI file before anyone reviewed it (ledger, Task 4 minor). So the helper never pushes a CI change with the connection's key. The agent drafts it; a card tells the director in plain words what it changes; the director's click (a signed `action` `ci-push`, Task 8) lets the helper push that exact commit with the director's own sign-in. It then needs a review and the director's approval to merge, like any guardrail change (Task 3).
- **Card B, what Locked changes on the Mac: "Locked projects only."** Locked's computer-wide file holds the hooks, the deny rules that are safe everywhere, `allowUnsandboxedCommands: false` and `allowManagedDomainsOnly: true`, but doesn't switch the sandbox on computer-wide; Locked's own hook refuses commands in a Locked project whose settings don't switch it on. The director's other projects stay as they are (Task 13).

## Global Constraints

Everything in the state-and-host plan's Global Constraints holds (`docs/superpowers/plans/2026-10-18-wheelhouse-state-and-host.md`): Node.js 22 or later, no npm dependencies, ESM `.js`, `node:test` in `tests/**/*.test.js`, macOS and Windows, the path comment on every file, British or Australian English, no model identifiers anywhere and no `Co-Authored-By` line naming a model, secrets only in a child's environment and never in output, everything under `wheelhouseHome()`, branches `wheelhouse-state` and `wheelhouse-lock`, times in UTC ISO 8601 with a `now` argument, child processes through `run`. In addition:

- **Hooks never run `git` (or anything else) in a folder an agent controls.** A folder's own git configuration can run a command (`core.fsmonitor`, `core.hooksPath`), and hooks run outside the sandbox. Hooks read `.git` files with `fs`; anything that needs git goes to the helper, which runs it in its own repositories.
- **Hooks fail closed where they guard and open where they inform.** A guard (STOP, the tool guard, Locked's sandbox check) that throws answers deny with "Wheelhouse's check could not run". A hook that only adds context (the reload, the gauge) that throws says nothing.
- **Hooks are quick.** No hook waits on the network except the session start (which starts the helper) and the prompt record (which asks the helper for a pull request's head); each has a 10-second limit.
- **Only hooks sign.** Hooks run outside the sandbox and read the signing key themselves. The helper has no route that signs anything.
- **The caller may only raise a gate condition, never lower it.** STOP, bypass, `approvalRequired` and `touchesGuardrails` are worked out by the helper; a caller's `true` adds to them, its `false` changes nothing.
- **The project's configuration** is `.claude/wheelhouse.json` on the default branch (Task 2). The helper reads it from the default branch's commit, never from a pull request or a working folder.
- **The plugin root** is `${CLAUDE_PLUGIN_ROOT}` in `hooks/hooks.json`; scripts find it from `import.meta.url`, never from the working folder.

## Review Focus

1. **A hook in a folder with a hostile git configuration.** A worktree whose `.git/config` sets `core.fsmonitor` to a command. Expected: no hook runs it; `projectOf` reads files only. Owning task: Task 5 (a test whose `run` fails if called).
2. **A signed record sent twice.** An agent replays a real, signed approval or confirmation to `/state/record`. Expected: refused, because its id is already in the state; a duplicate can't make a confirmed ruling look damaged (Ruling 21). Owning task: Task 1.
3. **A pull request that dodges the guardrails.** It renames a file out of `.claude/`, deletes a critical area from `.claude/wheelhouse.json`, or its head moves between the check and the merge. Expected: the old path counts, the default branch's configuration counts, and the merge pins the head that was checked. Owning task: Task 2.
4. **STOP in an odd state.** STOP is a folder rather than a file, unreadable, or set while a merge is queued behind another. Expected: anything at STOP's path means on; a queued merge reads STOP when its turn comes, not when it was asked. Owning task: Task 4.
5. **Windows paths.** A home folder with a space, Node.js under `C:\Program Files\`, and `.ENV.local` in capitals. Expected: hook commands quote both paths, and the `.env` match ignores case on Windows. Owning tasks: Task 7 (the guard), Task 13 (the hook commands).

## File structure

```
scripts/lib/projects.js          the project record: folder, remote, host, repository, connection
scripts/lib/stop.js              STOP: set, lift, read
scripts/lib/bypass.js            which sessions are in bypass mode
scripts/gate/glob.js             path patterns, no dependencies
scripts/gate/guardrails.js       the project's configuration, and classifying changed paths
scripts/host/helper.js           (changed) state, lock, STOP and runbook routes; changed paths; push rules
scripts/host/helper-main.js      the real helper, built from the project records
scripts/host/helper-client.js    (changed) the new routes
scripts/hooks/kit.js             reading input, answering, finding the project
scripts/hooks/session-start.js   starts the helper; reloads state
scripts/hooks/stop-guard.js      STOP and bypass, before every tool
scripts/hooks/stop-word.js       "stop" and /stop
scripts/hooks/tool-guard.js      secrets, credentials, the host tools, connectors
scripts/hooks/prompt-record.js   card clicks
scripts/hooks/report-check.js    builder and reviewer reports; review records
scripts/hooks/context-gauge.js   the context gauge
scripts/hooks/precompact-guard.js
scripts/protection/settings.js   Standard: the project's and this computer's settings
scripts/protection/locked.js     Locked: the computer-wide file, install, update, remove
scripts/runbook/runbook.js       the runbook's steps, through the helper
hooks/hooks.json                 the plugin's hooks
commands/stop.md                 /stop
templates/runbook.md             the runbook each project gets
tests/helpers/http-host.js       a stand-in host that refuses keyless fetches
tests/e2e/safety.test.js
```

## The parked items

Every "minor (deferred)" line and parked ruling in the state-and-host ledger, and where it goes. An item marked "left" is not built, for the reason given.

| From | Item | Goes to |
|---|---|---|
| Ruling 19 | State and lock work outside the helper can't fetch with the narrow connection on a private repository | Task 1 |
| Ruling 15 | `approvalRequired` and `touchesGuardrails` from the caller | Task 2 |
| Ruling 21 | A duplicate id can hide a confirmed ruling | Task 1 (refuse replays), Task 10 (the reload shows damage first) |
| Ruling 21 | Escaped keys in a non-JSON file under `events/` | Task 3 (the helper's state push refuses any file under `events/` that isn't JSON, and scans with `scanContent`) |
| Task 11 | An approval of an earlier commit whose screenshots of every changed page are identical (design section 12.3) | Left: the agents plan, which takes the screenshots. Until then only the exact commit counts, so the director is asked again: it fails safe |
| Ruling 11 | The board says when a project has no CI | Left: the board plan. The gate already refuses (design section 12.3) |
| Task 4 | A Developer-level GitLab key can push a CI file change | Task 3, as card A decided |
| Task 4 | Design wording at lines 77, 463, 470–471, 564, 745 and 755 | Task 17 |
| Task 14 | `dir` may be any local repository | Task 3 (inside the project's folder) |
| Task 14 | An agent can write any `lock.json` through `/push` | Task 1 (state and lock branches no longer accepted from callers) |
| Task 14 | Lazy fetch on git older than 2.45.1 | Task 3 (refuse a folder set up as a partial clone, read with `fs` before git runs) |
| Task 14 | Windows timeout kills git only, not its children | Task 16 |
| Task 14 | `/pr/open` has no base or head rule | Task 3 (head must be a branch the push rules allow; base must be the default branch) |
| Task 14 | The mirror is never pruned | Task 16 (`git gc --auto` and dropping `refs/wheelhouse/*` after each push or merge) |
| Task 14 | Push and merge contend on the lock clone | Left: fails closed, and `oneAtATime` already orders them |
| Task 14 | Stripping `GIT_*` drops the director's `GIT_SSH_COMMAND` in quick mode | Task 17 (said in the design's quick-connection paragraph) |
| Task 14 | Push timeout untested | Task 16 |
| Task 14 | `upload-pack` reads the folder's own configuration | Left: git honours `uploadpack.packObjectsHook` only from system and global configuration, never a repository's; Task 16 adds a test that pins it |
| Task 1 | `github-app.js`: a JSON parse error can quote a body fragment; a `null` body; a missing `interval` spins | Task 16 |
| Task 1 | `refreshToken` or its expiry may be `null` | Task 16 |
| Task 1, 2 | Probe-only items (`run.js` wording, the sandbox gate's "unknown", glab's newline match) | Left: probes whose checks are answered |
| Task 3 | `protection.js` maps any error to "could not be reached"; a dropped POST reports "now unprotected" | Task 16 |
| Task 5 | `run()` can't unset a variable; `withHome` leaves temporary folders | Task 16 |
| Task 6 | `enrol` drops every computer when `enrolled.json` is damaged, and isn't atomic; `enrol` doesn't check its entry; `canonicalJson` takes `Date`, `Map`, `Set` and sparse arrays | Task 15 |
| Task 7 | `database-url` is case-sensitive and can match across `/`; quadratic on long lines; near-miss tests thin | Task 15 |
| Task 8 | `syncState` returns nothing; empty month folders left after a failed commit; a crash mid-start is refused with no hint; the origin compared as an exact string; two `cloneState` calls on one computer | Task 15 |
| Task 9 | Views renamed one by one | Task 15 (write to a new folder, then rename the folder) |
| Task 9 | A proposed ruling superseded by a confirmed one shows as superseded | Left: that is the right answer, now written in Task 17's design note |
| Task 10 | An unreadable or malformed remote `lock.json` counts as free | Task 15 (fail closed: refused, "the lock can't be read") |
| Task 10 | `readLock` shape unchecked; lock clone's remote unchecked; a future-dated bundle blocks backups; two round trips in `holdsLock` | Task 15 |
| Task 11 | No test with `sig` removed entirely, or with `enrolled` missing | Task 15 |
| Task 12 | Merge queue gives `merged: true`; GitLab `mergeable: 'no'` includes "CI still running"; an unknown PR state reads as closed; merged-results pipelines read as none; merge failures not told apart; the env scrub untested alone and hides plain words | Task 16 |
| Task 13 | A renewal reply without a new renewal key; refusal code dropped; a malformed `accessExpiresAt` renews every call; dead `clientSecret` argument in a test; `GITLAB_HOST` drops a GitLab served under a path | Task 16 |
| Task 15 | GitHub `on` ignores bypass actors and drift; the plan read for another owner's repository; GraphQL errors read as no checks; missing test cases | Task 16 |
| Task 16 | The end-to-end test hard-codes `2026/10` (fails from 1 November 2026); `g()` duplicated | Task 15 |

---

## Part 1: the helper first

### Task 1: State and the lock through the helper (Ruling 19)

**Files:**
- Create: `scripts/lib/projects.js`, `scripts/host/helper-main.js`, `tests/helpers/http-host.js`
- Modify: `scripts/host/helper.js`, `scripts/host/helper-client.js`, `scripts/state/events.js` (`syncState` result; see Task 15 for the rest)
- Test: `tests/scripts/lib/projects.test.js`, `tests/scripts/host/helper-state.test.js`

**Interfaces:**
- Consumes: `cloneState`, `writeEvent`, `syncState`, `listEvents`, `makeEvent`, `PLAIN_KINDS`, `PROTECTED_KINDS` (`scripts/state/events.js`); `takeLock`, `touchLock`, `readLock` (`scripts/state/lock.js`); `writeViews` (`scripts/state/views.js`); `verify`, `readEnrolled` (`scripts/state/signing.js`); `childEnv` (`scripts/host/connection.js`); `makeAdapter` (`scripts/host/adapter.js`).
- Produces:
  - `ProjectRecord = { folder: string, remoteUrl: string, host: 'github' | 'gitlab', repo: string, connection: Connection }` at `projects/<project>/project.json`. `readProject(project) -> ProjectRecord | null`; `writeProject(project, record) -> void` (atomic: temporary file, then rename). `writeProject` refuses a `remoteUrl` that doesn't name `repo` (compared case-insensitively, `.git` suffix ignored, `https://`, `ssh://` and `git@host:` forms all read). Setup writes it; tests write it.
  - `projectForFolder(folder: string) -> { project: string, record: ProjectRecord } | null`: the record whose `folder` contains `folder` (real paths, case-insensitive on Windows and macOS).
  - Helper routes, each `POST` with `project`:
    - `/state/clone {}` → `{ ok: true }`. The remote comes from the record, never the request.
    - `/state/write { kind, data }` → `{ ok: true, id, pushed }`. Plain kinds only; the helper makes the event (`makeEvent`), so its id and time are the helper's.
    - `/state/record { event }` → `{ ok: true, id, pushed }`. Protected kinds only, and only when `verify(event, readEnrolled())` holds, `event.sig.computer === computerId()`, and no event in the clone has the same id.
    - `/state/sync {}` → `{ ok: true, pulled: boolean, unpushed: number }`.
    - `/state/views {}` → `{ ok: true, views }` (built by `writeViews`).
    - `/lock/take {}`, `/lock/touch {}`, `/lock/read {}` → `takeLock`'s, `touchLock`'s and `readLock`'s results under `result`.
  - Each of these runs `cloneState` first when the clone is missing, uses the request's `ctx.gitEnv`, and pushes through an internal `pushOwn(project, branch, ctx)` that takes the source from the helper's own clone (the code `doPush` already uses after its folder check). `/push` refuses `wheelhouse-state` and `wheelhouse-lock` with `PUSH_REFUSALS.ownRequests` = `'state and the lock are written through their own requests'`.
  - `helperClient` gains `state: { clone, write, record, sync, views }` and `lock: { take, touch, read }`; `pushFor` is removed (its callers move to these routes).
  - `helper-main.js`: `startRealHelper({ address, fetch, now }) -> Promise<{ address, close() }>`, calling `startHelper` with `adapterFor(project, { env })` = `makeAdapter({ host: record.host, repo: record.repo, run, env })` and `envFor` = `envForConnection(project => readProject(project).connection)`. Run as a script, it starts the helper and stays up.
  - `startHttpHost({ root, token }) -> Promise<{ url: string, close(), refusedCount(): number }>` in `tests/helpers/http-host.js`: a `node:http` server that runs `git http-backend` (from `git --exec-path`) as CGI over `root`, with `GIT_HTTP_EXPORT_ALL=1`, and answers 401 to any request whose `Authorization` header isn't `Basic base64("x-access-token:" + token)`.

- [ ] **Step 1: Write `tests/helpers/http-host.js`,** and a test that `git ls-remote <url>` without a header fails and with `-c http.extraHeader=...` succeeds.
- [ ] **Step 2: Write the failing tests.**

```js
test('narrow on a private repository: clone, write, sync and the lock all work through the helper', ...)
  // http host with token T; envFor gives the extraheader for T; /state/clone, /state/write (ruling),
  // /lock/take → counter 1; /state/sync → { pulled: true, unpushed: 0 }; the host saw no keyless fetch succeed
test('the same calls made without the helper are refused by the host', ...)
  // cloneState with env {} against the http host → throws; proves the stand-in host is strict
test('the state clone comes from the project record, never from the request', ...)
  // /state/clone { remoteUrl: 'file:///elsewhere' } → the clone's origin is the record's remoteUrl
test('writeProject refuses a remote that does not name the repository', ...)
test('/state/write refuses a protected kind', ...)
test('/state/record accepts a record signed by this computer, and refuses one unsigned, altered, or signed by another computer', ...)
test('/state/record refuses an id the state already holds', ...)   // Review Focus 2
test('/push refuses wheelhouse-state and wheelhouse-lock from a caller', ...)
test('two computers writing at once through their own helpers both land', ...)
test('no answer from a state or lock route carries the key', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL, routes not found.
- [ ] **Step 4: Implement** `projects.js`, the routes, `pushOwn`, the client and `helper-main.js`. Move `tests/e2e/state-and-host.test.js` from `pushFor` to the new routes.
- [ ] **Step 5: Run `npm test`.** Expected: PASS on the Mac and in CI on all three systems (Windows runs `git http-backend` from Git for Windows).
- [ ] **Step 6: Commit.**

```bash
git add scripts tests
git commit -m "Write state and the lock through the helper, with the connection's key"
```

### Task 2: The gate's conditions from the changed files (Ruling 15)

**Files:**
- Create: `scripts/gate/glob.js`, `scripts/gate/guardrails.js`
- Modify: `scripts/host/helper.js` (`doMerge`)
- Test: `tests/scripts/gate/glob.test.js`, `tests/scripts/gate/guardrails.test.js`, `tests/scripts/host/helper-merge.test.js`

**Interfaces:**
- Produces:
  - `matchGlob(pattern: string, file: string) -> boolean`: `/` separators only; `*` any run within one segment, `**` any run of whole segments including none, `?` one character; no braces or classes. Case-sensitive. `**/CLAUDE.md` matches `CLAUDE.md`.
  - `Config = { v: 1, criticalAreas: Array<{ name: string, paths: string[], checks: string[] }>, ciFiles: string[], mcpServers: string[], webDomains: string[], runbook?: { contain?: { describe: string, command: string[] } } }`, the project's `.claude/wheelhouse.json`. Later plans add keys (the routing table); unknown keys are kept and ignored.
  - `readConfig(text: string | null) -> Config`: `null` (no file) gives the empty config; anything else must parse and match the shape, or it throws `"The project's Wheelhouse configuration can't be read"`.
  - `GUARDRAILS = ['.claude/**', '**/CLAUDE.md', '.mcp.json']` and `CI_FILES = ['.github/workflows/**', '.github/actions/**', '.gitlab-ci.yml', '.gitlab/**']` (design section 12.4: the Claude Code settings, the Wheelhouse configuration inside `.claude/`, `CLAUDE.md`, CI; `.mcp.json` because it names the connectors agents get).
  - `classifyChange({ paths: string[], config: Config }) -> { touchesGuardrails: boolean, guardrailPaths: string[], criticalAreas: string[] }`. Guardrail patterns are `GUARDRAILS`, `CI_FILES`, `config.ciFiles` and every area's `checks`; a file in an area's `paths` names that area.
  - In the helper, `changedPaths({ mirror, host, number, headSha, defaultBranch, run }) -> Promise<{ paths: string[], config: Config }>`: a keyed fetch into the mirror of `refs/pull/<n>/head` (GitHub) or `refs/merge-requests/<n>/head` (GitLab) to `refs/wheelhouse/pr/<n>`, and of the default branch to `refs/wheelhouse/base`; throws unless the fetched head is `headSha`; paths from `git diff --name-only -z --no-renames <merge-base> refs/wheelhouse/pr/<n>`; the configuration from `git show refs/wheelhouse/base:.claude/wheelhouse.json` (missing file → `readConfig(null)`).
  - `/merge` now: `touchesGuardrails = classified.touchesGuardrails || body.touchesGuardrails === true`; `approvalRequired = body.approvalRequired === true || touchesGuardrails`; `reviewRequired` stays `true`. If `changedPaths` or `readConfig` throws, both are `true` and the reasons gain `"the changed files couldn't be read, so this needs the director's approval"`. Every answer carries `guardrailPaths` and `criticalAreas`. (Supersedes Ruling 14's "absent counts as true" for these two: the helper now works them out.)

- [ ] **Step 1: Write the failing tests.**

```js
test('matchGlob: ** spans folders, * stays in one, **/X matches X at the top', ...)
test('a change under .claude/ touches the guardrails', ...)
test('CLAUDE.md in any folder, .mcp.json, workflows and GitLab CI files touch the guardrails', ...)
test('a critical area\'s check file is a guardrail; a file in the area only names the area', ...)
test('readConfig: no file is the empty config; a malformed one throws', ...)
test('/merge needs the director\'s approval for a guardrail change even when the caller says false', ...)
test('/merge with no guardrail change and no caller flag needs no approval', ...)
test('/merge counts a rename out of .claude/ by its old path', ...)                       // Review Focus 3
test('/merge reads the configuration from the default branch, not the pull request', ...) // Review Focus 3
test('/merge refuses when the fetched head differs from the head the host reports', ...)  // Review Focus 3
test('/merge treats unreadable changes or configuration as touching the guardrails', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement** `glob.js`, `guardrails.js` and the helper's part. The merge still pins `headSha` (it already does).
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/gate scripts/host/helper.js tests
git commit -m "Work out the guardrails and the director's approval from a pull request's changed files"
```

### Task 3: The push rules tightened

**Files:**
- Modify: `scripts/host/helper.js` (`doPush`, `checkPush`, `/pr/open`, `pushOwn`)
- Test: `tests/scripts/host/push-rules.test.js`

**Interfaces:**
- Consumes: `classifyChange`, `CI_FILES`, `readConfig` (Task 2); `readProject` (Task 1); `scanContent` (`scripts/state/secret-scan.js`); the `action` kind and `ciPushLine` (Task 8: build Task 8's `events.js` and card-line part before this task's CI rule).
- Produces, in `PUSH_REFUSALS`:
  - `ciFile`: `'the branch changes a CI file, so it needs the director\'s click on its card'`. A code push is refused when `git diff --name-only <merge-base with the default branch> <sha>` holds a path matching `CI_FILES` or the default branch's `config.ciFiles`, unless a signed `action` `ci-push` from the last ten minutes names this branch and this exact commit (card A). Then the helper pushes it with the director's own sign-in: the quick environment (`{}`, keeping the system and global git configuration, as Ruling 17 does), never the narrow key, whatever the project's connection. Where the director isn't signed in, the refusal says so: `'sign in to GitHub (or GitLab) on this computer to push the CI change'`.
  - `/ci-push/line { branch, sha }` → `{ ok: true, line }`, the card line from Task 8's `ciPushLine`, so the front desk asks with the exact words.
  - `outsideProject`: `'the folder to push from is not inside the project'`, when `realpath(dir)` is not the record's `folder` or inside it.
  - `partialClone`: `'the folder is set up to fetch missing objects from elsewhere, so it is not read'`, when the folder's git configuration (found with `fs`: `.git` as a folder, or a `.git` file's `gitdir:` and that folder's `commondir`) contains `promisor` or `partialclone`, case-insensitive. Checked before any git runs in the folder.
  - `notJson`: for a state push, any added file under `events/` that doesn't parse as JSON. The state push's secret scan uses `scanContent`.
  - `/pr/open` refuses a `base` other than the default branch and a `head` that `checkRefspec` refuses.

- [ ] **Step 1: Write the failing tests.**

```js
test('a branch that changes .github/workflows is refused, naming the rule', ...)
test('a branch that changes .gitlab-ci.yml or a file the configuration lists in ciFiles is refused', ...)
test('a branch whose CI file matches the default branch\'s is allowed', ...)
test('a CI change with the director\'s fresh click for this commit is pushed with the director\'s sign-in, not the key', ...)
test('a click for another commit, or older than ten minutes, does not count', ...)
test('a push from a folder outside the project is refused', ...)
test('a push from a partial clone is refused, and git never ran in it', ...)
test('a state push holding a file that is not JSON is refused', ...)
test('a state push with a key hidden as \\u escapes in JSON is refused', ...)
test('/pr/open refuses a base other than the default branch, and a head the push rules refuse', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/host/helper.js tests
git commit -m "Push CI changes only on the director's click, and refuse folders outside the project and partial clones"
```

### Task 4: STOP and bypass in the helper

**Files:**
- Create: `scripts/lib/stop.js`, `scripts/lib/bypass.js`
- Modify: `scripts/host/helper.js`, `scripts/host/helper-client.js`
- Test: `tests/scripts/lib/stop.test.js`, `tests/scripts/lib/bypass.test.js`, `tests/scripts/host/helper-stop.test.js`

**Interfaces:**
- Produces:
  - `stopState() -> { on: boolean, by?: string, at?: string }`: on when anything exists at `stopFile()` (a file, a folder, unreadable); `by` and `at` from the file's JSON when it reads. `setStop({ by: 'prompt' | 'runbook' | 'mod' | 'helper', now }) -> void` writes `{ by, at }`. `liftStop() -> void` removes it (only the prompt record's lift and, later, the mod call it).
  - `markBypass(sessionId, { now }) -> void`, `clearBypass(sessionId) -> void` on `bypass/<sessionId>` (the id limited to `[A-Za-z0-9-]`); `bypassActive({ now }) -> boolean`: true while any marker was written in the last two hours.
  - The helper reads both for itself at the moment a request's turn comes (inside `oneAtATime`, not when it arrived):
    - Under STOP it refuses `/push`, `/merge`, `/pr/open`, `/pr/update`, `/issue/create`, `/issue/update`, `/state/write`, `/lock/take` and `/lock/touch` with `'STOP is on'`. It answers reads (`/pr/state`, `/ci`, `/issue/list`, `/state/views`, `/lock/read`), `/state/sync`, `/state/record` (signed hook records, including the click that lifts STOP), `/stop/set`, and the runbook's routes (Task 14).
    - `/stop/set {}` → `setStop({ by: 'helper' })`, `{ ok: true }`. Anyone may set STOP: a false alarm costs only a pause (design section 12.7). There is no route that lifts it.
    - `/merge` uses `bypass: bypassActive() || body.bypass === true` and `stop: stopState().on || body.stop === true`; a code `/push` is refused with `'a session on this computer is in bypass mode'` while `bypassActive()`.
  - `helperClient` gains `stop()`.

- [ ] **Step 1: Write the failing tests.**

```js
test('STOP is on when its path holds a folder or an unreadable file', ...)   // Review Focus 4
test('setStop records who set it and when', ...)
test('a bypass marker counts for two hours, then not', ...)
test('under STOP the helper refuses every write route and answers reads, sync and signed records', ...)
test('a merge queued behind another reads STOP when its turn comes', ...)   // Review Focus 4
test('/stop/set turns STOP on; there is no route that lifts it', ...)
test('while a session is in bypass mode, merges and code pushes are refused whatever the caller says', ...)
test('a caller\'s stop: false or bypass: false changes nothing', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib scripts/host tests
git commit -m "Read STOP and bypass in the helper at each request's turn"
```

---

## Part 2: the hooks

### Task 5: The hook kit, and the plugin's hook list

**Files:**
- Create: `scripts/hooks/kit.js`, `scripts/protection/managed.js`, `hooks/hooks.json`
- Modify: `probes/12-locked/paths.js` (imports `managedDir` from `scripts/protection/managed.js`)
- Test: `tests/scripts/hooks/kit.test.js`

**Interfaces:**
- Produces:
  - `readInput(stream = process.stdin) -> Promise<object>`.
  - `answer.deny(reason)` (PreToolUse: `hookSpecificOutput.permissionDecision: 'deny'`), `answer.context(event, text)` (`hookSpecificOutput.additionalContext`), `answer.block(reason)` (`decision: 'block'`), each returning the JSON to print.
  - `findRepoRoot(cwd) -> string | null`, with `fs` only: walks up to a `.git`; a `.git` file's `gitdir:` leads to the worktree's folder, its `commondir` to the main `.git`, whose parent is the main folder. Never runs git.
  - `managedDir(platform) -> string` (moved from the probe) and `lockedProjects({ dir = managedDir() }) -> string[]`, the main folders in `<dir>/wheelhouse/locked-projects.json`, empty when it is missing, in `scripts/protection/managed.js`.
  - `projectOf(cwd) -> { project: string, record: ProjectRecord, locked: boolean } | null`: `projectForFolder(findRepoRoot(cwd))`, and `locked` when the main folder is in `lockedProjects()`.
  - `hookMain(decide, { failClosed: boolean, event: string })`: reads the input, calls `decide(input, deps)`, prints its answer; on a throw, prints `answer.deny("Wheelhouse's check could not run")` when `failClosed`, else nothing. It also exits silently when the hook is the plugin's copy and the project is Locked (the managed copy answers there), so a Locked project never runs a hook twice.
  - `hooks/hooks.json`: `SessionStart` (startup, resume, compact, clear) → `session-start.js`; `UserPromptSubmit` → `stop-word.js`, then `context-gauge.js`; `PreToolUse` `*` → `stop-guard.js`; `PreToolUse` `Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob|Bash|WebFetch|mcp__.*` → `tool-guard.js`; `PostToolUse` `AskUserQuestion` → `prompt-record.js`; `SubagentStop` → `report-check.js`; `PreCompact` → `precompact-guard.js`; `SessionEnd` → `stop-guard.js` (clears the session's bypass marker). Commands are `node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/<name>.js"`, with a 10-second `timeout`.

- [ ] **Step 1: Read the hooks reference** (https://code.claude.com/docs/en/hooks) and the plugins reference, and write at the top of `kit.js`, with the links and date: the input fields each hook above uses (`cwd`, `session_id`, `permission_mode`, `tool_name`, `tool_input`, `tool_response`, `prompt`, `source`, `trigger`, `agent_type`, `transcript_path` and, for `SubagentStop`, where the subagent's last message is), the output shapes, the plugin root variable and the `timeout` key. Where a field this plan relies on doesn't exist (above all `agent_type` on `SubagentStop`), stop and bring it to the controller before Task 9.
- [ ] **Step 2: Write the failing tests.**

```js
test('findRepoRoot finds the main folder from the folder itself and from a worktree', ...)
test('projectOf never runs git, even in a folder whose config would run a command', ...) // Review Focus 1
  // a worktree with core.fsmonitor = a command that writes a marker file; deps.run throws if called;
  // after projectOf, the marker file does not exist
test('projectOf is null outside every registered project', ...)
test('a guard that throws denies; an informing hook that throws says nothing', ...)
test('the plugin\'s copy says nothing in a Locked project', ...)
test('hooks.json names a script that exists for every hook', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run `npm test`, then `claude plugin validate .`.** Expected: PASS, and the plugin validates with its hooks.
- [ ] **Step 6: Commit.**

```bash
git add scripts/hooks scripts/protection hooks probes/12-locked tests
git commit -m "Add the hook kit and the plugin's hook list"
```

### Task 6: STOP's hooks, and bypass markers

**Files:**
- Create: `scripts/hooks/stop-guard.js`, `scripts/hooks/stop-word.js`, `commands/stop.md`
- Test: `tests/scripts/hooks/stop.test.js`

**Interfaces:**
- Consumes: `stopState`, `setStop`, `markBypass`, `clearBypass` (Task 4); the kit (Task 5).
- Produces:
  - `stop-guard.js` `decide(input)`, in a Wheelhouse project only:
    - writes or clears the session's bypass marker from `permission_mode` (`bypassPermissions` → mark; anything else → clear), on every call; on `SessionEnd`, clears it;
    - under STOP, allows only `READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'TodoWrite']` and a `Bash` command whose words are exactly `node <pluginRoot>/scripts/runbook/runbook.js <step> …` (the plugin's own path, quoted or not); anything else is denied with `'STOP is on: only reading, reporting and the runbook carry on'`. That covers writes, `Bash`, new agents (`Agent`, `Task`), messages between sessions and connectors.
  - `stop-word.js` `decide(input)`: a prompt that, trimmed, is `stop` or `/stop` (any case, an optional full stop or exclamation mark) calls `setStop({ by: 'prompt' })` and adds the context `'STOP is on. Say in one or two lines what was in progress; lifting it is a card for the director.'`. Any other prompt does nothing. A phone message reaches this hook too (check 4).
  - `commands/stop.md`: `/stop`, so the typed command is a known one; its body asks for the same one-or-two-line account.

- [ ] **Step 1: Write the failing tests.**

```js
test('under STOP, Edit, Write, Bash, Agent and mcp__ tools are refused; Read and Grep are not', ...)
test('under STOP, the runbook command is let through and the same words with another path are not', ...)
test('stop, Stop., /stop and STOP! set STOP; "stop the build after this" does not', ...)
test('a call in bypass mode marks the session; the next call in another mode clears it', ...)
test('outside a Wheelhouse project neither hook does anything', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/hooks commands tests
git commit -m "Halt everything but reading and the runbook while STOP is on"
```

### Task 7: The tool guard

**Files:**
- Create: `scripts/hooks/tool-guard.js`
- Test: `tests/scripts/hooks/tool-guard.test.js`

**Interfaces:**
- Consumes: the kit (Task 5); `readConfig` (Task 2), reading `.claude/wheelhouse.json` from the project's main folder.
- Produces: `decide(input, { home, platform, pluginRoot })`, in a Wheelhouse project only. These back up the deny rules (Task 12) and are walkable in `Bash` (M1); the sandbox is the barrier on the Mac (design section 12.2).
  - **File tools** (`Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, and `Grep`/`Glob` by their `path`): the path, made absolute and real where it exists, is refused when
    - its name starts `.env` and isn't `.env.example` (ignoring case on Windows and macOS: Review Focus 5);
    - it is under `<home>/.wheelhouse/`, or under one of `CREDENTIALS = ['.ssh', '.config/gh', '.config/glab-cli', '.npmrc', '.netrc', '.aws', '.config/gcloud', '.azure', '.docker/config.json', '.kube']` in the home folder;
    - for a writing tool, it is under `<home>/.claude/`, under `pluginRoot`, or is a `.claude/settings.local.json`.
  - **`Bash`:** refused when any word, by its last path part without `.exe`, is `gh` or `glab`, including inside `sh -c`, `bash -c`, `cmd /c` and `env`; when `git` is followed by `push`; when a word names a `.env` file other than `.env.example`. The refusal says to ask the helper.
  - **Connectors:** `mcp__<server>__<tool>` is refused unless `<server>` is in the configuration's `mcpServers`. This is the allowlist design section 12.2 left open (check 18): a deny rule can't make an exception, so the hook holds the list, and no `mcp__*` deny rule is written.

- [ ] **Step 1: Write the failing tests.**

```js
test('.env, .env.local and .ENV.local are refused; .env.example is read', ...)   // Review Focus 5
test('a link pointing at .env is refused by where it points', ...)
test('the keys folder and each credential file are refused to every file tool', ...)
test('writes to ~/.claude, the plugin and settings.local.json are refused; reads of ~/.claude are not', ...)
for (const cmd of ['gh pr merge 3', '/usr/local/bin/gh api x', 'sh -c "gh pr merge 3"',
                   '"C:\\Program Files\\GitHub CLI\\gh.exe" pr merge 3', 'env glab mr merge 1', 'git push origin main'])
  test(`Bash refuses: ${cmd}`, ...)
test('Bash allows git commit and node scripts', ...)
test('a connector is refused unless the configuration lists its server', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Split `Bash` commands into words with a small quote-aware splitter (single and double quotes, backslash outside quotes); no shell is run.
- [ ] **Step 4: Run `npm test`.** Expected: PASS on all three systems.
- [ ] **Step 5: Commit.**

```bash
git add scripts/hooks/tool-guard.js tests
git commit -m "Guard secrets, credentials, the host tools and connectors before each tool"
```

### Task 8: The prompt record

**Files:**
- Create: `scripts/hooks/prompt-record.js`
- Modify: `scripts/state/events.js` (the protected kind `action`)
- Test: `tests/scripts/hooks/prompt-record.test.js`

**Interfaces:**
- Consumes: `makeEvent` (signs protected kinds), `listEvents` (read from the state clone with `fs`); `liftStop` (Task 4); `helperClient` `state.write`, `state.record`, `prState` (Tasks 1 and 4); the kit.
- Produces:
  - A protected kind, `action`, for a click that sets something going: `data: { action: 'lift-stop' | 'runbook' | 'ci-push', step?: number, branch?: string, sha?: string, question: string, label: string }`.
  - `cardLines`, the exact text a card must contain for its click to count, made by the same module so the front desk (agents plan) writes it the same way:
    - `approvalLine(pr, sha) -> 'Approve pull request #<pr> at commit <sha7>'`;
    - `confirmLine(event) -> 'Confirm <kind> <id>: "<data.words>"'` for a `ruling`, `level` or `setting`;
    - `LIFT_STOP = 'Lift STOP and let the agents carry on'`;
    - `runbookLine(step, sha?) -> 'Runbook step <step>: <title><, to commit sha7>'`;
    - `ciPushLine(branch, sha) -> 'Push the CI change on <branch> at commit <sha7> with your own sign-in'`.
  - `decide(input, deps)` for `PostToolUse` on `AskUserQuestion`. For each question answered (`tool_input.answers`, check 8):
    - always a plain `card-answer` (`{ question, label }`) through `/state/write`;
    - label exactly `Approve` and the question holds `approvalLine(pr, sha7)`: asks `/pr/state` for the head; when it starts with `sha7` and the pull request is open, a signed `approval` `{ pr, commit: <full head>, words: 'Approve', question }` through `/state/record`. A moved head records nothing more (the director is asked again);
    - label exactly `Confirm` and the question holds `confirmLine(event)` for an event in the clone: a signed `confirmation` made by `confirmationFor(event)`;
    - label exactly `Lift STOP` and the question holds `LIFT_STOP`: `liftStop()`, and a signed `action` `lift-stop`;
    - label exactly `Do it` and the question holds a `runbookLine`: a signed `action` `runbook` with its `step` and `sha`;
    - label exactly `Push it` and the question holds a `ciPushLine`: a signed `action` `ci-push` with the branch and the full commit (from the line's `sha7` and the branch's head in the mirror, asked of the helper; a moved branch records nothing).
  - A record the helper can't take (not running, STOP) is kept in `projects/<p>/pending/` and sent by the next session start.

- [ ] **Step 1: Write the failing tests,** with a fake helper client.

```js
test('Approve on a card naming the pull request and its current head records a signed approval of the full head', ...)
test('Approve when the head has moved since the card records no approval', ...)
test('Approve on a card that does not name the pull request records only the answer', ...)
test('Confirm records a confirmation only when the card quotes the ruling\'s words exactly', ...)
test('Lift STOP lifts it and records who clicked', ...)
test('Push it on a CI card records a signed ci-push for that branch and commit', ...)
test('Explain more and Not now record only the answer', ...)
test('a record the helper cannot take is kept and sent later', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/hooks/prompt-record.js scripts/state/events.js tests
git commit -m "Record the director's card clicks as signed approvals, confirmations and actions"
```

### Task 9: The report check

**Files:**
- Create: `scripts/hooks/report-check.js`
- Test: `tests/scripts/hooks/report-check.test.js`

**Interfaces:**
- Consumes: the kit; Task 5 Step 1's finding for where `SubagentStop` gives the agent's type and last message; `helperClient` `prState`, `state.record`.
- Produces:
  - The report block both agents end with (the agents plan writes the prompts to it):

```
WHEELHOUSE REPORT
role: builder | reviewer
pr: <number>
commit: <40 hex>
status: done | blocked | partial            (builder)
tests: <one line>                           (builder)
assumptions: <one line, or none>            (builder)
concerns: <one line, or none>               (builder)
verdict: CLEAN | FINDINGS                   (reviewer)
findings: <count>                           (reviewer, when FINDINGS)
check: <name> <fingerprint>                 (reviewer, optional)
```

  - `parseReport(text) -> { fields, missing: string[] }`.
  - `decide(input, deps)`: for an agent of type `wheelhouse:builder` or `wheelhouse:reviewer`, a report with missing fields is blocked (`decision: 'block'`, naming them) up to twice per agent; the third stop is let through and a plain `note` records the incomplete report. A review record is written only when the agent type is exactly `wheelhouse:reviewer` (the plugin's own agent: a project's `reviewer` doesn't count), the report is complete, and `/pr/state` gives `commit` as the open pull request's head. It is signed, `review`, `{ pr, commit, verdict, findings, check?, claudeCode, model }`, with the version and model from the input or the agent's transcript, or `'unknown'`.

- [ ] **Step 1: Write the failing tests.**

```js
test('a complete reviewer report of the current head writes a signed review', ...)
test('a report from an agent typed reviewer without the plugin\'s name writes nothing', ...)
test('a report naming an older commit writes nothing', ...)
test('a report with missing fields is sent back twice, then noted', ...)
test('a builder report never writes a review', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/hooks/report-check.js tests
git commit -m "Check agents' reports and record reviews only from Wheelhouse's reviewer"
```

### Task 10: The session start: the helper and the state reload

**Files:**
- Create: `scripts/hooks/session-start.js`
- Test: `tests/scripts/hooks/session-start.test.js`

**Interfaces:**
- Consumes: `helperClient().health`, `startRealHelper` (Task 1) as a detached child; `/state/sync`, `/state/views`; `stopState`; the kit.
- Produces: `decide(input, deps)`, in a Wheelhouse project only:
  - starts `node <pluginRoot>/scripts/host/helper-main.js` detached, with `windowsHide`, when `/health` doesn't answer, and waits up to five seconds for it;
  - sends any records Task 8 kept;
  - syncs, builds the views and adds, as context, in this order: `STOP is on (set by <by> at <at>)` when it is; `Damaged state:` with each damaged file and each id carried twice, as the first lines when there are any (Ruling 21); anything unconfirmed; the waiting list (ids and one-line titles); the rulebook index (ids and first line); the levels; and for a session started in a feature's worktree, a pointer to its ledger. Whole files are not pasted (design section 19.1, point 5);
  - on Windows, adds once per session: `This computer has no sandbox: agents are held by the deny rules, the gate and the helper.` (design section 12.2);
  - when the helper can't be started or reached, adds `The host helper isn't running, so nothing can be pushed or merged` and carries on.

- [ ] **Step 1: Write the failing tests,** with a fake client and spawn.

```js
test('a helper that answers is not started again', ...)
test('a helper that does not answer is started, detached and hidden', ...)
test('STOP and damaged state come first in the reload', ...)
test('the reload lists ids and titles, not whole files', ...)
test('a session in a feature worktree is pointed at its ledger', ...)
test('when the helper cannot start, the session is told and carries on', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/hooks/session-start.js tests
git commit -m "Start the helper and reload state at each session's start"
```

### Task 11: The context gauge and the PreCompact guard

**Files:**
- Create: `scripts/hooks/context-gauge.js`, `scripts/hooks/precompact-guard.js`
- Test: `tests/scripts/hooks/context.test.js`

**Interfaces:**
- Produces:
  - `contextSize(transcriptPath) -> number | null`: the last assistant entry's `usage` (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`), read from the end of the file; `null` when it can't be read. The transcript's format is Claude Code's own and may change (design section 9.1), so anything unexpected gives `null` and the hook says nothing.
  - `context-gauge.js`: adds `Context: about <n>k tokens.` each turn; from 200,000, adds `Finish this step, save state, then carry on.` (design section 10). It keeps the reading in `sessions/<session_id>.json` for the guard.
  - `precompact-guard.js`: for `trigger: 'auto'`, blocks (`decision: 'block'`) while the session's folder holds `.claude/state/unsaved-<session_id>`, unless the last reading is 360,000 or more, or two minutes have passed since this session's first block (check 3). Never blocks a manual compaction.

- [ ] **Step 1: Write the failing tests.**

```js
test('contextSize adds the three input counts of the last assistant entry', ...)
test('a transcript it cannot read gives null and the gauge says nothing', ...)
test('the gauge asks to save state from 200,000 tokens', ...)
test('the guard blocks an automatic compaction while work is unsaved', ...)
test('the guard gives up two minutes after its first block, and near the limit', ...)
test('the guard never blocks a manual compaction', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/hooks tests
git commit -m "Add the context gauge and the PreCompact guard"
```

---

## Part 3: the protection levels

### Task 12: Standard: the settings

**Files:**
- Create: `scripts/protection/settings.js`
- Test: `tests/scripts/protection/settings.test.js`

**Interfaces:**
- Consumes: `CREDENTIALS` (Task 7), `readConfig` (Task 2), `helperAddress`.
- Produces:
  - `projectSettings(config: Config) -> object`, for the project's `.claude/settings.json` on the default branch (shared by every computer, so nothing in it names a user's folder):
    - `permissions.deny`: `Read(**/.env)`, `Read(**/.env.*)`, `Read(~/.wheelhouse/**)`, `Edit(~/.wheelhouse/**)`, `Edit(~/.claude/**)`, one `Read(~/<path>/**)` or `Read(~/<file>)` per credential, `Bash(gh:*)`, `Bash(glab:*)`, `Bash(git push:*)`, and the spend and deployment tools `Bash(<tool>:*)` for `vercel`, `netlify`, `flyctl`, `fly`, `wrangler`, `heroku`, `railway`, `aws`, `gcloud`, `az`, `doctl`, `supabase`, `neonctl`, `stripe`;
    - `sandbox`: `enabled: true`, `allowUnsandboxedCommands: false` (in Standard too, so a failed command isn't retried outside the sandbox on a click), `filesystem.denyRead` (`~/.wheelhouse` and the credentials), `filesystem.denyWrite` (`~/.wheelhouse`, `~/.claude`), `network.allowedDomains` (`registry.npmjs.org` and `config.webDomains`);
    - `autoCompactWindow: 300000` (design section 10).
  - `.env.example` is denied with the rest: a deny rule can't make an exception, and the tool guard (Task 7) already lets Claude's own tools read it; a command reading it in the sandbox is refused. *Designer's call*, failing closed.
  - `localSettings({ address }) -> object`, for this computer's `.claude/settings.local.json` (git-ignored): `sandbox.network.allowUnixSockets: [address]`, since the socket's path names this computer's home folder.
  - `mergeSettings(existing: object, ours: object) -> object`: our lists added to existing ones without duplicates; our values win; every other key of the director's kept.
  - `writeSettings(file, settings) -> void`: atomic.
  - `sandboxFlag(platform) -> string`: the health line's words (Windows: no sandbox).

- [ ] **Step 1: Read** the settings, permissions and sandboxing pages (https://code.claude.com/docs/en/settings, `/permissions`, `/sandboxing`) and correct any key name above to the documentation's, with the links and date in the file's top comment. Confirm `autoCompactWindow`'s name and that `allowUnixSockets` is read from a local settings file.
- [ ] **Step 2: Write the failing tests.**

```js
test('the project settings deny .env, the keys folder, credentials, the host tools and pushing', ...)
test('the project settings name no user\'s folder', ...)
test('the sandbox is on, with no unsandboxed retry, and the network list from the configuration', ...)
test('the local settings allow only the helper\'s socket', ...)
test('mergeSettings keeps the director\'s own keys and adds ours once', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add scripts/protection tests
git commit -m "Build Standard's settings for the project and for this computer"
```

### Task 13: Locked: the computer-wide file

**Files:**
- Create: `scripts/protection/locked.js`
- Modify: `scripts/hooks/stop-guard.js` (the sandbox check)
- Test: `tests/scripts/protection/locked.test.js`

**Interfaces:**
- Consumes: `managedDir`, `lockedProjects` (Task 5); the hook list (Task 5); `projectSettings` (Task 12).
- Produces:
  - `managedSettings({ dir, nodePath, address, domains }) -> object`:
    - `hooks`: the same events and matchers as `hooks/hooks.json`, each command `"<nodePath>" "<dir>/wheelhouse/scripts/hooks/<name>.js"`, both paths quoted (Review Focus 5);
    - `permissions.deny`: only what is safe in every project: `Read(**/.env)`, `Read(**/.env.*)`, `Read(~/.wheelhouse/**)`, `Edit(~/.wheelhouse/**)`, and the credentials;
    - `permissions.disableBypassPermissionsMode: 'disable'`;
    - `sandbox`: `allowUnsandboxedCommands: false`, `allowManagedDomainsOnly: true`, `network.allowedDomains: domains` (every Locked project's list, plus `registry.npmjs.org`), `network.allowUnixSockets: [address]`. As card B decided, `enabled` is left to the project, and `stop-guard.js` in a Locked project refuses `Bash` unless the project's `.claude/settings.json` and `settings.local.json` leave `sandbox.enabled` true.
    - not `allowManagedHooksOnly` (design section 12.1).
  - `installLocked({ project, platform, run, now }) -> Promise<{ installed: boolean, line: string }>`: refuses on Windows (`'Locked is offered on macOS only for now'`, design section 12.1) and when the connection is quick (`'Locked needs the narrow connection'`). Stages the file, `scripts/` copied whole to `<dir>/wheelhouse/scripts/`, the Locked list with this project added, and `wheelhouse/installed.json` (`{ version, at }`); then one administrator prompt (`osascript … with administrator privileges`, as `probes/12-locked/install.js` does) copies them in. Refuses when a `managed-settings.json` exists without `wheelhouse/installed.json` beside it, so the director's own file is never overwritten.
  - `updateLocked(...)`, `leaveLocked({ project, ... })`: the same prompt; leaving removes the project from the list, and removes everything when it was the last.

- [ ] **Step 1: Write the failing tests,** with a fake `run` that records the administrator command and never runs it.

```js
test('managedSettings quotes Node.js and the hook paths, which may hold spaces', ...)   // Review Focus 5
test('managedSettings denies only what is safe in every project, and switches bypass mode off', ...)
test('managedSettings makes the sandbox admin-required without switching it on everywhere', ...)
test('in a Locked project whose settings switch the sandbox off, Bash is refused', ...)
test('installLocked refuses on Windows and with the quick connection', ...)
test('installLocked never overwrites a computer-wide file that is not Wheelhouse\'s', ...)
test('leaving the last Locked project removes everything; leaving one of two keeps the other', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/protection scripts/hooks tests
git commit -m "Build, install and remove Locked's computer-wide file"
```

---

## Part 4: the runbook

### Task 14: The runbook and its steps

**Files:**
- Create: `scripts/runbook/runbook.js`, `templates/runbook.md`
- Modify: `scripts/host/helper.js` (`/runbook/*`), `scripts/host/helper-client.js`
- Test: `tests/scripts/runbook/runbook.test.js`

**Interfaces:**
- Consumes: the `action` kind and `runbookLine` (Task 8); `stopState`, `setStop` (Task 4); `writeBackup`'s bundles (`scripts/state/backup.js`); `readConfig` (Task 2); `keys.js`; the adapter.
- Produces:
  - In the helper, each step but the first needs a signed `action` `runbook` for that step from the last ten minutes (the director's click, Task 8); without one, `'this step needs the director\'s click on its card'`. STOP doesn't stop these routes.
    1. `/stop/set` (Task 4).
    2. `/runbook/cut-access {}`: narrow on GitHub deletes `keys/github-app.json` and answers the installation's settings page for the director to suspend or uninstall the app; narrow on GitLab revokes the project key through GitLab's API, then deletes its file; quick answers the host's page for revoking the director's sign-in, since only the director can. Each answer says plainly what was done and what is left for the director.
    3. `/runbook/restore-main { sha }`: `sha` must be an earlier commit of the default branch. In the mirror, a commit whose tree is `sha`'s, on top of the default branch's head (`git commit-tree <sha>^{tree} -p <head>`), pushed as `wheelhouse-restore-<sha7>`, and a pull request opened. Its merge goes through `/merge`, which, for this branch only and with the step's `action` naming that pull request's head, lets STOP pass and needs the director's approval and CI; no review (the tree is a release that passed one).
    4. `/runbook/restore-state {}`: the newest bundle in `profile/backups/<project>/`, verified; every event file in it missing from the state branch is added back in one commit (only additions, so the state push rules pass) and pushed.
    5. `/runbook/contain {}`: runs the default branch's `config.runbook.contain.command` (argument list, no shell) in a fresh checkout of the default branch under `projects/<p>/contain/`; with none, answers `'This project has defined no live harm to contain'`.
  - `/runbook/candidates {}` → the last ten merges (from the state's `merge` events and the default branch's tags), for the step 3 card.
  - `runbook.js <step> [sha]`: asks the helper and prints its plain answer. It is the only `Bash` command STOP lets through (Task 6).
  - `templates/runbook.md`: the five steps of design section 12.7 in plain words, each with what the director clicks and what happens; the project's containment step comes from its configuration's `describe`.

- [ ] **Step 1: Read** GitLab's documentation on revoking a project access token with the key itself and with the director's sign-in, and GitHub's on suspending an installation; note which needs the director's hand, with links, in the file's top comment.
- [ ] **Step 2: Write the failing tests.**

```js
test('each step but the first is refused without a fresh click on its card', ...)
test('a click older than ten minutes no longer counts', ...)
test('cut-access removes the narrow key and says what the director still has to do', ...)
test('restore-main makes a pull request whose files are the chosen commit\'s', ...)
test('restore-main refuses a commit that is not on the default branch', ...)
test('the restore pull request merges under STOP with the director\'s approval and CI; no other does', ...)
test('restore-state adds back the events missing from the branch, and only adds', ...)
test('contain runs the configured command from the default branch, or says none is defined', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add scripts/runbook scripts/host templates tests
git commit -m "Add the runbook and its five steps"
```

---

## Part 5: the parked items

Each item in these tasks is one failing test first. Where the test already passes, the item is recorded as "already holds" in the task's report and nothing changes.

### Task 15: State, signing and the scan

**Files:**
- Modify: `scripts/state/signing.js`, `scripts/lib/canonical.js`, `scripts/state/secret-scan.js`, `scripts/state/events.js`, `scripts/state/clone.js`, `scripts/state/views.js`, `scripts/state/lock.js`, `scripts/state/backup.js`, `tests/e2e/state-and-host.test.js`
- Test: the matching files under `tests/scripts/state/` and `tests/scripts/lib/`

- [ ] **Step 1: Write the failing tests.**

```js
test('enrol refuses to write when enrolled.json is damaged, and writes atomically', ...)
test('enrol refuses an entry without a computer id and a public key', ...)
test('canonicalJson refuses Date, Map, Set and sparse arrays', ...)
test('database-url is found in capitals and not across a slash', ...)
test('a 100,000-character line is scanned in under a second', ...)
test('syncState says whether it pulled and how many events are unpushed', ...)
test('a failed commit leaves no empty month folder', ...)
test('a clone left half-made by a crash is refused with what to do', ...)
test('an origin spelled differently but naming the same repository is accepted', ...)
test('two cloneState calls at once on one computer leave one clone', ...)
test('views are replaced all at once', ...)
test('an unreadable or malformed lock.json refuses the lock instead of counting it free', ...)
test('readLock checks the shape it returns', ...)
test('the lock clone\'s remote must be the state clone\'s', ...)
test('a bundle dated in the future does not stop the weekly backup', ...)
test('holdsLock makes one round trip to the host', ...)
test('a review with its sig removed does not count; a missing enrolled list refuses', ...)
test('the end-to-end test works in any month', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL for each item still open.
- [ ] **Step 3: Implement** the smallest change for each. The malformed `lock.json` throws `"the lock can't be read"`, so `takeLock` refuses and `holdsLock` is false. Move `g()` into `tests/helpers/git-fixture.js`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Close the state, signing and scan items left from the state-and-host plan"
```

### Task 16: The host

**Files:**
- Modify: `scripts/host/github-app.js`, `scripts/host/connection.js`, `scripts/host/protection.js`, `scripts/host/github.js`, `scripts/host/gitlab.js`, `scripts/host/adapter.js`, `scripts/host/helper.js`, `scripts/lib/run.js`, `tests/helpers/homes.js`
- Test: the matching files under `tests/scripts/host/` and `tests/scripts/lib/`

- [ ] **Step 1: Write the failing tests.**

```js
test('a reply that is not JSON, or null, is a plain refusal quoting nothing', ...)
test('a missing interval waits five seconds, not none', ...)
test('a null renewal key or expiry is handled: the connection asks for a sign-in again', ...)
test('a renewal reply without a new renewal key keeps the old one and raises the card', ...)
test('a malformed access-key expiry renews once, not every call', ...)
test('the refusal code from GitHub reaches the answer', ...)
test('GITLAB_HOST keeps a GitLab served under a path', ...)
test('protection: an error that is not a network error is said as it is', ...)
test('protection: a dropped answer to a change is read back before saying anything', ...)
test('GitHub protection notices bypass actors and changed rules', ...)
test('GitHub protection reads the owner\'s plan, not the signed-in user\'s', ...)
test('a GraphQL answer with errors is not read as no checks', ...)
test('a merge queued by the host is not reported as merged', ...)
test('GitLab "CI still running" is unknown, not no', ...)
test('an unknown pull request state is reported as unknown', ...)
test('merged-results pipelines count as the head\'s pipeline', ...)
test('merge refusals are told apart: conflict, checks, not allowed', ...)
test('the scrub hides a key\'s value and not ordinary words', ...)
test('run can unset a variable', ...)
test('on Windows a timed-out command is killed with its children', ...)
test('a push that times out is refused, saying so', ...)
test('the mirror drops its working refs and tidies itself after each push and merge', ...)
test('a folder\'s own uploadpack.packObjectsHook is not run', ...)
test('withHome removes its temporary folders', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL for each item still open.
- [ ] **Step 3: Implement** the smallest change for each. On Windows, a timed-out child is ended with `taskkill /pid <pid> /T /F`. Remove the dead `clientSecret` argument from its test.
- [ ] **Step 4: Run `npm test`.** Expected: PASS on all three systems.
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Close the host items left from the state-and-host plan"
```

### Task 17: The design, brought up to date

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md`

- [ ] **Step 1: Apply the ledger's wording items:** line 77 and lines 470–471 agree that `api` reaches the settings API while a Developer role is expected to be refused it (by the documentation); line 564 adds "by the documentation"; line 463 says the keychain item is "treated as readable"; line 755 gives the pasted-token fallback; line 745's time agrees with check 20 (1 to 3 minutes for the director's part, under 4 including registering the app).
- [ ] **Step 2: Write this plan's designer's calls into the design,** each marked *Designer's call* and listed in section 21: the configuration file `.claude/wheelhouse.json` and the guardrail patterns (12.4); the caller only raising gate conditions, and the merge gate's PreToolUse part being the tool guard's refusal of direct pushes and merges, with the conditions themselves checked in the helper (12.3); bypass read from markers the hooks write (12.3); STOP set by anyone through the helper, lifted only by a click (12.7); the connector allowlist held by a hook (12.2, settling check 18's open point); `.env.example` denied in commands (12.2); `allowUnsandboxedCommands: false` in Standard too (12.1); hooks never running git in agents' folders (12.3); the card lines a click must match (5.3, 12.5); the runbook's restore as a pull request (12.7); a superseded proposal shown as superseded (9); the quick connection dropping the director's `GIT_SSH_COMMAND` (11); and cards A and B as the director answered them (22), with section 12.4's line on CI changes saying the director's one click pushes them with their own sign-in.
- [ ] **Step 3: Commit.**

```bash
git add docs/specs
git commit -m "Bring the safety plan's calls and the parked wording into the design"
```

---

## Part 6: trying it, and the handover

### Task 18: The director's sitting on the Mac

**Files:**
- Create: `scripts/health/trials.js`, `docs/checks/24-safety-live.md` (with its row in `docs/checks/README.md`)

**Interfaces:**
- Produces: `trials.js`, run by a sandboxed `Bash` command in a scratch project made with Task 12's settings and this branch's plugin. It prints one line per trial, `<trial>: <expected> / <result>`, never a value: read `.env.local`; read `~/.wheelhouse/keys/`; reach `github.com`; `gh` by its full path; the helper's `/health` on its socket inside `~/.wheelhouse/` (design: allowed by name); `/merge` of a pull request with a forged approval file (refused, scenario 11); STOP set by typing `stop`, then a write refused and a read allowed (scenario 12). Setup's health check (design section 15, step 9) will reuse it.

- [ ] **Step 1: Write `trials.js`** and a unit test for its output lines.
- [ ] **Step 2: Card to the director** (before the sitting): what will be made (a scratch project and, for Locked, the computer-wide file), what they do (open a session, click two cards, type `stop`, type their password twice), how each is undone, about 25 minutes.
- [ ] **Step 3: Standard, sandboxed (director, Mac).** The director opens a Desktop session on the scratch project; it runs `trials.js`; the director clicks an approval card and a Lift STOP card. Record each line. **If the helper's socket can't be reached inside the denied folder,** record it, and add a ruling: `helperAddress()` moves to `~/.wheelhouse-run/helper.sock`, outside the denied folder, with Task 12's local settings following it.
- [ ] **Step 4: Locked (director, Mac).** `installLocked` with the director's password; in the Locked scratch project, Bash with the sandbox switched off in its local settings is refused, and a forged approval is still refused; in another folder nothing changes; `leaveLocked` with the password; check the file is gone.
- [ ] **Step 5: Write `docs/checks/24-safety-live.md`** in the findings-note format, and commit.

```bash
git add scripts/health docs/checks tests
git commit -m "Record the safety checks tried live on the Mac"
```

### Task 19: End to end, and the handover

**Files:**
- Create: `tests/e2e/safety.test.js`
- Modify: `HANDOVER.md`

- [ ] **Step 1: Write the end-to-end tests,** with the stand-in host from Task 1, a real helper, and the hooks' `decide` functions called as Claude Code would:

```js
test('STOP mid-build: writes, pushes, merges and new agents are refused; reading and the runbook carry on', ...)  // scenario 12
test('an approval file pushed to the state branch by hand changes nothing', ...)                                 // scenario 11
test('a pull request changing a workflow needs a review and the director\'s approval, whatever the caller says', ...) // scenario 14
test('a card answer the agent filled in itself is not an approval', ...)                                          // scenario 19
test('a session in bypass mode stops every merge on the computer until it leaves bypass', ...)
test('narrow on a private repository: two computers, the lock passes on, the old holder cannot merge', ...)        // scenario 17
```

- [ ] **Step 2: Run `npm test`.** Expected: PASS on the Mac and in CI on all three systems.
- [ ] **Step 3: Update `HANDOVER.md`:** where the work stands, what this plan built, what the sitting found, and the next plan (board, briefing and usage, design section 17.2).
- [ ] **Step 4: Commit.**

```bash
git add tests/e2e HANDOVER.md
git commit -m "Test the safety checks end to end, and bring the handover up to date"
```

## Order

Tasks 1 and 2 first, as HANDOVER step 3 asks. Task 3's CI rule uses Task 8's `action` kind and card line, so that part of Task 8 is built first (Task 3 says so). Tasks 15 and 16 touch no file Tasks 1 to 14 touch except `helper.js` (Task 16's mirror and timeout items), so they can run while the hooks are built, Task 16 after Task 4. Task 18 needs Tasks 1 to 14; Task 19 comes last.

## The director's sittings

| Sitting | Computer | Tasks | About |
|---|---|---|---|
| 1 | Mac | 18 (Standard sandboxed, then Locked with the password twice) | 25 min |

Locked on Windows stays untried until a computer with admin rights is available (design section 12.1).
