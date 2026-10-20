<!-- docs/specs/2026-10-20-other-agents-design.md -->

# Wheelhouse with other coding agents, starting with GitHub Copilot: design

**Status:** draft for the director's approval, 20 October 2026. Nothing here is built. The extension's look (section 8.6) is the director's ruling of 20 October 2026.

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
| Standard and Locked | **Adapter**, rebuilt for a governance review (section 6.4) | Builds only with Copilot's sandbox on, with a tamper-evident audit record, pending the director's answer to question 2 |
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

**In short:** on Copilot, Wheelhouse's guards can still refuse what they refuse in Claude Code, and the helper and the gate hold exactly as before, because they never ran inside the agent. What Copilot changes is where Wheelhouse's own hooks run, and that weakens one promise: at Standard, a determined agent could forge a record the hooks make. So on Copilot, the records that matter are made by the helper or the extension, never by a hook. And because the director's bar is a compliance or governance review (section 6.4), Copilot builds only where its sandbox is on, and keeps a record a reviewer can check afterwards.

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
  
  **Decided by the director on 20 October 2026** (section 12, question 1): the extension's buttons, with the helper's window as the fail-safe.
- **Copilot's clickable questions** show the card in the chat and carry its non-binding answers (**Not now**, **Explain more**, **Show me**). A binding option in the chat opens the extension's button or the helper's window to confirm. They may carry binding answers later only if check C6 shows the agent can't fill in the answer, and only at Locked, where a policy hook outside the agent records it.
- **The extension's binding presses come only from its own pane's buttons.** It registers no command, link handler or language-model tool that could press one, so neither an agent's tool nor a VS Code command can. A static check of the extension's package proves it on every pull request, as `claude plugin validate` proves the mod can't approve anything (main design, section 17.1), and the tool guard refuses the agent any VS Code tool that runs commands. *Designer's call.*
- **A signed review** is no longer written by a hook from a subagent's report. *Designer's call* for each point:
  - **Where:** the helper makes a clean checkout of the pull request's head in its own folder, outside every worktree, and starts the reviewer there as its own Copilot session, in the sandbox where it is on, with reading tools only.
  - **What it loads:** only Wheelhouse's own reviewer agent. The project's and the person's own agents, instructions, hooks, MCP servers and language servers are shut out, because a builder could otherwise add a file to the pull request that steers or replaces the reviewer. Whether Copilot CLI can start that way is check C13; until it passes, Copilot can't merge anything that needs a signed review.
  - **What it reads:** a prompt the helper writes from trusted state only: the brief from the state branch, the diff the helper works out, the project's rules from the default branch's commit (not the pull request's), and CI's results for the deterministic checks, which the reviewer reads rather than runs.
  - **How it is signed:** the helper reads the verdict from the session's own output and signs it. No builder can write into that output.
- **Where Copilot's sandbox is off, on any system,** an agent's process can read the helper's keys file and sign anything: an approval, a confirmation or a review. That is so on Windows without the sandbox, as with Claude Code on Windows today (main design, section 11), and also on a Mac older than macOS 15, or where the sandbox is off or a company forbids it. The director accepted it for Claude Code on Windows; the same line goes on the board for every Copilot computer without the sandbox, Mac or Windows (question 2).
- **On Windows with Copilot's sandbox** (a recent Windows 11), the keys folder may be deniable to agents. If check C4 shows it is, Copilot on those computers holds more than Claude Code on Windows does today, and the board says so.

### 6.4 The levels on Copilot, built for a governance review

**The director's bar** (20 October 2026): "We need this to be compliance/governance robust". A line on the board isn't enough. So Copilot's levels are judged by the questions a compliance or governance reviewer asks of a tool that changes a company's code, and each answer says who controls it and what it rests on.

**What an agent could do at Standard if Copilot's sandbox is off,** on a Mac as on Windows, because it then runs every command as the person:

- read every file and stored sign-in the person can: SSH keys, git's and `gh`'s sign-ins (including those in the Mac's keychain and Windows' credential store), Wheelhouse's connection key and signing key, browser data;
- use them: push branches and open pull requests straight to the host; on a repository where the person is an admin, switch off the host's protection and then change `main` or rewrite history; and sign fake approvals and reviews that Wheelhouse can't tell from real ones;
- send any of it anywhere on the internet;
- edit Wheelhouse's own hooks, Copilot's hook folder or the extension so that they pass everything.

**How likely that is.** An agent doesn't set out to do this on its own. The realistic routes are two: instructions hidden in something it reads (a web page, an issue, a dependency's notes), and a harmful package whose install or test script runs on the computer. The second happens to people too, but an agent runs many more commands, unattended. Wheelhouse's guards and reviews make the first unlikely to succeed by accident. Without the sandbox, nothing on the computer stops the second. A reviewer would rate it unlikely in any one week, with a high cost when it happens.

