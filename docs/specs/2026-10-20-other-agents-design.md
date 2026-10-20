<!-- docs/specs/2026-10-20-other-agents-design.md -->

# Wheelhouse with other coding agents, starting with GitHub Copilot: design

**Status:** draft for the director's approval, 20 October 2026. Nothing here is built.

**What it covers:** how Wheelhouse runs with a coding agent other than Claude Code, starting with GitHub Copilot in VS Code, and how the same seam leaves room for Codex, Cursor and Gemini CLI later, without designing those now.

**Builds on:** the main design, `docs/specs/2026-10-17-wheelhouse-design.md`, and the build loop, `docs/specs/2026-10-18-build-loop-design.md`. Everything they say still holds for Claude Code. Where this document says how a piece works on Copilot, it adds to them; it changes nothing for Claude Code.

**Inputs:**

- `docs/research/copilot-vscode-2026-10.md`: what Copilot in VS Code supports today, from the official documentation and release notes, read on 20 October 2026;
- `docs/research/copilot-cli-and-standards-2026-10.md`: Copilot CLI, and what Codex, Cursor and Gemini CLI share with it;
- the key claims on hooks, harnesses and plugins, re-read by the designer from the official pages the same day;
- the built code on `main` at 260853f.

**Marks:** *Designer's call* marks a choice the director may override; section 13 lists them. Section 12 lists the questions that are the director's.

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
| Card clicks (approvals, confirmations, Lift STOP, the CI push, runbook steps) | **Differently** | Recorded only from a click the agent can't make: the Wheelhouse extension's buttons in VS Code, or the helper's own window. Copilot's clickable questions are used for the card itself and its non-binding answers (section 6.3). *Designer's call* |
| The report check and signed reviews | **Differently** | The signed review on a pull request's head runs as its own Copilot session in a clean checkout, which the helper starts with the project's and the person's own customisations shut out, and whose final answer the helper reads from the session's output. No hook signs it (section 6.3). *Designer's call* |
| Builders, reviewers and the tester | **Adapter** | Custom agents: the reviewer's tool list is reading and searching only. The same prompt text, with Copilot's tool names |
| The foreman and feature sessions | **Adapter** | `copilot -p`, `--resume`, `--agent`, `--allow-tool`, `--deny-tool`, `--no-ask-user`, JSON output, all named explicitly by the watcher. The director can look in from VS Code's Sessions view |
| The front desk | **Adapter** | The director's chat in VS Code, on the Copilot harness. The same playbook, with a short Copilot tool sheet the session start adds |
| Skills: the front desk, intake, foreman, setup | **Carries over** with **adapter** wording | `SKILL.md` is read as it is. The few Claude tool names move out of the playbooks into a tool sheet per agent (section 8.3) |
| Commands (`/wheelhouse:board` and the others) | **Differently** | Skills the director can call by name (`/wheelhouse-board`), since prompt files run only in the Local harness |
| Superpowers' and Matt Pocock's skills | **Carries over**, to be proved | They are `SKILL.md` files, but Superpowers' loops dispatch subagents in Claude Code's words. Check C10 runs them on Copilot before anything relies on them |
| The sandbox | **Differently** | Copilot's own sandbox, switched on per project and per computer where Copilot allows it (check C4). Where it can't be on, the board says so, as for Claude Code on Windows today |
| Deny rules | **Adapter** | The tool guard carries the list itself, as it already does for most of it, and the sessions Wheelhouse starts carry `--deny-tool` flags as well |
| Standard | **Adapter**, and **weaker** (section 6) | |
| Locked | **Adapter**, needs admin | Copilot's policy hooks and managed settings (section 6.4) |
| The guardrails | **Adapter** | The list grows by Copilot's own control files (section 6.5) |
| The board, the briefing, health, settings, the profile, the runbook | **Carries over** | The health line names the agent and its safety line |
| Usage | **Differently** | Copilot bills credits by the month, not a weekly share. Credits per session from the sessions' own output where it gives them, and the month's total from GitHub (check C11). Unusual use works the same way on credits |
| Context and compaction | **Differently** | Copilot compacts on its own; Wheelhouse can't set the mark. The pre-compact hook informs and can't block (check C7). State is on disk, so nothing that matters is lost |
| The mod | **Can't** as such; **differently** | A Wheelhouse extension for VS Code does the mod's jobs: the pane and status bar, card buttons, STOP, settings, and starting the helper if it isn't running (section 8.6) |
| Phone notifications and phone STOP | **Can't**, to be checked | VS Code notifies on the computer. Phone STOP needs a way for a phone message to reach the session, and Copilot offers that only for remote CLI sessions (check C12). Meanwhile the optional channels (ntfy, Telegram) carry links, and STOP is set on the computer |
| Setup | **Adapter** | The same steps, with Copilot's tools and a first step that reads what the person's company allows (section 8.7) |
| Lineage | **Differently** | Copilot CLI and the extension can be pinned; VS Code and its Copilot runtime update every week and can't, in practice. So they are recorded on every pull request, and a change of version runs the safety scenarios before work continues (section 8.8) |
| The evaluation | **Adapter** | The same scenarios through `copilot -p`. Copilot is offered to adopters only once the safety scenarios pass on it |

