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
| Standard and Locked | **Adapter**, rebuilt for a governance review (section 6.4) | Controls off the computer first; on the computer, the strongest level it allows: Copilot's sandbox, Guarded, or Ask, as Claude Code does on Windows |
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

**In short:** on Copilot, Wheelhouse's guards can still refuse what they refuse in Claude Code, and the helper and the gate hold exactly as before, because they never ran inside the agent. What Copilot changes is where Wheelhouse's own hooks run, and that weakens one promise: at Standard, a determined agent could forge a record the hooks make. So on Copilot, the records that matter are made by the helper or the extension, never by a hook. And because the director's bar is a compliance or governance review, even on a computer where Copilot's sandbox can't run (section 6.4), the controls that matter most live off the computer, and on it Wheelhouse uses the strongest level the computer allows.

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
- **Where Copilot's sandbox is off, on any system,** a command running at the person's own level can read the helper's keys file and sign anything: an approval, a confirmation or a review. That is so on Windows without the sandbox, as with Claude Code on Windows today (main design, section 11), and on a Mac older than macOS 15 or where the sandbox is off. Guarded narrows it, where Windows lets Wheelhouse label the keys folder unreadable to its runner (check 52), and Ask narrows it to the allowances the person clicked. Section 6.4 keeps the controls that matter most off the computer for this reason.
- **On Windows with Copilot's sandbox** (a recent Windows 11), the keys folder may be deniable to agents. If check C4 shows it is, Copilot on those computers holds more than Claude Code on Windows does today, and the board says so.

### 6.4 The levels on Copilot, built for a governance review

**The director's bar** (20 October 2026): "We need this to be compliance/governance robust", and, for the worst case, "we need to prepare for the worse - what if sandbox cant be run?". So Wheelhouse on Copilot must still build on a Windows computer with no Copilot sandbox, no cloud agent and no admin rights, where Copilot in VS Code is all there is. That is also the director's own situation with Claude Code on a Windows computer, which the main design already handles (sections 12.2 and 14.1, ruling R49). This section reuses that design for Copilot. It sorts the controls by where they live, because a reviewer trusts most what the person's computer can't change.

#### Controls on the host

These live on the host, so nothing on the person's computer can change them, with one exception said plainly below. *Designer's call* for each.

1. **Nothing reaches `main` except a pull request that passes the project's CI on the host.** Setup sets the host's protection: no direct push and no force-push to `main` or the state branch, and the required checks pinned to the host's own CI, so a status posted from the computer can't stand in for them. Where the host's plan can't protect `main` at all (GitHub Free with a private repository), Copilot doesn't build that project; the board says why and what plan would.
2. **CI is treated as the builder's own work, not as proof.** A pull request controls its own tests and scripts. So the project's secrets are kept out of every CI run a pull request starts, and live only in the host's protected environments, which a pull request's run can't reach. The setup card says so; moving the project's existing secrets is a level-4 step for the person.
3. **The person's approval, on the host,** where the host can hold one: the host itself refuses the merge until the person, signed in to the host, has approved that exact commit there. Without it the narrow key alone could merge a pull request whose CI passed. How Wheelhouse can do that on GitHub and GitLab, with no secret shipped, is check C15: for example, a required check that waits on a protected environment the person must approve, or the pull request opened by another identity so the person's review counts. **Until C15 passes,** a merge rests on Wheelhouse's signed approval, kept on the computer. So until then build commands run unattended (levels 1 and 2 below) only where the level's test shows they can't read the signing key or the connection key; anywhere else the level is Ask.
4. **The narrow connection's key reaches only the project's code, pull requests and issues.** It can't change the repository's settings, its protection or its CI files (main design, section 11). A change to CI needs the person's own sign-in, on one click (main design, section 12.4, card A). The quick connection isn't offered for building on Copilot.
5. **The record, once pushed,** can't be rewritten: every event is chained to the one before and pushed to a branch the host won't let anyone rewrite, as it happens.

