<!-- docs/specs/2026-10-20-other-agents-design.md -->

# Wheelhouse with other coding agents, starting with GitHub Copilot: design

**Status:** approved by the director on 21 October 2026, and ready for a build plan (section 14 gives the order of work). Nothing here is built. The director will test it in real use and may revisit any ruling then. The add-on's look (section 8.6) is the director's ruling of 20 October 2026.

**What it covers:** how Wheelhouse runs with a coding agent other than Claude Code, starting with GitHub Copilot in VS Code, and how the same seam leaves room for Codex, Cursor and Gemini CLI later, without designing those now.

**Builds on:** the main design, `docs/specs/2026-10-17-wheelhouse-design.md`, and the build loop, `docs/specs/2026-10-18-build-loop-design.md`. Everything they say still holds for Claude Code. Where this document says how a piece works on Copilot, it adds to them; it changes nothing for Claude Code.

**Inputs:**

- `docs/research/copilot-vscode-2026-10.md`: what Copilot in VS Code supports today, from the official documentation and release notes, read on 20 October 2026;
- `docs/research/copilot-cli-and-standards-2026-10.md`: Copilot CLI, and what Codex, Cursor and Gemini CLI share with it;
- the key claims on hooks, harnesses and plugins, re-read by the designer from the official pages the same day;
- the built code on `main` at 260853f.

**Marks:** *Designer's call* marks a choice the director may override; section 13 lists them. Section 12 holds the director's questions and rulings.

## 1. Intent

Several people who might adopt Wheelhouse have GitHub Copilot in VS Code and nothing else. Most of them use Windows, and many on computers they don't administer. Today Wheelhouse needs Claude Code, so they can't use it.

Wheelhouse is mostly agent-neutral already. The state branch, the host helper, the merge gate, the host adapter, the watcher, the board, the briefing, the card composer, settings, the profile and the runbook are Node.js programs that don't care which agent calls them. What ties Wheelhouse to Claude Code is a thinner layer: how it is packaged and installed, how its hooks are registered and what their input looks like, the sandbox and settings files it writes, Locked's computer-wide file, how a card's click is recorded, how sessions are started, the mod, and the wording of its playbooks.

This design draws that seam on purpose: **one shared core, and a small agent adapter for each agent**. Copilot gets the first adapter after Claude Code's.

## 2. Goals, non-goals and anti-goals

**Goals**

1. Someone with only Copilot in VS Code gets the same Wheelhouse: the front desk, the foreman, feature sessions, cards, the board and briefing, STOP, the runbook and the gate.
2. Windows is a first-class platform for Copilot from the start, since most of the people waiting use it.
3. One core. Each agent adds an adapter, never a second copy of the playbooks, the gate or the state.
4. The safety promise is stated per agent, in plain words, on the board. Where Copilot holds less than Claude Code, the director and every adopter is told exactly what.
5. Adding a later agent means writing one adapter and passing the same evaluation and safety scenarios. Nothing in the core changes.

**Non-goals**

- Copilot's cloud agent. Wheelhouse is local-first.
- VS Code's older Local harness (section 3.1). Wheelhouse runs in the Copilot harness.
- Designing Codex, Cursor or Gemini CLI now. Section 10 only checks that the seam fits them.
- Two agents building in one project at the same time. A project can move from one agent to another, since state doesn't care, but one computer's foreman uses one agent.
- Changing anything for Claude Code users.

**Anti-goals** (failures even if everything works)

- A Copilot user believes they have Claude Code's protection when they don't.
- The playbooks drift into a Claude version and a Copilot version.
- A Copilot user meets Claude-only instructions ("use AskUserQuestion") or a step that needs the terminal.
- A check that is weaker on Copilot fails silently instead of refusing.

## 3. What Copilot supports today

The research gives every claim its source. This is the summary the design rests on.

### 3.1 Harnesses: which engine runs a session

VS Code now runs a chat session on one of several **harnesses**, and almost every answer below depends on which:

| Harness | What it is | Matters because |
|---|---|---|
| **Copilot** | GitHub's own agent runtime (the Copilot SDK), the same one as Copilot CLI. Runs in a separate process, and its sessions outlive the VS Code window. Being rolled out as the default for new sessions | Wheelhouse's target. Its hooks are generally available, and it is the only harness that enforces Copilot's permission and sandbox rules |
| **Local** | VS Code's older built-in harness | A hook that crashes lets the call through, and permission and sandbox rules aren't enforced. Wheelhouse doesn't run here |
| **Claude** | Anthropic's Claude Agent SDK inside VS Code, paid for through the Copilot subscription. On by default, but a company can switch it off | Might run Wheelhouse's Claude Code plugin almost as it is (option B, section 7). Which hooks and plugins it loads isn't documented |
| Codex, Cloud | OpenAI's agent (experimental), and GitHub's cloud agent | Not used |

### 3.2 The features