## 6. Safety on Copilot

**In short:** on Copilot, Wheelhouse's guards can still refuse what they refuse in Claude Code, and the helper and the gate hold exactly as before, because they never ran inside the agent. What Copilot changes is where Wheelhouse's own hooks run, and that weakens one promise: at Standard, a determined agent could forge a record the hooks make. So on Copilot, the records that matter are made by the helper or the extension, never by a hook.

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
- **The Local harness.** Local also reads the person's own Copilot hook folder, so Wheelhouse's hooks run there too, though Local lets a crashing hook's call through and doesn't enforce the sandbox. The adapter tells Local's input from the Copilot harness's, and in Local the session start says first that Wheelhouse doesn't run in this kind of session and asks the director to switch to Copilot; the front desk's playbook, which the extension's skills still bring, does nothing else without the session start's line. Whether Local's input can be told apart is part of check C5. *Designer's call.*
- **A builder switching off its own guards.** Copilot reloads hooks each time a session resumes, and a project hook file holding `disableAllHooks` might switch off Wheelhouse's (check C3). The tool guard refuses writes to every agent-control file (section 6.5), and before every wake the watcher reads the worktree's agent-control files directly, without git, and refuses to wake a session whose worktree holds one that is new or changed; the foreman raises it as a card. *Designer's call.*

### 6.3 Where the records come from

In Claude Code, the hooks run outside the sandbox and can read the signing key, which agents can't. That is what lets a hook sign a card click or a review that no agent can forge (main design, sections 9 and 12.5).

On Copilot, when the sandbox is on, the project's and the plugin's hooks run **inside the same sandbox as the agent**. When it is off, both run as the person. Either way a hook has nothing an agent couldn't also reach, so a record signed by a hook proves nothing at Standard. Only admin-installed policy hooks run outside (Locked, section 6.4).

So on Copilot:

- **A binding click** (an approval, a confirmation, Lift STOP, a CI push, a runbook step) comes only from:
  - the **Wheelhouse extension's buttons** in VS Code. The extension runs in VS Code's own process, outside the agent's sandbox, and signs the record with the key itself, as the mod's bridge does in Claude Code (check 32). It never asks the helper to sign, because an agent can reach the helper's socket too. Or:
  - the **helper's own window**, a small window of the operating system's own kind that the helper opens with the card's options, for when the extension isn't there (Copilot CLI alone, or a company that blocks the extension). An agent can ask the helper to open one, but only a person can click it; whether a sandboxed command can click it by script is part of check C4.
  
  *Designer's call*, put to the director as a card (section 12, question 1).
