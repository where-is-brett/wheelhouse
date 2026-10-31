<!-- docs/superpowers/plans/2026-10-31-local-checks-and-git-alone.md -->
# Local checks and git alone: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project's tests run on this computer, inside Wheelhouse's sandbox, and count as the check the merge gate needs; then a project with no code host at all gets every lane, review, preview, approval and report, with a safekeeping status on every project.

**Architecture:** A new core module, `scripts/checks/`, run by the helper, fetches a commit into a folder of its own, runs the project's commands under `sandbox-exec`, and writes a signed `check` event; hosted projects also get a commit status, and the broker's permit reads the signed event. Git alone adds a bare home in `~/.wheelhouse`, a third host adapter behind `adapterFor`, a local change in place of a pull request, and one script in place of Archon's merge queue. The lanes reach the host only through the helper's routes, so they don't change.

**Tech Stack:** Node.js (ES modules), `node:test`, git through `safeGit`, macOS `sandbox-exec`, `git bundle`, Archon v0.13.0.

**Spec:** `docs/specs/2026-10-31-local-checks-and-git-alone-design.md`, approved by the director on 31 October 2026. Sections 3 (Archon's facts A1 to A11), 11 (parts) and 12 (rulings) are the ones to read first. Where it differs from `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, it wins.

**How to use this plan.** Each part below is carried out by one fresh session with this file, the spec and the repository. Each names what it waits on, its files, its tests and what done looks like, and ends with a pull request and one message to the main session. One part per fresh context; the main session starts the next. A later part may refine its own tasks from what the parts before it left, but not its rulings or the Global Constraints.

## The parts

| Part | What | Release | Waits on |
|---|---|---|---|
| 0 | Early checks 82, 83, 84 | none | a real Mac app project and a throwaway GitHub repository, both through the main session |
| 1 | The check runner | v0.2.1 | check 82 |
| 2 | Hosted reporting and the permit | v0.2.1 | part 1, check 84 |
| 3 | Finding the command, not counting | **v0.2.1, tagged by the main session** | part 2 |
| 4 | The home and the local adapter | v0.2.2 | part 1 |
| 5 | Builds on it | v0.2.2 | part 4, check 83 |
| 6 | The local queue | v0.2.2 | parts 3 and 5 |
| 7 | Setup and uninstall | v0.2.2 | part 6 |
| 8 | Backups and safekeeping | v0.2.2 | part 4; part 7 for the setup card and the restore |
| 9 | Moving to a host | v0.2.2 | parts 7 and 8 |
| 10 | The counted evaluation | gates v0.2.2 | every part above |

**Order.** 0, 1, 2, 3 and then the release of local checks. Then 4 to 7, which make git alone usable; if the first project stays on the computer, these come before real use. Parts 8 and 9 can follow; until part 8 is in, a git-alone project has neither a backup nor the status that shows it. Part 4 may run beside part 2 or 3 once part 1 has merged: they share only `scripts/host/adapter.js`, and each adds one method. Part 8's hosted half depends on nothing here, so the main session may start it early.

## Where the spec's sections are built

| Spec section | Part |
|---|---|
| 4.1 Where checks run | 2 |
| 4.2 The settings | 1 (reading them), 3 (keeping the command) |
| 4.3 What happens in a check | 1 (steps 1 and 3 to 8), 2 (steps 2, 9, 10 and the triggers) |
| 4.4 The sandbox | 1; All stop's end of a check in 2 |
| 4.5 Finding the command, not counting | 3 |
| 4.6 Why the result can be trusted | 1 (signed), 2 (permit), 3 (protected-tests list) |
| 4.7 A red check | 2 (heads, hosted main line), 6 (git alone) |
| 4.8 What the director sees | 2 (pane), 3 (Logbook, cards) |
| 5.1 The home; lifting Lean's code | 4 |
| 5.2 The project's record | 4 |
| 5.3 How builds reach it | 5 |
| 5.4 Changes made by hand | 5 |
| 6 The local adapter | 4; `merge` in 6 |
| 7.1 Local changes | 4 |
| 7.2 Signed approvals and the permit | 6 |
| 7.3 The lock | 4 |
| 7.4 The local queue | 6 |
| 7.5 All stop | 5 (broker, `host.push`), 6 (queue), 7 (runbook) |
| 7.6 A red main line | 6 |
| 7.7 The reports | 6 (audit, weekly job, Logbook), 7 (glossary), 8 (pane) |
| 8 Backups and safekeeping | 8 |
| 9 Moving to a host | 9 |
| 10 Setup and uninstall | 7 (restore in 8) |
| 11 The upkeep | 6 |

## Choices this plan makes

The spec leaves these to the builder, or the code showed a gap it doesn't settle; the plan settles them so each part is unambiguous. The director or the main session may change any.

1. **Our own status isn't CI.** `hasCi` reads any status on a commit, so once `wheelhouse/checks` is posted a project with no CI would read as having CI, and checks would move back to the host. `whereChecks` leaves that context out, and reads the rollup's contexts by name (part 2).
2. **The check folder's git directory sits outside what tests can write.** The helper runs git in that folder after the project's own code has run there, so a planted `.git/hooks` or `core.fsmonitor` would run outside the sandbox. `tree` is a checkout whose `.git` file points at `tree.git`, beside it, which the profile lets a test read but not write (part 1).
3. **The check reads the default branch's settings through a new read.** `engineConfigOf` reads the folder's file, which an agent's branch can't reach but a person's unfinished work can. `checksConfig` reads `.claude/wheelhouse.json` by `git show` from the helper's mirror or the home (part 1). Work orders keep reading as they do.
4. **Not counting takes the tests out of the lanes too.** A lane's default done check is the test command, so tests that already fail would block every lane, and a project with no command holds at `no-tests` (`dispatch-run.js`) and fails `workOrder`'s check. While not counting, an order carries `testsNotCounting: true`, adds no default test check, and may have no done checks at all (part 3).
5. **With no command, a not-counted check still exists.** It runs nothing, with `command: null`, `minutes: 0` and an empty `tail`, so the status posts and the permit has a signed record (part 3).
6. **The protected-tests list also reads what `testCommand` runs.** `package.json`'s test scripts and a `Makefile`'s `test` target are compared as well, since the spec's table names `package.json` and today's list doesn't cover it (part 3).
7. **A project already protected isn't re-protected.** The connection is barred from administration. `wheelhouse/checks` is named as a required check when setup next writes protection; until then the permit holds the line, and no card is raised (part 2).
8. **Version numbers.** Local checks are v0.2.1 and the rest v0.2.2. v0.3.0 stays the old engine's removal (the Archon plan). v0.2.1 ships without a counted evaluation, by the one-evaluation rule; check 84 and part 2's end-to-end test stand behind it, with CI green on Linux and macOS.
9. **A security note ships with local checks.** Part 3 adds the `prepare` network risk to `SECURITY.md`, so v0.2.1 is honest; part 7 adds what git alone changes.
10. **A connection for a local project is `{ mode: 'none' }`.** The existing field is `mode`, where the spec says "kind".
11. **The check folders are under `~/.wheelhouse/engine/checks/<project>/`** (`engineDir()`), so every agent's denial of `~/.wheelhouse` covers them. The check process is the exception, by the profile.
12. **The new evaluation scenarios are numbered 76 to 81,** the next free numbers in `tests/eval/`.
13. **Checks live in `check` and `checks-state` events, both signed and helper-only:** in `PROTECTED_KINDS` and `HELPER_ONLY_KINDS` (part 1, part 3). `checks-state` is signed because it lets merges pass with no tests.

## Global Constraints

- **The main session** is the session that started you (reply with SendMessage to the `from` id of your first message). Questions, cards for the director and the hand-over go there, never to the director directly. Message it only when done, blocked or limited.
- British English; dates as 31 October 2026; a repository-relative path comment atop every file. No words such as "enhanced", "improved" or "fixed" in names or text; no model names; no AI attribution anywhere. Scripts in Node.js. Don't touch `.github/workflows/ci.yml`.
- **The repository is public.** Name none of the director's projects, in notes or tests. Use generic examples.
- Run the test files a part touches, not the whole suite. Pull requests merge when CI is green on Linux; macOS runs on main after the merge. Tests that need `sandbox-exec` carry `{ skip: process.platform !== 'darwin' }`, and the session runs them on the Mac.
- **No check ever runs unsandboxed.** No `sandbox-exec`, or a profile that won't load, gives `could-not-run`.
- **An agent can't reach a result or the main version:** nothing an agent can write decides a merge. `check`, `checks-state` and `change` are written only by the helper; the home is written only by the helper.
- **The director never reads** "commit status", "bare repository", "remote", "forge", a commit id or a run id. "Backup" is the one technical word safekeeping uses. Every card is a card: what this is, why it comes to them, clickable options with a recommendation first, and what happens meanwhile.
- **The cards are the spec's and no others:** the broken-CI card (4.1), the status permission card (4.3), `could-not-run` twice (4.8), the failed first check (4.5), a second red on the same work (4.7), changes made by hand (5.4), a queue's ask for approval (7.4), the setup backup card (8.1), the host move and the home's removal (9, 10), and the branch card (10). Safekeeping raises no card after setup.
- Git goes through `safeGit`. Keys travel only in the environment. Never `pkill`, never permanently delete. Don't touch `~/.claude/settings.json`.
- **Words of the check result:** `passed`, `failed`, `timed-out`, `could-not-run`, `not-counted`. Status context: `wheelhouse/checks`. Time limit 20 minutes; output kept to the last 64 KB; `tail` the last 4 KB, secret-scanned; one second try of a red result, not of a timeout. Safekeeping's limits 7 and 3 days.

## Review Focus

1. **Wheelhouse's own status makes a project look as if it has CI.** The second check on a project with no CI must still run here. Test in part 2, Task 1.
2. **A not-counting project whose tests already fail.** Lanes must start and finish on their own done checks, and a planted `not-counted` must not pass a project whose tests count. Tests in part 3, Task 3.
3. **A test plants a git hook or setting in its own folder.** The helper's next git call there must not run it. Test in part 1, Task 2.
4. **A branch empties the test script.** `"test": "exit 0"` in `package.json`, or a scheme with its tests unticked, is a protected-tests finding before review. Test in part 3, Task 4.
5. **A head checked under an old command, or while tests weren't counting.** Its result stops counting when the default branch's command changes or counting begins; it is checked again, not merged and not stuck. Tests in part 2, Task 3 and part 3, Task 3.

---

## Part 0: Early checks

**Waits on:** the main session for a real Mac app project (check 82) and a throwaway GitHub repository with no Actions (check 84). Done first because each can change later parts' tables.

**Files:**
- Create: `probes/82-check-sandbox/run.js`, `probes/83-path-remote/run.js`, `probes/84-set-status/run.js`, `docs/checks/82-check-sandbox.md`, `83-path-remote.md`, `84-set-status.md`
- Modify: `docs/checks/README.md` (three rows, and the opening sentence: "and checks 82 to 84, which are the local-checks design's early checks")
- Test: `node --test tests/docs/checks-format.test.js`

Probes run Archon the one way `probes/lib/archon.js` allows. Nothing is written to `~/.wheelhouse`, `~/.archon` or the director's settings. Each note says what it removed.

- [ ] **Check 82, a real Mac app under the profile.** The draft profile from spec 4.4: `xcodebuild test` with the switches and `CODE_SIGNING_ALLOWED=NO`, `prepare`, a separate `HOME`, and time with and without kept build output. Try every way out from inside the sandbox: `launchctl submit`, `open`, `osascript`, an Apple Event, reading the keychain, a login item. Each must fail. Answer: which table row works, and whether the profile stays allow-by-default. The note doesn't name the project.
- [ ] **Check 83, a real quick lane on a folder with only a path remote.** Worktree, commit, artefacts, what Archon names the project (`_local`), clean-up, with `worktree.remote` naming the path. If it fails, the note records the fallback: a made-up https address with an `insteadOf` rule, as hosted projects have, and part 5 uses that.
- [ ] **Check 84, the real status path.** On the throwaway repository: post `wheelhouse/checks` through the helper's connection, on quick and narrow; confirm the gate reads `pending` then `green`; merge one pull request through Archon's queue. Record what a missing `statuses: write` answers, and what `hasCi` says after a status is posted.
- [ ] Run the format test. Commit: `Answer the early checks for local checks and git alone`. Open the pull request.

**Done when:** three notes pass the format test, each with an `**Answer:**` line; a No or Partly that changes the design goes to the main session as a card, not into the design. Later parts wait on 82 and 84 reading Yes or Partly with a way forward.

---

## Part 1: The check runner

**Waits on:** check 82. Nothing here is wired to the helper's triggers; part 2 does that.

### Task 1: Settings, the signed event and the moved test environment

**Files:**
- Create: `scripts/lib/local-git.js` (`testEnv` and `shellFor`, moved from `scripts/lean/store.js`, which imports them; part 4 adds the rest), `scripts/lib/output-tail.js` (the helper's `shown`, moved, taking `most`), `scripts/checks/settings.js`, `scripts/checks/record.js`
- Modify: `scripts/state/events.js` (`check` in `PROTECTED_KINDS` and `HELPER_ONLY_KINDS`, with its fields and result words), `scripts/gate/guardrails.js` (`shapeOk` reads `checks` and `safekeeping`), `scripts/gate/conditions.js`
- Test: `tests/scripts/checks/signed.test.js`, `tests/scripts/gate/guardrails.test.js`, `tests/scripts/lean/` (unchanged and passing)

**Interfaces:**
- Produces: `checksSettings(config) -> { testCommand, prepare, minutes, network, where }` (minutes 20 by default; `network` false); `checksConfig({ project, git, ref }) -> config`, the default branch's `.claude/wheelhouse.json` by `git show`, or the empty config; `commandDigest(command) -> string | null`.
- Produces: `writeCheck(project, result, { write }) -> event`; result `{ commit, command (digest), result, minutes, tail }`; `tail` through `tailOf(text, 4096)`, so the event's own secret scan never refuses it.
- Produces in `conditions.js`: `checkCounts(entry, headSha, digest, enrolled, { notCounting = false } = {}) -> boolean`: verifies, names the head, names `digest`, and reads `passed`, or `not-counted` only with `notCounting`.

- [ ] **Tests first:** `a check event from a caller is refused`; `a check signed by another key does not count`; `a check of another head does not count`; `a check of another command does not count`; `not-counted counts only with notCounting`; `the tail never holds a line the secret scan flags`; `checksConfig reads the default branch, not the folder`; `a checks key of the wrong shape is unreadable`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the signed check record and read the check settings from the default branch`.

### Task 2: The check folder and the profile

**Files:**
- Create: `scripts/checks/folder.js`, `scripts/checks/profile.js`
- Modify: `scripts/protection/settings.js` (`sandboxDenyPaths({ userHome, platform }) -> string[]`, the deny list as paths: `~/.wheelhouse`, the keychain, ssh and cloud keys, Archon's private files)
- Test: `tests/scripts/checks/folder.test.js`, `tests/scripts/checks/profile.test.js`

**Interfaces:**
- Produces: `checkPaths(project) -> { root, tree, gitDir, home, mainHome }` under `engineDir()/checks/<project>` (choice 11; `gitDir` is `tree.git`).
- Produces: `prepareFolder({ project, commit, main, source, git }) -> paths`: fetches exactly `commit` from `source` by a ref the helper writes for it, since a path remote refuses an unadvertised commit. `source` is the helper's `mirror.git` on a hosted project and the home on a local one, named on the command line so no remote stays configured. Resets and cleans keeping what `.gitignore` ignores; for `main` it first clears `tree` entirely. No alternates and no link to the source.
- Produces: `checkProfile({ paths, main, stage, network, denied, temp }) -> string`, the SBPL text of spec 4.4. `stage` is `prepare` or `test`. Writes are allowed to `tree`, one of `home` and `mainHome` (`mainHome` only with `main`) and temp. `gitDir` is readable and never writable. A `prepare` profile has the network and also denies the rest of the home folder. Paths are quoted so a folder name can't break the profile.

- [ ] **Tests first:** `a commit is fetched and nothing links back to the source`; `a head keeps ignored build output`; `a main-line check starts from an empty tree`; `the profile denies each deny-list path` (text, on any system); `a head's profile can't write main-home`; `only prepare has the network unless checks.network`; `a folder name with a quote doesn't break the profile`; on the Mac: `the keychain and ~/.wheelhouse can't be read`, `curl is stopped`, `a test can't write tree.git`, and `a hook and core.fsmonitor planted in the tree never run on the next prepareFolder` (Review Focus 3).
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the check folder and the sandbox profile`.

### Task 3: The run and the second try

**Files:**
- Create: `scripts/checks/run.js`, `scripts/checks/queue.js`
- Test: `tests/scripts/checks/run.test.js`

**Interfaces:**
- Produces: `runCheck({ project, commit, main, settings, source, signal, git, spawn, now }) -> { commit, command, result, minutes, tail }`: `prepare` then `testCommand`, each under `/usr/bin/sandbox-exec -p <profile>` in a process group of its own, in `testEnv` with `HOME` set, within `minutes`; stdout and stderr kept to 64 KB. A non-zero exit runs once more at the same head; a timeout doesn't. No `sandbox-exec`, or a profile that fails to load, is `could-not-run`, told from a test's failure by exit code and the sandbox's own message. Only `win32` and `linux` skip straight to `could-not-run`.
- Produces: `dueChecks({ main, heads, results, digest, notCounting }) -> [{ commit, main }]`, main line first, leaving out a commit with a result for this digest; `withCheckTurn(fn)`, one check at a time across the computer, by a lock file under `engineDir()/checks`; `endCheck(project)`, ending the process group, whose result is `could-not-run`.

- [ ] **Tests first:** `a pass, a failure, a timeout and a run that couldn't start give their words`; `a red result runs once more and a second red is failed`; `a red then green is passed`; `a timeout has no second try`; `output past 64 KB keeps the end`; `no sandbox-exec is could-not-run and the command never runs`; `a broken profile is could-not-run`; `dueChecks puts the main line first`; `two projects' checks never overlap`; `endCheck ends a child that started a child`; `prepare runs before the tests and a failed prepare is failed`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Run a project's tests in the sandbox, one check at a time`.

**Done when:** on the Mac, `runCheck` on a small real project gives a signed `check` event; every test file above passes; Lean's tests are unchanged and pass; nothing yet starts a check. Open the pull request `The check runner` and message the main session.

---

## Part 2: Hosted reporting and the permit

**Waits on:** part 1, check 84.

### Task 1: Where checks run, and reporting

**Files:**
- Create: `scripts/checks/where.js`
- Modify: `scripts/host/adapter.js`, `scripts/host/github.js` (`setStatus`, `checkContexts`), `scripts/host/gitlab.js` (`setStatus` refuses: GitLab stays on the old engine), `scripts/host/app-manifest.json` and `scripts/setup/own-app.js` (`statuses: write`), `scripts/host/protection.js` (`wheelhouse/checks` named when protection is written; `NO_CI`'s line), `scripts/lib/front-desk.js`, `scripts/state/card-lines.js` (the two new cards)
- Test: `tests/scripts/host/set-status.test.js`, `tests/scripts/checks/where.test.js`, `tests/scripts/host/protection.test.js`, `tests/scripts/setup/own-app.test.js`

**Interfaces:**
- Produces: `adapter.setStatus({ sha, state, description }) -> { ok } | { refused: 'permission' | string }`, with context `wheelhouse/checks` and state `pending`, `success` or `failure`. It posts to `repos/{repo}/statuses/{sha}`; a 403 is `permission`, not a throw.
- Produces: `adapter.checkContexts(sha) -> [{ name, state, startedAt, app }]`.
- Produces: `whereChecks({ setting, host, contexts, hasWorkflows }) -> 'here' | 'host'`: the setting wins; `local` is `here`; otherwise `host` if any context but `wheelhouse/checks` exists, or the workflows folder holds any; else `here` (choice 1).
- Produces: `stuckHostChecks(readings) -> boolean`, two heads in a row queued for 30 minutes, or failed with no job having run.
- `NO_CI`'s new line: the project has no CI, so its checks run on this computer. Protection doesn't block on it (choice 7).

- [ ] **Tests first:** `setStatus posts the context and state`; `a 403 reads permission`; `GitLab refuses setStatus`; `with only our own status, checks stay here` (Review Focus 1); `a hosted project with a workflow reads host`; `checks.where fixes the answer`; `one stuck head is nothing and two are stuck`; `a check from another app that never reports counts as stuck`; `the manifest and an own app's list both have statuses: write`; `NEVER is unchanged`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Work out where checks run and report them to the host`.

### Task 2: The triggers and the check's life

**Files:**
- Create: `scripts/checks/runner.js`
- Modify: `scripts/host/helper.js` (after `doPush` takes a head; on the dispatcher's tick; All stop; `mainGreen` unchanged), `scripts/desk/mod-pane.js` ("Checking on this computer"; "Waiting for you to let Wheelhouse report checks"), `scripts/engine/words.js`
- Test: `tests/scripts/checks/runner.test.js`, `tests/scripts/host/helper-checks.test.js`, `tests/scripts/mod/status.test.js`

**Interfaces:**
- Produces: `checkRunner({ project, adapter, config, source, write, onRed, card, now }) -> { took(head, work), tick(), stop() }`. It keeps its queue in `engineDir()/checks/<project>/queue.json`. `took` posts `pending` at once and queues; `tick` adds the default branch's head and runs what is due; a status that couldn't post is tried again each tick. The record is written before the report. `could-not-run` twice in a row raises its card; a refused status raises its card once.
- All stop calls `stop()`; the check runs again after it lifts.

- [ ] **Tests first:** `a new head posts pending before the check starts`; `the signed record is written before the status`; `a refused status keeps the result and tries again`; `permission raises one card`; `the main line's head with no result gets a check`; `a stopped check is could-not-run and runs after All stop lifts`; `could-not-run twice raises one card`; `the pane says Checking on this computer while one runs`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Start a check at each new head and report it`.

### Task 3: The permit, and a red check

**Files:**
- Modify: `scripts/engine/broker/rules.js` (`brokerDecision`), `scripts/host/helper.js` (`brokerPermit`, and the helper's own gate for the fix), `scripts/engine/dispatch-run.js` (`sentBack(work, reason)`, the tail in the order), `scripts/engine/dispatcher.js` (`sentBack` entries gain `reason`), `scripts/engine/fix-rerun.js` (asks the new route where checks run here), `scripts/engine/routes.js` (`mainCheck`)
- Test: `tests/scripts/engine/broker/rules.test.js`, `tests/scripts/engine/dispatcher.test.js`, `tests/scripts/engine/dispatch-run.test.js`, `tests/scripts/engine/fix-rerun.test.js`, `tests/scripts/host/helper-broker.test.js`

**Interfaces:**
- `brokerDecision`'s merge branch gains: with `ctx.checksHere === true`, refuse unless `checkCounts(ctx.check, head, ctx.digest, ctx.enrolled, { notCounting: ctx.notCounting })`; the line says there is no passing check on this computer. `brokerPermit` fills them. The fix's merge passes the same condition.
- `dispatchRun`'s `sentBack(work, reason = 'clash', tail = null)`. Called by the check runner's `onRed` for a head. `dispatch` re-queues as for a clash; the order gains `checkTail`, kept by the helper; a second red on the same work raises the level-3 card. `reason` keeps red and clash counts apart.
- `/engine/main-check` for `fix-rerun.js`: `{ green, rerun: false }` from the main line's latest counted check.
- A head whose result no longer matches the digest is due again by `dueChecks`.

- [ ] **Tests first:** `a merge with a green status and no signed check is refused`; `a signed pass for this head and command is allowed`; `an old head's status doesn't stand in`; `a project whose checks run on the host is unchanged`; `a changed command makes every open head due again` (Review Focus 5); `a red head goes back with its tail in the order, reason red`; `a second red raises a card`; `a clash still re-queues as before`; `fix-rerun asks the helper and never calls gh where checks run here`; `the fix's merge needs its signed check`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Require a signed check for a merge, and send a red head back`.

### Task 4: The broken-CI card, and from push to merge

**Files:**
- Create: `tests/e2e/local-checks.test.js`
- Modify: `scripts/checks/runner.js` (reads `stuckHostChecks`, raises the broken-CI card with the host's page and **Run the checks here**, **Leave them**), `scripts/host/helper.js`
- Test: `tests/e2e/local-checks.test.js`, `tests/scripts/checks/runner.test.js`

The fake engine and the stand-in host (`tests/helpers/engine-e2e.js`, `host-stand-ins.js`) drive one run: push, `pending`, a real check on a tiny project (on the Mac; a stand-in `runCheck` on Linux), `success`, signed review, merge allowed.

- [ ] **Tests first:** `a run goes from push to a merge the permit allows`; `a run with a planted status and no record is refused`; `a red check sends it back and the next head merges`; `the broken-CI card says the checks aren't running, and no word of billing`; `the card's press changes nothing on the host`; `Wheelhouse carries on once the host's checks stop`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Take a hosted project with no CI from push to merge`.

**Done when:** every test file above passes; a hosted project with no CI merges on the fake engine with the helper posting statuses; a project with working CI behaves exactly as before (`tests/e2e/engine-quick.test.js` passes). Open the pull request `Hosted reporting and the permit` and message the main session.

---

## Part 3: Finding the command, not counting, and the release

**Waits on:** part 2.

### Task 1: The finder

**Files:**
- Create: `scripts/checks/find-command.js`
- Test: `tests/scripts/checks/find-command.test.js`

**Interfaces:**
- Produces: `findCommand({ folder, config, read }) -> { testCommand, prepare, why } | null`, the table in spec 4.5, first match wins, with check 82's corrections. Reads files only, runs nothing. A scheme comes from `xcshareddata/xcschemes`; several schemes pick the one named after the project, else the first by name. `package.json` skips npm's "no test specified" (`npmTestOf`'s rule). `prepare` from `npm ci` only with a lockfile.

- [ ] **Tests first:** one row a case; `a set testCommand wins`; `a project with both Package.swift and an xcodeproj uses the xcodeproj`; `no shared scheme is not a match for that row`; `a Makefile with no test target is nothing`; `an empty folder is null`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Find a project's test command without asking`.

### Task 2: The first check, and keeping the command

**Files:**
- Create: `scripts/setup/first-check.js`
- Modify: `scripts/setup/project-files.js` (a new project's `testCommand` and `checks`), `scripts/engine/switch-pr.js` or a sibling (the helper's route for project files), `scripts/gate/guardrails.js`, `scripts/state/events.js` (`checks-state`, choice 13; a `found` note kept in the record), `scripts/state/card-lines.js`, `scripts/lib/front-desk.js`
- Test: `tests/scripts/setup/first-check.test.js`, `tests/scripts/setup/project-files.test.js`

**Interfaces:**
- Produces: `firstCheck({ project, found, runner, write, card }) -> 'passed' | 'failed' | 'nothing' | 'could-not-run'`: passed writes one Logbook line; failed raises the level-3 card, **Get them passing first** (a fix-main run) and **Carry on anyway**; nothing writes `checks-state`; could-not-run goes to the runner's card.
- Until the default branch names a command, the command in the record runs. A project already set up gets it by the helper's own route, which that first check passes; this one guardrail change has no approval because no agent wrote it, and the route refuses any other content.

- [ ] **Tests first:** `each first result does what spec 4.5 says`; `the record's command runs until the default branch has one`; `the helper's route refuses a change beyond the command`; `after that a change to the command is a guardrail change`; `the card's first option is Get them passing first`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Run the first check and keep the command it found`.

### Task 3: Not counting

**Files:**
- Create: `scripts/checks/not-counting.js`
- Modify: `scripts/checks/run.js`, `scripts/checks/runner.js`, `scripts/engine/order.js`, `scripts/engine/dispatch-run.js` (`no-tests` hold), `scripts/engine/done-check.js`, `scripts/host/helper.js` (`engineConfigOf`, `brokerPermit`), `scripts/briefing/model.js`, `scripts/engine/words.js`
- Test: `tests/scripts/checks/not-counting.test.js`, `tests/scripts/engine/order.test.js`, `tests/scripts/engine/dispatch-run.test.js`, `tests/scripts/engine/done-check.test.js`, `tests/scripts/engine/broker/rules.test.js`

**Interfaces:**
- Produces: `notCounting(views) -> boolean`; `countingEnds(views, check) -> boolean`, true for the first `passed` on the main line. The event: `checks-state { state: 'not-counting' | 'counting', why: 'nothing-found' | 'director' | 'passed' }`, helper-only, set only by the finder finding nothing or the director's click. Once `counting`, nothing but a fresh director's click on a new failed-first-check card can set it back, and that card only comes at setup.
- `runCheck` with not-counting: runs where there is a command, gives `not-counted` whatever the exit, status `success` "tests not counted yet". With no command it makes the record of choice 5.
- `workOrder` gains `testsNotCounting`: `testCommand` may be null; `done` may be empty; `orderFor` adds no default test check (choice 4). `dispatch-run` holds at `no-tests` only when counting.
- When counting begins, heads holding only `not-counted` are due again.
- Logbook on each merge: "Tests aren't counting yet".

- [ ] **Tests first:** `a failing command gives not-counted and success`; `no command gives a record with command null`; `a lane starts with no test command while not counting`; `the order has no default test check while not counting` (Review Focus 2); `the same project holds at no-tests once it counts and has no command`; `the first pass on the main line ends it for good`; `a head that fails after that is red`; `a not-counted record is refused for a project that counts`; `an open head holding only not-counted is checked again when counting begins`; `a pass on a head doesn't end it`; `the Logbook says it on every merge`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Let a project with no passing tests merge until they pass`.

### Task 4: What the tests can't hide, the words and the release

**Files:**
- Modify: `scripts/engine/test-guard.js`, `scripts/engine/protected-check.js`, `scripts/hooks/protected-tests.js`, `scripts/board/health.js` or `scripts/desk/views.js` (the Logbook's "Checks ran on this computer: passed, 3 minutes" and the minutes), `SECURITY.md`, `README.md`, `docs/data.md`, `HANDOVER.md`, `.claude-plugin/plugin.json` (0.2.1)
- Test: `tests/scripts/engine/protected-check.test.js`, `tests/scripts/hooks/protected-tests.test.js`, `tests/scripts/desk/views.test.js`, the card-check tests for the new cards

**Interfaces:**
- `isTestSettings` gains `*.xcscheme`, `*.xctestplan`. `protectedFindings` gains: fewer `.testTarget(` in `Package.swift`; a changed `scripts.test*` in `package.json`; a changed `test` target in a `Makefile` (choice 6).

- [ ] **Tests first:** `an emptied test script is a finding` (Review Focus 4); `a changed scheme or test plan is a finding`; `a dropped test target is a finding`; `a dependency added to package.json is no finding`; `the Logbook says checks ran on this computer, the same on every host`; `no director-facing line holds commit status`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Guard what a test command runs, and say checks in plain words`.

**Done when:** each test file passes; a project with no tests, one with failing tests, and one with passing tests each behave as spec 4.5 says; the pull request `Finding the command and not counting` is open with its message to the main session. **After merge, with CI green on Linux and on macOS on main, the main session tags v0.2.1:** a hosted project with no CI builds and merges.

---

## Part 4: The home and the local adapter

**Waits on:** part 1. Lean's behaviour doesn't change.

### Task 1: Lifting Lean's code

**Files:**
- Modify: `scripts/lib/local-git.js` (gains `withLocalLock`, compare-and-swap `moveHead`, `inTempTree`, `lookAtHead`, `undoMerge`'s core `revertOn`, `updateCopy`), `scripts/lean/store.js` (imports them, passing `main`)
- Test: `tests/scripts/lib/local-git.test.js`, `tests/scripts/lean/` and `tests/e2e/copilot-lean.test.js` unchanged and passing

**Interfaces:**
- Each takes `{ dir, branch, run }` in place of `project` and `main`: `moveHead({ dir, branch, to, from, run })`, `lookAtHead({ dir, branch, expected, run, record })`. Lean's refusal lines stay Lean's: the shared functions throw a `LocalRefusal` with a `code`, and `store.js` maps it to the line it says today.

- [ ] **Tests first:** `moveHead refuses when the branch has moved`; `a branch not called main works`; `two callers of withLocalLock go one at a time`.
- [ ] Run: fail. Implement. Lean's tests pass with no edit to them. Commit: `Lift Lean's local git steps into a shared module`.

### Task 2: The record, the home and changes

**Files:**
- Create: `scripts/host/local/home.js`, `scripts/host/local/changes.js`
- Modify: `scripts/lib/projects.js` (`checkRecord` takes `host: 'local'`, `remoteUrl: null`, `repo: 'local/<project>'`), `scripts/host/connection.js` (`mode: 'none'`, choice 10), `scripts/host/adapter.js` (`detectHost`: `'local'` for no remote or only other remotes), `scripts/state/events.js` (`change`, helper-only), `scripts/host/helper.js` (`lockHeld`)
- Test: `tests/scripts/host/local/home.test.js`, `changes.test.js`, `tests/scripts/lib/projects.test.js`, `tests/scripts/host/adapter.test.js`

**Interfaces:**
- Produces: `homeDir(project)`; `makeHome({ project, folder, git })`, `git clone --bare --no-hardlinks`, plus a mark file naming `computerId()`; `homeReadable(project) -> boolean`, the mark names this computer.
- Produces: `openChange({ project, branch, base, title, body, head })`, `updateChange`, `closeChange`, `changeOf(n)`, `openChanges()`. Numbers from `next-change` beside the home; each write sets `refs/pull/<n>/head` in the home and a `change` event `{ n, branch, base, title, body, state, head, mergeCommit }`.
- `lockHeld` is `homeReadable` for a local project; no `wheelhouse-lock` branch is made.

- [ ] **Tests first:** `a record with host local reads back`; `a github record with a null address is still refused`; `no remote detects local`; `only other remotes detect local and they are left as they are`; `a GitHub address still detects github`; `the home is a full copy and shares no objects`; `numbers count up from 1 and survive a restart`; `refs/pull/n/head moves with the change`; `a home copied to another computer reads as not held`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the home and local changes`.

### Task 3: The adapter

**Files:**
- Create: `scripts/host/local/adapter.js`, `scripts/host/adapter-for.js`
- Modify: `scripts/host/helper-main.js`, `scripts/setup/health.js`, `scripts/setup/uninstall-run.js` (each through `adapterOf`), `tests/scripts/host/adapter.test.js` (the method list made shared)
- Test: `tests/scripts/host/local/adapter.test.js`

**Interfaces:**
- Produces: `makeLocalAdapter({ project, git, record }) -> Adapter`, the table in spec 6, with the same methods as `makeAdapter`; `adapterOf(record, { run, env }) -> Adapter`. `merge` refuses until part 6.
- `ciState(sha) -> { sha, state: 'success' | 'failure' | 'pending' | 'none' }` from `check` events, the words `mainGreen` reads. `hasCi` is always true. `setStatus` and `verdictComment` do nothing. `previewUrl` null. `login` is `this computer`. `issue.*` refuse with a plain line.

- [ ] **Tests first:** `makeLocalAdapter has every method makeAdapter has` (the contract, run against the keys of both); one test a row of spec 6; `ciState reads not-counted as success`; `a refused issue call says so plainly`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the local host adapter`.

**Done when:** every test above passes; a registered local project reads through `adapterOf`; Lean's tests are unedited and pass. Open the pull request `The home and the local adapter` and message the main session.

---

## Part 5: Builds on it

**Waits on:** part 4, check 83.

### Task 1: The push path and the remote

**Files:**
- Modify: `scripts/host/helper.js` (`mirrorFor`, `pushFrom` take a target from the adapter), `scripts/host/local/adapter.js` (`pushTarget() -> { url, keyed: false }`), `scripts/engine/broker/routes.js`, `scripts/engine/broker/rules.js`, `scripts/setup/engine-parts.js` (`archonConfigText` with `worktree.remote: wheelhouse`), `scripts/engine/archon/adapter.js` if the lane needs it
- Test: `tests/scripts/host/local/push.test.js`, `tests/scripts/engine/broker/rules.test.js`, `tests/scripts/host/helper-switch.test.js`

**Interfaces:**
- `host.push` for local: `doPush`, `pushFrom` and `checkPush` unchanged, with the home as the push target, then `refreshMirror` from the home. `mirror.git` stays disposable.
- `addFolderRemote({ folder, mirror, git })`: one `wheelhouse` remote, a path to the engine's mirror (or check 83's fallback).
- `brokerRoutes`: a local project is refused every call, "this project has no code host".

- [ ] **Tests first:** `a run's branch reaches the home and the engine's mirror`; `a push naming the default branch is refused`; `a shallow push rebuilds the mirror, never the home`; `All stop refuses host.push`; `the broker refuses every call for a local project with one line`; `a hosted project still pushes to its remote`; `a push by an agent to the wheelhouse remote is denied by the sandbox rules, and the next refresh replaces it`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Send a run's work to the home`.

### Task 2: The folder, and changes made by hand

**Files:**
- Create: `scripts/host/local/folder.js`
- Modify: `scripts/host/helper.js` (the dispatcher's tick), `scripts/state/card-lines.js`, `scripts/lib/front-desk.js`, `scripts/survey/take.js` (the "work carried on" route takes a local change)
- Test: `tests/scripts/host/local/folder.test.js`

**Interfaces:**
- Produces: `compareFolder({ project, folder, branch, git }) -> 'same' | 'home-ahead' | 'folder-ahead' | 'parted'`; `bringFolderUp(...) -> { moved } | { line }`, fast-forward only; refuses a dirty folder or one on another branch, with "Your folder has changes of its own, so the newest version waits."
- Produces: `handMadeCard(tip)`, once per tip: **Check and add them**, **Leave them out**, **Not now**. **Check and add them** opens a local change; parted first runs "bring it up to date".

- [ ] **Tests first:** `home ahead, clean, on the branch: comes up`; `home ahead, dirty: stays, with one line`; `home ahead, on another branch: stays`; `folder ahead raises one card a tip`; `parted raises the same card and the lane brings it up to date`; `an agent's commit to the folder's main branch gets the same card and merges nothing`; `Leave them out leaves the folder and asks no more for that tip`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Keep the folder and the home in step`.

### Task 3: From work order to an open change

**Files:**
- Create: `tests/e2e/git-alone-build.test.js`
- Modify: `tests/helpers/engine-e2e.js` (a folder with no host)
- Test: `tests/e2e/git-alone-build.test.js`

- [ ] **Test first:** `a quick run goes from work order to an open change on the fake engine and a real git folder`, with a check at its head and no call to `gh`.
- [ ] Run: fail. Close the gaps it finds. Run: pass. Commit: `Run a quick lane on a project with no host`.

**Done when:** a quick lane on the fake engine ends with an open local change on a real folder; the hosted e2e tests pass. Open the pull request `Builds on the home` and message the main session.

---

## Part 6: The local queue

**Waits on:** parts 3 and 5.

### Task 1: The sweep

**Files:**
- Create: `scripts/host/local/queue.js`
- Modify: `scripts/engine/dispatch-run.js` (for a local project, the runner calls the queue where it would call `engine.start({ lane: 'merge' })`; `dispatch` unchanged), `scripts/lineage/upgrade.js` (the monthly reading names `merge.ts`, `sweep.md`, and `GATE_ROWS`)
- Test: `tests/scripts/host/local/queue.test.js`, `tests/scripts/engine/dispatch-run.test.js`

**Interfaces:**
- Produces: `sweepDecision({ change, main, stopped, incident, check, review, clashes, needsApproval, approval, permit }) -> { act: 'hold' | 'wait' | 'send-back' | 'raise' | 'merge', reason }`, spec 7.4's table in its order, pure; `GATE_ROWS`, the table's rows as data, with the Archon file each copies beside it; `localSweep({ project, ... })`, inside `withLocalLock`, oldest first.
- `needsApproval`: the permit's cases, a critical area, or any path under `.archon/`.

- [ ] **Tests first:** one test a row, in the table's order; `a red main line merges nothing`; `an incident merges only its fix`; `a change touching .archon needs the director's click`; `a refused permit waits and says why on the Logbook`; `not-counted passes only while the project is not counting`; `a project with a host still starts Archon's queue`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Stand a script in for the merge queue on local projects`.

### Task 2: The merge, and undo

**Files:**
- Create: `scripts/host/local/merge.js`
- Modify: `scripts/host/local/adapter.js` (`merge`), `scripts/host/helper.js` (undo for a local project)
- Test: `tests/scripts/host/local/merge.test.js`

**Interfaces:**
- Produces: `mergeChange({ project, n, head, git, write, now }) -> { merged, commit } | { merged: false, reason }`: a squash in a temporary worktree of the home at the main version, the change's title as its message, moved by `moveHead`, one at a time. Then a `merge` event, the mirror, the folder, the main-line check, and the backup hook (a no-op until part 8). Commits as the folder's git identity, or as Wheelhouse.
- `brokerDecision` with kind `merge` is called with the same context as a hosted merge. A lost compare-and-swap comes back next sweep. **Main moved** and `undoMerge` work on the home.

- [ ] **Tests first:** `a merge squashes with the title as its message`; `the head moved after review is refused`; `a lost compare-and-swap merges nothing and tries next sweep`; `the main-line check starts after`; `undo reverts on the home`; `a main version moved outside the helper raises Main moved`; `no identity commits as Wheelhouse`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Merge a local change onto the home`.

### Task 3: A red main line, All stop and the reports

**Files:**
- Create: `tests/e2e/git-alone-merge.test.js`
- Modify: `scripts/engine/fix-main.js` (`redMainIncident` from a commit), `scripts/checks/runner.js` (opens it), `scripts/audit/report.js` (the plain line; merges compared with the home), `scripts/jobs/weekly.js` (`git fsck` and the home's permissions, in place of protection reads), `scripts/lib/host-lines.js`
- Test: `tests/scripts/engine/fix-main.test.js`, `tests/e2e/git-alone-merge.test.js`, `tests/scripts/audit/report.test.js`

**Interfaces:**
- `redMainIncident({ commit, suspect })`, id from the commit, beside the ask form. A red main line after its second try opens it with the merged change as suspect. The fix merges by the helper's route with `weakensChecks` standing. `fix-rerun.js` uses part 2's route.

- [ ] **Tests first:** `a red main line holds work and starts one fix`; `the fix merges and the incident closes on green`; `the same commit opens one incident`; `All stop during a merge leaves the main version whole and merges no more`; `a clash goes back with reason clash`; `the audit says there is no second record, and still compares with the home`; `the weekly job finds a damaged home`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Handle a red main line and All stop on a local project`.

**Done when:** a change on the fake engine merges onto the home with a signed check, a signed review and the permit; a clash, a red main line and All stop behave as spec 7 says. Open the pull request `The local queue` and message the main session.

---

## Part 7: Setup and uninstall

**Waits on:** part 6.

### Task 1: Setup

**Files:**
- Create: `scripts/setup/local.js`
- Modify: `scripts/setup/host.js` (step 3's card, and git alone by default for a folder with no host), `scripts/lib/setup-run.js` (`stepsFor`), `scripts/setup/project-files.js` (files go to the folder's default branch, then the home; no `maintainers.json`), `scripts/setup/health.js` (a local change in the trial), `scripts/setup/tools.js` (no host tools), `skills/setup/SKILL.md`
- Test: `tests/scripts/setup/local.test.js`, `tests/scripts/setup/steps.test.js`, `tests/scripts/setup/health.test.js`, `tests/e2e/setup.test.js`, `tests/skills/setup.test.js`

**Interfaces:**
- Produces: `chooseBranch(branches) -> string | null`, the only one, or `main`, or `master`, else null for one card of up to four; `localSteps(ctx)`, the home, the `wheelhouse` remote, the finder and first check. A folder with no git gets `git init` and a first commit on `main`, which the one card names. Project name as `scripts/setup/host.js` makes it, with a suffix on a clash.
- Step 3's order: **Keep it on this computer** (recommended), **GitHub**, **GitLab**, **From a backup**, **From my other computer**. **From a backup** is left out until part 8 adds it. **Customise** offers **Put it on GitHub**, which is setup's hosted path.

- [ ] **Tests first:** `a folder with no remote asks no host question`; `only other remotes are left alone and the plan says so`; `an empty folder offers Keep it on this computer first`; `no git gets git init on main and the card names it`; `a default branch not called main works`; `submodules are no refusal`; `sign-in, tools, own app, protection, lock branch and trial pull request are skipped`; `the home, remote and first check are added`; `the card says nothing goes online and never says host`; `step 10's trial uses a local change`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Set up a project that stays on this computer`.

### Task 2: Uninstall, the words and the documents

**Files:**
- Modify: `scripts/setup/uninstall.js`, `scripts/setup/uninstall-run.js`, `templates/glossary.json` ("change"), `scripts/frontdesk/glossary.js` if it needs an alias, `scripts/lib/host-lines.js`, `scripts/runbook/runbook.js`, `SECURITY.md`, `docs/data.md`, `README.md`, `HANDOVER.md`
- Test: `tests/scripts/setup/uninstall-local.test.js`, `tests/scripts/runbook/runbook.test.js`, the pane tests

- [ ] **Tests first:** `uninstall brings the folder up first`; `the wheelhouse remote, mirror and check folder go`; `project files leave by a last local change`; `the home gets one level-4 card with Keep it first`; `the folder's git holds the whole history afterwards`; `the runbook leaves out cutting the connection for a local project`; `a line that would say pull request says change`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Uninstall from a local project, and say it in plain words`.

**Done when:** setup on a folder with no remote ends with a passing health check, using `tests/e2e/setup.test.js`'s stand-ins; uninstall leaves a full `.git`; the README says a host is optional. Open the pull request `Setup and uninstall for git alone` and message the main session.

---

## Part 8: Backups and safekeeping

**Waits on:** part 4. Task 3's hosted half needs nothing here. Part 7 for the card and **From a backup**.

### Task 1: Backups

**Files:**
- Create: `scripts/host/local/backup.js`, `scripts/host/local/restore.js`
- Modify: `scripts/host/local/merge.js` (the hook), `scripts/setup/local.js` (the one card), `scripts/setup/host.js`, `scripts/host/helper.js` (the daily try)
- Test: `tests/scripts/host/local/backup.test.js`, `restore.test.js`

**Interfaces:**
- Produces: `writeBackup({ project, folder, git, now }) -> { written, verifiedAt } | { skipped: 'away' }`: `git bundle create` beside the old copy, `git bundle verify`, rename, one earlier copy kept. An unplugged drive is no fault.
- Produces: `backupPlace({ folder, project }) -> { ok } | { ok: false, why }`, refusing a folder inside the project or on the same disk (`fs.statSync(...).dev`).
- Produces: `timeMachine({ run }) -> { on, last }`, from `tmutil destinationinfo`; `last` null where it can't be read.
- Produces: `restoreProject({ file, folder, git }) -> project`: verifies, makes the home with this computer's mark, and clones the folder if it is empty.

- [ ] **Tests first:** `a partial write never replaces a good copy`; `a verify that fails keeps the old copy`; `one earlier copy is kept`; `a backup on the same disk is refused`; `a backup inside the project is refused`; `an unplugged drive tries again when it is back`; `no private record is in the bundle`; `a restored project reads its home, with the whole history`; `a damaged backup restores nothing`; `Not now closes the card for good and building goes on`; `with Time Machine on, the card names it and offers a second copy off the computer`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Back up a local project to one file`.

### Task 2: The status

**Files:**
- Create: `scripts/safekeeping/status.js`, `scripts/safekeeping/readings.js`
- Modify: `scripts/host/helper.js` (the tick), `scripts/desk/views.js` (glance), `scripts/gate/guardrails.js` if `safekeeping` needs more than part 1 gave
- Test: `tests/scripts/safekeeping/status.test.js`

**Interfaces:**
- Produces: `safekeeping(readings, { days = 7, hereDays = 3, now }) -> { place, level, line, detail, actions, readAt }`, pure, the state table in spec 8.2, word for word.
- Produces: `readSafekeeping({ project, record, adapter, git, now }) -> readings`, writing nothing and pushing nothing; the host at most once an hour, by the helper's fetch. A running lane's branches and deleted branches aren't counted; nor is the private record.

- [ ] **Tests first:** one test a row of the state table; `a running lane is not counted`; `Time Machine with no date gives no date`; `a host and a Time Machine reads as hosted`; `a GitLab project reads the same way`; `a Lean project has no status`; `the host is read at most once an hour`; `reading writes nothing`; `it is safe the moment the reading clears`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Work out what would be lost with this computer`.

### Task 3: Where it shows, and its buttons

**Files:**
- Create: `scripts/safekeeping/actions.js` (**Put it on GitHub** is left out until part 9 adds it)
- Modify: `scripts/desk/mod-pane.js` (a row in the calm view; a health line at watch), `scripts/mod/buttons.js`, `scripts/desk/acts.js`, `scripts/briefing/model.js`, `scripts/briefing/seen.js`, `scripts/board/health.js` (the Health tab), `SECURITY.md`, `docs/data.md`
- Test: `tests/scripts/safekeeping/actions.test.js`, `tests/scripts/mod/status.test.js`, `tests/scripts/briefing/model.test.js`, `tests/scripts/briefing/seen.test.js`

**Interfaces:**
- Produces: `safekeepingAct(action, ctx) -> { ok } | { refused }`, for the buttons in spec 8.2, through the desk's `act` with the press as evidence. **Keep a copy online** sends each branch to `keep/<branch>` by `doPush` and names what goes up first. **Bring my folder up to date** is `bringFolderUp`.

- [ ] **Tests first:** `no action can reach the default branch`; `Keep a copy online never merges and names what goes up`; `Bring my folder up to date refuses a dirty folder`; `a watch shows in To watch and the verdict still says nothing is needed`; `watch raises no card`; `the briefing has one sentence on turning and one on clearing`; `an unchanged watch comes back once a month`; `a watch never holds a merge or a run`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Show safekeeping, with what the director can do from it`.

**Done when:** a local project backs up after each merge and restores on a clean home; every project shows a Safekeeping row; no card comes after setup's. Open the pull request `Backups and safekeeping` and message the main session.

---

## Part 9: Moving to a host

**Waits on:** parts 7 and 8.

**Files:**
- Create: `scripts/host/local/move.js`, `tests/e2e/move-to-host.test.js`
- Modify: `scripts/setup/host.js` (the host steps run for one project), `scripts/engine/dispatch-run.js` (holds new work during a move), `scripts/lib/projects.js`, `scripts/mod/settings-pane.js` (the option), `scripts/host/helper.js`, `README.md`
- Test: `tests/scripts/host/local/move.test.js`, `tests/e2e/move-to-host.test.js`

**Interfaces:**
- Produces: `moveToHost({ project, host, private = true, say }) -> { ok } | { waiting: 'runs' } | { failedAt, line }`. Each step is journalled and repeatable, so a move broken off carries on. Steps as spec 9: setup's host steps; push every branch; each open change becomes a pull request, its body from the record; one project-files pull request by the helper's route; `project.json` takes the host's values keeping the folder name; the folder gains `origin` and loses `wheelhouse`; protection and the lock branch.
- The home goes read-only for 30 days, then a level-4 card with **Keep it** recommended.
- `checks.where` works itself out afterwards: no CI stays here, reported as statuses. `check` events already name their commits, so nothing runs twice.

- [ ] **Tests first:** `a move waits for running runs and holds new work`; `every branch reaches the host`; `an open change becomes a pull request with its body`; `the private record stays with the project`; `the folder swaps its remotes`; `a move stopped after the push carries on and pushes nothing twice`; `a check already passed needs no second run`; `the home is left read-only and the card comes after 30 days`; `the private record never goes up`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Move a local project to a host with one card`.

**Done when:** on the stand-in host, a project moves with an open change intact and its next merge goes through the hosted path. Open the pull request `Moving to a host` and message the main session.

---

## Part 10: The counted evaluation

**Waits on:** every part above, merged. The only counted evaluation in this plan; a builder doesn't run it.

**Files:**
- Create: `tests/eval/build-loop/76-no-ci-build-to-merge.js`, `77-git-alone-to-merge.js`, `78-planted-check-refused.js`, `79-red-check-sent-back.js`, `80-git-alone-red-main.js`, `81-agent-commit-to-folder-main.js`
- Modify: `scripts/eval/engine-world.js` (a folder with no host; a stand-in host with no Actions), `scripts/eval/summary.js` (`DESIGNED` gains 76 to 81), `docs/evals/build-loop.md`, `docs/evals/README.md`, `.claude-plugin/plugin.json` (0.2.2), `HANDOVER.md`
- Test: the scenarios; `tests/scripts/eval/` for the summary

- [ ] Write each scenario on real Archon, as scenarios 42 to 75 are, spec 11's six: a hosted project with no CI, build to merge; a git-alone quick lane to merge; a planted passing check refused (`safety: true`); a red check sent back; a red main line in git alone; an agent's commit to the folder's main branch raises the hand-made card and merges nothing (`safety: true`).
- [ ] Run `npm run eval -- --all` once, with the safety subset unchanged, then `--again` for any round the rules allow. Read the model settings before starting; the director's standing rule on them holds.
- [ ] Record the result in `docs/evals/`. Commit: `Record the counted evaluation for local checks and git alone`. Open the pull request and message the main session.

**Done when:** the gate passes on one final main; a failure goes to the main session with its report, and its fix waits for no new plan. **After merge, the main session tags v0.2.2.**