**The exception: the person's own sign-in.** On a repository the person owns, they are its admin, and their sign-in can switch the protection off, push to `main` and rewrite the record branch. Copilot itself needs a GitHub sign-in on the computer, and git usually keeps one too. So on the personal route these host controls hold against agents only as long as nothing an agent runs reaches the person's sign-ins: true at the sandbox and Guarded levels for build commands, and not true during an Ask allowance or at Unattended. **On the organisation route** the repositories belong to the company, the person isn't their admin, and the company's own audit log records every push and every change to the protection: there the host controls hold whatever happens on the computer.

#### Controls on the computer, outside the agent

The merge gate in the helper, signed reviews in a clean session, the watcher and the capture of each session's activity all run on the person's computer, as programs at the person's own level. They hold while nothing an agent runs reaches that level: at the sandbox and Guarded levels, a build command can't change them. During an Ask allowance or at Unattended, a command could rewrite them, or skip them and call the host directly with the narrow key. That is why the host's own controls come first, and why the audit report checks the computer's record against the host's (below).

#### What stays exposed on the computer

- **The person's sign-ins:** the browser's, git's and `gh`'s stored sign-ins (including Windows' credential store), Copilot's own, and SSH keys.
- **Wheelhouse's keys:** the narrow connection's key and its renewal key, and the signing key.
- **Copilot's own saved permissions and settings,** which could widen what a later session may do.

**One command at the person's own level can leave lasting changes:** a start-up entry, rewritten Wheelhouse or Copilot files, a copy of the renewal key, which lasts months, or of the signing key. So after any period at Unattended, and every week in which an Ask allowance ran, Wheelhouse makes a new signing key and asks the person to renew the connection (one code on the host's page), and the health check looks for changes to Wheelhouse's and Copilot's own files. *Designer's call.*

**How likely a harmful command is.** An agent doesn't set out to do this on its own. The realistic routes are instructions hidden in something it reads (a web page, an issue, a dependency's notes) and a harmful package whose install or test script runs on the computer. The guards and reviews make the first unlikely to succeed by accident. The levels below are what narrow the second.

#### The levels: the strongest the computer allows

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

**Where Copilot's command-line agent can't run.** A company can switch Copilot CLI off, or its program rules can block the person installing it, and then Wheelhouse can't start background sessions at all. Wheelhouse then builds in the person's own chat in VS Code, one feature at a time, with Copilot asking before every command, which is Ask by its nature, and nothing runs while the person is away. Reviews run in a fresh chat with Wheelhouse's reviewer agent; since such a chat loads the project's own instructions, those reviews are recorded as unsigned, and a merge then needs the person's approval on the host (check C15). Until C15 passes, such a computer can build but not merge, and the person merges from another computer or in the host's own pages. *Designer's call.*

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

- **The host's controls required:** a host that can protect `main`, the narrow connection, and the person's approval on the host once check C15 gives one.
- **Never Unattended.**
- **Any of levels 1 to 3,** the strongest the computer allows, with Locked or the company's settings recommended where they can be had.

#### Locked and company settings on Copilot