- **Copilot's clickable questions** show the card in the chat and carry its non-binding answers (**Not now**, **Explain more**, **Show me**). A binding option in the chat opens the extension's button or the helper's window to confirm. They may carry binding answers later only if check C6 shows the agent can't fill in the answer, and only at Locked, where a policy hook outside the agent records it.
- **The extension's binding presses come only from its own pane's buttons.** It registers no command, link handler or language-model tool that could press one, so neither an agent's tool nor a VS Code command can. A static check of the extension's package proves it on every pull request, as `claude plugin validate` proves the mod can't approve anything (main design, section 17.1), and the tool guard refuses the agent any VS Code tool that runs commands. *Designer's call.*
- **A signed review** is no longer written by a hook from a subagent's report. *Designer's call* for each point:
  - **Where:** the helper makes a clean checkout of the pull request's head in its own folder, outside every worktree, and starts the reviewer there as its own Copilot session, in the sandbox where it is on, with reading tools only.
  - **What it loads:** only Wheelhouse's own reviewer agent. The project's and the person's own agents, instructions, hooks, MCP servers and language servers are shut out, because a builder could otherwise add a file to the pull request that steers or replaces the reviewer. Whether Copilot CLI can start that way is check C13; until it passes, Copilot can't merge anything that needs a signed review.
  - **What it reads:** a prompt the helper writes from trusted state only: the brief from the state branch, the diff the helper works out, the project's rules from the default branch's commit (not the pull request's), and CI's results for the deterministic checks, which the reviewer reads rather than runs.
  - **How it is signed:** the helper reads the verdict from the session's own output and signs it. No builder can write into that output.
- **Where Copilot's sandbox is off, on any system,** an agent's process can read the helper's keys file and sign anything: an approval, a confirmation or a review. That is so on Windows without the sandbox, as with Claude Code on Windows today (main design, section 11), and also on a Mac older than macOS 15, or where the sandbox is off or a company forbids it. The director accepted it for Claude Code on Windows; the same line goes on the board for every Copilot computer without the sandbox, Mac or Windows (question 2).
- **On Windows with Copilot's sandbox** (a recent Windows 11), the keys folder may be deniable to agents. If check C4 shows it is, Copilot on those computers holds more than Claude Code on Windows does today, and the board says so.

### 6.4 Standard and Locked on Copilot

| | **Standard on Copilot** | **Locked on Copilot** |
|---|---|---|
| **Holds against** | Mistakes, and most attempts by untrusted content to steer an agent | An agent actively trying to get round the checks, as far as Copilot allows |
| **The checks live in** | Wheelhouse's hook registration and Copilot's settings for the project, which an agent could edit where the sandbox doesn't cover them | Also Copilot's policy hooks and managed settings, in admin-only folders |
| **What the director does** | Nothing extra | Their computer password once (macOS), or an administrator (Windows) |
| **Sandbox** | Switched on where Copilot lets a project or person do it (check C4) | Required in Locked projects: Locked's policy hook refuses commands in a Locked project whose session isn't sandboxed, as Claude Code's Locked does, rather than forcing the sandbox on for every project on the computer (the director's card B, main design section 22). Needs check C5 to show a hook can see whether the session is sandboxed |
| **Deny rules** | Carried by the tool guard and the sessions' flags | Also in the managed settings: never reading `~/.wheelhouse/`, the credential folders or `.env*` files, which hold in every project, since Copilot's file tools obey the sandbox only on a best-effort basis |
| **Records** | Made by the helper and the extension (section 6.3) | Also by policy hooks, which run outside the agent |
| **Can't stop** | A guard that times out letting a call through; an agent editing hook files where the sandbox is off; where the sandbox is off, an agent forging a record | A guard that times out letting a call through, including an agent starving the hooks on purpose; a company's own managed settings winning over Locked's |

