<!-- docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md -->

# Wheelhouse on GitHub Copilot: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Wheelhouse with GitHub Copilot, through one shared core and a small agent adapter per agent, in three tiers (Lean, Middle and Full) and with an optional VS Code add-on, changing nothing for Claude Code users.

**Architecture:** The guards, the helper, the gate, state, the watcher and the board stay one core. A new seam, `scripts/agents/`, picks an adapter by name; each adapter (`adapters/claude-code/`, `adapters/copilot/`) holds the ten parts of design section 8.1. The guards keep reading the hook input shape they read today (Claude Code's), so Claude Code's adapter passes it through untouched and Copilot's translates into it and back. On Copilot no hook signs anything: records that bind come from the helper (its own window, its clean review session, its merges) or the add-on, and the code host's own lock stands behind the everyday chat click.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies, for every script and test. Copilot CLI and VS Code's Copilot harness as the agent. GitLab Enterprise Edition in a Docker container on the Mac for the GitLab checks and recorded responses. The VS Code add-on is plain JavaScript with no build step.

**Spec:** `docs/specs/2026-10-20-other-agents-design.md` (approved by the director on 21 October 2026), all of it, with sections 6.4, 8, 12 and 14 first. Read with the main design (`docs/specs/2026-10-17-wheelhouse-design.md`, sections 9, 11, 12, 15 and 17.1) and the build-loop design (`docs/specs/2026-10-18-build-loop-design.md`, sections 2, 11 and 14). Research: `docs/research/copilot-vscode-2026-10.md` and `docs/research/copilot-cli-and-standards-2026-10.md`.

## Scope

Every piece of the spec, in its section 14 order: the checks that need no sitting, the seam with Claude Code as the first adapter, Lean, Middle on GitLab on a company's own servers, Full, and the add-on. The VS Code Claude-harness route (spec section 7, option B) is built last, and only if its check passes, since nothing in the Copilot route leans on it (the director's decision of 20 October 2026).

Not in this plan: Codex, Cursor and Gemini CLI (spec section 10), Azure DevOps and Bitbucket (section 8.10), Claude Code adopting the host controls, audit report or sign-in start (section 12, "still open"), budget allocation (in the backlog), and publishing the add-on to the VS Code Marketplace, which needs a publisher account and so the director, after this plan.

## How each part runs

