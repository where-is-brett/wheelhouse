<!-- docs/superpowers/plans/2026-10-18-wheelhouse-setup.md -->

# Wheelhouse setup and uninstall: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build setup (design section 15): from a pasted line in Claude Desktop to a green board in about 15 minutes, with clicks and the computer's password, no terminal, no files edited and no secret in the chat. Also build the second computer, the later project, and `/wheelhouse:uninstall`, which puts back everything setup changed. Then time it on a fresh account.

**Architecture:** Setup is a playbook skill, `wheelhouse:setup`, which the session start names in a folder with no project record. The playbook only talks: it asks the cards and reports progress. Every change happens outside the sandbox, in the helper's setup routes, and only after the director's signed click on a card that lists exactly what will change, named by a hash of that list. Each change is a step with a pure `plan` (what changes, with the value before) and an `apply`, written to a journal. The journal is how uninstall puts back exactly what setup changed, and only what nobody has changed since. Setup calls what the earlier plans built (the connections, Standard and Locked, the pins and project settings, the settings catalogue and profile, telemetry) and adds the joins between them.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies. The official installers for git and Node.js; `gh` and `glab` from their official release archives. `git`, `gh` and `glab` run only by the helper. The `claude` command line only for the evaluation runs, never for setup itself.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`: section 15 (setup, all of it), 11 (the two connections), 12.1 (Standard, Locked and the director's own settings that weaken Standard), 12.6 (live data, secrets), 12.8 (the data note, retention, telemetry), 9 (signing keys, enrolment, adopting existing rules), 9.1 (telemetry per computer, with consent), 13 (phone notifications) and 20 (check 19, the timed runs). Read with `docs/specs/2026-10-18-build-loop-design.md`, section 14 (the pins, auto-update off, the stable channel and minimum version), and the plans whose functions it calls: state-and-host, safety, build loop (its Tasks 13, 19 and 23 to 29), board-and-usage (its Tasks 3, 4, 6 and 11) and front desk (its Tasks 2 and 6). Check notes `docs/checks/01`, `04`, `07`, `10`, `12`, `14`, `15`, `16`, `19`, `20`, `22`, `23` and `24-safety-live`.

## Scope

Step 3 of design section 17.2: setup and uninstall, with the timed runs. It starts once the front-desk plan has merged, since it asks its cards with that plan's composer. *Plan's call.*

It builds:

- **The checks setup rests on:** checks 35 to 38, and check 19's timed runs (Part 1 and Task 18).
- **The engine:** the journal, the setup click and the helper's setup routes.
- **The nine steps:** tools, the host and the connection, the three questions, rules found, the changes to this computer, Locked, phone notifications, the project's own files and pins, and the health check.
- **The second computer and the later project.**
- **Uninstall.**
- **The data note** (`docs/data.md`, design section 12.8) and the README's install section.

It does not build practice copies of live data beyond saying "test data only" (design section 15: per-provider steps come with the first projects that need them), the release itself (signing, the public history), or the rest of the mod.

**Where another plan's answer is still open,** this plan works either way and says where:

| Open answer | Where it comes from | Used in |
|---|---|---|
| Which copies to switch off, and how auto-update is written | build-loop check 24 | Task 13, through build-loop Task 24's `projectSettings` |
| Where the update channel and minimum version are written | build-loop check 28 | Task 10, through `claudeCodeSettings` |
| The watcher's shape | build-loop check 27 | Task 13 (setup's last step starts the foreman by build-loop Task 19's `start.js`, whichever shape) |
| Whether the mod is in the plugin or a second one | board-and-usage check 32 | Tasks 4 and 13 (installing `wheelhouse-mod` too, when it is separate) |
| How telemetry reaches Desktop sessions | check 36, here | Task 10 |
| Whether the hooks find Node.js, and what happens without it | check 35, here | Tasks 1 and 7 |

## Decisions for the director

Asked once, on a card, with the plan:

- **Card 1, who owns the Wheelhouse GitHub App.** *What this is:* the narrow connection on GitHub works through one public GitHub App, which every Wheelhouse user signs in to; it must be registered once, by someone, and its owner can change it for everyone. *Why it comes to you:* registering it publishes something under a name (level 4), and the owner is visible to every user. *Options:* **A new organisation for Wheelhouse** (free; the app isn't tied to your own account, and can later be handed on); **My own account** (quickest; your name shows as the app's owner); **Not yet** (setup offers only the quick connection on GitHub until it is registered). *Recommendation:* a new organisation, because the project goes public and the app outlives any one account. *Meanwhile:* everything is built and tested against a stand-in app; only the real app's client ID and name wait, in `scripts/host/app.json`. Registering it is one page with the fields filled in, and your **Create** click.

## Global Constraints

Everything in the earlier plans' Global Constraints holds: Node.js 22 or later, no npm dependencies, ESM `.js`, `node:test` in `tests/**/*.test.js`, macOS and Windows, the path comment on every file, British or Australian English, dates as "18 October 2026", no model identifiers anywhere and no `Co-Authored-By` line in commits, secrets only in a child's environment and never in output, everything under `wheelhouseHome()`, times in UTC ISO 8601 with a `now` argument, child processes through `run`, hooks never running `git` in a folder an agent controls, guards failing closed and informing hooks failing open, only hooks signing, the caller only raising a gate condition. In addition:

- **Nothing changes without its card's click.** Each step's change list is shown on a card whose set line names the step and the hash of the list (`setupLine`, Task 6); the helper applies exactly that list, and refuses when the list has changed since the card.
- **Setup never depends on the command-line Claude being signed in** (design section 15, check 1). Everything runs from the Desktop session and the helper.
- **No secret reaches the chat, an argument or a log.** A pasted GitLab token goes into the system's own box (`askSecret`) and straight to `writeKey`.
- **Every file setup changes is changed by key, never replaced whole,** through `mergeSettings` or the journal's key edits, so the director's own settings stay as they were. Each change records the value before it.
- **The director's time is the measure.** Every step records when its card was shown, clicked and finished, so the timed runs read the journal, not a stopwatch.
- **The design's numbers are constants,** in `scripts/lib/setup-numbers.js`: `TARGET_MINUTES = 15`, `CLICK_FRESH_MS = 10 * 60 * 1000`, `NODE_FLOOR = [22, 0, 0]`, `RETENTION_DAYS = 30`, `PUSH_TEST_WAIT_MS = 2 * 60 * 1000`, `STEP_TIMEOUT_MS = 20 * 60 * 1000`.
- **Checks continue the numbering:** the build loop owns 24 to 30, the safety sitting is 31, the board-and-usage plan 32 and 33, the front desk 34; this plan's are 35 to 38, and its timed runs answer check 19.

## Review Focus

1. **Setup stopped halfway.** Desktop is closed, the computer sleeps or an installer fails between two steps. Expected: the journal shows what finished; the next session start resumes at the first unfinished step, never repeating a finished one; uninstall works from any point. Owning tasks: Tasks 5 and 6.
2. **A setting the director changed after setup.** They set their own `cleanupPeriodDays`, or a plugin of theirs, after setup wrote ours. Expected: uninstall leaves a value that no longer matches what setup wrote and names it on its card; it never puts back an old value over theirs. Owning task: Task 5.
3. **A card that lists one thing and applies another.** The list changes between the card and the click (a tool got installed meanwhile), or an agent calls the apply route with a list of its own. Expected: the helper works out the list again, and applies only when its hash is the one the signed click names. Owning task: Task 6.
4. **Paths and accounts with spaces or accents, and a home folder that isn't the usual one.** `C:\Users\Jo Smith\`, `/Users/zoë/`, a project under a folder with a space. Expected: every installer, settings write and hook command quotes its paths; nothing assumes `/Users/<name>`. Owning tasks: Tasks 5 and 7.
5. **A second computer that isn't trusted.** Its key is added to the profile repository by anyone but the director, or an agent on it writes its own enrolment. Expected: a computer's key counts on another computer only after the director's click there, on a card naming it by its id and when it was added. Owning task: Task 14.

## File structure

```
scripts/lib/setup-numbers.js       the numbers above
scripts/setup/journal.js           each change, its value before, and putting it back
scripts/setup/steps.js             the step list, each with plan and apply
scripts/setup/tools.js             git, Node.js, gh and glab: found, installed, fetched
scripts/setup/host.js              sign-in, repositories, protection, the connection
scripts/setup/questions.js         the three questions, and what each answer writes
scripts/setup/rules.js             rules found in an existing project, with their sources
scripts/setup/computer.js          the changes to this computer, and settings that weaken Standard
scripts/setup/telemetry.js         telemetry on this computer, by check 36's route
scripts/setup/project-files.js     the project's settings, configuration and pins
scripts/setup/notify.js            phone notifications
scripts/setup/health.js            the health check against a scratch copy
scripts/setup/computers.js         a second computer's key, and trusting it
scripts/setup/uninstall.js         what uninstall puts back
scripts/setup/cli.js               the playbook's one command
scripts/host/app.json              the Wheelhouse GitHub App's client ID and name
scripts/host/helper.js             (changed) /setup/* routes
scripts/state/card-lines.js        (changed) setupLine, confirmAllLine, trustLine
scripts/state/events.js            (changed) the setup, confirm-all and trust actions
scripts/hooks/prompt-record.js     (changed) setup, confirm-all and trust clicks
scripts/hooks/session-start.js     (changed) names the setup playbook; makes the key; resumes setup
skills/setup/SKILL.md              the playbook
commands/setup.md, commands/uninstall.md
docs/data.md                       the data note
README.md                          (changed) the install lines
probes/35-node/…, probes/36-telemetry/…, probes/37-install-line/…, probes/38-host-tools/…
docs/checks/35-node.md … 38-host-tools.md, docs/checks/19-setup-time.md (changed)
tests/e2e/setup.test.js
```

## Findings note format

As the checks plan set it, checked by `tests/docs/checks-format.test.js`. Each note adds its row to `docs/checks/README.md`.

---

## Part 1: the checks

**Before Task 1, one card to the director** (agents do every step they can, by the director's standing rule of 18 October 2026). What this is: four checks that setup rests on. Why it comes to them: they make a throwaway user account on the Mac (their password, twice) and change Claude Code's settings for that account only. Options: **Go ahead**, **Not now**. Recommendation: go ahead. Meanwhile: Tasks 5 and 6 can be built.

### Task 1: Check 35, Node.js and the hooks on a fresh account

**Files:**
- Create: `probes/35-node/run.js`, `probes/35-node/run.md`, `docs/checks/35-node.md`
- Modify: `docs/checks/README.md`

The question: *On a fresh account, whether Wheelhouse's hooks find `node` in Claude Desktop once the official Node.js installer has run, on macOS and Windows; and what a session with the plugin installed does when `node` isn't there at all, since its guards carry `onFailure: block`.*

**Interfaces:**
- Produces, for Task 7 and the README: whether Node.js can be installed after the plugin, or must come first; where Desktop looks for `node` (its PATH, as a hook prints it).

- [ ] **Step 1: Read** the hooks reference on `onFailure` and on the environment hooks run with, and record the links and date.
- [ ] **Step 2: Prepare (agent).** A throwaway macOS user account, made with `sysadminctl -addUser` through the system's own administrator prompt; a scratch project in it with the plugin loaded and a logging hook that prints `process.env.PATH` and `process.execPath`.
- [ ] **Step 3: Director (Mac, about 5 minutes):** the password for the account, a log-in to it, and opening Claude Desktop there (their own Claude sign-in). The agent then, in a Desktop session it opens: asks for a `Read` and a `Bash` command with no Node.js installed; starts the official Node.js installer (the director types the password); asks again. Record each result and the logged PATH.
- [ ] **Step 4: Undo.** The agent removes the account with the same prompt (the password again) and checks it is gone.
- [ ] **Step 5: Windows,** when the director is next at a Windows computer: the same in their own account with Node.js not on PATH for one session (a scratch environment the agent sets), since a fresh account there needs administrator rights.
- [ ] **Step 6: Write the note,** add its row, run `npm test`, commit.

```bash
git add probes/35-node docs/checks
git commit -m "Record check 35: Node.js and the hooks on a fresh account"
```

**If the answers differ:** Node.js comes before the plugin whatever this check finds (Task 7), so this check says only how a session behaves when it is missing, for the README's wording. If the hooks don't find an installed `node` from Desktop, setup records the full path in the project's local settings as the hooks' command (Task 13).

### Task 2: Check 36, telemetry in Desktop sessions

**Files:**
- Create: `probes/36-telemetry/run.js`, `docs/checks/36-telemetry.md`
- Modify: `docs/checks/README.md`

The question: *Which per-computer route switches Claude Code's telemetry on for Desktop sessions, on macOS and Windows: the user settings' `env`, or the environment Desktop starts with; and that a project's settings can't (check 7).*

**Interfaces:**
- Produces, for Task 10: `route: 'user-settings' | 'launch-env'`, with the exact file or command for each system, and whether Desktop needs a restart.

- [ ] **Step 1: Read** https://code.claude.com/docs/en/monitoring-usage and the settings page; record the date.
- [ ] **Step 2: Mac (agent, in the throwaway account of Task 1 while it exists):** start a receiver (`scripts/telemetry/main.js` on a free port); write `telemetryEnv(port)` into that account's user settings `env`; open a Desktop session with `start_session` and send one prompt; record whether points arrive. Then remove it and try the launch environment (`launchctl setenv` for the account, with Desktop restarted: the director's restart click).
- [ ] **Step 3: Windows,** in the same Windows sitting as Task 1: user settings, then the user's environment variables, each followed by a Desktop restart.
- [ ] **Step 4: Undo, write the note,** add its row, run `npm test`, commit.

```bash
git add probes/36-telemetry docs/checks
git commit -m "Record check 36: switching telemetry on for Desktop sessions"
```

### Task 3: Check 37, the pasted line in Desktop

**Files:**
- Create: `probes/37-install-line/run.md`, `docs/checks/37-install-line.md`
- Modify: `docs/checks/README.md`

The question: *What the install line `/plugin install wheelhouse --marketplace <owner>/wheelhouse#<tag>` does when pasted into a Desktop session (check 15 left it for this plan): which confirmations it asks, where the scope is chosen, how the reload is done, and whether plugins named in a project's settings (`enabledPlugins` with the Wheelhouse marketplace) are installed on that reload or need their own step; and whether Desktop asks the director to trust the folder.*

**Interfaces:**
- Produces, for Tasks 13 and 16: the exact line that works, the clicks it takes, and whether the pinned Superpowers and Matt Pocock's skills install with the project's settings or need `claude plugin install … --scope project` from the helper.

- [ ] **Step 1: Prepare (agent):** a scratch project under the throwaway account's `~/Projects`, and a probe tag of this repository's plugin.
- [ ] **Step 2: Director (Mac, about 3 minutes, in Task 1's sitting):** paste the line the agent gives them and click what Desktop shows. The agent times it from the session's transcript and records every prompt and click. Then the agent writes the project's settings with the Wheelhouse marketplace and the pins (build-loop Task 24's `projectSettings`) and asks for a reload (the director's click), recording what installs.
- [ ] **Step 3: Undo, write the note,** add its row, run `npm test`, commit.

```bash
git add probes/37-install-line docs/checks
git commit -m "Record check 37: the install line in Desktop"
```

### Task 4: Check 38, `gh` and `glab` without an installer

**Files:**
- Create: `probes/38-host-tools/run.js`, `docs/checks/38-host-tools.md`
- Modify: `docs/checks/README.md`

The question: *Whether `gh` and `glab` can be fetched by a script from their official release archives, checked against the published checksums and run from `~/.wheelhouse/tools/`, on macOS (where `gh`'s package is unsigned, check 19) and on Windows, with no installer, no password and no warning; and how long it takes.*

**Interfaces:**
- Produces, for Task 7: each archive's name pattern per system and processor, its checksum file, and whether macOS shows any warning for a file a script downloaded.

- [ ] **Step 1: Run `probes/38-host-tools/run.js` (agent, Mac):** into a new, empty folder under `os.tmpdir()`, fetch each tool's latest release archive and checksum list, check it, unpack it, run `<tool> --version`, and time each part. Check that the file carries no quarantine mark (`xattr -l`).
- [ ] **Step 2: Windows,** in the Windows sitting (the agent runs it; the director is only at the computer).
- [ ] **Step 3: Write the note,** add its row, run `npm test`, commit. Delete the folder.

```bash
git add probes/38-host-tools docs/checks
git commit -m "Record check 38: fetching gh and glab without an installer"
```

**If the answers differ:** if a fetched tool is blocked or warned about on macOS, setup uses the official package and says on the step-2 card that the system will ask to open it.

---

## Part 2: the engine

### Task 5: The journal

**Files:**
- Create: `scripts/lib/setup-numbers.js`, `scripts/setup/journal.js`
- Test: `tests/scripts/setup/journal.test.js`

**Interfaces:**
- Produces:
  - `Change = { id, step: number, kind: 'json-key' | 'file' | 'folder' | 'process' | 'host' | 'locked' | 'env', target: string, key?: string[], before: unknown | null, after: unknown, project?: string }`. `target` is a file or folder path, an environment variable, or a host object (`repo:<owner/name>`, `protection:<branch>`, `app-install`, `gitlab-key:<id>`).
  - `journalFile() -> string`: `<wheelhouseHome()>/setup/journal.json`; `readJournal() -> { v: 1, runs: Array<{ id, folder, project?, startedAt, steps: Record<number, { shownAt?, clickedAt?, doneAt?, failed?: string }>, changes: Change[] }> }`; every write atomic.
  - `applyJsonKey({ file, key, value }) -> Change`: reads the file (missing is `{}`), sets the value at the key path, writes it back atomically keeping every other key and the file's indent, and returns the change with `before` (or `null` for an absent key). It refuses a file that isn't JSON, naming it, rather than replacing it.
  - `reverseChange(change) -> { put: boolean, why?: string }`: puts `before` back (or deletes the key) only when the current value still equals `after`; otherwise `{ put: false, why: 'changed since setup' }`.
  - `stepTimes(run) -> Array<{ step, directorMs, waitMs }>`: from the times recorded, for the timed runs.

- [ ] **Step 1: Write the failing tests.**

```js
test('a key is set without touching the file\'s other keys, and its value before is kept', ...)
test('a key that was absent is removed again on reversal', ...)
test('a value the director changed after setup is left and named', ...)        // Review Focus 2
test('a file that is not JSON is refused, never replaced', ...)
test('a path with a space and an accent is written and put back', ...)          // Review Focus 4
test('the journal survives a crash between two writes', ...)                    // Review Focus 1
test('step times give the director\'s minutes from shown to clicked, and the waits', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts tests
git commit -m "Keep a journal of every change setup makes, with the value before it"
```

### Task 6: The setup click and the helper's setup routes

**Files:**
- Create: `scripts/setup/steps.js`, `scripts/setup/cli.js`
- Modify: `scripts/state/card-lines.js`, `scripts/state/events.js`, `scripts/hooks/prompt-record.js`, `scripts/hooks/session-start.js`, `scripts/hooks/kit.js` (a folder being set up), `scripts/host/helper.js`, `scripts/host/helper-client.js`, `scripts/hooks/stop-guard.js` (the command's reading forms), `scripts/cards/compose.js` (the `setup` kind)
- Test: `tests/scripts/setup/steps.test.js`, `tests/scripts/host/helper-setup.test.js`, `tests/scripts/hooks/prompt-record.test.js`, `tests/scripts/hooks/session-start.test.js`

**Interfaces:**
- Consumes: `makeSigningKey`, `enrol`, `readEnrolled`, `sign`, `verify` (`scripts/state/signing.js`); the journal (Task 5); `composeCard` (front-desk plan, Task 2) for each step's card.
- Produces:
  - `setupLine(step, hash) -> 'Set up step <step> as listed, <hash12>'`; label `Go ahead`. A signed `action` `setup` `{ step, hash, question, label }`.
  - **Before a state branch exists,** the setup click is kept in `<wheelhouseHome()>/setup/clicks/` as a signed record, since there is no state to record it in; the helper reads it from there, and Task 13 copies the clicks into state once the state branch exists.
  - **Outside a registered project.** The hooks act only in a Wheelhouse project, and the folder being set up isn't one yet. So in a folder with a setup run (or none and no project record) the session start starts the helper as it would in a project, and the prompt record handles exactly one kind of click there, a card carrying `setupLine`, written straight to `setup/clicks/`. The guards (STOP, the tool guard) act there too, from the first session, as they would in a project. *Reviewer's call.*
  - **The first key.** In a folder with no project record and the plugin installed, the session start makes this computer's signing key (`makeSigningKey`) when there is none, and enrols it in this computer's own list when the list is empty, so the director's first click can be signed and checked. A computer that already has a list adds nothing to it here. *Plan's call:* the key's file is out of agents' reach on the Mac (the sandbox), so trusting it on first use is as safe as the key itself.
  - `CardInput` is the front-desk composer's input (its Task 2: `kind`, `what`, `why`, `options`, `recommend`, `because`, `meanwhile`, `target`, `level`), with kind `setup` added there and `target: { step, hash }` giving `setupLine`.
  - `STEPS: Array<{ n: number, title: string, plan(ctx) -> Promise<{ changes: Change[], card: CardInput, director: string }>, apply(ctx, changes) -> Promise<Change[]>, long?: boolean }>`, the steps of design section 15 (Tasks 7 to 13), in this order, numbered 1 to 10: 1 install, 2 tools, 3 the host and the connection, 4 the three questions, 5 rules found, 6 the changes to this computer, 7 the project's files, pins and protection (Task 13), 8 Locked, 9 phone notifications, 10 the health check. Cards use the design's titles. *Reviewer's call:* the project's files must go up before protection is switched on (Task 13), and before Locked, whose hook refuses commands in a Locked project until the project's settings switch the sandbox on, which would also refuse the playbook's own `cli.js`. `planHash(changes) -> string` (SHA-256 of their canonical JSON).
  - Helper routes, each taking `folder` (a project's folder; refused outside `~/Projects` and the folders already registered, unless setup's step 3 is making it):
    - `/setup/plan { folder, step }` → `{ ok, changes, hash, card }`. Read-only.
    - `/setup/apply { folder, step, hash }` → `{ ok, started: true }`, only with a signed `setup` click from the last `CLICK_FRESH_MS` naming this step and hash, and only when a fresh `plan` gives the same hash; a long step runs in a detached child and its progress goes to the journal.
    - `/setup/status { folder }` → the journal's run for that folder, as plain lines.
    - Under STOP, `/setup/plan` and `/setup/status` answer; `/setup/apply` is refused.
  - `cli.js <plan | apply | status | resume> [step]`: the playbook's one command, talking only to the helper's socket, as the front desk's does. Its reading forms are let through under STOP.
  - The session start, in a folder whose setup run is unfinished, adds: `Setup is part-way through: step <n>, <title>, is next. Follow wheelhouse:setup.`; in a folder with no project record and no run: `This folder isn't set up for Wheelhouse yet. Follow wheelhouse:setup.`

- [ ] **Step 1: Write the failing tests.**

```js
test('a fresh computer gets a signing key and enrols it once', ...)
test('in a folder being set up, the helper starts and a setup click is recorded; no other click is', ...)
test('the guards act in a folder being set up', ...)
test('apply is refused without a fresh click naming this step and this list', ...)
test('a list that changed between the card and the click is refused', ...)     // Review Focus 3
test('an apply with a list of the caller\'s own is refused', ...)               // Review Focus 3
test('a long step runs on and reports its progress in status', ...)
test('the next session start resumes at the first unfinished step', ...)        // Review Focus 1
test('a folder outside ~/Projects and the registered folders is refused', ...)
test('under STOP, plan and status answer and apply is refused', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Apply each setup step only after the director's click on its exact list"
```

---

## Part 3: the nine steps

### Task 7: Steps 1 and 2: the plugin and the tools

**Files:**
- Create: `scripts/setup/tools.js`
- Modify: `scripts/setup/steps.js`, `scripts/lib/run.js` (the helper's own tools folder first on `gh`'s and `glab`'s path), `scripts/host/adapter.js`
- Test: `tests/scripts/setup/tools.test.js`

**Interfaces:**
- Consumes: checks 35 and 38; `run`; `NODE_FLOOR`.
- Produces:
  - `toolsStatus({ platform, run }) -> Promise<Record<'git' | 'node' | 'gh' | 'glab', { found: boolean, version: string | null, path: string | null, ok: boolean }>>`: `node` at or above `NODE_FLOOR`; `gh` or `glab` only for the project's host.
  - `startInstaller({ tool: 'git', platform, run, fetch }) -> Promise<{ started: boolean, waitsFor: 'password' | 'admin' | 'click' }>`: macOS by `xcode-select --install` (Apple's own dialog); Windows by Git for Windows' official installer, fetched into a new, empty temporary folder, checked against the published checksum, then opened, so the system shows its own prompt. Node.js is already there (below); `toolsStatus` still reports it, and a version below the floor stops setup with the README's Node.js line.
  - `fetchHostTool({ tool: 'gh' | 'glab', platform, arch, fetch, run }) -> Promise<{ path, version }>`: by check 38, into `<wheelhouseHome()>/tools/<tool>/`, checked against the release's checksums. The adapter runs that copy when present, so `gh` or `glab` needs no installer and no password. *Plan's call:* only the helper runs them, so no other program needs them on the path.
  - Step 2's plan lists each missing tool, how long it is likely to take, and what the director will see; its apply starts every installer at once, first, then hands back so step 3's and step 4's cards are asked while they run (design section 15).
  - Step 1 is the director's: the install line (Task 16). Its time is read from the session's first message.
  - **Node.js comes before the plugin, always.** The helper and every hook are Node.js, so step 2 can't install Node.js through them. The README's first pasted line asks Claude, before Wheelhouse is installed, to check for Node.js 22 or later and start its official installer if it is missing (the director's password); step 2 then installs only git and fetches `gh` or `glab`. Check 35 still decides where Desktop finds `node`. *Reviewer's call:* one more paste and, where Node.js is missing, one password, before the 15 minutes start.

- [ ] **Step 1: Write the failing tests,** with a fake `run` and `fetch`.

```js
test('Node.js below 22 counts as missing', ...)
test('each installer is fetched into an empty folder and checked before it is opened', ...)
test('a checksum that does not match is refused and nothing is opened', ...)
test('git\'s installer starts at once and the step hands back', ...)
test('Node.js missing or too old stops setup with the README\'s line, and nothing is installed', ...)
test('gh is fetched into the tools folder and the adapter runs that copy', ...)
test('an installer path with a space is quoted', ...)                           // Review Focus 4
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Start the missing installers first, and fetch gh and glab for the helper alone"
```

### Task 8: Step 3: the host and the connection

**Files:**
- Create: `scripts/setup/host.js`, `scripts/host/app.json`
- Modify: `scripts/setup/steps.js`
- Test: `tests/scripts/setup/host.test.js`

**Interfaces:**
- Consumes: `startDeviceSignIn`, `waitForSignIn`, `installUrl`, `installationCovers` (`scripts/host/github-app.js`, `connection.js`); `gitlabApi`, `makeProjectKey`, `checkBaseUrl` (`gitlab-key.js`); `tokenUrl`; `askSecret`; `writeKey`; `switchOnProtection`, `protectionStatus`, `readGitlabProtection`; `writeProject`; `cloneState`; `profileRemote`, `ensureProfileClone` (board-and-usage plan, Task 4); `QUICK_LINE` (board-and-usage plan, Task 11).
- Produces:
  - `scripts/host/app.json`: `{ clientId: string | null, slug: string | null }`, `null` until the director's Card 1 is answered and the app registered. `narrowOffered(host) -> boolean`: GitHub only when both are set; GitLab always.
  - `signIn({ host, run }) -> Promise<{ signedIn: boolean, user }>`: nothing when `gh` or `glab` is already signed in; otherwise their own browser sign-in, run by the helper with the director's environment. With no account yet, the card links the host's sign-up page first (design section 15, "Before starting").
  - `makeRepos({ host, owner, name, isNew, run }) -> Promise<Change[]>`: a private repository for a new product; the private profile repository `wheelhouse-profile` when `profileRemote()` is null, then `profile.json` (the shape board-and-usage Task 4 reads) and `ensureProfileClone`. Each is a `host` change, so uninstall can offer to remove it.
  - `connectionCard({ host, locked }) -> CardInput`: **Quick** with `QUICK_LINE` as its cost, or **Narrow**, as design section 11's table says; a Locked project skips it (Narrow).
  - Narrow on GitHub: the code sign-in, keys to `writeKey('github-app')`, then the app's Install page opened, recommending the project and profile repositories, not **All repositories**; read back with `installationCovers` and said plainly.
  - Narrow on GitLab: `makeProjectKey` at Developer level; on refusal, `tokenUrl` opened and the token typed into `askSecret`, straight to `writeKey`.
  - Protection is planned here, shown on step 3's card, and switched on at the end of step 7, once the setup commit is up (Task 13): `switchOnProtection`, then `protectionStatus` read back and shown; on GitLab, "pipelines must succeed" only where the project has a pipeline, else a card (design section 12.3).
  - Then `writeProject` and `cloneState`.

- [ ] **Step 1: Write the failing tests,** with the stand-in host and a fake device sign-in.

```js
test('an existing sign-in is used with no browser step', ...)
test('a new product gets a private repository; an existing one gets none', ...)
test('the profile repository is made once, and profile.json written in the shape the profile reads', ...)
test('narrow on GitHub is not offered while the app is not registered', ...)
test('a Locked project is narrow without a card', ...)
test('a refused GitLab project key falls back to the system\'s box, never the chat', ...)
test('GitLab pipelines must succeed only where a pipeline exists', ...)
test('protection is read back and said as it is', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Connect to the host at setup, quick or narrow, with the profile and protection"
```

### Task 9: Steps 4 and 5: three questions, and rules found

**Files:**
- Create: `scripts/setup/questions.js`, `scripts/setup/rules.js`
- Modify: `scripts/setup/steps.js`, `scripts/state/card-lines.js` (`confirmAllLine`), `scripts/state/events.js` (the `confirm-all` action), `scripts/hooks/prompt-record.js`
- Test: `tests/scripts/setup/questions.test.js`, `tests/scripts/setup/rules.test.js`, `tests/scripts/hooks/prompt-record.test.js`

**Interfaces:**
- Consumes: `composeCard`; `checkSetting` (board-and-usage plan, Task 3); `scanContent`; `confirmationFor`.
- Produces:
  - The three cards (design section 15, step 4): what the product is and who uses it (recorded as a `glossary` entry for the product and the `phase` setting); live data (the configuration's `liveData: true`, with agents on test data only and the director told once, design section 12.6); real users (`realUsers: true`, and on a Mac the offer of Locked, design section 12.1).
  - `findRules(folder) -> Array<{ words: string, source: { file, line } }>`: rule-like lines (imperatives and "always", "never", "must", "don't" sentences) in `CLAUDE.md`, the README and `docs/`, each quoted with its source.
  - `matchWords(rule, transcripts) -> { words: string, original: boolean }`: the director's own words from the folder's past transcripts (the `~/.claude/projects/*/*.jsonl` files whose entries' `cwd` is this folder, matched by that field rather than by the folder's name, read by the helper, outside the sandbox; *reviewer's call*) when a typed message holds the rule's words, else the rule as found, marked "paraphrase" (design section 9). Every quote goes through `scanContent` before it is kept.
  - `confirmAllLine(hash) -> 'Confirm all <n> rules as listed, <hash12>'`, label `Confirm all`, a signed `action` `confirm-all` `{ hash, ids }`, from which the prompt record writes one confirmation per ruling (each by `confirmationFor`). **Let me correct some** asks one card per rule. *Plan's call:* a card may carry only one set line, and design section 9 asks for one card.

- [ ] **Step 1: Write the failing tests.**

```js
test('each answer writes its setting or configuration key, checked by the catalogue', ...)
test('real users on a Mac offer Locked; on Windows they do not', ...)
test('rules are found with their file and line', ...)
test('a rule matched in a past transcript keeps the director\'s words; others are marked paraphrase', ...)
test('a quote holding a password is not kept', ...)
test('Confirm all confirms exactly the listed rulings, each by its own confirmation', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Ask setup's three questions, and confirm the rules found in one card"
```

### Task 10: Steps 6 and 8: the changes to this computer, and Locked

**Files:**
- Create: `scripts/setup/computer.js`, `scripts/setup/telemetry.js`
- Modify: `scripts/setup/steps.js`
- Test: `tests/scripts/setup/computer.test.js`, `tests/scripts/setup/telemetry.test.js`

**Interfaces:**
- Consumes: check 36; `telemetryEnv`, `TELEMETRY_PORT` (board-and-usage plan, Tasks 2 and 5); `claudeCodeSettings({ floor })` and `readManifest` (build-loop plan, Tasks 23 and 24); `installLocked` (safety plan, Task 13); `applyJsonKey`.
- Produces:
  - `computerChanges({ platform, userSettings, manifest }) -> Change[]`, one card (design section 15, step 6), each line in plain words:
    - telemetry on this computer only (`telemetryOn`, below), never prompt or tool content;
    - transcripts kept `RETENTION_DAYS` days (`cleanupPeriodDays`);
    - Wheelhouse never updating on its own, and Claude Code on the stable channel at or above the manifest's floor (`claudeCodeSettings`, written where build-loop check 28 says);
    - this computer's signing key (already made, Task 6), named so the director knows it exists;
    - phone notifications (`agentPushNotifEnabled: true`, check 4);
    - each of the director's own settings that weakens Standard, named one by one (`weakening`, below), with what it does.
  - `weakening(settings) -> Array<{ key, value, says }>`: `sandbox.excludedCommands` (each command named), `enabledPlugins` entries other than Wheelhouse's and its pins, `extraKnownMarketplaces` other than Wheelhouse's (design sections 12.1 and 12.9). Setup changes none of them; the card names each so the director decides, and a later card can switch one off.
  - `telemetryOn({ port, route, platform, run }) -> Change[]`: by check 36's route: `user-settings` writes `telemetryEnv(port)` into `~/.claude/settings.json`'s `env` by key; `launch-env` sets the same variables for the account (macOS `launchctl setenv` and a login item that sets them again; Windows the user's environment variables), and the card asks for a Desktop restart. Both record their changes for uninstall.
  - Step 8, Locked only: `installLocked` (its password prompt), after the narrow connection and the project's settings (step 7) are in place.

- [ ] **Step 1: Write the failing tests.**

```js
test('the card lists each change in plain words, and nothing else changes', ...)
test('telemetry by user settings, and by the launch environment, are each put back by uninstall', ...)
test('no telemetry change sets prompt or tool logging', ...)
test('each weakening setting is named with what it does, and left as it is', ...)
test('Locked is installed only after the narrow connection, and never on Windows', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "List and make the changes to this computer on one card, and install Locked"
```

### Task 11: Step 9: phone notifications

**Files:**
- Create: `scripts/setup/notify.js`
- Modify: `scripts/setup/steps.js`
- Test: `tests/scripts/setup/notify.test.js`

**Interfaces:**
- Consumes: check 4; the session's push tool (the playbook sends the test, since only a session can).
- Produces: step 9's card and its plain steps: where to switch on Remote Control in Desktop, that both push options are on (step 6), allowing Claude's notifications on the phone; then "Lock your screen for two minutes." The playbook waits `PUSH_TEST_WAIT_MS`, sends one test push, and on the director's return asks one card: **It arrived**, **It didn't**. `pushTestResult(label) -> Change`: recorded in the journal, and on the board's health when it didn't arrive (a push is skipped while the director is at the computer, check 4).

- [ ] **Step 1: Write the failing tests** for the card's steps and for recording either answer.
- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Set up phone notifications and test one with the screen locked"
```

### Task 12: Step 10: the health check

**Files:**
- Create: `scripts/setup/health.js`
- Modify: `scripts/setup/steps.js`, `scripts/health/trials.js` (check 24-safety-live's three changes)
- Test: `tests/scripts/setup/health.test.js`, `tests/scripts/health/trials.test.js`

**Interfaces:**
- Consumes: `runTrials` (safety plan, Task 18); `healthLines`, `loadBoardInputs`, `renderBoard` (board-and-usage plan, Tasks 11 to 13); `checkInstalled` (build-loop plan, Task 23).
- Produces: `healthCheck({ folder }) -> Promise<{ green: boolean, lines: string[] }>`: the trials against a scratch copy of the project (the gate refuses a bad merge, STOP halts, `.env` can't be read, an agent can't reach the host), the lineage check, then the board's health lines; the playbook shows the board. A failed trial is said plainly with what to do, never hidden. The trials gain check 24-safety-live's changes: the merge trial uses a pull request with no real approval and counts any refusal that leaves it unmerged; the client waits for a first merge to fill the mirror; the `.env.local` trial removes its file even when the sandbox denies reading it back.

- [ ] **Step 1: Write the failing tests.**

```js
test('a green run gives a green board', ...)
test('a failed trial is named with what to do', ...)
test('the merge trial passes on any refusal that leaves the pull request unmerged', ...)
test('the .env trial leaves no file behind', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "End setup with the health check and a green board"
```

### Task 13: Step 7: the project's own files, the pins and protection, and starting work

**Files:**
- Create: `scripts/setup/project-files.js`
- Modify: `scripts/setup/steps.js`
- Test: `tests/scripts/setup/project-files.test.js`

**Interfaces:**
- Consumes: check 37; `projectSettings`, `localSettings`, `mergeSettings`, `writeSettings` (safety plan, Task 12, with the build-loop plan's Task 24 additions: the Wheelhouse marketplace with auto-update off, the pins switched on and the other copies off); `readConfig` and the configuration's keys (safety plan Task 2; build-loop plan Task 14: `hotFiles`, `flagFiles`, `routing`, `sessionMode`, `buildCommands`; front-desk plan Task 12: `pages`); `release.js` (build-loop plan, Task 29); `start.js` (build-loop plan, Task 19).
- Produces:
  - `starterConfig({ answers, host }) -> Config`: `.claude/wheelhouse.json` with the defaults of each plan, `liveData` and `realUsers` from step 4, and `routing` from Wheelhouse's own defaults file.
  - `projectFilesChange({ folder, config }) -> Change[]`: `.claude/settings.json` merged with `projectSettings(config)`, `.claude/wheelhouse.json`, `.claude/settings.local.json` merged with `localSettings`, and `CLAUDE.md`'s "Compact instructions" section (design section 10) added once.
  - **How they reach the default branch.** Setup commits them in one commit, "Set up Wheelhouse", and pushes it to the default branch with the director's own sign-in, then switches on the protection step 3 planned, since the gate can't merge without CI and Wheelhouse running. *Plan's call:* this is the director's own setup, done with their own sign-in, once; every later change to these files is a guardrail pull request.
  - **The pins.** By check 37: either the reload after the settings installs Superpowers and Matt Pocock's skills at their commits, or the helper runs the documented install for each at project scope. Then `checkInstalled` must pass; and when board-and-usage check 32 made the mod a second plugin, `wheelhouse-mod` is installed the same way.
  - The setup clicks kept before the state branch existed (Task 6) are copied into state as they are.
  - The last thing setup does: `start.js` for the foreman (whichever shape build-loop check 27 chose), and the front desk's first briefing.

- [ ] **Step 1: Write the failing tests.**

```js
test('the project settings keep the director\'s own keys and add Wheelhouse\'s', ...)
test('the configuration has every plan\'s keys with their defaults', ...)
test('the setup commit holds exactly the four files, and goes up before protection is on', ...)
test('the pins are installed and the lineage check passes', ...)
test('the setup clicks reach the state branch once', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Write the project's settings, configuration and pins, and start the foreman"
```

---

## Part 4: more computers, more projects, and leaving

### Task 14: A second computer, and a later project

**Files:**
- Create: `scripts/setup/computers.js`
- Modify: `scripts/setup/steps.js`, `scripts/state/card-lines.js` (`trustLine`), `scripts/state/events.js` (the `trust` action), `scripts/hooks/prompt-record.js`, `scripts/hooks/session-start.js`
- Test: `tests/scripts/setup/computers.test.js`

**Interfaces:**
- Consumes: `enrol`, `readEnrolled`, `computerId`; `ensureProfileClone`; `installUrl`; `makeProjectKey`.
- Produces:
  - **A second computer** runs steps 1, 2, 3 (its own sign-in, and for narrow its own app sign-in or project key), 6, 8 and 9 (design section 15); the project and profile come from the host. The director opens Desktop on an empty folder under `Projects`; after the sign-in, step 3 asks on a card which of their repositories holding a `wheelhouse-state` branch this is, and the helper checks the project out into the folder, the committed `.claude/settings.json` winning over the one the install line wrote. The profile clone keeps the `enrolments/` folder, which the profile's own push rules never write. *Reviewer's call:* nothing said how the project reaches a second computer.
  - **Keys between computers.** Setup publishes this computer's public key as `enrolments/<computer>.json` (`{ computer, publicKey, at }`) on the profile branch, pushed with the director's own sign-in. Each computer's session start lists any enrolment it doesn't yet trust and adds a card: `trustLine(computer, at) -> 'Trust your computer <computer>, added <date>'`, label `Trust it`, a signed `action` `trust`; the prompt record then `enrol`s it on this computer. Until then its records don't count here, so the director is asked again rather than an untrusted record counting. *Plan's call:* the profile repository can be written by the narrow app's key too, so a key found there isn't trusted on sight.
  - **A later project:** with narrow on GitHub, the app's settings page opened for one tick, then `installationCovers` read back; on GitLab, a new project key, or the pasted token where GitLab refuses.

- [ ] **Step 1: Write the failing tests.**

```js
test('a second computer runs steps 1, 2, 3, 6, 8 and 9, and checks the chosen project out into its empty folder', ...)
test('an enrolment found in the profile is not trusted until the director clicks Trust it', ...)  // Review Focus 5
test('Trust it on a card naming another computer or another date trusts nothing', ...)
test('a later project on GitHub opens the app\'s page and reads the tick back', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Set up a second computer and a later project, trusting another computer only on a click"
```

### Task 15: Uninstall

**Files:**
- Create: `scripts/setup/uninstall.js`, `commands/uninstall.md`
- Modify: `scripts/host/helper.js` (`/setup/uninstall`), `skills/setup/SKILL.md`
- Test: `tests/scripts/setup/uninstall.test.js`

**Interfaces:**
- Consumes: the journal (Task 5); `leaveLocked` (safety plan, Task 13); `deleteKey`; the GitLab API; the setup click (Task 6).
- Produces: `uninstallPlan({ folder }) -> { changes: Change[], keep: Array<{ what, why }>, asks: CardInput[] }`, applied after its own card's click, in this order:
  - **Stop:** the foreman, the watcher, the receiver and, when no other project needs it, the helper.
  - **Locked:** `leaveLocked` (the password again).
  - **The project's files:** a commit taking out Wheelhouse's keys and files (by the journal's `before` values) on a branch, opened as a pull request with the director's own sign-in; the card links the host's page, where the director's own **Merge** click lands it, since the gate is being removed with it.
  - **This computer:** each of setup's changes reversed by `reverseChange` when no other registered project still needs it; one that changed since setup is left and named (Review Focus 2).
  - **Keys:** a GitLab project key revoked through the API, then deleted; the GitHub app's keys deleted, and its installation page opened for the director to uninstall it there (one click). Server-side protection is left on, and said.
  - **Kept unless the director says otherwise,** each on the card: the project's state branch and the profile repository (deleting either is level 4, a separate card, recommended **Keep**); this computer's signing key while another project uses it.
  - **Last:** `~/.wheelhouse/projects/<project>/` removed, and the line to remove the plugin from Desktop (or its clicks), given to the director.
  - `/wheelhouse:uninstall` starts it; the playbook asks the card.

- [ ] **Step 1: Write the failing tests,** with a scratch `WHEELHOUSE_HOME` and home folder.

```js
test('setup then uninstall leaves this computer\'s files as they were', ...)
test('a change made after setup is left and named', ...)                          // Review Focus 2
test('uninstall from a setup stopped at step 4 puts back only what was done', ...)  // Review Focus 1
test('Locked is left with the password before anything else is removed', ...)
test('the state branch and profile are kept unless their own card says delete', ...)
test('a second project keeps the helper, telemetry and the signing key', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts commands skills tests
git commit -m "Uninstall: put back everything setup changed, and keep the director's records unless they say"
```

### Task 16: The playbook, the README and the data note

**Files:**
- Create: `skills/setup/SKILL.md`, `commands/setup.md`, `docs/data.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `cli.js` (Task 6), `composeCard`, checks 35 and 37.
- Produces:
  - `skills/setup/SKILL.md`, written with `superpowers:writing-skills`: for each step, `cli.js plan`, ask its card exactly as composed, then `cli.js apply` once clicked; ask the next card while a long step runs; report progress in one line; never run an installer, a host command or a settings write itself; on any failure, say what happened and what the director can do, and offer to carry on later.
  - `README.md`'s install section: for a new product, make an empty folder under `Projects` from Desktop's folder picker and open the session on it; then the line that checks for Node.js (Task 7); then the line that check 37 found to work. Then the plugin browser's clicks, for when the line doesn't work.
  - `docs/data.md`: design section 12.8 in plain words (conversations, transcripts and their 30 days, Remote Control, telemetry's counts, state on the host, optional channels), with what uninstall removes and what it keeps.

- [ ] **Step 1: Write the skill** with `superpowers:writing-skills`, its baseline being Task 17's flow run without it.
- [ ] **Step 2: Write the README section and the data note.**
- [ ] **Step 3: Run `npm test` and `claude plugin validate .`.** Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add skills commands docs README.md
git commit -m "Add the setup playbook, the install lines and the data note"
```

---

## Part 5: trying it, and the handover

### Task 17: End to end

**Files:**
- Create: `tests/e2e/setup.test.js`

- [ ] **Step 1: Write the end-to-end tests,** with a scratch home and `WHEELHOUSE_HOME`, the stand-in host, a real helper, fake installers and the hooks' `decide` functions called as Claude Code would:

```js
test('a new product: every step\'s card, its click, and a green board at the end', ...)
test('an existing project with rules: Confirm all records each ruling confirmed', ...)
test('setup stopped at step 4 resumes at step 4 in the next session', ...)
test('a second computer joins, and its records count on the first only after Trust it', ...)
test('uninstall after setup leaves the home folder as it was, but for what the director keeps', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: PASS, the whole suite. Report the count.
- [ ] **Step 3: Commit.**

```bash
git add tests/e2e
git commit -m "Try setup, a second computer and uninstall end to end"
```

### Task 18: The timed runs (check 19)

**Files:**
- Modify: `docs/checks/19-setup-time.md`, `docs/checks/README.md`

- [ ] **Step 1: Card to the director:** a throwaway user account on the Mac (their password to make it and to remove it), a test repository on their host account made by setup and deleted afterwards, about 25 minutes, of which the timed part is setup itself. Approved by their click.
- [ ] **Step 2: Mac (the director, timed).** The agent makes the account and leaves a note on its desktop with the README's line. The director logs in, opens Claude Desktop, signs in to Claude (not counted), and follows setup from the pasted line to the green board, with no help. The agent reads `stepTimes` from the journal afterwards: the director's minutes per step, and the waits.
- [ ] **Step 3: Windows.** A full timed run needs a Windows account where the director has administrator rights and may use the host; until one is available, the agent times steps 2, 4, 6 and 9 in the director's own account, with a stand-in host, and the note says which steps are measured. *Plan's call*, following the director's rule for that computer.
- [ ] **Step 4: Undo:** the test repository deleted (`gh api` answering 404 is checked), the account removed (the password), the GitHub app's installation removed by the director on its page.
- [ ] **Step 5: Write the note.** **Answer:** Yes if the Mac run is within about `TARGET_MINUTES` of the director's time; otherwise Partly, with the slowest steps and what would shorten each. Update the row, run `npm test`, commit.

```bash
git add docs/checks
git commit -m "Record check 19: setup timed on a fresh account"
```

### Task 19: The design and the handover

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md`, `HANDOVER.md`

- [ ] **Step 1: Bring the design up to date:** section 15 (the setup click and the journal; gh and glab fetched for the helper; the setup commit before protection; Confirm all; Node.js before the plugin, if check 35 says so; the measured times), 9 (the first key trusted on first use; other computers trusted on a click), 9.1 (telemetry's route, check 36), 12.1 and 12.9 (setup names the director's weakening settings: no longer left for later), 12.8 (the data note shipped), and section 20 (checks 19 and 35 to 38). This plan's calls go into section 21, each marked *Designer's call*, and the director's answer to Card 1 into section 22.
- [ ] **Step 2: Update `HANDOVER.md`:** what this plan built, what the checks and the timed runs found, and the next step in design section 17.2 (the evaluation as a whole, then the pilot).
- [ ] **Step 3: Commit.**

```bash
git add docs HANDOVER.md
git commit -m "Bring setup's checks, times and calls into the design, and update the handover"
```

## Plan's calls

Settled here without the director, each listed for the design in Task 19:

1. **When it starts:** once the front-desk plan has merged, since every card comes from its composer.
2. **Setup changes nothing itself from the session.** The playbook asks; the helper changes, after a signed click naming the exact list of changes.
3. **A journal of every change, with its value before,** so uninstall puts back exactly what setup changed, and leaves what the director has changed since.
4. **The first key is trusted on first use.** The session start makes it and enrols it on a computer with no list; other computers are trusted only on the director's click there.
5. **The setup clicks are kept beside the keys until a state branch exists,** then copied into it.
6. **`gh` and `glab` are fetched from their release archives** into the helper's own folder, checked, so there is no installer, password or warning for them (check 38).
7. **The setup commit goes straight to the default branch,** with the director's own sign-in, before protection is switched on.
8. **Confirm all** is one card with one set line naming the list's hash, confirming each ruling by its own confirmation.
9. **Uninstall's project change is a pull request the director merges** on the host's page, since the gate goes with it; the state branch and the profile repository are kept unless the director asks on their own card.
10. **The Windows timed run** measures only the steps that need neither administrator rights nor the host, until a Windows account that allows both is available.

## Builder check

Read on 19 October 2026 as the builder would, against design section 15 and the plans it calls. Nothing new needed the director beyond Card 1. These were settled in place, each marked *Reviewer's call*, and go into the design with the plan's calls in Task 19:

1. **Step order.** The setup commit has to go up before protection is switched on, and the project's settings before Locked (whose hook would otherwise refuse the playbook's own commands). The steps are numbered 1 to 10 inside setup: the project's files, pins and protection become step 7, between the changes to this computer and Locked; cards keep the design's titles.
2. **Node.js before the plugin, always.** The helper and the hooks are Node.js, so they can't install it. The README's first line has Claude start the official Node.js installer where it is missing; step 2 installs git and fetches `gh` or `glab`.
3. **Hooks in a folder being set up.** The hooks act only in a registered project, so the session start starts the helper and the prompt record takes setup clicks (and nothing else) in a folder being set up; the guards act there from the first session.
4. **Past transcripts** are matched to the folder by their entries' `cwd`, not by Claude Code's folder names.
5. **A second computer** opens an empty folder, chooses the project on a card, and the helper checks it out there.
6. **The composer's `setup` kind** is added in the front-desk plan's `compose.js` by Task 6.

## Order

Part 1 first: Tasks 1 to 3 in one Mac sitting, Task 4 by the agent. Tasks 5 and 6 can be built meanwhile. Then Tasks 7 to 13 in order, since each step's card follows the last; Task 8 builds against a stand-in app until Card 1 is answered. Task 14 needs Tasks 6, 8 and 10; Task 15 needs Tasks 5 to 13. Task 16 needs Tasks 6 to 15, Task 17 needs Tasks 5 to 16, Task 18 needs Task 17, and Task 19 is last.

## The director's sittings

Agents do every step they can (the director's standing rule, 18 October 2026). Each sitting opens with one card listing every change it makes and how each is undone, approved by the director's click.

| Sitting | Computer | Tasks | The director's part | About |
|---|---|---|---|---|
| 1 | Mac | 1, 2, 3 (checks 35, 36, 37) | the password twice, logging in to the throwaway account and opening Desktop, one Desktop restart, pasting the install line | 15 min |
| 2 | Windows, when next at it | 1, 2, 4 (checks 35, 36, 38), 18 (the steps it can) | being at the computer, one Desktop restart | 15 min |
| 3 | Mac | 18 (the timed run) | setup itself, timed, and the password twice | 25 min |

## After this plan

The next step in the design's build order (section 17.2) is the evaluation as a whole (section 18), then the pilot on one small feature of the first project, then installing Wheelhouse into that project, the rest of the mod, and the first public release.