**Locked on Copilot** is offered on macOS first, and on Windows only once tried on a Windows computer with admin rights, as for Claude Code (main design, section 22). It differs from Claude Code's Locked in one way, which its card says plainly: it forces Copilot's sandbox on for all Copilot work on the computer, rather than only in Locked projects (the director's card B for Claude Code), since on Copilot a policy hook that refused unsandboxed commands would let one through when it timed out. Its other computer-wide rules are kept to what is safe everywhere, and its policy hooks check whether the folder is a Locked Wheelhouse project before doing anything. Once Copilot's managed settings hold permission or sandbox rules, VS Code also switches off its Claude and Codex agents on that computer. Locked holds against anything running as the person, though not against someone with the computer's admin password. *Designer's call.*

**Where a company already manages Copilot,** its settings win. Managed settings from device management come first, then GitHub's, then the file Locked writes, with the sandbox and permission rules combined in the strictest direction. Setup reads what the company has set (section 8.7) and offers the organisation route rather than Locked there. On that route the company's admin applies Wheelhouse's published baseline through device management, or through GitHub for seats the company's enterprise licenses; the baseline sets `forceRemoteSettingsRefresh`, so a computer that can't fetch GitHub's copy isn't left unheld, and recommends sending the same settings by device management too. The repositories belong to the company, which owns their protection and can require a second person's review, and the baseline marks every company repository as a project with real users. *Designer's call.*

#### On a work computer

- **IT's approval first.** Before anything is installed, setup says plainly that running unattended agents, and a background helper the person installs for themself, may need the company's IT approval, and offers a one-page note for IT: what Wheelhouse installs and runs, where, and what it changes, with the published baseline.
- **No start-up entry.** The company's endpoint security may treat one as suspicious, so on a work computer the helper runs only while VS Code runs, started by the extension (section 8.5).
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
- for later agents, `.codex/`, `.cursor/` and `.gemini/`.

The same paths are shut to agents' writes, as `.claude/` is today. This applies to Claude Code projects too, since a Copilot file in a Claude project could steer a Copilot session later. *Designer's call.*

**In the home folder**, as `~/.claude/` is today, agents are denied writes to `~/.copilot/` (its agents, hooks, instructions, settings and installed plugins), `~/.agents/`, VS Code's extensions folder and VS Code's own user settings folder, and denied reading the keys. Whether Copilot's sandbox can deny these, and the agent-control files inside an otherwise writable worktree, is check C4. *Designer's call.*

### 6.6 Plainly: what Copilot can't enforce

These go on the board's health line for a Copilot project, in the audit report and in the data note:

1. **Without Copilot's sandbox, the computer holds only what Guarded or Ask hold.** At Guarded the network is open and only labelled folders are unreadable to builds; at Ask, an allowed command can do whatever the person's account can, and leave lasting changes; at Unattended, nothing holds on the computer.
2. **The person's sign-ins and Wheelhouse's keys stay on the computer.** On the personal route the person's sign-in can switch the host's protection off, so the host's controls hold against agents only while nothing an agent runs reaches it. Until the person's approval is on the host (check C15), the narrow key alone could merge a pull request that passed CI, which is why builds run unattended only where the keys are unreadable to them. The audit report checks every merge against the host's own history.
3. **The merge gate, the reviews and the activity record run on the computer.** They hold while build commands can't reach the person's level, which is not so during an Ask allowance or at Unattended.
4. **Copilot's permission rules are rules, not a fence.** GitHub calls its path checks heuristic, and a rule can be walked round. Wheelhouse's guards sit behind them, and a guard that times out lets the call through.
5. **At Standard, Wheelhouse's own hooks run beside the agent,** so no hook holds a secret an agent can't read. The records that matter come from the helper and the extension, never from hooks.
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
- Each session's permissions come from the computer's level (section 6.4): shell commands denied except what the level allows (Guarded: only the low-integrity runner; Ask: only the commands the person allowed, for as long as they allowed them); file tools held to the worktree by Copilot's path rules, with the temporary folder shut off; the web held to the project's listed domains. These are Copilot's own rules, so they don't depend on a hook answering in time.

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
2. **"Can Wheelhouse run here?"** Before anything else, setup reads what this computer and the person's company allow: the Copilot harness, hooks, Copilot CLI, the sandbox and its Windows build, Guarded's self-test, whether a Node.js the person installs may run, extensions, and any company-managed settings. It then says in plain words which level this computer gets (section 6.4) and what that holds, and stops kindly only if Wheelhouse can't run at all. *Designer's call.*
3. **Tools:** git, Node.js 22 or later, `gh` or `glab`, Copilot CLI and, on Windows, PowerShell 7, each installed for this person only, without admin, where an official route allows it. Whether VS Code's Copilot already brings a usable `copilot` command is check C9.
4. **The host,** the three questions, the rules found: as now, with the host's protection of `main` and the narrow connection required for building (section 6.4). A project with real users can't then be set to Unattended, and setup recommends Locked or the organisation route where they can be had, writing the request to the company's admin in plain words with Wheelhouse's published baseline attached.
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

Numbered C1 to C15 here; they get the next free numbers in `docs/checks/` when the plan is written. Most need a short sitting on a Mac and on a Windows computer with Copilot.

1. **C1, the Claude harness:** whether VS Code's Claude harness loads Wheelhouse's plugin, its hooks (with `onFailure`), its sandbox and deny settings, and `AskUserQuestion` with its `PostToolUse` record, as Claude Code does; and on which plans and company settings it is available.
2. **C2, the extension's contributions:** whether skills, custom agents and instructions an extension contributes reach Copilot-harness sessions, and survive a company's policy that limits customisations.
3. **C3, registration:** which Copilot loads first and what it loads twice: a root Agent Plugins `plugin.json` beside `.claude-plugin/`; plugin hooks; the project's `.claude/settings.json` hooks; and the person's `~/.copilot/hooks/` file, in VS Code and the CLI, in a worktree and a clean checkout. What a project hook file holding `disableAllHooks` does to the person's hooks.
4. **C4, the sandbox:** whether a project or person can switch Copilot's sandbox on and narrow its network, including the local network other than the helper; deny reading the keys, the credential folders, the Mac's keychain and Windows' credential store (through `gh auth token` and `git credential fill`), and tokens in the environment; whether a person's own Copilot settings can carry deny rules that Copilot enforces on its own file tools; deny writes to `~/.wheelhouse/`, `~/.copilot/`, `~/.agents/`, VS Code's extensions and settings folders, and the agent-control files inside an otherwise writable worktree; set `allowUnsandboxedCommands` off and refuse an approved rerun outside the sandbox; whether hooks and the probe run inside the sandbox; whether it works behind a company proxy with TLS inspection; and still let commands and hooks read the rest of `~/.wheelhouse/` and reach the helper's socket. Whether a sandboxed command can click the helper's window by script. On macOS 15 or later and on which Windows 11 builds.
5. **C5, the guards' input:** Copilot's `preToolUse` input for every tool, in VS Code and the CLI, including PowerShell, MCP tools, `task`, `ask_user` and any VS Code tool that runs commands; whether it says the session's permission mode, whether the session, and each command, is sandboxed, and the Copilot runtime's version; and whether the Local harness's input can be told from the Copilot harness's.
6. **C6, clickable questions:** whether a `postToolUse` hook sees the director's answer to `ask_user`, and whether the agent can supply the answer itself, as check 8 asked of Claude Code.
7. **C7, the other hooks:** whether `userPromptSubmitted` and `sessionStart` can add text, whether `preCompact` can block, and whether `subagentStop` names the agent.
8. **C8, sessions from a script:** `copilot -p` with `--resume` by id, `--agent`, `--no-ask-user`, the permission flags and JSON output, on macOS and Windows, through the `.cmd` shim; that a command no rule allows is refused at once rather than asked; that a shell rule allowing only the Guarded runner, or only one named command, refuses a chained or nested command that adds anything else, in Bash and PowerShell forms; that a session started with its own Copilot settings folder and a cleared environment ignores the person's saved permissions and web approvals and an allow-everything switch; that Copilot's path rules hold its own file tools to the worktree with the temporary folder shut off, including against a folder link inside the worktree that points out of it; how a refusal shows; and whether the sessions appear in VS Code's Sessions view.
9. **C9, setup's tools:** installing Copilot CLI, Node.js and PowerShell 7 on Windows as a standard user, including where winget and the Microsoft Store are switched off and where AppLocker, App Control or a restricted PowerShell is in force; whether endpoint security flags the helper; whether the company's program rules let a person-installed Node.js, PowerShell 7, `gh` and Copilot CLI run, and whether its Copilot policy allows Copilot CLI; whether VS Code's Copilot brings a usable `copilot` command; and the timed run.
10. **C10, Superpowers and Matt Pocock's skills on Copilot:** whether the pinned loops (brainstorming, writing-plans, subagent-driven development, executing-plans, test-driven development) run as designed under Copilot, with the override.
11. **C11, usage:** what credit and token figures Copilot's session output and GitHub's REST call give, with which sign-in.
12. **C12, the phone:** whether a phone message can reach a Copilot session (Copilot CLI's remote sessions) and set STOP, and how a needs-you push reaches the phone.
13. **C13, a clean reviewer session:** whether Copilot CLI can start a session that loads only Wheelhouse's reviewer agent, with the folder's and the person's own agents, instructions, hooks, MCP and language servers shut out, reading tools only, and its verdict in its output. Copilot merges nothing that needs a signed review until it passes.
14. **C14, the pane's place:** whether an extension can move its own pane to the secondary sidebar, and Copilot's chat to the primary sidebar, for the person on one click (through a VS Code command it may run), and whether VS Code then keeps both there across restarts and updates; where the wheel icon shows once the pane is in the secondary sidebar; and how the pane looks at the secondary sidebar's narrow default width, on macOS and Windows.
15. **C15, an approval on the host:** whether the host itself can refuse a merge until the named person, signed in to the host, has approved that exact commit there, with no secret shipped in Wheelhouse: on GitHub, a required check that waits on a protected environment the person must approve, or the pull request opened by another identity so the person's review counts, on personal and company plans; on GitLab, approval rules and whether the author may approve. Also that the narrow key can't make that approval itself.

## 12. Open questions for the director

Each goes to the director as a card, through the main session.

1. **How Copilot users click to approve. Decided by the director on 20 October 2026:** "Assume VS Code addon available. But do have a fail-safe approach for if addons are not available." So approvals come from the Wheelhouse extension's buttons in VS Code, and the helper's own window is the fail-safe wherever the extension isn't there (Copilot CLI alone, or a company that blocks extensions). This was the recommended option; the others were the system's window always, or the chat's clickable choices, accepting that an agent could forge an approval at Standard.
2. **What Copilot's protection promises.** Asked first on 20 October 2026. The director answered: "Please elaborate. We need this to be compliance/governance robust", and then, of building only with the sandbox: "So what is the solution for windows copilot then? … I think we need to prepare for the worse - what if sandbox cant be run?". Section 6.4 now builds on every computer: the host's controls first, then the strongest level the computer allows (Copilot's sandbox, Guarded, Ask), with Locked or the company's settings on top where available, and an audit report checked against the host's own history. The question goes back as a new card about projects with real users. Options: the host's controls required, the person's approval on the host once check C15 gives one, and never Unattended (recommended); as that, and also Locked or the company's settings on the computer; or no difference for projects with real users.
3. **VS Code's Claude agent. Decided by the director on 20 October 2026:** "I think both but my friend who is goinf to test this wont be able to use claude agents via vs code or github copilot". So both routes are offered, but the Copilot route is the primary one and stands complete on its own: nothing in it leans on the Claude agent route. The Claude agent route is offered only where check C1 passes and the company allows it, and it is built after the Copilot route.
4. **When to build it. Decided by the director on 20 October 2026:** "Checks now, build later". The checks (section 11) run now; the Copilot adapter is built later.

**Still open, not for now:** which Google agent to support later (section 10); whether Claude Code adopts this section's host controls, approval on the host, audit report and Guarded findings (section 6.4), and whether Guarded's low-integrity git in a shared worktree store holds, which check 52 should answer for both agents; whether Claude Code users also move to the sign-in start (section 8.5).

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
- for the governance bar, pending the director's answer on projects with real users: the host's controls first (protection pinned to the host's own CI, the project's secrets kept out of pull requests' CI runs, the person's approval on the host once check C15 gives one, the narrow connection only, the record pushed as it happens), said plainly to hold against agents on the personal route only while nothing reaches the person's sign-in; the strongest level the computer allows, enforced by Copilot's own permission rules from a clean settings folder and environment, and unattended only where the keys are unreadable to builds until C15 passes; Guarded on Copilot keeping the control files at the normal level and removing links out of the worktree; new keys and a renewed connection after Unattended and after weeks with Ask allowances; building in the person's own chat where Copilot CLI can't run; the audit report checked against the host's own history; Unattended only by its own card and never for a project with real users; Locked on Copilot forcing the sandbox for all Copilot work on the computer; the baseline setting `forceRemoteSettingsRefresh` and recommending device management too; IT's approval named up front on a work computer, with no start-up entry (sections 6.4 and 8.5).

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
