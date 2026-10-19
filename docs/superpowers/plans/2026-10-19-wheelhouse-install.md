<!-- docs/superpowers/plans/2026-10-19-wheelhouse-install.md -->

# Wheelhouse install into the first project: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the first project over to Wheelhouse for all its work (design section 17.2, step 5): install it with one approval click, check it, retire the first version (the Command Centre) without deleting it, give the director one click to switch back, start the design's measures, and keep the project's own rules in the project's own repository. Later, once Wheelhouse is ready on every computer the director uses for the project, remove the project's duplicate copies of skills a plugin provides; and once the measures are met for two weeks, retire the first version for good, still without deleting it.

**Architecture:** Everything specific to the first project lives in the private install brief, kept under `wheelhouseHome()` and never in this repository; a check over this repository keeps it that way. The brief's machine part pre-fills setup's answers, so setup's steps, the rules found and the switch-off of the first version can be shown on one card and applied after one signed click, each step still checked against its own list as setup's engine does. The first version and the project's duplicate copies are switched off per computer, in the project's git-ignored local settings, by the route check 50 finds, and every change is in setup's journal. Switching back is the journal's switch entries reversed, plus Wheelhouse switched off for that project on that computer: from a card while Wheelhouse runs, or by double-clicking a file that works with no Claude session at all. The measures are the evaluation plan's, started at the switch-over.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies. `git`, `gh` and `glab` only through the helper, except the read-only survey and the rehearsal, which the agent runs from Wheelhouse's own repository with the director's sign-in. The `claude` command line for check 50, the install check's session and the plugin's install.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`: section 17.2 (step 5; "Plugins per project"; "One copy of each skill"), 3 (each project's rules are its own; which document wins), 9 (the rulebook, adopting an existing project's rules), 12.1 and 12.2 (what Standard and Locked hold, the project's own settings shut to agents), 12.7 (STOP and the runbook), 15 (setup) and 18 (the measures). Read with `docs/specs/2026-10-18-build-loop-design.md`, section 14 (the pins, and switching the other copies off), and the plans whose work this one calls: setup (Tasks 5, 6, 9, 12, 13, 14 and 15), evaluation and pilot (Tasks 2, 9, 10, 11 and 12), build loop (Tasks 18, 23, 24, 26 and 29), board and usage (the briefing and the waiting list) and front desk (Task 2's composer). Check notes `docs/checks/04`, `15`, `24-pinning`, `30-undo`, `31-safety-live` and setup's 35 to 38.

## Scope

Step 5 of design section 17.2, as the director changed the build order on 19 October 2026: "build out the plugin as much as we can, then test … I also want this tool as designed in full". There is no pilot on one small feature. Every designed piece is built first, the rest of the mod (step 6) included; then the evaluation runs as a whole; then Wheelhouse takes all the work on the first project. This plan is that last move.

It starts once every earlier plan has merged (state and host, safety, build loop, board and usage, front desk, setup, the mod, and the evaluation plan's Parts 1 to 3) and the evaluation's whole run has passed (evaluation plan, Task 6). Part 1 (check 50, the survey and the private brief, the private-words check) can start now. *Plan's call.*

It builds:

- **The check it rests on:** check 50, switching a project's own skills, agents and plugins off and on from its local settings.
- **The private install brief and the private-words check:** what the project holds, surveyed read-only and written outside the repository; a check that this repository never names the project.
- **The switch-over:** setup's steps as one card; switching the first version and the duplicate copies off; work left in flight; the install check; starting the measures.
- **Switching back,** and switching over again: one card click, or one double-click.
- **Plugins per project:** the director's plugins and personal skills that the project doesn't use, switched off in its committed settings, for that project only.
- **Keeping the project's rules in its own repository:** adopted into its rulebook, its own documents brought into line by its own build loop, nothing of it in this repository.
- **Later:** the duplicate copies removed once Wheelhouse is ready on every computer the director uses for the project; the first version moved out of the folders Claude Code loads, and kept, once the measures are met for two weeks.
- **The rehearsal** (check 51) on a made-up project in a throwaway repository, and the switch-over sitting itself.

It does not build the first public release (step 7), or anything the evaluation plan already builds for the measures (the transcripts reader, the labeller, the weekly reading, the verdict); it starts them and adds one rule to them.

### Changes to the evaluation plan

The director's decision of 19 October 2026 answers that plan's two cards: Card 1, Wheelhouse for all work on the first project once everything is built, with no pilot feature; Card 2, **Keep a copy now**, in the private Wheelhouse folder outside the repository. Its builder reads it with these changes, which this plan owns:

| Evaluation plan | Changed to |
|---|---|
| Task 10, `ready` | Used as it is, inside this plan's install check (Task 7) |
| Task 10, `startPilot` | Called by this plan's switch-over (Task 7) with the first version's parts from the private brief and check 50's route, in place of check 24's way. The **The pilot feature only** branch is not built |
| Task 10, Step 4 (setup on the first project) | Replaced by this plan's Tasks 11 and 12 |
| Task 11 (the pilot feature) | No pilot feature. Steps 1 to 3 (watching, settling checks 1, 9, 22 and 23 and the real `gh` and `glab` outputs, problems into scenarios from 36) run over the first weeks of real use, from the switch-over |
| Task 12, Step 3 | **Stop the pilot** becomes **Switch back** (this plan's Task 5) |
| Task 9, the verdict card | **Make it the way of working** starts this plan's retiring for good (Task 9); a week switched back for more than a day isn't measured (this plan's Task 8) |
| Task 10, `ready`'s Card 1 line | Dropped: the director's decision answers it |
| Task 9, `setupMinutes` | Read from check 19's timed runs, not from the first project's setup: the install card isn't the setup a new director sees. *Reviewer's call* |
| Its sitting 1 | Replaced by this plan's sittings |
| Names | `pilot.json`, `scripts/pilot/` and `docs/evals/pilot.md` keep their names; "pilot" there now means the measured weeks. *Reviewer's call:* renaming files nobody sees costs churn across two plans |

## Decisions for the director

Asked once each, on a card, with the plan:

- **Card 1, how the first project is protected and connected.** *What this is:* setup asks two things of every project: the protection level (Standard, or Locked, which only your computer password can change) and how Wheelhouse reaches GitHub (quick: your existing sign-in, with its warning; narrow: the Wheelhouse GitHub App, on chosen repositories). This plan puts both answers on the one install card, so they are asked now. *Why it comes to you:* it decides how well the project is protected from agents, and Locked is offered to products with real users. *Options:* **Locked, narrow connection** (Mac only; your password at the switch-over, and again if you ever switch back; needs the Wheelhouse GitHub App registered first, the setup plan's Card 1); **Standard, narrow connection**; **Standard, quick connection** (nothing to register; agents still can't reach GitHub, but your sign-in is on the computer, as the warning says). *Recommendation:* Locked with the narrow connection if the product has real users, because that is what the design offers Locked for, and the safety sitting showed every guard holding at Locked; if it has none yet, Standard with the narrow connection. *Meanwhile:* everything is built and rehearsed either way; only the install card waits.
- **Card 2, which computers you use for the first project.** *What this is:* the design removes the project's duplicate copies of skills (copies of skills that a plugin also provides) only once Wheelhouse is confirmed working on every computer you use for that project. *Why it comes to you:* only you know where you'll work on it. *Options:* **The Mac only** (the copies go once the Mac is ready); **The Mac and a Windows computer** (the copies stay until Wheelhouse is set up and ready there, which needs a GitHub sign-in on that computer). *Recommendation:* the Mac only, unless you already work on this project from a Windows computer that can sign in to GitHub. *Meanwhile:* nothing waits; the copies are switched off on the Mac at the switch-over either way, and only their removal waits.

## Global Constraints

Everything in the earlier plans' Global Constraints holds: Node.js 22 or later, no npm dependencies, ESM `.js`, `node:test` in `tests/**/*.test.js`, macOS and Windows, the path comment on every file, British or Australian English, dates as "19 October 2026", no model identifiers anywhere (tests use made-up names such as `model-a`) and no `Co-Authored-By` line in commits, secrets only in a child's environment and never in output, everything under `wheelhouseHome()`, times in UTC ISO 8601 with a `now` argument, child processes through `run`, hooks never running `git` in a folder an agent controls, guards failing closed and informing hooks failing open, only hooks signing. In addition:

- **Nothing about the first project enters this repository.** Not its name, subject, paths, rules, skills' names, figures or the director's words: not in code, tests, fixtures, check notes, scenarios, commit messages or the design. Tests and the rehearsal use a made-up project with a made-up first version. Everything specific lives in the private install brief, `briefDir(folder)` (Task 2), as `brief.md` and `brief.json`. `npm run private-check` (Task 2) passes before every commit of this plan's work.
- **Nothing of the first version is deleted.** It is switched off per computer, and later moved to a folder Claude Code doesn't load, inside the project's own repository. Every switch is a journal entry (setup plan, Task 5), so it can be put back.
- **No change without the director's click,** as in setup: the install card names the hash of every step's list together; the switch cards name the hash of their own list. The one exception is the double-click switch (Task 5), which is the director's own action outside Claude. *Plan's call.*
- **The project's own work goes through the project's own loop.** Changes to the project's files after the setup commit (its documents brought into line, the copies removed, the first version moved) are requests to its intake, built, reviewed and gated like any other; this plan's scripts only write the request.
- **The design's numbers are constants,** in `scripts/lib/install-numbers.js`: `SWITCHED_BACK_MS = 24 * 60 * 60 * 1000` (a week switched back for longer isn't measured, as with STOP), `PRIVATE_SCAN_COMMITS = 50`, `CHECK_SESSION_MS = 60 * 1000`.
- **Checks continue the numbering:** the evaluation plan's is 39; 40 to 49 are the mod plan's; this plan's are 50 and 51.

## Review Focus

1. **The one card going stale.** Between the install card and the click, or between two steps, something changes (a tool gets installed, a rule is edited, the main checkout moves), or the brief was written by someone other than the agent. Expected: each step is planned again before it applies and runs only when its list's hash is the one the card named; a step whose list changed asks its own card, so nothing off the card is applied; every pre-filled answer is on the card in plain words. Owning task: Task 4.
2. **Switching back when Wheelhouse itself is what's wrong.** The plugin won't load, the helper is down, STOP is on, or the project is Locked. Expected: the double-click file works with no Claude session, helper or signature; the card works under STOP; on a Locked project both say first that leaving Locked needs the password, and nothing is half-switched. Owning task: Task 5.
3. **Work left in flight.** The main checkout is behind its remote or has local changes; the first version left pull requests open and worktrees with uncommitted changes. Expected: the checkout is fast-forwarded only when it has no local changes, otherwise the switch-over waits and says why; each open pull request is handed to the intake and merged only through Wheelhouse's review and gate; worktrees are left as they are and named in the first briefing, never deleted. Owning task: Task 6.
4. **The project's details leaking into this repository.** A check note, a scenario from 36 on, a commit message, a test fixture or the evaluation's report naming the project or quoting its rules. Expected: `npm run private-check` finds every listed word in tracked files and in the messages of commits not yet pushed, whatever its case, and fails; with no list on the computer (CI, a contributor) it passes and says so. Owning task: Task 2.
5. **Measures muddled by the switch.** A week switched back for part of it, a by-hand switch nobody recorded, or the install check's own session. Expected: switch periods reach state at the next session start; a week switched back for more than `SWITCHED_BACK_MS` is read with every `met` null and `notMeasured: ['switched back']`; the install check's session stops before its first model call and spends no tokens. Owning tasks: Tasks 7 and 8.

Also tested, though less likely: a project skill with the same name as a plugin's skill but different content (it isn't a copy: kept and named, Task 2); a project agent with the same name as one of Wheelhouse's agents (switched off with the first version, or named by the install check, Task 7).

## File structure

```
scripts/lib/install-numbers.js     the numbers above
scripts/install/brief.js           where the private brief lives; its JSON part; the strict reader
scripts/install/survey.js          what a project holds: skills, agents, hooks, copies, work in flight
scripts/install/private-words.js   the check that this repository never names the project
scripts/install/bundle.js          setup's steps and the switch-off as one card
scripts/install/switch.js          switching the first version off and back; the double-click files
scripts/install/check.js           the install check
scripts/install/later.js           ready on every computer; the requests for the copies and for retiring
scripts/install/cli.js             the agent's and the files' one command
scripts/setup/steps.js             (changed) the bundle's apply
scripts/setup/project-files.js     (changed) plugins and personal skills off for this project
scripts/host/helper.js             (changed) /setup/bundle, /install/switch, /install/check
scripts/state/card-lines.js        (changed) installLine, switchLine
scripts/state/events.js            (changed) the install and switch actions; the switched note
scripts/hooks/prompt-record.js     (changed) the install and switch clicks
scripts/hooks/session-start.js     (changed) by-hand switches into state; a computer's ready note
scripts/pilot/measures.js          (changed) weeks switched back
skills/setup/SKILL.md              (changed) the install card first, when a brief is there
commands/switch-back.md
package.json                       (changed) the private-check script
README.md                          (changed) switching back
probes/50-switch-off/run.js, probes/51-rehearsal/run.js
docs/checks/50-switch-off.md, docs/checks/51-rehearsal.md
tests/fixtures/install/            a made-up project with a made-up first version
tests/e2e/install.test.js
```

## Findings note format

As the checks plan set it, checked by `tests/docs/checks-format.test.js`. Each note adds its row to `docs/checks/README.md`. Neither note names the first project: check 50 runs on scratch projects, check 51 on the made-up one.

---

## Part 1: the check, the brief, and keeping the project out of this repository

**Before Part 1, one card to the director** (agents do every step they can, by the director's standing rule of 18 October 2026). What this is: check 50 makes scratch projects in the temporary folder and installs a scratch plugin at project scope, which touches Claude Code's own plugin lists on this Mac for a few minutes; it backs them up first and compares them after, as check 24 did. The survey only reads the first project. Why it comes to them: it changes Claude Code's files on their Mac, briefly. Options: **Go ahead**, **Not now**. Recommendation: go ahead. Meanwhile: Task 2's private-words check can be built.

### Task 1: Check 50, switching a project's own parts off and on

**Files:**
- Create: `probes/50-switch-off/run.js`, `docs/checks/50-switch-off.md`
- Modify: `docs/checks/README.md`

The question: *From a project's git-ignored local settings (`.claude/settings.local.json`), how to keep a skill, an agent, a slash command and a hook that the project's committed folders define out of every session on this computer (and, from the committed settings, a personal skill in `~/.claude/skills/`), and put them back, without deleting or moving a file: whether a `Skill(<name>)` or `Agent(<name>)` deny rule does it (and whether the director typing `/<name>` is refused too), or another documented setting does it better; whether a local `enabledPlugins` entry set `false` beats the project's `true`, and a local `sandbox.enabled: false` beats the project's `true`; when a project agent and a plugin agent share a name, which one a dispatch by the bare name reaches; whether an untracked skill folder listed in `.git/info/exclude` loads; whether a change takes effect at the next session start with no restart; and whether a session's `init` event lists its skills, agents and plugins before any model call.*

**Interfaces:**
- Produces, for Tasks 3, 5 and 7: `route` for each kind (`skill`, `agent`, `command`, `hook`), as the exact local-settings key and value that switches it off, or `none` with what the note says to do instead; whether `/<name>` typed by the director is refused; `pluginOff` and `sandboxOff` (does the local value win); `sameName` (`project` or `plugin` wins a bare-name dispatch); `untrackedLoads`; `initBeforeModel`.

- [ ] **Step 1: Read** the documentation on permissions (`Skill` and `Agent` rules), skills, subagents, hooks, settings precedence and plugins loading, and record the links and the date.
- [ ] **Step 2: Run `probes/50-switch-off/run.js --go` (agent, Mac).** Back up Claude Code's four files as check 24's probe did. In a scratch project under the temporary folder, write one skill, one agent named `builder`, one command and one `SessionStart` hook into its committed `.claude/` folders, and a scratch marketplace plugin installed at project scope with its own agent `builder`. For each candidate route, write it into the local settings, start `claude -p --output-format stream-json` in the project with the terminal's Claude Code and with the copy inside the Desktop app, read the `init` event, and stop the session there; then ask it, in one turn, to use the skill, to dispatch `builder`, and send `/<command>` as a prompt, and record what ran. Then the plugin and sandbox overrides, the untracked folder, and a change made between two sessions. Undo: uninstall, remove the marketplace and folders, compare the four files.
- [ ] **Step 3: Windows,** only if Card 2 is answered with a Windows computer, in that computer's next sitting: the same, with the Desktop app's copy.
- [ ] **Step 4: Write the note,** add its row, run `npm test`, commit.

```bash
git add probes/50-switch-off docs/checks
git commit -m "Record check 50: switching a project's own skills, agents and plugins off from its local settings"
```

**If the answers differ:** if no local setting keeps a project skill or agent out, the switch-off moves it instead, on this computer only: into `briefDir(folder)/off/`, with the move in the journal, so the working copy shows it deleted until switching back. That leaves an uncommitted change in the main checkout, which the switch-over's `.git/info/exclude` entry can't hide, so the note must say whether `git update-index --skip-worktree` keeps it out of the first version's commits and Wheelhouse's sessions; the brief then records `route: 'move'`, and Task 3 tests both. If a local `false` doesn't beat the project's `true`, switching back writes the plugin's `false` and the sandbox's `false` into the director's user settings scoped by `projectPath` where check 24's route allows, or else becomes the setup plan's uninstall, and Card 2's wording changes to say so.

### Task 2: The survey, the private install brief, and the private-words check

**Files:**
- Create: `scripts/lib/install-numbers.js`, `scripts/install/brief.js`, `scripts/install/survey.js`, `scripts/install/private-words.js`, `scripts/install/cli.js`, `tests/fixtures/install/`
- Modify: `package.json` (`"private-check": "node scripts/install/private-words.js"`)
- Test: `tests/scripts/install/brief.test.js`, `tests/scripts/install/survey.test.js`, `tests/scripts/install/private-words.test.js`

**Interfaces:**
- Consumes: `readManifest` (build-loop plan, Task 23: the pinned plugins' skill folders); `findRules` (setup plan, Task 9); `run`; `wheelhouseHome`.
- Produces:
  - `Brief = { v: 1, folder, host: 'github' | 'gitlab', computers: Array<{ label, id: string | null }>, answers: { product: string, liveData: boolean, realUsers: boolean }, protection: 'standard' | 'locked', connection: 'quick' | 'narrow', firstVersion: Array<{ kind: 'skill' | 'agent' | 'command' | 'hook' | 'scheduled', name, path }>, copies: Array<{ name, path, plugin }>, keep: Array<{ name, path, why }>, inFlight: InFlight, deniedAfterSwitchBack: string[], plugins: { off: Array<{ id, why }>, skillsOff: Array<{ name, why }> }, docsToAlign: Array<{ file, line }> }`. `briefDir(folder) -> <wheelhouseHome()>/install/<basename(folder)>-<first 8 hex of the SHA-256 of the full path>/`, so two projects with the same folder name never share a brief (*reviewer's call*); `readBrief(folder) -> Brief | null` (strict: a key missing or of the wrong type is an error naming it; a `folder` that isn't this folder is refused); `writeBrief(brief)`, atomic.
  - `surveyProject({ folder, manifest, run }) -> Promise<Survey>`, read-only: `skills` and `agents` (each `.claude/skills/*/SKILL.md` `name` and `.claude/agents/*.md` `name`, with paths), `commands`, `hooks` (from the committed settings), `scheduled` (Claude's scheduled tasks whose folder is the project, read from their own list), `copies` (a project skill whose `name` is a pinned plugin's skill, and whose content matches that skill at some upstream commit; a name match with other content goes in `keep` with "same name, own content"), `inFlight`, `commandsNamed` (every `gh`, `glab`, `git`, `npm`, `npx` and deploy-tool command the first version's files name), and `deniedAfterSwitchBack` (those of `commandsNamed` that Standard's deny rules, which stay when switched back, would refuse; the sandbox's own limits are left out, since switching back turns the sandbox off).
  - `plugins` and `personalSkills`: the plugins on in the director's user settings (synced ones included) and the skills in `~/.claude/skills/`, each with its description, for the agent to mark in the brief as used by this project's work or not (design section 17.2, "Plugins per project"). Wheelhouse, its pins and the copies its settings already switch off are left out.
  - `InFlight = { behind: number, dirty: boolean, prs: Array<{ number, branch }>, worktrees: Array<{ path, branch, dirty: boolean }> }`: the main checkout against its remote's default branch (after a `git fetch`), open pull requests (`gh pr list` or `glab mr list`, read-only), and worktrees.
  - The survey doesn't decide which parts are the first version: the agent writing the brief marks them, from the project's history (the commit that added them) and what they do (run the project's engineering: brief builders, review, merge), and records why in `brief.md`.
  - `privateWords() -> string[]`: lines of `<wheelhouseHome()>/install/private-words.txt`, blank lines and `#` lines skipped; `[]` when absent. `scanRepo({ root, words, commits = PRIVATE_SCAN_COMMITS }) -> Array<{ where: 'file' | 'commit', at: string, line: number, wordNo: number }>`: tracked files (`git ls-files`, binary files skipped) and the messages of the commits not yet on the remote's default branch (with no remote, the last `PRIVATE_SCAN_COMMITS`), matched without regard to case, since a pushed commit can no longer be changed and the public history starts afresh (design section 16; *reviewer's call*); a hit names its place and the word's line in the list, never the word, so the check's own output can be pasted anywhere. The script exits 1 on any hit, and 0 with `No private list on this computer.` when there is none.
  - `cli.js survey <folder>` prints the survey as JSON for the agent; `cli.js brief <folder>` checks a written brief with `readBrief` and prints what the install card will say.

- [ ] **Step 1: Write the failing tests,** against `tests/fixtures/install/`: a made-up project (a made-up product, a made-up first version of one skill and two agents, a copy of one pinned skill, a skill of the same name with its own content, and its own design skill).

```js
test('a copy of a pinned skill is a copy; the same name with other content is kept and named', ...)
test('the first version\'s commands that Standard would still refuse are listed', ...)
test('in flight: behind, local changes, open pull requests and worktrees', ...)
test('a brief with a missing or mistyped key is refused, naming the key', ...)
test('a brief for another folder is refused', ...)
test('a listed word in a tracked file or an unpushed commit message fails, whatever its case', ...)  // Review Focus 4
test('a hit is reported by place, never by the word', ...)                                        // Review Focus 4
test('with no list on the computer the check passes and says so', ...)                            // Review Focus 4
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts package.json tests
git commit -m "Survey a project read-only, keep its brief outside the repository, and check the repository never names it"
```

- [ ] **Step 4: Write the private install brief (agent, Mac).** Run `cli.js survey` on the first project's main folder. Write `brief.md` (what the first version is made of and why each part is marked, the copies, what is in flight, the project's documents that describe the first version's way of working, and the fallback paths for switching back) and `brief.json` (Cards 1 and 2's answers; the three setup answers, drafted from the project's own documents: what the product is and who uses it, live data, real users). Write `private-words.txt`: the project's name, its repository's name, its product's name, and any other word only that project uses; never a common word, which would stop every commit, and never a name this repository uses on purpose, such as the first version's public name. Run `cli.js brief`, then `npm run private-check` in this repository. Nothing is committed from this step. Report on the card's follow-up line only the counts (parts, copies, items in flight), never a name.

---

## Part 2: the switch-over

### Task 3: Switching the first version and the copies off

**Files:**
- Create: `scripts/install/switch.js`
- Modify: `scripts/state/events.js` (the `switched` note)
- Test: `tests/scripts/install/switch.test.js`

**Interfaces:**
- Consumes: check 50's `route`; `applyJsonKey`, `reverseChange`, `readJournal` (setup plan, Task 5); uninstall's stop step (setup plan, Task 15); `start.js` (build-loop plan, Task 19); `leaveLocked({ project })` and `installLocked` (safety plan, Task 13); `Brief` (Task 2).
- Produces:
  - `switchOffChanges({ folder, brief, route }) -> Change[]`: for each of `brief.firstVersion` and `brief.copies`, the local-settings key check 50 found for its kind (`kind: 'json-key'`, `target` the project's `.claude/settings.local.json`), each tagged `switch: 'first-version' | 'copy'`. A part whose kind has `route: 'none'` gets check 50's fallback. A scheduled task is paused through Claude's scheduled-tasks list by the agent in the sitting, as a `process` change, and resumed on switching back by card; the by-hand route names it in its one line instead. *Reviewer's call:* only a session can pause one. Nothing outside the project's local settings and the journal changes; no file of the first version is touched.
  - `switchBackChanges({ folder, journal, locked }) -> { changes: Change[], needsPassword: boolean }`: every switch-off entry reversed, the copies' included, since the first version used the project's copies and Wheelhouse's pinned plugins leave with it; in the local settings, `enabledPlugins` false for Wheelhouse and its pinned plugins, and true for each plugin the project's settings switched off (Anthropic's and the synced copies, and the unrelated plugins, Task 4) that was on in the director's user settings before setup; and `sandbox.enabled: false`. Before any of it, the project's watcher and foreman are stopped as uninstall stops them, feature worktrees are left as they are, and the helper keeps running for the director's other projects. On a Locked project `needsPassword` is true, and the first change is `leaveLocked({ project })`, which takes this project out of Locked and keeps the director's other Locked projects in it, since Locked's hook refuses commands where the sandbox is off. *Reviewer's call:* a foreman left running would go on waking feature sessions in a project that has switched back.
  - `switchOverAgainChanges({ folder, journal }) -> Change[]`: the switch-back entries reversed (and, when the project was Locked, `installLocked` again, with its password), then the watcher and foreman started by `start.js`; the foreman picks up features in progress at its first wake.
  - `switchState(folder) -> 'wheelhouse' | 'first-version'`, from the journal.
  - A `switched` note, `{ to, at, by: 'card' | 'hand' }`, is written to state by the helper after a switch by card, and by the session start for a switch by hand (Task 5).

- [ ] **Step 1: Write the failing tests,** with a scratch home and the fixture project.

```js
test('switching off touches only the local settings, and every first-version file is as it was', ...)
test('a skill, an agent, a command and a hook are each switched off by their route', ...)
test('switching back puts back each switch-off and turns Wheelhouse off for this project only', ...)
test('the director\'s other projects keep Wheelhouse on', ...)
test('a Locked project needs the password first, and nothing is switched before it', ...)  // Review Focus 2
test('switching back stops the project\'s watcher and foreman and leaves its worktrees', ...)
test('switching over again puts the project back exactly as after the switch-over, and starts them', ...)
test('a local value the director changed after the switch is left and named', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Switch the first version and the duplicate copies off on this computer, and back, from the journal"
```

### Task 4: Setup's steps as one card

**Files:**
- Create: `scripts/install/bundle.js`
- Modify: `scripts/setup/steps.js`, `scripts/setup/project-files.js` (`projectFilesChange` takes `pluginsOff` and `skillsOff`), `scripts/host/helper.js` (`/setup/bundle`), `scripts/host/helper-client.js`, `scripts/state/card-lines.js` (`installLine`), `scripts/state/events.js` (the `install` action), `scripts/hooks/prompt-record.js`, `scripts/cards/compose.js` (the `install` kind), `skills/setup/SKILL.md`
- Test: `tests/scripts/install/bundle.test.js`, `tests/scripts/host/helper-setup.test.js`, `tests/scripts/hooks/prompt-record.test.js`

**Interfaces:**
- Consumes: `STEPS`, `planHash`, `setupLine`, `/setup/plan`, `/setup/apply`, the setup clicks kept before a state branch exists (setup plan, Task 6); `confirmAllLine` and `findRules` (setup plan, Task 9); `readBrief` (Task 2); `switchOffChanges` (Task 3); `composeCard`.
- Produces:
  - `bundlePlan({ folder, brief, role: 'first' | 'second' }) -> Promise<{ parts: Array<{ step: number | 'switch-off', title, changes, hash, says: string[] }>, rules: { ids, hash } | null, hash, card: CardInput }>`: each setup step planned with the brief's answers standing in for its card's (step 3's connection, step 4's three answers, step 8's Locked), the rules found with their `confirmAllLine` hash, each rule's id made from its words and source (the first 12 hex of their SHA-256), so the click can name rulings that step 5 records only later, under those ids (*reviewer's call*; setup plan Task 9's `findRules` gives the ids), and the switch-off (Task 3) as a last part; `role: 'second'` holds steps 1, 2, 3, 6, 8 and 9 and the switch-off (setup plan, Task 14). `hash` is `planHash` over the parts' hashes and the rules' hash, in order.
  - The card: what will happen, step by step in plain words, each pre-filled answer as "Setup will record: …", the rules as a count with the first five and **Show me** for the rest, what is in flight and what happens to it (Task 6), and how to switch back; options as the composer gives a decision card: **Install** (`installLine(hash) -> 'Install Wheelhouse as listed, <hash12>'`), **Not now**, **Explain more**, **Show me** (every step's full list, and every rule). To change something, the director types what; the playbook then asks setup's own card for that step, and the install card again for the rest. *Reviewer's call:* a card has four options at most (front-desk plan, Task 2), so there is no room for a fifth.
  - The prompt record writes a signed `action` `install` `{ hash, parts: Array<{ step, hash }>, rules }` and, from it, one `setup` click per part (`{ step, hash, runId, question, label }`, naming the folder's run) and the `confirm-all` click, each as if clicked on its own card; kept with the setup clicks until the state branch exists.
  - `/setup/bundle { folder }`, read-only: the plan, when `readBrief(folder)` has a brief, else `{ ok: false, why: 'no brief' }`. `/setup/apply` is unchanged: each part still applies only when a fresh plan gives its hash. A part whose fresh plan differs asks its own setup card and the run carries on after it (Review Focus 1).
  - Step 1 (installing the plugin) is done by the agent before the card, by check 37's route from the command line at project scope, since it needs no Claude sign-in; where check 37 found the command line can't, the director pastes the README's line (one paste, said in the sitting's card).
  - **Plugins per project.** Step 7's project settings gain `enabledPlugins[id] = false` for each of `brief.plugins.off`, and check 50's skill route for each of `brief.plugins.skillsOff`, in the committed `.claude/settings.json`, so they are off in this project only and the director's other projects keep them; the card lists each with its reason. A project setting can be overridden for one computer from the local settings (design section 17.2).
  - Step 9 (phone notifications): when its plan finds both push options already on (check 4 was done on this Mac), the bundle leaves out the screen-lock test and the briefing asks, later, on its own card, whether pushes arrive. *Reviewer's call:* a locked screen is not one of the director's sitting steps.
  - The playbook asks `/setup/bundle` first and, with a plan, asks the install card instead of setup's first card.

- [ ] **Step 1: Write the failing tests,** with the stand-in host, a scratch home and a brief for the fixture project.

```js
test('the install card lists every step\'s changes and every pre-filled answer in plain words', ...)
test('Install records one setup click per part and one confirm-all, each signed', ...)
test('a part whose list changed after the card asks its own card, and the rest carry on', ...)   // Review Focus 1
test('an install click naming another hash applies nothing', ...)                                // Review Focus 1
test('a rule\'s id comes from its words and source, so the click names it before step 5 records it', ...)
test('with no brief the playbook asks setup\'s own first card', ...)
test('a second computer\'s card holds steps 1, 2, 3, 6, 8 and 9 and the switch-off', ...)
test('unrelated plugins and personal skills are off in this project\'s committed settings, and listed on the card with why', ...)
test('phone notifications already on leave the screen-lock test out', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts skills tests
git commit -m "Ask setup's steps on one card when a private brief has the answers"
```

### Task 5: One click to switch back

**Files:**
- Modify: `scripts/install/switch.js` (the files), `scripts/install/cli.js` (`switch`), `scripts/cards/compose.js` (the `switch` kind, deciding label `Switch back`), `scripts/host/helper.js` (`/install/switch`), `scripts/state/card-lines.js` (`switchLine`), `scripts/state/events.js` (the `switch` action), `scripts/hooks/prompt-record.js`, `scripts/hooks/session-start.js`, `scripts/hooks/stop-guard.js` (the command's forms under STOP), `README.md`
- Create: `commands/switch-back.md`
- Test: `tests/scripts/install/switch-files.test.js`, `tests/scripts/host/helper-install.test.js`, `tests/scripts/hooks/session-start.test.js`

**Interfaces:**
- Consumes: Task 3; `composeCard`; the helper's click checks (setup plan, Task 6); Claude Code's list of installed plugins (check 24: `installed_plugins.json`, `wheelhouse@<marketplace>` with this `projectPath`).
- Produces:
  - **By card.** `/wheelhouse:switch-back` (and **Switch back** on the board's health line and in the mod's settings pane, which call the same route) asks one card: what switching back does (the first version on, Wheelhouse's checks off in this project on this computer, the director's other projects unchanged, what Standard still refuses from `deniedAfterSwitchBack`, the password first on a Locked project) and how to switch over again; **Switch back** (`switchLine('first-version', hash) -> 'Switch this project back to the first version, <hash12>'`), **Not now**. The helper's `/install/switch { folder, to, hash }` applies it only with a fresh signed `switch` click naming that hash, and is let through under STOP for `to: 'first-version'` only. *Plan's call:* switching back is a way out, like the runbook; switching to Wheelhouse under STOP waits for STOP to be lifted.
  - **By hand.** At the switch-over, `writeSwitchFiles({ folder, platform }) -> string[]` writes into `briefDir(folder)` `Switch back.command` and `Switch to Wheelhouse.command` on macOS (mode `0755`), or `.cmd` on Windows. Each finds the installed plugin's folder at the moment it runs (from `installed_plugins.json`, so a release upgrade doesn't break it), runs `node <that folder>/scripts/install/cli.js switch --to <first-version | wheelhouse> --folder "<folder>" --by-hand`, prints one plain line ("Switched back. Open a new Claude session on the project.") and waits for a key. `--by-hand` applies the journal's changes directly, with no helper and no signature, and records the switch in the journal; on a Locked project it starts the system's own password prompt first. The helper opens the folder in Finder or Explorer once, at the end of the switch-over. *Plan's call:* the double-click is the director's own action outside Claude, and it is the only route back when Wheelhouse won't load, or forward while it is off.
  - The session start, in a project switched over by hand since its last session, writes the `switched` note (Task 3) with `by: 'hand'` and the journal's time.
  - `README.md` gains a short "Switching back" section, in general terms.

- [ ] **Step 1: Write the failing tests.**

```js
test('Switch back by card needs a fresh signed click naming its list', ...)
test('switching back by card works under STOP; switching to Wheelhouse waits for STOP to lift', ...)  // Review Focus 2
test('the files find the plugin\'s folder when they run, after an upgrade too', ...)
test('a by-hand switch works with the helper stopped and the plugin switched off', ...)              // Review Focus 2
test('a by-hand switch on a Locked project asks the password before anything else', ...)            // Review Focus 2
test('a by-hand switch reaches state as a note at the next session start', ...)                    // Review Focus 5
test('a folder path with a space and an accent is quoted in both files', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test` and `claude plugin validate .`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts commands README.md tests
git commit -m "Switch back with one click on a card, or one double-click when Claude can't be used"
```

### Task 6: Work left in flight

**Files:**
- Modify: `scripts/install/bundle.js`, `scripts/install/switch.js`
- Test: `tests/scripts/install/in-flight.test.js`

**Interfaces:**
- Consumes: `InFlight` (Task 2); the helper's fetch and fast-forward of the main checkout (state-and-host plan); the intake's request event (build-loop plan, Task 18).
- Produces:
  - `inFlightPlan(inFlight) -> { waits: string | null, says: string[], requests: Array<{ text }> }`. The main checkout is fast-forwarded by the helper as a bundle part when `behind > 0` and `dirty` is false; with local changes the switch-over waits, and `waits` says in plain words that the project has unsaved changes on the Mac and what to do (finish them with the first version, or let Wheelhouse take them as a request after the switch-over). Each open pull request becomes one request to the intake after the switch-over, "Carry on pull request <n>: review it, finish it and merge it through the gate", so the intake chooses its lane and a feature session opens it again through the helper, stamped with its provenance, and closes the old one with a link (a pull request without Wheelhouse's provenance can't pass the gate, build-loop plan Task 27). Worktrees are left as they are; each with uncommitted changes is named in the first briefing. *Reviewer's call:* nothing the first version left is merged without Wheelhouse's review, and nothing is deleted.

- [ ] **Step 1: Write the failing tests.**

```js
test('a checkout behind its remote with no local changes is fast-forwarded as a part', ...)   // Review Focus 3
test('a checkout with local changes waits, and says why in plain words', ...)                 // Review Focus 3
test('each open pull request becomes one request to the intake after the switch-over', ...)  // Review Focus 3
test('worktrees are left as they are and named in the first briefing', ...)                  // Review Focus 3
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Bring the checkout up to date at the switch-over, and hand open work to the intake"
```

### Task 7: The install check, and starting the measures

**Files:**
- Create: `scripts/install/check.js`
- Modify: `scripts/host/helper.js` (`/install/check`), `scripts/install/cli.js` (`check`, `start`)
- Test: `tests/scripts/install/check.test.js`

**Interfaces:**
- Consumes: check 50 (`initBeforeModel`, `sameName`); `ready` and `startPilot` (evaluation plan, Task 10); `healthCheck` (setup plan, Task 12); `checkInstalled` (build-loop plan, Task 23); the session start's `decide` (to see the front desk's line); `keepRecords` (evaluation plan, Task 2); `CHECK_SESSION_MS`.
- Produces:
  - `installCheck({ folder, brief, run, now }) -> Promise<{ ok: boolean, lines: string[] }>`, one line per condition, met or not: the evaluation's `ready` lines; setup's health check green; `checkInstalled` passes; a session's `init` event (`claude -p --output-format stream-json` in the project, run with the copy of Claude Code inside the Desktop app as check 24 did, so it rests on Desktop's sign-in rather than the command line's; stopped at the `init` event, within `CHECK_SESSION_MS`, before any model call, so it spends nothing; Review Focus 5) lists Wheelhouse and its pinned plugins and none of the first version's parts or the copies; no project agent left on shares a name with one of Wheelhouse's agents; the session start names the front desk; the helper, the watcher and the foreman are running; and no Desktop session opened on the project before the switch-over is still open (its transcript written in the last hour, with no provenance file), since it would still hold the first version; one that is gets a line asking the director to close it. *Reviewer's call.*
  - `startMeasures({ folder, now })`: `startPilot` with the first version already switched off (Task 3), so it writes `pilot.json`, refreshes the kept records up to now and takes the baseline; then the `ready` note for this computer, `{ computer: computerId(), at }`, which Task 9 reads.
  - The switch-over's last steps, in order: `installCheck`; when it passes, `startMeasures`, `writeSwitchFiles` and the folder shown, the in-flight requests (Task 6), the request bringing the project's documents into line (Task 10), and the front desk's first briefing, which says how to switch back. When it fails, nothing is started, each failed line is said in plain words, and the director is offered **Switch back** or **Leave it with the agents**.

- [ ] **Step 1: Write the failing tests,** with a fake `run` giving a recorded `init` event.

```js
test('each condition is a line, met or not', ...)
test('a first-version part or a copy still listed in the session fails the check', ...)
test('a project agent named like one of Wheelhouse\'s fails the check unless it is switched off', ...)
test('the check\'s session stops at its init event and spends no tokens', ...)         // Review Focus 5
test('the measures start only after the check passes, with this computer\'s ready note', ...)
test('a session left open from before the switch-over is named, with a line asking to close it', ...)
test('a failed check starts nothing and offers Switch back', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Check the switch-over from a session's own list, and start the measures when it passes"
```

---

## Part 3: the measures and the project's rules

### Task 8: Weeks switched back

**Files:**
- Modify: `scripts/pilot/measures.js`
- Test: `tests/scripts/pilot/measures.test.js`

**Interfaces:**
- Consumes: the `switched` notes (Task 3); `pilotReading` and `metForTwoWeeks` (evaluation plan, Task 9); `SWITCHED_BACK_MS`.
- Produces: `switchedBackMs({ notes, from, to }) -> number`: the time inside the week the project spent switched back. `pilotReading` gives a week over `SWITCHED_BACK_MS` every `met` as `null` and `notMeasured: ['switched back']`, as it does for STOP, so it breaks the run of met weeks. A week with a switch back of less than a day is read as usual; the briefing's pilot line says "switched back for <hours> hours". *Plan's call:* the same rule as STOP's.

- [ ] **Step 1: Write the failing tests.**

```js
test('a week switched back for more than a day is not measured and breaks the two weeks', ...)  // Review Focus 5
test('a week switched back for an hour is read, and the briefing says so', ...)
test('a by-hand switch counts from its own time, not from when it reached state', ...)            // Review Focus 5
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Leave a week switched back for more than a day out of the measures"
```

### Task 9: Ready everywhere, the copies, and retiring for good

**Files:**
- Create: `scripts/install/later.js`
- Modify: `scripts/jobs/weekly.js` (the board-and-usage plan's file holding `runWeekly`), `scripts/install/switch.js` (switching back after retiring)
- Test: `tests/scripts/install/later.test.js`

**Interfaces:**
- Consumes: the `ready` notes (Task 7); `Brief.computers`; the verdict card's answer (evaluation plan, Task 9); the intake's request event; check 50's `untrackedLoads`.
- Produces:
  - `readyEverywhere({ notes, readings, computers }) -> { ok: boolean, missing: string[] }`: a `ready` note from every computer the brief lists, followed by one whole week's reading with no lineage hold and no switch back; a computer with no id yet is missing. *Reviewer's call:* "confirmed working" means used for a week, not only installed.
  - **The copies.** When `readyEverywhere` turns true, the weekly job writes one request to the intake: "Remove the project's copies of these skills, which the pinned plugins provide: <names>; update the project's own list of its skills where it has one." It changes `.claude/`, so it is a guardrail change, with the director's approval on its own card (design section 12.4). Once merged, the copies' switch-off entries are removed from each computer's local settings at its next session start, since they name nothing. The design's "One copy of each skill".
  - **Retiring for good.** When the director answers the verdict card **Make it the way of working**, one request: "Move the first version's parts (<names>) out of the folders Claude Code loads, into `docs/first-version/` in this repository, unchanged, with a note on what they were and when they ran; update the project's documents that point to them." Also a guardrail change with its own approval card. Once merged, their switch-off entries go as the copies' did.
  - **Switching back after that** copies the parts from `docs/first-version/` into their old folders in the main checkout, untracked and listed in `.git/info/exclude`, as part of `switchBackChanges`, and removes them when switching over again; where check 50 found an untracked folder doesn't load, switching back after retiring opens a pull request moving them back instead, and its card says that it takes a review first.

- [ ] **Step 1: Write the failing tests.**

```js
test('ready everywhere needs a ready note from every listed computer and a week of use after it', ...)
test('the copies\' request is written once, when the last computer is ready', ...)
test('retiring is requested only on Make it the way of working', ...)
test('after retiring, switching back puts the parts in place untracked, and switching over takes them out', ...)
test('switch-off entries naming nothing are removed at the next session start', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts tests
git commit -m "Remove the duplicate copies once every computer is ready, and retire the first version for good on the verdict"
```

### Task 10: Keeping the project's rules in its own repository

**Files:**
- Modify: `scripts/install/later.js` (`alignRequest`), `skills/setup/SKILL.md`
- Test: `tests/scripts/install/later.test.js`

**Interfaces:**
- Consumes: the rules confirmed on the install card (setup plan, Task 9: into the project's rulebook on its own state branch); `Brief.docsToAlign`.
- Produces:
  - Where each thing lives, for the playbook and the design: the project's rules in its rulebook on its own state branch, with their sources in its own files; its configuration (`.claude/wheelhouse.json`: critical areas, hot files, pages, build commands) in its own repository, from the setup commit on; its measures and notes in its state branch and `<wheelhouseHome()>/pilot/`; its brief in `briefDir`. This repository gets only what holds for any project.
  - `alignRequest(brief) -> { text } | null`: one request to the project's intake: "These lines describe the first version's way of working; bring them into line with Wheelhouse, keeping the project's own rules: <file:line list>." Null when `docsToAlign` is empty. Its changes go through the project's own review and gate, and a change to `CLAUDE.md` gets the one line design section 3 asks for (the rulebook wins).
  - The playbook's install-card section says, in one line, where the project's rules now live.

- [ ] **Step 1: Write the failing tests.**

```js
test('the request lists every line to bring into line, and none of the project\'s rules are dropped from it', ...)
test('no documents to align gives no request', ...)
```

- [ ] **Step 2: Run, expect FAIL; implement; run `npm test`, expect PASS.**
- [ ] **Step 3: Commit.**

```bash
git add scripts skills tests
git commit -m "Hand the project's own documents to its own loop to bring them into line"
```

---

## Part 4: trying it, the switch-over, and the handover

### Task 11: End to end, and the rehearsal (check 51)

**Files:**
- Create: `tests/e2e/install.test.js`, `probes/51-rehearsal/run.js`, `docs/checks/51-rehearsal.md`
- Modify: `docs/checks/README.md`

- [ ] **Step 1: Write the end-to-end tests,** with a scratch home and `WHEELHOUSE_HOME`, the fixture project, the stand-in host, a real helper and the hooks' `decide` functions called as Claude Code would:

```js
test('the fixture project: one install click, every step applied, the first version off, the check green', ...)
test('an open pull request is carried on through the intake and the old one closed', ...)
test('switch back by card, then switch over by hand, and both reach state', ...)
test('a week switched back for two days is not measured', ...)
test('the copies\' request after the last computer is ready, and retiring on the verdict', ...)
test('nothing of the first version is deleted at any point', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: PASS, the whole suite. Report the count.
- [ ] **Step 3: The rehearsal (agent, Mac),** after its card (one approval; a trust-folder click when Desktop first opens the scratch folder). The question: *On a real host and in Desktop, does the switch-over work end to end on a made-up project with a made-up first version, and after switching back does the first version's own way of working (opening and merging a pull request with the director's sign-in) work again?* `probes/51-rehearsal/run.js` makes a throwaway private repository on the director's host account from the fixture project, clones it under `~/Projects` (a folder name with a space), and writes its brief. The agent then opens a Desktop session on it (`start_session`), where the install card is asked, and the director clicks **Install**: an agent's answer is never an approval (scenario 19), even on a throwaway project. Then, by the agent: the install check; a request through the front desk built to a merge; the switch-back card, which the director clicks; a `claude -p` session in the folder, with the made-up first version's skill, asked to open and merge a pull request with `gh` as the first version did, which must succeed; the switch-to-Wheelhouse file; `/wheelhouse:uninstall`, whose card the director clicks; the repository deleted (`gh api` answering 404 checked) and the folder removed.
- [ ] **Step 4: Write the note,** add its row, run `npm test` and `npm run private-check`, commit.

```bash
git add tests/e2e probes/51-rehearsal docs/checks
git commit -m "Try the switch-over end to end, and rehearse it on a throwaway repository: check 51"
```

### Task 12: The switch-over (agent, Mac)

- [ ] **Step 1: Card to the director:** what the switch-over does, in plain words (Wheelhouse takes all work on the first project; the first version switched off on this Mac, not deleted; how to switch back), what they'll be asked for (their password if Locked or an installer needs it, a trust-folder click if Desktop asks, a Desktop restart if telemetry's route needs one), about 10 minutes; **Switch over now**, **Not now**. Approved by their click.
- [ ] **Step 2: Refresh the brief (agent):** `cli.js survey` again, update `brief.json`'s in-flight part, `cli.js brief`, `npm run private-check`.
- [ ] **Step 3: Install (agent):** step 1 by check 37's route; open a Desktop session on the project's folder (`start_session`); the session start finds no project record and the playbook asks the install card. The director clicks **Install**; the agent watches `/setup/status` and says only what the director must do next (a password, a restart).
- [ ] **Step 4: Check and start (agent):** `cli.js check`; when green, the last steps of Task 7 run. When anything fails, fix it on this plan's branch, or bring it to the director as a card with **Switch back** as an option.
- [ ] **Step 5: Watch the first weeks** as the evaluation plan's Task 11 Steps 1 to 3 say, from this repository's own session, with `npm run private-check` before every commit.

### Task 13: The design and the handover

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md`, `HANDOVER.md`

- [ ] **Step 1: Bring the design up to date:** section 17.2 (the build order as the director changed it on 19 October 2026: every piece first, the rest of the mod before the evaluation, no small-feature pilot; step 5 as built: one install card, switched off not deleted, switching back, the copies, retiring for good), section 15 (the install card when a brief is there), section 18 (the measures from the switch-over; switched-back weeks), section 20 (checks 50 and 51), and section 3 (where a project's rules live). This plan's calls go into section 21, each marked *Designer's call*, and the director's answers to Cards 1 and 2 into section 22. Nothing names the first project.
- [ ] **Step 2: Update `HANDOVER.md`:** the switch-over done, what the checks and the rehearsal found, how to switch back, and the next step (the first public release, proposed once the measures are met for two weeks).
- [ ] **Step 3: Run `npm test` and `npm run private-check`.** Expected: PASS.
- [ ] **Step 4: Commit.**

```bash
git add docs HANDOVER.md
git commit -m "Record the switch-over in the design, and update the handover"
```

## Plan's calls

Settled here without the director, each listed for the design in Task 13:

1. **When it starts:** once every earlier plan has merged and the evaluation's whole run has passed; the check, the brief and the private-words check can start now.
2. **Everything specific to the project stays outside this repository,** in the private install brief, and a check over the repository's files and recent commit messages keeps it out.
3. **One approval click for setup on the first project:** the install card holds every step's list and the brief's answers, and each step still applies only against its own hash.
4. **The first version is switched off per computer, never deleted,** in the project's git-ignored local settings, by check 50's route; after two weeks of measures met it is moved, unchanged, into a folder Claude Code doesn't load, through the project's own loop.
5. **Switching back means the project as it ran before the switch-over, on this computer:** the first version and the project's copies on, Wheelhouse and the sandbox off for that project only; on a Locked project, the password first.
6. **Two routes back:** a card while Wheelhouse runs, let through under STOP; a double-click file when it doesn't, which is the director's own action and is not signed.
7. **Work in flight is carried on, not merged as it is:** open pull requests go to the intake, worktrees are left alone.
8. **The duplicate copies are switched off with the first version,** and removed by the project's own loop once every computer the director uses for it is ready.
9. **A week switched back for more than a day isn't measured,** as with STOP.
10. **The rehearsal uses a made-up project** in a throwaway repository on the real host.
11. **Plugins per project come from the brief:** the agent marks which of the director's plugins and personal skills the project's work uses; the rest are off in its committed settings, listed on the install card with why.

## Builder check

Read on 19 October 2026 as the builder would, against design section 17.2 and the setup, evaluation, build-loop, safety and front-desk plans it calls. Nothing new needed the director beyond Cards 1 and 2. These were settled in place, each marked *Reviewer's call*, and go into the design with the plan's calls in Task 13:

1. **The brief's folder** is named for the project's folder and a short hash of its full path, so two projects with the same folder name never share one.
2. **The private-words check reads the commits not yet pushed,** not the last fifty: a pushed commit can't be changed, and the public history starts afresh (design section 16). A common word would stop every commit, so the list holds only names.
3. **The install card has four options,** as every decision card does: **Install**, **Not now**, **Explain more**, **Show me**. A change is typed, and sends that one step to setup's own card.
4. **The rules found carry ids made from their words and source,** so one click can confirm rulings that step 5 records only afterwards.
5. **Switching back stops the project's watcher and foreman,** and switching over again starts them; otherwise the foreman would go on waking feature sessions in a project that has switched back. Locked is left for this project only.
6. **Scheduled tasks of the first version** are paused by the agent in the sitting, since only a session can, and resumed on switching back by card.
7. **The install check runs the Desktop app's own copy of Claude Code,** as check 24 did, so it doesn't depend on the command line's sign-in; and it names a session left open from before the switch-over, which would still hold the first version.
8. **"Confirmed working" means a week of use,** not only a passing check, before the copies are removed.
9. **Two changes to the evaluation plan** beyond the director's decision: `ready`'s Card 1 line is dropped, and setup time is read from check 19's timed runs, not from the first project's one-card install.
10. **Phone notifications** already tried on this Mac skip the screen-lock test in the sitting; the briefing asks about them later.
11. **The evaluation plan's "pilot" names stay,** meaning the measured weeks.
12. **Work in flight** is carried on through the intake and never merged as it is; worktrees are left alone.

## Order

Part 1 first: Task 1 by the agent after the card before Part 1, Task 2's code at any time, and its Step 4 after Task 1. Tasks 3 to 7 need every earlier plan merged, and come in order. Task 8 needs the evaluation plan's Task 9; Task 9 needs Tasks 7 and 8; Task 10 needs Task 4. Task 11 needs Tasks 2 to 10; Task 12 needs Task 11 and Cards 1 and 2; Task 13 is last.

## The director's sittings

Agents do every step they can (the director's standing rule, 18 October 2026). Each sitting opens with one card listing every change it makes and how each is undone, approved by the director's click.

| Sitting | Computer | Tasks | The director's part | About |
|---|---|---|---|---|
| 1 | Mac | 11, Step 3 (the rehearsal) | the approval click, a trust-folder click, then three clicks on the throwaway project's own cards (**Install**, **Switch back**, the uninstall card) | 10 min |
| 2 | Mac | 12 (the switch-over) | the approval click, **Install**, the password if Locked or an installer asks, a Desktop restart if telemetry's route needs one; with the narrow connection on GitHub, the app's sign-in page (**Authorise** and the repository ticks), which only the director can do | 10 min |

Check 50 runs on the Mac with no one at it, after the card before Part 1. On Windows, only if Card 2 names a Windows computer: check 50's Step 3 and setup's second-computer steps there, when one with a host sign-in is available.

## After this plan

The next step in the design's build order (section 17.2) is the first public release, proposed to the director once the measures have been met for two weeks.