**What the sandbox does and doesn't hold.** It holds the commands an agent runs, and everything they start. It doesn't hold Copilot's own file tools (reading, editing and creating files), which Copilot checks against the sandbox's rules only "on a best-effort basis". Wheelhouse's tool guard checks them too, but a guard that times out lets the call through (section 6.2). So a file tool reaching the keys or Copilot's hook folder is stopped by a rule Copilot itself enforces only where one exists: in the managed settings (ways 2 and 3), and in the deny flags of the sessions Wheelhouse starts (section 8.4). In the director's own chat at Standard it rests on the guard. Whether a person's own Copilot settings can carry such rules is check C4.

**What a reviewer asks, and what Wheelhouse answers on Copilot:**

| The reviewer asks | With Copilot's sandbox (way 1) | With the managed settings too (ways 2 and 3) | Without the sandbox |
|---|---|---|---|
| **Can an agent change the product without a named person's approval?** | Pushes and merges go only through the helper and its gate. The host's protection is a second lock, but only where the person isn't the repository's admin | The same, and on the organisation route the repository belongs to the company, whose admin, not the person, owns its protection | Only host protection the person can't switch off stops it |
| **Can it read secrets or live data?** | Not by a command. By a file tool, only if a guard times out | No: Copilot's own deny rules hold for commands and file tools alike | Yes, anything the person can read |
| **Can it send data out?** | Only to listed hosts on macOS. The listed hosts themselves, such as the code host and the package registry, could carry code out. On Windows, Copilot says its host rules rely on programs honouring the proxy, so a program that connects directly isn't stopped | The same, with the list set by the admin | Yes, anywhere |
| **Can it switch off or change the controls?** | Not by a command. By a file tool, only if a guard times out. The person can, by a setting or by approving a command outside the sandbox | Neither the agent nor the person, unless the person holds the computer's admin password | Yes |
| **Who owns the controls?** | The person | The computer's administrator (way 2) or the company (way 3) | The person |
| **What happens when a control fails?** | Wheelhouse's checks refuse, except a hook that times out, which Copilot lets through | Copilot's own rules don't time out; the sandbox fails closed | The same as the first column |
| **Is there a record of who approved what, and of what the agents did, that can't be changed afterwards?** | Yes (way 4), held on the host | Yes, and on the organisation route also outside the person's reach | Changes are seen, but a record signed with a stolen key looks genuine |
| **Who made the binding click?** | Someone at the person's unlocked computer. Wheelhouse is one person directing agents; where a company needs a second person to approve a change, its own host rules require that review, and the gate waits for it | The same | The same |

**Four ways to meet the bar,** with what each costs the person setting up, above all on a work computer without admin rights:

| | What it is | Holds against | Costs the person | On a work computer without admin |
|---|---|---|---|---|
| **1. Sandbox or planning only** | Wheelhouse on Copilot builds only where its own test shows the sandbox holds and the guards are running. Where they don't, Wheelhouse still talks, plans and designs, but starts no builds, and says why | A harmful package or a misled agent running commands to read secrets or, on macOS, to send them to unlisted hosts. Not a file tool slipping past a timed-out guard, and not the person switching the sandbox off | About a minute in setup. Needs macOS 15, or Windows 11 with the September 2026 update or later | Works once Windows is up to date. The person can't install the update; until the company's IT does, which can take weeks, it is planning only |
| **2. Locked by default** | Copilot's admin-only managed settings and policy hooks: the sandbox forced on and failing closed for all Copilot work on the computer, no way to run a command outside it, no "Allow all", and reading the keys, the credential folders and Copilot's own folders denied to commands and file tools alike | Anything running as the person. Not the person with the computer's admin password, who could change the file | The computer's password on a Mac. On Windows, an administrator. All the person's other Copilot work on that computer runs sandboxed too, and VS Code's Claude and Codex agents are switched off there | Needs the company's IT to install it |
| **3. The organisation route** | The company's Copilot or device admin applies Wheelhouse's published baseline (the same managed settings and policy hooks) through their device management, or through GitHub for seats the company's enterprise licenses, with the settings refreshed before every session so a failed fetch can't leave a computer unheld. The repositories belong to the company, with its own protection (pull requests and checks required, no force-push, the audit branch protected) and, where it wants one, a second person's review. The baseline marks every company repository as needing this, so it isn't the person's own answer | The same as Locked, owned by the company, on every computer at once, with no one at the computer able to undo it. Where the company has GitHub's agent session records (Enterprise Cloud with managed users, preview), it also has its own record of every prompt and tool call | Nothing on their computer. The company's admin must agree, and set it up once; setup writes the request for them | Works, but only with the admin's help |
| **4. A tamper-evident record** | Every event is chained to the one before and pushed to the host as it happens, onto a branch the host won't let anyone rewrite. Every session Wheelhouse starts has its full activity (each tool call and its result) captured by the helper from the session's own output, outside the agent; the director's own chat is logged by a hook, best-effort. A script turns it into an audit report: for each merged change, the request, who approved which commit and when, the review, CI, the level, whether each command ran in the sandbox, the versions, and the agents' activity, with any gap flagged | Nothing by itself; it lets a reviewer check afterwards that every change was approved and that nothing was rewritten | Nothing | Works |

