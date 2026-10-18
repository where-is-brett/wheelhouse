<!-- docs/superpowers/plans/2026-10-19-wheelhouse-windows-build-commands.md -->

# Wheelhouse build commands on Windows: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Windows feature sessions the three levels of the setting **Build commands on Windows**: Ask (the default, with a grant from the director's click), Guarded (a low-integrity runner, the recommendation where its self-test passes), and Unattended (dangerous, by its own card, shown on the board).

**Architecture:** One module, `scripts/protection/windows-builds.js`, reads the level and the director's grants from the state views and turns them into the allow rules the watcher's waker passes to a feature session on Windows. The feature session's `ask` gains a `build-command` kind whose options it fixes itself. Guarded is a runner, `scripts/windows/guarded.js`, started from a copy of Node.js that Windows' own `icacls` labels low, so the command and everything it starts can't change files at the normal level; the waker labels each worktree before the session starts. The board, the session start and the briefing show the level.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies. Windows' own `icacls` and `whoami`. Nothing installed and no administrator.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`: section 12.2 ("Build commands on Windows"), sections 14.1, 14.3 and 14.4, checks 52 and 53 in section 20, and the director's decision of 19 October 2026 in section 22. Read with `docs/specs/2026-10-18-build-loop-design.md`, section 11 ("On Windows"), and the research, `docs/research/windows-build-commands-2026-10.md` (sections 3.1, 8.1 and 8.4).

## Scope

It changes code that is merged (build-loop Task 13: `scripts/protection/settings.js`, `scripts/watcher/waker.js`) and code still being built: the build loop's Part 4 (Tasks 15, 17 and 19, on `claude/build-loop-foreman-9786cf`) and the board-and-usage plan (Tasks 3, 11 and 14). So it starts once build-loop Part 4 and board-and-usage Part 5 have merged, and each task names the files as those leave them.

**Build-loop Part 5, the gate (Tasks 20 to 22), needs no change.** The gate never runs project code, and every level leaves reviews, the gate and STOP as they are. A pull request built at Unattended is reviewed and merged like any other: the risk Unattended takes is to the computer, not to what merges.

It does not set up Microsoft Execution Containers, WSL2, containers or Windows Sandbox, each of which needs IT (research, section 8.3). When Claude Code's own sandbox runs on Windows, the weekly official-sources check (board-and-usage Task 9) reports it from Claude Code's changelog, and the design is revisited.

## Global Constraints

Everything in the build-loop plan's Global Constraints holds (`docs/superpowers/plans/2026-10-18-wheelhouse-build-loop.md`): Node.js 22 or later, no npm dependencies, ESM `.js`, `node:test` in `tests/**/*.test.js`, macOS and Windows, the path comment on every file, British or Australian English, dates as "19 October 2026", no model identifiers anywhere and no `Co-Authored-By` line in commits, everything under `wheelhouseHome()`, times in UTC ISO 8601 with a `now` argument, child processes through `run`, guards failing closed and informing hooks failing open. In addition:

- **Ask is the default, and anything that can't be read is Ask.** A missing, unconfirmed, unreadable or unknown level, a level set by another computer, Unattended in a Locked project, and Guarded without a passing self-test all read as `ask`.
- **Off Windows nothing changes.** On macOS and Linux, `featureAllowRules` gives what it gives today, whatever the setting says.
- **Grants come only from signed clicks.** A grant is read from a verified `answer` action on a `build-command` question (`views.questions[id].answer`). Guarded and Unattended are read only from a verified confirmation: Guarded on `confirmLine`, Unattended on its own `unattendedBuildsLine` (Task 1).
- **A build command is a configured one.** A grant, a question and an Unattended rule name only the configuration's `buildCommands` that pass `isBuildCommand` (`scripts/gate/guardrails.js`), and `GIT_LOCAL = ['git status', 'git diff', 'git log', 'git show', 'git add', 'git commit', 'git restore', 'git rm', 'git mv']`. The Guarded runner runs anything at low except the forms that fetch new code, because low integrity, not a list, is what holds it.
- **No admin, nothing installed.** Guarded uses only `process.execPath`, `icacls` and `whoami`.
- **The card's words are the design's,** held once as constants in `scripts/protection/windows-builds.js`.

## Review Focus

1. **A grant for one run reused.** A session given **Allow this time** is woken again before the director clicks anything else. Expected: the second run gets no allow rule; the waker records each `once` grant as used in its own folder, which no session can write. Owning task: Task 2.
2. **The runner not really low.** The copied `node.exe` lost its label (a reinstall, a copy by another tool), or a policy started it at medium. Expected: the runner checks its own token before every command and refuses to run, saying so; the session start's self-test fails and Guarded reads as `ask`. Owning task: Task 6.
3. **A build planting a hook.** A Guarded `npm test` writes `.git/hooks/pre-commit`, `.claude/settings.local.json` or `.mcp.json` in the worktree. Expected: refused, because those stay at the normal level. Owning task: Task 6.
4. **The setting from another computer.** Unattended turned on on one Windows computer; a second Windows computer reads the same state branch. Expected: `ask` on the second. Owning task: Task 1.
5. **A command that fetches new code under Guarded.** `npm install`, `npm ci`, `npm i x`, `npx x`, `pnpm dlx x` or `yarn add x`, given to the runner. Expected: refused, with a line telling the session to ask. A project script that fetches through `npm run` is out of the runner's reach, so Guarded's card says the network stays open. Owning task: Task 6.

---

## Part 1: Ask and Unattended

### Task 1: The level and its card

**Files:**
- Create: `scripts/protection/windows-builds.js`
- Modify: `scripts/state/card-lines.js` (`unattendedBuildsLine`), `scripts/settings/catalogue.js` (board-and-usage Task 3: the `windowsBuildCommands:<computer>` key)
- Test: `tests/scripts/protection/windows-builds.test.js`, `tests/scripts/settings/catalogue.test.js`

**Interfaces:**
- Consumes: the `settings` view (`scripts/state/views.js`), which accepts a setting only on a verified confirmation; `computerId()` (`scripts/lib/paths.js`); `lockedByPath` (`scripts/hooks/kit.js`).
- Produces:
  - `LEVELS = ['ask', 'guarded', 'unattended']`; `settingKey(computer) -> 'windowsBuildCommands:<computer>'`; `GIT_LOCAL` (Global Constraints).
  - `unattendedBuildsLine(eventId, computer) -> string`, in `card-lines.js`: `Run build commands unattended on this Windows computer, with nothing to hold them (<computer>, <eventId>)`.
  - `buildsLevel({ views, computer, locked, guardedReady }) -> 'ask' | 'guarded' | 'unattended'`: the accepted value of `settingKey(computer)`; `unattended` only when the accepting confirmation's line is `unattendedBuildsLine` for that event and computer, and never when `locked`; `guarded` only when `guardedReady` (Task 6). A plain `setting` event for the key with the value `ask`, newer than the accepted value, is in force at once with no confirmation (design section 14.4: turning it off needs no card); any other unconfirmed value is ignored.
  - `UNATTENDED_CARD` and `GUARDED_CARD(selfTest)`: `{ what, why, risk, options, recommend }` with the design's words (section 12.2). `UNATTENDED_CARD`'s options are `keep-asking`, `turn-on` and, only where `guardedReady`, `guarded`, which is then the recommendation (else `keep-asking`). `GUARDED_CARD` says what the self-test found: writes held, and reads of the keys folder held or not.
  - The catalogue entry: levels `ask`, `guarded`, `unattended`; default `ask`; home `project`; the key pattern `windowsBuildCommands:<computer>`, as `known:<concept>` is a pattern.

- [ ] **Step 1: Write the failing tests.**

```js
test('nothing set, an unconfirmed proposal, or an unknown value reads as ask', ...)
test('unattended counts only from a confirmation on its own card line', ...)    // a confirmLine click gives ask
test('a plain event back to ask takes effect at once; a plain event to anything else does not', ...)
test('a level set on another computer reads as ask here', ...)                  // Review Focus 4
test('unattended in a Locked project reads as ask', ...)
test('guarded reads as ask until this computer\'s self-test passes', ...)
test('the Unattended card recommends Guarded where it is offered, and keeping asking otherwise', ...)
test('the Guarded card says whether the keys folder could be read', ...)
```

- [ ] **Step 2: Run `node --test tests/scripts/protection/windows-builds.test.js`, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/protection/windows-builds.js scripts/state/card-lines.js scripts/settings/catalogue.js tests
git commit -m "Read the Windows build-commands level, with Unattended only from its own card"
```