**Locked on Copilot follows the director's rule for Locked on Claude Code:** offered on macOS first, and on Windows only once it has been tried on a Windows computer with admin rights (main design, section 22). Like Claude Code's, Copilot's managed settings apply to every Copilot session on the computer, so Locked keeps its computer-wide rules to what is safe everywhere, and its policy hooks check whether the folder is a Locked Wheelhouse project before doing anything.

**One more effect, which the Locked card says plainly:** once Copilot's managed settings hold permission or sandbox rules, VS Code switches off its Claude and Codex harnesses on that computer.

**Where a company already manages Copilot,** its settings win. Setup reads what the company has set (section 8.7) and doesn't offer Locked where the company's settings would override it. *Designer's call.*

### 6.5 The guardrails grow

A pull request touching any of these is a guardrail change (level 4, main design section 12.4), on every agent, because each controls what some agent does:

- `.github/hooks/`, `.github/copilot/`, `.github/agents/`, `.github/skills/`, `.github/instructions/`, `.github/prompts/`, `.github/copilot-instructions.md`, `.github/mcp.json`, `.github/lsp.json` and `.github/plugin/`;
- `AGENTS.md` and `GEMINI.md` anywhere, and `.agents/`;
- a root `plugin.json`, `.plugin/` and `com.github.copilot/`;
- the whole of `.vscode/`, since its tasks can run when a folder opens;
- for later agents, `.codex/`, `.cursor/` and `.gemini/`.

The same paths are shut to agents' writes, as `.claude/` is today. This applies to Claude Code projects too, since a Copilot file in a Claude project could steer a Copilot session later. *Designer's call.*

**In the home folder**, as `~/.claude/` is today, agents are denied writes to `~/.copilot/` (its agents, hooks, instructions, settings and installed plugins), `~/.agents/`, VS Code's extensions folder and VS Code's own user settings folder, and denied reading the keys. Whether Copilot's sandbox can deny these, and the agent-control files inside an otherwise writable worktree, is check C4. *Designer's call.*

### 6.6 Plainly: what Copilot can't enforce

These go on the board's health line for a Copilot project, and in the data note:

1. **A guard that times out lets the call through,** even an admin-installed one, and an agent could cause that on purpose. What it lets through stays on the computer: pushes and merges still go through the helper.
2. **At Standard, Wheelhouse's own hooks run beside the agent.** Where the sandbox is off they can be edited or switched off by an agent; and no hook can hold a secret an agent can't read. So the records that matter come from the helper and the extension, not from hooks.
3. **The sandbox may be off.** It is off by default, needs macOS 15 or a recent Windows 11, and a company may forbid it. Without it, on a Mac as on Windows, Copilot's agents are held by the guards, the gate and the helper only, and an agent could read the keys and forge any record.
4. **Outbound network is allowed by default** in Copilot's sandbox, and Wheelhouse must narrow it (check C4).
5. **Phone STOP isn't available** unless check C12 finds a route.
6. **Wheelhouse can't pin VS Code or its Copilot runtime.** It records them and re-runs the safety scenarios when they change.
7. **A company's own settings win** over Wheelhouse's, Locked included.

## 7. Approaches

**A. One shared core, a thin adapter per agent.** *Recommended.* The core is everything in section 5 marked "carries over". Each agent's adapter holds only what differs: its hook registration and translation, its tool names, the settings it writes, how it starts and wakes sessions, how its cards are clicked, its packaging, its tool sheet for the playbooks, and its safety line. Claude Code becomes the first adapter, by moving what is already there behind the same seam, without changing what it does.

- **For:** one copy of the playbooks, the gate and the state, so a fix lands once. A later agent is one adapter plus the evaluation. The safety line is per agent, so each is honest about itself.
- **Against:** the seam has to be cut through code that was written for one agent, with care that nothing changes for Claude Code. That is mostly moving code, with the Claude Code tests proving nothing moved.

**B. Run the Claude Code plugin in VS Code's Claude harness.** VS Code can run Anthropic's agent engine on the Copilot subscription. If it loads Wheelhouse's plugin, hooks, sandbox and `AskUserQuestion` as Claude Code does, Wheelhouse could run there almost unchanged.

