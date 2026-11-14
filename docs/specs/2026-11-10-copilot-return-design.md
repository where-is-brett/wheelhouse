<!-- docs/specs/2026-11-10-copilot-return-design.md -->

# Bringing Copilot back: design (10 November 2026)

**Status:** decided by the director, 10 November 2026: all three decisions (section 9) took the recommended option, and the design is fitted to the director's plan, Copilot Student, where Auto is the only model choice. Design only: no code changes, no Copilot requests and no paid trials were made to write it.

**What it covers:** how GitHub Copilot comes back as a second coding agent against today's code, after it was parked by the core cut (`docs/specs/2026-11-07-core-cut-design.md`, section 4.2; `docs/parked.md`, "Copilot, with its Lean tier"). It is the "short design against the core of that day" that `docs/parked.md` asks for before a parked piece is built again from its tag.

**Builds on:** the main design (`docs/specs/2026-10-17-wheelhouse-design.md`, rulings in section 22), the build loop (`docs/specs/2026-10-18-build-loop-design.md`), and the old Copilot design (`docs/specs/2026-10-20-other-agents-design.md`), whose safety analysis still holds where this document doesn't change it.

**Sources:** the tags `parked/copilot` and `parked/vscode-addon` (both commit `b9d9aad4`, 6 November 2026), read with `git show` and `git diff` against `main` at `3d09f7b9`; and GitHub's and VS Code's own documentation, read on 10 November 2026 and cited inline. A claim marked **(not confirmed)** is one no primary page stated; each becomes a check in the trial (section 7).

## 1. In plain words

Copilot comes back as **a second crew**, not a second Wheelhouse. The First Mate, the cards, the helper with its keys and merge gate, STOP, the intake and the watcher stay exactly as they are. What changes is who does the building on a computer set to Copilot: `copilot -p` sessions instead of `claude -p` sessions, behind the same guards.

Three things are different from the parked version:

1. **No Archon, no Lean, no add-on.** The parked work leaned on Archon (now parked) for its background builders, and on Lean and the VS Code add-on for computers that can't run Node.js. This return uses Wheelhouse's own engine (the watcher, the foreman and headless sessions) and needs Node.js, as Claude Code projects do. Lean and the add-on stay parked (Decision 3).
2. **The director's plan is Copilot Student, with a small allowance.** On 29 October 2026 GitHub reported the account's plan as `free_educational_quota`: 200 requests a month, reset on the 1st, with extra use switched off. Every Copilot step draws on those 200 (section 5).
3. **Auto picks the model.** On Copilot Student, Auto is the only model choice ([plans](https://docs.github.com/en/copilot/get-started/plans)). Wheelhouse passes no model, records which model Auto chose, and saves the allowance by doing fewer Copilot steps, not by picking cheaper models (section 5.3).

What the director would notice, in short: the same chat and cards; a safety line on the Logbook that names the few things Copilot holds less tightly than Claude Code (section 3); a monthly Copilot figure in the briefing ("Copilot: 120 of 200 this month") instead of the weekly Claude figure; and, at 75% of the month's 200, a card before anything stops (section 5.4).

## 2. What the parked work gives us

### 2.1 The seam hasn't moved

`scripts/agents/contract.js` is byte-for-byte the same on `main` as on `parked/copilot`. The parked Copilot adapter (`adapters/copilot/index.js`) fills all eleven parts with nothing pending, so it passes `checkAdapter` as it stands. A check of every named import in the adapter and in `scripts/agents/copilot/` against `main` finds only two missing exports from core files that still exist, both used by Lean alone (`ADDON_LEAN_ON` in `scripts/agents/chat-clicks.js`, `leanMergeDecision` in `scripts/gate/conditions.js`).

That is the good news. The rest of the core has moved underneath: the hooks (`scripts/hooks/`), the waker (`scripts/watcher/waker.js`, with crash resume in `resume.js`), the foreman, the gate's conditions and guardrails, the state views and lineage have all changed since 6 November 2026. An import that still resolves is no proof that its behaviour is the same.

*Note on the brief:* `scripts/agents/engine-parts.js` and its test no longer exist; the guard that keeps Copilot out of the core is now `tests/scripts/agents/core-neutral.test.js`. It already allows `adapters/`, `scripts/agents/`, `tests/` and `docs/`, so this document needs no change to it.

### 2.2 Keep, rewrite, drop

| Group (on the tag) | Size | Verdict | Why |
|---|---|---|---|
| **Adapter, small parts:** `adapters/copilot/identity.js`, `tools.js`, `translate.js`, `tool-sheet.js`, `programs.js` | about 300 lines | **Keep** | Pure mappings. They depend only on `scripts/lib/copilot-numbers.js`, which comes back under `scripts/agents/copilot/` (part 1). The tool map is re-checked against the CLI's tool names at the first capture (trial stage T1) |
| **Adapter, with small changes:** `hooks.js`, `settings.js`, `safety-line.js`, `sandbox.js`, `permissions.js` | about 500 lines | **Keep, adjust** | `permissions.js` copies its shell refusals from Claude Code's project settings, which lost about 50 lines in the cut; the copy is re-derived from today's `scripts/protection/settings.js`. `sandbox.js` imports `scripts/protection/archon.js`, which goes with Archon's lift-out, so its one helper moves into the adapter. The safety line is rewritten for section 3 |
| **Sessions:** `adapters/copilot/sessions.js` | 768 lines | **Rewrite** | Its flags and clean-home approach stand (section 3.2), but the waker now passes a session id to the foreman, runs crash resume and reads `takesColumn`; the sessions part is rewritten against today's `adapters/claude-code/sessions.js` and `scripts/watcher/waker.js` |
| **Hook entry:** `scripts/agents/copilot/hook-entry.js` | 318 lines | **Rewrite** | Its step list names hooks that are gone (`areas`, `chat-question`, the repeat guard). It is rebuilt from today's list in `adapters/claude-code/hooks.js` (section 3.1) |
| **Kits, versions, plugin, company, locked, sandbox test:** `scripts/agents/copilot/{kits,versions,plugin,company,locked,sandbox-test}.js` | about 900 lines | **Keep, adjust** | They read lineage, which lost its copies and agent-pin code in the cut; that code comes back with the pin (part 6). `locked.js` is kept for later and not offered (section 3.6) |
| **Home builder:** `scripts/agents/copilot/home.js` | 430 lines | **Rewrite, smaller** | It built Lean's kit. Its job now is the clean Copilot home for each session: Wheelhouse's agents and pinned skills, regenerated from today's `skills/` and `agents/` |
| **Evaluation runner:** `adapters/copilot/eval-runner.js` and scenarios 38 to 41 | about 500 lines | **Keep, adjust** | It turns Copilot's events into the stream the harness reads. Re-pointed at `scripts/eval/harness.js`, unchanged since the tag |
| **Signed review in a clean session:** `adapters/copilot/review.js`, `scripts/review/clean-session.js` | about 600 lines | **Hold** | It was switched off on the tag (`REVIEW_SESSION_READY` false) and never ran. Reviews go to Claude Code's reviewer or the helper's own route until its check passes (section 3.4) |
| **Helper start:** `scripts/agents/copilot/start-helper.js` | 503 lines | **Drop** | Today's `scripts/host/start-helper.js` is the general start; the Copilot copy existed for Lean |
| **Lean:** `scripts/lean/`, `scripts/state/lean-record.js`, `adapters/copilot/lean-*`, the Lean guard scripts | about 3,400 lines, touching 14 core files | **Stays parked** | Decision 3 |
| **Archon's Copilot parts:** `scripts/engine/archon/copilot-*.js`, `scripts/agents/copilot/{column,engine-home}.js`, probes 74 and 79 | about 1,300 lines | **Drop** | They stand on Archon |
| **The VS Code add-on** (`parked/vscode-addon`): `vscode/`, `scripts/addon/`, `scripts/agents/vscode-held.js` | about 2,450 lines | **Stays parked** | Decision 3. The Copilot adapter's `cards.binding` list loses `add-on` |
| **Generated kit copies:** `adapters/copilot/{home,plugin,skills}/` | 41 files | **Regenerate** | Built from today's skills by the home builder, never restored by hand |
| **Captured Copilot payloads:** `tests/fixtures/copilot/hook-input/`, `sessions/`, `review/` | 53 files | **Keep** | Real CLI 1.0.101 hook input and session output. Re-captured at trial stage T1 and compared |
| **Tests:** about 108 files | about 17,700 lines | **Port with their code** | Only the tests of kept or rewritten files come back; Lean, Archon, add-on and clean-review tests stay on the tag |
| **Docs:** `docs/copilot/` (baseline, IT note, tested versions, trial harness) | 5 files | **Bring back two** | `tested-versions.md` and `trial-harness.md`. The company baseline and IT note wait for a company that needs them |

### 2.3 Core files that need their Copilot line back

Each is one entry, not a branch of logic, so the core still never names Copilot:

- `scripts/agents/names.js`: `AGENTS` gains `'copilot'`; `agentOfConfig` reads the per-computer `agents` map again (the map is still kept in every project's configuration, read today only by `parkedAgentOf`).
- `scripts/agents/index.js`, `project-agent.js`, `translators.js` (`writes: 'helper'`), `tool-sheets.js`, `safety-lines.js`, `usage-words.js`, `sandbox-line.js`, `pins.js`, `of-input.js` (Copilot's camelCase input has no `hook_event_name`).
- `scripts/agents/programs.js`: on a Copilot computer, `claude` is refused as a nested program, as `copilot` is today on a Claude Code computer.
- `scripts/agents/chat-clicks.js`: the chat-click proof (section 3.5).
- `scripts/host/helper.js`: the `/cards/chat-click` route.
- `lineage/manifest.json` and `scripts/lineage/{manifest,check}.js`: the `agents.copilot.cli` pin and its check.
- `scripts/update/parked.js`: the "Copilot is parked" card goes; `scripts/settings/catalogue.js`: section 4.
- Already on `main` and unchanged: Copilot's control folders in `scripts/lib/agent-control.js`, the weekly look at `~/.copilot` in `scripts/health/own-files.js`, and `COPILOT_` in `scripts/agents/variables.js`.

## 3. Claude Code features Wheelhouse relies on, and Copilot

Each row: what Wheelhouse uses today, what Copilot has, the verdict (**matches**, **works round**, **loses**), and what the director would notice.

| Feature | Today, with Claude Code | Copilot | Verdict | What the director notices |
|---|---|---|---|---|
| **A check before every action** | `PreToolUse` hooks (`stop-guard`, `lineage-hold`, `tool-guard`, `protected-tests`, `front-desk-writes`, `card-check`) deny an action; four of them fail closed through `onFailure: block` | `preToolUse` hooks answer `permissionDecision: deny`; a crash or non-zero exit denies; **a time-out lets the action through** (default 30 seconds) ([hooks reference](https://docs.github.com/en/copilot/reference/hooks-configuration)) | **Works round** | Nothing, normally. The Logbook's safety line says that a guard that hangs lets one action through. The guards answer within their own deadline, well inside the registered limit, so a hang is a fault, not the usual path |
| **Hooks on prompts, session start, stop, subagents** | `UserPromptSubmit`, `SessionStart`, `Stop`, `SubagentStop`, `SessionEnd`; context added with `additionalContext`; `Stop` and `SubagentStop` can send work back | `userPromptSubmitted`, `sessionStart`, `agentStop`, `subagentStart`, `subagentStop`, `sessionEnd`, `preCompact` exist ([hooks reference](https://docs.github.com/en/copilot/reference/hooks-configuration)). Checked on 10 November 2026 ([check 96](../checks/96-copilot-trial-t1-t2.md)): `sessionStart` and `userPromptSubmitted` add context; `agentStop` and `subagentStop` can send work back with `decision: block` and a reason | **Matches** | A card left malformed at the end of a turn is caught at once, and a builder's report missing its parts as the subagent stops. A subagent's own prompt and stop come through the same events, named by `agentId`, and the hook entry skips them |
| **Where hooks run and write** | Outside Claude Code's sandbox, so they sign records and start the helper | Inside Copilot's sandbox when it is on. Hooks read the Wheelhouse home but **write only through the helper** (`writes: 'helper'`, as on the tag) | **Works round** | Nothing. If the helper isn't running, a Copilot session refuses as it does under STOP |
| **Headless sessions** | `claude -p`, a session id given up front, `--resume`, permission mode, allowed tools, model and effort per role | `copilot -p` with `--output-format json`, `--allow-tool`, `--deny-tool`, `--model`, `--resume <id>` ([programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference); [command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)). A session id is given up front with `--session-id` ([check 96](../checks/96-copilot-trial-t1-t2.md)), so `idFromRun` is not needed | **Matches** | Nothing |
| **Model and effort per role** | A model and an effort per role from the Thoroughness table | On Copilot Student, Auto is the only model choice ([plans](https://docs.github.com/en/copilot/get-started/plans); [changelog, 24 June 2026](https://github.blog/changelog/2026-06-24-changes-to-model-selection-for-free-and-student-plans/)). `--reasoning-effort` exists in 1.0.105; whether Auto honours it is **still open** ([check 96](../checks/96-copilot-trial-t1-t2.md)) | **Loses** | Thoroughness doesn't change Copilot's model or effort on this plan; it changes how many Copilot steps a piece of work takes (section 5.3). The record shows which model Auto chose |
| **Crash resume** | The waker resumes a feature session that died with no report | `--resume <id>` in the same Copilot home | **Matches** | Nothing |
| **A read-only fork for "why?"** | `whyCall`: `--resume --fork-session` in plan mode with reading tools | No fork found | **Works round** | "Why did you do that?" on a Copilot session is answered by a fresh read-only session given the session's record and final answer, not its live memory. The answer can be thinner |
| **Transcripts** | The context gauge reads token counts from the transcript; the crew view (`scripts/crew/runs.js`) reads each session's JSONL; a skipped card is found in it | Each session's events are kept at `~/.copilot/session-state/<id>/events.jsonl` (under `COPILOT_HOME`) ([config folder reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)). Its record is one JSON object per line (`type`, `data`, `id`, `parentId`, `timestamp`), with token counts per model call in `session.usage_record` ([check 96](../checks/96-copilot-trial-t1-t2.md)) | **Works round** | The crew view shows Copilot sessions once a reader for its events is written (part 9). The context gauge reads the counts from `session.usage_record` |
| **Subagents** | Plugin agents `wheelhouse:builder`, `reviewer`, `tester`, each with its own model; `SubagentStop` names the agent | Custom agents (`.agent.md`) with their own tool list, and their own model on a plan with model choice (on an Auto-only plan Wheelhouse gives them none); a `task` tool runs them ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference); [VS Code subagents](https://code.visualstudio.com/docs/agents/subagents)). `subagentStop` names the agent (`agentName`, `agentType`, `agentId`) and gives its final text as `response` ([check 96](../checks/96-copilot-trial-t1-t2.md)) | **Matches** | Nothing |
| **Nested sessions** | The foreman starts feature sessions as separate processes; agents may not start `claude` or `copilot` from a shell | The same: the waker starts each `copilot -p`; the guard refuses `claude` and `copilot` as nested programs | **Matches** | Nothing |
| **Cards and approvals** | `AskUserQuestion`; `card-check` before it, `prompt-record` records the click after it; reply codes typed in the chat | `ask_user` in the CLI, `askQuestions` in VS Code. Whether a `postToolUse` hook sees the director's answer, and whether the agent can fill one in itself, is **still open**: it is the old check C6, stage T5 | **Works round** until the check passes | Section 3.5 |
| **The sandbox** | Claude Code's sandbox settings written into the project (macOS); Windows at Standard with Guarded build commands | Copilot CLI has its own sandbox (`/sandbox`) ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)); in VS Code it is Preview on macOS and Experimental on Windows ([approvals](https://code.visualstudio.com/docs/agents/run/approvals)). The tag wrote it into each session's clean home, never the project | **Works round** | On the Mac, the safety line says whether the sandbox test passed. On Windows, nothing changes: Standard, as for Claude Code |
| **Locked** | `managed-settings.json` on macOS | Copilot has managed settings and policy hooks, both needing admin rights ([hooks reference](https://docs.github.com/en/copilot/reference/hooks-configuration)) | **Loses**, for now | Locked isn't offered on a Copilot computer. The parked `locked.js` is kept for a later design |
| **Plugin packaging** | A Claude Code plugin from Wheelhouse's marketplace, pinned | The CLI reads plugins, skills (`.github/`, `.agents/`, `.claude/`) and agents ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)). Wheelhouse doesn't install a Copilot plugin: each session gets a clean home holding only Wheelhouse's agents and pinned skills, as on the tag | **Works round** | Nothing |
| **Usage** | The weekly allowance, read from Claude Code's records | A monthly allowance; on the director's plan, 200 requests (section 5). The tag read per-session use from `--usage-output-file` (`premiumRequests`); it still reports it on this plan (`premiumRequests` on the run's last line, and `totalPremiumRequestCost` in the file), cumulative across resumes, and above GitHub's own figure for the account ([check 96](../checks/96-copilot-trial-t1-t2.md)) | **Works round** | The briefing shows "Copilot this month" as requests used out of 200 |
| **The compaction hold** | `PreCompact` blocks an automatic compaction until the session has written its notes | `preCompact` exists and **cannot block** a manual compaction ([check 96](../checks/96-copilot-trial-t1-t2.md)); an automatic one is **still open** | **Loses** | A long Copilot session may compact before its notes are written. Headless sessions are short, so this rarely matters |
| **Phone notifications** | Wheelhouse's own routes (section 13 of the main design), not Claude Code's | Unchanged | **Matches** | Nothing |

### 3.1 The hook steps

The rewritten hook entry runs the same step list as `adapters/claude-code/hooks.js` today, mapped by event:

- `sessionStart` → `session-start` (helper start, pending records, lineage hold, the "where you were" digest).
- `userPromptSubmitted` → `stop-word`, `context-gauge`, `prompt-record`, `board-context`.
- `preToolUse` → `stop-guard` and `lineage-hold` on every tool; `tool-guard` on file, shell and MCP tools; `protected-tests` and `front-desk-writes` on edits and shell; `card-check` on the ask tool.
- `postToolUse` → `prompt-record` on the ask tool (once check C6 passes), `feature-status` on every tool.
- `subagentStop` → `report-check`, `feature-status`; `agentStop` → `card-check`, `feature-status`, `aside-overlap`; `sessionEnd` → `stop-guard`, `helm-end`.

An unknown tool is refused, and `apply_patch` gives one guard check per path, as on the tag (`adapters/copilot/translate.js`). Hooks are registered once per computer in the person's Copilot hooks folder (`~/.copilot/hooks/wheelhouse.json`), checking for a Wheelhouse project first, and in each session's clean home. Nothing goes into the project, since a project's hooks load only in a trusted folder.

### 3.2 Sessions

Kept from the tag: every session is `copilot -p <prompt> --output-format json --no-ask-user --agent wheelhouse-<role>` with narrow `--allow-tool` and `--deny-tool` rules, its own Copilot home (`COPILOT_HOME`), and an environment cleared to an allow-list. Wide switches (`--allow-all`, `--yolo`, `--add-dir`) are refused by the adapter. The flags were read from the CLI at version 1.0.101; every one is re-checked against `copilot --help` at the pinned version before use, as the evaluation harness already does for Claude Code.

The foreman's session is given one allow rule, `shell(node '<wheelhouse-root>/scripts/foreman/wake.js':*)`, made from the record `adapters/copilot/home/rules/wheelhouse-foreman.json` (built from the foreman's playbook by `scripts/agents/copilot/home.js`), and no write rule. Its agent file holds `tools: []`. **Still open until the first real run:** that Copilot reads an empty tool list as no tools. Until a run shows it, the rule is the only thing known to hold the foreman to that one command, and the guards behind it (`tool-guard`, `stop-guard`) are not relied on to make up for it. A feature session's rules are made from its level: `levelAllowed` decides which level runs, and only then does `levelRules` make that level's rules.

On a plan where Auto is the only choice, the sessions part passes **no `--model`** and no `COPILOT_MODEL`, so Auto chooses. The model Auto chose is read from the session's output and kept in the session's record and the usage store. The CLI shows which model Auto used ([changelog, 17 April 2026](https://github.blog/changelog/2026-04-17-github-copilot-cli-now-supports-copilot-auto-model-selection/)); it appears in `--output-format json` as `session.auto_mode_resolved` (`chosenModel`), and in the usage file as `currentModel` ([check 96](../checks/96-copilot-trial-t1-t2.md)). On a plan with a model choice, the sessions part reads the model from the routing table's Copilot column (section 4).

### 3.3 Where the director talks

On a Copilot computer the director talks to the First Mate in **VS Code's Copilot chat** (agent mode, the Copilot harness), with Wheelhouse's First Mate agent and instructions from the person's Copilot folder. The director rarely uses the terminal, and the chat is where Copilot users already are. The CLI's interactive mode works too and is what the trial drives. VS Code's hooks are Preview ([VS Code hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)); the Local harness is refused at session start, as in the old design's section 6.2.

### 3.4 Reviews

A signed review needs a reviewer the builder can't steer. On the tag that was a clean Copilot session behind a switch that never turned on. Until its check passes, a Copilot project's required reviews run as a **Copilot reviewer subagent recorded as "review, not proven"**, and the merge gate treats it as Claude Code's chat review: enough for the quick and small lanes, while feature and critical work also needs the director's approval card (as `autonomy: cautious` already asks). The safety line says so.

### 3.5 Approvals

The director ruled on 21 October 2026 that a click in Copilot's chat is the everyday approval (old design, section 12). That stands. Until check C6 shows that a hook sees the director's own click and an agent can't fill one in, a chat click is recorded with the proof `chat-click` and marked **not proven**; the steps no chat click decides (`CONFIRMED_STEPS` in `scripts/agents/chat-clicks.js`: lifting STOP, changing a guardrail, unattended running, runbook steps, a CI push, an allowance) go to the helper's window, as they do now. The code host's own branch protection stays behind it all.

### 3.6 What Copilot can't promise

Said plainly on the Logbook and at setup, in the old design's words where they still apply:

- A guard that hangs past Copilot's limit lets that one action through.
- Approvals in Copilot's chat are not proven until check C6 passes.
- Reviews are not proven until the clean reviewer passes its check.
- Locked isn't offered.
- On Windows, as for Claude Code, there's no sandbox: Standard with Guarded build commands.

## 4. Settings

| Setting | Today | After the return |
|---|---|---|
| `capRequests` ("AI credits a month", 0 to 10,000) | Retired with Copilot (`RETIRED` in `scripts/settings/catalogue.js`) | **Stays retired.** It was read only by Archon's spend meter, and its default of 0 meant "work that needs credits waits", which made sense only beside Archon. Old records still load |
| `agents` (per-computer agent, in the project's configuration) | Kept, read only to say Copilot is parked | **Read again:** which agent this computer's crew uses. Set by setup, changed by the First Mate as a level-3 decision |
| `agentRouting.copilot.<role>` | Removed with the cut | **Not brought back.** On an Auto-only plan there is nothing to route. For a plan with a model choice, a Copilot column in the routing table names a class per role (cheapest, mid-priced, most capable), pinned to model IDs once in `scripts/agents/copilot/`, as section 14.6 of the main design does for Claude Code. That column is built only when a director on such a plan needs it (section 8, part 8) |
| **`copilotPlan`** (new, profile) | | What this person's Copilot plan allows. **`auto-only`**: Auto is the only model choice, and the allowance is counted in requests (Copilot Student and Copilot Free, as observed on 29 October 2026). **`credits`**: a paid monthly plan with model choice, billed in AI credits. **`requests`**: a yearly plan still on premium requests, with model choice. Setup reads it once from what GitHub reports for the account and the models the CLI offers, and asks only if it can't tell. The default is `auto-only` |
| **`copilotAllowance`** (new, profile) | | The month's allowance in the plan's own unit, as GitHub reports it: **200** requests on the director's plan. Setup reads it and re-reads it on the 1st |
| **`copilotCeiling`** (new, profile) | | The most the director wants Copilot to cost a month, in US dollars, plan included. Default **20** (Decision 1). It applies only on a plan that can charge; on the director's plan extra use is off and GitHub charges nothing, so the 200 requests are the limit |
| `usageMark` (Usage nudge) | Nudges at a share of the weekly allowance | Unchanged, read against the Copilot month on a Copilot computer: 75% of 200 is **150 requests** |
| `efficiency` (Thoroughness) | Picks the column of the routing table | On an Auto-only plan it changes **how many Copilot steps** a piece of work takes (section 5.3), not the model or effort. The default for a Copilot computer is **Lightest** |
| `premium` (Premium model) | `off`, `within-plan`, `paid-too` | Not offered on an Auto-only plan, where there are no premium choices. On a plan with model choice, "premium" means the most capable class; `off` by default |
| Switches in `copilot-numbers.js` | On the tag: `BACKGROUND_SESSIONS_READY`, `REVIEW_SESSION_READY`, `COPILOT_SANDBOX_CHECKED`, `C6_PASSED`, `ADDON_LEAN_READY`, `CLAUDE_HARNESS_CHECKED` | The first four come back, all off, each turned on by a passed trial stage. `ADDON_LEAN_READY` and `CLAUDE_HARNESS_CHECKED` are dropped with Lean and the add-on |

The file moves from `scripts/lib/copilot-numbers.js` to `scripts/agents/copilot/numbers.js`, so it sits inside the folders the guard test allows.

## 5. Cost

### 5.1 The director's plan

**Observed on the director's account, 29 October 2026:**

- GitHub reported the plan as `free_educational_quota`: **200 requests a month**, reset on the 1st, with **extra use switched off**.
- The Copilot CLI offered only **Auto, at 1x**. Every Copilot step uses the allowance; no model is free.
- So Copilot costs the director nothing in money. The limit is the 200 requests, and when they're gone GitHub stops Copilot work until the 1st.

**What GitHub's pages say, read 10 November 2026:**

- Copilot Student is free to verified students. On Copilot Free and Copilot Student, "access to models is available through auto model selection only", and all plans include the Copilot CLI ([plans](https://docs.github.com/en/copilot/get-started/plans)).
- From 24 June 2026, Free and Student use Auto as "the default and only model selection experience" ([changelog](https://github.blog/changelog/2026-06-24-changes-to-model-selection-for-free-and-student-plans/)).
- Auto "is billed based on the model it selects"; in the CLI it uses models with multipliers from 0x to 1x, and the CLI shows which model it used. The 10% discount for Auto is for paid plans only ([changelog, 17 April 2026](https://github.blog/changelog/2026-04-17-github-copilot-cli-now-supports-copilot-auto-model-selection/); [Auto model selection](https://docs.github.com/en/copilot/concepts/models/auto-model-selection)).
- In the CLI, a prompt counts as one request at the model's multiplier ([requests](https://docs.github.com/en/copilot/concepts/billing/copilot-requests)).

**Where the pages and the account differ:** GitHub's pages now describe Copilot Student's allowance in AI credits, without a figure ([usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/billing-for-individuals)), while the account reported 200 requests. Wheelhouse goes by what the account reports, read by setup and again on the 1st. If GitHub moves the account to credits, `copilotAllowance` changes unit and the 75% card follows.

**Checked on 10 November 2026 ([check 96](../checks/96-copilot-trial-t1-t2.md)):** a subagent's turn is not its own request; a resume is a new request; a continuation after a blocked `agentStop` is a new request; the allowance resets on the 1st (`quota_reset_date` was 2026-12-01). **Still open:** whether Auto on this plan ever picks a 0x model (the plan offered one model, counted 1x by the CLI); whether a step that fails part-way still counts.

**Other plans,** for a director who isn't on Copilot Student: paid monthly Pro bills in AI credits (US$10 a month with 1,500 credits, extra use only with a budget set) ([usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/billing-for-individuals)); yearly plans bought before 1 June 2026 keep 300 premium requests a month ([requests](https://docs.github.com/en/copilot/concepts/billing/copilot-requests)). `copilotPlan` covers both; their details aren't designed further here.

### 5.2 What a piece of work might cost

Measured at trial stage T3 on 14 November 2026, on an Auto-only plan with no model passed. One quick-lane change on a throwaway project, from the First Mate's order to the helper's local merge, killed once mid-task and resumed:

| Step | Requests |
|---|---|
| Feature session (killed mid-task) | 1 |
| Resume by session id, finishing the change | 1 |
| **The quick change** | **2** |

The estimate before T3 was 3 to 5. An earlier T3 attempt the same day, which stopped at the merge because the trial's helper wasn't running, also used 2. No subagent ran in either attempt, so T3 adds nothing to check 96's finding that a subagent's turn is not its own request.

From that measure, counting one request per `copilot -p` prompt at 1x:

- a quick change: one feature session and a resume if it is interrupted, **1 to 2 requests**, plus one for each further resume;
- a small feature: a plan, a build in a few wakes, a review, about **8 to 15 requests** (an estimate; not yet measured);
- each foreman wake that needs a Copilot session: **1 request**;
- each message the director sends the First Mate in Copilot's chat: **1 request**.

At these figures, 200 requests is roughly 10 to 20 small features, or many more quick changes, a month alongside the director's own chat.

### 5.3 Using fewer requests, since the model can't be chosen

On an Auto-only plan Wheelhouse passes no model (section 3.2) and saves the allowance by doing fewer Copilot steps:

- **The foreman runs as scripts where it can.** A wake whose outcome the scripts can settle (a merge, a lane change, a report filed) uses no Copilot session; only a wake that needs judgement starts one.
- **Thoroughness counts steps.** At Lightest (the default on Copilot): a quick change is one session that builds and checks its own work, with the helper's tests as the review; a feature has one plan, one build session and one review. At Balanced: a separate reviewer for every piece, and a tester for features. Thorough isn't offered on this plan.
- **Reviews of critical work** keep their own reviewer at every setting. If the allowance can't cover one, the work waits rather than merging unreviewed.
- **Every session records what Auto chose**, so the director can see it and the evaluation can tell whether Auto's choices change results.

On a plan with model choice, the cheapest class goes to the foreman, builders, testers and routine reviews, and the mid-priced class to the First Mate, design and critical reviews; "most capable" only with `premium` on.

### 5.4 Near the limit

Wheelhouse reads the month's use after every Copilot session and paces to `copilotAllowance` (and to `copilotCeiling` on a plan that can charge):

1. **At the usage nudge, 150 of 200 requests (75%):** one card. "Copilot has used 150 of this month's 200 requests. Carry on as now / Hold new work until the 1st / Finish what's started, then hold." Recommended: finish what's started, then hold. Meanwhile, work in progress carries on.
2. **At 180 of 200 (90%):** new work isn't started; work in progress finishes its current task and stops at a clean point, with its worktree and commits kept. One card says so, with the date the month resets.
3. **At 200, when GitHub refuses:** with extra use off, GitHub stops Copilot work. A session that GitHub refuses ends with its worktree kept; the waker recognises the refusal and holds the piece as "waiting for the month", never as a failure, and resumes it on the 1st with "carry on from what's there". STOP, the cards and the helper keep working, since they use no requests. The First Mate's chat in VS Code stops too, so the waiting card is also shown by the helper's own window.

Wheelhouse never turns on extra use or sets a budget on GitHub.

## 6. Decided

By this design:

- Copilot returns as a crew on Wheelhouse's own engine, with the First Mate, helper, gate and STOP unchanged.
- Node.js is required, as for Claude Code.
- The director's chat is VS Code's Copilot chat; the CLI is for headless sessions and the trial.
- Approvals follow the director's ruling of 21 October 2026, marked not proven until check C6 passes.
- On an Auto-only plan Wheelhouse passes no model and records what Auto chose; Thoroughness on Copilot starts at Lightest.
- `capRequests` stays retired; `copilotPlan`, `copilotAllowance` and `copilotCeiling` replace it.
- The guard test needs no change: the design lives in `docs/`, and the code goes in folders it already allows.

By the director, 10 November 2026 (section 9): pace to US$20 a month with a card at 75%; the Mac first, then a Windows work computer; Lean and the add-on stay parked.

## 7. The trial

Real runs, driven by agents in nested sessions on the Mac through tmux, as today's trials are. The director is needed only for clicks only they can make: signing in to Copilot (the device sign-in), one card click (T5), and the Windows stage on a work computer (T6).

**Testing always uses the cheapest models.** On the director's plan that means **Auto with no premium choices**: no `--model`, no `COPILOT_MODEL`, and no model picker touched in VS Code. On a plan with model choice, the trial passes the cheapest class.

**Budget.** The whole trial is sized at **about 40 requests**, a fifth of the month's 200, with a hard stop at 60. Before each stage the trial reads the month's use and doesn't start the stage if it would pass 60 for the trial or 150 for the month. Every `copilot -p` run is counted before it starts, and the stage stops at its own budget.

| Stage | What runs | Answers | Budget | Needs the director |
|---|---|---|---|---|
| **T0, offline** | The restored adapter against the kept fixtures and the probes' stand-ins (`fake-copilot.js`) | That the parts fit today's core | none | no |
| **T1, capture** | `copilot --help` at the pinned version (no request); one `copilot -p` hello with no model given, in a throwaway folder, with a logging hook on every event | The flags; the hook input for each tool and event; whether a session id can be given up front; the events file's format and token counts; how use is reported; what the account reports as its plan and allowance; where the model Auto chose appears | 2 requests | the Copilot sign-in, once |
| **T2, guards** | Scripted sessions, several attempts each, that try what the guards refuse: a write outside the worktree, a key read, a nested `claude`, an unknown tool, a hook that hangs, a malformed card | That denials hold; how a time-out shows; whether `agentStop` and `subagentStop` can block and name the agent; whether `preCompact` can block; whether a resume counts as a request | 8 requests | no |
| **T3, a piece of work** | One quick-lane change on a throwaway test project kept on the computer (local hosting), from the First Mate's order to the helper's merge, killed once mid-task to test crash resume | The whole loop; crash resume; real requests per piece, and whether subagents count, replacing section 5.2's estimate | 10 requests | no |
| **T4, the evaluation** | Copilot's four safety scenarios (38 to 41) and the shared safety scenarios that touch guards, once each | The bar for offering Copilot (section 9 of the old design) | 15 requests | no |
| **T5, C6: the click** | A card in VS Code's Copilot chat answered by the director, then the same card answered by an agent | Whether a chat click can be proven | 2 requests | **yes**: one click |
| **T6, a Windows work computer** | Setup on Windows with a company GitLab project, one quick change to merge | PowerShell and the `.cmd` shim, the hook forms, the company's program rules | 5 requests | **yes**: the computer and its sign-ins |

T1 to T4 run early in a month, so a stage that finds a surprise has room to repeat. A small feature, the full evaluation suite and longer runs wait for a month with room after T3 has measured the real cost.

## 8. The build parts

Each part is its own fresh session, runs the tests of the files it touches, and leaves the whole suite to CI. Nothing is switched on for a real project until part 11.

1. **The seam's entries.** Bring back `scripts/agents/copilot/numbers.js` (from `scripts/lib/copilot-numbers.js`, switches off, Lean and add-on switches dropped) and Copilot's one-line entries in `scripts/agents/{names,index,project-agent,translators,tool-sheets,safety-lines,usage-words,sandbox-line,pins,of-input,programs}.js`, with the adapter's `sessions` part pending. **Done when** `checkAdapter` passes with `pending: ['sessions', 'evalRunner']`, the core-neutral test passes unchanged, and a Claude Code project behaves exactly as before.
2. **The adapter's small parts.** Restore `adapters/copilot/{identity,tools,translate,tool-sheet,programs,hooks,settings,safety-line,sandbox}.js` and their tests; move `sandbox.js`'s Archon helper into the adapter; rewrite the safety line for section 3.6. **Done when** the restored tests pass against the kept fixtures (T0).
3. **Permissions.** Restore `adapters/copilot/permissions.js` with its shell refusals re-derived from today's `scripts/protection/settings.js`. **Done when** a test shows each of today's Claude Code shell denies has its Copilot rule, and no wide switch can be produced.
4. **The hook entry.** Rewrite `scripts/agents/copilot/hook-entry.js` to section 3.1's step list, writes through the helper, its own deadline inside the registered limit. **Done when** each kept hook-input fixture gives the same answer as the Claude Code input for the same action, and a hook given no helper refuses.
5. **Trial stage T1 and T2.** Run them (section 7); re-capture fixtures; record the answers in `docs/checks/`. **Done when** each "not confirmed" in sections 3 and 5 has an answer or is marked as still open, and parts 2 to 4 are adjusted to what was found.
6. **Kits, home and pin.** Rewrite `scripts/agents/copilot/home.js` to build each session's clean home from today's `skills/` and `agents/`; restore `kits.js`, `versions.js`, `plugin.js`; the `agents.copilot.cli` pin in `lineage/manifest.json` and its check in `scripts/lineage/`. **Done when** the home is built from a clean checkout and the lineage check holds a Copilot session when the installed CLI differs from the pin.
7. **Sessions.** Rewrite `adapters/copilot/sessions.js` against today's waker: foreman and feature calls, resume, final answer, the session id read from the run, the waiting-for-the-month refusal. On an `auto-only` plan no `--model` and no `COPILOT_MODEL` are passed, and the model Auto chose is read from the output and kept in the session's record. **Done when** the waker's tests run against a Copilot stand-in, including crash resume and a run where no model is passed, and `BACKGROUND_SESSIONS_READY` stays off.
8. **The plan, usage and the month.** `copilotPlan`, `copilotAllowance` and `copilotCeiling` in `scripts/settings/catalogue.js`; Thoroughness as a count of steps on Copilot (section 5.3); the foreman's script-only wakes; a reader for Copilot's use (`scripts/agents/copilot/usage.js`) feeding `scripts/usage/`; the nudge at 150, the hold at 180, the waiting state at 200 and the briefing line. The routing column for plans with model choice is left out until a director on such a plan needs it. **Done when** a test month of recorded requests walks through section 5.4's three steps with the right cards.
9. **Chat clicks and the First Mate in VS Code.** The `/cards/chat-click` route in `scripts/host/helper.js` with the not-proven proof; the First Mate's agent and instructions in the person's Copilot folder; a reader for Copilot's events in `scripts/crew/` for the crew view. **Done when** a stand-in click is recorded as not proven, and every confirmed step still goes to the helper's window.
10. **Evaluation runner, and trial stages T3 and T4.** Restore `adapters/copilot/eval-runner.js` and scenarios 38 to 41 against today's harness, passing no model on an `auto-only` plan; run T3 and T4 within their budgets. **Done when** the safety scenarios pass on the Mac and section 5.2 holds measured figures.
11. **Setup, update and switching on.** Setup's agent choice per computer, the hooks file, the Copilot sign-in step, reading the plan and allowance from the account; uninstall; the update drops the "Copilot is parked" card; `BACKGROUND_SESSIONS_READY` turns on. **Done when** an agent sets up a fresh project on Copilot from the First Mate's chat and a quick change merges.
12. **Documents.** `docs/parked.md` moves Copilot to "brought back" (Lean stays listed), `docs/copilot/tested-versions.md` and `trial-harness.md`, section 22 of the main design, `HANDOVER.md` and `docs/data.md`. **Done when** they match what was built.

Trial stages T5 and T6 follow part 11, as the director's two sittings. Parts 2 and 3 can run side by side; parts 6 and 8 can run side by side after part 5.

## 9. Decisions

All three decided by the director on 10 November 2026, each with the recommended option. The cards are kept as asked.

### Decision 1: how much Copilot may cost a month

**Decided 10 November 2026: option 1.** Wheelhouse paces to US$20 a month with a card at 75%. On the director's plan (Copilot Student, extra use off) Copilot costs nothing in money, so the binding limit is the 200 requests and the card comes at 150 of them (section 5.4). The US$20 ceiling applies if the plan ever changes to one that can charge.

- **What this is:** Copilot charges by use beyond a monthly allowance. Beyond the allowance, work stops unless you set an extra budget on GitHub's billing page, which only you can do.
- **Why it comes to you:** it's your money, and the trial uses this month's allowance.
- **Options:**
  1. **US$20 in all:** Wheelhouse paces work to US$20 and asks at 75%.
  2. **The plan only:** no extra budget. Work stops when the allowance is used and carries on next month.
  3. **More than US$20:** you name the figure.
- **Recommendation:** option 1.
- **Meanwhile:** the build parts that spend nothing (1 to 4) start; the trial waits for your answer.

### Decision 2: where Copilot is first used for real

**Decided 10 November 2026: option 1.** The Mac first, then a Windows work computer.

- **What this is:** after the trial on this Mac, Copilot needs one real project to prove itself.
- **Why it comes to you:** it decides which computer you sit at for the two short sittings (a card click, and setup on a Windows work computer).
- **Options:**
  1. **The Mac first, then a work computer:** the first real project runs on the Mac with Copilot; a Windows work computer with a company GitLab follows once it holds.
  2. **The work computer straight away:** setup on Windows with a company GitLab as the first real use.
- **Recommendation:** option 1. Agents can drive everything on the Mac without you, and a fault found there costs nothing at work.
- **Meanwhile:** the build goes on; nothing is set up on either computer until part 11.

### Decision 3: Lean and the VS Code add-on

**Decided 10 November 2026: option 1.** Lean and the add-on stay parked.

- **What this is:** Lean ran Wheelhouse with no Node.js, for work computers that block it, and the add-on drew a Wheelhouse panel in VS Code. Both are parked and would add about 6,000 lines back.
- **Why it comes to you:** bringing a parked piece back is your call.
- **Options:**
  1. **Keep them parked:** Copilot needs Node.js, as Claude Code does. If a work computer blocks Node.js, we find out at its sitting and bring you a card then.
  2. **Bring Lean back too:** Copilot works even where Node.js is blocked, with the gaps the old design listed (approvals in the chat or the helper's window, no guards before each action).
  3. **Bring both back.**
- **Recommendation:** option 1. Nothing yet says a work computer blocks Node.js, and Lean holds much less than the rest of Wheelhouse.
- **Meanwhile:** the build goes on without them.