### Task 2: Build-command questions, grants and the waker

**Files:**
- Modify: `scripts/feature/files.js` (`QUESTION_KINDS` gains `build-command`), `scripts/feature/cli.js` (`ask --kind build-command`), `scripts/protection/settings.js` (`featureAllowRules`), `scripts/watcher/waker.js` (`featureArgs`), `scripts/protection/windows-builds.js`
- Test: `tests/scripts/feature/cli.test.js`, `tests/scripts/protection/settings.test.js`, `tests/scripts/protection/windows-builds.test.js`, `tests/scripts/watcher/waker.test.js`

**Interfaces:**
- Consumes: `buildsLevel` (Task 1); `views.questions` (`{ question, answer: { label, at } | null }`); `isBuildCommand`; the helper's read-only `/config` route (`client.config`, ruling R50); the waker's folder `projects/<p>/watcher/`.
- Produces:
  - `ask` becomes `async ask({ worktree, argv, client, project })`, so this kind can read the configuration. `ask --kind build-command --command "<c>" [--command …] --why …`: each command must be in `GIT_LOCAL` or in `buildCommands` of the configuration `client.config` returns, never the working copy's. The CLI writes the options itself, `once`, `feature` and `not-now`, with the design's words, `recommendation: 'once'` and `level: 3`; `--option`, `--recommend` and `--level` are refused for this kind. `what` names each command and, for `npm test` and `npm run <x>`, the line from the worktree's `package.json` it runs (cut at 200 characters, `(no such script)` if missing).
  - `buildGrants({ views, work, used }) -> Array<{ questionId, commands: string[], scope: 'run' | 'feature' }>`: from verified answers `once` (scope `run`, unless `used` holds its id) and `feature` (until the work's `report` event or its close).
  - `featureAllowRules(config, { platform, level = 'ask', grants = [], guardedCommand = null })`: off Windows, unchanged. On `win32`: `unattended` gives one rule per configured command and per `GIT_LOCAL` entry; `guarded` gives the one rule `Bash(<guardedCommand>:*)` (Task 6); `ask` gives one rule per granted command. Rules keep today's `Bash(<command>:*)` form.
  - `makeWaker` takes `windowsBuilds: (work) => { level, grants, guardedCommand }`, whose default reads the views as `locateFeature` does (`listEvents`, `buildViews`) and answers with `buildsLevel` and `buildGrants`; tests pass their own. `featureArgs(work)` on `win32` passes its answer to `featureAllowRules` and, after starting a run that used a `run` grant, adds its id to `projects/<p>/watcher/grants-used.json`.

- [ ] **Step 1: Write the failing tests.**

```js
test('ask --kind build-command writes the three fixed options, recommending once', ...)
test('a build-command question refuses its own options, a recommendation, or a command not configured', ...)
test('what it runs comes from package.json, cut at 200 characters', ...)
test('on Windows, ask with no grant gives no allow rules', ...)
test('allow this time gives the rule for one run only', ...)                  // Review Focus 1
test('allow for this feature lasts until the feature reports or closes', ...)
test('unattended gives every configured command and local git on Windows', ...)
test('guarded gives only the runner\'s rule', ...)
test('off Windows the level and grants change nothing', ...)
test('an unsigned answer grants nothing', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/feature scripts/protection scripts/watcher tests
git commit -m "Let the director's click on a build-command card grant a Windows session its commands"
```

**If check 27's Windows half gives Shape 2,** a Desktop feature session can't be given rules on its command line: the watcher writes the rules into the worktree's `.claude/settings.local.json` and takes them out when the grant ends, if check 53 finds a running session picks the change up. If it doesn't, the card for a Shape 2 feature says to open that session and click Allow there.

### Task 3: The brief and the foreman

**Files:**
- Modify: `templates/brief/brief.md` (build-loop Task 15), `scripts/feature/brief.js` (`renderBrief`'s `windowsBuilds` option), `scripts/foreman/act.js` (passing it when it renders a brief), `skills/foreman/SKILL.md` (build-loop Task 19)
- Test: `tests/scripts/feature/brief.test.js`, `tests/scripts/foreman/act.test.js`, `tests/skills/foreman.test.js`

**Interfaces:**
- Consumes: Task 2's `ask --kind build-command`; `UNATTENDED_CARD`, `GUARDED_CARD` (Task 1); `guardedCommand` (Task 6).
- Produces:
  - `renderBrief({ fields, pluginRoot, implementText, windowsBuilds = null })`, where `windowsBuilds` is `null` off Windows, else `{ level, guardedCommand }`. At `ask` the brief says: "Before your first build command, ask for every one you will need at once with `{{cli}} ask --kind build-command --command "<command>" …`, then end your turn. A refused command means the grant has ended: ask again." At `guarded` it says: "Run every build command through `<guardedCommand>`, for example `<guardedCommand> npm test`. It refuses commands that fetch new code; ask for those with `ask --kind build-command`." At `unattended`, and off Windows, nothing new.
  - The foreman's playbook: a `build-command` question becomes a card with its three options and, for `feature`, the line "for as long as this lasts, the builder can do whatever your account can"; **Not now** holds the feature and puts it in the next briefing; after a feature's third `build-command` card in a day, the foreman offers `UNATTENDED_CARD` once that day, after the question and never in its place.

- [ ] **Step 1: Write the failing tests.**

```js
test('a Windows brief at ask tells the session to ask for its build commands at once', ...)
test('a Windows brief at guarded gives the runner\'s exact command', ...)
test('the brief says nothing new at unattended or off Windows', ...)
test('the foreman offers the Unattended card at most once a day, after the question', ...)   // skill test, static
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test` and `claude plugin validate .`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add templates/brief scripts/feature scripts/foreman skills/foreman tests
git commit -m "Tell Windows feature sessions how to run their build commands at each level, and the foreman how to card them"
```

### Task 4: Shown while it is on

**Files:**
- Modify: `scripts/lib/platform-lines.js`, `scripts/hooks/session-start.js`, `scripts/board/health.js` (board-and-usage Task 11), `scripts/briefing/model.js` (board-and-usage Task 14)
- Test: `tests/scripts/hooks/session-start.test.js`, `tests/scripts/board/health.test.js`, `tests/scripts/briefing/model.test.js`

**Interfaces:**
- Consumes: `buildsLevel` (Task 1).
- Produces:
  - In `platform-lines.js`: `UNATTENDED_LINE = 'Build commands run unattended on this Windows computer, with nothing to hold them.'` and `GUARDED_LINE = 'Build commands run at low integrity on this Windows computer: they can\'t change files outside the project, but can still use the network.'`
  - `healthLines` takes `buildsLevel` and, on Windows, adds right after `WINDOWS_LINE` either `UNATTENDED_LINE` at level `watch` or `GUARDED_LINE` at level `ok`; for a Locked project whose setting says `unattended`, "Unattended build commands are off in a Locked project" at `watch`.
  - The session start's Windows line is followed by `UNATTENDED_LINE` while it is on.
  - The briefing carries `UNATTENDED_LINE` in the first briefing of each week (Monday, the director's time) while it is on.

- [ ] **Step 1: Write the failing tests** for each line in its case and order, and for none at `ask` or off Windows.
- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/lib scripts/hooks scripts/board scripts/briefing tests
git commit -m "Show the Windows build-commands level on the board, at session start and weekly in the briefing"
```

## Part 2: Guarded

### Task 5: Checks 52 and 53

**Files:**
- Create: `probes/52-low-integrity/run.js`, `probes/53-windows-grants/run.js`, `docs/checks/52-low-integrity.md`, `docs/checks/53-windows-grants.md`
- Modify: `docs/checks/README.md`

**Interfaces:**
- Produces, in each note's "What it means for the design", for Tasks 2 and 6: whether a copied, low-labelled `node.exe` starts at low and is allowed by the computer's policy; which writes are refused; which reads succeed; which of `icacls`, PowerShell (by its language mode) and `node:ffi` can set a "no read up" label that holds, with the exact call (`LOCK_READS_ROUTE`); whether `git commit` works with the folders Task 6 labels; the time a Guarded `npm test` takes against a normal one; whether a low process can start a normal-level one; whether Desktop applies a sandbox; whether `-p` refuses an unallowed command at once and runs one named by `--allowedTools`.

The questions are the design's checks 52 and 53 (section 20); the notes follow the findings note format (`tests/docs/checks-format.test.js`).

- [ ] **Step 1: Write the probes** on the Mac. Each runs on Windows only, as a standard user, with `node probes/<n>/run.js`, prints one line per trial (`PASS`, `FAIL` or `SEEN <what>`) and cleans up what it made. `52` follows the research's section 8.4, items 1 to 7, against a scratch repository with a linked worktree in the system's temporary folder. `53` runs `claude -p` through `claude.cmd` in a scratch project, as check 27's probe does, with a made-up prompt that runs `npm test`, first with no allow rule and then with `--allowedTools "Bash(npm test:*)"`, and with the runner's rule from Task 6's form.
- [ ] **Step 2: Director (Windows, about 20 minutes, in the next Windows sitting).** Run both probes; check 53's Desktop step is the research's section 8.4, item 9. On a managed work computer as well if one is to hand.
- [ ] **Step 3: Write both notes** and their rows in `docs/checks/README.md`; run `npm test`, expect PASS.
- [ ] **Step 4: Commit.**

```bash
git add probes/52-low-integrity probes/53-windows-grants docs/checks
git commit -m "Record checks 52 and 53: the low-integrity runner and granting build commands on Windows"
```

### Task 6: The low-integrity runner and its self-test

**Files:**
- Create: `scripts/windows/guarded.js`, `scripts/windows/low.js`
- Modify: `scripts/watcher/waker.js` (labelling before `startFeature` and each Guarded wake), `scripts/hooks/session-start.js` (the self-test), `scripts/foreman/tools.js` (its path-to-command check, moved to `scripts/lib/command-path.js` and shared)
- Test: `tests/scripts/windows/guarded.test.js`, `tests/scripts/windows/low.test.js`, `tests/scripts/lib/command-path.test.js`

**Interfaces:**
- Consumes: Check 52's note (`LOCK_READS_ROUTE`, the folders git needs); `run`; `wheelhouseHome()`.
- Produces:
  - `commandPath(path, { platform }) -> string`, in `scripts/lib/command-path.js`: the checked, quoted form `scripts/foreman/tools.js` makes today (forward slashes, a drive letter, single quotes), so a path can sit in an allow rule. `tools.js` calls it.
  - `lowNode({ run, home }) -> Promise<string>`, in `low.js`: copies `process.execPath` to `<home>/windows/low-node/node.exe` when missing or a different size, runs `icacls <copy> /setintegritylevel L`, and returns the copy's path.
  - `labelWorktree(worktree, { run, commonDir }) -> Promise<void>`: `icacls <worktree> /setintegritylevel (OI)(CI)L`; then back to `M` on the worktree's `.git` file, `.claude`, `.mcp.json` and `.vscode` where they exist; and, so local git works, `L` on the worktree's own admin folder under `<commonDir>/worktrees/`, `<commonDir>/objects`, and the feature's folders under `<commonDir>/refs/heads/feature/` and `<commonDir>/logs/refs/heads/feature/` (adjusted to check 52's answer). `<commonDir>/hooks` and `<commonDir>/config` are never labelled.
  - `lockReads(paths, { run }) -> Promise<{ held: boolean }>`: sets a "no read up" label on each by `LOCK_READS_ROUTE`; `{ held: false }` where the computer has no route.
  - `guardedCommand({ home, pluginRoot }) -> string`: `<commandPath(lowNode)> <commandPath(pluginRoot/scripts/windows/guarded.js)>`, the prefix the brief gives and the one allow rule.
  - `guarded.js <command words…>`, run by the low copy in the worktree: before anything, checks its own token is low (`whoami /groups` lists `S-1-16-4096`) and exits 3 with "This runner isn't at low integrity, so it won't run anything." otherwise; refuses, exit 4, the fetching forms (`npm install`, `npm i`, `npm ci`, `npm add`, `npm update`, `npm exec`, `npx`, `pnpm add`, `pnpm install`, `pnpm dlx`, `yarn add`, `yarn install`, `yarn dlx`), each refusal saying "Ask for this with ask --kind build-command."; sets `npm_config_cache`, `TEMP` and `TMP` to `<worktree>/.wheelhouse/tmp/`; runs the command, kills its whole tree (`taskkill /T /F`) after `GUARDED_TIMEOUT_MS = 30 * 60 * 1000`, and exits with its code.
  - `selfTest({ run, home, worktree }) -> Promise<{ at, lowStarts, writeHeld, keysReadHeld }>`, run by the session start on Windows when the level is `guarded` or the Guarded card is about to be shown, within 3 seconds or counted as not ready, after `lowNode` and `lockReads` on the helper's keys folder and the credential folders of design section 12.2: the runner tries to write a marker in `<home>` and to read a marker it placed beside the helper's keys file; results go to `<home>/windows/guarded-selftest.json`. `guardedReady` (Task 1) is `lowStarts && writeHeld` from a self-test under a day old.

- [ ] **Step 1: Write the failing tests,** with a fake `run` that records `icacls`, `whoami` and `taskkill` calls and answers as Windows would; the real calls run only in check 52's probe.

```js
test('the low copy is made once and labelled low', ...)
test('a worktree is labelled low, with its .git file, .claude and .mcp.json put back at the normal level', ...)  // Review Focus 3
test('the common folder\'s hooks and config are never labelled', ...)
test('the runner refuses to run when its token is not low', ...)                                            // Review Focus 2
test('the runner refuses the fetching forms and says to ask', ...)            // Review Focus 5
test('the runner points npm\'s cache and the temporary folders inside the worktree', ...)
test('a run past the time limit has its whole tree killed', ...)
test('the self-test is ready only when low starts and the write is held, and for a day', ...)
test('commandPath gives the foreman\'s rules the same form as before', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts/windows scripts/lib scripts/watcher scripts/hooks scripts/foreman tests
git commit -m "Run Windows build commands at low integrity through Wheelhouse's own runner, with a self-test"
```

## Plan's calls

Settled here without the director:

1. **The level is a project setting keyed by computer,** `windowsBuildCommands:<computer>`, as `known:<concept>` is keyed, so it needs no new kind of setting.
2. **Unattended has its own card line,** so a general confirmation can't turn it on.
3. **The `build-command` question's options are fixed by the CLI,** never written by the session.
4. **A `run` grant lasts one started run,** recorded as used by the waker; within that run the session may run the command many times.
5. **Local git counts as a build command on Windows,** as the Mac's sandbox lets it through unasked.
6. **Guarded is an explicit runner with one allow rule,** rather than a hook rewriting commands, because the allow-rule form is already proven by the foreman's tools; the session runs `<runner> npm test`.
7. **Guarded is offered when writes are held,** whether or not reads of the keys folder are, with the card saying which; it is strictly safer than Unattended either way.
8. **The foreman offers the Unattended card** after a feature's third build-command card in a day, at most once a day.
9. **The weekly reminder** is the first briefing of the week.
10. **Build-loop Part 5 is unchanged** (Scope).

## Order

Tasks 1 to 4 need nothing from a Windows computer and run first, once build-loop Part 4 and board-and-usage Part 5 have merged; Task 1 comes before Tasks 2 to 4. Task 5's probes are written at the same time, and its sitting is the next Windows one. Task 6 waits for check 52.

**If check 52 answers differently from what the design expects:**

- **A copied `node.exe` is refused by the computer's policy, or doesn't start at low:** Guarded isn't offered on such computers; Tasks 1 to 4 stand as they are, and Task 6 is built for the computers where it works.
- **Git can't commit from low without labelling more of the common folder:** local git stays out of the runner and keeps asking (or runs at Unattended), and Task 6 labels only the worktree.
- **No stock route sets a "no read up" label:** `lockReads` returns `{ held: false }` everywhere, and Guarded's card says the keys folder stays readable.

## The director's sittings

| Sitting | Computer | Task | About |
|---|---|---|---|
| The next Windows sitting | Windows, as a standard user | 5 (checks 52 and 53) | 20 min |

If the prepared Windows run for checks 27 to 29 hasn't happened yet, checks 52 and 53 join it, sent the same way as that run's brief.