- **For:** close to no new code, and Claude Code's protection where the engine honours it.
- **Against:** what it loads isn't documented; it is a third-party agent, which companies can switch off, and VS Code turns it off wherever Copilot's managed settings hold permission or sandbox rules, which Locked needs. It would leave out everyone whose company switches it off, who are likely many of the people waiting.
- **So:** tried as check C1. If it passes, setup offers it beside the Copilot route where it is available (question 3).

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

- **For VS Code: the Wheelhouse extension,** from the VS Code Marketplace. It contributes Wheelhouse's skills, custom agents and instructions through VS Code's extension points, which don't depend on VS Code's plugin setting being on, and draws the pane (section 8.6). Whether contributed skills and agents reach the Copilot harness is check C2.
- **For Copilot CLI and the background sessions: the plugin,** installed with `copilot plugin install` from Wheelhouse's own marketplace at a tag and commit. One repository carries both manifests: Claude Code reads `.claude-plugin/`, and Copilot reads a root `plugin.json` in the Agent Plugins format, which it looks for first, with its Copilot-only parts in `com.github.copilot/`. *Designer's call*, checked in C3.
- **Hooks are registered by setup, once per computer,** in the person's own Copilot hook folder (`~/.copilot/hooks/wheelhouse.json`), with the full path to this computer's Wheelhouse, never by an agent. A file in the project wouldn't reach the worktrees and clean checkouts that feature sessions and reviews run in. Because the person's hook folder applies to every Copilot session on the computer, each hook first checks whether the session's folder is in a registered Wheelhouse project, as Locked's hooks do, and does nothing otherwise; the cost is starting Node.js once per tool call in the person's other Copilot sessions, which setup's card says. The plugin's Copilot manifest carries no hooks, so nothing loads twice. *Designer's call*, settled by check C3.

### 8.3 The playbooks

- **One text.** The front desk, intake, foreman and setup skills, and the builder, reviewer and tester prompts, stay one text for every agent.
- **The tool names move out.** Where a playbook names a Claude tool today ("give `AskUserQuestion` the questions"), it says what to do in general words ("ask the card with your clickable-question tool"), and the session start adds the agent's tool sheet: for Copilot, `ask_user`, `task`, `bash` or `powershell`, and so on. *Designer's call.*
- **The command's path** comes from the session start ("the Wheelhouse command is …"), since Copilot doesn't give a shell the plugin's folder the way `${CLAUDE_PLUGIN_ROOT}` does.
- **Claude Code's evaluation must still pass unchanged** after the wording moves, and that is the test that the move changed nothing for Claude Code.

### 8.4 Sessions: the foreman, feature sessions and reviews

- The watcher's Shape 1 (build-loop design, section 11) carries over: a background process starts a fresh foreman per batch of events, and wakes one feature session.
- On Copilot it runs `copilot -p --agent wheelhouse-foreman` with `--no-ask-user`, explicit `--allow-tool` and `--deny-tool` lists, the model from the routing table, and JSON output; it wakes a feature session with `--resume`. Whether `--resume` takes a session's id from a script, and how a refusal shows in the output, is check C8.
- Signed reviews run as their own session (section 6.3).
- The director can look into any of them from VS Code's Sessions view, where Copilot lists sessions it didn't start as "Created Externally".
- Feature sessions still never wait on a permission prompt: `--no-ask-user`, and the build's usual commands granted by name, as the Windows build-commands design does for Claude Code.

### 8.5 The helper, the watcher and the receiver start at sign-in

Copilot's hooks can't start a program outside the sandbox, and the helper must run outside it. So setup arranges for the helper, the watcher and the usage receiver to start when the person signs in to their computer, for that person only, with no admin: a launch agent on macOS, and a per-user start-up entry on Windows. The extension starts them too if they aren't running. Setup lists this on its card of changes to the computer, and uninstall removes it. *Designer's call.* The same start works for Claude Code, but nothing changes there unless the director asks.