- **One part per fresh session.** A part session runs its tasks subagent-driven, writes its ledger lines, leaves a handover note in the shared notes folder for the next part, commits on its branch and stops. The main session clears it and sends the next go (the director's rule for builds).
- **Task model.** Every task is written to run on the everyday task model: files, names, test names and commands are spelled out.
- **Safety review.** A task marked **Safety: yes** touches the guards, the helper, STOP, signing, secrets or approvals. Its review is a safety review: the stronger review model at medium effort, never high. Which model is meant is set in the session notes, not here. Other tasks get the usual task review.
- **Ledger.** `.superpowers/sdd/2026-10-21-wheelhouse-copilot/progress.md` (git-ignored, on the Mac), one line per task and per ruling (R1 onwards), read first by every part session.
- **Merges** go through the main session with the director's yes. A part never pushes.
- **Held items** (the director's sittings and clicks) are listed at the end, not as tasks. A task that needs one stops at its marked step, records "Deferred, held for the director" in its check note, and the part carries on with what doesn't depend on it.

## Where this plan builds on built code

Everything named here is on `main` at c3604dd.

| What | Where |
|---|---|
| Hook entry and answers: `readInput`, `answer`, `hookMain({failClosed, event})`, `runAndExit`, `projectOf`, `isInside` | `scripts/hooks/kit.js` |
| The guards' `decide(input, deps)`: tool guard, STOP guard (`READ_TOOLS`, `HALT_TOOLS`, `NOTIFY_TOOLS`), STOP word, lineage hold, card check, prompt record (`earned`, `SIGNED_LABELS`), report check, session start (`MAX_CHARS`, `NO_HELPER`) | `scripts/hooks/*.js` |
| The hook registration | `hooks/hooks.json` |
| Starting sessions: `resolveClaude`, `invocation`, `quoteForCmd`, `withoutHostVariables` | `scripts/lib/claude.js`, used by `scripts/watcher/waker.js` and `scripts/foreman/start.js` |
| Settings: `projectSettings`, `localSettings`, `featureAllowRules`, `credentialRules`, `mergeSettings`, `writeSettings` | `scripts/protection/settings.js` |
| Locked on the Mac: managed copy and file | `scripts/protection/locked.js`, `scripts/protection/managed.js` |
| Guarded: `guarded`, `KEPT_NORMAL`, `keptNormalHeld`, `fetchesCode` | `scripts/windows/guarded.js` |
| Guardrails: `GUARDRAILS`, `CI_FILES`, `classifyChange`, `readConfig` | `scripts/gate/guardrails.js` |
| The gate: `gateDecision` | `scripts/gate/conditions.js` |
| State: `makeEvent`, `writeEvent`, `eventHash`, `PROTECTED_KINDS`; signing: `sign`, `verify`, `makeSigningKey`, `enrol` | `scripts/state/events.js`, `scripts/state/signing.js` |
| STOP: `stopState`, `setStop`, `liftStop` | `scripts/lib/stop.js` |
| The host: `detectHost(remoteUrl, {gitlabHosts})`, `makeAdapter`, `gitlabApi({baseUrl})`, `makeProjectKey`, `readGitlabProtection`, `protectGitlabBranch`, `tokenUrl`, `GITLAB_URL`, `gitlabKeyPage` | `scripts/host/` |
| Setup: `SIGN_UP`, the engine, `project-files.js` (`SETUP_FILES`, `projectFilesChange`) | `scripts/setup/` |
| The mod's pane model and presses: `status.js`, `press.js`, `buttons.js`, `digest.js` | `scripts/mod/` |
| The evaluation: `npm run eval`, `scripts/eval/harness.js` (`sessionEnv`, `parseStream`, `toolCalls`) | `scripts/eval/`, `tests/eval/` |
| Probes: `makeScratchProject`, `appendJsonl`, the hook logger | `probes/lib/` |
| The findings note format | `docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md`, "Findings note format", checked by `tests/docs/checks-format.test.js` |

## Decisions for the director

None blocks the build: every choice follows the spec, or is a plan's call listed at the end. Three things only the director can give are held items (end of this plan): signing Copilot CLI in on the Mac, a GitLab Premium trial licence, and the sittings. The licence comes to the director as a card, through the main session, before Part 2's Premium task. No licence came, so that task is Deferred and H3 stays held (see "What Parts 1 and 2 found").

## Global Constraints

Everything in the earlier plans' Global Constraints holds: Node.js 22 or later; no npm dependencies; ESM `.js`; `node:test` in `tests/**/*.test.js`; macOS and Windows; the path comment on every file (after front matter where a file has it); British or Australian English; dates as "21 October 2026"; no model identifiers anywhere (tests use made-up names such as `model-a`) and no `Co-Authored-By` line; secrets only in a child's environment, never in output or arguments; everything under `wheelhouseHome()`; times in UTC ISO 8601 with a `now` argument; child processes through `run`; hooks never running `git` in a folder an agent controls; guards failing closed and informing hooks failing open; every test with a home of its own and stand-ins for `gh`, `glab` and `copilot` first on the PATH, asserting none of the real ones ran (`tests/helpers/host-stand-ins.js`, extended to `copilot` in Part 1). In addition:

- **Nothing changes for Claude Code users.** At the end of every part, the whole `npm test` passes with no existing test edited except where a task names the edit and why. Part 3 ends with Claude Code's counted evaluation scenarios run again (spec section 8.3).
- **The core never names an agent.** Outside `adapters/`, `scripts/agents/`, `vscode/`, `probes/`, `tests/` and `docs/`, no new code names Copilot; `tests/scripts/agents/core-neutral.test.js` (Part 3) holds the list of files allowed to.
- **The design's numbers are constants, named once,** in `scripts/lib/copilot-numbers.js`: `GUARD_TIMEOUT_SEC = 120` (the hook's `timeoutSec`), `GUARD_DEADLINE_MS = 30000` (every guard answers within it or refuses), `TIERS = ['lean', 'middle', 'full']`, `LEVELS = ['sandbox', 'guarded', 'ask', 'unattended']`, `PROOFS = ['chat-click', 'hook-click', 'policy-hook', 'window', 'add-on', 'host', 'signed-hook']` (`signed-hook` is Claude Code's existing record), `REVIEW_KINDS = ['chat-review', 'clean-session', 'subagent']`, `ACTIVITY_DAYS = 30`, `CONFIRMED_STEPS = ['lift-stop', 'guardrail-change', 'unattended', 'runbook-step', 'ci-push']`, `LEAN_RECORD_DIR = '.wheelhouse/record'`, `BOARD_FILE = 'wheelhouse/board.md'`, `HOOK_FILE = 'wheelhouse.json'` (in the person's Copilot hook folder).
- **On Copilot, no hook signs.** A Copilot-mode hook never reads `keysDir()` and never writes under `wheelhouseHome()`; every write goes through the helper. A test in Part 5 runs each hook in Copilot mode with the keys folder unreadable and the home read-only.
- **Every record of a click names its proof** (one of `PROOFS`). The gate and the audit report read it; the board says what each proof means in plain words.
- **Plain words.** Every line the director sees follows the earlier plans' card rules and the glossary (`plainWords`). The safety lines are the spec's own words (section 6.6), kept in one module.
- **Checks take the next free numbers:** C*n* is check 53 + *n* (C1 is 54, C19 is 72), set out below.
- **Each probe undoes what it made** (scratch folders, containers, test users, tokens) and its note lists the undo.

## Review Focus

The five inputs most likely to bite a person that no task's main tests reach; each line names the task that adds its test.

1. **A Copilot update renames or adds a tool.** Expected: the guard refuses it with `UNKNOWN_TOOL` ("Copilot has a tool Wheelhouse doesn't know yet, `<name>`; it is refused until Wheelhouse is updated"), never lets it through, and the board's health line says a Copilot update is waiting on Wheelhouse. The known names are the union of those seen in checks 58, 63 and 66, not any one table (checks 58, 63, 66). Test: `an unknown tool such as apply_patch_v2 is refused with UNKNOWN_TOOL` (Part 5, Task 1).
2. **The helper isn't running when a Copilot hook fires** (VS Code opened before sign-in, or a work computer with no start-up entry). Expected: writes, pushes, merges and new agents refused as under STOP; reading carries on; the STOP word answers that the helper isn't running and how to start it. Test: `with no helper a Copilot write is refused and a read is let through` (Part 5, Task 3).
3. **A company GitLab behind its own certificate authority, and off the VPN.** Expected: certificates come from the system's store, never "don't check"; an unreachable server is one board line and local work carries on. Test: `no route ever sets GIT_SSL_NO_VERIFY, NODE_TLS_REJECT_UNAUTHORIZED=0, sslVerify false or -k` and `an unreachable host gives HOST_UNREACHABLE and keeps the push for later` (Part 6, Task 2).
4. **Two VS Code windows on one Lean project.** Expected: one merge at a time; the second waits up to its limit, then says the other window is merging. Test: `two merges at once run one after the other` (Part 5, Task 5).
5. **A Windows home folder with a space or an apostrophe** (`C:\Users\Ann O'Neil`), and Copilot's `.cmd` shim. Expected: the hook registration and every session's command line quote it so the right file runs. Test: `registration quotes a home folder with a space and an apostrophe` (Part 5, Task 2) and `a .cmd shim is called through quoteForCmd` (Part 7, Task 1).

## Check numbers

| Spec | Check | Name | Run by | Part |
|---|---|---|---|---|
| C1 | 54 | VS Code's Claude harness | the director (Mac and Windows) | held; Part 11 |
| C2 | 55 | What an add-on's contributions reach | the director | held; Part 10 |
| C3 | 56 | Registration: what Copilot loads, and twice | agent (CLI, Mac); the director (Windows) | 1 |
| C4 | 57 | Copilot's sandbox | the director (Mac and Windows) | held; Part 9 |
| C5 | 58 | The guards' input | agent (CLI, Mac); the director (VS Code, Windows) | 1 |
| C6 | 59 | Clickable questions: whose answer | the director (Mac and Windows) | held; Parts 5 and 9 |
| C7 | 60 | The other hooks | agent | 1 |
| C8 | 61 | Sessions from a script | agent (Mac); the director (Windows) | 1 |
| C9 | 62 | Setup's tools on Windows, and the timed run | the director (Windows) | held; Part 11 |
| C10 | 63 | Superpowers and Matt Pocock's skills on Copilot | agent | 1 |
| C11 | 64 | Usage figures | agent | 1 |
| C12 | 65 | The phone | the director | held; Part 10 |
| C13 | 66 | A clean reviewer session | agent | 1 |
| C14 | 67 | The pane's place | the director | held; Part 10 |
| C15 | 68 | An approval on the host | agent (GitLab routes); the director (own approval, GitHub) | 2; held |
| C16 | 69 | Lean's guards without Node.js | agent (Mac); the director (Windows) | 1 |
| C17 | 70 | Lean in VS Code with nothing added | the director (Mac and Windows) | held; after Part 5 |
| C18 | 71 | GitLab on the company's own servers | agent (test instance) | 2 |
| C19 | 72 | The add-on at Lean | the director (Windows) | held; Part 10 |

Part 1 adds a row to `docs/checks/README.md` for each, "Not run yet", and each check's task replaces its row.

## What Parts 1 and 2 found

Parts 1 and 2 ran checks 56, 58, 60, 61, 63, 64, 66, 69 and 71 (68 is Deferred). Each entry gives the answer and the tasks it changed; the change itself is marked with the check's number in the task. The notes in `docs/checks/` are the authority.

- **Check 56, registration: Yes.** Register once, in the person's hook folder (`$COPILOT_HOME/hooks/wheelhouse.json`): it ran once per event in a main folder, a worktree and a folder with no `.git`, trusted or not. A project file holding `disableAllHooks: true` switched off nothing. Project files load only in a trusted folder, so Wheelhouse's sessions never use `--trust-folder`. Changes: Part 5 Task 2, Part 7 Tasks 1 and 4, Part 8 Task 1.
- **Check 58, the guards' input: Partly.** A guard gets the tool's name and arguments, the session id and the folder; nothing of the mode, a sandbox or the version. A deny answer, exit 1 and exit 2 each stop the call; a hook that outlasts `timeoutSec` is let through. File changes arrive as `apply_patch` (a patch string), searches as `rg`; `ask_user` and PowerShell were not seen. Register under camelCase only. Changes: Part 3 Task 1, Part 4 Task 1, Part 5 Tasks 1 and 2, Part 8 Task 2.
- **Check 60, the other hooks: Partly.** `sessionStart` and `userPromptSubmitted` (camelCase, in the person's folder) can add text the agent reads through `additionalContext`; `subagentStop` names the agent. `preCompact` fires on `/compact` but cannot block. Changes: Part 5 Tasks 2 and 3.
- **Check 61, sessions from a script: Yes, with two gaps.** The flags, the id from the last `result` event, resume by id, and refusals are known. A command no rule allows is refused at once; chained forms were refused against a `shell(<runner>:*)` rule; a clean environment with the session's own home ignores `COPILOT_ALLOW_ALL`. Gaps: saved permissions headless, and file-tool writes, were not tried. The session's own home needs Wheelhouse's hook file. Changes: Part 7 Tasks 1 to 4.
- **Check 63, the kits: Yes, with two gaps.** All five loops ran with the override first, under `--allow-all-tools`. Sub-agent dispatch is `task` and needs a `name`; reviews went to Copilot's own `code-review` agent. Changes: Part 4 Task 1 (tool sheet), Part 5 Task 1 (tool names), Part 8 Task 2.
- **Check 64, usage: Deferred.** Per-session figures exist (usage file, checkpoint event, `result` event). The month's total is not reachable with this sign-in. Changes: Part 7 Task 1, Part 8 Task 2.
- **Check 66, a clean reviewer session: Yes, on one route.** Only route b (a fresh folder with named files and the diff, a home holding only the reviewer, no trust) is clean; a clean home in the checkout is not, and a trusted folder leaks hooks and servers. Changes: Part 4 Task 2, Part 5 Task 1, Part 7 Task 5, Plan's call 7.
- **Check 69, Lean's guards without Node.js: Yes, on the Mac.** A `/bin/sh` guard using `curl` runs, refuses on deny and on no answer. A web hook was obeyed at `127.0.0.1` and refused with the server down, both against the documentation, so none is built on. The Windows half (PowerShell 5.1) is sitting S2. Changes: Part 4 Tasks 1, 3 and 5, Part 5 (a new Task 8).
- **Check 71, GitLab on a company's servers, at Free: Partly.** Every step ran. A commit status posted with the project key can stand in for a pipeline that never ran. A host address with a port cannot be named in `gitlabHosts`. Three error texts read wrongly. `--use-system-ca` with the authority in the store was not run. Changes: Part 6 Tasks 1, 2, 3, 4 and 5, Part 9 Tasks 5 and 7.
- **Check 71, Premium's half, and check 68, an approval on the host (GitLab routes): Deferred, held for the director (H3).** No licence came. Part 2 Task 3 did not run. Part 9 Task 5 builds the Premium route from GitLab's documentation behind `hostApprovalReady`, which stays false for Premium until the check passes; its Premium fixtures are written from the documentation and named as such. Check 68's GitHub half stays with sitting S4.

## File structure

```
scripts/lib/copilot-numbers.js            the numbers above
scripts/agents/contract.js                the adapter's ten parts, and checkAdapter
scripts/agents/index.js                   adapterFor, agentOfInput, agentOfProject, AGENTS
adapters/claude-code/                     index.js, answers.js, tools.js, sessions.js, settings.js, hooks.js, tool-sheet.md, safety-line.js
adapters/copilot/                         index.js, translate.js, tools.js, hooks.js, sessions.js, permissions.js, settings.js,
                                          sandbox.js, tool-sheet.md, safety-line.js, eval-runner.js
adapters/copilot/home/                    the Lean kit as copied into ~/.copilot/: skills/, agents/, instructions/, hooks/ (from Part 5 Task 8: the hook file and the guard), MANIFEST.txt
adapters/copilot/plugin/                  com.github.copilot/ (the Copilot-only parts; no hooks)
plugin.json                               the root Agent Plugins manifest, beside .claude-plugin/
scripts/agents/copilot/                   home.js (builds the Lean kit), tier.js, facts.js, versions.js, start-helper.js, sandbox-test.js
scripts/hooks/copilot-entry.js            the one Node.js start per Copilot hook call, running the guards in order
adapters/copilot/lean-guard.sh            Lean's shell guard for a Mac with no Node.js (Part 5 Task 8)
adapters/copilot/lean-hooks.js            builds the Lean hook file, at kit-build time (Part 5 Task 8)
scripts/confirm/window.js                 the helper's own window
scripts/lean/store.js                     the git store outside the project, merges with hooks off, undo, the copy
scripts/lib/login-start.js                the sign-in start (launch agent, per-user start-up entry)
scripts/state/lean-record.js              Lean's record files, and their move up to state
scripts/host/company-ca.js                the company's certificate for Node.js, glab and git
scripts/audit/report.js                   the audit report, checked against the host's own history
scripts/review/clean-session.js           the clean checkout, the prompt from trusted state, the verdict
scripts/watcher/control-files.js          agent-control files read directly before every wake
scripts/health/own-files.js               changes to Wheelhouse's and Copilot's own files
adapters/copilot/skills/lean/SKILL.md           Lean's playbook, with no Node.js
adapters/copilot/skills/setup-lean/SKILL.md     setup from one request in the chat, with git alone
docs/copilot/                             tested-versions.md, it-note.md, baseline/ (managed settings, policy hooks)
vscode/                                   the add-on: package.json, extension.cjs, pane/, README.md
scripts/addon/                            validate.js (the static proof), pack.js (the .vsix)
probes/54-…/ to probes/72-…/              the checks' probes; probes/lib/copilot.js, probes/lib/gitlab-ee.js
tests/fixtures/copilot/                   recorded hook inputs, session output, refusals (scrubbed)
tests/fixtures/gitlab-ee/                 recorded GitLab responses, Free and Premium (scrubbed)
tests/scripts/agents/copilot-lean-guard.test.js   the shell guard's tests (Part 5 Task 8)
tests/e2e/copilot-lean.test.js, copilot-middle.test.js, copilot-full.test.js, addon.test.js
tests/eval/copilot/                       the four Copilot scenarios
```

## Findings note format

As the checks plan set it. Each note's "What it means for the design" names the later task it changes, and the task's **If the answer differs** paragraph says what happens then.

---

## Part 1: the checks on Copilot CLI, on the Mac

Agents run all of it. It needs held item H1 (Copilot CLI signed in) before Task 2. Its answers may change Parts 3 to 8; they go to the director only if they change what the director sees.

### Task 1: Copilot CLI for probes, and the check rows

**Safety: no**

**Files:**
- Create: `probes/lib/copilot.js`, `scripts/lib/copilot-numbers.js`, `tests/probes/copilot-lib.test.js`
- Modify: `docs/checks/README.md` (rows 54 to 72, "Not run yet"), `tests/helpers/host-stand-ins.js` (a `copilot` stand-in beside `gh` and `glab`)

**Interfaces:**
- Produces: `COPILOT_VERSION` (the version installed for the probes, recorded when this task runs); `installCopilot({ version, prefix }) -> { bin }`, which runs `npm install --prefix <prefix> @github/copilot@<version>` into `~/.wheelhouse-probes/copilot/<version>/` and never globally; `copilotBin(prefix) -> string`; `scratchCopilotHome() -> { dir, remove }` (an empty folder for `COPILOT_HOME`); `runCopilot({ args, cwd, env, home, timeoutMs }) -> { code, stdout, stderr, events }`, where `events` parses JSON lines when the output is JSON and is `[]` otherwise; `signedIn({ home }) -> boolean`.
- Produces: the constants of Global Constraints, in `scripts/lib/copilot-numbers.js`.

- [ ] **Step 1: Write the failing tests** with a stand-in `copilot` script on the PATH.

```js
test('installCopilot installs under the probes folder, never with -g', ...)
test('runCopilot passes COPILOT_HOME and never the caller\'s GITHUB_TOKEN', ...)
test('runCopilot parses JSON lines into events and leaves plain text as stdout', ...)
test('runCopilot stops the child at timeoutMs and says so', ...)
test('the copilot stand-in is first on the PATH in every test home', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the module, the constants and the stand-in; add the README rows.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Install for real (agent, Mac).** Run `installCopilot` at the newest release on npm, record the version in the ledger, then `signedIn({ home: scratchCopilotHome().dir })`. If it says no, stop here and raise held item H1; Tasks 2 to 9 wait for it.
- [ ] **Step 6: Commit.**

```bash
git add probes/lib/copilot.js scripts/lib/copilot-numbers.js tests docs/checks/README.md
git commit -m "Add the Copilot probe kit and the numbers for checks 54 to 72"
```

### Task 2: Check 56, registration (C3), on the CLI

**Safety: no**

**Files:**
- Create: `probes/56-registration/run.js`, `probes/56-registration/plugin/` (a root `plugin.json`, a `.claude-plugin/plugin.json`, `hooks/hooks.json`, and `com.github.copilot/`), `docs/checks/56-registration.md`
- Modify: `docs/checks/README.md`

**Interfaces:**
- Consumes: `runCopilot`, `scratchCopilotHome`, `makeScratchProject`, the hook logger (`probes/lib/hook-logger.js`).
- Produces, in the note, for Part 5 Task 2 and Part 8 Task 1: which of the root `plugin.json` and `.claude-plugin/` Copilot reads first and whether it reads both; whether plugin hooks, the project's `.claude/settings.json` hooks, `.github/hooks/*.json` and `$COPILOT_HOME/hooks/*.json` each load, in a main folder, a git worktree and a folder with no `.git`; which load twice; and what a project hook file holding `disableAllHooks: true` does to the person's hooks.

The question: *Where should Wheelhouse register its Copilot hooks so that they run once, in every folder a Wheelhouse session runs in, and can't be switched off by a project file?*

- [ ] **Step 1: Write the probe.** Every hook in every place is the same logger with a different `tag` (`plugin`, `claude-settings`, `github-hooks`, `home-hooks`), on `sessionStart` and `preToolUse`. Three folders: a scratch project, a worktree of it (`git worktree add`), and a plain copy with no `.git`. The plugin is installed into the scratch `COPILOT_HOME` with `copilot plugin install <path>`.
- [ ] **Step 2: Run (agent, Mac).** In each folder, `copilot -p "Read README.md and say done" --allow-tool 'view'` with the scratch home; then again with a project `.github/hooks/off.json` holding `{ "disableAllHooks": true }`. Record each tag's count per event per folder.
- [ ] **Step 3: Undo** the scratch home, project and worktree.
- [ ] **Step 4: Write the note,** replace the row, run `npm test`, commit.

```bash
git add probes/56-registration docs/checks
git commit -m "Record check 56: where Copilot loads hooks from, and what loads twice"
```

**If the answer differs:** if the person's hook folder doesn't reach worktrees or plain folders, Part 5 Task 2 also writes the registration into each feature worktree's `.github/hooks/` through the helper, and the guardrail list already shuts that folder to agents. If `disableAllHooks` in a project switches off the person's hooks, the watcher's control-file check (Part 7 Task 4) is the only hold for background sessions, and the front desk says so for the chat; record it as a plan's ruling.

### Task 3: Check 58, the guards' input (C5), on the CLI

**Safety: no**

**Files:**
- Create: `probes/58-hook-input/run.js`, `docs/checks/58-hook-input.md`, `tests/fixtures/copilot/hook-input/<event>-<tool>.json` (one per tool and event seen, home paths replaced by `<HOME>`, ids by `<ID>`)
- Modify: `docs/checks/README.md`

**Interfaces:**
- Produces, for Part 5 Task 1: the fixtures; the note's table of every tool name seen with its argument names (shell, PowerShell where `pwsh` is present, view, edit, create, grep, glob, web fetch, `task`, `ask_user`, an MCP tool from a stand-in server); whether camelCase registration (`preToolUse`) and PascalCase registration (`PreToolUse`) give different payloads (the research says PascalCase gives Claude Code's names, `tool_name` and `tool_input`); whether the input says the permission mode, whether the session or the command is sandboxed, and the runtime's version; what a deny answer, a non-zero exit and an exit 2 each do; and what happens to a hook that sleeps past `timeoutSec`.

The question: *What a Copilot guard is given and how its answer lands, for every tool.*

- [ ] **Step 1: Write the probe:** a logger hook registered both ways in the scratch home's hook folder, a stand-in MCP server (`probes/58-hook-input/mcp.js`, one tool `echo`), and prompts that make the session use each tool once.
- [ ] **Step 2: Run (agent, Mac),** then three more runs: the logger answering `deny` for `view`, exiting 1, and sleeping for `timeoutSec + 5` with `timeoutSec: 5`. Record whether each call went through.
- [ ] **Step 3: Undo, write the note and the fixtures,** run `npm test`, commit.

```bash
git add probes/58-hook-input docs/checks tests/fixtures/copilot
git commit -m "Record check 58: what Copilot gives a guard, and how its answer lands"
```

**If the answer differs:** if PascalCase registration gives Claude Code's payload and tool names in full, Part 5 Task 1's translation keeps only the answer's shape and the tool-name list, and says so. If a hook that times out is refused rather than let through, the board's Copilot line drops its time-out sentence (Part 4 Task 1 holds the line).

### Task 4: Check 60, the other hooks (C7)

**Safety: no**

**Files:** Create `probes/60-other-hooks/run.js`, `docs/checks/60-other-hooks.md`; modify `docs/checks/README.md`.

**Interfaces:**
- Produces, for Part 5 Task 3 and Part 4 Task 3: whether `sessionStart` and `userPromptSubmitted` answers can add text the agent reads (and under which field), whether `preCompact` can block, and whether `subagentStop` names the agent that stopped.

- [ ] **Step 1: Probe:** hooks answering with a marker sentence through each documented field (`additionalContext`, and the PascalCase forms); a prompt asking the agent to repeat any marker it was given; a long session forced to compact with `/compact`; a `task` call to a custom agent named `probe-agent`.
- [ ] **Step 2: Run (agent, Mac),** undo, write the note, run `npm test`, commit (`"Record check 60: what Copilot's other hooks can do"`).

**If the answer differs:** if `userPromptSubmitted` can't add text, the STOP word's reply and the briefing come from the front desk's own skill (`wheelhouse-briefing`), as `/digest` does without the mod; Part 5 Task 3 leaves the STOP word's text to the helper's answer, which the playbook tells the front desk to read.

### Task 5: Check 61, sessions from a script (C8), on the Mac

**Safety: no**

**Files:** Create `probes/61-sessions/run.js`, `docs/checks/61-sessions.md`, `tests/fixtures/copilot/sessions/` (recorded output: a finished run, a resumed run, a refusal); modify `docs/checks/README.md`.

**Interfaces:**
- Produces, for Part 7 Tasks 1 and 2: the exact flags for headless, resume by id (and where the id comes from), a custom agent, no asking, allow and deny lists, and JSON output; the shape of a refusal in the output; whether a command no rule allows is refused at once rather than asked; whether `--allow-tool 'shell(<runner>:*)'` refuses `<runner> x && rm y`, `<runner> $(rm y)` and `sh -c 'rm y'`; whether a session with its own `COPILOT_HOME` and an environment holding only `PATH`, `HOME`, `TMPDIR` and `LANG` ignores the person's saved permissions and an allow-everything variable; whether Copilot's path rules hold its own file tools to the worktree with the temporary folder shut off, including through a folder link in the worktree that points out of it.

- [ ] **Step 1: Probe:** a scratch project with a worktree, a link `out -> ~/Documents`, and a scratch home holding a saved "allow all" permission; one run per question above.
- [ ] **Step 2: Run (agent, Mac),** undo, write the note and fixtures, run `npm test`, commit (`"Record check 61: starting and resuming Copilot sessions from a script"`).

**If the answer differs:** if a chained command gets past a shell rule, Guarded and Ask on Copilot rest on the runner and the guard, not the rule: Part 7 Task 2 then allows no shell tool at Guarded and gives the session the runner as an MCP tool instead (plan's ruling, recorded in the ledger). If the person's saved permissions leak into a session with its own home, background builders stay off on Copilot until a way is found, and Middle builds in the chat.

### Task 6: Check 63, Superpowers and Matt Pocock's skills on Copilot (C10)

**Safety: no**

**Files:** Create `probes/63-kits/run.js`, `docs/checks/63-kits.md`; modify `docs/checks/README.md`.

**Interfaces:**
- Consumes: the pinned kits' versions from `lineage/manifest.json`; the override (`skills/foreman/` brief's override text).
- Produces, for Part 8 Task 2: whether brainstorming, writing-plans, subagent-driven development, executing-plans and test-driven development run under Copilot as designed with the override first, and where each breaks (most likely the subagent dispatch, which names Claude Code's tools).

- [ ] **Step 1: Probe:** the kits copied at their pinned commits into a scratch home's `skills/`, a toy feature brief ("add a `--version` flag to a 20-line Node.js script"), the override first in the prompt.
- [ ] **Step 2: Run (agent, Mac)** one full small-lane loop; record each skill's hand-off and every tool call.
- [ ] **Step 3: Undo, note, `npm test`, commit** (`"Record check 63: the pinned kits under Copilot"`).

**If the answer differs:** the kits are never edited. Where a loop breaks only on a tool's name, the Copilot tool sheet (Part 4 Task 1) gains a line naming Copilot's equivalent. Where it breaks otherwise, background builders on Copilot use Wheelhouse's own builder and reviewer agents without the kits' loops, and the board's Copilot line says so.

### Task 7: Check 64, usage figures (C11)

**Safety: no**

**Files:** Create `probes/64-usage/run.js`, `docs/checks/64-usage.md`; modify `docs/checks/README.md`.

**Interfaces:**
- Produces, for Part 8 Task 2: which credit and token fields a session's JSON output carries, and what GitHub's documented REST call for a person's Copilot credit use returns with the signed-in person's own token (read only).

- [ ] **Step 1: Run (agent, Mac)** two small sessions and read the output's fields; make the REST call once with `gh api`. Record fields, not amounts.
- [ ] **Step 2: Note, `npm test`, commit** (`"Record check 64: what Copilot tells Wheelhouse about usage"`).

**If the answer differs:** with no per-session figures, usage on Copilot shows the month's total only; with neither, the board says usage isn't available on Copilot, as at Lean.

### Task 8: Check 66, a clean reviewer session (C13)

**Safety: yes** (the signed review rests on it)

**Files:** Create `probes/66-clean-review/run.js`, `probes/66-clean-review/reviewer.agent.md`, `docs/checks/66-clean-review.md`, `tests/fixtures/copilot/review/`; modify `docs/checks/README.md`.

**Interfaces:**
- Produces, for Part 7 Task 5: the exact way (flags, a home holding only the reviewer agent, environment) to start a session that loads only Wheelhouse's reviewer and none of the folder's own `AGENTS.md`, `.github/copilot-instructions.md`, `.github/agents/`, `.github/hooks/`, `.mcp.json` or `.github/lsp.json`, nor the person's own; whether its tools can be held to reading and searching; and where its final answer sits in the output.

- [ ] **Step 1: Probe:** a checkout planted with one steering file of each kind, each telling the reviewer to answer "APPROVE: planted", and an `AGENTS.md` claiming to be the reviewer; a diff with one obvious bug.
- [ ] **Step 2: Run (agent, Mac)** with each candidate route; record which planted file reached the session (from its answer and the hook logger) and whether the bug was found.
- [ ] **Step 3: Undo, note, `npm test`, commit** (`"Record check 66: a reviewer session that loads only Wheelhouse's reviewer"`).

**If the answer differs:** until a route shuts every planted file out, Copilot merges nothing that needs a signed review (spec section 6.3): Part 7 Task 5 builds the session behind `REVIEW_SESSION_READY = false`, and the gate refuses such merges on Copilot with `NO_CLEAN_REVIEW`.

### Task 9: Check 69, Lean's guards without Node.js (C16), the Mac's part

**Safety: yes** (Lean's guards)

**Files:** Create `probes/69-guards-without-node/run.js`, `probes/69-guards-without-node/guard.sh`, `docs/checks/69-guards-without-node.md`; modify `docs/checks/README.md`.

**Interfaces:**
- Produces, for Part 4 Task 3 and the Windows sitting: whether a `preToolUse` command hook in `/bin/sh` (with `curl` to a local answer) runs, refuses on deny, and refuses when it gets no answer; and whether a Copilot web hook can call `http://127.0.0.1` or needs https.

- [ ] **Step 1: Probe** with Node.js removed from the session's PATH; the sh hook asks a stand-in local server and denies when the server is down.
- [ ] **Step 2: Run, undo, note, `npm test`, commit** (`"Record check 69: guards without Node.js, on the Mac"`).

**If the answer differs:** with no route on the Mac, Lean without Node.js has no Wheelhouse guards there, as the spec already says; the Windows half (PowerShell 5.1) is the director's sitting.

## Part 2: GitLab on a company's own servers, on a test instance

**Route, flagged:** nobody has a self-managed GitLab Enterprise Edition to test against. The cheapest honest route is GitLab's own `gitlab/gitlab-ee` image (it has an arm64 build) in Docker Desktop on this Mac, behind a throwaway certificate authority, so it stands in for a company's servers and their own certificate. With no licence it runs as Free. Premium needs a 30-day trial licence from GitLab, which only the director can request (held item H3); without it, Premium's half of checks 71 and 68 stays Deferred and Part 9 builds the Premium route from GitLab's documentation and recorded responses, behind a switch that stays off until the check passes. The gitlab.com trial is the fallback the card offers.

### Task 1: The test instance

**Safety: no**

**Files:**
- Create: `probes/lib/gitlab-ee.js`, `probes/lib/test-ca.js`, `tests/probes/gitlab-ee-lib.test.js`
- Modify: `.gitignore` (`probes/**/state/`)

**Interfaces:**
- Produces: `GITLAB_EE_TAG` (pinned when this task runs); `makeTestCa(dir) -> { caPem, certPem, keyPem }` with `openssl`, a certificate for `localhost` signed by a throwaway authority of its own, so that every tool rejects it until told about that authority, as with a company's own; `startGitlab({ dir, port = 8929 }) -> { baseUrl, rootToken, rootTokenFile, caFile }` (`rootToken` is the path of the token file, not the token), which runs the image with `external_url 'https://localhost:<port>'` and the certificate, waits until `/-/readiness` answers, and makes the root's token with `gitlab-rails runner` through `docker exec`, kept in `<dir>/state/root-token` (mode 600) and never printed; `startRunner({ dir, baseUrl, token })` (`token` is that file path; a `gitlab/gitlab-runner` container with the shell executor); `apiFor({ baseUrl, caFile, tokenFile })` (the `api` the calls below take), `makeTestPeople(api, { dir }) -> { maintainer, second }` (two users with generated passwords kept like the token); `stopGitlab({ dir, remove = true })`.

- [ ] **Step 1: Write the failing tests** with a stand-in `docker` on the PATH.

```js
test('startGitlab never writes /etc/hosts and never passes the root token as an argument', ...)
test('the root token file is mode 600 and inside the probe\'s state folder', ...)
test('stopGitlab removes the containers and their volumes', ...)
test('makeTestCa makes a certificate for localhost signed by its own authority, which Node.js rejects without it', ...)
```

- [ ] **Step 2: Run `npm test`:** FAIL. **Step 3: Implement.** **Step 4: Run `npm test`:** PASS.
- [ ] **Step 5: Start it for real (agent, Mac).** `open -a Docker`, wait for `docker info`; if Docker Desktop asks for a click on first start, raise held item H2. Start the instance and the runner; record start time and memory in the ledger. Leave it running for Tasks 2 and 3.
- [ ] **Step 6: Commit** (`"Add a GitLab EE test instance for the GitLab checks"`).

### Task 2: Check 71 at Free (C18)

**Safety: yes** (keys, protection and secrets)

**Files:** Create `probes/71-gitlab-self-managed/run.js`, `docs/checks/71-gitlab-self-managed.md`, `tests/fixtures/gitlab-ee/free/` (each response scrubbed of tokens and ids); modify `docs/checks/README.md`.

**Interfaces:**
- Consumes: `startGitlab`, `makeTestPeople`, `gitlabApi({ baseUrl })`, `makeProjectKey`, `readGitlabProtection`, `protectGitlabBranch`.
- Produces, for Part 6 Tasks 1 to 4 and Part 9 Task 5: recorded responses for each step below, and the note's answers.

- [ ] **Step 1: Certificates.** As the maintainer, call the API from Node.js with `NODE_EXTRA_CA_CERTS` and with `--use-system-ca` (the CA added to a scratch keychain only, never the login or system keychain); `glab` with `ca_cert` set for the host in a scratch `GLAB_CONFIG_DIR`; git with `http.<url>.sslCAInfo`. Record each, and the error each gives without the CA.
- [ ] **Step 2: Sign-in.** `glab auth login --hostname` with an OAuth application the root makes, then without one (the message); a personal token typed into `glab auth login --stdin` from the probe.
- [ ] **Step 3: The project key** as the maintainer; then with project access tokens switched off in the top-level group's permissions (record the setting's name in GitLab's group API as found on the day), and the message the maintainer then gets.
- [ ] **Step 4: Protection and pipelines:** protect `main` and the state branch (no one pushes, Maintainers merge), require pipelines to succeed, read both back; post a commit status with the project key (`POST /projects/:id/statuses/:sha`, `name` equal to the pipeline's job) and record whether a merge request with no pipeline can then merge.
- [ ] **Step 5: Protected variables:** a protected variable `PROBE_SECRET`; a merge request's pipeline echoes whether it is set (never its value).
- [ ] **Step 6: Merge by Maintainers only:** the bot's merge refused, the maintainer's accepted; a commit pushed by the bot after the maintainer looked, then merged by the maintainer (it merges: record it).
- [ ] **Step 7: Unreachable:** stop the container, record the adapter's error text from `makeAdapter`.
- [ ] **Step 8: Undo** the users, keys, OAuth application and project (the container stays for Task 3), write the note and fixtures, `npm test`, commit (`"Record check 71 at Free: GitLab on a company's own servers"`).

**If the answer differs:** if a commit status posted with the key stands in for the pipeline, Part 6 Task 4 adds the GitLab setting that requires the pipeline's own job by name, or, failing that, the board says "the project's tests on the host could be faked with Wheelhouse's key" and real-user projects need Premium's approval.

### Task 3: Premium: check 71's other half and check 68's GitLab routes (C18, C15)

**Safety: yes** (approvals on the host)

Needs held item H3. Without a licence by the time Task 2 is done, mark both halves Deferred, record in the ledger, and go to Task 4.

**Status: Deferred, held for the director (H3).** No licence came, so this task did not run. Check 71's Premium half and check 68's GitLab routes stay Deferred; Part 9 Task 5 builds the Premium route from GitLab's documentation behind a switch that stays off until the check passes. The instance Task 1 left was torn down on 21 October 2026 (containers, volumes and state removed), so the steps below stay as written for the day the licence comes, after Step 0 starts it again.

**Files:** Modify `probes/71-gitlab-self-managed/run.js`, `docs/checks/71-gitlab-self-managed.md`; create `probes/68-host-approval/run.js`, `docs/checks/68-host-approval.md`, `tests/fixtures/gitlab-ee/premium/`; modify `docs/checks/README.md`.

**Interfaces:**
- Produces, for Part 9 Task 5: recorded responses for the approval settings and approvals; the note's answers.

- [ ] **Step 0: Start the instance again** (Task 1's was torn down): `startGitlab({ dir: 'probes/71-gitlab-self-managed' })`, then `startRunner({ dir, baseUrl, token: rootToken })` and `makeTestPeople(apiFor({ baseUrl, caFile, tokenFile: rootToken }), { dir })`, as Task 1 built them. The start takes several minutes.
- [ ] **Step 1: Load the licence** (`POST /license` as root, from the file the director saved in `~/Downloads`; the file is read, never committed).
- [ ] **Step 2: Approval settings** on the project: one required approval from the maintainer as an eligible approver; author's approval prevented; committers' approval prevented; approvals reset on push; overriding rules in a merge request prevented. Read them back.
- [ ] **Step 3: The routes:** the bot opens a merge request; the bot's own approval refused; the second person's approval doesn't count; the maintainer approves; a commit added by the bot removes the approval; the bot can't change the rules or protection, or make a key. Record each response.
- [ ] **Step 4: Audit events** read as the maintainer.
- [ ] **Step 5: Undo** everything and stop the instance (`stopGitlab({ remove: true })`), notes and fixtures, `npm test`, commit (`"Record checks 68 and 71 at Premium: the person's approval on GitLab"`).

### Task 4: Fold the answers into this plan

**Safety: no**

**Files:** Modify `docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md` (a new section, "What Parts 1 and 2 found", after the Check numbers table; and each later task's step the answers change, each change marked with its check number).

- [ ] **Step 1:** For each note from Parts 1 and 2, apply its **If the answer differs** paragraph to the task it names, and nothing else.
- [ ] **Step 2:** List anything that changes what the director sees in one card for the main session (what, why it comes to them, options, recommendation, meanwhile); if nothing does, say so in the handover note.
- [ ] **Step 3: Run `npm test`, commit** (`"Fold checks 56 to 71 into the Copilot plan"`).

## Part 3: the seam, with Claude Code as the first adapter

Nothing changes for Claude Code users. Every task starts by running `npm test` and recording the count; every task ends with the same count passing plus its own new tests.

### Task 1: The adapter contract

**Safety: no**

**Files:**
- Create: `scripts/agents/contract.js`, `scripts/agents/index.js`, `adapters/claude-code/index.js`, `tests/scripts/agents/contract.test.js`, `tests/scripts/agents/core-neutral.test.js`

**Interfaces:**
- Produces: `ADAPTER_PARTS = ['identity', 'hooks', 'translate', 'tools', 'settings', 'sessions', 'cards', 'packaging', 'toolSheet', 'safetyLine', 'evalRunner']` (spec section 8.1's ten, with `tools` split out of translation because the guards read it directly); `checkAdapter(adapter) -> string[]`, each problem a plain sentence naming the missing or wrongly typed part; `AGENTS = ['claude-code']` (Copilot joins in Part 4); `adapterFor(name) -> Adapter`, throwing for an unknown name; `agentOfInput(raw) -> 'claude-code' | 'copilot' | null` (Claude Code's input has `hook_event_name`; Copilot's camelCase input has `toolName` or `sessionId` and no `hook_event_name`; Wheelhouse registers Copilot's hooks in camelCase only (checks 56, 58, 60), because the same event registered under two spellings runs twice; a PascalCase payload carries `hook_event_name` and Claude Code's key names, so anything with `hook_event_name` is Claude Code's, as today, and `SubagentStart` keeps camelCase keys with no `hook_event_name` even under the PascalCase name (check 58)); `agentOfProject(project, { computerId }) -> string`, from the project's `.claude/wheelhouse.json` `agents` map (`{ "<computer id>": "copilot" }`), defaulting to `'claude-code'`.
- Each part's shape: `identity: { name, label, floor, find({ platform, env }) -> { found, version } }`; `hooks: { registration(opts) -> object, file(opts) -> string }`; `translate: { toGuardInput(raw, event) -> object | null, fromGuardAnswer(out, event) -> object | null }`; `tools: { read: string[], halt: string[], notify: string[], ask: string, shell: string[] }`; `settings: { project(config, opts), local(opts) }`; `sessions: { foremanCall(opts), featureStartCall(opts), featureResumeCall(opts), finalAnswer(stdout) }`; `cards: { binding: string[] }` (which proofs bind for this agent); `packaging: { files(): string[] }`; `toolSheet: string`; `safetyLine(opts) -> string[]`; `evalRunner: { run(opts) }`.

- [ ] **Step 1: Write the failing tests.**

```js
test('the Claude Code adapter has every part, each of the right type', ...)
test('checkAdapter names a missing part in plain words', ...)
test('adapterFor throws for an agent it does not know', ...)
test('agentOfInput reads Claude Code\'s input as claude-code', ...)
test('agentOfInput gives null for input it cannot place', ...)
test('agentOfProject defaults to claude-code and reads the computer\'s entry', ...)
test('no file outside the allowed folders names Copilot', ...)  // core-neutral.test.js; its allowed list starts empty of core files
```

- [ ] **Step 2: Run `npm test`:** the new tests FAIL. **Step 3: Implement** the contract and `adapters/claude-code/index.js`, whose parts at this task are thin re-exports of today's code (later tasks move code behind them). **Step 4: Run `npm test`:** PASS, with the earlier count.
- [ ] **Step 5: Commit** (`"Add the agent adapter's contract, with Claude Code as its first adapter"`).

### Task 2: The guards read through the adapter

**Safety: yes** (the guards)

**Files:**
- Create: `adapters/claude-code/answers.js`, `adapters/claude-code/tools.js`, `tests/scripts/agents/hook-seam.test.js`
- Modify: `scripts/hooks/kit.js` (`hookMain`), `scripts/hooks/stop-guard.js`, `scripts/hooks/card-check.js` and `scripts/hooks/prompt-record.js` (tool names from the adapter's `tools`)

**Interfaces:**
- Consumes: `adapterFor`, `agentOfInput` (Task 1).
- Produces: `hookMain` reads the raw input, picks the adapter with `agentOfInput` (falling back to `claude-code` when it is null, which is today's behaviour), passes `adapter.translate.toGuardInput(raw, event)` to `decide`, and writes `adapter.translate.fromGuardAnswer(out, event)`. When `toGuardInput` returns null and the hook fails closed, it writes that adapter's refusal for the event. Claude Code's `toGuardInput` and `fromGuardAnswer` return their argument unchanged. `answer` stays exported from `kit.js`, now re-exported from `adapters/claude-code/answers.js`. `READ_TOOLS`, `HALT_TOOLS` and `NOTIFY_TOOLS` stay exported from `stop-guard.js` with the same values, now read from `adapters/claude-code/tools.js`.

- [ ] **Step 1: Write the failing tests.**

```js
test('Claude Code input reaches decide byte for byte as before', ...)
test('a guard\'s answer is written byte for byte as before', ...)
test('an adapter that cannot translate an input makes a fail-closed hook refuse', ...)
test('an adapter that cannot translate an input makes an informing hook write nothing', ...)
test('READ_TOOLS, HALT_TOOLS and NOTIFY_TOOLS keep their values', ...)
```

- [ ] **Step 2: Run `npm test`:** FAIL. **Step 3: Implement.** **Step 4: Run `npm test`:** PASS, every existing hook test untouched.
- [ ] **Step 5: Commit** (`"Read every hook's input through its agent's adapter"`).

### Task 3: Sessions start through the adapter

**Safety: yes** (each session's permissions)

**Files:**
- Create: `adapters/claude-code/sessions.js`, `tests/scripts/agents/claude-sessions.test.js`
- Modify: `scripts/watcher/waker.js`, `scripts/foreman/start.js`

**Interfaces:**
- Consumes: `resolveClaude`, `invocation`, `withoutHostVariables` (`scripts/lib/claude.js`); `agentOfProject`.
- Produces: `foremanCall({ config, pluginRoot, prompt, platform, env, claude }) -> { file, args, env }`; `featureStartCall({ config, sessionId, prompt, allowed, env, claude }) -> { file, args, env }`; `featureResumeCall({ config, sessionId, prompt, allowed, env, claude }) -> { file, args, env }`; `finalAnswer(stdout) -> string | null`. Each builds exactly the argv the waker and `start.js` build today; they now call the project's adapter.

- [ ] **Step 1: Record today's argv.** Before changing anything, add `tests/fixtures/agents/claude-argv.json` holding the argv today's code builds for a foreman, a new feature and a resumed feature, on `darwin` and `win32`, from the waker's and `start.js`'s own tests' inputs.
- [ ] **Step 2: Write the failing tests:** `each call builds the recorded argv on darwin and win32`; `the waker asks the project's adapter`.
- [ ] **Step 3: Run `npm test`:** FAIL. **Step 4: Implement** by moving the argv code, not rewriting it. **Step 5: Run `npm test`:** PASS.
- [ ] **Step 6: Commit** (`"Start Claude Code sessions through its adapter"`).

### Task 4: Settings, registration, identity and packaging through the adapter

**Safety: yes** (the sandbox and deny settings)

**Files:**
- Create: `adapters/claude-code/settings.js`, `adapters/claude-code/hooks.js`, `tests/scripts/agents/claude-registration.test.js`
- Modify: `adapters/claude-code/index.js`, `scripts/setup/project-files.js` (`SETUP_FILES` from the adapter's `packaging.files()`)

**Interfaces:**
- Produces: `settings.project` and `settings.local` are `projectSettings` and `localSettings`, unchanged; `hooks.registration()` returns the object in `hooks/hooks.json`, and `hooks.file()` returns that path; `identity.floor` is `CLAUDE_CODE_FLOOR`; `identity.find` wraps `resolveClaude`; `packaging.files()` returns today's `SETUP_FILES`.

- [ ] **Step 1: Write the failing tests:** `hooks/hooks.json is exactly what the adapter's registration gives` (a drift test: a later change to either must change both); `SETUP_FILES keeps its value`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Give Claude Code's settings, registration and packaging to its adapter"`).

### Task 5: The tool sheet: playbooks in general words

**Safety: no**

**Files:**
- Create: `adapters/claude-code/tool-sheet.md`, `tests/skills/tool-names.test.js`
- Modify: `skills/front-desk/SKILL.md`, `skills/intake/SKILL.md`, `skills/foreman/SKILL.md`, `skills/setup/SKILL.md`, `scripts/hooks/session-start.js` (adds the sheet and the command line), and any test that pins a changed playbook line (each named in the commit message)

**Interfaces:**
- Produces: `toolSheetLines(agent, { pluginRoot, platform }) -> string[]` in `scripts/hooks/session-start.js`: the adapter's `toolSheet`, then `The Wheelhouse command is <path>` (from `frontDeskCommand(pluginRoot, { platform })`). The session start's `MAX_CHARS` budget holds the sheet; the sheet comes before the briefing so a long briefing is what gets cut.
- The words, each replacing the Claude tool's name in the four playbooks: `AskUserQuestion` → "your clickable-question tool"; `PushNotification` → "your notification tool"; `ToolSearch` → "your tool-search tool, if you have one"; `SendMessage` → "your message tool"; `${CLAUDE_PLUGIN_ROOT}` and the plugin's path → "the Wheelhouse command the session start named". The Claude Code sheet maps each back: "Your clickable-question tool is AskUserQuestion", and so on. `commands/*.md` stay as they are: they are Claude Code's own packaging.

- [ ] **Step 1: Write the failing tests.**

```js
test('no skill names AskUserQuestion, PushNotification, ToolSearch, SendMessage or CLAUDE_PLUGIN_ROOT', ...)
test('the Claude Code tool sheet names every one of them', ...)
test('the session start gives the tool sheet and the command line before the briefing', ...)
test('a session start at MAX_CHARS keeps the whole tool sheet', ...)
```

- [ ] **Step 2: Run `npm test`:** FAIL. **Step 3: Change the playbooks and the session start.** **Step 4: Run `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Move the playbooks' tool names into a tool sheet per agent"`).

### Task 6: The guardrails grow, for every agent

**Safety: yes** (the guards and what agents may write)

**Files:**
- Modify: `scripts/gate/guardrails.js` (`GUARDRAILS`), `scripts/hooks/tool-guard.js`, `scripts/protection/settings.js` (the deny rules), `scripts/windows/guarded.js` (`KEPT_NORMAL`)
- Create: `scripts/lib/agent-control.js`, `tests/scripts/lib/agent-control.test.js`

**Interfaces:**
- Produces: `AGENT_CONTROL = ['.github/hooks/**', '.github/copilot/**', '.github/agents/**', '.github/skills/**', '.github/instructions/**', '.github/prompts/**', '.github/copilot-instructions.md', '.github/mcp.json', '.github/lsp.json', '.github/plugin/**', '**/AGENTS.md', '**/GEMINI.md', '.agents/**', 'plugin.json', '.plugin/**', 'com.github.copilot/**', '.vscode/**', '.codex/**', '.cursor/**', '.gemini/**', '.gitattributes']` (spec section 6.5, the Lean `.git` pointer file added in Part 5; `.github/copilot/**` stays in the list, since `disableAllHooks` in `.github/copilot/settings.json` was not tried, check 56); `homeControlFolders({ home, platform, env }) -> string[]`: `~/.copilot`, `~/.agents`, `~/.vscode/extensions`, and VS Code's user settings folder (`~/Library/Application Support/Code/User` on macOS, `%APPDATA%\Code\User` on Windows). `GUARDRAILS` becomes today's list plus `AGENT_CONTROL`. The tool guard refuses writes to both lists, after resolving the real path (`fs.realpathSync.native` of the nearest existing parent), with `CONTROL_FILE` ("That file steers an agent, so changing it is a guardrail change: ask the director"). `KEPT_NORMAL` gains the folders and files of `AGENT_CONTROL` that are plain names.

- [ ] **Step 1: Write the failing tests.**

```js
test('a pull request touching .github/hooks/x.json or a nested AGENTS.md is a guardrail change', ...)
test('the tool guard refuses an Edit to .vscode/tasks.json with CONTROL_FILE', ...)
test('the tool guard refuses a Write to ~/.copilot/hooks/x.json and to VS Code\'s user settings', ...)
test('a link inside the worktree that leads to .github/hooks is refused by its real path', ...)
test('Claude Code\'s deny rules carry the new paths', ...)
test('reading those files is still allowed', ...)
```

- [ ] **Step 2: Run `npm test`:** FAIL. **Step 3: Implement.** **Step 4: Run `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Treat every agent's control files as guardrails, in every project"`).

### Task 7: Proof that nothing changed for Claude Code

**Safety: no**

**Files:** Create `docs/evals/adapter-seam.md`; modify `HANDOVER.md` (one line under the Copilot item: the seam is in, and what proved it).

- [ ] **Step 1: Run `npm test`** and `npm run mod-check`. Expected: PASS, the count from Part 3's start plus this part's new tests.
- [ ] **Step 2: Run Claude Code's counted scenarios again,** one trial each, as their results pages list them (`docs/evals/build-loop.md`, `docs/evals/mod.md` and the front desk's): `npm run eval -- <the numbers>`. Expected: each passes with Wheelhouse as before. A failure is a regression in this part: stop and fix it before the part ends.
- [ ] **Step 3: Write the results page and the handover line, commit** (`"Show that the adapter seam changed nothing for Claude Code"`).