| Feature | Copilot harness and CLI | Status | Windows and macOS |
|---|---|---|---|
| **Instructions** | `AGENTS.md`, `.github/copilot-instructions.md`, `*.instructions.md` with `applyTo`; the CLI also reads `CLAUDE.md` | Stable | Both |
| **Prompt files** (`.prompt.md`) | Local harness only; skills replace them elsewhere | Stable, Local only | Both |
| **Custom agents** (`.agent.md`, also `.claude/agents/`) | A tool list that limits the agent, a model, and use as a subagent | Stable; handoffs and agent hooks Local only | Both |
| **Agent skills** (`SKILL.md`) | Read from `.github/skills/`, `.claude/skills/` and `.agents/skills/`; skills can carry scripts | On by default | Both |
| **Plugins** | Reads Claude Code's layout (`.claude-plugin/plugin.json`, `marketplace.json`, `hooks/hooks.json`, `${CLAUDE_PLUGIN_ROOT}`) and the new Agent Plugins format. VS Code's plugin support is off by default (`chat.plugins.enabled`) | CLI: stable. VS Code: off by default, marketplace settings experimental | Both |
| **Hooks** | `sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `subagentStop`, `agentStop`, `preCompact`, `notification` and others. A `preToolUse` hook can deny or rewrite a call. Read from `.github/hooks/*.json`, `~/.copilot/hooks/`, plugins, and also the repository's `.claude/settings.json` | SDK hooks generally available; VS Code's hooks experience as a whole is Preview | Both: one Node.js command serves both, through the `command` field |
| **How a hook failure lands** | A `preToolUse` hook that exits non-zero denies the call. **A hook that times out lets the call through**, for every event, even admin-installed ones | | Both |
| **Policy hooks** | Admin-installed hook files (`/etc/github-copilot/policy.d/`, `C:\ProgramData\GitHub\Copilot\policy.d\`) that `disableAllHooks` can't switch off, and that run outside the sandbox | Stable | Both; need admin rights |
| **Managed settings** | A computer-wide file (`/Library/Application Support/GitHubCopilot/`, `%ProgramFiles%\GitHubCopilot\`) holding deny rules, no bypass mode, the sandbox forced on, plugin and MCP allowlists. Applies whatever plan the person has | Stable, some parts Preview | Both; need admin rights |
| **Sandbox** | Commands and their children kept to set folders and network hosts (Seatbelt on macOS 15 or later; Microsoft's execution containers on Windows). Off by default. Outbound network allowed by default | GitHub calls it generally available since 7 October 2026; VS Code's own pages still call Windows experimental | Windows needs a recent Windows 11 update; macOS 15 or later |
| **MCP servers** | `.mcp.json` and `~/.copilot/mcp-config.json`. For Business and Enterprise seats, "MCP servers in Copilot" is off by default | Stable | Both; per-server sandboxing macOS only |
| **Tool approval** | Manual by default; "Allow all" and `/yolo`; deny rules beat every allow. VS Code's worktree sessions always run with Allow all. Terminal auto-approve rules are "not a security boundary", in the documentation's words | Stable | Both |
| **Background sessions** | `copilot -p` runs a prompt headless; `--resume` continues a session; `--agent` picks a custom agent; `--allow-tool` and `--deny-tool` set permissions up front. CLI sessions appear in VS Code's Sessions view | Stable; ACP server mode Preview | Both; the CLI needs PowerShell 6 or later on Windows |
| **Messages between sessions** | Possible, but every send needs the person's confirmation | Stable | Both |
| **Clickable questions** | `ask_user` (VS Code: `askQuestions`) shows clickable choices. Whether a hook sees the answer, and whether the agent can fill it in itself, isn't documented | Stable | Both |
| **Notifications** | VS Code shows a system notification when a session needs input or finishes. GitHub Mobile notifies only for remote Copilot CLI sessions | Stable | Both |
| **Extensions** | A VS Code extension can draw a pane (a webview, or the new Canvases, Preview), add a status bar item, and contribute skills, agents and instructions | Stable; Canvases Preview | Both |
| **Usage** | Billed in AI credits (US$0.01 each); `/usage` in the CLI; a REST call gives a person's credit use | Stable | Both |

**For companies** (Business and Enterprise seats): an organisation can switch off preview features, MCP, the Claude harness, plugins and individual extensions, and its own managed settings win over anything on the computer. From 22 October 2026, generally available features the organisation hasn't configured default to on.

## 4. Where Wheelhouse is tied to Claude Code today

| Seam | Today, in Claude Code | Why it matters |
|---|---|---|
| Packaging | A Claude Code plugin from Wheelhouse's own marketplace, pinned by tag and commit | How it installs and is pinned |
| Hook registration | `hooks/hooks.json`, with Claude Code's events, matchers and `onFailure` | Every guard |
| Hook input and answers | Claude Code's JSON (`tool_name`, `tool_input`, `hookSpecificOutput`) and its tool names (`Bash`, `Read`, `AskUserQuestion`) | Every guard |
| Where hooks run | Outside Claude Code's sandbox, so they can read the signing key and start the helper, which agents can't | The signed records (section 6.3) |
| The sandbox and deny rules | Written into `.claude/settings.json` | What agents can touch |
| Locked | `managed-settings.json` | The stronger level |
| Card clicks | `AskUserQuestion`, recorded by a `PostToolUse` hook; the mod's buttons and reply codes | Every approval and confirmation |
| Subagents | Claude Code's subagents with types (`wheelhouse:reviewer`), and a `SubagentStop` hook that records a review only from a reviewer | Signed reviews |
| Sessions | `claude -p`, `--resume`, `--session-id`, `--allowedTools`, the foreman as a Desktop session | The foreman and feature sessions |
| The mod | Claude Code's mod API: the pane, buttons, `/digest`, the courier, the usage figure, origins of messages | The glance, card buttons, phone STOP |
| Usage | Claude Code's telemetry and the weekly allowance | The briefing and unusual use |
| Phone | Remote Control and Claude's push | Notifications, phone STOP |
| Playbook wording | Names Claude tools (`AskUserQuestion`, `PushNotification`, `ToolSearch`), `${CLAUDE_PLUGIN_ROOT}` and the scratchpad | What the session is told to do |
| Lineage | Pins Claude Code's version, Superpowers and Matt Pocock's skills | Upgrades |

## 5. Each piece on Copilot

**Carries over** means the same code and files work unchanged. **Adapter** means the core is unchanged and the Copilot adapter translates. **Differently** means Copilot needs its own way to the same result. **Can't** means Copilot can't do it, and what replaces it.

| Piece | On Copilot | How |
|---|---|---|
| State, the lock, events, views, the secret scan, the backup | **Carries over** | Node.js, run by the helper |
| The host helper and the host adapter | **Carries over**, but started **differently** | Copilot runs plugin and project hooks inside its sandbox when the sandbox is on, so a hook can't start the helper outside it. The helper, the watcher and the usage receiver start at sign-in instead, for this person only, with no admin (section 8.5). *Designer's call* |
| The merge gate | **Carries over** | It lives in the helper |
| The tool guard and the STOP guard | **Adapter** | Registered on Copilot's `preToolUse` for every tool, from the person's own Copilot folder so they reach every worktree (section 8.2). The adapter turns Copilot's input into the shape the guards already read, and their answer back into Copilot's. A tool name the guard doesn't know is refused unless it is on a list of reading tools (section 6.2) |
| How hooks reach Wheelhouse's folder | **Differently** | Inside Copilot's sandbox a hook is no more trusted than the agent. So on Copilot the hooks read Wheelhouse's folder but never write it, and never read the keys: setting STOP, the session markers and everything else they write today go through the helper. A hook that can't reach the helper refuses writes, pushes, merges and new agents, as if STOP were on, and the STOP word tells the director the helper isn't running. *Designer's call* |
| The STOP word, the session start, the briefing | **Adapter** | `userPromptSubmitted` and `sessionStart`. Whether `userPromptSubmitted` can add text for the agent is to be checked (check C7); if not, the briefing comes from the front desk's own command, as `/digest` does before the mod |
| Card clicks (approvals, confirmations, Lift STOP, the CI push, runbook steps) | **Differently** | Recorded as binding only from a click outside the chat: the helper's own window, or the add-on's buttons where it is installed, or the code host's own page. Copilot's clickable questions carry the card itself and its non-binding answers; where nothing else can run, a chat click is recorded as not proven (sections 6.3 and 6.4). *Designer's call* |
| The report check and signed reviews | **Differently** | The signed review on a pull request's head runs as its own Copilot session in a clean checkout, which the helper starts with the project's and the person's own customisations shut out, and whose final answer the helper reads from the session's output. No hook signs it (section 6.3). *Designer's call* |
| Builders, reviewers and the tester | **Adapter** | Custom agents: the reviewer's tool list is reading and searching only. The same prompt text, with Copilot's tool names |
| The foreman and feature sessions | **Adapter** | `copilot -p`, `--resume`, `--agent`, `--allow-tool`, `--deny-tool`, `--no-ask-user`, JSON output, all named explicitly by the watcher. The director can look in from VS Code's Sessions view |
| The front desk | **Adapter** | The director's chat in VS Code, on the Copilot harness. The same playbook, with a short Copilot tool sheet the session start adds |
| Skills: the front desk, intake, foreman, setup | **Carries over** with **adapter** wording | `SKILL.md` is read as it is. The few Claude tool names move out of the playbooks into a tool sheet per agent (section 8.3) |
| Commands (`/wheelhouse:board` and the others) | **Differently** | Skills the director can call by name (`/wheelhouse-board`), since prompt files run only in the Local harness |
| Superpowers' and Matt Pocock's skills | **Carries over**, to be proved | They are `SKILL.md` files, but Superpowers' loops dispatch subagents in Claude Code's words. Check C10 runs them on Copilot before anything relies on them |
| The sandbox | **Differently** | Copilot's own sandbox, switched on per project and per computer where Copilot allows it (check C4). Where it can't be on, the board says so, as for Claude Code on Windows today |
| Deny rules | **Adapter** | The tool guard carries the list itself, as it already does for most of it, and the sessions Wheelhouse starts carry `--deny-tool` flags as well |
| Standard and Locked | **Adapter**, rebuilt for a governance review (section 6.4) | Three tiers by what the workplace allows: Lean (VS Code with Copilot and nothing added, building in the person's own chat), Middle (the code host guards the main version) and Full (the sandbox, Locked or company settings, and approval on the code host) |
| The code host | **Carries over**, and **optional** | GitHub and GitLab at Middle and Full; none at Lean, where history, state and merges stay on the computer; other hosts by a new half of the adapter (section 8.10) |
| Locked | **Adapter**, needs admin | Copilot's policy hooks and managed settings (section 6.4) |
| The guardrails | **Adapter** | The list grows by Copilot's own control files (section 6.5) |
| The board, the briefing, health, settings, the profile, the runbook | **Carries over** | The health line names the agent and its safety line |
| Usage | **Differently** | Copilot bills credits by the month, not a weekly share. Credits per session from the sessions' own output where it gives them, and the month's total from GitHub (check C11). Unusual use works the same way on credits |
| Context and compaction | **Differently** | Copilot compacts on its own; Wheelhouse can't set the mark. The pre-compact hook informs and can't block (check C7). State is on disk, so nothing that matters is lost |
| The mod | **Can't** as such; **differently** | An optional Wheelhouse add-on for VS Code does the mod's jobs: the pane and status bar, card buttons, STOP, settings, and starting the helper if it isn't running. As with the mod, nothing relies on it (section 8.6) |
| Phone notifications and phone STOP | **Can't**, to be checked | VS Code notifies on the computer. Phone STOP needs a way for a phone message to reach the session, and Copilot offers that only for remote CLI sessions (check C12). Meanwhile the optional channels (ntfy, Telegram) carry links, and STOP is set on the computer |
| Setup | **Adapter** | The same steps, with Copilot's tools and a first step that reads what the person's company allows (section 8.7) |
| Lineage | **Differently** | Copilot CLI and the add-on can be pinned; VS Code and its Copilot runtime update every week and can't, in practice. So they are recorded on every pull request, and a change of version runs the safety scenarios before work continues (section 8.8) |
| The evaluation | **Adapter** | The same scenarios through `copilot -p`. Copilot is offered to adopters only once the safety scenarios pass on it |

## 6. Safety on Copilot

**In short:** on Copilot, Wheelhouse's guards can still refuse what they refuse in Claude Code, and the helper and the gate hold exactly as before, because they never ran inside the agent. What Copilot changes is where Wheelhouse's own hooks run, and that weakens one promise: at Standard, a determined agent could forge a record the hooks make. So on Copilot, the records that matter are made by the helper or the add-on, never by a hook. And because the director's bar is a compliance or governance review, even on a computer where Copilot's sandbox can't run (section 6.4), the controls that matter most live off the computer, and on it Wheelhouse uses the strongest level the computer allows.

### 6.1 What holds unchanged

- **The helper is still the only route to the host where the sandbox is on**, and it still carries the gate's checks: no push to `main`, no force-push, no merge without CI green on the exact commit, a signed review, the director's signed approval where needed, the lock, STOP and no incident. None of that runs inside the agent.
- **The host's own protection** of `main` and the state branch, set at setup.
- **STOP**: the flag lives in `~/.wheelhouse/`, the guard refuses writes, pushes, merges and new agents, and the helper refuses too.
- **The runbook**, run through the helper.
- **Deny before allow**: on Copilot a deny beats every allow, including "Allow all".

### 6.2 The guards on Copilot

- **They can refuse.** A `preToolUse` hook answering deny, or exiting with any error, blocks the call.
- **A guard that runs out of time lets the call through.** Claude Code's `onFailure: "block"` covers a time-out; Copilot's doesn't. So Wheelhouse registers its guards with a long time limit (`timeoutSec`, two minutes), and every guard answers within a deadline of its own, well inside it, refusing if it can't decide by then. That makes a time-out rare, but can't rule it out: a guard whose Node.js hasn't started by the limit lets the call through, and an agent that loads the computer on purpose could make that happen. *Designer's call.*
  - **What a missed guard can reach is bounded.** It can let a command or a file change through on the computer, within the sandbox where it is on. It can't reach the host, merge or push, because those go through the helper, which checks everything itself.
  - The board's Copilot line says so, at Standard and at Locked alike, since Copilot lets even an admin-installed hook's time-out through.
- **Copilot's own file tools aren't held by the operating system's sandbox:** Copilot checks them against the sandbox's rules "on a best-effort basis". So the tool guard keeps checking every file tool's path against the keys, the credential folders and the guardrail files, as it already does in Claude Code.
- **New tools.** Copilot adds tools often, and a guard that only knows Claude Code's names would wave new ones through. So on Copilot the guards are registered for every tool, and the tool guard refuses any tool it doesn't recognise, except a short list of tools that only read. Each new Copilot tool then needs one line in the adapter before agents can use it. The cost is an occasional refusal after a Copilot update, which the evaluation run after each update (section 8.8) shows first. *Designer's call.*
- **Two copies.** Copilot also reads the project's `.claude/settings.json` hooks and Claude-format plugin hooks. The adapter registers Wheelhouse's hooks once for Copilot and makes sure Copilot doesn't also load the Claude Code registration, so nothing runs twice (check C3).
- **Allow all.** VS Code's worktree sessions force "Allow all". Wheelhouse never uses them: it makes its own worktrees through the helper, and starts feature sessions itself with explicit permissions. Under any "Allow all" the hooks still run and still refuse.
- **The Local harness.** Local also reads the person's own Copilot hook folder, so Wheelhouse's hooks run there too, though Local lets a crashing hook's call through and doesn't enforce the sandbox. The adapter tells Local's input from the Copilot harness's, and in Local the session start says first that Wheelhouse doesn't run in this kind of session and asks the director to switch to Copilot; the front desk's playbook, which the add-on's skills still bring, does nothing else without the session start's line. Whether Local's input can be told apart is part of check C5. *Designer's call.*
- **A builder switching off its own guards.** Copilot reloads hooks each time a session resumes, and a project hook file holding `disableAllHooks` might switch off Wheelhouse's (check C3). The tool guard refuses writes to every agent-control file (section 6.5), and before every wake the watcher reads the worktree's agent-control files directly, without git, and refuses to wake a session whose worktree holds one that is new or changed; the foreman raises it as a card. *Designer's call.*

### 6.3 Where the records come from

In Claude Code, the hooks run outside the sandbox and can read the signing key, which agents can't. That is what lets a hook sign a card click or a review that no agent can forge (main design, sections 9 and 12.5).

On Copilot, when the sandbox is on, the project's and the plugin's hooks run **inside the same sandbox as the agent**. When it is off, both run as the person. Either way a hook has nothing an agent couldn't also reach, so a record signed by a hook proves nothing at Standard. Only admin-installed policy hooks run outside (Locked, section 6.4).

So on Copilot:

- **The everyday approval is a click in the chat** (the director's ruling of 21 October 2026, section 6.4). On Copilot it binds only through a policy hook at Locked or under company settings, if check C6 passes; elsewhere the code host's lock carries the weight. **A binding click**, for the steps that matter most and wherever the host's lock is missing, comes from:
  - the **Wheelhouse add-on's buttons** in VS Code. The add-on runs in VS Code's own process, outside the agent's sandbox, and signs the record with the key itself, as the mod's bridge does in Claude Code (check 32). It never asks the helper to sign, because an agent can reach the helper's socket too. Or:
  - the **helper's own window**, a small window of the operating system's own kind that the helper opens with the card's options, for when the add-on isn't there (Copilot CLI alone, or a company that blocks the add-on). An agent can ask the helper to open one, but only a person can click it; whether a sandboxed command can click it by script is part of check C4.
  
  **Decided by the director on 20 October 2026** (section 12, question 1): the add-on's buttons, with the helper's window as the fail-safe. **Then, on 21 October 2026,** the director set the baseline as VS Code with Copilot and no add-on, and made a click in the chat the everyday approval. So the chat click comes first, the code host's lock stands behind it, and the helper's window, or the add-on's buttons, confirm the steps that matter most where they can run (section 6.4).
- **Copilot's clickable questions** show the card in the chat and carry its non-binding answers (**Not now**, **Explain more**, **Show me**). Since 21 October 2026 they also carry the everyday **Approve** (section 6.4). For the steps that matter most, a binding option opens the add-on's button or the helper's window to confirm. The click binds on its own only if check C6 shows the agent can't fill in the answer, and only at Locked or under company settings, where a policy hook outside the agent records it.
- **The add-on's binding presses come only from its own pane's buttons.** It registers no command, link handler or language-model tool that could press one, so neither an agent's tool nor a VS Code command can. A static check of the add-on's package proves it on every pull request, as `claude plugin validate` proves the mod can't approve anything (main design, section 17.1), and the tool guard refuses the agent any VS Code tool that runs commands. *Designer's call.*
- **A signed review** is no longer written by a hook from a subagent's report. *Designer's call* for each point:
  - **Where:** the helper makes a clean checkout of the pull request's head in its own folder, outside every worktree, and starts the reviewer there as its own Copilot session, in the sandbox where it is on, with reading tools only.
  - **What it loads:** only Wheelhouse's own reviewer agent. The project's and the person's own agents, instructions, hooks, MCP servers and language servers are shut out, because a builder could otherwise add a file to the pull request that steers or replaces the reviewer. Whether Copilot CLI can start that way is check C13; until it passes, Copilot can't merge anything that needs a signed review.
  - **What it reads:** a prompt the helper writes from trusted state only: the brief from the state branch, the diff the helper works out, the project's rules from the default branch's commit (not the pull request's), and CI's results for the deterministic checks, which the reviewer reads rather than runs. The cost: each rules file (`CLAUDE.md`, `AGENTS.md`) is read up to 256 KB (`RULES_BYTES`, scripts/host/helper.js), but the whole prompt is capped at 100 KB (`MOST_PROMPT_BYTES`, scripts/review/clean-session.js), below the system's limit on a program's arguments. So a project whose rules and brief together pass 100 KB gets no clean review: it is refused in plain words, as no clean review (`NO_CLEAN_REVIEW`), and nothing that needs one merges until the rules are shorter.
  - **How it is signed:** the helper reads the verdict from the session's own output and signs it. No builder can write into that output.
- **Where Copilot's sandbox is off, on any system,** a command running at the person's own level can read the helper's keys file and sign anything: an approval, a confirmation or a review. That is so on Windows without the sandbox, as with Claude Code on Windows today (main design, section 11), and on a Mac older than macOS 15 or where the sandbox is off. Guarded narrows it, where Windows lets Wheelhouse label the keys folder unreadable to its runner (check 52), and Ask narrows it to the allowances the person clicked. Section 6.4 keeps the controls that matter most off the computer for this reason.
- **On Windows with Copilot's sandbox** (a recent Windows 11), the keys folder may be deniable to agents. If check C4 shows it is, Copilot on those computers holds more than Claude Code on Windows does today, and the board says so.

### 6.4 Three tiers: Lean, Middle and Full

**The director's bar** (20 October 2026): "We need this to be compliance/governance robust"; for the worst case, "we need to prepare for the worse - what if sandbox cant be run?"; and then, since the first tester's workplace doesn't use GitHub, "let's assume little from what can be accessed. there should be a lean version with minimal access but still works then the full fletched version, perhaps also in between."

**The baseline: decided by the director on 21 October 2026:** "assume vscode with copilot but no addon installation - how would wheelhouse work? That should be the baseline right? just like claude code (even on windows) before mod was a feature". So Lean is VS Code with Copilot and nothing added. The Wheelhouse add-on for VS Code (section 8.6) lifts any tier, as the mod lifts Claude Code, and nothing relies on it.

So Wheelhouse on Copilot comes in three tiers. A tier is set by the controls the workplace allows, which is what a compliance reviewer looks at, not by any one product. *Designer's call.*

| | **Lean** | **Middle** | **Full** |
|---|---|---|---|
| **In plain words** | Everything stays on the person's computer | A copy of everything sits on the company's code host, which guards the main version | Middle, with the computer fenced in and the person's approval recorded on the code host |
| **Needs** | VS Code with Copilot, and git | Lean, plus a code host the company already uses (GitHub, or GitLab including on the company's own servers, section 8.11), with its protection switched on | Middle, plus Copilot's sandbox, Locked or the company's own Copilot settings, and the person's approval recorded on the code host itself (check C15) |
| **No need for** | The add-on, Node.js, a code host, Copilot CLI, a sandbox, admin rights, or anything installed | The add-on, Node.js, a sandbox or admin rights | |
| **Who builds** | Copilot's agent mode in the person's own chat, one feature at a time | The same; or, where Copilot CLI and Node.js may run, background builders, several features at once, at Guarded or Ask on the computer (below) | Background builders inside Copilot's sandbox |
| **Who approves, and where** | The person, with a click in the chat; the steps that matter most confirmed in the helper's window where Node.js may run (below) | The same, behind the code host's lock; for a project with real users, also on the code host's page | The same, and the code host refuses the merge until the person has approved on its page |
| **Version history** | Local git on the computer | On the code host as well | The same |
| **Reviews** | A separate, read-only chat, recorded as a chat review | A clean, read-only session where Copilot CLI runs; a chat review otherwise | A clean, read-only session |
| **Copy off the computer** | Only a copy to a folder the person chooses | The code host | The code host, and its audit log where the company has one |
| **For projects with real users** | No (below) | Yes | Yes |

**Agent mode, in plain words.** Copilot's chat has an agent mode, the mode in which Copilot edits files and runs commands itself rather than only answering. Building in the chat is agent mode, with Wheelhouse's builder as the agent. Background builders are the same agents running outside the chat, as Copilot CLI sessions or Copilot's background sessions, several features at once, with no one watching. Wheelhouse uses agent mode in every tier.

**Two lifts, at any tier, where the workplace allows them:**

- **Node.js may run.** Wheelhouse's helper is its own Node.js program, not a VS Code add-on. With it come Wheelhouse's guards, STOP that is enforced, the helper's window for approvals, and a record the helper writes rather than the agent.
- **The add-on may be installed.** The pane and status bar, with card buttons the agent can't press (section 8.6).

**What a director meets** (the front desk, intake, the board and briefing, cards, ideas, rulings, planning and designs, and STOP) works in every tier through Copilot's chat, as it does in Claude Code before the mod. What changes between the tiers and the lifts is who builds, who can approve, where history and records are kept, and how much a reviewer can rely on.

**Setup finds the tier** the computer and workplace allow, and says so in one plain sentence ("This computer can run Wheelhouse at Middle: your company's GitLab keeps the main version safe, and Copilot builds in your chat"). *Designer's call* for each case:

| What the workplace allows | Tier |
|---|---|
| VS Code with Copilot and git, and no code host, or one whose protection can't be switched on | Lean. A host without protection can still hold the copy off the computer, in place of the folder |
| A code host with its protection, but no Copilot CLI | Middle, building in the person's chat |
| A code host with its protection, and Copilot CLI with Node.js | Middle, with background builders |
| Middle, plus Copilot's sandbox, plus the company's Copilot settings (or Locked, on a Mac the person administers), with check C15 passed on that host | Full. Before C15 passes, such a computer runs at Middle, at level 1 |
| Copilot CLI without VS Code | Middle or Full as above, with the helper's window for approvals |

**Moving between tiers.** *Designer's call* for each:

- **Up:** the local main version and the record are pushed to the host as they stand. Setup protects the main version and the record branch straight after that first push, before any builder runs. Branches in progress become merge requests. Entries from before the move are marked as Lean's in the audit report, so it doesn't show them as gaps against the host's history.
- **Down** (a new computer, or a workplace that withdraws something): the project keeps its host as the copy off the computer, the record notes the change, and the board shows the lower tier and why.

#### Lean: VS Code with Copilot, and nothing added

*Designer's call* for each point, with checks C16 and C17.

- **Getting Wheelhouse.** The person asks Copilot's chat to set up Wheelhouse from its public repository, or opens a downloaded copy of it. Copilot fetches it with git, and copies Wheelhouse's skills, agents and instructions into the person's own Copilot folder (`~/.copilot/`), outside every project, where Copilot reads them. Nothing is installed. Whether VS Code's Copilot reads custom agents and instructions from there, as it reads skills, is check C17.
- **Everything through the chat.** The front desk, intake, ideas, rulings and plans are Wheelhouse's skills and agents in Copilot's chat, called by name (`/wheelhouse-board`), since prompt files don't run in the Copilot harness (section 5).
  - **Cards** are Copilot's own clickable questions in the chat.
  - **The board and briefing** come on request in the chat, and as `wheelhouse/board.md` in the project, which the front desk rewrites after each change.
  - **Building** is one feature at a time, in a chat with Wheelhouse's builder agent.
  - **Reviews** are in a separate chat with Wheelhouse's reviewer agent, which has reading and searching tools only. Such a chat loads the project's own instructions, so a builder could have steered it: it is recorded as a chat review, not an independent one.
- **Where the work goes.** Each feature is a branch in local git. After the person's approval, the feature merges with a merge commit, so it can be undone: **Undo** makes a new commit that reverses it, and later work on top stays. Each merge is also pushed to a copy in a folder the person picks, such as a company drive, with git alone. On a drive that keeps old versions of files, that copy shows any later rewriting of what came before it.
- **Commands.** Copilot asks the person before each command. These are Copilot's own prompts, not Wheelhouse's Ask cards, and they aren't a control: VS Code can approve commands by its own rules, remember an approval for the session or for good, or approve everything, and the person's own settings win over the project's. File edits aren't asked at all, so an edit to a script followed by an allowed test run runs what the agent wrote. Setup writes Lean's VS Code settings in the project (edits only inside the project, asking before any edit to a guarded file, and nothing approved automatically), and the front desk says when they have changed. These are conveniences, not controls.
- **The runbook at Lean** is the steps marked local: STOP, looking at an incident, undoing a merge, and a new signing key. Steps that touch a host don't apply.
- **Versions.** VS Code and its Copilot runtime update weekly, and Lean has no Copilot CLI to run the safety scenarios. So Wheelhouse runs them on its own test computers for each new version and publishes the list of tested versions. The front desk compares the person's version with it, and says when it hasn't been tested yet.
- **Usage** isn't shown at Lean, since nothing gives Wheelhouse the figures.

**Approvals, in every tier: an everyday click, and a lock at the front door.** *Decided by the director on 21 October 2026* ("instead of gitlab approval, cant it be a copilot chat click?"); *designer's call* for the rest.

- **The everyday click is in the chat.** The front desk asks with Copilot's own clickable question, and the person clicks **Approve**, as in Claude Code before the mod. This holds in every tier, with nothing installed.
- **How much that click proves** depends on check C6, which asks two things: whether the agent can fill in the answer itself, and whether anything outside the agent sees the click.
  - **If C6 passes,** and a Wheelhouse hook (where Node.js may run) records the answer as Copilot gives it: the record shows the person's click, against an agent that is mistaken or misled. It doesn't hold against an agent set on forging one, since on Copilot the hook runs beside the agent (section 6.3), unless Locked or the company's settings run it as a policy hook outside the agent, where the click binds.
  - **If C6 fails, or no hook runs** (no Node.js): the record of the click is the agent's own account. It is marked as a chat click in the record.
- **The lock at the front door is on the code host.** Whatever happens in the chat, the host refuses to change the main version without its own checks: the protection, the project's tests on the host, and the narrow key that can't change either. For a project with real users, the host also waits for the person's own approval on its page (Full, and Middle's backstop), so a forged chat click can't merge anything there. On GitLab that is one extra click on the merge request, on its page (section 8.11).
- **Where the helper or the add-on can run,** a chat click on a step that matters most (Lift STOP, a guardrail change, Unattended, a runbook step) is confirmed in the helper's own window or with the add-on's button, which an agent can't press. The helper's window needs only that a Node.js may run; it isn't a VS Code add-on. With no sandbox, a command the person allowed could still read the helper's key or drive its window by script, so it is far harder to fake than a chat click, but not a fence.
- **At Lean with nothing else,** there is no lock at the front door: the chat click is all there is, the record marks it as a chat click, and the board says so whenever it shows the tier. Nothing enforces STOP: the agents' instructions tell them to stop, and VS Code's own stop button ends the running request. There are no Wheelhouse guards unless check C16 finds a way. That is one reason Lean isn't for projects with real users.
- **Where the helper runs at Lean,** it also writes Wheelhouse's state and signs the record, keeps the project's git store in Wheelhouse's folder outside the project folder (a worktree of it, so Copilot's edit tools can't move the main version, add a git hook or change git's settings), runs the tests on the approved commit, merges with git's hooks switched off, and pushes the copy to the person's folder. Its guards run as Copilot hooks in the person's Copilot folder, so STOP and the guarded files are enforced. The front desk starts it with one command the person allows; on a work computer there is no start-up entry (section 8.5).
- **Without Node.js, on a code host,** Copilot pushes each feature with git, and on GitLab git's push options open the merge request too, with nothing else installed. Wheelhouse's key is a project key the person makes on GitLab's page and gives to git's own sign-in window (section 8.11).

**Compared with Claude Code before the mod.** In Claude Code, a click on a card in the chat is recorded by a hook that runs outside the agent's fence and holds a signing key the agent can't read, on a Mac with Claude Code's sandbox. So there a chat click binds with no mod at all. On Windows without the sandbox, a command at the person's level can read that key too, narrowed by Guarded and Ask (main design, section 12.2). On Copilot, Wheelhouse's hooks run beside the agent, so a chat click can't bind that way on any computer, except through a policy hook at Locked or under company settings. So on Copilot the chat click is the everyday route, and the host's lock is what a compliance reviewer relies on. Without Node.js there is no hook at all, which is below Claude Code on Windows: there, forging a record takes a command written to do it; here, the agent writes the record itself.

**With the add-on** (section 8.6) and no Node.js, the add-on does the helper's jobs inside VS Code's own process: its pane's buttons for approvals, its own chat tools as the route from the chat to Wheelhouse's state (or an inbox folder where a company switches those off), the git store outside the project, the tests run on the approved commit, the command-approval settings and each terminal command recorded, STOP that also cancels the chat's running request, and a copy to the person's folder after every approval. The same command at the person's level could still read its key, so the add-on's buttons hold as the helper's window does. Check C19.

**What Lean can promise a compliance reviewer:**

- Every change to the main version is in version history, with when it was approved, and can be undone; and a copy sits in the person's folder.
- Each approval is recorded as a chat click, with what check C6 says it proves. With the helper or the add-on, the steps that matter most were also confirmed outside the chat, for a named commit, and the tests and the review recorded were for that commit. Wheelhouse's state and record were written by the helper or the add-on, not by the agent. Copilot's edit tools couldn't change the main version.

**What Lean can't promise:**

- **Nothing on the computer holds against a command the person allowed.** It runs with their full access and could change the history, the record, the keys or Wheelhouse itself; only the copy off the computer would show it, and only for what came before it.
- **No lock at the front door:** a forged chat click could merge. Without the helper or the add-on, STOP isn't enforced, and there are no Wheelhouse guards unless check C16 finds a way.
- **Copilot's command prompts aren't a control,** since VS Code's own settings can approve commands without asking.
- **No independent tests or reviews.**
- **No check of who clicked:** an approval shows only that someone at the person's computer clicked.
- **One feature at a time,** while the person is there.

So Lean suits building and trying out a product, not looking after one that real users depend on.

#### Middle and Full

Middle and Full keep everything below. Middle has the code host's controls, and, where Copilot CLI runs, background builders at the computer's levels Guarded and Ask; without Copilot CLI, Middle builds in the person's chat as Lean does, and the person approves on the code host's own page, or in the helper's window where Node.js may run. Full adds the sandbox, Locked or the company's settings, and the approval on the code host. The controls are sorted by where they live, because a reviewer trusts most what the person's computer can't change.

#### Middle and Full: controls on the code host

These live on the host, so nothing on the person's computer can change them, with one exception said plainly below. *Designer's call* for each.

1. **Nothing reaches `main` except a pull request that passes the project's CI on the host.** Setup sets the host's protection: no direct push and no force-push to `main` or the state branch, and the required checks pinned to the host's own CI, so a status posted from the computer can't stand in for them. Where the code host can't protect `main` at all (GitHub Free with a private repository), the project runs at Lean; the board says why and what plan would. On GitLab, including on the company's own servers, section 8.11 says which of these each GitLab licence gives.
2. **CI is treated as the builder's own work, not as proof.** A pull request controls its own tests and scripts. So the project's secrets are kept out of every CI run a pull request starts, and live only in the host's protected environments, which a pull request's run can't reach. The setup card says so; moving the project's existing secrets is a level-4 step for the person.
3. **The person's approval, on the host,** where the host can hold one: the host itself refuses the merge until the person, signed in to the host, has approved that exact commit there. Without it the narrow key alone could merge a pull request whose CI passed. How Wheelhouse can do that on GitHub and GitLab, with no secret shipped, is check C15: for example, a required check that waits on a protected environment the person must approve, or the pull request opened by another identity so the person's review counts. On GitLab, Wheelhouse's merge requests are already opened by another identity, the project key's bot user, so the person's own approval can count (section 8.11). **Until C15 passes,** a merge rests on Wheelhouse's signed approval, kept on the computer. So until then build commands run unattended (levels 1 and 2 below) only where the level's test shows they can't read the signing key or the connection key; anywhere else the level is Ask.
4. **The narrow connection's key reaches only the project's code, pull requests and issues.** It can't change the repository's settings, its protection or its CI files (main design, section 11). A change to CI needs the person's own sign-in, on one click (main design, section 12.4, card A). On GitLab a Developer-level key can change the CI file in a merge request, so holding that to the person needs code owners' approval, a Premium control (section 8.11). The quick connection isn't offered for building on Copilot.
5. **The record, once pushed,** can't be rewritten: every event is chained to the one before and pushed to a branch the host won't let anyone rewrite, as it happens.

**The exception: the person's own sign-in.** On a repository the person owns, they are its admin, and their sign-in can switch the protection off, push to `main` and rewrite the record branch. Copilot itself needs a GitHub sign-in on the computer, and git usually keeps one too. So on the personal route these host controls hold against agents only as long as nothing an agent runs reaches the person's sign-ins: true at the sandbox and Guarded levels for build commands, and not true during an Ask allowance or at Unattended. **On the organisation route** the repositories belong to the company, the person isn't their admin, and the company's own audit log records every push and every change to the protection: there the host controls hold whatever happens on the computer.

#### Middle and Full: controls on the computer, outside the agent

The merge gate in the helper, signed reviews in a clean session, the watcher and the capture of each session's activity all run on the person's computer, as programs at the person's own level. They hold while nothing an agent runs reaches that level: at the sandbox and Guarded levels, a build command can't change them. During an Ask allowance or at Unattended, a command could rewrite them, or skip them and call the host directly with the narrow key. That is why the host's own controls come first, and why the audit report checks the computer's record against the host's (below).

#### Middle and Full: what stays exposed on the computer

- **The person's sign-ins:** the browser's, git's and `gh`'s stored sign-ins (including Windows' credential store), Copilot's own, and SSH keys.
- **Wheelhouse's keys:** the narrow connection's key and its renewal key, and the signing key.
- **Copilot's own saved permissions and settings,** which could widen what a later session may do.

**One command at the person's own level can leave lasting changes:** a start-up entry, rewritten Wheelhouse or Copilot files, a copy of the renewal key, which lasts months, or of the signing key. So after any period at Unattended, and every week in which an Ask allowance ran, Wheelhouse makes a new signing key and asks the person to renew the connection (one code on the host's page), and the health check looks for changes to Wheelhouse's and Copilot's own files. *Designer's call.*

**How likely a harmful command is.** An agent doesn't set out to do this on its own. The realistic routes are instructions hidden in something it reads (a web page, an issue, a dependency's notes) and a harmful package whose install or test script runs on the computer. The guards and reviews make the first unlikely to succeed by accident. The levels below are what narrow the second.

#### Middle and Full: the levels on the computer

Wheelhouse finds, at setup and at each session start, the strongest level the computer allows, and uses it for the commands feature sessions run. *Designer's call.*

| Level | What runs a build command | What it holds | What it needs | On a Windows work computer without admin |
|---|---|---|---|---|
| **1. Copilot's sandbox** | The command, inside the sandbox, with no prompt | Commands reading the keys, sign-ins and credential stores, or writing outside the worktree; on macOS, commands reaching unlisted hosts (on Windows, only programs that honour the proxy) | macOS 15, or Windows 11 with the September 2026 update; the sandbox test passing (below) | Only once the company's IT has installed that update, if it allows the sandbox |
| **2. Guarded** | Wheelhouse's low-integrity runner, with no prompt: the session may run commands only through it | Commands writing outside the worktree, so a build can't change Wheelhouse's files or hooks, Copilot's settings, VS Code or other projects. Commands reading the folders Windows lets Wheelhouse label unreadable (check 52). Not the network. A command that fetches new code (`npm install` and the like) still asks | Stock Windows and Node.js, no admin; its self-test passing; until check C15 passes, the keys folder labelled unreadable to it | Only where the company lets a copied Node.js run, which its program rules often don't |
| **3. Ask** | The command, at the person's own level, after the person's click on a card naming it and what it runs | Only what the person chooses: each command is allowed for one run (**Allow this time**, recommended) or for the feature. The card says that the command can then do whatever the person's account can, and that one run can leave lasting changes | Nothing | Always, where Copilot's command-line agent may run (below) |
| **Unattended (dangerous)** | The command, at the person's own level, with no prompt | Nothing on the computer; only the host's controls, and on the personal route not even those against a determined command | The person's click on its own card; never for a project with real users (below) | Available, not recommended |

**On top of any level, where they can be had:** **Locked** (on a computer the person administers) or **the company's own settings** (the organisation route) add Copilot's admin-only managed settings and policy hooks: the sandbox forced on and failing closed where the computer supports it, no command outside it, no "Allow all", and reading the keys, the credential folders and Copilot's own folders denied to commands and file tools alike, by rules no one at the computer can undo.

**Guarded on Copilot, beyond the main design's** (*Designer's call*):

- **The control files stay at the normal level.** Guarded's list of files a build can't change grows by the agent-control files of section 6.5 (`.github/hooks/`, `.github/mcp.json`, `.github/lsp.json`, `.vscode/`, `AGENTS.md` and the rest), so a build can't plant one that runs or steers later at the normal level. A new one anywhere else in the worktree stops the watcher before the next wake (section 6.2).
- **No links out of the worktree.** A build at low integrity can make a folder link inside the worktree that points elsewhere, which Copilot's file tools, at the normal level, would then follow. So after each command the runner looks for links in the worktree and removes any that lead outside it, and the tool guard resolves every path to where it really leads before checking it.
- **Git's shared store.** A feature's worktree shares its git store with the main folder, outside the worktree. Whether a low-integrity build can still commit there, and whether labelling the store low would let one feature's build rewrite another's branches, is a question for check 52 that applies to Claude Code too. If it can't be held, Guarded gives each feature its own clone rather than a shared worktree.

**How each level is enforced on Copilot.** Copilot's own permission rules, passed to each session the watcher starts (section 8.4), carry most of it, so a hook that times out doesn't open it. They are rules, not a fence: GitHub calls its own path checks "heuristic", and a rule can be walked round, which is why Wheelhouse's guards and, where it can run, the sandbox sit behind them. *Designer's call*, all checked in C8:

- **Commands:** a session may run only what its level allows (at Guarded, only the runner; at Ask, only the commands the person allowed, for as long as they allowed them). Copilot's deny beats every allow, so this rests on Copilot refusing, in a session with no one in the chat, every command no rule allows. Whether it does is check C8.
- **A clean start for every session.** Saved permissions, saved web approvals and an "allow everything" switch in the person's environment could widen a session. So the watcher starts each session with its own Copilot settings folder, which Wheelhouse writes and agents can't, and an environment cleared of anything that could widen it.
- **Files:** Copilot's file tools limited to the feature's worktree by Copilot's path rules, with the temporary folder shut off, and checked again by the tool guard on the real path. Guarded's labels don't bind Copilot's file tools, which run at the normal level: these rules and the guard are what hold them.
- **Copilot's fetch tool:** held to the project's listed domains by Copilot's own web rules. These hold Copilot's tool, not the network: a command reaches the network as the level allows.
- **The person's own chat** (the front desk) is interactive: Copilot asks the person before each command it hasn't been told to allow, as Claude Code does on Windows. Wheelhouse allows only its own command there.

**Where Copilot's command-line agent can't run,** because a company switches Copilot CLI off or its program rules block it, there are no background builders: Copilot builds in the person's chat as at Lean, and the code host's controls still hold.

**The tests.** Before using a level, Wheelhouse tests it:

- **The sandbox test:** a sandboxed probe tries to read the keys file and a stored sign-in (`gh auth token`, `git credential fill`, a token in its environment), to write outside its worktree, to reach an unlisted host and the local network, and to make one tool call the guard must refuse, which proves the guards are loaded. Level 1 is used only if all are refused, except the network on Windows, which is reported. Since the test is per session, Wheelhouse also asks Copilot never to run a command outside the sandbox, and the guard refuses, or records, any command it can see ran outside it (checks C4 and C5).
- **Guarded's self-test,** from main design section 12.2, adding a link out of the worktree and a write to a control file, both of which must fail.
- The result goes into the audit record, so a reviewer sees which level every change was built at.

#### The audit report

A script turns the record into an audit report: for each merged change, the request, who approved which commit and when, the review, CI, the level the computer ran at, each command allowed by Ask, the versions and the agents' activity. *Designer's call* for each point:

- **It checks the computer's record against the host's own.** The host's list of pull requests, merges, who or what merged each, CI runs and changes to the protection come from the host, not the computer. A merge with no matching approval, an approval for a commit that never merged, or a protection change shows as a gap. This is what catches a false record made with a leaked key, or an event held back.
- **The full activity of each session** is kept on the computer for 30 days, as transcripts are (main design, section 12.8), and can be changed there; only its summary, after the secret scan, is pushed to the host as it happens.
- **On the organisation route,** the company's own audit log, and GitHub's agent session records where the company has them (Enterprise Cloud with managed users, preview), give a second record no one at the computer can change.

#### Projects with real users

*Designer's call*, put to the director as question 2 of section 12:

- **Middle or Full only, never Lean,** since Lean holds nothing off the computer.
- **Never Unattended.**
- **The person's approval on the code host** once check C15 gives one there.
- **At Middle, the strongest level the computer allows,** with Locked or the company's settings recommended where they can be had.
- **At Middle, reviews from the clean session** (check C13), which needs Copilot CLI. Where it can't run, a chat review could have been steered, so a real-user project's changes also need a second person's approval on the code host, where the company's licence gives approval rules.

#### Locked and company settings on Copilot

**Locked on Copilot** is offered on macOS first, and on Windows only once tried on a Windows computer with admin rights, as for Claude Code (main design, section 22). It differs from Claude Code's Locked in one way, which its card says plainly: it forces Copilot's sandbox on for all Copilot work on the computer, rather than only in Locked projects (the director's card B for Claude Code), since on Copilot a policy hook that refused unsandboxed commands would let one through when it timed out. Its other computer-wide rules are kept to what is safe everywhere, and its policy hooks check whether the folder is a Locked Wheelhouse project before doing anything. Once Copilot's managed settings hold permission or sandbox rules, VS Code also switches off its Claude and Codex agents on that computer. Locked holds against anything running as the person, though not against someone with the computer's admin password. *Designer's call.*

**Where a company already manages Copilot,** its settings win. Managed settings from device management come first, then GitHub's, then the file Locked writes, with the sandbox and permission rules combined in the strictest direction. Setup reads what the company has set (section 8.7) and offers the organisation route rather than Locked there. On that route the company's admin applies Wheelhouse's published baseline through device management, or through GitHub for seats the company's enterprise licenses; the baseline sets `forceRemoteSettingsRefresh`, so a computer that can't fetch GitHub's copy isn't left unheld, and recommends sending the same settings by device management too. The repositories belong to the company, which owns their protection and can require a second person's review, and the baseline marks every company repository as a project with real users. *Designer's call.*

#### On a work computer

- **IT's approval first.** Before anything is installed, setup says plainly that running unattended agents, and a background helper the person installs for themself, may need the company's IT approval, and offers a one-page note for IT: what Wheelhouse installs and runs, where, and what it changes, with the published baseline.
- **No start-up entry.** The company's endpoint security may treat one as suspicious, so on a work computer the helper runs only while VS Code runs, started by the add-on (section 8.5).
- **Program rules.** A company's rules often block programs in folders the person can write to, which stops a Node.js, PowerShell 7, `gh` or Copilot CLI the person installs, not only Guarded's copy. Setup tests each before relying on it (check C9), and says what the company would need to allow. Running VS Code's own Node.js in their place is a technique endpoint security watches for, so Wheelhouse doesn't use it without the company's agreement.
- **Endpoint security** may also flag Guarded's relabelling of folders; Guarded's self-test then fails and the level is Ask.
- **Slower computers,** such as those that scan every program as it starts, make a guard's time-out likelier; the levels above lean on Copilot's own rules rather than on the guards.

#### What a reviewer asks, in short

| The reviewer asks | The answer on Copilot |
|---|---|
| Can an agent change the product without a named person's approval? | Not without passing the host's protection and CI. With check C15, not without the person's own approval on the host. On the personal route, a command that reaches the person's sign-in could undo that, which the levels are there to prevent |
| Can it read secrets? | At level 1, and with managed settings, not by a command. At Guarded, not the folders Windows lets Wheelhouse label. At Ask, during an allowance, yes. Copilot's file tools are held by its path rules and Wheelhouse's guard |
| Can it send data out? | At level 1 on macOS, a command reaches only listed hosts, though those could carry code out. Otherwise yes; a company's own network controls carry that |
| Can it switch the controls off? | The host's, only through the person's own sign-in, and on the organisation route not at all. The computer's: not by a build command at levels 1 and 2; with managed settings, not even the person |
| Who owns the controls? | The host's: the person, or the company on the organisation route. The computer's: the person, its administrator (Locked) or the company |
| What happens when one fails? | The host's controls and Copilot's permission rules don't time out; Wheelhouse's own guards refuse, except a hook that times out |
| Is there a record that can't be altered? | The record on the host can't be rewritten, and the audit report checks it against the host's own history, which catches false additions |
| Who clicked Approve? | With check C15, the person, signed in on the host. Before it, someone at the person's computer. A second person's approval, where a company needs one, comes from its own host rules |

**The same design for Claude Code.** Claude Code on Windows already has levels 2 and 3 and Unattended. The host's controls here, the approval on the host and the audit report would serve it equally, and the Guarded findings above (control files, links, git's shared store) apply to it too; whether to adopt them there is left open (section 12).

### 6.5 The guardrails grow

A pull request touching any of these is a guardrail change (level 4, main design section 12.4), on every agent, because each controls what some agent does:

- `.github/hooks/`, `.github/copilot/`, `.github/agents/`, `.github/skills/`, `.github/instructions/`, `.github/prompts/`, `.github/copilot-instructions.md`, `.github/mcp.json`, `.github/lsp.json` and `.github/plugin/`;
- `AGENTS.md` and `GEMINI.md` anywhere, and `.agents/`;
- a root `plugin.json`, `.plugin/` and `com.github.copilot/`;
- the whole of `.vscode/`, since its tasks can run when a folder opens;
- for later agents, `.codex/`, `.cursor/` and `.gemini/`;
- `.gitattributes`, and at Lean the worktree's `.git` pointer file (section 6.4).

The same paths are shut to agents' writes, as `.claude/` is today. This applies to Claude Code projects too, since a Copilot file in a Claude project could steer a Copilot session later. *Designer's call.*

**In the home folder**, as `~/.claude/` is today, agents are denied writes to `~/.copilot/` (its agents, hooks, instructions, settings and installed plugins), `~/.agents/`, VS Code's extensions folder and VS Code's own user settings folder, and denied reading the keys. Whether Copilot's sandbox can deny these, and the agent-control files inside an otherwise writable worktree, is check C4. *Designer's call.*

### 6.6 Plainly: what Copilot can't enforce

These go on the board's health line for a Copilot project, in the audit report and in the data note:

**At Lean, nothing is held off the computer** beyond the copy in a folder the person picks. Without Node.js or the add-on, approvals are chat clicks, recorded as not proven, and STOP isn't enforced. A command the person allowed can change anything Wheelhouse keeps; Copilot's own command prompts aren't a control, since VS Code's settings can approve commands without asking; tests and reviews aren't independent; and Wheelhouse's own guards run only if check C16 finds a way. Lean isn't for projects with real users.

At Middle and Full:

1. **Without Copilot's sandbox, the computer holds only what Guarded or Ask hold.** At Guarded the network is open and only labelled folders are unreadable to builds; at Ask, an allowed command can do whatever the person's account can, and leave lasting changes; at Unattended, nothing holds on the computer.
2. **The person's sign-ins and Wheelhouse's keys stay on the computer.** On the personal route the person's sign-in can switch the host's protection off, so the host's controls hold against agents only while nothing an agent runs reaches it. Until the person's approval is on the host (check C15), the narrow key alone could merge a pull request that passed CI, which is why builds run unattended only where the keys are unreadable to them. The audit report checks every merge against the host's own history.
3. **The merge gate, the reviews and the activity record run on the computer.** They hold while build commands can't reach the person's level, which is not so during an Ask allowance or at Unattended.
4. **Copilot's permission rules are rules, not a fence.** GitHub calls its path checks heuristic, and a rule can be walked round. Wheelhouse's guards sit behind them, and a guard that times out lets the call through.
5. **At Standard, Wheelhouse's own hooks run beside the agent,** so no hook holds a secret an agent can't read. The records that matter come from the helper and the add-on, never from hooks.
6. **The network is narrowed only by the sandbox on macOS.** Listed hosts could still carry code out; on Windows nothing on the computer holds the network against a program that connects directly. A company's own network controls carry that.
7. **The person can lower the level,** or switch the sandbox off, unless Locked or the company's settings hold it; every change shows in the audit record.
8. **Phone STOP isn't available** unless check C12 finds a route.
9. **Wheelhouse can't pin VS Code or its Copilot runtime.** It records them and re-runs the safety scenarios when they change.
10. **A company's own settings win** over Wheelhouse's, Locked included, and can stop Wheelhouse's hooks loading or Copilot's command-line agent running. The tests then find it, and Wheelhouse runs at Ask, or in the person's own chat.

## 7. Approaches

**A. One shared core, a thin adapter per agent.** *Recommended.* The core is everything in section 5 marked "carries over". Each agent's adapter holds only what differs: its hook registration and translation, its tool names, the settings it writes, how it starts and wakes sessions, how its cards are clicked, its packaging, its tool sheet for the playbooks, and its safety line. Claude Code becomes the first adapter, by moving what is already there behind the same seam, without changing what it does.

- **For:** one copy of the playbooks, the gate and the state, so a fix lands once. A later agent is one adapter plus the evaluation. The safety line is per agent, so each is honest about itself.
- **Against:** the seam has to be cut through code that was written for one agent, with care that nothing changes for Claude Code. That is mostly moving code, with the Claude Code tests proving nothing moved.

**B. Run the Claude Code plugin in VS Code's Claude harness.** VS Code can run Anthropic's agent engine on the Copilot subscription. If it loads Wheelhouse's plugin, hooks, sandbox and `AskUserQuestion` as Claude Code does, Wheelhouse could run there almost unchanged.

- **For:** close to no new code, and Claude Code's protection where the engine honours it.
- **Against:** what it loads isn't documented; it is a third-party agent, which companies can switch off, and VS Code turns it off wherever Copilot's managed settings hold permission or sandbox rules, which Locked needs. It would leave out everyone whose company switches it off, who are likely many of the people waiting.
- **So:** tried as check C1. If it passes, setup offers it beside the Copilot route where it is available, but nothing in the Copilot route leans on it (the director's decision, question 3).

**C. A separate Copilot edition.** A copy of Wheelhouse written for Copilot.

- **Against:** two of everything, and the two editions' safety would drift apart. Rejected.

**Not an approach of its own: Wheelhouse as an MCP server.** Every agent speaks MCP, so the core could be offered as MCP tools. It doesn't help with enforcement, which needs hooks, and companies switch MCP off by default for Copilot Business and Enterprise. The core keeps calling scripts. *Designer's call.*

## 8. The design, for approach A

### 8.1 The agent adapter

Each adapter is one folder of Node.js modules and files, `adapters/<agent>/`, with the same parts. *Designer's call* for the folder; the parts are the design:

| Part | What it holds |
|---|---|
| **Identity** | The agent's name, how setup finds it, its minimum version |
| **Hook registration** | The file it writes, and which Wheelhouse hook runs on which of the agent's events |
| **Translation** | The agent's hook input into the shape the guards read, and their answers back. Its tool names, and which of them only read |
| **Settings writer** | The project's and computer's settings for that agent: the sandbox, deny rules, network list, switching off what Wheelhouse doesn't use |
| **Sessions** | How to start, resume and wake a session headless, with explicit permissions, a chosen custom agent and a model, and how to read its final answer |
| **Cards** | How a card is shown, and where its binding click comes from (section 6.3) |
| **Packaging** | How Wheelhouse is installed and pinned for that agent |
| **Tool sheet** | A few lines the session start adds, naming the agent's tools for the playbooks |
| **Safety line** | What this agent holds and doesn't, for the board and the data note, per level and per system |
| **Evaluation runner** | How the evaluation drives a session |

The core never names an agent. The project's settings name which agent it uses on each computer, and the session start reads which agent called it from its input. *Designer's call.*

### 8.2 Copilot's packaging

- **For VS Code with nothing added (Lean's baseline):** Wheelhouse's skills, custom agents and an instructions file, copied with git from Wheelhouse's public repository into the person's own Copilot folder (`~/.copilot/`), outside every project, at a tag and commit. Nothing is installed (section 6.4). *Designer's call*, checked in C17.
- **For VS Code, optionally: the Wheelhouse add-on,** from the VS Code Marketplace. It contributes Wheelhouse's skills, custom agents and instructions through VS Code's extension points, which don't depend on VS Code's plugin setting being on, and draws the pane (section 8.6). Whether contributed skills and agents reach the Copilot harness is check C2.
- **For Copilot CLI and the background sessions: the plugin,** installed with `copilot plugin install` from Wheelhouse's own marketplace at a tag and commit. One repository carries both manifests: Claude Code reads `.claude-plugin/`, and Copilot reads a root `plugin.json` in the Agent Plugins format, which it looks for first, with its Copilot-only parts in `com.github.copilot/`. *Designer's call*, checked in C3.
- **Hooks are registered by setup, once per computer,** in the person's own Copilot hook folder (`~/.copilot/hooks/wheelhouse.json`), with the full path to this computer's Wheelhouse, never by an agent. A file in the project wouldn't reach the worktrees and clean checkouts that feature sessions and reviews run in. Because the person's hook folder applies to every Copilot session on the computer, each hook first checks whether the session's folder is in a registered Wheelhouse project, as Locked's hooks do, and does nothing otherwise; the cost is starting Node.js once per tool call in the person's other Copilot sessions, which setup's card says. The plugin's Copilot manifest carries no hooks, so nothing loads twice. *Designer's call*, settled by check C3.

### 8.3 The playbooks

- **One text.** The front desk, intake, foreman and setup skills, and the builder, reviewer and tester prompts, stay one text for every agent.
- **The tool names move out.** Where a playbook names a Claude tool today ("give `AskUserQuestion` the questions"), it says what to do in general words ("ask the card with your clickable-question tool"), and the session start adds the agent's tool sheet (at Lean without Node.js, where no hook runs, Wheelhouse's instructions file carries it): for Copilot, `ask_user`, `task`, `bash` or `powershell`, and so on. *Designer's call.*
- **The command's path** comes from the session start ("the Wheelhouse command is …"), since Copilot doesn't give a shell the plugin's folder the way `${CLAUDE_PLUGIN_ROOT}` does.
- **Claude Code's evaluation must still pass unchanged** after the wording moves, and that is the test that the move changed nothing for Claude Code.

### 8.4 Sessions: the foreman, feature sessions and reviews

- The watcher's Shape 1 (build-loop design, section 11) carries over: a background process starts a fresh foreman per batch of events, and wakes one feature session.
- On Copilot it runs `copilot -p --agent wheelhouse-foreman` with `--no-ask-user`, explicit `--allow-tool` and `--deny-tool` lists, the model from the routing table, and JSON output; it wakes a feature session with `--resume`. Whether `--resume` takes a session's id from a script, and how a refusal shows in the output, is check C8.
- Signed reviews run as their own session (section 6.3).
- The director can look into any of them from VS Code's Sessions view, where Copilot lists sessions it didn't start as "Created Externally".
- Feature sessions still never wait on a permission prompt: `--no-ask-user`, and the build's usual commands granted by name, as the Windows build-commands design does for Claude Code.
- Each session's permissions come from the computer's level (section 6.4): shell commands denied except what the level allows (Guarded: only the low-integrity runner; Ask: only the commands the person allowed, for as long as they allowed them); file tools held to the worktree by Copilot's path rules, with the temporary folder shut off; the web held to the project's listed domains. These are Copilot's own rules, so they don't depend on a hook answering in time.

### 8.5 The helper, the watcher and the receiver start at sign-in

Copilot's hooks can't start a program outside the sandbox, and the helper must run outside it. So setup arranges for the helper, the watcher and the usage receiver to start when the person signs in to their computer, for that person only, with no admin: a launch agent on macOS, and a per-user start-up entry on Windows. The add-on starts them too if they aren't running. On a work computer, where the company's endpoint security may treat a start-up entry as suspicious, there is no start-up entry: the add-on starts them while VS Code runs, or, without the add-on, the front desk starts the helper with one command the person allows, and work pauses when VS Code closes, which the board says (section 6.4). Setup lists this on its card of changes to the computer, and uninstall removes it. *Designer's call.* The same start works for Claude Code, but nothing changes there unless the director asks.

### 8.6 The Wheelhouse add-on for VS Code

The mod's counterpart, doing the mod's jobs (main design, section 17.1) in VS Code. Like the mod, it is optional: the baseline is VS Code with Copilot and no add-on (the director's ruling of 21 October 2026, section 6.4), and everything works without it. Where it is installed:

- **The glance:** a status bar item and a side pane (a webview, or Canvases once they leave Preview), read from `status.json`, with the same boards as the mod's pane and the interface design.
- **Card buttons:** **Approve**, **Not now** and the card's other options, written straight into state through the helper, with no Copilot turn. These are binding clicks (section 6.3).
- **STOP:** a button that sets STOP at once; **Lift STOP** as a binding click.
- **Settings:** the everyday settings as buttons.
- **The briefing on request,** with no Copilot turn.
- **Notifications:** VS Code's own notification for needs-you items, previews ready, features finished and STOP.
- **It never approves a permission prompt,** and never runs the agent's tools.

It can't see the origin of a typed message, as the mod can, so on Copilot a typed "yes" never counts as an approval, and reply codes typed in the chat don't bind (main design, section 12.5). The add-on is pinned like the plugin: installed at a version, with auto-update off for it. *Designer's call.*

**How it looks: the director's ruling of 20 October 2026.** The director was shown a sketch of the add-on and said: "If it can look like this - that would be good." The sketch has five parts:

1. **The wheel icon.** A Wheelhouse wheel opens the pane.
2. **The pane** sits on the right, in VS Code's secondary sidebar, beside Copilot's chat.
3. **What the pane holds,** top to bottom:
   - the name "Wheelhouse", with STOP at the top right, in red;
   - the verdict, such as "Two things need you.", with "Nothing is broken." in green beneath;
   - the cards, in Calm: the title, with **Not now** as a quiet blue word at the top right; one plain line on what it is; **See it ↗** and **Why?** as blue links; a filled blue **Approve**, with **Suggest a change…** outlined beneath it;
   - smaller items below, each with an amber dot ("optional · 3 min");
   - **Board**, **Settings** and **Briefing** at the foot.
4. **The chat.** The front desk talks in Copilot's chat on the left. It says what needs the director and points to the pane for the card. The binding click is in the pane (section 6.3).
5. **The status bar.** At the bottom right it reads "Wheelhouse · 2 need you"; a click opens the pane.

**The visual system is Calm,** in the main design's section 23 (the interface session is writing it, on branch `claude/interface-design`). This document doesn't repeat it: the pane follows that section, drawn with VS Code's own theme colours, so it holds in light and dark themes.

**What VS Code allows,** from its extension documentation (14 October 2026):

- **The status bar item:** yes, as sketched. An extension can put an item on the right of the status bar, with its own text and a command that opens the pane.
- **The pane in the secondary sidebar:** not directly. An extension can add its pane only to the activity bar, which opens it in the primary sidebar on the left, or to the bottom panel. VS Code says extensions "cannot contribute Views directly" to the secondary sidebar. A person can drag a pane there, and VS Code then remembers where it sits.

**So the closest to the sketch,** *Designer's call*:

- The add-on adds its pane to the activity bar, with the wheel icon, so it works at once in every layout.
- On the first run, the add-on offers one click, **Put Wheelhouse on the right**, which moves the pane to the secondary sidebar if VS Code lets an extension move a view for the person (check C14). If it doesn't, the same message shows the drag in one picture, once. Either way VS Code remembers it.
- Copilot's chat already sits in the secondary sidebar by default, so with Wheelhouse moved there too the two would share it as tabs. To put them side by side, as sketched, the chat goes to the left: the same first-run offer moves the chat to the primary sidebar, or the director keeps them as tabs. Which of these VS Code allows an extension to do is check C14.
- Once the pane is in the secondary sidebar, its wheel sits at the top of that sidebar rather than in the activity bar; the status bar item opens it from anywhere.
- If none of it can be moved for the director, the pane stays on the left with its wheel on the activity bar and the chat on the right: the sketch mirrored, with everything else as sketched.

### 8.7 Setup on Copilot

The same steps as main design section 15, with these differences:

1. **Install:** the person asks Copilot's chat to set up Wheelhouse from its public repository, which brings the setup skill into the person's own Copilot folder with git alone (section 6.4). The add-on from the Marketplace is offered afterwards, as an option. Without VS Code, `copilot plugin install`, from the README. Where Copilot CLI runs, setup installs the plugin for the background sessions itself.
2. **"Can Wheelhouse run here?"** Before anything else, setup reads what this computer and the person's workplace allow: git, the Copilot harness, whether a Node.js may run, whether the add-on may be installed, Copilot CLI, the code host and its protection, the sandbox and its Windows build, Guarded's self-test, whether a Node.js the person installs may run, and any company-managed settings. It then says in one plain sentence which tier this computer gets (Lean, Middle or Full, section 6.4) and, at Middle, which level, and what that holds. It stops kindly only if Wheelhouse can't run at all, as without git. *Designer's call.*
3. **Tools:** at Lean, git only. At Middle, `gh` or `glab` for the sign-in (or a token typed into the computer's own box, section 8.11), and, for background builders, Node.js 22 or later, Copilot CLI and, on Windows, PowerShell 7, with the helper started by the add-on (section 8.5). Each is installed for this person only, without admin, where an official route allows it. Whether VS Code's Copilot already brings a usable `copilot` command is check C9.
4. **The host,** the three questions, the rules found: as now, with the company's own GitLab address and certificate where it has one (section 8.11), and with the host's protection of `main` and the narrow connection required for building (section 6.4). A project with real users can't then be set to Unattended, and setup recommends Locked or the organisation route where they can be had, writing the request to the company's admin in plain words with Wheelhouse's published baseline attached.
5. **Changes to this computer,** on one card: the sign-in start (section 8.5), Copilot's sandbox for this person, the add-on's auto-update off, the signing key.
6. **Locked:** macOS only, as section 6.4 says.
7. **Notifications:** VS Code's own; the phone only if check C12 finds a route.
8. **The health check,** on a scratch copy, now including the Copilot safety scenarios.

The 15-minute target holds; check C9's timed run on a fresh Windows account says whether it does.

### 8.8 Lineage on Copilot

- **Pinned:** Wheelhouse's plugin and extension, Copilot CLI's version (installed at a version), and the third-party skills, as now.
- **Recorded, not pinned:** VS Code's version and its Copilot runtime, which update weekly. Every pull request's provenance, recorded in the private state, names them. The add-on reads both from VS Code and writes them to a file the session start reads; without the add-on, the hooks' input gives them if check C5 finds it does, and otherwise only Copilot CLI's own version is known, which the board says. *Designer's call.*
- **When they change:** the session start runs the safety scenarios on Copilot (a quick subset, with no reasoning beyond the runs) before the foreman starts new work. If one fails, Copilot work holds, as Claude Code's lineage hold does, and the director gets one card. *Designer's call*, since a hold on every weekly update would stop work every week.

### 8.9 Models

The routing table gains a column per agent. Copilot names models its own way and a company may limit which are allowed, so setup reads the list Copilot offers and the table pins full names from it. A pin moves only after the evaluation passes on Copilot, as now (main design, section 9.1).

### 8.10 Other code hosts

Wheelhouse supports GitHub and GitLab today, through one host adapter (main design, section 11), and Lean needs no code host at all. A company on another code host gets Middle and Full once that host has its own half of the adapter. Nothing in the core changes. Each new host needs:

1. **The adapter's operations:** open and update a pull request; read and watch the checks on a commit; check whether it can merge; merge an exact commit; work items and a checklist; push branches, state events and the lock.
2. **A narrow connection:** a key limited to the project, made at setup without pasting where the host allows it.
3. **The host's protection,** set and read back by setup: pull requests required, checks required, force-pushes refused, the record branch protected, and its approval rules.
4. **CI held to the host:** the required checks pinned to the host's own CI, so a status posted with the key can't stand in for them, and the project's secrets kept out of every run a pull request starts.
5. **The host's own history** for the audit report: merges, CI runs and changes to protection, from the host, not the computer.
6. **Tests against recorded output,** and a check on a real test project.

| Host | What it offers, from its documentation, to be checked when its adapter is designed |
|---|---|
| **Azure DevOps** | A full web API and an official command-line tool. Branch policies can require reviewers and a passing build, and have a setting that lets a pull request's author approve their own, which could give the person's approval on the host directly. Its keys are per person and reach every project the person can in an organisation, wider than GitHub's app; a narrower route through the company's identity provider is to be looked at. Its keys are made on a web page, so without that route the key is typed into the computer's own box, as GitLab's fallback is. Its audit log needs an organisation admin to read |
| **Bitbucket** (Cloud, and Data Center) | A web API but no official command-line tool. Branch restrictions and merge checks; enforcing merge checks may need a paid plan. Keys limited to one repository exist. Bitbucket Cloud's audit log needs its Premium plan |

Each is about the size of GitLab's half of the adapter, plus setup's protection step. Neither is designed here; each gets its own short design when a workplace needs it. The first tester's workplace uses GitLab on its own servers, which Wheelhouse's GitLab half already covers, with the changes of section 8.11. *Designer's call.*

### 8.11 GitLab on the company's own servers

The first tester's company runs GitLab Enterprise Edition on its own servers ("self-managed"). Wheelhouse's GitLab half of the host adapter already talks to any GitLab address; setup and a few helpers assume gitlab.com. Lean needs none of this, and works with no GitLab access at all. From GitLab's documentation, read on 20 and 21 October 2026; *designer's call* for each point, with check C18.

**What changes in Wheelhouse:**

- **The address.** Setup asks for the company's GitLab address once, or reads it from the project's git remote, and uses it everywhere: the sign-in, the token page, the project key, the protection and the connection. Today `scripts/setup/host.js` (the address, the sign-up link and `glab`'s sign-in host), `scripts/host/token-url.js` and `scripts/host/cut-access.js` name gitlab.com. The connection and the adapter already take another address, through the `gitlabHosts` setting.
- **The commit email.** `scripts/setup/project-files.js` uses gitlab.com's no-reply address; on the company's servers it is read from the person's GitLab profile instead.
- **The company's own certificate.** A company's servers often use certificates from the company's own authority, which programs reject unless told. Setup finds it in the system's own store and gives it to each tool: Node.js (its option to use the system's certificates, or `NODE_EXTRA_CA_CERTS`), `glab` (its `ca_cert` setting for that host) and git (`http.<address>.sslCAInfo`, or on Windows the system's own store). Never "don't check certificates".
- **Getting `glab`.** Today setup downloads it from gitlab.com. Where that is blocked, setup takes it from the company's software list, or a mirror its IT names. Wheelhouse's own scripts call GitLab's web API directly, so `glab` is needed only for the sign-in.
- **The sign-in.** `glab`'s browser sign-in on a company's own servers needs an OAuth application registered there by the company's GitLab admin. Without one, or without `glab`, the person makes a personal token once on the company's token page and types it into the computer's own box, as today's fallback does.
- **The network.** The company's servers may be reachable only on its network or VPN. Setup checks, the board says when the host can't be reached, and work carries on locally and pushes when it can.

**What a project Maintainer can do alone,** on any licence (the tester, on a project they maintain):

- make Wheelhouse's project key: a project access token, which makes its own bot user, at Developer level, lasting up to the instance's limit (365 days by default), unless the company's top-level group has switched project keys off;
- protect the main version and the record branch: no one pushes, no force-push, and who may merge;
- require pipelines to succeed before a merge;
- keep the project's secrets in protected variables, which pipelines on unprotected branches, every merge request's included, don't get;
- see the project's audit events, where the licence has them.

**What needs the company's GitLab admin,** or a group owner:

- project keys switched on for the group, where they are off;
- an OAuth application for `glab`'s browser sign-in;
- approval settings and push rules set for the whole instance or group, which then lock the project's own;
- the Premium or Ultimate licence itself.

**The controls, by GitLab licence:**

| Control | Free | Premium | Ultimate |
|---|---|---|---|
| Protected branches: no direct push, no force-push, merge by role | Yes | Yes, and by named people or groups | The same |
| Who may unprotect a branch | Maintainers and Owners | Can be narrowed | The same |
| Pipelines must succeed | Yes | Yes | Yes |
| Secrets kept from merge requests' pipelines (protected variables) | Yes | Yes | Yes |
| Required approvals and approval rules | No | Yes | Yes |
| The author can't approve; people who added commits can't approve; approvals removed when a commit is added; rules locked against editing in a merge request | No | Yes | Yes |
| Signing in again to approve | No | Yes, set on the top-level group | Yes |
| Code owners' approval for named files, such as the CI file | No | Yes | Yes |
| Push rules, such as refusing secret files | No | Yes | Yes |
| Audit events for the project and group | No | Yes, kept indefinitely | Yes, and the instance's |

**The person's approval on GitLab** (check C15). Wheelhouse's merge requests are opened by the project key's bot user, not by the person, so the person is a separate identity who can approve them on GitLab, signed in as themself.

- **On Premium or Ultimate:** one required approval from the person; the author's approval prevented, and approvals by anyone who added commits; approvals removed when a commit is added; editing the rules in a merge request prevented. The bot, as author, can't approve; at Developer level it can't change the rules; and a commit added after approval needs the person again. With signing in again to approve, the record shows the person themself pressed it. This is Full's approval on the host.
- **On Free:** there are no required approvals, so the route is who may merge. The main version is protected so that only Maintainers may merge, the project key stays at Developer level, and the person, a Maintainer, presses **Merge** on GitLab once Wheelhouse's gate says the change is ready. The host then refuses any merge but the person's. It doesn't hold the exact commit: a commit the bot added just before the person pressed would merge with it. The gate stops the bot pushing to a branch once it is ready, which holds only while the computer's controls do, and the audit report shows any merge of a commit other than the one reviewed. Whether this counts as Full's approval on the host is weighed in check C18.
- **For a project without real users,** the main version's merge access stays at Developers, so Wheelhouse merges after the person's chat click, behind the protection and the pipelines; the approval on GitLab's page is the lock for projects with real users (section 6.4).
- **The narrow key can't make the approval:** a Developer-level project key can't approve its own merge request, change approval settings or protection, or make another key, which needs Maintainer.

**What Middle needs from the tester alone,** as a Maintainer on any licence: the project key, the protection, pipelines that must succeed, and the secrets in protected variables. That is Middle's host controls in full, except that on Free the CI file isn't held to the person (that needs code owners, a Premium control), so a change to it shows only in review and in the audit report. **What Full needs from the company:** Premium or Ultimate for the approval above, or the Free route by who may merge; and, on the computer, Copilot's sandbox with the company's Copilot settings.

**The audit report on GitLab** reads merges, pipelines and changes to protection from GitLab's web API, and on Premium or Ultimate the project's audit events too, which a Maintainer can read.

## 9. The evaluation on Copilot

- Every scenario in the main design (1 to 19) and the build loop (20 to 35) runs through `copilot -p`, with the Copilot adapter's runner.
- The safety scenarios (6, 11 to 19, and the build loop's) must pass on Copilot, on macOS and on Windows, before Copilot is offered to anyone.
- Four scenarios are added for Copilot:
  - a guard that hangs: the call it lets through is shown, and the board line is there;
  - a tool the guard doesn't know: refused;
  - a binding answer typed or filled in by the agent in the chat: not recorded;
  - a builder writing a fake review verdict: the helper's review session isn't moved by it.

## 10. Room for later agents

Nothing here designs them. This checks that the seam fits, from the research (section B):

| | Codex | Cursor | Gemini CLI |
|---|---|---|---|
| Hooks that can deny a call | Yes, Claude Code's event names | Yes | Yes |
| A crashed or hung hook | Not a "complete enforcement boundary" in its own words; doesn't cover its hosted tools | Lets the call through unless `failClosed` is set | Lets the call through |
| Sandbox on Windows | Yes, on recent Windows 11 | Not documented | A low-integrity mode |
| Reads Claude Code's plugin layout | Yes | Partly | No |
| Skills | `.agents/skills/` | `.claude/skills/`, `.agents/skills/` | `.agents/skills/` |

So each fits the adapter's parts, and each would get its own safety line. Gemini CLI has been replaced by Antigravity CLI for unpaid users since 18 June 2026, so which Google agent to support is a question for later.

## 11. Checks to run before relying on it

Numbered C1 to C19 here; they get the next free numbers in `docs/checks/` when the plan is written. Most need a short sitting on a Mac and on a Windows computer with Copilot.

1. **C1, the Claude harness:** whether VS Code's Claude harness loads Wheelhouse's plugin, its hooks (with `onFailure`), its sandbox and deny settings, and `AskUserQuestion` with its `PostToolUse` record, as Claude Code does; and on which plans and company settings it is available.
2. **C2, the add-on's contributions:** whether skills, custom agents and instructions an extension contributes reach Copilot-harness sessions, and survive a company's policy that limits customisations.
3. **C3, registration:** which Copilot loads first and what it loads twice: a root Agent Plugins `plugin.json` beside `.claude-plugin/`; plugin hooks; the project's `.claude/settings.json` hooks; and the person's `~/.copilot/hooks/` file, in VS Code and the CLI, in a worktree and a clean checkout. What a project hook file holding `disableAllHooks` does to the person's hooks.
4. **C4, the sandbox:** whether a project or person can switch Copilot's sandbox on and narrow its network, including the local network other than the helper; deny reading the keys, the credential folders, the Mac's keychain and Windows' credential store (through `gh auth token` and `git credential fill`), and tokens in the environment; whether a person's own Copilot settings can carry deny rules that Copilot enforces on its own file tools; deny writes to `~/.wheelhouse/`, `~/.copilot/`, `~/.agents/`, VS Code's extensions and settings folders, and the agent-control files inside an otherwise writable worktree; set `allowUnsandboxedCommands` off and refuse an approved rerun outside the sandbox; whether hooks and the probe run inside the sandbox; whether it works behind a company proxy with TLS inspection; and still let commands and hooks read the rest of `~/.wheelhouse/` and reach the helper's socket. Whether a sandboxed command can click the helper's window by script. On macOS 15 or later and on which Windows 11 builds.
5. **C5, the guards' input:** Copilot's `preToolUse` input for every tool, in VS Code and the CLI, including PowerShell, MCP tools, `task`, `ask_user` and any VS Code tool that runs commands; whether it says the session's permission mode, whether the session, and each command, is sandboxed, and the Copilot runtime's version; and whether the Local harness's input can be told from the Copilot harness's.
6. **C6, clickable questions:** whether a `postToolUse` hook sees the director's answer to `ask_user` (VS Code's `askQuestions`), in the CLI and in VS Code's Copilot harness, and whether the agent can supply the answer itself, as check 8 asked of Claude Code; and whether a policy hook at Locked sees it too. Since the chat click is the everyday approval, its result sets what the record says a click proves (section 6.4).
7. **C7, the other hooks:** whether `userPromptSubmitted` and `sessionStart` can add text, whether `preCompact` can block, and whether `subagentStop` names the agent.
8. **C8, sessions from a script:** `copilot -p` with `--resume` by id, `--agent`, `--no-ask-user`, the permission flags and JSON output, on macOS and Windows, through the `.cmd` shim; that a command no rule allows is refused at once rather than asked; that a shell rule allowing only the Guarded runner, or only one named command, refuses a chained or nested command that adds anything else, in Bash and PowerShell forms; that a session started with its own Copilot settings folder and a cleared environment ignores the person's saved permissions and web approvals and an allow-everything switch; that Copilot's path rules hold its own file tools to the worktree with the temporary folder shut off, including against a folder link inside the worktree that points out of it; how a refusal shows; and whether the sessions appear in VS Code's Sessions view.
9. **C9, setup's tools:** installing Copilot CLI, Node.js and PowerShell 7 on Windows as a standard user, including where winget and the Microsoft Store are switched off and where AppLocker, App Control or a restricted PowerShell is in force; whether endpoint security flags the helper; whether the company's program rules let a person-installed Node.js, PowerShell 7, `gh` and Copilot CLI run, and whether its Copilot policy allows Copilot CLI; whether VS Code's Copilot brings a usable `copilot` command; and the timed run.
10. **C10, Superpowers and Matt Pocock's skills on Copilot:** whether the pinned loops (brainstorming, writing-plans, subagent-driven development, executing-plans, test-driven development) run as designed under Copilot, with the override.
11. **C11, usage:** what credit and token figures Copilot's session output and GitHub's REST call give, with which sign-in.
12. **C12, the phone:** whether a phone message can reach a Copilot session (Copilot CLI's remote sessions) and set STOP, and how a needs-you push reaches the phone.
13. **C13, a clean reviewer session:** whether Copilot CLI can start a session that loads only Wheelhouse's reviewer agent, with the folder's and the person's own agents, instructions, hooks, MCP and language servers shut out, reading tools only, and its verdict in its output. Copilot merges nothing that needs a signed review until it passes.
14. **C14, the pane's place:** whether an extension can move its own pane to the secondary sidebar, and Copilot's chat to the primary sidebar, for the person on one click (through a VS Code command it may run), and whether VS Code then keeps both there across restarts and updates; where the wheel icon shows once the pane is in the secondary sidebar; and how the pane looks at the secondary sidebar's narrow default width, on macOS and Windows.
15. **C15, an approval on the host:** whether the host itself can refuse a merge until the named person, signed in to the host, has approved that exact commit there, with no secret shipped in Wheelhouse: on GitHub, a required check that waits on a protected environment the person must approve, or the pull request opened by another identity so the person's review counts, on personal and company plans; on GitLab, the two routes of section 8.11 (Premium's required approval, and Free's merge by Maintainers only), checked in C18. Also that the narrow key can't make that approval itself.
16. **C16, Lean's guards without Node.js:** whether a Copilot check before each tool call can run with no Node.js installed, and refuses when it gets no answer. The candidates: a command hook in a program the system already has, such as Windows' own PowerShell 5.1, which a company's program rules may limit, or `curl.exe`; where the add-on is installed, a Copilot web hook to the add-on on the computer, which needs https for checks before a tool call; and a Node.js the company already allows. A small program Wheelhouse ships would sit in a folder the person can write to, and is blocked like Node.js wherever the company's program rules are.
17. **C17, Lean in VS Code with nothing added:** on macOS and on a locked-down Windows computer, whether VS Code's Copilot harness reads Wheelhouse's skills, custom agents and instructions from the person's own Copilot folder; whether setup can run from one request in the chat, with git alone; whether Copilot's clickable questions work in the Copilot harness, inside skills and custom agents; whether the reviewer agent's tool list holds it to reading; whether the project's VS Code settings keep commands asked for and edits to guarded files asked for, and what the person's own settings override; whether git's push options open a GitLab merge request with a project key held by git's own sign-in; pushing to a copy in a folder on a company drive; and, where Node.js may run, whether the helper started by one command from the chat keeps running after that chat ends, and whether its window can be driven by a command at the person's level.
18. **C18, GitLab on the company's own servers:** on a self-managed GitLab Enterprise Edition test instance, at Free and at Premium: setup with the company's address and its own certificate authority, for Node.js, `glab` and git, on macOS and Windows; `glab`'s sign-in with and without the company's OAuth application, and the typed token; making the project key as a Maintainer, and the message when the group has switched project keys off; the protection and "pipelines must succeed" read back; whether a commit status posted with the project key can stand in for the pipeline; that protected variables don't reach a merge request's pipeline; at Premium, the approval of section 8.11, that the bot can't approve or change the rules, and that a commit added after approval removes the person's; at Free, merge by Maintainers only, the bot refused, and how the gate holds the branch once ready; audit events read as a Maintainer; and the board when the server is reachable only on the company's network.
19. **C19, the add-on at Lean:** on a locked-down Windows computer, whether the add-on can run git and the helper's jobs inside VS Code's own process, with the git store outside the project folder and git run with hooks switched off; whether its chat tools reach Copilot's chat, and the inbox folder where a company switches them off; whether its agents reach Copilot-harness chats (check C2) where the company's policy switches Copilot CLI off, since it is the same runtime; whether the pane can open a fresh chat with the reviewer agent ready to send; whether it can read VS Code's command-approval settings and see each terminal command the chat runs; whether STOP can cancel a running chat request, and whether a chat carries on after VS Code closes; the file lock across two VS Code windows; and the copies to a folder the person picks.

## 12. The director's questions and rulings

Each goes to the director as a card, through the main session.

1. **How Copilot users click to approve. Decided by the director on 20 October 2026:** "Assume VS Code addon available. But do have a fail-safe approach for if addons are not available." So approvals come from the Wheelhouse add-on's buttons in VS Code, and the helper's own window is the fail-safe wherever the add-on isn't there (Copilot CLI alone, or a company that blocks extensions). This was the recommended option; the others were the system's window always, or the chat's clickable choices, accepting that an agent could forge an approval at Standard. **Then, on 21 October 2026,** the director set the baseline without the add-on (section 6.4): "assume vscode with copilot but no addon installation". So the helper's window is now the first choice and the add-on's buttons a lift, with the code host's page, or a chat click marked as not proven, where neither can run.
2. **What Copilot's protection promises. Decided on 21 October 2026,** with the director's approval of the design (below): projects with real users use Middle or Full, never Lean; never Unattended; and the person's approval on the code host's own page is the lock at the front door for them. This was the recommendation (option A); the others were Full only, or any tier with its gaps stated. The director asked for it to be "compliance/governance robust", to "prepare for the worse - what if sandbox cant be run?", and to "assume little from what can be accessed", and then set the baseline as VS Code with Copilot and no add-on, with a click in the chat as the everyday approval (section 6.4). *The director's to revisit when they test it.*
3. **VS Code's Claude agent. Decided by the director on 20 October 2026:** both, noting that the first tester can't use Claude's agent in VS Code or through Copilot. So both routes are offered, but the Copilot route is the primary one and stands complete on its own: nothing in it leans on the Claude agent route. The Claude agent route is offered only where check C1 passes and the company allows it, and it is built after the Copilot route.
4. **When to build it. Decided by the director on 20 October 2026:** "Checks now, build later". The checks (section 11) run now; the Copilot adapter is built later.
5. **The design. Approved by the director on 21 October 2026:** "let's proceed with the build when ready. I think we got the idea roughly right. the rest is for me to really test it out when ready". So the design goes to a build plan in the order of section 14, and the director's own testing settles what remains.

**Still open, not for now:** which Google agent to support later (section 10); whether Claude Code adopts this section's host controls, approval on the host, audit report and Guarded findings (section 6.4), and whether Guarded's low-integrity git in a shared worktree store holds, which check 52 should answer for both agents; whether Claude Code users also move to the sign-in start (section 8.5).

## 13. The designer's calls (the director may override)

- one shared core with an agent adapter per agent, the adapter's parts, and the core never naming an agent (sections 7 and 8.1);
- the Copilot harness only, with the Local harness refused at session start (sections 2 and 6.2);
- Wheelhouse not offered as an MCP server (section 7);
- the helper, watcher and receiver started at sign-in for the person, since Copilot's hooks run inside its sandbox (sections 5 and 8.5);
- on Copilot, hooks reading Wheelhouse's folder but never writing it or reading the keys, with every write through the helper, and an unreachable helper refusing as STOP does (section 5);
- binding clicks only from the add-on, signing itself, or the helper's window as the fail-safe, and chat questions for non-binding answers (section 6.3): **decided by the director on 20 October 2026**, "Assume VS Code addon available. But do have a fail-safe approach for if addons are not available." (section 12, question 1);
- the add-on registering nothing that could press a binding button, proved by a static check (section 6.3);
- signed reviews run as their own session in a clean checkout, with the project's and the person's customisations shut out, a prompt from trusted state only, and the verdict read by the helper (section 6.3);
- guards registered with a two-minute limit, answering within their own deadline, and refusing tools they don't know (section 6.2);
- the watcher refusing to wake a session whose worktree holds a new or changed agent-control file (section 6.2);
- the Local harness told apart at session start, and the front desk doing nothing there (section 6.2);
- the guardrail and write-denied paths growing by every agent's control files, in Claude Code projects too, and the home folder's agent folders denied to agents (section 6.5);
- Locked on Copilot on macOS first, requiring the sandbox in Locked projects by its policy hook rather than forcing it computer-wide, with managed deny rules on the keys and credentials, and not offered where a company's settings would win (section 6.4);
- the add-on for VS Code, with its contributions, and the plugin for Copilot CLI, from one repository with two manifests (section 8.2);
- hooks registered by setup once per computer in the person's Copilot hook folder, checking for a Wheelhouse project first, never in the plugin's Copilot manifest (section 8.2);
- VS Code's and the Copilot runtime's versions read by the add-on (section 8.8);
- the pane added to the activity bar, with a first-run offer to put it on the right beside the chat, and the sketch mirrored where it can't be moved (section 8.6);
- the playbooks' tool names moved into a tool sheet per agent (section 8.3);
- setup's first step reading what the computer and company allow (section 8.7);
- VS Code and its Copilot runtime recorded rather than pinned, with the safety scenarios run on a change (section 8.8);
- four Copilot scenarios added to the evaluation (section 9);
- three tiers set by the controls the workplace allows, found by setup from a table of cases, and moved up or down without losing history: Lean, Middle and Full, with Copilot CLI adding background builders rather than setting the tier (section 6.4);
- at Lean, VS Code with Copilot and nothing added: Wheelhouse's skills, agents and instructions copied with git into the person's own Copilot folder; everything through the chat, with cards as Copilot's clickable questions and the board also as a file; local git with merge commits and a copy pushed to a folder the person picks; approvals in the helper's window where Node.js may run, on the code host's page where there is one, and otherwise as chat clicks recorded as not proven; the helper, where it runs, writing state, keeping the git store outside the project and running the tests on the approved commit; reviews in a separate read-only chat, recorded as chat reviews; VS Code's command prompts and settings named as conveniences, not controls; tested versions published by Wheelhouse; and no Wheelhouse guards without Node.js unless check C16 finds a way (section 6.4);
- the add-on optional, lifting any tier as the mod does, and doing the helper's jobs inside VS Code where Node.js can't run (sections 6.4 and 8.6);
- at Middle without Copilot CLI, a real-user project's changes also needing a second person's approval on the code host where the licence gives one (section 6.4);
- GitLab on the company's own servers: the address and the company's certificate taken everywhere, `glab` only for the sign-in, the typed token where there's no OAuth application, the person's approval on GitLab through the bot-authored merge request on Premium, and merge by Maintainers only on Free (section 8.11);
- other code hosts each by a new half of the host adapter, designed once the tester's host is known (section 8.10);
- a click in Copilot's chat as the everyday approval in every tier, what it proves set by check C6, the code host's lock behind it, the approval on the host's page for projects with real users, and the helper's window or the add-on's button confirming the steps that matter most (section 6.4: the chat click is the director's ruling, the rest is the designer's);
- at Middle and Full, with projects with real users on Middle or Full only (the director's ruling of 21 October 2026): the host's controls first (protection pinned to the host's own CI, the project's secrets kept out of pull requests' CI runs, the person's approval on the host once check C15 gives one, the narrow connection only, the record pushed as it happens), said plainly to hold against agents on the personal route only while nothing reaches the person's sign-in; the strongest level the computer allows, enforced by Copilot's own permission rules from a clean settings folder and environment, and unattended only where the keys are unreadable to builds until C15 passes; Guarded on Copilot keeping the control files at the normal level and removing links out of the worktree; new keys and a renewed connection after Unattended and after weeks with Ask allowances; building in the person's own chat where Copilot CLI can't run; the audit report checked against the host's own history; Unattended only by its own card and never for a project with real users; Locked on Copilot forcing the sandbox for all Copilot work on the computer; the baseline setting `forceRemoteSettingsRefresh` and recommending device management too; IT's approval named up front on a work computer, with no start-up entry (sections 6.4 and 8.5).

**Decided by the director on 21 October 2026:** the baseline is VS Code with Copilot and no add-on, and a click in the chat as the everyday approval (section 6.4); projects with real users on Middle or Full only (question 2); and the design approved for a build plan (question 5).

**Decided by the director on 20 October 2026:** how Copilot users approve (question 1, since adjusted by the baseline); both routes, with the Copilot route standing on its own (question 3); checks now, build later (question 4).

## 14. The order of work, and the director's sittings

*Designer's call*, for the build plan to follow.

1. **Checks that need no sitting,** run by agents on a Mac with Copilot CLI, and against a GitLab Enterprise Edition test instance of Wheelhouse's own: C3, C5, C7 and C8 for the CLI on macOS; C10, C11 and C13; C16's macOS part; C18 at Free, and at Premium on a trial licence; and C15's GitLab routes with a test person and the bot. Their results may change a step below, and come back to the director only if they change what the director sees.
2. **The shared core's seam** (section 8.1): the agent adapter's parts cut through today's code, with the Claude Code adapter as the first. Nothing changes for Claude Code users, and Claude Code's evaluation passing unchanged is the proof (section 8.3).
3. **Lean** (section 6.4): Wheelhouse's skills, agents and instructions for VS Code with nothing added; the chat click; local git with merge commits and the copy to a folder; then the helper's part where Node.js may run.
4. **Middle on GitLab on the company's own servers** (sections 6.4 and 8.11): the address and certificate, the project key, the protection and pipelines, git's push options without Node.js, background builders where Copilot CLI runs, Guarded and Ask, and the audit report.
5. **Full** (section 6.4): the sandbox level and its test, the company's settings and Locked on macOS, and the approval on the code host.
6. **The add-on** (section 8.6), last, since nothing relies on it.

**What the director's sittings must cover**, on a Mac and on a Windows computer with Copilot, short and with clickable steps:

- **C6:** the person's own click on a clickable question, against an agent filling one in, since it sets what the everyday approval proves.
- **C17:** Lean in VS Code with nothing added, from one request in the chat to a first approved feature, on Windows with the company's usual limits.
- **C1 and C2:** VS Code's Claude harness, and what an add-on's contributions reach.
- **C4:** Copilot's sandbox on macOS 15 and on a Windows 11 computer with the September 2026 update, and whether it can be had at all where the company holds the updates.
- **C9:** setup's tools on Windows as a standard user, with the timed run.
- **C3, C5, C8 and C16 on Windows:** the parts that differ there, such as PowerShell and the `.cmd` shim.
- **C15:** the person's own approval on the code host's page, signed in as themself.
- **C12, C14 and C19:** the phone, the pane's place, and the add-on, later, before the add-on is built.

**Held for the director's testing:** every ruling may be revisited once the director uses it, the tier for real-user projects first among them.

## Appendix A. What the independent review changed

A builder check read the first draft against the two designs, the research and the built code, on 20 October 2026. It changed:

- **The reviewer session.** The first draft let the helper's reviewer run where a builder's files could steer or replace it. It now runs in a clean checkout, with the project's and the person's own customisations shut out and a prompt from trusted state only, behind check C13.
- **Where hooks are registered.** A file in the project wouldn't reach worktrees and clean checkouts; registration moved to the person's own Copilot hook folder, with a check for a Wheelhouse project first. That also brings the Local harness's warning within reach.
- **How hooks reach Wheelhouse's folder.** Inside Copilot's sandbox a hook is no more trusted than the agent, so hooks now read the folder but write only through the helper.
- **Macs without Copilot's sandbox** now carry the same plain line as Windows.
- **The add-on** now signs its own presses, registers nothing that could press one, and is proved so by a static check.
- **Time-outs:** the gap is stated as one an agent could cause on purpose, at Locked too, with what a missed guard can and can't reach.
- **More guardrail paths,** in the project and in the home folder; the watcher's check of agent-control files before every wake; Locked requiring the sandbox per project rather than computer-wide, with managed deny rules on the keys; how the Copilot runtime's version is read.

A second independent check read the tiers and Lean on 21 October 2026. It changed:

- **How Lean's chat reaches Wheelhouse.** With no Node.js there was no route from the chat to state; the add-on's own chat tools, or an inbox folder, now carry it, writing nothing binding.
- **The main version at Lean.** Copilot's edit tools could reach `.git` inside the project folder; the git store now sits outside it, and git runs with hooks off.
- **What Lean promised.** Copilot's command prompts and VS Code's settings are now named as conveniences, not controls; the local record's chain is said to show accidental loss only, with copies to a company drive for more; tests and reviews are tied to the exact commit that merges.
- **What Lean keeps of the gate,** the lock across two windows, STOP, the runbook's local steps, tested versions and usage are now said.
- **Setup's cases and moving between tiers** are now set out, with Copilot CLI adding background builders rather than setting the tier.
- **Other code hosts** now also need CI held to the host, the record branch protected and the host's own history for the audit report.

On 21 October 2026 the director set the baseline as VS Code with Copilot and no add-on. Lean was rebuilt round it: everything through the chat, approvals in the helper's window where Node.js may run, on the code host's page where there is one, and otherwise as chat clicks recorded as not proven, compared plainly with Claude Code before the mod. The add-on became an option that lifts any tier, and its check moved to C19.

Later on 21 October 2026 the director made a click in Copilot's chat the everyday approval in every tier, asked that agent mode be named plainly, set real-user projects on Middle or Full, and approved the design for a build plan. The approvals passage now pairs the chat click with the code host's lock, and section 14 gives the order of work and the sittings.