### 8.6 The Wheelhouse extension for VS Code

The mod's counterpart, doing the mod's jobs (main design, section 17.1) in VS Code:

- **The glance:** a status bar item and a side pane (a webview, or Canvases once they leave Preview), read from `status.json`, with the same boards as the mod's pane and the interface design.
- **Card buttons:** **Approve**, **Not now** and the card's other options, written straight into state through the helper, with no Copilot turn. These are binding clicks (section 6.3).
- **STOP:** a button that sets STOP at once; **Lift STOP** as a binding click.
- **Settings:** the everyday settings as buttons.
- **The briefing on request,** with no Copilot turn.
- **Notifications:** VS Code's own notification for needs-you items, previews ready, features finished and STOP.
- **It never approves a permission prompt,** and never runs the agent's tools.

It can't see the origin of a typed message, as the mod can, so on Copilot a typed "yes" never counts as an approval, and reply codes typed in the chat don't bind (main design, section 12.5). The extension is pinned like the plugin: installed at a version, with auto-update off for it. *Designer's call.*

### 8.7 Setup on Copilot

The same steps as main design section 15, with these differences:

1. **Install:** the extension from the Marketplace (one click), which brings the setup skill. Without VS Code, `copilot plugin install`, from the README. Setup then installs the plugin for the background sessions itself.
2. **"Can Wheelhouse run here?"** Before anything else, setup reads what this computer and the person's company allow: the Copilot harness, hooks, Copilot CLI, the sandbox and its Windows build, extensions, and any company-managed settings. It says in plain words what will and won't hold here, and stops kindly if Wheelhouse can't run safely. *Designer's call.*
3. **Tools:** git, Node.js 22 or later, `gh` or `glab`, Copilot CLI and, on Windows, PowerShell 7, each installed for this person only, without admin, where an official route allows it. Whether VS Code's Copilot already brings a usable `copilot` command is check C9.
4. **The host,** the three questions, the rules found: as now.
5. **Changes to this computer,** on one card: the sign-in start (section 8.5), Copilot's sandbox for this person, the extension's auto-update off, the signing key.
6. **Locked:** macOS only, as section 6.4 says.
7. **Notifications:** VS Code's own; the phone only if check C12 finds a route.
8. **The health check,** on a scratch copy, now including the Copilot safety scenarios.

The 15-minute target holds; check C9's timed run on a fresh Windows account says whether it does.

### 8.8 Lineage on Copilot

- **Pinned:** Wheelhouse's plugin and extension, Copilot CLI's version (installed at a version), and the third-party skills, as now.
- **Recorded, not pinned:** VS Code's version and its Copilot runtime, which update weekly. Every pull request's provenance names them. The extension reads both from VS Code and writes them to a file the session start reads; without the extension, the hooks' input gives them if check C5 finds it does, and otherwise only Copilot CLI's own version is known, which the board says. *Designer's call.*
- **When they change:** the session start runs the safety scenarios on Copilot (a quick subset, with no reasoning beyond the runs) before the foreman starts new work. If one fails, Copilot work holds, as Claude Code's lineage hold does, and the director gets one card. *Designer's call*, since a hold on every weekly update would stop work every week.

### 8.9 Models

The routing table gains a column per agent. Copilot names models its own way and a company may limit which are allowed, so setup reads the list Copilot offers and the table pins full names from it. A pin moves only after the evaluation passes on Copilot, as now (main design, section 9.1).

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

Numbered C1 to C13 here; they get the next free numbers in `docs/checks/` when the plan is written. Most need a short sitting on a Mac and on a Windows computer with Copilot.