## Part 4: Lean, VS Code with Copilot and nothing added

No Node.js runs for the person here, so most of this part is text: the kit copied into `~/.copilot/`, the playbooks it carries, and the files the chat writes. Node.js code in this part is only for building and checking that text, and for moving Lean's record up later.

### Task 1: The Copilot adapter, and the safety lines

**Safety: yes** (what the board promises)

**Files:**
- Create: `adapters/copilot/index.js`, `adapters/copilot/tools.js`, `adapters/copilot/tool-sheet.md`, `adapters/copilot/safety-line.js`, `tests/scripts/agents/copilot-adapter.test.js`
- Modify: `scripts/agents/index.js` (`AGENTS` gains `'copilot'`), `scripts/board/model.js` (the health line names the agent and its safety line), `tests/scripts/agents/core-neutral.test.js` (`scripts/board/model.js` is not on the allowed list: it gets the line from the adapter, never names the agent)

**Interfaces:**
- Produces: the Copilot adapter with every part; parts not built yet (`sessions`, `settings`, `translate`, `evalRunner`) throw `NOT_BUILT_YET` with the part's name, which `checkAdapter` accepts only for a part listed in `adapter.pending`. `tools` from the union of the tool names seen in checks 58, 63 and 66, not check 58's table alone (checks 58, 63, 66): `read` (the tools that only read: `view`, `glob`, `rg`, and the others those checks saw that only read), `halt` (including `apply_patch`, the one tool that creates and edits files, whose input is a patch string), `notify`, `ask` (`ask_user`, never offered headless, so unproven until sitting S1), `shell` (`bash`; `powershell` not yet seen, sitting S2). A tool seen in check 63 or 66 (`skill`, `read_agent`, `sql`, `task`, `multi_tool_use.parallel`) is placed in one of these lists when this task is built, not left out.
- `safetyLine({ tier, level, platform, node, addOn, sandbox }) -> string[]`, plain sentences, each the spec's own words cut to one line: at Lean, "Nothing is held off this computer except the copy in your folder", "Approvals are clicks in the chat, recorded as not proven" (without Node.js or the add-on), "STOP isn't enforced: agents are told to stop, and VS Code's stop button ends the running request" (without Node.js or the add-on), "Copilot's command prompts aren't a control", "Tests and reviews aren't independent", "Not for projects with real users"; at Middle and Full, one line per item of spec section 6.6 that applies to the level and system given (items 1 to 10). The board shows the first two; `/wheelhouse-board`'s full view and the data note show all. The Copilot line keeps its time-out sentence (check 58): a guard that runs past its `timeoutSec` is let through by Copilot, which is why every guard answers within `GUARD_DEADLINE_MS`. On the Mac with no Node.js, the Lean line says Wheelhouse's shell guard runs (check 69); on Windows it says no Wheelhouse guards run until sitting S2 finds a route.
- `adapters/copilot/tool-sheet.md`: "Your clickable-question tool is ask_user (askQuestions in VS Code)", the notification, task and shell tools by Copilot's names from check 58, and "The Wheelhouse command is …" when Node.js runs. It gains the lines check 63 asked for (check 63): dispatching a sub-agent is `task`, and a `name` is required (plus `description`, `prompt`, `agent_type` and `mode`), so the first dispatch does not fail; reading its answer is `read_agent`; loading a skill is `skill` with `{"skill": "<name>"}`; the task list is kept in the `sql` tool's `todos` table.

