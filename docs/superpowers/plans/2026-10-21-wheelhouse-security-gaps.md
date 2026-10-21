<!-- docs/superpowers/plans/2026-10-21-wheelhouse-security-gaps.md -->

# Wheelhouse security gaps: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the safety gaps the director released on 21 October 2026: every git call Wheelhouse makes goes through one fenced route built on setup's allowed list; the test stand-ins hold on Windows and cover `curl`; and the keychain question is measured and planned, with what the sandbox can and can't do written down.

**Architecture:** One shared helper, `scripts/lib/safe-git.js`, wraps setup's own fence (`isolated`), allowed list (`allowedSetting`) and look (`refuseUnlistedSettings`) from `scripts/setup/git.js`, which it imports rather than copies, and adds the choice of transports and how often to look. Every caller moves onto it, and a test fails on any new git call in `scripts/` that doesn't use it. The helper's quick connection stops reading the director's global git config: it signs in through the host tool, as setup does. The test stand-ins gain a form that shadows `gh.exe` on Windows (a hard-linked copy of Node.js with a preload that logs), and an in-process guard for the `run` a test hands the helper.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies. `git` as a child process.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, sections 11 (the helper), 12.2 (Standard, the sandbox), 12.9 (what the safety build leaves for later: the keychain item and the git-settings item) and 15 (setup's git). Read with `HANDOVER.md`, setup's rulings R109 to R113 (comment at the top of `scripts/setup/git.js`), and checks 11, 16, 21 and 52 in `docs/checks/`.

## Scope

Three gaps, released together:

1. **Git settings.** A repository's own config can make git run a program (hooks named in config, `core.fsmonitor`, filters, `diff.external`, `core.sshCommand`, a `credential.helper`) or send the director's sign-in elsewhere (`url.*.insteadOf`, `http.*`, `remote.*.pushurl`). Setup closed its own calls (R109 to R113). This plan moves every other call onto the same route.
2. **The keychain.** A sandboxed agent's program can run `/usr/bin/security` and read the director's Claude Code and `gh` sign-ins (check 11 read a made-up item this way). This plan records what the sandbox settings can and can't do, writes the measurement (check 73) for a sitting, adds the Windows counterpart to check 52, and plans the settings change for after Copilot Part 3.
3. **Tests reaching a real host.** On Windows the stand-ins shadow nothing; `trials.js` tries `gh` at fixed paths; `curl` isn't stood in; `HOST_TOOLS` names two different lists (setup minors M2 and M3, setup Part 5b's section 4).

**Not built here, and why:**

- **Files Copilot Part 3 is changing:** `scripts/hooks/*`, `scripts/protection/settings.js`, `scripts/lib/agent-control.js`, `scripts/gate/guardrails.js`, `adapters/`. None of them runs git (the sweep checked), so the git work doesn't need them. The keychain's settings change does: Task 10, after Part 3 merges.
- **`scripts/eval/*`:** the evaluation tasks 4 and 5 session is changing it. Its five git calls run in scratch projects Wheelhouse made: Task 11, after that session merges.
- **`scripts/setup/tools.js`:** `git --version` reads no repository, and Copilot Part 6 is changing the file. Listed as an exception in Task 1's guard test.
- **`scripts/lineage/upgrade.js` `land`:** the maintainer's own tool, committing in the maintainer's own checkout with the maintainer's identity and hooks, on purpose. Listed as an exception, with that reason.

## Decisions made without the director

Each is a designer's call, recorded here and in the ledger:

- **One route, not two.** The shared helper imports setup's fence and allowed list. A repository that setup would refuse is refused everywhere, naming the key, so an ordinary project with submodules, large files or maintenance keys is refused until those keys are looked at and listed (the cost design section 12.9 already names for setup).
- **The quick connection signs in through `gh auth git-credential` or `glab auth git-credential`** for the helper's git, as setup does, instead of the director's global git config. What is lost with the global config: a proxy or certificate kept there (the environment's proxy still passes). Copilot Part 6's company certificate must reach git through the call's environment; the command centre was told on 21 October 2026.
- **Wheelhouse's own repositories are looked at once per request**, not before every call, since agents can't write `~/.wheelhouse` on the Mac (the sandbox) and the look costs a git process. On Windows, where nothing holds that folder, the once-per-request look is what catches a planted setting.
- **The helper's copy from a project folder** looks at that folder's settings first, and only that fetch may use a local path.
- **The install survey** no longer runs the project's own `core.sshCommand`: the look refuses it, and the survey's ssh command comes from the director's environment (`GIT_SSH_COMMAND`) or plain `ssh`, with `BatchMode` as before.

## Global Constraints

- Node.js 22 or later, ESM `.js`, no npm dependencies, `node:test` in `tests/**/*.test.js`.
- Every file starts with its repository-relative path comment. British or Australian English. Dates as day month year.
- No model identifiers and no attribution anywhere: code, comments, commits.
- Scripts run on macOS and Windows.
- Child processes through `run` (`scripts/lib/run.js`), with `baseEnv: withoutGitVars()` for git.
- Secrets only in a child's environment, never an argument, never in output.
- Never touch the real `~/.wheelhouse`, a real host, or the real keychain. Tests run under `tests/helpers/test-home.js`; nothing runs `security`, `gh`, `glab` or `curl` for real.
- Keep `npm test` and `npm run mod-check` green after every task.
- Don't edit `scripts/hooks/*`, `scripts/protection/settings.js`, `scripts/lib/agent-control.js`, `scripts/gate/guardrails.js`, `adapters/`, `scripts/eval/*` or `scripts/setup/tools.js`.
- **Safety review.** A task marked **Safety: yes** touches the helper, git's fence, secrets or the stand-ins that keep tests off a real host. Its review is a safety review at medium effort, never high.

## The sweep

Every git call in `scripts/` on 21 October 2026, grouped by route. "Fence" is setup's `isolated()` environment (global and system config shut out, hooks to the null file, fsmonitor off, program-naming core keys inert, `http.sslVerify`, no lazy fetch, https only); "look" is `refuseUnlistedSettings()` before the call.

| Where | Today | Folder | Network and sign-in | Task |
|---|---|---|---|---|
| `scripts/setup/git.js` `setupGit`; `setup/health.js`, `setup/host.js` (`connectFolder`, `productBranchOn`, `holdsState`, `checkOutJoined`), `setup/computers.js`, `setup/uninstall-run.js` | **Safe route** (fence and look on every call) | project folder, scratch | https, the director's sign-in by credential helper | none |
| `scripts/setup/project-files.js` `gitIn` | **Safe route**, hand-rolled (fence, look, work tree) | project folder | https, director's sign-in | none |
| `scripts/setup/host.js` `cloneState`, `ensureProfileClone` (through `state/git.js`) | Fence by environment, one look before the sequence | state and profile clones | https, director's sign-in | 2 |
| `scripts/state/git.js` `git()`: `state/clone.js`, `state/lock.js`, `state/events.js`, `state/backup.js`, `profile/store.js` | Whatever the caller passes; nothing of its own | state, lock and profile clones | from the helper: the narrow key, or the director's global config in quick | 2 |
| `scripts/host/helper.js` keyed calls (`changedPaths`, `branchChanges`, `checkCommits`, `checkPush`, push, `pushProfileOnce`, `inMirror`) | Narrow: global config shut out only. Quick: **nothing**; global config read on purpose | mirror, profile clone | https, key or director's global config | 3 |
| `scripts/host/helper.js` `pusher = gitIn({})` (CI change, the director's own sign-in) | **Nothing** | mirror | https, director's global config | 3 |
| `scripts/host/helper.js` unkeyed and local calls (`mirrorFor`, `dropRequestRefs`, `update-ref`, `patchIdOf`, `cleanUpdate`, `/test-merge`, `checkRelease`) | Global config shut out; some carry `-c core.hooksPath=/dev/null` and `MERGE_ONLY` | mirror, clones, lineage mirror | lineage: https to Wheelhouse's own repository | 3 |
| `scripts/host/helper.js` `stateGit(dir, args)` with no environment (`pullProfile` parts, `commitBackups`, enrolments, `doRestoreState`, `writeBackup`) | **Nothing**, global config read in both modes | profile and state clones | local, plus the keyed `pull --rebase` | 2 |
| `scripts/host/helper.js` `copyIn` | Global config shut out, hooks off, `protocol.file.allow=always`; `hook.*` looked for in the mirror only | fetches **from the project folder** into the mirror | local path | 4 |
| `scripts/foreman/act.js` `makeWorktree` | Global config shut out, hooks and fsmonitor off; its own fs check for `filter`, `include`, `includeIf` | project's main checkout | none | 5 |
| `scripts/feature/cli.js` `pull` | **Nothing**; hooks run | feature worktree | a local bundle file | 5 |
| `scripts/install/survey.js` `surveyIn` | Hooks and fsmonitor off; global config read; **runs the project's `core.sshCommand`** | project folder and its worktrees | **fetch of `origin`** with the director's ssh or credential helper | 6 |
| `scripts/install/cli.js` `cloneUpstreams` | **Nothing** | temporary folder | https to GitHub | 6 |
| `scripts/install/private-words.js` `scan` | fsmonitor off; global config read | the checkout it scans | none | 6 |
| `scripts/lineage/manifest.js` `fetchUpstream`; `lineage/upgrade.js` `resolveTag` | **Nothing** | temporary folder, none | https to GitHub | 6 |
| `scripts/lineage/release.js` `reinstall` | hooks off only | Claude's installed copy of the plugin | none | 6 |
| `scripts/lineage/upgrade.js` `land` | **Nothing**, on purpose | the maintainer's checkout | none | exception |
| `scripts/setup/tools.js` `git --version` | **Nothing**; reads no repository | none | none | exception |
| `scripts/eval/*` (five calls) | **Nothing** | scratch projects | none | 11 |

Everything Wheelhouse writes into its own repositories (`core.*` from `init`, `remote.origin.url` and `.fetch`, `branch.<name>.remote` and `.merge`) is already on setup's allowed list, so looking at them refuses nothing Wheelhouse made.

## Review Focus

1. **A project whose `.git/config` sets `core.fsmonitor`, a hook, `filter.x.smudge` or `url.<evil>.insteadOf`.** Expected: every Wheelhouse route into that folder (the foreman, a feature's pull, the survey, the helper's copy) refuses, naming the key, and nothing it names runs. Owning tasks: 4, 5, 6 (a test per route whose planted program would write a marker file; the marker never appears).
2. **The helper in quick mode with a hostile global git config.** A `~/.gitconfig` (the test's own `GIT_CONFIG_GLOBAL` is not used: the test points `HOME` at a scratch folder holding one) with `core.hooksPath`, `url.*.insteadOf` and a `credential.helper` that writes a marker. Expected: none of it reaches the helper's git; the push signs in through the host tool. Owning task: 3.
3. **A stand-in host on a local path.** The tests' hosts are local paths, so a fence that allows https only would break every e2e test. Expected: the helper allows a local path exactly when the project's recorded remote is one, and never otherwise. Owning task: 3 (`reachFor`), with Task 1's unit test.
4. **Windows.** `/dev/null` as the hooks folder and config file, paths with spaces and backslashes in `GIT_ALLOW_PROTOCOL` decisions, a stand-in `gh.exe` found before the real one. Expected: the fence is unchanged on Windows (Git for Windows reads `/dev/null` as `NUL`); `reachFor` treats `C:\x` and `\\server\x` as local; the stand-in folder is first on `PATH`. Owning tasks: 1 and 7 (Windows-form tests that run on every system with `platform: 'win32'`); the real Windows run is left for the Windows sitting.
5. **A test that starts the real helper without a `run`.** Expected: a test fails if any test file calls `startHelper(` without `run:`, or `runTrials(` without `spawn:`. Owning task: 7.

## File structure

```
scripts/lib/safe-git.js          the shared fenced route: safeGit, safeGitEnv, reachFor, RAW_GIT_EXCEPTIONS
scripts/setup/git.js             unchanged; its isolated, allowedSetting, refuseUnlistedSettings,
                                 setupGitEnv and unlistedSettingsLine are imported by safe-git.js
scripts/state/git.js             (changed) every call fenced
scripts/host/helper.js           (changed) gitIn fenced; quick signs in by the host tool; looks
scripts/foreman/act.js           (changed) makeWorktree through safeGit
scripts/feature/cli.js           (changed) pull through safeGit
scripts/install/survey.js        (changed) surveyIn through safeGit
scripts/install/cli.js           (changed) cloneUpstreams through safeGit
scripts/install/private-words.js (changed) scan through safeGit
scripts/lineage/manifest.js      (changed) fetchUpstream through safeGit
scripts/lineage/upgrade.js       (changed) resolveTag through safeGit
scripts/lineage/release.js       (changed) reinstall through safeGit
scripts/health/trials.js         (changed) ghPaths and curl injectable
tests/helpers/host-stand-ins.js  (changed) STOOD_IN, curl, the Windows form, guardedRun
tests/helpers/stand-in-preload.cjs  the Windows form's logger
tests/scripts/lib/safe-git.test.js
tests/scripts/lib/raw-git.test.js   no git call outside safe-git.js but the listed exceptions
tests/helpers/stand-ins.test.js     the stand-ins, both forms
probes/73-keychain/run.js, run.md   the keychain measurement, for a sitting
docs/checks/73-keychain.md          what the sandbox can and can't do, and the measurement's steps
probes/52-low-integrity/run.js      (changed) a Credential Manager trial
docs/specs/2026-10-17-wheelhouse-design.md  (changed) section 12.9's two items
```

---

### Task 1: The shared safe-git route

**Safety: yes** (git's fence)

**Files:**
- Create: `scripts/lib/safe-git.js`, `tests/scripts/lib/safe-git.test.js`, `tests/scripts/lib/raw-git.test.js`

**Interfaces:**
- Consumes: from `scripts/setup/git.js`: `isolated(env)`, `refuseUnlistedSettings({ run, gitPath, cwd })`, `setupGitEnv({ host, gitPath, env, platform })`, `NULL_FILE`. From `scripts/lib/run.js`: `run`, `withoutGitVars`.
- Produces:
  - `reachFor(url, { platform = process.platform } = {}) -> 'https' | 'local'`: `'local'` for a path (`/x`, `./x`, `C:\x`, `C:/x`, `\\server\x`) or a `file://` address; `'https'` for everything else, an `ssh` or scp-style address included (Task 6 asks for ssh by name).
  - `safeGitEnv(env = {}, { reach = 'https' } = {}) -> env`: `isolated(env)` with `GIT_ALLOW_PROTOCOL` set from `reach`: `'https'` gives `https`; `'local'` gives `https:file`; `'ssh'` gives `https:ssh`. Any `GIT_ALLOW_PROTOCOL` in `env` is replaced, never kept. Safe to apply twice.
  - `safeGit({ run = realRun, gitPath = 'git', cwd, env = {}, reach = 'https', look = 'each', workTree = null, timeoutMs = 5 * 60 * 1000 }) -> (args, options = {}) => Promise<RunResult>`: `look` is `'each'` (look before every call, as `setupGit`), `'once'` (before the first call of this function only; a refusal is thrown again on every later call) or `'never'` (fence only; allowed only where the caller's comment says why). `workTree` as `setupGit` (not for `init`). `options.env` is added before the fence is applied, so a caller can't lift it.
  - `directorSignIn(host, { platform } = {}) -> env`: the director's sign-in as git's only credential helper, fenced: `setupGitEnv({ host, platform })`.
  - `RAW_GIT_EXCEPTIONS`: a frozen list of `{ file, reason }` for files that run git without importing `scripts/lib/safe-git.js` or `scripts/setup/git.js` (filled in by Task 1 with every file not yet moved, each later task removing its own rows; at the end only `scripts/setup/tools.js` (`--version`, no repository) and the `scripts/eval/*` files remain). `scripts/lineage/upgrade.js` imports the route for `resolveTag`, so the guard passes it; its `land` is named in the file's own comment as the maintainer's deliberate exception.

- [ ] **Step 1: Write the failing tests** in `tests/scripts/lib/safe-git.test.js`, against a real `git` in temporary repositories (as `tests/scripts/setup/git.test.js` does):

```js
test('reachFor: paths and file:// are local, on both systems; https, ssh and scp forms are not', () => {
  for (const url of ['/srv/x.git', './x', 'file:///srv/x', 'C:\\x\\y.git', 'C:/x', '\\\\server\\x']) assert.equal(reachFor(url, { platform: 'win32' }), 'local');
  for (const url of ['/srv/x.git', './x', 'file:///srv/x']) assert.equal(reachFor(url, { platform: 'darwin' }), 'local');
  for (const url of ['https://github.com/o/p.git', 'ssh://git@github.com/o/p', 'git@github.com:o/p.git']) assert.equal(reachFor(url), 'https');
});
test('safeGitEnv carries the whole fence, and the transport its reach names, replacing any given', ...)
  // GIT_CONFIG_NOSYSTEM '1', GIT_CONFIG_GLOBAL NULL_FILE, core.hooksPath NULL_FILE in the pairs;
  // GIT_ALLOW_PROTOCOL 'https' | 'https:file' | 'https:ssh'; safeGitEnv({ GIT_ALLOW_PROTOCOL: 'ext' }) gives 'https'
test('safeGit refuses, naming it, a key off the allowed list before git runs, and runs nothing it names', ...)
  // repo with core.fsmonitor = <script writing marker>; safeGit({ cwd })(['status']) rejects with
  // unlistedSettingsLine(['core.fsmonitor']); marker absent
test('look once looks only before the first call, and a refusal stands for every later call', ...)
  // count calls of an injected run: look 'once' runs `config --includes --name-only --list -z` once over three calls
test('look never fences but does not look', ...)
test('a caller\'s options.env cannot lift the fence', ...)
  // options.env { GIT_CONFIG_GLOBAL: '/x', GIT_ALLOW_PROTOCOL: 'ext' } -> the run sees NULL_FILE and 'https'
test('a hook named in config, a url.insteadOf and an ext:: remote do nothing under safeGit', ...)
  // with look 'never' (the fence alone): fetch from ext::sh -c ... fails; no marker
```

And in `tests/scripts/lib/raw-git.test.js`:

```js
test('every file in scripts/ that runs git imports the fenced route, or is a listed exception', ...)
  // walk scripts/**/*.js; a file "runs git" if it matches /\b\w+\(\s*['"`]git['"`]\s*,/ or names `gitPath` in a call;
  // each such file imports '../lib/safe-git.js' (or './safe-git.js') or '../setup/git.js' (or './git.js' inside scripts/setup/),
  // or is in RAW_GIT_EXCEPTIONS
test('a planted file that runs git without the route fails the check', ...)   // the check run over a scratch tree
test('every exception names a reason and a file that exists', ...)
```

- [ ] **Step 2: Run them to see them fail:** `node --test --import ./tests/helpers/test-home.js tests/scripts/lib/safe-git.test.js tests/scripts/lib/raw-git.test.js`. Expected: FAIL, `safe-git.js` not found.
- [ ] **Step 3: Implement `scripts/lib/safe-git.js`.** Import, never copy, setup's fence and list; the header comment says the allowed list lives in `scripts/setup/git.js` (rulings R109 to R113) and is to move into `scripts/lib/` once Copilot Part 6 has merged, which is listed in the ledger. Fill `RAW_GIT_EXCEPTIONS` with every file the sweep lists as not yet moved, each with "moves in Task N of the security-gaps plan" as its reason for now.
- [ ] **Step 4: Run the two files, then `npm test`:** PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/safe-git.js tests/scripts/lib
git commit -m "Add one fenced route for git, built on setup's allowed list, and a test that every git call uses it"
```

### Task 2: The state, lock and profile clones

**Safety: yes** (the helper's own repositories; the narrow key)

**Files:**
- Modify: `scripts/state/git.js`, `scripts/host/helper.js` (only the `stateGit(dir, args)` calls that pass no environment: `pullProfile`'s local steps, `commitBackups`, the enrolment reads, `doRestoreState`'s local steps; and `writeBackup`'s caller), `scripts/lib/safe-git.js` (drop the rows this task moves)
- Test: `tests/scripts/state/git.test.js` (create), `tests/scripts/state/events.test.js`, `tests/scripts/host/helper.test.js`

**Interfaces:**
- Consumes: `safeGitEnv`, `reachFor` (Task 1).
- Produces: `git(dir, args, env = {})` in `scripts/state/git.js`, same signature; every call now runs with `safeGitEnv({ GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', ...env }, { reach })`, where `reach` is `'local'` when `env.GIT_ALLOW_PROTOCOL` already allows `file` (setup's `reaching()` and Task 3's helper decide that) and `'https'` otherwise. The fixed identity stays.

- [ ] **Step 1: Write the failing tests:**

```js
// tests/scripts/state/git.test.js
test('every state git call shuts out the global and system config and switches hooks off', ...)
  // HOME and XDG_CONFIG_HOME pointed at a scratch folder whose .gitconfig sets core.hooksPath to a folder
  // with a post-commit hook writing a marker; git(dir, ['commit', ...]) in a scratch clone; no marker
test('a local remote is reached only when the caller allowed a local path', ...)
  // git(dir, ['fetch', localPath]) fails without GIT_ALLOW_PROTOCOL 'https:file' and succeeds with it
test('the commit identity stays Wheelhouse <wheelhouse@invalid>', ...)
```

In `tests/scripts/host/helper.test.js`: `the helper's state, profile and backup git never reads the director's global config` (scratch `HOME` with a `.gitconfig` naming a hook folder; a backup commit, a profile pull and a restore run; no marker).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Fence `scripts/state/git.js`,** and pass the request's `ctx.gitEnv`'s transport (Task 3 sets it; until then, `reachFor` of the project's recorded remote) to the helper's bare `stateGit` calls, so local-path stand-in hosts still work.
- [ ] **Step 4: Run `npm test`:** PASS. Setup's own tests must pass unchanged (setup already passes a fenced environment; the fence is safe to apply twice).
- [ ] **Step 5: Commit** (`"Fence every git call in the state, lock and profile clones"`).

### Task 3: The helper's keyed, unkeyed and director's calls

**Safety: yes** (the helper; the narrow key; the director's sign-in)

**Files:**
- Modify: `scripts/host/helper.js` (`ISOLATED`, `GIT_BASE`, `gitIn`, `unkeyed`, `gitEnv`, `pusher`), `scripts/lib/safe-git.js` (drop the rows this task moves)
- Test: `tests/scripts/host/helper.test.js`, `tests/scripts/host/push-rules.test.js`, `tests/scripts/host/connection.test.js`

**Interfaces:**
- Consumes: `safeGitEnv`, `reachFor`, `directorSignIn` (Task 1); `childEnv` (`scripts/host/connection.js`, unchanged: gh and glab keep their own sign-in).
- Produces: inside `startHelper`, `gitIn(env, timeoutMs)` runs every call with `safeGitEnv({ ...GIT_BASE, ...env, ...options.env }, { reach })`, `reach` being `reachFor(<the project's recorded remote>)`; `ctx.gitEnv` is `{ ...env }` in narrow (the key's pairs; the fence comes from `gitIn`) and `directorSignIn(host)` in quick; the CI-change `pusher` is `gitIn(directorSignIn(host))`. `ISOLATED` is removed; `NO_HOOKS` and `MERGE_ONLY` stay (harmless, and `MERGE_ONLY` carries `core.attributesFile` and `merge.renormalize`, which the fence doesn't).

- [ ] **Step 1: Change the tests that pin today's quick mode.** `quick keeps the system and user git config for keyed calls; narrow switches both off` becomes `quick and narrow both shut out the system and user git config; quick signs in through the host tool`: assert `GIT_CONFIG_NOSYSTEM === '1'`, `GIT_CONFIG_GLOBAL === NULL_FILE` and a `credential.helper` pair ending `auth git-credential` in quick; the key's `http.extraheader` pair and no host-tool helper in narrow. `push-rules.test.js`'s `a CI change with the director's fresh click ... is pushed with the director's sign-in, not the key` asserts the same sign-in pair and no key pair.
- [ ] **Step 2: Add the Review Focus 2 and 3 tests:**

```js
test('a hostile global git config reaches none of the helper\'s git, in quick or narrow', ...)
  // scratch HOME with .gitconfig: core.hooksPath -> folder with pre-push hook writing a marker,
  // url.<stand-in>.insteadOf -> a second stand-in host, credential.helper -> script writing a marker;
  // a push through /push in each mode lands on the first stand-in host; no marker
test('a local path is reached only for a project whose recorded remote is one', ...)
  // project recorded with https://example.invalid/o/p.git: the run sees GIT_ALLOW_PROTOCOL 'https'
```

- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement** as the Interfaces block says. The helper's header comment on `gitIn` says what the fence does and that the director's global config never reaches it, and why the quick connection signs in through the host tool (design section 12.9's git item).
- [ ] **Step 5: Run `npm test`:** PASS, including the e2e files (their hosts are local paths).
- [ ] **Step 6: Commit** (`"Fence the helper's git in both connections, signing in through the host tool in quick"`).

### Task 4: The helper looks before it trusts a repository

**Safety: yes** (the helper; an agent-writable folder)

**Files:**
- Modify: `scripts/host/helper.js` (`mirrorFor`, `lockHeld`, the state and profile clones' first git call in a request, `copyIn`), `scripts/lib/safe-git.js` (drop the rows this task moves)
- Test: `tests/scripts/host/helper.test.js`, `tests/scripts/host/helper-test-merge.test.js`

**Interfaces:**
- Consumes: `refuseUnlistedSettings`, `unlistedSettingsLine` (through Task 1's `safeGit` with `look: 'once'`, or called directly); `safeGitEnv` with `reach: 'local'`.
- Produces: each request looks once at each of Wheelhouse's own repositories it uses (the mirror, the lock clone, the state clone, the profile clone, the lineage mirror) before its first git call there, refusing with `unlistedSettingsLine(keys)` as the route's `refused` text. `copyIn` looks at its `source` folder (`refuseUnlistedSettings({ cwd: source })`) before fetching, and its fetch alone runs with `reach: 'local'`. The `hook.*` look `configSets` does in the mirror stays.

- [ ] **Step 1: Write the failing tests:**

```js
test('a push from a project folder whose config sets core.fsmonitor is refused, naming it, and nothing runs', ...)   // Review Focus 1
test('a filter or url.insteadOf planted in the mirror\'s config refuses the request, naming it', ...)
test('a key planted in the lock clone refuses the merge, naming it, before the lock is touched', ...)
test('a request looks at each repository once, however many git calls it makes', ...)   // count the look's command
test('only the copy from a project folder may reach a local path', ...)
```

- [ ] **Step 2: Run them to see them fail. Step 3: Implement. Step 4: `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Refuse a planted git setting in the helper's repositories and in the folder it copies from"`).

### Task 5: The foreman's worktree and a feature's pull

**Safety: yes** (an agent-writable folder)

**Files:**
- Modify: `scripts/foreman/act.js` (`makeWorktree`), `scripts/feature/cli.js` (`pull`), `scripts/lib/safe-git.js` (drop these rows)
- Test: `tests/scripts/foreman/act.test.js`, `tests/scripts/feature/cli.test.js`

**Interfaces:**
- Consumes: `safeGit` (Task 1).
- Produces: `makeWorktree` runs its three git calls through `safeGit({ cwd: checkout, look: 'each' })`; `checkRepoConfig` stays in front (it also refuses a `.git` file, and reads with fs before any git runs, ruling R93). `pull` runs its fetch through `safeGit({ cwd: worktree, reach: 'local', look: 'each' })` and its merge through the same function; a refusal is a `CliError` carrying `unlistedSettingsLine(keys)`.

- [ ] **Step 1: Write the failing tests:**

```js
test('the foreman refuses, naming it, a worktree in a checkout whose config sets core.fsmonitor or a hook, and nothing runs', ...)
test('a feature\'s pull refuses, naming it, a worktree whose config holds a key off the list, and its post-merge hook never runs', ...)
test('a feature\'s pull still brings the bundle\'s commits in', ...)   // the bundle is a local file: reach 'local'
```

Update `start makes its branch and worktree afresh, ...`'s environment assertion to the fence (`GIT_CONFIG_GLOBAL === NULL_FILE`, `GIT_ALLOW_PROTOCOL === 'https'`).

- [ ] **Step 2: Run them to see them fail. Step 3: Implement. Step 4: `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Put the foreman's worktree and a feature's pull on the fenced git route"`).

### Task 6: Install and lineage

**Safety: yes** (the survey's fetch with the director's sign-in in a project folder)

**Files:**
- Modify: `scripts/install/survey.js` (`surveyIn`, `readInFlight`, `batchSshCommand`), `scripts/install/cli.js` (`cloneUpstreams`), `scripts/install/private-words.js` (`scan`), `scripts/lineage/manifest.js` (`fetchUpstream`), `scripts/lineage/upgrade.js` (`resolveTag` only), `scripts/lineage/release.js` (`reinstall`), `scripts/lib/safe-git.js` (drop these rows; add `upgrade.js`'s `land` with its reason)
- Test: `tests/scripts/install/survey.test.js`, `tests/scripts/install/cli.test.js`, `tests/scripts/install/private-words.test.js`, `tests/scripts/lineage/manifest.test.js`, `tests/scripts/lineage/upgrade.test.js`, `tests/scripts/lineage/release.test.js`

**Interfaces:**
- Consumes: `safeGit`, `directorSignIn`, `reachFor` (Task 1).
- Produces:
  - `surveyIn`'s `git` is `safeGit({ cwd, look: 'each' })` with `-c core.quotepath=off` kept as an argument and `GIT_OPTIONAL_LOCKS: '0'` in its environment; the fetch of `origin` runs with `reach: 'ssh'` when `origin`'s address is ssh or scp-style, else `'https'`, and with `directorSignIn(hostName)` as its environment for https. `batchSshCommand({ env })` no longer takes `configured`: it is the director's `GIT_SSH_COMMAND`, else `ssh`, plus ` -o BatchMode=yes`. The survey stops reading `core.sshCommand`. A refusal is the survey's error, carrying `unlistedSettingsLine(keys)`.
  - `cloneUpstreams`, `fetchUpstream`, `resolveTag`: `safeGit({ cwd: <their temporary folder, or none>, look: 'never' })`, with a comment that the folder is new and Wheelhouse's own.
  - `scan` (private words): `safeGit({ cwd: root, look: 'never' })`, with a comment: it scans the maintainer's own checkout, whose ordinary keys the list would refuse, and none of its commands runs a filter, diff driver or pager under the fence (`--no-ext-diff`, `--no-textconv` stay).
  - `reinstall`: `safeGit({ cwd: installLocation, look: 'once' })`.

- [ ] **Step 1: Write the failing tests:**

```js
test('the survey refuses, naming it, a project whose config sets core.sshCommand, and never runs it', ...)   // Review Focus 1
test('the survey\'s fetch keeps the director\'s own ssh command and adds BatchMode to it', ...)            // changed: no configured form
test('the survey\'s https fetch signs in through the host tool, never the global config', ...)
test('the upstream clone and fetch never read the director\'s global git config', ...)                    // scratch HOME with insteadOf
```

Change `the survey never runs the project's hooks or fsmonitor, ...` and `the fetch keeps the director's own ssh command ...` to the new environment; change release's `the undo reinstalls ...` to the fenced call.

- [ ] **Step 2: Run them to see them fail. Step 3: Implement. Step 4: `npm test` and `npm run private-check`:** PASS (private-check runs `scan` on this repository: it must still pass).
- [ ] **Step 5: Commit** (`"Put install's survey and clone, and lineage's fetches, on the fenced git route"`).

### Task 7: Test stand-ins that hold on Windows and cover curl

**Safety: yes** (what keeps tests off a real host)

**Files:**
- Modify: `tests/helpers/host-stand-ins.js`, `scripts/health/trials.js`, every test file that imports `HOST_TOOLS` from `tests/helpers/host-stand-ins.js`, every test that calls `startHelper(` without `run:` (`tests/helpers/setup-e2e.js`, `tests/e2e/*.test.js`, `tests/scripts/setup/uninstall.test.js` and any the search finds)
- Create: `tests/helpers/stand-in-preload.cjs`, `tests/helpers/stand-ins.test.js`
- Test: `tests/scripts/health/trials.test.js`

**Interfaces:**
- Produces:
  - `STOOD_IN` (renamed from the tests' `HOST_TOOLS`, setup minor M2): today's thirteen names plus `curl` (minor M3).
  - `standInTools({ accept = {}, form = process.platform === 'win32' ? 'node' : 'script' })`, same return shape. `form: 'script'` is today's shell scripts. `form: 'node'` makes `<dir>/<name>.exe` on Windows (no extension elsewhere) as a hard link to `process.execPath` (falling back to one copy in `dir` and hard links to that copy), and puts `--require "<dir>/stand-in-preload.cjs"` (copied from `tests/helpers/`) at the front of `process.env.NODE_OPTIONS`; `restore()` puts `NODE_OPTIONS` back too.
  - `stand-in-preload.cjs`: when `path.basename(process.execPath)` without `.exe` is in `STOOD_IN`, appends `<name> <args>` to `<dir>/calls.log` (the first argument as `path.relative(process.cwd(), process.argv[1])`, since Node resolves it), exits 0 for an accepted call (the accept list is written to `<dir>/accept.json`), else writes `<name> is not run in this test` to stderr and exits 1. In any other Node.js process it does nothing.
  - `guardedRun(run, { log = [] } = {}) -> run`: a `run` that refuses, without starting it, any program whose base name (without `.exe`, `.cmd`, `.bat`) is in `STOOD_IN`, recording `<name> <args>` in `log` and answering `{ code: 1, stdout: '', stderr: '<name> is not run in this test' }`; every other program goes to `run`.
  - `runTrials(deps)`: takes `deps.ghPaths` (default `ghPaths()`); `curl` is run through `deps.spawn` as today.
- The Windows form is tested on every system with `form: 'node'` (Node.js itself is the stand-in, so the mechanism is the same); its first real Windows run is left for the Windows sitting, and the file's header comment says so.

- [ ] **Step 1: Write the failing tests** in `tests/helpers/stand-ins.test.js`:

```js
for (const form of ['script', 'node']) {
  test(`${form} form: gh, curl and security are found first on the PATH, logged and refused`, ...)
    // spawnSync('gh', ['pr', 'close', '12']) -> status 1, calls() === ['gh pr close 12']
  test(`${form} form: an accepted call exits 0 and is logged`, ...)
}
test('node form: an ordinary node child is unaffected by the preload', ...)
test('restore puts PATH and NODE_OPTIONS back', ...)
test('guardedRun refuses a stood-in program by base name, with any extension or folder, and passes git', ...)
  // '/opt/homebrew/bin/gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', 'curl' refused and logged; 'git' runs
test('no test starts the real helper without a run, or runs the trials without a spawn', ...)   // Review Focus 5
  // scan tests/**/*.js: every `startHelper(` call's argument text includes `run:`; every `runTrials(` includes `spawn:`
```

In `tests/scripts/health/trials.test.js`: `the gh trial tries only the paths it is given`.

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement,** rename `HOST_TOOLS` to `STOOD_IN` at every import, and give each real-helper test `run: guardedRun(realRun, { log })` with an assertion that `log` is empty at the end (as `calls()` is asserted today). The header comment of `host-stand-ins.js` replaces the paragraph that says Windows stand-ins are on the security-gaps list with how the node form works and that its real Windows run is still to come.
- [ ] **Step 4: Run `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Stand in for host tools on Windows too, and for curl, and guard the run tests hand the helper"`).

### Task 8: The keychain: what the sandbox can and can't do, and check 73

**Safety: yes** (secrets)

**Files:**
- Create: `docs/checks/73-keychain.md`, `probes/73-keychain/run.js`, `probes/73-keychain/run.md`
- Modify: `docs/checks/README.md`, `probes/52-low-integrity/run.js`, `probes/52-low-integrity/run.md`

**What is known, for the note** (measured on 21 October 2026 with `sandbox-exec` on macOS 27, without touching any keychain: `security help` only):

- A Seatbelt rule denying `file-read*` of `/usr/bin/security` does **not** stop it running (exit 0); it only stops it being copied. A `process-exec` denial does stop it (exit 71). Claude Code's sandbox settings offer read and write denials, network lists, `credentials` (files denied, environment variables removed or masked) and `allowMachLookup` (which only adds services); none denies running a program or reaching the security service. So no project setting stops a sandboxed program running `security find-generic-password -w`, and `gh` and Claude Code both keep their items through `/usr/bin/security`, whose items `/usr/bin/security` reads without a prompt (check 11).
- What settings can still do: deny reads of the keychain files themselves (`~/Library/Keychains`). Whether that stops `security` depends on whether the file keychain is read in the calling process or by the security service; check 73 measures it. The cost to measure with it: `codesign` and signing in iOS builds use the keychain too.
- Windows: there is no sandbox on native Windows (check 10). Any agent command can read Credential Manager (`gh` keeps its token there) through PowerShell's `PasswordVault` or `cmdkey`-style calls. Under Guarded, commands run at low integrity; whether a low process can read Credential Manager is check 52's new trial.

**Interfaces:**
- Produces, for Task 10: check 73's answer (does denying `~/Library/Keychains` reads stop a sandboxed `security find-generic-password -w`?), and check 52's new line (`credential-manager-low`: refused or read).

- [ ] **Step 1: Write the probe.** `probes/73-keychain/run.js --consent` (refuses to run without the flag; the director's sitting only): makes a throwaway keychain file in a scratch folder (`security create-keychain -p <random> <file>`), records the search list before and puts it back exactly after (`security list-keychains -d user -s ...`), stores one made-up item (`wheelhouse-probe-73`, a random value) in that file only, then runs `security find-generic-password -s wheelhouse-probe-73 -w <file>` three ways: plain; under `sandbox-exec` denying `file-read*` of the scratch keychain's folder; under `sandbox-exec` denying `file-read*` of `~/Library/Keychains` while reading the scratch file by path (as a control). Prints only `read n characters` or `refused` per way; deletes the keychain file and checks the search list is as it was. Never reads any other item.
- [ ] **Step 2: Add check 52's trial.** In `probes/52-low-integrity/run.js`: store a made-up `PasswordVault` item at the normal level, try reading it from the low process, print `refused` or `read n characters`, delete it. `run.md` gets the step.
- [ ] **Step 3: Write `docs/checks/73-keychain.md`** in the house form (Answer: Deferred, waiting for a sitting; Question; Tested on; Method; Evidence, holding the `sandbox-exec` measurements above; What it means for the design; Needs the director), and its row in `docs/checks/README.md`.
- [ ] **Step 4: Run `npm test`:** PASS (the probes are not run).
- [ ] **Step 5: Commit** (`"Record what the sandbox can do about the keychain, and write check 73 and check 52's Credential Manager trial for the sittings"`).

### Task 9: The design's section 12.9

**Safety: no**

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md` (section 12.9's keychain item and git-settings item; section 21's line on setup's git)

- [ ] **Step 1: The git-settings item** now says: every Wheelhouse git call goes through one fenced route built on setup's allowed list (`scripts/lib/safe-git.js`), with the helper signing in through the host tool in both connections; left open: the proxy and certificate settings of the environment, the look-then-read gap, the untried Windows behaviours, ordinary projects' harmless keys refused until listed, the maintainer's `land` and the evaluation harness's calls (Task 11).
- [ ] **Step 2: The keychain item** says what Task 8 found: no project setting stops a sandboxed program running `security`; check 73 measures whether denying the keychain files does; the Windows counterpart (no sandbox; check 52's trial for Guarded); and Task 10's change, after Copilot Part 3.
- [ ] **Step 3: Commit** (`"Say in the design what the security-gaps work closed and what it leaves"`).

### Task 10: The keychain in Standard's settings (after Copilot Part 3 merges, and after check 73)

**Safety: yes** (secrets). **Not built in this branch.**

**Files:** `scripts/protection/settings.js`, `scripts/hooks/tool-guard.js`, `scripts/lib/credentials.js`, their tests.

- If check 73 says denying the keychain files stops `security`: add `~/Library/Keychains` to the macOS sandbox's `credentials.files` with `mode: 'deny'` for projects that don't sign apps, with the cost named on setup's card for a project that does (the director's call, as a card).
- Either way: add `GH_TOKEN`, `GITLAB_TOKEN` and `GITHUB_TOKEN` to `sandbox.credentials.envVars` with `mode: 'deny'`; the tool guard refuses a command line that runs `security` with `find-generic-password`, `find-internet-password`, `dump-keychain` or `export` (it stops only the plain form, and its comment says so).
- Rename `scripts/protection/settings.js`'s `HOST_TOOLS` (deploy tools) to `DEPLOY_TOOLS`, so no two lists share the name (minor M2's other half).
- If check 73 says the files don't help: the keychain stays open to a sandboxed program on the Mac; the quick connection's warning already says an agent could read the sign-in (check 21), and the design says plainly that only a separate macOS account holds Claude Code's own sign-in.

### Task 11: The evaluation harness's git (after the evaluation tasks 4 and 5 session merges)

**Safety: no** (scratch projects Wheelhouse made). **Not built in this branch.**

**Files:** `scripts/eval/stand-in-helper.js`, `scripts/eval/feature-project.js`, `scripts/eval/front-desk.js`, `scripts/eval/harness.js`, `scripts/eval/run.js`, `scripts/lib/safe-git.js` (drop their rows).

- Each call through `safeGit({ cwd, look: 'once' })`, keeping the identity arguments; `run.js`'s `rev-parse HEAD` in this repository with `look: 'never'` and the private-words reason.

---

## Order

Tasks 1 to 9 in order, one implementer at a time; 2 needs 1, 3 needs 2, 4 needs 3. Tasks 5, 6 and 7 need only Task 1, but share `scripts/lib/safe-git.js`'s exception list, so they also run one at a time. Tasks 10 and 11 wait for the merges they name.