1. **C1, the Claude harness:** whether VS Code's Claude harness loads Wheelhouse's plugin, its hooks (with `onFailure`), its sandbox and deny settings, and `AskUserQuestion` with its `PostToolUse` record, as Claude Code does; and on which plans and company settings it is available.
2. **C2, the extension's contributions:** whether skills, custom agents and instructions an extension contributes reach Copilot-harness sessions, and survive a company's policy that limits customisations.
3. **C3, registration:** which Copilot loads first and what it loads twice: a root Agent Plugins `plugin.json` beside `.claude-plugin/`; plugin hooks; the project's `.claude/settings.json` hooks; and the person's `~/.copilot/hooks/` file, in VS Code and the CLI, in a worktree and a clean checkout. What a project hook file holding `disableAllHooks` does to the person's hooks.
4. **C4, the sandbox:** whether a project or person can switch Copilot's sandbox on and narrow its network; deny reading the keys and the credential folders; deny writes to `~/.wheelhouse/`, `~/.copilot/`, `~/.agents/`, VS Code's extensions and settings folders, and the agent-control files inside an otherwise writable worktree; set `allowUnsandboxedCommands` off; and still let commands and hooks read the rest of `~/.wheelhouse/` and reach the helper's socket. Whether a sandboxed command can click the helper's window by script. On macOS 15 or later and on which Windows 11 builds.
5. **C5, the guards' input:** Copilot's `preToolUse` input for every tool, in VS Code and the CLI, including PowerShell, MCP tools, `task`, `ask_user` and any VS Code tool that runs commands; whether it says the session's permission mode, whether the session is sandboxed, and the Copilot runtime's version; and whether the Local harness's input can be told from the Copilot harness's.
6. **C6, clickable questions:** whether a `postToolUse` hook sees the director's answer to `ask_user`, and whether the agent can supply the answer itself, as check 8 asked of Claude Code.
7. **C7, the other hooks:** whether `userPromptSubmitted` and `sessionStart` can add text, whether `preCompact` can block, and whether `subagentStop` names the agent.
8. **C8, sessions from a script:** `copilot -p` with `--resume` by id, `--agent`, `--no-ask-user`, the permission flags and JSON output, on macOS and Windows, through the `.cmd` shim; how a refusal shows; and whether the sessions appear in VS Code's Sessions view.
9. **C9, setup's tools:** installing Copilot CLI, Node.js and PowerShell 7 on Windows as a standard user; whether VS Code's Copilot brings a usable `copilot` command; and the timed run.
10. **C10, Superpowers and Matt Pocock's skills on Copilot:** whether the pinned loops (brainstorming, writing-plans, subagent-driven development, executing-plans, test-driven development) run as designed under Copilot, with the override.
11. **C11, usage:** what credit and token figures Copilot's session output and GitHub's REST call give, with which sign-in.
12. **C12, the phone:** whether a phone message can reach a Copilot session (Copilot CLI's remote sessions) and set STOP, and how a needs-you push reaches the phone.
13. **C13, a clean reviewer session:** whether Copilot CLI can start a session that loads only Wheelhouse's reviewer agent, with the folder's and the person's own agents, instructions, hooks, MCP and language servers shut out, reading tools only, and its verdict in its output. Copilot merges nothing that needs a signed review until it passes.

## 12. Open questions for the director

Each goes to the director as a card, through the main session.

1. **How Copilot users click to approve.** On Copilot, a click in the chat can't be trusted the way it is in Claude Code. Options: the Wheelhouse extension's buttons in VS Code, with the system's own small window where the extension isn't there (recommended); the system's window always; or the chat's clickable choices, accepting that an agent could forge an approval at Standard.
2. **What Copilot's Standard promises.** At Standard on Copilot, a guard that times out lets a call through, and on any computer without Copilot's sandbox, Mac or Windows, an agent could edit Wheelhouse's hook files or forge an approval. Options: accept it and say so on the board, with real-user projects pointed to Locked (recommended, as the director decided for Windows); or offer Copilot only for projects without real users until Locked on Copilot has been tried.
3. **VS Code's Claude agent.** If check C1 passes, setup could also offer Wheelhouse inside VS Code's Claude agent, where a company allows it. Options: build the Copilot route, and offer the Claude agent route too where it works (recommended); the Claude agent route only; or the Copilot route only.
4. **When to build it.** Options: run the checks now, in one Mac and one Windows sitting, and build the Copilot adapter after the pieces in progress are merged (recommended); start building now; or after the pilot.

**Still open, not for now:** which Google agent to support later (section 10); whether Claude Code users also move to the sign-in start (section 8.5).

## 13. The designer's calls (the director may override)

- one shared core with an agent adapter per agent, the adapter's parts, and the core never naming an agent (sections 7 and 8.1);
- the Copilot harness only, with the Local harness refused at session start (sections 2 and 6.2);
- Wheelhouse not offered as an MCP server (section 7);
- the helper, watcher and receiver started at sign-in for the person, since Copilot's hooks run inside its sandbox (sections 5 and 8.5);
- on Copilot, hooks reading Wheelhouse's folder but never writing it or reading the keys, with every write through the helper, and an unreachable helper refusing as STOP does (section 5);
- binding clicks only from the extension, signing itself, or the helper's window, and chat questions for non-binding answers (section 6.3);
- the extension registering nothing that could press a binding button, proved by a static check (section 6.3);
- signed reviews run as their own session in a clean checkout, with the project's and the person's customisations shut out, a prompt from trusted state only, and the verdict read by the helper (section 6.3);
- guards registered with a two-minute limit, answering within their own deadline, and refusing tools they don't know (section 6.2);
- the watcher refusing to wake a session whose worktree holds a new or changed agent-control file (section 6.2);
- the Local harness told apart at session start, and the front desk doing nothing there (section 6.2);
- the guardrail and write-denied paths growing by every agent's control files, in Claude Code projects too, and the home folder's agent folders denied to agents (section 6.5);
- Locked on Copilot on macOS first, requiring the sandbox in Locked projects by its policy hook rather than forcing it computer-wide, with managed deny rules on the keys and credentials, and not offered where a company's settings would win (section 6.4);
- the extension for VS Code, with its contributions, and the plugin for Copilot CLI, from one repository with two manifests (section 8.2);
- hooks registered by setup once per computer in the person's Copilot hook folder, checking for a Wheelhouse project first, never in the plugin's Copilot manifest (section 8.2);
- VS Code's and the Copilot runtime's versions read by the extension (section 8.8);
- the playbooks' tool names moved into a tool sheet per agent (section 8.3);
- setup's first step reading what the computer and company allow (section 8.7);
- VS Code and its Copilot runtime recorded rather than pinned, with the safety scenarios run on a change (section 8.8);
- four Copilot scenarios added to the evaluation (section 9).

## Appendix A. What the independent review changed

A builder check read the first draft against the two designs, the research and the built code, on 20 October 2026. It changed:

- **The reviewer session.** The first draft let the helper's reviewer run where a builder's files could steer or replace it. It now runs in a clean checkout, with the project's and the person's own customisations shut out and a prompt from trusted state only, behind check C13.
- **Where hooks are registered.** A file in the project wouldn't reach worktrees and clean checkouts; registration moved to the person's own Copilot hook folder, with a check for a Wheelhouse project first. That also brings the Local harness's warning within reach.
- **How hooks reach Wheelhouse's folder.** Inside Copilot's sandbox a hook is no more trusted than the agent, so hooks now read the folder but write only through the helper.
- **Macs without Copilot's sandbox** now carry the same plain line as Windows.
- **The extension** now signs its own presses, registers nothing that could press one, and is proved so by a static check.
- **Time-outs:** the gap is stated as one an agent could cause on purpose, at Locked too, with what a missed guard can and can't reach.
- **More guardrail paths,** in the project and in the home folder; the watcher's check of agent-control files before every wake; Locked requiring the sandbox per project rather than computer-wide, with managed deny rules on the keys; how the Copilot runtime's version is read.