**The recommendation** (*Designer's call*, put to the director as question 2 of section 12):

- **Everywhere on Copilot, way 1 and way 4.** No builds without the sandbox and the guards; the audit record always on.
- **For a project with real users, or one under a company's compliance rules, way 3 where a company runs Copilot, or way 2 on a computer the person administers.** Setup doesn't mark such a project ready to build without one of them. Way 2 is the person vouching for their own computer; a company that needs more than that uses way 3.
- **Building needs host protection the agent can't undo.** On the organisation route that is the company's. Otherwise, the narrow connection (main design, section 11), whose key can't change a repository's settings, and the person's own sign-ins held out of agents' reach by the sandbox and, at Locked, by the managed deny rules. A host plan that can't protect `main` at all (GitHub Free with a private repository) gets planning only.
- **Why not way 2 everywhere:** on a work computer without admin it can't be set up at all, which would shut out the first tester and most of the people waiting.

**Way 1's own test.** At each session start, and before the watcher starts a build session, a sandboxed probe tries to:

- read the keys file;
- read a stored sign-in through `gh auth token` and `git credential fill`, and find a token in its environment;
- write outside its worktree;
- reach a host not on the list, and the local network other than the helper;
- make one tool call the guard must refuse, to prove the guards are loaded and running.

Builds run only if every one of these is refused, except the network on Windows, which is reported rather than required, since Copilot says it can't hold it against a program that ignores the proxy. The result goes into the audit record.

The test is per session, so Wheelhouse also asks Copilot never to run a command outside the sandbox (check C4). The guard refuses, or records in the audit record, any command it can see ran outside the sandbox, as with a switch-off mid-session or an approved rerun (check C5). Whether hooks and the probe run inside the sandbox, so they see what agents see, is check C4. *Designer's call.*

**Way 4's limits.**

- **Without an outside copy, the record rests on the host.** On a repository the person owns, the person, or anything holding their sign-in, could switch off the branch's protection and rewrite it. The report shows each protection change the host reports. On the organisation route the company holds the protection, and its audit log keeps its own record of pushes.
- **Where the sandbox was off,** a record signed with a stolen key looks genuine. The report marks those days, so a reviewer knows which changes rest on the host's protection alone.
- **The full activity of each session** is kept on the computer for 30 days, as transcripts are (main design, section 12.8), and only a summary of it goes into the chain after the secret scan, since sessions can hold pasted secrets. *Designer's call.*

**The same bar for Claude Code** would mean no building on Windows until Claude Code has a sandbox there, since it has none today. That is a separate question, not decided here (section 12).

**Locked on Copilot** is offered on macOS first, and on Windows only once tried on a Windows computer with admin rights, as for Claude Code (main design, section 22). It differs from Claude Code's Locked in one way, which its card says plainly: it forces Copilot's sandbox on for all Copilot work on the computer, rather than only in Locked projects (the director's card B for Claude Code). On Copilot a policy hook that refuses unsandboxed commands would let a call through when it times out, so only the managed setting holds. Its other computer-wide rules are kept to what is safe everywhere, and its policy hooks check whether the folder is a Locked Wheelhouse project before doing anything. Once Copilot's managed settings hold permission or sandbox rules, VS Code also switches off its Claude and Codex agents on that computer. *Designer's call.*

**Where a company already manages Copilot,** its settings win. Managed settings from device management come first, then GitHub's, then the file Locked writes, with the sandbox and permission rules combined in the strictest direction. Setup reads what the company has set (section 8.7) and offers the organisation route rather than Locked there. GitHub's own settings apply only to seats the company's enterprise licenses, and a computer that can't fetch them isn't held by them. So the published baseline sets `forceRemoteSettingsRefresh`, which makes a session wait for a fresh copy, and recommends sending the same settings by device management as well. *Designer's call.*

**On a work computer, before anything is installed,** setup says plainly that running unattended agents, and a background helper the person installs for themself, may need the company's IT approval. It offers a one-page note for IT: what Wheelhouse installs and runs, where, and what it changes, with the published baseline. The company's endpoint security may flag a start-up entry or a Node.js the person installed as suspicious, so on a work computer the helper runs only while VS Code runs, started by the extension, with no start-up entry (section 8.5). *Designer's call.*

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

These go on the board's health line for a Copilot project, in the audit report and in the data note:

1. **A guard that times out lets the call through,** even an admin-installed one, and an agent could cause that on purpose; slow computers, such as those scanning every program as it starts, make it likelier. Commands stay inside the sandbox even then, but Copilot's own file tools don't: without managed deny rules, a file tool could then read the keys or change Copilot's hook folder. Pushes and merges still go through the helper.
2. **At Standard, Wheelhouse's own hooks run beside the agent,** so no hook holds a secret an agent can't read. The records that matter come from the helper and the extension, never from hooks.
3. **Without the sandbox, nothing on the computer holds a determined agent or a harmful package,** on a Mac as on Windows. That is why Copilot builds only with the sandbox on (pending the director's answer).
4. **The network is narrowed, not closed.** Listed hosts, such as the code host and the package registry, could carry code out. On Windows, Copilot's sandbox doesn't hold the network against a program that connects directly. Secrets stay held where they can't be read; the code itself is what could leave. A company's own network controls carry that.
5. **At Standard, the person can switch the sandbox off,** or approve a command outside it. Only Locked or the organisation route takes that away, and Locked not from someone with the computer's admin password.
6. **Host protection holds only where the agent can't undo it:** on the organisation route, or with the narrow connection and the person's sign-ins out of reach. A repository admin's sign-in can switch it off.
7. **A binding click proves that someone at the person's unlocked computer clicked,** not who. A second person's approval, where a company needs one, comes from the company's own host rules.
8. **Phone STOP isn't available** unless check C12 finds a route.
9. **Wheelhouse can't pin VS Code or its Copilot runtime.** It records them and re-runs the safety scenarios when they change.
10. **A company's own settings win** over Wheelhouse's, Locked included, and can stop Wheelhouse's hooks loading; way 1's test then finds the guards missing and Wheelhouse plans only.

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

Copilot's hooks can't start a program outside the sandbox, and the helper must run outside it. So setup arranges for the helper, the watcher and the usage receiver to start when the person signs in to their computer, for that person only, with no admin: a launch agent on macOS, and a per-user start-up entry on Windows. The extension starts them too if they aren't running. On a work computer, where the company's endpoint security may treat a start-up entry as suspicious, there is no start-up entry: the extension starts them while VS Code runs, and work pauses when VS Code closes, which the board says (section 6.4). Setup lists this on its card of changes to the computer, and uninstall removes it. *Designer's call.* The same start works for Claude Code, but nothing changes there unless the director asks.

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

**How it looks: the director's ruling of 20 October 2026.** The director was shown a sketch of the extension and said: "If it can look like this - that would be good." The sketch has five parts:

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

- The extension adds its pane to the activity bar, with the wheel icon, so it works at once in every layout.
- On the first run, the extension offers one click, **Put Wheelhouse on the right**, which moves the pane to the secondary sidebar if VS Code lets an extension move a view for the person (check C14). If it doesn't, the same message shows the drag in one picture, once. Either way VS Code remembers it.
- Copilot's chat already sits in the secondary sidebar by default, so with Wheelhouse moved there too the two would share it as tabs. To put them side by side, as sketched, the chat goes to the left: the same first-run offer moves the chat to the primary sidebar, or the director keeps them as tabs. Which of these VS Code allows an extension to do is check C14.
- Once the pane is in the secondary sidebar, its wheel sits at the top of that sidebar rather than in the activity bar; the status bar item opens it from anywhere.
- If none of it can be moved for the director, the pane stays on the left with its wheel on the activity bar and the chat on the right: the sketch mirrored, with everything else as sketched.

### 8.7 Setup on Copilot

The same steps as main design section 15, with these differences:

1. **Install:** the extension from the Marketplace (one click), which brings the setup skill. Without VS Code, `copilot plugin install`, from the README. Setup then installs the plugin for the background sessions itself.
2. **"Can Wheelhouse run here?"** Before anything else, setup reads what this computer and the person's company allow: the Copilot harness, hooks, Copilot CLI, the sandbox and its Windows build, extensions, and any company-managed settings. It runs way 1's sandbox test (section 6.4), and says in plain words what will and won't hold here: building, or planning only, and why. It stops kindly if Wheelhouse can't run safely at all. *Designer's call.*
3. **Tools:** git, Node.js 22 or later, `gh` or `glab`, Copilot CLI and, on Windows, PowerShell 7, each installed for this person only, without admin, where an official route allows it. Whether VS Code's Copilot already brings a usable `copilot` command is check C9.
4. **The host,** the three questions, the rules found: as now. A project with real users or under a company's compliance rules then needs the organisation route or Locked before setup marks it ready to build (section 6.4), and setup writes the request to the company's admin for the organisation route in plain words, with Wheelhouse's published baseline attached.
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

Numbered C1 to C14 here; they get the next free numbers in `docs/checks/` when the plan is written. Most need a short sitting on a Mac and on a Windows computer with Copilot.

1. **C1, the Claude harness:** whether VS Code's Claude harness loads Wheelhouse's plugin, its hooks (with `onFailure`), its sandbox and deny settings, and `AskUserQuestion` with its `PostToolUse` record, as Claude Code does; and on which plans and company settings it is available.
2. **C2, the extension's contributions:** whether skills, custom agents and instructions an extension contributes reach Copilot-harness sessions, and survive a company's policy that limits customisations.
3. **C3, registration:** which Copilot loads first and what it loads twice: a root Agent Plugins `plugin.json` beside `.claude-plugin/`; plugin hooks; the project's `.claude/settings.json` hooks; and the person's `~/.copilot/hooks/` file, in VS Code and the CLI, in a worktree and a clean checkout. What a project hook file holding `disableAllHooks` does to the person's hooks.
4. **C4, the sandbox:** whether a project or person can switch Copilot's sandbox on and narrow its network, including the local network other than the helper; deny reading the keys, the credential folders, the Mac's keychain and Windows' credential store (through `gh auth token` and `git credential fill`), and tokens in the environment; whether a person's own Copilot settings can carry deny rules that Copilot enforces on its own file tools; deny writes to `~/.wheelhouse/`, `~/.copilot/`, `~/.agents/`, VS Code's extensions and settings folders, and the agent-control files inside an otherwise writable worktree; set `allowUnsandboxedCommands` off and refuse an approved rerun outside the sandbox; whether hooks and the probe run inside the sandbox; whether it works behind a company proxy with TLS inspection; and still let commands and hooks read the rest of `~/.wheelhouse/` and reach the helper's socket. Whether a sandboxed command can click the helper's window by script. On macOS 15 or later and on which Windows 11 builds.
5. **C5, the guards' input:** Copilot's `preToolUse` input for every tool, in VS Code and the CLI, including PowerShell, MCP tools, `task`, `ask_user` and any VS Code tool that runs commands; whether it says the session's permission mode, whether the session, and each command, is sandboxed, and the Copilot runtime's version; and whether the Local harness's input can be told from the Copilot harness's.
6. **C6, clickable questions:** whether a `postToolUse` hook sees the director's answer to `ask_user`, and whether the agent can supply the answer itself, as check 8 asked of Claude Code.
7. **C7, the other hooks:** whether `userPromptSubmitted` and `sessionStart` can add text, whether `preCompact` can block, and whether `subagentStop` names the agent.
8. **C8, sessions from a script:** `copilot -p` with `--resume` by id, `--agent`, `--no-ask-user`, the permission flags and JSON output, on macOS and Windows, through the `.cmd` shim; how a refusal shows; and whether the sessions appear in VS Code's Sessions view.
9. **C9, setup's tools:** installing Copilot CLI, Node.js and PowerShell 7 on Windows as a standard user, including where winget and the Microsoft Store are switched off and where AppLocker, App Control or a restricted PowerShell is in force; whether endpoint security flags the helper; whether VS Code's Copilot brings a usable `copilot` command; and the timed run.
10. **C10, Superpowers and Matt Pocock's skills on Copilot:** whether the pinned loops (brainstorming, writing-plans, subagent-driven development, executing-plans, test-driven development) run as designed under Copilot, with the override.
11. **C11, usage:** what credit and token figures Copilot's session output and GitHub's REST call give, with which sign-in.
12. **C12, the phone:** whether a phone message can reach a Copilot session (Copilot CLI's remote sessions) and set STOP, and how a needs-you push reaches the phone.
13. **C13, a clean reviewer session:** whether Copilot CLI can start a session that loads only Wheelhouse's reviewer agent, with the folder's and the person's own agents, instructions, hooks, MCP and language servers shut out, reading tools only, and its verdict in its output. Copilot merges nothing that needs a signed review until it passes.
14. **C14, the pane's place:** whether an extension can move its own pane to the secondary sidebar, and Copilot's chat to the primary sidebar, for the person on one click (through a VS Code command it may run), and whether VS Code then keeps both there across restarts and updates; where the wheel icon shows once the pane is in the secondary sidebar; and how the pane looks at the secondary sidebar's narrow default width, on macOS and Windows.

## 12. Open questions for the director

Each goes to the director as a card, through the main session.

1. **How Copilot users click to approve. Decided by the director on 20 October 2026:** "Assume VS Code addon available. But do have a fail-safe approach for if addons are not available." So approvals come from the Wheelhouse extension's buttons in VS Code, and the helper's own window is the fail-safe wherever the extension isn't there (Copilot CLI alone, or a company that blocks extensions). This was the recommended option; the others were the system's window always, or the chat's clickable choices, accepting that an agent could forge an approval at Standard.
2. **What Copilot's protection promises.** Asked first on 20 October 2026; the director answered: "Please elaborate. We need this to be compliance/governance robust". Section 6.4 now meets that bar, and the question goes back as a new card. Options: sandbox or read-only everywhere, with the audit record, and the organisation route or Locked required for projects with real users or compliance rules (recommended); Locked by default for every Copilot project; the organisation route only; or the audit record alone, with the board saying what isn't held.
3. **VS Code's Claude agent. Decided by the director on 20 October 2026:** "I think both but my friend who is goinf to test this wont be able to use claude agents via vs code or github copilot". So both routes are offered, but the Copilot route is the primary one and stands complete on its own: nothing in it leans on the Claude agent route. The Claude agent route is offered only where check C1 passes and the company allows it, and it is built after the Copilot route.
4. **When to build it. Decided by the director on 20 October 2026:** "Checks now, build later". The checks (section 11) run now; the Copilot adapter is built later.

**Still open, not for now:** which Google agent to support later (section 10); whether Claude Code users also move to the sign-in start (section 8.5); whether the governance bar of section 6.4 also applies to Claude Code, where it would mean no building on Windows until Claude Code has a sandbox there.

## 13. The designer's calls (the director may override)

- one shared core with an agent adapter per agent, the adapter's parts, and the core never naming an agent (sections 7 and 8.1);
- the Copilot harness only, with the Local harness refused at session start (sections 2 and 6.2);
- Wheelhouse not offered as an MCP server (section 7);
- the helper, watcher and receiver started at sign-in for the person, since Copilot's hooks run inside its sandbox (sections 5 and 8.5);
- on Copilot, hooks reading Wheelhouse's folder but never writing it or reading the keys, with every write through the helper, and an unreachable helper refusing as STOP does (section 5);
- binding clicks only from the extension, signing itself, or the helper's window as the fail-safe, and chat questions for non-binding answers (section 6.3): **decided by the director on 20 October 2026**, "Assume VS Code addon available. But do have a fail-safe approach for if addons are not available." (section 12, question 1);
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
- the pane added to the activity bar, with a first-run offer to put it on the right beside the chat, and the sketch mirrored where it can't be moved (section 8.6);
- the playbooks' tool names moved into a tool sheet per agent (section 8.3);
- setup's first step reading what the computer and company allow (section 8.7);
- VS Code and its Copilot runtime recorded rather than pinned, with the safety scenarios run on a change (section 8.8);
- four Copilot scenarios added to the evaluation (section 9);
- for the governance bar, pending the director's answer: builds only where the sandbox test passes, including the guards running and stored sign-ins unreadable, planning only elsewhere; the tamper-evident audit record always on, with each Wheelhouse session's activity captured by the helper and kept 30 days; the organisation route or Locked required for projects with real users or compliance rules; building only with host protection the agent can't undo; Locked on Copilot forcing the sandbox for all Copilot work on the computer; the baseline setting `forceRemoteSettingsRefresh` and recommending device management too; IT's approval named up front on a work computer, with no start-up entry there (sections 6.4 and 8.5).

**Decided by the director on 20 October 2026:** how Copilot users approve (question 1); both routes, with the Copilot route standing on its own (question 3); checks now, build later (question 4).

## Appendix A. What the independent review changed

A builder check read the first draft against the two designs, the research and the built code, on 20 October 2026. It changed:

- **The reviewer session.** The first draft let the helper's reviewer run where a builder's files could steer or replace it. It now runs in a clean checkout, with the project's and the person's own customisations shut out and a prompt from trusted state only, behind check C13.
- **Where hooks are registered.** A file in the project wouldn't reach worktrees and clean checkouts; registration moved to the person's own Copilot hook folder, with a check for a Wheelhouse project first. That also brings the Local harness's warning within reach.
- **How hooks reach Wheelhouse's folder.** Inside Copilot's sandbox a hook is no more trusted than the agent, so hooks now read the folder but write only through the helper.
- **Macs without Copilot's sandbox** now carry the same plain line as Windows.
- **The extension** now signs its own presses, registers nothing that could press one, and is proved so by a static check.
- **Time-outs:** the gap is stated as one an agent could cause on purpose, at Locked too, with what a missed guard can and can't reach.
- **More guardrail paths,** in the project and in the home folder; the watcher's check of agent-control files before every wake; Locked requiring the sandbox per project rather than computer-wide, with managed deny rules on the keys; how the Copilot runtime's version is read.