- [ ] **Step 1: Write the failing tests.**

```js
test('the Copilot adapter passes checkAdapter with its pending parts listed', ...)
test('at Lean with nothing added the line says approvals are not proven and STOP is not enforced', ...)
test('at Middle on Windows at Guarded every 6.6 item that applies is given, item 8 only while no phone route exists', ...)
test('every safety line passes plainWords and is one line', ...)
test('the board\'s health line for a Copilot project names Copilot and its first two safety lines', ...)
test('a Claude Code project\'s health line is unchanged', ...)
```

- [ ] **Step 2: Run `npm test`:** FAIL. **Step 3: Implement.** **Step 4: Run `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Add the Copilot adapter and say plainly what each tier holds"`).

### Task 2: The Lean kit, built from the one text

**Safety: yes** (the reviewer's tool list)

**Files:**
- Create: `scripts/agents/copilot/home.js`, `adapters/copilot/home/` (generated and committed), `tests/scripts/agents/copilot-home.test.js`
- Modify: `package.json` (`"copilot-home": "node scripts/agents/copilot/home.js --write"`)

**Interfaces:**
- Consumes: `skills/*/SKILL.md`, `agents/*.md`, `adapters/copilot/skills/lean/SKILL.md` and `adapters/copilot/skills/setup-lean/SKILL.md` (Tasks 3 and 5), `adapters/copilot/tool-sheet.md`.
- Produces: `buildHome({ root }) -> Map<string, string>` (relative path to text) for this tree:
  - `skills/wheelhouse-front-desk/`, `wheelhouse-intake/`, `wheelhouse-lean/`, `wheelhouse-setup/`, and one skill per command the director calls by name: `wheelhouse-board`, `wheelhouse-briefing`, `wheelhouse-settings`, `wheelhouse-stop`, `wheelhouse-sources` (each a short skill pointing to the front desk's section for it);
  - `agents/wheelhouse-builder.agent.md`, `wheelhouse-reviewer.agent.md`, `wheelhouse-tester.agent.md`, `wheelhouse-foreman.agent.md`: the same prompt text as `agents/*.md`, with Copilot's front matter (`name`, `description`, `tools`); the reviewer's `tools` are `view`, `glob` and `rg` and nothing else (check 66's route b; not the whole of `tools.read`, which may name `skill`, `sql` and others);
  - `instructions/wheelhouse.instructions.md`: the tool sheet, and the line "In VS Code's Local harness Wheelhouse doesn't run: say so and ask the director to switch the chat to Copilot";
  - `hooks/wheelhouse.json` and `hooks/wheelhouse-lean-guard.sh`: absent until Part 5 Task 8 adds them (prebuilt, check 69); setup copies them only on a Mac with no Node.js;
  - `MANIFEST.txt`: one line per file, `<git blob hash> <path>`, so the copy can be checked with `git hash-object` alone.
- `--write` replaces `adapters/copilot/home/` with the map; with no flag it prints the paths that differ and exits 1.

- [ ] **Step 1: Write the failing tests.**

```js
test('the committed kit is exactly what buildHome gives', ...)            // the drift test
test('the reviewer agent\'s tools are reading and searching only', ...)
test('every file starts with its path comment, after front matter', ...)
test('no file in the kit names a Claude Code tool', ...)
test('MANIFEST.txt lists every file with its git blob hash', ...)
test('every skill and agent name starts wheelhouse-', ...)
```

- [ ] **Step 2: Run `npm test`:** FAIL. **Step 3: Implement,** then `npm run copilot-home`. **Step 4: Run `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Build the Lean kit for Copilot from the same playbooks"`).

### Task 3: Lean's playbook

**Safety: yes** (approvals and records at Lean)

**Files:**
- Create: `adapters/copilot/skills/lean/SKILL.md`, `tests/skills/lean.test.js`
- Modify: `skills/front-desk/SKILL.md` (one line: "At Lean, follow wheelhouse-lean for the record, the board, building and merging")

**Interfaces:**
- Produces, in general words, every step the chat takes with git alone:
  - **The record:** one file per day, `.wheelhouse/record/YYYY-MM-DD.jsonl`, committed with the work it records; one JSON line per event, `{ "at", "kind", "card", "choice", "commit", "proof": "chat-click", "by": "chat", "tier": "lean" }`, `kind` one of `card`, `approval`, `review`, `merge`, `undo`, `stop`, `lift-stop`, `copy`. The skill gives the exact line for each kind.
  - **Cards:** the clickable-question tool, with **Approve**, **Not now**, **Explain more** and **Show me** where the card has them; an approval names the commit by 12 characters.
  - **The board:** `wheelhouse/board.md`, rewritten after each change, its first line the tier and its safety lines.
  - **Building:** one feature at a time, on branch `feature/<slug>`, in a chat with `wheelhouse-builder`; the review in a new chat with `wheelhouse-reviewer`, recorded as `review` with `"proof": "chat-review"`.
  - **Merging:** after the approval click, `git merge --no-ff feature/<slug> -m "<title> (approved <12-character commit>)"`, then the record line; **Undo** is `git revert -m 1 <merge>` and a record line.
  - **The copy:** after each merge, `git push wheelhouse-copy main` to a bare repository in the folder the person picked (`git init --bare` there once, at setup).
  - **STOP:** the word "stop" ends work and is recorded; nothing enforces it, and the skill says so to the director once per session.
  - **The runbook's local steps:** STOP, looking at an incident, undoing a merge, and (where the helper runs) a new signing key.
  - **On a code host, without Node.js:** `git push -o merge_request.create -o merge_request.target=main -o merge_request.remove_source_branch origin feature/<slug>` on GitLab; the project key given to git's own sign-in window once, never typed into the chat.

- [ ] **Step 1: Write the failing tests:** `the record line for each kind has every field`, `merging uses --no-ff and undo uses revert -m 1`, `the copy push names wheelhouse-copy`, `STOP is said to be unenforced`, `the key is never asked for in the chat`, `no Claude Code tool is named`.
- [ ] **Step 2: Run `npm test`:** FAIL. **Step 3: Write the playbook,** then `npm run copilot-home`. **Step 4: Run `npm test`:** PASS.
- [ ] **Step 5: Commit** (`"Write Lean's playbook: record, board, build, merge, undo and copy with git alone"`).

**Guards without Node.js (check 69).** A `/bin/sh` guard using `curl` runs as a `preToolUse` command hook on the Mac with no Node.js on the PATH, so the branch is taken. Lean's setup (Task 5) copies the kit's prebuilt `hooks/wheelhouse.json` to `~/.copilot/hooks/wheelhouse.json` (`HOOK_FILE`, the same file Part 5 Task 2 writes, so one replaces the other and nothing registers twice, check 56) holding one camelCase `preToolUse` entry that runs the shell guard Part 5 Task 8 builds. Every shell guard denies on a `curl` failure, on any status but 200 and on any answer that is not exactly the allow answer, and answers well inside the hook's `timeoutSec`, since Copilot lets a hook that times out through (checks 58, 69). A Copilot web hook is never the only guard (check 69: its behaviour at `127.0.0.1` and with the server down contradicts the documentation, on one run). The Windows half, a PowerShell 5.1 guard and a `powershell` hook entry, is sitting S2's; if it finds no route, Lean on Windows has no Wheelhouse guards, as the design already says.

### Task 4: Lean's record, read and moved up

**Safety: yes** (approval records)

**Files:**
- Create: `scripts/state/lean-record.js`, `tests/scripts/state/lean-record.test.js`

**Interfaces:**
- Produces: `parseLeanRecord(text, { file }) -> { entries, problems }` (a line that isn't JSON, lacks a field or names an unknown kind is a problem with its file and line; it is kept, never dropped silently); `readLeanRecord(folder) -> { entries, problems }` over every file in `LEAN_RECORD_DIR`, oldest first; `leanToEvents(entries, { project }) -> Event[]`, each through `makeEvent`, with `data.tier = 'lean'` and `data.proof` as recorded, never signed (`moveUp`, Part 6 Task 6, writes them).

- [ ] **Step 1: Write the failing tests:** `each kind becomes the matching event`, `a broken line is a problem, not lost`, `no event from Lean is signed`, `an approval names its 12-character commit`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Read Lean's record and turn it into state events"`).

### Task 5: Setup with git alone, and the README

**Safety: no**

**Files:**
- Create: `adapters/copilot/skills/setup-lean/SKILL.md`, `adapters/copilot/vscode-settings.json`, `docs/copilot/tested-versions.md`, `scripts/agents/copilot/versions.js`, `tests/skills/setup-lean.test.js`, `tests/scripts/agents/copilot-versions.test.js`
- Modify: `README.md` (an "On GitHub Copilot" section), then `npm run copilot-home`

**Interfaces:**
- `adapters/copilot/skills/setup-lean/SKILL.md`, the steps the chat takes:
  1. Check `git --version`; without git, stop kindly.
  2. Clone Wheelhouse's public repository at the release tag into `~/.copilot/wheelhouse/<tag>/`, then copy `adapters/copilot/home/` into `~/.copilot/` (skills, agents, instructions; not `hooks/`, which step 4 handles), and check each copied file against `MANIFEST.txt` with `git hash-object`.
  3. "Can Wheelhouse run here?" at Lean: git, `node --version`, `copilot --version`, the project's remote; say in one sentence which tier this is ("This computer runs Wheelhouse at Lean: everything stays here, and Copilot builds in your chat"), and if Node.js runs, that Part 5's helper can add more.
  4. In the project: `.vscode/settings.json` merged with `adapters/copilot/vscode-settings.json`; `.wheelhouse/record/`; `wheelhouse/board.md`; a first commit. On the Mac where `node --version` finds nothing, also copy `hooks/wheelhouse.json` and the shell guard it runs from the kit into `~/.copilot/` (check 69). Both are built when the kit is built (Node.js runs then, not on the person's machine) and ship prebuilt in `adapters/copilot/home/`, listed in `MANIFEST.txt`, so setup only copies and checks them. They come from Part 5 Task 8; until that task exists the kit holds neither, this step copies nothing, and the board's first line says no Wheelhouse guards run.
  5. The copy folder: ask where (a clickable question with **Choose a folder**, **Not now**); `git init --bare` there; `git remote add wheelhouse-copy <folder>`.
  6. Compare the person's VS Code and Copilot versions with `docs/copilot/tested-versions.md`, and say if theirs isn't tested yet.
- `adapters/copilot/vscode-settings.json`: the documented settings that keep every command asked for, edits outside the project asked for, edits to guarded files asked for, and nothing approved automatically (names from `docs/research/copilot-vscode-2026-10.md`, each with its source line in the test). The skill calls them conveniences, not controls.
- `docs/copilot/tested-versions.md`: a table, `VS Code | Copilot runtime | Tested on | Result`; `isTested({ vscode, runtime }, text) -> boolean`.
- README: the one request line, "Set up Wheelhouse from https://github.com/where-is-brett/wheelhouse at release `<tag>`", and what it does.

- [ ] **Step 1: Write the failing tests:** `the setup skill checks every copied file against MANIFEST.txt`; `the settings file names only documented settings`; `isTested reads the table`; `the README gives the one request line`.
- [ ] **Step 2: Run, write, run `npm test`:** PASS. **Step 3: Commit** (`"Set up Lean from one request in the chat, with git alone"`).

## Part 5: Lean with the helper, where Node.js may run

Copilot's hooks run beside the agent, so here they only read: the helper writes and signs. This part's hooks also serve Middle and Full.

### Task 1: Copilot's hook input, translated

**Safety: yes** (the guards)

**Files:**
- Create: `adapters/copilot/translate.js`, `tests/scripts/agents/copilot-translate.test.js`
- Modify: `adapters/copilot/index.js` (`translate` no longer pending)

**Interfaces:**
- Consumes: `tests/fixtures/copilot/hook-input/` (check 58); `tools` (Part 4 Task 1).
- Produces: `TOOL_MAP`, Copilot's camelCase name to Claude Code's, built as the union of the names seen in checks 58, 63 and 66 (checks 58, 63, 66; Wheelhouse registers camelCase only, check 56): `bash` to `Bash`, `view` to `Read`, `rg` to `Grep`, `glob` to `Glob`, `web_fetch` to `WebFetch`, `task` to `Agent`, `apply_patch` to `Edit`, an MCP tool `<server>-<tool>` to `mcp__<server>__<tool>`, and every other name seen in checks 63 and 66 (`skill`, `read_agent`, `sql`, route b's disabled tools, `multi_tool_use.parallel`) entered as a known tool with its place in `tools`; `powershell`, `edit`, `create` and `ask_user` are entered under the names the plan expects and stay unproven until sitting S1 or S2 sees them. Argument names are mapped likewise (`toolArgs.command` to `tool_input.command`, the path to `file_path`); `apply_patch`'s `toolArgs` is a string, so the translation reads the paths from its `*** Add File:`, `*** Update File:` and `*** Delete File:` lines and gives the guards `file_path` for each, refusing the call if any one is refused (check 58). The translation keeps the answer's shape (`permissionDecision`, exit 0; exit 2 also denies) and reads either spelling of the keys. It never decides on a tool name alone: the deny on `view` was walked round with `cat` (check 58). **Open question, settled before a guard treats `multi_tool_use.parallel` as known and allowed (checks 58, 66):** does `preToolUse` see each call inside it, or only the wrapper? Until it is settled, the wrapper is refused with `UNKNOWN_TOOL`. `harnessOf(raw) -> 'copilot' | 'local' | 'unknown'`: check 58 found no such field in the CLI's input and VS Code's input is sitting S1's and S2's, so it returns `'unknown'`, and `'unknown'` is refused exactly as the Local harness is (only reading is let through) on purpose, failing closed. Until sittings S1 and S2 name the field, a real Copilot CLI session in a Wheelhouse project can read but not write through these guards; `toGuardInput(raw, event)` returns Claude Code's shape, or `null` for a tool not in `TOOL_MAP`; `UNKNOWN_TOOL(name)`; `fromGuardAnswer(out, event)` turns `hookSpecificOutput.permissionDecision` into Copilot's `{ permissionDecision, permissionDecisionReason }`, and context into Copilot's field for that event (check 60). A refusal also sets the process's exit code to 2, so a Copilot that ignores the body still refuses (check 58).

- [ ] **Step 1: Write the failing tests,** one per fixture.

```js
test('each recorded Copilot input translates to the Claude Code input the guards read', ...)
test('an unknown tool such as apply_patch_v2 is refused with UNKNOWN_TOOL', ...)   // Review Focus 1
test('a read-only tool not in TOOL_MAP is let through only when tools.read names it', ...)
test('skill, read_agent and sql, which checks 63 and 66 saw, are known tools', ...)       // checks 63, 66
test('apply_patch\'s paths are read from its patch, and one refused path refuses the call', ...)   // check 58
test('multi_tool_use.parallel is refused until the open question is settled', ...)             // checks 58, 66
test('a guard that throws answers with a deliberate deny and does not exit 1', ...)           // check 58
test('a deny answer becomes Copilot\'s deny with its reason, and exit code 2', ...)
test('Local harness input is told apart from the Copilot harness\'s', ...)
```

- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Translate Copilot's hook input for Wheelhouse's guards"`).

### Task 2: One registration, one Node.js start, a deadline

**Safety: yes** (the guards)

**Files:**
- Create: `adapters/copilot/hooks.js`, `scripts/hooks/copilot-entry.js`, `tests/scripts/hooks/copilot-entry.test.js`, `tests/scripts/agents/copilot-registration.test.js`

**Interfaces:**
- Produces: `registration({ node, root, platform }) -> object`, the person's hook file (`~/.copilot/hooks/wheelhouse.json`, or `$COPILOT_HOME/hooks/`) and no other place: not `.github/hooks/`, `.github/copilot/settings.json` or `.claude/settings.json`, which would run a second time in a trusted folder and not at all in an untrusted one (check 56). Every event is under its camelCase name only (`sessionStart`, `userPromptSubmitted`, `preToolUse`, `preCompact`, `subagentStop` where used; checks 56, 58, 60), since a second spelling runs the hook twice and `UserPromptSubmit` answers did not reach the agent. Each entry runs `node "<root>/scripts/hooks/copilot-entry.js" <event>` through the `command` field (and `bash` and `powershell` fields where check 58 found them needed), `timeoutSec: GUARD_TIMEOUT_SEC`; `writeRegistration` is the helper's only (setup's step for this computer's changes calls it, Part 6 Task 6), never an agent's.
- `copilot-entry.js <event>`: reads the input once; if the session's folder isn't in a registered Wheelhouse project (`projectOf`), exits 0 and writes nothing; in the Local harness, at `sessionStart` writes `LOCAL_HARNESS` ("Wheelhouse doesn't run in this kind of chat. Switch the chat to Copilot in the chat's agent picker.") and at `preToolUse` refuses anything but reading; otherwise runs, in one process and in order, the STOP guard, the lineage hold and the tool guard at `preToolUse`, the STOP word and the board context at `userPromptSubmitted`, the session start at `sessionStart`, the card check and the prompt record around `ask_user`, a precompact hook at `preCompact` that can only record the compaction and warn, never block it (check 60: `decision: block` and exit 2 were both read and the session compacted anyway), so nothing relies on it to keep the briefing or a rule in context; the first refusal wins. The entry catches its own errors and answers deliberately, since a crash (exit 1) blocks every call and its stderr is not shown to the model (check 58). A deadline of `GUARD_DEADLINE_MS` covers the whole run: at the deadline a guard event refuses with `DEADLINE` ("A Wheelhouse check took too long, so this was refused; try again"), an informing event writes nothing.

- [ ] **Step 1: Write the failing tests.**

```js
test('registration quotes a home folder with a space and an apostrophe', ...)   // Review Focus 5
test('registration sets timeoutSec to GUARD_TIMEOUT_SEC on every entry', ...)
test('outside a Wheelhouse project the entry writes nothing and exits 0', ...)
test('a guard that hangs is refused at GUARD_DEADLINE_MS with DEADLINE', ...)
test('the first refusal wins and later guards do not run', ...)
test('the registration writes only wheelhouse.json in the hook folder, with camelCase event names', ...)   // checks 56, 58, 60
test('the precompact hook answers without blocking', ...)                                                   // check 60
test('in the Local harness only reading is let through', ...)
```

- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Register Wheelhouse's Copilot hooks once per computer, with a deadline"`).

### Task 3: On Copilot, hooks read and the helper writes

**Safety: yes** (STOP, signing, approvals)

**Files:**
- Modify: `scripts/hooks/kit.js` (`writeVia(agent)`), `scripts/hooks/stop-word.js`, `scripts/hooks/prompt-record.js`, `scripts/hooks/session-start.js`, `scripts/host/helper.js` (routes), `scripts/gate/conditions.js`
- Create: `tests/scripts/hooks/copilot-read-only.test.js`, `tests/scripts/host/helper-copilot-routes.test.js`

**Interfaces:**
- Produces: helper routes `POST /stop` (`{ by: 'word', project }`, sets STOP as `setStop` does), `POST /session/mark` (the session markers hooks write today), `POST /cards/chat-click` (`{ project, card, hash, label, proof }`, where `proof` is `chat-click` or, once check 59 passes, `hook-click`; writes an unsigned event of kind `shown` with the answer; never signs). In Copilot mode (`agentOfInput` gives `copilot`) every hook write goes through these routes, the hooks never open `keysDir()`, and `prompt-record` never calls `earned`.
- The STOP word's reply and the briefing (check 60): the hook answers through `additionalContext` (the agent reads it as a system reminder after the prompt; `modifiedPrompt` is the other field that works), at `userPromptSubmitted` and `sessionStart`, camelCase and registered in the person's folder; `systemMessage` and plain stdout reached neither the agent nor the output in headless runs, so the person reads the agent's reply, not the hook's text. The front desk's own `wheelhouse-briefing` skill stays as the fallback for a hook that fails to load or answer.
- With no helper answering: `NO_HELPER_STOP` ("Wheelhouse's helper isn't running, so writes, pushes, merges and new agents are refused until it is. Start it with the Wheelhouse command."); the STOP guard refuses as under STOP, the tool guard lets reading through, and the STOP word answers with `NO_HELPER_STOP`.
- The gate: an approval whose proof is `chat-click` or `hook-click` counts only where the project isn't marked as having real users; a real-user project's merge needs the host's approval (Part 9) or, until then, a `window` or `add-on` proof. `gateDecision`'s refusal names which.

- [ ] **Step 1: Write the failing tests.**

```js
test('in Copilot mode no hook reads the keys folder or writes under the Wheelhouse home', ...)  // keys unreadable, home read-only
test('with no helper a Copilot write is refused and a read is let through', ...)                // Review Focus 2
test('the STOP word on Copilot sets STOP through the helper', ...)
test('a chat click is recorded unsigned with its proof', ...)
test('the gate refuses a real-user merge on a chat click and names what it needs', ...)
test('Claude Code hooks still sign and write as before', ...)
```

- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"On Copilot, hooks only read and the helper writes"`).

### Task 4: The helper's own window

**Safety: yes** (binding clicks)

**Files:**
- Create: `scripts/confirm/window.js`, `tests/scripts/confirm/window.test.js`
- Modify: `scripts/host/helper.js` (route `POST /confirm`)

**Interfaces:**
- Produces: `askInWindow({ title, lines, options, platform, timeoutMs, run }) -> { choice: string | null }`. On macOS it runs `osascript` with a constant script that reads the title, lines and options from `argv` (`on run argv`), never from text spliced into the script. On Windows it runs `powershell.exe -NoProfile -NonInteractive -STA -EncodedCommand <constant script>` with the card's text passed base64 in an environment variable, showing a WinForms dialog with one button per option. Elsewhere it gives `{ choice: null }`. A time-out gives null.
- `POST /confirm` (`{ project, card, hash }`): looks the card up in state (the caller's text is never shown), checks it is one of `CONFIRMED_STEPS` or a real-user approval, opens the window, and on a deciding choice signs the record itself with `sign`, proof `window`. One window at a time per computer.

- [ ] **Step 1: Write the failing tests** with a stand-in `run`.

```js
test('a title with quotes, backslashes and new lines reaches osascript only as an argument', ...)
test('the Windows script is constant and the text travels base64 in the environment', ...)
test('a time-out records nothing', ...)
test('a card not in state, or with another hash, opens no window', ...)
test('a deciding choice is signed by the helper with proof window', ...)
test('a second request while a window is open waits for the first', ...)
```

- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Confirm the steps that matter most in the helper's own window"`).

### Task 5: The git store outside the project

**Safety: yes** (the merge gate at Lean)

**Files:**
- Create: `scripts/lean/store.js`, `tests/scripts/lean/store.test.js`
- Modify: `scripts/host/helper.js` (routes `POST /lean/merge`, `POST /lean/undo`, `POST /lean/copy`), `scripts/lib/agent-control.js` (the `.git` pointer file joins `AGENT_CONTROL` at Lean)

**Interfaces:**
- Produces: `storeDir(project) -> string` (`<wheelhouseHome>/projects/<p>/git`, a bare repository); `adoptProject({ project, folder })` moves the project's `.git` there and leaves the folder as a worktree of it (its `.git` file points to the store); `mergeApproved({ project, branch, commit, now })`: needs an approval for exactly `commit` (`window`, `add-on`, or `chat-click` where allowed), runs the project's test command in a clean temporary worktree at `commit`, merges with `git -c core.hooksPath=<an empty folder Wheelhouse owns> merge --no-ff`, writes the record, then pushes to `wheelhouse-copy`; `undoMerge({ project, merge, now })`; both under `withLocalLock(project, fn, { waitMs: 120000 })`, exported from the same module (a lock file in `<wheelhouseHome>/projects/<p>/`, taken with an exclusive create and freed in `finally`), whose refusal says `OTHER_WINDOW` ("Another VS Code window is merging this project; try again in a minute").

- [ ] **Step 1: Write the failing tests** in temporary repositories.

```js
test('a planted post-merge hook does not run', ...)
test('a branch whose head moved since the approval is refused', ...)
test('failing tests at the approved commit refuse the merge', ...)
test('two merges at once run one after the other', ...)          // Review Focus 4
test('undo makes a revert commit and later work stays', ...)
test('the copy holds the merge after it', ...)
test('the project folder\'s .git is a pointer file into the store', ...)
```

- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Keep Lean's git store outside the project and merge only approved commits"`).

### Task 6: Starting the helper

**Safety: no**

**Files:**
- Create: `scripts/agents/copilot/start-helper.js`, `scripts/lib/login-start.js`, `tests/scripts/lib/login-start.test.js`
- Modify: `scripts/setup/` (the computer's changes card lists the sign-in start), `scripts/setup/uninstall.js` (removes it)

**Interfaces:**
- Produces: `start-helper.js` starts the helper, the watcher and the usage receiver detached if they aren't running, and prints one plain line ("Wheelhouse's helper is running") or why not; it is the one command the front desk asks the person to allow. `loginEntry({ platform, node, root }) -> { kind, path, content }`: a launch agent at `~/Library/LaunchAgents/dev.wheelhouse.helper.plist` (`RunAtLoad`), or a per-user start-up entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` named `Wheelhouse helper`, added with `reg add` (no admin); `installLoginStart` and `removeLoginStart` take `run`. Setup asks "Is this a work computer?" and on yes writes no entry (spec section 8.5).

- [ ] **Step 1: Write the failing tests:** `the plist runs start-helper with full paths`, `the Windows entry quotes a path with spaces`, `no entry on a work computer`, `uninstall removes the entry it made and nothing else`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Start the helper at sign-in, or from one allowed command on a work computer"`).

### Task 7: Lean end to end

**Safety: no**

**Files:** Create `tests/e2e/copilot-lean.test.js`.

- [ ] **Step 1: Write the test,** with a real helper on a temporary home, stand-ins for `copilot` and the window, and the recorded Copilot inputs fed to `copilot-entry.js`: STOP by the word, then a write refused; an unknown tool refused; the helper stopped, then a write refused and a read let through; a feature branch approved by chat click, merged with a hook planted, the hook not run; undo; the copy; a real-user project's merge refused on a chat click and accepted after the window's click.
- [ ] **Step 2: Run `npm test`:** PASS. **Step 3: Commit** (`"Test Lean with the helper end to end"`).

### Task 8: Lean's guards in shell, where Node.js doesn't run (check 69)

**Safety: yes** (Lean's guards)

**Files:**
- Create: `adapters/copilot/lean-guard.sh`, `adapters/copilot/lean-hooks.js` (builds the hook file Part 4 Task 3 names), `tests/scripts/agents/copilot-lean-guard.test.js`
- Modify: `scripts/agents/copilot/home.js` (`buildHome` calls `leanHookFile` and adds `hooks/wheelhouse.json` and the guard script to the kit and `MANIFEST.txt`, so they ship prebuilt and Part 4 Task 5's setup only copies them), then `npm run copilot-home`

**Interfaces:**
- Consumes: check 69's probe (`probes/69-guards-without-node/guard.sh`) as the model.
- Produces: `leanGuardScript()`, a `/bin/sh` script that reads the `preToolUse` input, refuses a write to any `AGENT_CONTROL` path or credential folder (the tool guard's refusals that need no Wheelhouse state, with `CONTROL_FILE`'s words), and otherwise allows; it denies on a `curl` or read failure, on any status but 200 and on anything but the exact allow answer wherever it asks a local answer, and its own limits leave it well inside `GUARD_TIMEOUT_SEC` (check 69 used 3 seconds against 20). `leanHookFile({ platform }) -> object`, the `wheelhouse.json` of Part 4 Task 3 (one camelCase `preToolUse` entry, `timeoutSec: GUARD_TIMEOUT_SEC`). It takes no root, since the committed kit is the same for everyone: the guard is copied beside the hook file as `hooks/wheelhouse-lean-guard.sh`, and the entry's command is `/bin/sh -c 'exec /bin/sh "${COPILOT_HOME:-$HOME/.copilot}/hooks/wheelhouse-lean-guard.sh"'`, so an explicit shell expands the home at run time (kept as the same hash for every person, which `MANIFEST.txt` needs) and the double quotes keep a home with a space or apostrophe one word (Review Focus 5). A test runs the entry from a home named `Ann O'Neil`. It decides on what is being done, never a tool name alone (check 58). Mac only; the Windows form is sitting S2's.

- [ ] **Step 1: Write the failing tests** with `PATH` holding no `node`:

```js
test('the guard runs with no node on the PATH', ...)
test('a write to a control file is refused and a read is allowed', ...)
test('no answer, a status other than 200 and an answer that is not allow each refuse', ...)
test('the guard answers well inside the hook\'s timeoutSec', ...)
test('the hook file is the same file Part 5 Task 2 writes, so only one is ever registered', ...)
test('the entry runs the guard from a home with a space and an apostrophe', ...)   // Review Focus 5
```

- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Add Lean's guards in shell, for a Mac with no Node.js"`).

## Part 6: Middle on GitLab on a company's own servers: the host's side

### Task 1: The company's GitLab address, everywhere

**Safety: no**

**Files:**
- Modify: `scripts/setup/host.js` (`SIGN_UP`, `glab`'s sign-in host), `scripts/host/token-url.js`, `scripts/host/cut-access.js` (`GITLAB_URL`), `scripts/setup/project-files.js` (the commit email), `scripts/host/gitlab-key.js` (`gitlabApi`'s default, and `makeProjectKey`'s refusal text), `scripts/host/adapter.js` (`detectHost`)
- Create: `scripts/host/gitlab-base.js`, `tests/scripts/host/gitlab-base.test.js`

**Interfaces:**
- Produces: `DEFAULT_GITLAB = 'https://gitlab.com'` (the only place it is written); `gitlabBase({ config, remoteUrl }) -> string` (the project's `gitlabHosts` entry matching the remote, else the remote's own origin when `detectHost` says GitLab, else `DEFAULT_GITLAB`); `commitEmail({ api }) -> string` (`GET /user`: `commit_email`, else `public_email`, else the instance's no-reply form `<id>-<username>@users.noreply.<host>`, as gitlab.com's is today). Every other module takes `base` from `gitlabBase`.
- Check 71 adds: a remote with a port keeps it (`gitlabBase` compares and returns the origin as a whole, not `url.hostname`), and `detectHost` takes a `gitlabHosts` entry written with its port (`localhost:8929`), which it threw on before; `glab` is told the host through `GITLAB_HOST`, since `--hostname` refuses a port on `glab api`, and `git_protocol` is set to `https` for the host. `makeProjectKey` maps a 400 that says "does not have permission to create project access token" to a plain line: the company's group has switched project keys off; ask its GitLab admin (an owner of the top-level group) to tick "Allow group and project access tokens", or use a pasted token. The setting (`resource_access_token_creation_allowed` on the top-level group) cannot be read through the API, so setup cannot warn first; the refusal is the only signal (check 71).

- [ ] **Step 1: Write the failing tests:** `no module but gitlab-base names gitlab.com` (a grep test); `a company remote gives the company's address`; `the token page, sign-up link and key page use the company's address`; `the commit email comes from the person's profile`; `a remote with a port keeps the port and a gitlabHosts entry may carry one`; `a refused project key is explained as the group's setting`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS, with the gitlab.com tests unchanged. **Step 3: Commit** (`"Use the company's own GitLab address everywhere"`).

### Task 2: The company's certificate, and an unreachable server

**Safety: yes** (connections that carry keys)

**Files:**
- Create: `scripts/host/company-ca.js`, `tests/scripts/host/company-ca.test.js`
- Modify: `scripts/host/adapter.js` (the unreachable error; `refusalOf` reads glab's wrapped "SHA does not match" as "the head has moved", check 71), `scripts/host/gitlab-key.js` (`gitlabApi` keeps the cause code), `scripts/board/model.js` (the line), `scripts/setup/tools.js` (applies the certificate to `glab` and git)

**Interfaces:**
- Consumes: check 71's answers: `NODE_EXTRA_CA_CERTS` pointing at the exported file, `glab`'s `ca_cert` and git's `sslCAInfo` are proved; `--use-system-ca` with the authority in the store was not run, so it is an extra and never the route (check 71). `gitlabApi` keeps the cause code (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`, `DEPTH_ZERO_SELF_SIGNED_CERT` against `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`) without ever repeating GitLab's or the request's text, so a certificate failure is a different card from an unreachable server. A `glab` error holding `dial tcp`, `connection refused`, `no such host`, `i/o timeout` or `context deadline exceeded` is `HOST_UNREACHABLE`, and `merge` stops swallowing it: a merge that could not reach the host is "not merged, host unreachable", never the same line as a refusal.
- Produces: `caFile(home) -> string` (`<wheelhouseHome>/ca/company.pem`); `exportSystemRoots({ platform, run }) -> string` (PEM text: on macOS `security find-certificate -a -p` over the system roots and the System keychain; on Windows `certutil -store -enterprise Root` and the local machine's Root store, converted); `caEnv(home) -> { NODE_EXTRA_CA_CERTS }` when the file exists, else `{}`; `glabCaArgs(host, file)` (`glab config set ca_cert <file> --host <host>`); `gitCaConfig(base, file, platform)` (`http.<base>/.sslCAInfo <file>`, or on Windows `http.<base>/.sslBackend schannel`); `HOST_UNREACHABLE(base)` ("Your company's GitLab, <base>, can't be reached from here, perhaps off the company network. Work carries on here and is sent when it can be.").

- [ ] **Step 1: Write the failing tests.**

```js
test('no route ever sets GIT_SSL_NO_VERIFY, NODE_TLS_REJECT_UNAUTHORIZED=0, sslVerify false or -k', ...)   // Review Focus 3
test('an unreachable host gives HOST_UNREACHABLE and keeps the push for later', ...)                        // Review Focus 3
test('the certificate is given to Node.js, glab and git for that address only', ...)
test('the Windows form uses the system store for that address', ...)
test('a certificate failure and an unreachable server are different cards', ...)             // check 71
test('a merge that could not reach the host says so, and a stale head says the head has moved', ...)   // check 71
```

- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Trust a company's own certificate authority without switching checks off"`).

### Task 3: `glab` from the company's list, and the typed token

**Safety: yes** (a key typed in)

**Files:** Modify `scripts/setup/tools.js` (a `glabFrom` setting: `gitlab` today, `company <path or address>` where gitlab.com is blocked), `scripts/setup/host.js` (the typed-token fallback, unchanged in kind, offered when no OAuth application exists on the company's GitLab); test `tests/scripts/setup/glab-source.test.js`.

**Interfaces:**
- Produces: `glabSource({ setting }) -> { kind: 'gitlab' | 'company', from }`; the company's copy is checked the same way (version and checksum from the company's list where it gives one; where it gives none, the card says so plainly before use). The typed token goes only into the computer's own box (today's route), never the chat. It stays the route that works wherever the company has registered no OAuth application, and the card says so (check 71); the browser route needs the company's admin to register an application with the scopes check 71 lists, which is the company's item, not setup's. The task decides where `glab` keeps the token: its default is the keyring, and `--insecure-storage` is the only route check 71 saw put the token in a file it could check. `git_protocol` is set to `https` for the host (`glab` defaults to ssh).

- [ ] **Step 1: Tests:** `a company source is used when set`, `a copy with no checksum is named on the card`, `the typed token never reaches an argument or the output`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Take glab from the company's own list where gitlab.com is blocked"`).

### Task 4: Protection, pipelines and secrets, read back

**Safety: yes** (the host's lock)

**Files:**
- Modify: `scripts/host/protection.js` (`readGitlabProtection`, `protectGitlabBranch`, `protectionStatus`), `scripts/host/gitlab.js` (`ciState`)
- Create: `tests/scripts/host/gitlab-protection-ee.test.js` (from `tests/fixtures/gitlab-ee/free/`)

**Interfaces:**
- Produces: `readGitlabProtection` also gives `pipelinesMustSucceed`, `skippedPipelineCounts` (must be false), `variablesUnprotected: string[]` (names only), `mergeAccess` and `plan` (`free` when the approval rules call is refused as check 71 recorded, else `premium`); `protectGitlabBranch` takes `mergeAccess: MAINTAINERS` for a real-user project on Free; `protectionStatus` lists each gap in plain words for setup's card and the board ("<name> is a project secret that a merge request's pipeline could read").
- Check 71 settles the rest: the setting that requires the pipeline's own job by name does not exist at Free, so this task does not add one. A commit status posted with the project key can stand in for a pipeline when the commit has no pipeline, and the bot can arrange that by editing the pipeline file on its own branch. So (a) for a project on Free with real users the board says "the project's tests on the host could be faked with Wheelhouse's key", and such a project needs Premium's approval (Part 9 Task 5); (b) `ciState` in `gitlab.js` reads a head pipeline with `source: external` (a posted status, not a run) as `none`, which narrows Wheelhouse's own gate only: GitLab's own page still shows the merge request as mergeable, and the bot can post a status after a branch is marked ready (an API call, so the helper's block on pushes does not stop it); (c) `variablesUnprotected` is read from the list's `protected: false` and names the variables only, dropping each value on the way in, since a Maintainer's list returns values; (d) the state branch at "No one pushes" refuses Wheelhouse's own direct pushes, so this task either sets "Maintainers" push for the state branch on Free or moves the state elsewhere there, and records the choice in the ledger as a plan's ruling.

- [ ] **Step 1: Write the failing tests** from the recorded responses: `a project with pipelines required and secrets protected has no gaps`; `an unprotected variable is named, never its value`; `Free is told from Premium by the approval call`; `a real-user project on Free merges by Maintainers only`; `a head pipeline from a posted status reads as none` (check 71); `a Maintainer's variable list gives names and never values`; `the board says the host's tests could be faked, for a real-user project on Free`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Read back GitLab's protection, pipelines and secrets"`).

### Task 5: The audit report

**Safety: yes** (it is what catches a false record)

**Files:**
- Create: `scripts/audit/report.js`, `tests/scripts/audit/report.test.js`
- Modify: `scripts/host/adapter.js` (read-only history calls)

**Interfaces:**
- Produces: adapter calls `mergedRequests({ since })`, `pipelinesFor(sha)`, `protectionEvents({ since })` (GitLab audit events on Premium; on Free, protection read now and compared with the last report's); `auditReport({ events, host, since, now }) -> { rows, gaps }`, one row per merged change (request, who approved which commit and when, with its proof, the review and its kind, CI, the level the computer ran at, each Ask allowance, the versions) and a gap for a merge with no approval, an approval for a commit that never merged, a merged commit other than the one approved or reviewed (a Merge click that names no commit merges one pushed just before, check 71), a merge whose head pipeline was `external` (a posted status, check 71), a protection change, and Lean entries marked as Lean's; on Free it reads merges, pipelines and protection from the web API only, since audit events are Premium's; `renderAudit(report) -> string` (Markdown); `node scripts/audit/report.js --project <p> --since <date>`, run through the helper.

- [ ] **Step 1: Write the failing tests:** one per gap kind; `Lean's entries are marked, not gaps`; `a merged commit other than the reviewed one is a gap`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Report every merged change against the host's own history"`).

### Task 6: Setup finds the tier, and moves a project up

**Safety: yes** (the tier decides the controls)

**Files:**
- Create: `scripts/agents/copilot/facts.js`, `scripts/agents/copilot/tier.js`, `tests/scripts/agents/copilot-tier.test.js`
- Modify: `scripts/setup/steps.js` (for a Copilot computer, step 2 is "Can Wheelhouse run here?"), `scripts/setup/engine.js`, `skills/setup/SKILL.md` (the step's words)

**Interfaces:**
- Produces: `gatherFacts({ run, platform, env, project }) -> Facts` (`git`, `node`, `copilotCli`, `vscode`, `addOn`, `host` and `protectionOn`, `sandbox` from the sandbox test when Part 9 has built it, else `unknown`, `guardedSelfTest`, `companySettings`, `workComputer`); `findTier(facts) -> { tier, level, builders: 'chat' | 'background', sentence }`, one branch per row of spec section 6.4's table, in its order, Full only when `hostApprovalReady` (Part 9 Task 5; until then a stand-in in this module that answers false) is true for the host; the quick connection never offered for building on Copilot; `moveUp({ project, now })`: pushes `main` and the record, switches on protection straight after the first push and before any builder runs, writes Lean's record as events (`leanToEvents`), opens a merge request for each feature branch; `moveDown` records the change and the board shows the lower tier and why.

- [ ] **Step 1: Write the failing tests:** one per row of the table; `Full waits for the host's approval route`; `moveUp protects main before anything else runs`; `Lean's entries arrive marked as Lean's`; `each sentence passes plainWords`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Find the tier a computer allows, and move a project up without losing history"`).

## Part 7: Middle, background builders on Copilot: the controls

### Task 1: Copilot sessions

**Safety: yes** (each session's permissions)

**Files:**
- Create: `adapters/copilot/sessions.js`, `tests/scripts/agents/copilot-sessions.test.js`
- Modify: `adapters/copilot/index.js`

**Interfaces:**
- Consumes: check 61's flags and fixtures; `quoteForCmd`.
- Produces: `sessionHome(project) -> string` (`<wheelhouseHome>/projects/<p>/copilot-home`, written by Wheelhouse only); `copilotSessionEnv(env) -> object` (only `PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`, `LANG`, `SystemRoot`, `COPILOT_HOME`, and Copilot's sign-in variables check 61 named); `foremanCall`, `featureStartCall`, `featureResumeCall` (as Claude Code's, Part 3 Task 3) building `copilot -p <prompt> --output-format json --no-auto-update --disable-builtin-mcps --no-ask-user --log-dir <dir> --usage-output-file <path> --agent wheelhouse-<role> --model <routing table's Copilot column> <the level's rules>` (the rules in the `--allow-tool=...` and `--deny-tool=...` `=` form, run in the worktree; checks 61, 64), and `--resume=<id>` for a wake (or `--continue`); the session id is read from the last `result` event; `finalAnswer(stdout)`; `refusalOf(stdout) -> string | null`, which matches the three hook messages first ("Denied by preToolUse hook: <reason>", "(hook errored)", "hook exited with code 2") and so never labels a Wheelhouse guard's refusal a gap in the rules, then the deny-rule message and "no interactive user response was available"; a refusal exits 0, so what happened is decided from the tool events, never the exit code (check 61). No call has `--trust-folder`, `--allow-all`, `--yolo`, `--allow-all-tools` or `--allow-all-paths` except as a level's rules say: trust loads a project's hooks and `.mcp.json` servers, which run outside the permission rules, so background builders run untrusted (checks 56, 61). The environment is built clean: `COPILOT_ALLOW_ALL` removed, the real `HOME` kept (a scratch one breaks the keychain sign-in), the session's own `COPILOT_HOME` holding the signed-in `config.json` **and Wheelhouse's `hooks/wheelhouse.json`**: the person's hook folder is the only place Wheelhouse's hooks load without trust, so a session with its own home has no guards unless Wheelhouse writes that file into it (checks 56, 61). The usage file is read for `totalNanoAiu`, `tokenDetails.*.tokenCount` and `totalPremiumRequestCost`, falling back to the `session.usage_checkpoint` event, then the `result` event's `usage.premiumRequests` (check 64). On Windows the `.cmd` shim goes through `quoteForCmd`. Each session's whole output is kept as its activity at `<wheelhouseHome>/projects/<p>/activity/<session>.jsonl` for `ACTIVITY_DAYS`, and its summary (tools used, commands run, refusals), after the secret scan, is written to state as it happens (kind `activity`).

- [ ] **Step 1: Write the failing tests:** `each call has --no-ask-user and the level's rules`; `a .cmd shim is called through quoteForCmd` (Review Focus 5); `the environment drops an allow-everything variable and the host's tokens`; `finalAnswer and refusalOf read the recorded output`; `a refusal with exit 0 is read as a refusal`; `refusalOf names a guard's refusal before a gap in the rules`; `the own home carries hooks/wheelhouse.json`; `no call carries --trust-folder or an allow-everything flag`; `the activity summary passes the secret scan before it is written`; `activity older than ACTIVITY_DAYS is removed`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Start and wake Copilot sessions with explicit permissions from a clean home"`). **The first real run (agent, Mac) shows that a guard fired in a session started this way,** a call the guard should refuse refused with the guard's own message (checks 56, 61).

### Task 2: Each level's permission rules

**Safety: yes**

**Files:** Create `adapters/copilot/permissions.js`, `tests/scripts/agents/copilot-permissions.test.js`.

**Interfaces:**
- Produces: `levelRules({ level, grants, runner, worktree, domains, platform }) -> { allow: string[], deny: string[] }` in Copilot's rule syntax (check 61): at `sandbox`, the shell allowed (the sandbox holds it); at `guarded`, the shell only as the runner; at `ask`, only the granted commands, each for as long as granted; at `unattended`, the shell; at every level the file tools held to `worktree` with the temporary folder shut, the web held to `domains`, and the deny list from `credentialRules` and `AGENT_CONTROL`. Deny always beats allow, so every deny is also passed at `unattended`. At `guarded` and `ask` the shell rules are `shell(<runner>:*)`, with the runner and the guard behind them, and no MCP-tool runner is needed: no chained form check 61 tried (`&&`, `$( )`, `sh -c`) got past one (check 61). Two cautions, recorded: a read-only command (`ls`) runs with no rule, so a rule list is not a read barrier; and the evidence is one model with `echo` as the runner, so the guard stays in place. Each level's rules allow the loop's tools by name (`task`, `skill`, `sql`, `read_agent`, `apply_patch`), because a tool no rule allows is refused at once headless; checks 61 and 63 did not try them under rules. The file tools' path rules are not relied on to hold writes to the worktree until a write through a link has been tried (check 61): only the read side was shown to hold. `levelAllowed({ level, realUsers, keysUnreadable, hostApproval }) -> { ok, why }`: `unattended` never for a project with real users and only after its own card; until the host's approval is ready (Part 9 Task 5), `sandbox` and `guarded` run with no prompt only where the level's test showed builds can't read the signing key or the connection key, and otherwise the level is `ask`.

- [ ] **Step 1: Tests:** one per level; `the credential and control-file denies are on every level`; `a grant ends when its time ends`; `each level allows the loop's tools by name` (checks 61, 63); `unattended is refused for a real-user project`; `before the host's approval is ready, a level whose test could read the keys becomes ask`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Write each level's rules for Copilot sessions"`). **The first real use shows that the loop's tools ran under the rules, and that a command no rule allows is still refused** with a real saved permission in the real `~/.copilot` (checks 61, 63).

### Task 3: Guarded on Copilot

**Safety: yes**

**Files:** Modify `scripts/windows/guarded.js`; test `tests/scripts/windows/guarded-links.test.js`.

**Interfaces:**
- Produces: `KEPT_NORMAL` already holds the control files (Part 3 Task 6); `removeLinksOut(worktree) -> string[]` runs after every command and removes each symbolic link or junction inside the worktree whose target is outside it, returning what it removed (each recorded in the session's activity); the self-test adds "a link out of the worktree" and "a write to `.github/hooks/x.json`", both of which must fail. Guarded does not lean on Copilot's file-tool path rules for writes (check 61: only the read side was shown to hold, through a link); `removeLinksOut` and the tool guard's real-path check (Part 3 Task 6) are the hold.

- [ ] **Step 1: Tests** (pure parts on every system; the Windows parts skipped elsewhere): `a link out is removed and named`, `a link within the worktree stays`, `the self-test fails if a control file can be written`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Keep control files and links out of reach of Guarded builds"`).

### Task 4: Agent-control files checked before every wake

**Safety: yes**

**Files:**
- Create: `scripts/watcher/control-files.js`, `tests/scripts/watcher/control-files.test.js`
- Modify: `scripts/watcher/waker.js`, `scripts/foreman/` (a card kind `control-file-changed`)

**Interfaces:**
- Produces: `controlFilesState(worktree) -> Map<path, hash>`, read with `fs` only (no git), over `AGENT_CONTROL` and the worktree's `.claude/`; the baseline is taken when the worktree is made; before every wake the waker compares, and on a new or changed file refuses the wake and raises the card ("A feature's folder has a new file that steers agents, `<path>`: look at it before the feature carries on"). For both agents. The waker reads a session's tool events to see a refusal and does not treat exit 0 as success (check 61). The control-file check is wanted for the reasons above and for any route a project file might switch hooks off by; the form tested, `disableAllHooks: true` in `.github/hooks/`, switched off nothing (check 56), and `.github/copilot/**` stays shut to agents.

- [ ] **Step 1: Tests:** `a new .github/hooks file stops the wake and raises one card`, `an unchanged folder wakes as before`, `a file reached through a link is read where it really is`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Refuse to wake a session whose folder gained a file that steers agents"`).

### Task 5: The clean reviewer session, and the signed review

**Safety: yes** (signed reviews)

**Files:**
- Create: `scripts/review/clean-session.js`, `tests/scripts/review/clean-session.test.js`
- Modify: `scripts/host/helper.js` (route `POST /review/run`), `scripts/gate/conditions.js`

**Interfaces:**
- Consumes: check 66's route; `adapterFor('copilot').sessions`.
- Produces: `REVIEW_SESSION_READY` (true for route b only, with the copy rules and the clean check above; if the copy rules cannot be met, it is built behind `false` and the gate refuses with `NO_CLEAN_REVIEW`; check 66); `reviewFolder({ project, sha, files }) -> folder` (check 66's route b, and only route b: `git archive` of the whole tree is ruled out, since it would bring in `.github/`, `AGENTS.md` and the rest): a fresh folder under the system's temporary folder holding only the changed files and the diff, plus named neighbours the task chooses, copied one by one from the helper's own mirror; it then scans the folder for `.github/`, `.claude/`, `.agents/`, `.mcp.json`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and any dot-folder, and refuses with `NO_CLEAN_REVIEW` if one is found. It is clean because the folder is empty of steering files, not because Copilot ignores them; `reviewPrompt({ brief, diff, rules, ci }) -> string` (the brief from the state branch, the diff the helper works out, the project's rules from the default branch's commit, CI's results); `runReview({ project, pr, sha })` starts the session in that folder with a Copilot home made fresh for the review holding only the reviewer agent and the sign-in `config.json`, no `--trust-folder`, and `--agent reviewer --no-custom-instructions --disable-builtin-mcps --available-tools view glob rg` with `--allow-tool=` for the same three; the environment carries neither `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` nor `COPILOT_SKILLS_DIRS`; the prompt carries the diff and says what is and is not in the folder (the reviewer has no `git`); the session reads `finalAnswer`, parses the verdict with the report check's `parseReport(text, 'reviewer')`, and signs a `review` event with `kind: 'clean-session'`; a `cleanCheck` (modelled on `probes/66-clean-review/run.js`, an allow-list that fails closed with `NO_CLEAN_REVIEW`) runs before the verdict is accepted: the arguments hold the flags above and none of the trust or allow-everything flags; Copilot's offline listings (`instruction list`, `lsp list`, `mcp list`, `skill list`) from the same home, folder and environment show no instruction source, language server, MCP server or skill beyond the built-in ones; the debug log's `Plugin activation [agents]` count is 1; the `Disabled tools` line equals route b's recorded 18 names exactly; there is no "Loading repo hooks in prompt mode" or "Loading workspace MCP sources in prompt mode" line; no event names an agent but `reviewer` or a skill that is not built in; no MCP server connected; a missing line or failed listing is a failure; and the reviewer's fixed first line is present, showing it is the agent in effect. The tool set and log lines depend on the Copilot version, so the check is run again on each pin. The gate counts a Copilot review only of kind `clean-session`, or `chat-review` where the tier allows it and the project has no real users; otherwise `NO_CLEAN_REVIEW`.

- [ ] **Step 1: Write the failing tests:** `the review folder holds only the named files and the diff, and none of check 66's planted files`; `a steering file name found in the folder refuses with NO_CLEAN_REVIEW`; `the clean check fails on an extra agent, an extra disabled tool or a missing log line, and passes on check 66's recorded route b session`; `the prompt's rules come from the default branch, not the pull request`; `a verdict planted in a file of the pull request changes nothing`; `with REVIEW_SESSION_READY false the gate refuses with NO_CLEAN_REVIEW`.
- [ ] **Step 2: Run, implement, run `npm test`:** PASS. **Step 3: Commit** (`"Run Copilot's signed review in a clean session the helper starts and reads"`).

## Part 8: Middle, background builders on Copilot: wiring, lineage, usage and the evaluation

### Task 1: The plugin for Copilot CLI, and the watcher on Copilot

**Safety: no**

**Files:**
- Create: `plugin.json` (the Agent Plugins manifest), `adapters/copilot/plugin/com.github.copilot/` (no hooks), `tests/scripts/agents/copilot-plugin.test.js`
- Modify: `scripts/watcher/waker.js` and `scripts/foreman/start.js` (the project's adapter), `scripts/setup/` (where Copilot CLI runs, setup installs the plugin with `copilot plugin install` at the release's tag and commit)

**Interfaces:**
- Produces: a root manifest Copilot reads first (check 56) naming the Lean kit's skills and agents, and carrying no hooks; `.claude-plugin/` unchanged. Check 56 found the root `plugin.json` is read first and its `com.github.copilot/` hooks do run, so the root manifest carries no hooks and `com.github.copilot/` holds none; the `hooks/hooks.json` beside `.claude-plugin/` did not run in that layout (seen with Copilot-format hooks only), so `.claude-plugin/` needs no empty hooks list. Direct installs of a local path are deprecated (check 56): setup's `copilot plugin install` is one function, so a marketplace route replaces it before Copilot drops direct installs, and the ledger says so.

- [ ] **Step 1: Tests:** `the root manifest carries no hooks`; `Copilot installing the plugin loads no Wheelhouse hook from it` (with the stand-in, from check 56's answer); `Claude Code's manifest is unchanged`; `a Copilot project's foreman and features are started by the Copilot adapter`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Package Wheelhouse for Copilot CLI and run the watcher's sessions on Copilot"`).

### Task 2: Lineage and usage on Copilot

**Safety: no**

**Files:**
- Create: `scripts/agents/copilot/versions.js` (extended from Part 4), `tests/scripts/agents/copilot-lineage.test.js`
- Modify: `lineage/manifest.json` (Copilot CLI's pinned version), `scripts/lineage/` (provenance names VS Code's and the Copilot runtime's versions), `scripts/usage/` (per-session use from the usage file the starter asks for, check 64), the routing table (a Copilot column), the tool sheet (the lines check 63 asked for, set out in Part 4 Task 1)

**Interfaces:**
- Produces: `copilotModels({ run }) -> string[]` (the list Copilot offers this person, which may be narrowed by the company), from which setup pins full names in the routing table's Copilot column, a pin moving only after the evaluation passes on Copilot; `readVersions({ home, env }) -> { vscode, runtime, cli }` from `<wheelhouseHome>/agents/copilot-versions.json` (the add-on writes it) or the `COPILOT_CLI_BINARY_VERSION` environment variable (check 58: the hook input carries no version), else only the CLI's; a change from the last recorded versions runs the safety subset (Task 3's runner, scenarios 6, 11 and the four Copilot ones) before the foreman starts new work, and on a failure holds Copilot work with one card, as the lineage hold does; unusual use works on credits. Usage on Copilot shows each session's use only (check 64): the starter's usage file, then the `session.usage_checkpoint` event, then the `result` event, summed across the sessions Wheelhouse started (`finalAnswer` is the last `assistant.message`, which carries no usage). Fields are read by name and a missing one shows as "not available", never zero. The board says "this session's use" and "the sessions Wheelhouse started" and claims no whole-month figure, since the month's total is not reachable with this sign-in and sessions the person starts by hand are not counted. The kits are never edited; the builders may use their loops only because Part 7 Task 2's rules allow the loops' tools by name, and the first real run shows they ran (check 63). Before the tool sheet tells builders to use Wheelhouse's reviewer by `agent_type`, one small run shows that works (check 63 did not try it; its reviews reached Copilot's built-in `code-review` agent); if it does not, the result goes in the ledger and signed reviews rest on Part 7 Task 5.

- [ ] **Step 1: Tests:** `provenance names the versions`, `a version change runs the subset once`, `a failing subset holds Copilot work and raises one card`, `usage reads credits when the output has them and says so when it doesn't`; `readVersions reads COPILOT_CLI_BINARY_VERSION`; `a missing usage field shows as not available, not zero`; `the board claims no whole-month figure`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Record Copilot's versions on every pull request and check a new one first"`).

### Task 3: The evaluation on Copilot

**Safety: yes** (the safety scenarios)

**Files:**
- Create: `adapters/copilot/eval-runner.js`, `tests/eval/copilot/<n>-guard-hangs.js`, `<n+1>-unknown-tool.js`, `<n+2>-agent-filled-answer.js`, `<n+3>-fake-verdict.js` (numbered after the last scenario under `tests/eval/` when written), `docs/evals/copilot.md`
- Modify: `scripts/eval/run.js` (`--agent copilot`)

**Interfaces:**
- Produces: `run({ scenario, home, project, prompt, resume })` with the same results shape as the Claude runner, through `copilot -p` from a clean home; the four scenarios as spec section 9 states them (a hanging guard's call shown and the board line there; an unknown tool refused; a binding answer typed or filled in by the agent not recorded; a builder's fake verdict not moving the helper's review).

- [ ] **Step 1: Write the scenarios and the runner;** run `npm test` (the scenario files' own unit checks).
- [ ] **Step 2: Run on the Mac (agent):** `npm run eval -- --agent copilot --all`, every scenario of the main design (1 to 19) and the build loop (20 to 35) and the four, one trial each; the safety scenarios (6, 11 to 19, the build loop's) and the four must pass. Record each in `docs/evals/copilot.md`. A failure is put right in the task that owns the behaviour before this part ends, or recorded as a ruling with the main session's yes.
- [ ] **Step 3: Commit** (`"Run the safety scenarios and four new ones on Copilot, on the Mac"`).

## Part 9: Full

Needs sitting S3 (check 57, the sandbox) for Task 1's real run and sitting S4 (check 68, the person's own approval) for Task 5's GitHub half. Build both from the documentation and recorded answers first; each stays behind its switch until its check passes.

### Task 1: The sandbox level and its test

**Safety: yes**

**Files:**
- Create: `adapters/copilot/sandbox.js`, `scripts/agents/copilot/sandbox-test.js`, `tests/scripts/agents/copilot-sandbox.test.js`
- Modify: `adapters/copilot/permissions.js` (the `sandbox` level carries its settings), `scripts/agents/copilot/facts.js`

**Interfaces:**
- Produces: `sandboxSettings({ worktree, domains, platform }) -> object` (the sandbox on, `allowUnsandboxedCommands` off, writes held to the worktree, the network held to `domains` and the helper's socket, reads of the keys, `~/.copilot`, `~/.agents` and the credential folders denied; per check 57); `runSandboxTest({ project, run }) -> { passed, results: [{ name, refused }] }`, a sandboxed probe session that tries: reading `keysDir()`'s files; `gh auth token`; `git credential fill`; a token in its environment; a write outside the worktree; an unlisted host; the local network other than the helper; one tool call the guard must refuse. `passed` is true only if every one was refused, except the network on Windows, which is reported. The result is written to state (kind `level`), so the audit report shows the level each change was built at.

- [ ] **Step 1: Tests** with a stand-in session: `one try let through fails the test`, `the network on Windows is reported, not failed`, `the result is recorded`. **Step 2: Run, implement, run `npm test`.** **Step 3 (after sitting S3): run the test for real on the Mac,** record it in check 57's note. **Step 4: Commit** (`"Use Copilot's sandbox only after its test refuses every try"`).

### Task 2: Company settings and the published baseline

**Safety: yes**

**Files:**
- Create: `docs/copilot/baseline/managed-settings.json`, `docs/copilot/baseline/policy-hooks.json`, `docs/copilot/it-note.md`, `scripts/agents/copilot/company.js`, `tests/scripts/agents/copilot-company.test.js`

**Interfaces:**
- Produces: the baseline (spec section 6.4): the sandbox forced on and failing closed, no unsandboxed commands, no "Allow all", reads of the keys, the credential folders and Copilot's own folders denied, `forceRemoteSettingsRefresh` on, every company repository marked as a project with real users, and the policy hook file running the guards; `readCompanySettings({ platform }) -> { managed: object | null, policyHooks: string[] }` from `/Library/Application Support/GitHubCopilot/`, `%ProgramFiles%\GitHubCopilot\`, `/etc/github-copilot/policy.d/` and `C:\ProgramData\GitHub\Copilot\policy.d\`; where company settings exist, setup offers the organisation route, not Locked. `it-note.md` is one page: what Wheelhouse installs and runs, where, what it changes, and the baseline.

- [ ] **Step 1: Tests:** `the baseline holds every rule the spec names`, `company settings found means no Locked offer`, `the IT note fits one page (60 lines)`. **Step 2: Run, write, run `npm test`.** **Step 3: Commit** (`"Publish the baseline a company applies, and read what it has set"`).

### Task 3: Locked on Copilot, on the Mac

**Safety: yes**

**Files:** Modify `scripts/protection/locked.js`, `scripts/protection/managed.js`; test `tests/scripts/protection/locked-copilot.test.js`.

**Interfaces:**
- Produces: `lockedCopilotFiles({ root, projects }) -> [{ path, content, mode }]`: `/Library/Application Support/GitHubCopilot/managed-settings.json` (the baseline's rules, forcing the sandbox for all Copilot work on the computer, as spec section 6.4 says) and `/etc/github-copilot/policy.d/wheelhouse.json` running the managed, root-owned copy of the guards, whose entry checks first whether the folder is a Locked Wheelhouse project; written by the same password step Locked uses for Claude Code (the director's, at sitting S5); the Locked card says the sandbox is forced for every Copilot chat on this computer. Offered on macOS only.

- [ ] **Step 1: Tests:** `the files force the sandbox computer-wide`, `the policy hook does nothing outside a Locked project`, `nothing is offered on Windows`, `Claude Code's Locked files are unchanged`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Offer Locked for Copilot on the Mac"`).

### Task 4: A chat click that binds, at Locked or under company settings

**Safety: yes** (approvals)

**Files:** Modify `scripts/hooks/prompt-record.js`, `scripts/hooks/copilot-entry.js`; test `tests/scripts/hooks/policy-click.test.js`.

**Interfaces:**
- Consumes: check 59's answer (`C6_PASSED`, recorded in `scripts/lib/copilot-numbers.js` after sitting S1).
- Produces: when `copilot-entry.js` runs as the managed copy (a policy hook) and `C6_PASSED` is true, the prompt record signs the click as Claude Code's does (`earned`), with proof `policy-hook`; otherwise nothing changes.

- [ ] **Step 1: Tests:** `a policy hook signs only when C6_PASSED`, `the person's own hook copy never signs`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Sign a chat click only from a policy hook, once check 59 allows it"`).

### Task 5: The person's approval on the code host

**Safety: yes** (approvals)

**Files:**
- Create: `scripts/host/host-approval.js`, `tests/scripts/host/host-approval.test.js` (from `tests/fixtures/gitlab-ee/free/`, recorded by check 71; and Premium's from GitLab's documentation, written by hand into `tests/fixtures/gitlab-ee/premium/` with a header saying so, since no licence came and check 68's GitLab routes are Deferred, H3)
- Modify: `scripts/host/protection.js`, `scripts/gate/conditions.js`, `scripts/host/helper.js` (`/push` refused for a branch marked ready on Free)

**Interfaces:**
- Produces: `setGitlabApproval({ api, projectId, person })` (Premium: one required approval with the person eligible, author's and committers' approval prevented, approvals reset on push, overriding prevented in a merge request); `hostApproved({ api, projectId, iid, sha, person }) -> boolean` (the person among `approved_by` and the merge request's head equal to `sha`); `hostApprovalReady(host) -> boolean` (the Premium switch for GitLab stays off until check 68 passes at Premium, which is Deferred; true for GitLab Free, since check 71's merge-by-Maintainers answer is in and is yes; for GitHub only once sitting S4 passed); on Free, the gate marks the branch ready and the helper refuses further pushes to it (a Merge click that names no commit merges one pushed just before, and the bot can post a status without a push, so the audit report is what shows both; check 71; audit events are Premium's, so Free has none), the person presses **Merge** on GitLab, and the audit report checks the merged commit. For a real-user project the gate needs `hostApproved` (Premium) or the person's own merge (Free), and on Free the tests on the host can be faked with Wheelhouse's key (check 71), so the board says so and such a project needs Premium's approval for its tests to count (check 71 also names the person's own review of the pipeline file, which this plan does not build); where the project's reviews are chat reviews (Middle without Copilot CLI), it also needs a second person's approval on the host where the licence gives approval rules (`setGitlabApproval` with `approvals_required: 2` and the second person eligible).

- [ ] **Step 1: Tests:** `Premium's settings are set and read back` (against the documented fixtures, switch off), `a commit added after the approval removes it`, `the bot's own approval doesn't count`, `on Free a ready branch takes no more pushes`, `GitHub is not ready until its check passes`, `a real-user project with chat reviews needs a second approval`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Require the person's own approval on the code host for real-user projects"`).

### Task 6: After risky periods, new keys and a look at Wheelhouse's own files

**Safety: yes** (signing, secrets)

**Files:**
- Create: `scripts/health/own-files.js`, `tests/scripts/health/own-files.test.js`
- Modify: `scripts/health/` (the weekly look), `scripts/state/signing.js` callers (a renewal after Unattended or a week with Ask allowances)

**Interfaces:**
- Produces: `ownFilesBaseline({ home, root }) -> Map<path, hash>` over Wheelhouse's install, `~/.copilot/hooks`, `~/.copilot/agents`, `~/.copilot/settings.json`, the login entry; `ownFilesChanged(baseline, now) -> string[]`; `renewalDue({ events, now }) -> boolean` (an Unattended period ended, or a week with an Ask allowance); when due, a new signing key is made and enrolled through the helper, and a card asks the person to renew the connection (one code on the host's page).

- [ ] **Step 1: Tests:** `a changed hook file is named`, `renewal is due after Unattended and after a week with an Ask allowance, and not otherwise`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Renew keys after risky periods and look for changes to Wheelhouse's own files"`).

### Task 7: Middle and Full end to end

**Safety: no**

**Files:** Create `tests/e2e/copilot-middle.test.js`, `tests/e2e/copilot-full.test.js`.

- [ ] **Step 1: Write the tests** with a real helper, a stand-in GitLab answering from the recorded responses (Premium's from the documented fixtures, check 68 being Deferred), and stand-in Copilot sessions: a background feature at Guarded from wake to merge request; a control file planted mid-feature stopping the wake; the clean review; at Premium, the person's approval required, a commit after it removing it, the gate refusing then accepting; at Free, the ready branch refusing a push; the audit report with no gaps, then one after a merge made outside the gate.
- [ ] **Step 2: Run `npm test`:** PASS. **Step 3: Commit** (`"Test Middle and Full on Copilot end to end"`).

## Part 10: the add-on: the glance and the buttons

Before this part: sittings S6 (checks 55, 65, 67 and 72). The add-on is optional; nothing before this part relies on it.

### Task 1: The add-on's manifest, and the proof that nothing else can press

**Safety: yes** (binding clicks)

**Files:**
- Create: `vscode/package.json`, `vscode/extension.cjs` (CommonJS, the one exception to ESM, since VS Code loads extensions that way; any `.js` it imports from `scripts/` is loaded with dynamic `import()`), `scripts/addon/validate.js`, `tests/scripts/addon/validate.test.js`
- Modify: `.github/workflows/ci.yml` (the `validate` job also runs `node scripts/addon/validate.js`)

**Interfaces:**
- Produces: `checkAddon({ pkg, sources }) -> string[]`: a problem for any `contributes.commands` entry other than `wheelhouse.openPane`, any `uriHandler` or `onUri` activation, any `languageModelTools` or chat participant whose handler reaches a press, `registerCommand` with any id but `wheelhouse.openPane`, or a call to the press functions outside the webview's message handler `onPaneMessage`; and a webview message counts as a press only when it carries the nonce the pane was drawn with. `extensionDependencies` none; `extensionKind: ['workspace']`.

- [ ] **Step 1: Tests:** one per forbidden form, each failing; the add-on's own sources passing. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Prove from the add-on's package and source that only its pane's buttons can press"`).

### Task 2: The pane and the status bar

**Safety: no**

**Files:** Create `vscode/pane/render.js`, `vscode/pane/style.css`, `tests/vscode/render.test.js`; modify `vscode/extension.cjs`.

**Interfaces:**
- Consumes: the pane's model from `scripts/mod/status.js` (`status.json`); the Calm visual system (main design section 23).
- Produces: `renderPane(model, { nonce }) -> string` (HTML, every text escaped, colours from VS Code's theme variables, as sketched in spec section 8.6: the name with STOP at the top right, the verdict, the cards with **Not now**, **See it ↗**, **Why?**, **Approve** and **Suggest a change…**, smaller items with amber dots, **Board**, **Settings** and **Briefing** at the foot); the status bar item "Wheelhouse · <n> need you" opening the pane; the first-run offer **Put Wheelhouse on the right** as check 67 found VS Code allows, or the picture of the drag, once.

- [ ] **Step 1: Tests:** `card text with markup is shown as text`, `the status bar counts needs-you items`, `the first-run offer shows once`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Draw the add-on's pane and status bar from the pane's model"`).

### Task 3: Buttons that sign

**Safety: yes** (binding clicks, STOP, signing)

**Files:** Create `vscode/press.cjs`, `tests/vscode/press.test.js`; modify `vscode/extension.cjs`.

**Interfaces:**
- Consumes: `press` from `scripts/mod/press.js` (what a press on a card records), `sign`.
- Produces: `onPaneMessage(msg)` takes `{ nonce, card, hash, choice }`; a deciding choice signs the record in VS Code's own process, with proof `add-on`, never through the helper; **STOP** sets STOP at once; **Lift STOP** is a binding press; settings presses as the mod's settings pane; **Briefing** shows `digest.js`'s text with no Copilot turn; VS Code's own notification for needs-you items, previews ready, features finished and STOP. A typed "yes" in the chat never counts.

- [ ] **Step 1: Tests:** `a press with a stale hash records nothing and says why`, `a press without the pane's nonce records nothing`, `STOP is set at once`, `the add-on never calls the helper to sign`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Sign the director's presses in the add-on's own process"`).

### Task 4: Versions, pinning and packing

**Safety: no**

**Files:** Create `scripts/addon/pack.js`, `tests/scripts/addon/pack.test.js`; modify `vscode/extension.cjs`.

**Interfaces:**
- Produces: the add-on writes `<wheelhouseHome>/agents/copilot-versions.json` (`{ vscode, runtime }`, from `vscode.version` and the Copilot extension's version) at start and on change; `pack({ root, out }) -> file`, a `.vsix` (a zip holding `extension.vsixmanifest`, `[Content_Types].xml` and `extension/`), written with Node.js's own `zlib` and a small zip writer, with no npm tool; setup installs it with `code --install-extension <file>` and switches its auto-update off.

- [ ] **Step 1: Tests:** `the .vsix lists every file and opens with unzip`, `the versions file is written`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Pack the add-on without npm tools and record VS Code's versions"`).

## Part 11: the add-on at Lean, the Claude harness, and the close

### Task 1: The add-on does the helper's jobs where Node.js can't run

**Safety: yes** (merges, STOP, approvals)

**Files:** Create `vscode/lean.cjs`, `tests/vscode/lean.test.js`; modify `vscode/package.json` (the chat tools, if check 72 found they reach Copilot's chat).

**Interfaces:**
- Consumes: `scripts/lean/store.js`, run in VS Code's own Node.js; check 72's answers.
- Produces: the add-on's chat tools (`wheelhouse_record`, `wheelhouse_board`: they write nothing binding, only `chat-click` records and the board), or the inbox folder `.wheelhouse/inbox/` the add-on reads where a company switches the tools off; the git store outside the project and merges with hooks off, after an add-on press; each terminal command the chat runs recorded (`window.onDidStartTerminalShellExecution`); STOP also cancelling the chat's running request where check 72 found a way; the copy after every approval; one merge at a time across windows.

- [ ] **Step 1: Tests:** `a chat tool's write is never binding`, `an inbox file is read once and removed`, `a merge runs only after an add-on press for that commit`, `a terminal command is recorded`. **Step 2: Run, implement, run `npm test`.** **Step 3: Commit** (`"Do Lean's helper jobs inside VS Code where Node.js can't run"`).

### Task 2: VS Code's Claude harness, where check 54 passed

**Safety: yes** (if built: it reuses Claude Code's guards in another engine)

**Files:** if check 54 passed: modify `scripts/agents/index.js` (an identity `claude-in-vscode` sharing Claude Code's adapter, with its own safety line), `scripts/setup/` (offered beside the Copilot route where the company allows it); test `tests/scripts/agents/claude-in-vscode.test.js`. If it failed: nothing but a ledger line.

- [ ] **Step 1:** Read check 54's note. If it failed, record and stop this task.
- [ ] **Step 2: Tests:** `setup offers it only where the check passed and the company allows it`, `its safety line names what differs from Claude Code`. **Step 3: Run, implement, run `npm test`.** **Step 4: Commit** (`"Offer VS Code's Claude agent where it runs Wheelhouse as Claude Code does"`).

### Task 3: The designs, the data note and the handover

**Safety: no**

**Files:** Modify `docs/specs/2026-10-20-other-agents-design.md` (status: built; the plan's calls and rulings that are design, in a new section), `docs/data.md` (Copilot's section with spec section 6.6's lines), `README.md`, `HANDOVER.md` (a Copilot item: what is built, what each check found, what waits for which sitting, and the open items from the ledger).

- [ ] **Step 1: Write,** run `npm test` and `npm run private-check`. **Step 2: Commit** (`"Bring the designs, the data note and the handover up to date for Copilot"`).

---

## Held items: the director's clicks and sittings

Agents do every step they can (the director's standing rule). Each item below reaches the director through the main session as one card (what this is, why it comes to them, the options, a recommendation, what happens meanwhile), and each step is one click or one short action. Every sitting starts with a card listing what it changes on the computer and how each is undone.

| Item | When | Computer | Minutes |
|---|---|---|---|
| H1. Sign Copilot CLI in | before Part 1, Task 2 | Mac | 2 |
| H2. Docker Desktop's first start | Part 2, Task 1, only if it asks | Mac | 1 |
| H3. A GitLab Premium trial licence | before Part 2, Task 3 (no licence came: Deferred, held) | Mac | 5 |
| S1. Clicks in the chat, and Lean (checks 59, 70, 54 and 55) | after Part 5 | Mac | 20 |
| S2. Windows (checks 59, 70, 56, 58, 61, 69 and 62 with the timed run) | after Part 5 | Windows with the company's usual limits | 45 |
| S3. Copilot's sandbox (check 57) | before Part 9 | Mac, then Windows 11 with the September 2026 update | 15 + 15 |
| S4. The person's own approval on the host (check 68) | before Part 9, Task 5 | Mac | 10 |
| S5. Locked for Copilot (the password) | Part 9, Task 3 | Mac | 5 |
| S6. The phone, the pane's place, the add-on at Lean (checks 65, 67, 72) | before Part 10 | Mac, then Windows | 15 + 20 |
| S7. The safety scenarios on Windows | after Part 11 | Windows | 15, mostly waiting |

**H1. Sign Copilot CLI in.**
1. Click **Start** on the card. The agent runs Copilot's sign-in and shows a code and a link.
2. Open the link, type the code, click **Authorize**.
3. Click **Done** on the card.

**H2. Docker Desktop's first start.** 1. Click **Accept** on Docker Desktop's own window if it shows one. 2. Click **Done** on the card.

**H3. A GitLab Premium trial licence.** The card's options: **Self-managed trial** (recommended: closest to the tester's company), **gitlab.com trial instead**, **Skip Premium for now** (Premium's routes stay built but switched off).
1. Click **Self-managed trial**. The agent opens GitLab's trial page.
2. Fill in GitLab's form yourself (an agent doesn't enter your details) and submit it.
3. Save the licence file GitLab emails into Downloads; click **Done**. The agent starts a fresh test instance (the first was deleted), loads the licence into it, and deletes it afterwards.

**S1. Clicks in the chat, and Lean, on the Mac.**
1. Click **Start**. The agent opens VS Code on a scratch project with the Lean kit copied in.
2. When a card shows in Copilot's chat, click **Approve**. (Check 59: the agent then tries to fill one in itself; you only watch.)
3. Type "set up Wheelhouse from <the repository> at <tag>" in a new chat; click **Allow** on each command Copilot asks about. (Check 70.)
4. Ask for a one-line feature; click **Approve** when its card shows.
5. Click **Done**. The agent tries the Claude harness and an add-on's contributions (checks 54 and 55) with you watching only where VS Code asks for a click.

**S2. Windows.** Same as S1 at the Windows computer, then:
1. Click **Run checks**: the agent runs checks 56, 58, 61 and 69's Windows parts while you watch.
2. Click **Start the timer**, then set up Wheelhouse as a standard user, clicking only what Windows or VS Code asks. (Check 62's timed run.)
3. Click **Done**.

**S3. Copilot's sandbox.** 1. Click **Start**. 2. In VS Code's settings, switch on Copilot's sandbox where the agent points. 3. Click **Run the test**; watch. 4. On Windows, the same, and **Can't switch it on** if the setting isn't there.

**S4. Your own approval on the host.** 1. Click **Start**; the agent opens a test merge request in your browser. 2. Sign in as yourself and click **Approve** on GitLab's page. 3. Click **Done**. (For GitHub: the same on a test pull request.)

**S5. Locked for Copilot.** 1. Read the card: the sandbox is forced for every Copilot chat on this Mac. 2. Click **Lock it**; type your password when macOS asks.

**S6. The phone, the pane's place, the add-on at Lean.** 1. Click **Start**; the agent installs the test add-on. 2. Click **Put Wheelhouse on the right** when it shows. 3. Lock your phone's screen and wait for the test notification; click **It arrived** or **Nothing came**. 4. On Windows, click **Approve** in the pane once.

**S7. The safety scenarios on Windows.** 1. Click **Start**; the agent runs them. 2. Click **Done** when it says so.

## Plan's calls

Settled here without the director, each listed for the design in Part 11, Task 3:

1. **The guards keep reading Claude Code's input shape;** Copilot's adapter translates into it. Moving the guards to a new shape would touch every guard and test for no gain.
2. **Copilot's hooks start Node.js once per call,** running every guard in one process within one deadline, so a person's other Copilot sessions pay one start, not five.
3. **A refusal on Copilot also exits with code 2,** so a Copilot that ignores the answer's body still refuses.
4. **The Lean kit is generated from the one text and committed,** with a drift test, since a person at Lean copies it with git and has no Node.js to build it.
5. **Lean's record is a dated JSON-lines file per day, committed with the work,** so the copy off the computer carries it and moving up turns it into state events marked as Lean's.
6. **The helper's window passes the card's text as arguments or encoded environment,** never inside a script, and shows only text read from state.
7. **The clean review's folder is built from named files only** (check 66's route b), so it has no `.git`, no hooks and no steering files; `git archive` of the whole tree is ruled out.
8. **The add-on is CommonJS,** the one exception to ESM, and is packed without npm tools.
9. **Locked on Copilot forces the sandbox computer-wide,** as spec section 6.4 says; section 13's older line ("rather than forcing it computer-wide") is stale and is corrected in Part 11, Task 3.
10. **GitLab is tested on a container on this Mac,** with a throwaway certificate authority; Premium only by GitLab's own trial licence.
11. **Every check's switch** (`REVIEW_SESSION_READY`, `C6_PASSED`, `hostApprovalReady`, the sandbox test) **starts off,** so code built before its check passes refuses rather than trusts.

## Order

Parts in order, one per fresh session. Within a part, tasks in order. Part 1 can start once H1 is done; Part 2 needs Docker (H2 if asked) and, for Task 3 only, H3. Part 3 needs nothing from Parts 1 and 2 but runs after them so that their answers are folded in first. Parts 4 and 5 need Part 3. Sittings S1 and S2 come after Part 5; their answers are folded in at the start of Part 6. Parts 6 to 8 need Part 5. Part 9 needs Part 8, and S3 to S5 for its real runs. Part 10 needs S6. Part 11 needs Part 10; S7 closes it.

**If a check answers differently:** each check's task says what changes and where. The answers that would change what the director sees (check 59 on what a chat click proves, check 57 on the sandbox, check 68 on the host's approval) go to the director as one card each, through the main session.

## After this plan

The director tests Wheelhouse on Copilot in real use, starting with the first tester's Windows computer and the company's GitLab, and may revisit any ruling then, the tier for real-user projects first. Publishing the add-on to the VS Code Marketplace, and Copilot offered to other adopters, wait for that and for the safety scenarios passing on macOS and Windows.
