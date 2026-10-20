<!-- docs/research/copilot-cli-and-standards-2026-10.md -->

# Copilot CLI and cross-agent standards: research note

Researched 20 October 2026 from official documentation and changelogs, fetched that day. Most official pages carry no "last updated" date. Where they do, it is given. Every claim cites the page it came from. Confidence is marked where a source was secondary, where pages disagreed, or where a page could not be fetched.

Note on sources: OpenAI's Codex docs at developers.openai.com/codex now redirect (HTTP 308) to learn.chatgpt.com/docs, which is OpenAI's own site, so those URLs are cited. VS Code's own docs (code.visualstudio.com) are cited for the VS Code side, because no other official source covers it.

---

## Part A: GitHub Copilot CLI (`copilot`)

### A1. Install and sign-in

| Platform | Command | Notes |
|---|---|---|
| Windows | `winget install GitHub.Copilot` (prerelease: `GitHub.Copilot.Prerelease`) | Needs **PowerShell v6 or higher** |
| macOS / Linux | `brew install --cask copilot-cli` (prerelease: `copilot-cli@prerelease`) | The repo README shows `brew install copilot-cli` without `--cask`. The two official sources disagree. |
| macOS / Linux | `curl -fsSL https://gh.io/copilot-install \| bash` | Set `PREFIX` and `VERSION` to choose the install directory and pin a release |
| All | `npm install -g @github/copilot` | **Node.js 22 or later** |
| All | Direct download from the releases page | |

- **Prerequisites:** an active Copilot subscription. Organisation or enterprise policy can disable the CLI.
- **Sign-in:** run `/login` interactively, or use a fine-grained PAT with the "Copilot Requests" permission. The PAT goes in `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`, checked in that order.
- **Credentials:** stored in the system credential store, or in a plain-text fallback under `COPILOT_HOME` when no store exists.
- **Current version:** v1.0.100 (stable, 19 Oct). v1.0.101-0 (prerelease) came the same day.

Sources:
- https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
- https://github.com/github/copilot-cli
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- https://github.com/github/copilot-cli/releases

### A2. Customisation the CLI reads

**Instructions** ([add-custom-instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions)):
- User level: `~/.copilot/copilot-instructions.md` and `~/.copilot/instructions/**/*.instructions.md`
- Repository: `.github/copilot-instructions.md` and `.github/instructions/**/*.instructions.md`, scoped by `applyTo`
- Agent files: **`AGENTS.md`**, **`CLAUDE.md`** (also `.claude/CLAUDE.md`) and **`GEMINI.md`**
  - Discovered at the repo root, the cwd, the directories between them, and nested directories of the files being worked on
- Extra directories: `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`
- How files combine:
  - All matching files are combined and identical copies are deduplicated.
  - There is no precedence order, so the page says to "Avoid conflicting instructions".
  - `@` file references work in `copilot-instructions.md`, `AGENTS.md` and `CLAUDE.md`.

**Custom agents** ([create-custom-agents-for-cli](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli), [plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)):
- Format: `*.agent.md` files in `.github/agents/` (project) or `~/.copilot/agents/` (user).
- The plugin reference's loading order also lists **`.claude/agents/`**.
- Frontmatter fields: `name`, `description`, `tools` and `include-custom-instructions`. Agent frontmatter can also carry a `hooks` map, which runs only while that agent is selected ([hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)).
- Invoked with `/agent`, `--agent NAME`, or by inference from the description.

**Skills** ([add-skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)):
- Project: `.github/skills`, `.claude/skills` and `.agents/skills`
- Personal: `~/.copilot/skills` and `~/.agents/skills`. `~/.claude/skills` is **not** listed.
- Extra directories: `COPILOT_SKILLS_DIRS` ([plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)).
- `SKILL.md` frontmatter: `name`, `description`, `license` and `allowed-tools`. Pre-approving `shell` in `allowed-tools` is warned against.
- Invocation: automatic, or `/skill-name`. Managed with `/skills ...` and `copilot skill ...`.
- agentskills.io lists GitHub Copilot as a supporting client ([agentskills.io](https://agentskills.io/)).

**MCP** ([add-mcp-servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)):
- Config files:
  - User: `~/.copilot/mcp-config.json`
  - Project, local: `.mcp.json`, in any directory from the cwd up to the repo root
  - Project, committed: `.github/mcp.json`
- Precedence: `.mcp.json` beats `.github/mcp.json`, and nearer files beat farther ones.
- Top-level key is `mcpServers`. Server types are `local`/stdio, `http` and `sse`. A `tools` allowlist is supported.
- **`.vscode/mcp.json` is not read** by the CLI. It uses `servers` as its key.
- Project MCP servers load only after folder trust is confirmed.
- The GitHub MCP server is built in.
- `--additional-mcp-config` has the highest precedence ([plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)).

**Plugins** ([plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference), [about plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins), [marketplace how-to](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)):
- Copilot CLI has its own plugin and marketplace system, in two formats:
  - **Legacy Copilot format.** The manifest is searched for at `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, and **`.claude-plugin/plugin.json`**, in that order. Components are `agents/`, `skills/`, `commands`, `hooks.json` or `hooks/hooks.json`, `.mcp.json` or `.github/mcp.json`, and `lsp.json`.
  - **Agent Plugins (agent-plugins.org) 1.0.0 / 1.1.0.** A root `plugin.json` with `$schema` set to `https://agent-plugins.org/schemas/<ver>/plugin.schema.json`. The portable parts are `skills/` and `mcp.json`. Copilot-only parts go under `com.github.copilot/` (agents, commands, `hooks/hooks.json`, `lsp.json`, rules).
- Marketplace file `marketplace.json` is searched for at `marketplace.json`, `.plugin/`, `.github/plugin/` (recommended), and **`.claude-plugin/marketplace.json`**.
- Commands: `copilot plugin install <plugin@marketplace | OWNER/REPO[:PATH] | git URL | path>`, `copilot plugin marketplace add OWNER/REPO`, and `/plugin`.
- Install locations: `~/.copilot/installed-plugins/...` and `~/.copilot/installed-plugins/_direct/...`.
- Default marketplaces: `copilot-plugins` and `awesome-copilot`. The docs give the Claude Code marketplace (`anthropics/claude-code`) as an example of one you can add.
- Variables:
  - MCP: `PLUGIN_ROOT` and `PLUGIN_DATA`, with aliases `CLAUDE_PLUGIN_DATA` and `COPILOT_PLUGIN_DATA`.
  - Agent frontmatter, inside `mcp-servers` only: `${CLAUDE_PLUGIN_ROOT}` and `${COPILOT_PLUGIN_ROOT}`.
- Loading order:
  - Plugins **cannot override** project or personal agents and skills. The first one found wins.
  - For MCP, the last one loaded wins.
  - Built-in tools and agents cannot be overridden.
- **Claude Code compatibility, in short.** The CLI reads `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, `.claude/agents`, `.claude/skills`, `.claude/settings.json` hooks and `CLAUDE.md`. The docs do **not** claim full Claude Code plugin compatibility. Hooks, commands and agent fields differ in detail.

**Other:** LSP config lives in `~/.copilot/lsp-config.json` and `.github/lsp.json` ([README](https://github.com/github/copilot-cli)). Settings live in `~/.copilot/settings.json`, `.github/copilot/settings.json` and `.github/copilot/settings.local.json` ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)).

### A3. Hooks

Source: https://docs.github.com/en/copilot/reference/hooks-reference, plus https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks.

**Status:** neither page carries a preview label. VS Code's hooks experience *is* labelled Preview (see A5).

**Locations.** The CLI loads all of these and combines them: policy, then user, then project, then plugins.

- **Policy (machine-wide, admin-installed):**
  - macOS/Linux: `/etc/github-copilot/policy.d/*.json`
  - Windows: `C:\ProgramData\GitHub\Copilot\policy.d\*.json` and the registry key `HKLM\Software\Policies\GitHub\Copilot`
  - Policy hooks **cannot be turned off by `disableAllHooks`**.
- **Repository:**
  - `.github/hooks/*.json`
  - An inline `hooks` field in `.github/copilot/settings.json` or `settings.local.json`
  - **`.claude/settings.json` and `.claude/settings.local.json`**
- **User:** `~/.copilot/hooks/*.json` (Windows: `%USERPROFILE%\.copilot\hooks\`), or `$COPILOT_HOME/hooks/`, plus inline `hooks` in `~/.copilot/settings.json`.
- **Plugin:** `hooks.json` or `hooks/hooks.json`.
- **Agent-scoped:** a `hooks` map in agent frontmatter. CLI only.
- **Cloud agent:** only `.github/hooks/*.json` in the cloned repository.

**Schema.**

```json
{ "version": 1, "disableAllHooks": false,
  "hooks": { "preToolUse": [ { "type": "command",
     "bash": "...", "powershell": "...", "command": "...",
     "exec": "...", "args": ["..."], "cwd": "...", "env": {},
     "timeoutSec": 30, "matcher": "bash|edit" } ] } }
```

- `type` is `command`, `http` or `prompt`.
- `bash` and `powershell` are per-OS commands. `command` is the cross-platform fallback.
- `exec`/`args` run an executable directly, without a shell. CLI only.
- The default timeout is 30 s.
- `matcher` is a regex anchored as `^(?:…)$`.

**Events (camelCase):** `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `userPromptTransformed`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `permissionRequest`, `agentStop`, `subagentStart`, `subagentStop`, `errorOccurred`, `preCompact`, and `notification` (CLI only).

**Claude-compatible mode:**
- PascalCase event names (`PreToolUse`, `Stop`, ...) switch on snake_case payloads (`tool_name`, `tool_input`), Claude-style matchers and Claude tool names: `Bash`, `Read`, `Write`, `Edit`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `AskUserQuestion`, `TodoWrite` and `Agent`.
- Payloads otherwise use camelCase: `toolName`, `toolArgs`, `sessionId`, `cwd`.

**Output:**
- `preToolUse`:
  - `permissionDecision`: `allow`, `deny` or `ask`. `permissionDecisionReason` is required when denying.
  - `modifiedArgs` rewrites the tool's arguments.
  - **`ask` becomes `deny` in the cloud agent and in CLI autopilot.**
- `permissionRequest`: `behavior`, `message`, `interrupt`.
- `agentStop` / `subagentStop`: `decision: block` with a `reason`. After 8 consecutive blocks, the turn ends.
- `postToolUse`: `modifiedResult` and `additionalContext`, capped at 10 KB.

**Can `preToolUse` deny? Yes, and it is fail-closed on crash:**
- Exit `0` means stdout is parsed as JSON.
- Exit `2` means **deny**, even if stdout says allow.
- **Any other non-zero exit from `preToolUse` denies the call (fail-closed).** Other events fail open.
- **A timeout always fails open**, including for `preToolUse` and policy hooks.
- HTTP `preToolUse` hooks fail open on network errors.
- If any hook denies, the call is denied.

**Windows:**
- Use the `powershell` field. The how-to's PowerShell examples need **PowerShell 7+ (`pwsh`)** on PATH.
- Agent-scoped hooks accept `windows`/`linux`/`osx` overrides.
- Output JSON must be on a single line.
- Hook changes load only when the CLI starts.
- The cloud agent ignores `powershell` and runs only `bash` or `command`.

**Trust:** the how-to does not mention any trust gate for repository hooks. MCP has one, which loads project servers only after folder trust.

A recent hook fix: "Command hooks complete reliably even when child-exit signals are lost under Node" (v1.0.98-2, [releases](https://github.com/github/copilot-cli/releases)).

### A4. Permissions and sandbox

Sources:
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools
- https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli
- https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference

**Default behaviour:**
- Reads are auto-approved. Modifying or executing tools prompt for approval: once, for the rest of the session, or reject.
- Session approvals don't carry over to new or resumed sessions.

**Tool flags:**
- `--allow-tool`, `--deny-tool`, `--allow-all-tools`
- `--available-tools`, an allowlist the model can see. It wins over `--excluded-tools`.
- `--excluded-tools`

**Tool patterns:** `shell`, `shell(git push)`, `shell(git:*)`, `write`, `write(path)`, `read`, `url`, `memory`, `MCP_SERVER`, `MCP_SERVER(tool)`.

**Precedence:** "Deny rules always take precedence over allow rules," including over `--allow-all` and saved approvals.

**Paths:**
- Default access is the cwd and below, plus the system temp directory.
- `--add-dir=DIR` adds a directory. `--allow-all-paths` turns path checks off. `--disallow-temp-dir` blocks the temp directory.

**URLs:**
- All URLs need approval by default. HTTP and HTTPS are approved separately.
- `--allow-url=DOMAIN`, `--deny-url=DOMAIN` and `--allow-all-urls` set URL rules.
- Permanent approvals go to `allowedUrls` in `~/.copilot/settings.json`.

**Allow everything:** `--allow-all` (`--yolo`, or `COPILOT_ALLOW_ALL=true`) equals tools + paths + URLs. In a session, use `/allow-all` or `/yolo`. Business and Enterprise admins can block these.

**Persistence:**
- `~/.copilot/permissions-config.json` holds approvals per repo root. Flags are not written there.
- Trusted folders are the `trustedFolders` array in `~/.copilot/config.json`.

**Trusted directories:**
- Trust is confirmed at launch for the cwd and below.
- The docs warn that scoping is heuristic: "GitHub doesn't guarantee that files outside trusted directories are protected."

**Permission modes:**
- `/permissions` offers `default`, `assisted` and `allow-all` ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)).
- "Assisted" uses a permission judge ([releases](https://github.com/github/copilot-cli/releases)).
- Recent releases changed the judge:
  - Nested PowerShell and `bash -c` commands are sent to it in more cases (v1.0.100).
  - Ambiguous unscoped rules now prompt instead of being granted (v1.0.99).

**Local sandbox** ([about-cloud-and-local-sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes)):
- Built on Microsoft eXecution Container (MXC).
- Backends:
  - macOS: Seatbelt, macOS 15 or later.
  - Linux: bubblewrap 0.5 or later, plus networking helpers.
  - **Windows: needs a recent Windows 11 update. Denied paths and proxying depend on the Windows version.** If a feature is unsupported, the CLI reports the requirement rather than running with weaker restrictions.
- What it restricts: filesystem read/write/deny, network (internet and local, host allow/deny), credential masking, and local MCP and LSP servers.
- **Off by default.** `/sandbox enable` persists until disabled. `/sandbox enable session` applies to one session only.
- Enterprise-managed keys: `sandbox.enabled` and `sandbox.failIfUnavailable`.
- Releases: v1.0.91 made sandbox commands work on Windows (secondary tracker, [havoptic](https://www.havoptic.com/releases/github-copilot/2026/10), not confirmed in GitHub's own notes). v1.0.100 allows local-network access by default and can offer an approved rerun outside the sandbox ([releases](https://github.com/github/copilot-cli/releases)).
- The Copilot app's built-in file tools check the sandbox policy "on a best-effort basis", not through the OS sandbox.

**Cloud sandbox:** public preview, started with `copilot --cloud --experimental`. Interactive only. Billed per use.

### A5. Programmatic use, ACP, SDK and VS Code

**Non-interactive use** ([programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)):
- Flags:
  - `copilot -p "…"` runs one prompt and exits.
  - `-s`/`--silent` prints the response only.
  - `--output-format=json` emits JSONL.
  - `--no-ask-user` stops the agent from pausing to ask questions.
  - `--agent NAME` selects a custom agent.
  - `--max-ai-credits N` caps spend.
- Pipe input on stdin.
- Grant permissions up front with `--allow-tool` and similar flags, or `--allow-all`.
- `--trust-folder` covers `-p` and piped sessions.
- Exit codes are documented only for `copilot workflow run`.

**Sessions** ([multiple sessions](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/work-with-multiple-sessions)):
- Resume with `copilot --continue`, `copilot --resume` or `copilot --name`, or with `/resume` and `/continue` inside a session.
- A sessions sidebar lists sessions. Sessions keep running when you switch away from them.
- `/new worktree` starts a session in a new Git worktree ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)).

**ACP server** ([acp-server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)):
- **Public preview.**
- Start with `copilot --acp --stdio` (the default) or `copilot --acp --port 3000` (bound to 127.0.0.1).
- Server-wide `--available-tools` and `--excluded-tools` apply to every session, and clients cannot override them.
- The client must handle `requestPermission`.

**Copilot SDK** ([copilot-sdk docs](https://docs.github.com/en/copilot/how-tos/copilot-sdk)):
- Guides cover TypeScript, Python, Go, .NET, Java and Rust, and include session hooks.
- Package name, transport and status are not stated on the landing page.
- Secondary sources say it is `@github/copilot-sdk`, drives the CLI over JSON-RPC, and is in public preview ([search result](https://docs.github.com/en/copilot/how-tos/copilot-sdk)). Medium confidence.

**VS Code link** ([connecting-vs-code](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/connecting-vs-code)):
- **How it connects:** the CLI auto-connects when its cwd matches a trusted VS Code workspace, or manually with `/ide`. It connects to one VS Code instance at a time.
- **What VS Code adds:** the editor selection, diffs to accept or reject (skipped under `--yolo`), and live diagnostics.
- **Sessions view:** CLI sessions appear in the **Sessions view** in the Copilot Chat sidebar with readable transcripts. Right-click a session and choose "Resume in Terminal".
- **CLI sessions started by VS Code** ([code.visualstudio.com Copilot CLI page](https://code.visualstudio.com/docs/agents/agent-types/copilot-cli)):
  - VS Code runs the "Copilot harness" on the Copilot SDK. Sessions continue in the background after the window closes, while the Agent Host keeps running.
  - In the Agents window you choose **folder or worktree** isolation, or a Dev Container.
  - "Harness-specific customizations, including hooks, follow the selected harness". So Copilot-harness sessions in VS Code use Copilot's hook system.

**VS Code hooks** ([code.visualstudio.com hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)):
- **"The VS Code hooks experience is in Preview."**
- The Local harness reads:
  - `.github/hooks/*.json` and `~/.copilot/hooks/*.json`
  - Claude-format `.claude/settings*.json` and `~/.claude/settings.json`, only when `chat.useClaudeHooks` is on. It is off by default.
  - Agent frontmatter `hooks`, and plugin hooks.
- Local events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`.
- Caveats:
  - For Claude-format files, the Local harness "ignores matcher values, so every command for the event runs".
  - Workspace hooks need Workspace Trust.
  - Harnesses that read the same files differ in events, matchers, tool names and payloads.
- The [VS Code hooks reference](https://code.visualstudio.com/docs/agents/reference/hooks-reference) has `permissionDecision` `allow`/`deny`/`ask`, with the most restrictive decision winning, and exit 2 as a blocking error. This comes from a search summary, not a direct fetch. Medium confidence.

### A6. Usage visibility

- Copilot now meters by **AI credits**: "each credit equals $0.01 USD, and usage depends on the model and the number of tokens consumed" ([set-session-limit](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/set-session-limit)). The CLI docs no longer use the term "premium requests" ([about-copilot-cli](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)).
- **Session limits:** `/limits set max-ai-credits N` interactively, or `--max-ai-credits N` with `-p`. The minimum is 30. The limit is soft, and a `-p` run ends when it is reached. Public preview.
- **Display:**
  - `/usage` exists. v1.0.101-0 changed how it shows BYOK rows ([releases](https://github.com/github/copilot-cli/releases)).
  - The `footer.showQuota` setting shows quota in the footer ([command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)).
  - `/context` shows token use ([about-copilot-cli](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)).

### A7. Copilot cloud agent (brief, since Wheelhouse is local-first)

- **Where it runs:** in an ephemeral Linux sandbox on GitHub Actions infrastructure.
- **Hooks:** read only from `.github/hooks/*.json` in the cloned repo, and only `bash`/`command` entries run. Some events don't fire. `ask` becomes `deny`. Hook HTTP traffic goes through the firewall ([hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)).
- **Firewall** ([customize-the-agent-firewall](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/customize-the-agent-firewall)):
  - On by default, with GitHub hosts and a recommended allowlist. Configured in org or repo settings under Copilot > Internet access.
  - **It applies only to processes started by the agent's Bash tool**, not to MCP servers or setup steps. GitHub says it is not a comprehensive security solution.
- **Plugins:** they also apply to the cloud agent ([about plugins](https://docs.github.com/en/copilot/concepts/agents/about-plugins)).

---

## Part B: Cross-agent standards

### B1. AGENTS.md: who reads it

| Agent | Reads AGENTS.md? | Detail | Source |
|---|---|---|---|
| Copilot CLI | Yes | Root, cwd, intermediate and nested directories; combined with `CLAUDE.md` and `GEMINI.md` | [add-custom-instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) |
| Copilot cloud agent, VS Code | Yes | Listed on agents.md | [agents.md](https://agents.md/) |
| Codex | Yes, native | `~/.codex/AGENTS.override.md` or `AGENTS.md` globally; then from the project root down to the cwd, one file per directory. The nearest file is concatenated last. Limit `project_doc_max_bytes` = 32 KiB. Other names via `project_doc_fallback_filenames`. | [learn.chatgpt.com agents-md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) |
| Cursor | Yes | Root and subdirectories, plus `.cursor/rules/*.mdc` | [cursor rules](https://cursor.com/docs/context/rules) |
| Gemini CLI | Only if configured | Default is `GEMINI.md`. Set `context.fileName` to e.g. `["AGENTS.md","GEMINI.md"]`. | [gemini-md](https://geminicli.com/docs/cli/gemini-md/), [agents.md](https://agents.md/) |
| Claude Code | Yes, since v2.1.277 | Reads `AGENTS.md` and `.claude/AGENTS.md` **only when no `CLAUDE.md` or `CLAUDE.local.md` exists** in the cwd or above it, unless "Project instructions" is set to `claude-md-and-agents-md`. Alternatively import it with `@AGENTS.md` from `CLAUDE.md`. | [code.claude.com memory](https://code.claude.com/docs/en/memory) |

AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation. "The closest AGENTS.md to the edited file wins" ([agents.md](https://agents.md/)).

### B2. Agent Skills (agentskills.io, SKILL.md)

- **The format:** a folder holding a `SKILL.md`, with `name` and `description` required in its frontmatter, plus optional `scripts/`, `references/` and `assets/`. Agents load skills by progressive disclosure.
- **Origin:** developed by Anthropic and released as an open standard.
- **Clients listed:** Claude Code, GitHub Copilot, VS Code, Codex, Cursor, Gemini CLI, Junie, Amp, OpenCode, Goose, Kiro, Roo Code, Factory and many more ([agentskills.io](https://agentskills.io/)).
- **Portable fields:** `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` ([Claude Code skills](https://code.claude.com/docs/en/skills)).

| Agent | Project folders | User folders | Source |
|---|---|---|---|
| Claude Code | `.claude/skills/`, including nested and `--add-dir` | `~/.claude/skills/` | [code.claude.com skills](https://code.claude.com/docs/en/skills). `.agents/skills` is not mentioned. |
| Copilot CLI | `.github/skills`, `.claude/skills`, `.agents/skills` | `~/.copilot/skills`, `~/.agents/skills` | [add-skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) |
| Codex | `.agents/skills`, from the cwd up to the repo root | `~/.agents/skills`; admin `/etc/codex/skills` | [learn.chatgpt.com build-skills](https://learn.chatgpt.com/docs/build-skills) |
| Cursor | `.agents/skills`, `.cursor/skills`, and for compatibility `.claude/skills`, `.codex/skills` | `~/.agents/skills`, `~/.cursor/skills`, `~/.claude/skills`, `~/.codex/skills` | [cursor skills](https://cursor.com/docs/context/skills) |
| Gemini CLI | `.gemini/skills`, or the alias `.agents/skills` (wins within its tier) | `~/.gemini/skills`, `~/.agents/skills` | [gemini skills](https://geminicli.com/docs/cli/skills/) |

**Takeaway:**
- `.agents/skills/` is the common project folder for Copilot, Codex, Cursor and Gemini.
- `.claude/skills/` covers Claude Code, Copilot and Cursor.
- Shipping both covers all five. A symlink or a copy step can avoid duplication.

### B3. Hooks in other agents

| Agent | Config | Events (pre-tool event in bold) | Deny a tool? | Failure mode | Source |
|---|---|---|---|---|---|
| Claude Code | `.claude/settings*.json`, `~/.claude/settings.json`, plugin `hooks/hooks.json` | **PreToolUse**, PostToolUse, UserPromptSubmit, Stop, SubagentStop, SessionStart and others | Yes (`permissionDecision: deny`, exit 2) | (reference baseline) | [code.claude.com memory](https://code.claude.com/docs/en/memory), which points to PreToolUse as the enforcement route |
| Copilot CLI | See A3 | **preToolUse** / PreToolUse | Yes | Fail-closed on crash, fail-open on timeout | [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference) |
| Codex | `~/.codex/hooks.json`, `~/.codex/config.toml [hooks]`, `<repo>/.codex/hooks.json` or `config.toml` (trusted projects only), plugin hooks, managed `requirements.toml`. On by default. | SessionStart, SessionEnd, **PreToolUse**, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Interrupt | Yes (`hookSpecificOutput.permissionDecision: "deny"` plus reason; legacy `decision: "block"`; exit 2) | Covers shell (`Bash`), `apply_patch` (`Edit`/`Write`), MCP and local tools; **not hosted tools such as WebSearch**. "Treat tool hooks as a useful guardrail, not a complete enforcement boundary." Windows override `commandWindows`. | [learn.chatgpt.com hooks](https://learn.chatgpt.com/docs/hooks) |
| Cursor | `.cursor/hooks.json`, `~/.cursor/hooks.json`, enterprise MDM paths (Windows `C:\ProgramData\Cursor\hooks.json`), team dashboard | sessionStart, sessionEnd, **preToolUse**, postToolUse, postToolUseFailure, subagentStart, subagentStop, **beforeShellExecution**, afterShellExecution, **beforeMCPExecution**, afterMCPExecution, **beforeReadFile**, afterFileEdit, beforeSubmitPrompt, preCompact, stop, afterAgentResponse, afterAgentThought (and Tab/App events) | Yes (`permission: "deny"`, exit 2). **`ask` is "not enforced for `preToolUse` today".** | Fail-open by default; `failClosed: true` makes crashes and timeouts block. Invalid JSON blocks permission hooks. | [cursor hooks](https://cursor.com/docs/agent/hooks) |
| Gemini CLI | `hooks` in `.gemini/settings.json`, `~/.gemini/settings.json`, `/etc/gemini-cli/settings.json`, extensions | SessionStart, SessionEnd, BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeToolSelection, **BeforeTool**, AfterTool, PreCompress, Notification | Yes (`decision: "deny"`/`"block"` plus `reason`; exit 2) | Other exits are non-fatal warnings, so it is likely fail-open. Default timeout 60 s. | [gemini hooks](https://geminicli.com/docs/hooks/), [reference](https://geminicli.com/docs/hooks/reference/) |

**Is there a common hook format? No formal standard, but the Claude Code format has become the de facto lingua franca:**
- **Copilot CLI** reads `.claude/settings.json` hooks natively and has a PascalCase Claude-compatible mode ([hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)).
- **Cursor** loads Claude Code hooks from `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json` ([third-party hooks](https://cursor.com/docs/reference/third-party-hooks)).
  - The "Include Third-Party Plugins, Skills, and Other Configs" toggle is on by default.
  - Events map PascalCase to camelCase. Tools map `Bash`→`Shell` and `Edit`→`Write`. `Glob`, `Notification` and `PermissionRequest` are unsupported.
  - A forum report says these hooks failed to load in one case (unverified).
- **VS Code** reads Claude-format hooks behind `chat.useClaudeHooks`, but ignores matchers ([VS Code hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)).
- **Codex** uses the same PascalCase event names and a `hookSpecificOutput.permissionDecision` shape, and sets `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for plugin hooks. It reads `.codex/`, not `.claude/` ([Codex hooks](https://learn.chatgpt.com/docs/hooks)).
- **Gemini CLI** uses different event names (`BeforeTool`) and a top-level `decision` field, but sets a `CLAUDE_PROJECT_DIR` alias ([gemini hooks](https://geminicli.com/docs/hooks/)).
- Shared by all: stdin JSON in, stdout JSON out, and **exit 2 = block** (Copilot, Codex, Cursor and Gemini all document it).

**Practical result:** one Node script that reads stdin and accepts either `tool_name`/`tool_input` or `toolName`/`toolArgs` can serve every agent. A thin per-agent registration file wires it in: `.claude/settings.json` (Claude Code, Copilot CLI, Cursor), `.github/hooks/*.json` (Copilot CLI, VS Code, cloud agent), `.codex/hooks.json`, `.cursor/hooks.json` and `.gemini/settings.json`.

### B4. MCP configuration locations

| Agent | User | Project | Key | Source |
|---|---|---|---|---|
| Claude Code | `~/.claude.json` (not re-verified today) | `.mcp.json` | `mcpServers` | Not re-fetched today. Low confidence on the user path. |
| Copilot CLI | `~/.copilot/mcp-config.json` | `.mcp.json` (cwd up to the repo root), `.github/mcp.json` | `mcpServers` | [add-mcp-servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) |
| VS Code | (user profile) | `.vscode/mcp.json` | **`servers`**; not read by Copilot CLI | [add-mcp-servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) |
| Codex | `~/.codex/config.toml` | `.codex/config.toml` (trusted projects only) | TOML `[mcp_servers.<name>]` | [learn.chatgpt.com mcp](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` | `mcpServers` | [cursor mcp](https://cursor.com/docs/context/mcp) |
| Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` | `mcpServers` | [gemini mcp](https://geminicli.com/docs/tools/mcp-server/) |
| Agent Plugins | n/a | plugin-root `mcp.json` | n/a | [agent-plugins.org](https://agent-plugins.org/) |

`.mcp.json` with `mcpServers` is shared by Claude Code and Copilot CLI. Codex alone uses TOML.

### B5. Plugin formats and cross-compatibility

- **Agent Plugins (agent-plugins.org)** is a new vendor-neutral standard ([agent-plugins.org](https://agent-plugins.org/)).
  - Its steering committee includes Amazon, Cursor, Microsoft, OpenAI and Vercel. Anthropic and Google are not listed.
  - Format: a root `plugin.json` with portable `skills/` and `mcp.json`. Client-specific parts go in reverse-domain folders such as `com.github.copilot/`.
- **Copilot CLI** supports Agent Plugins 1.0.0/1.1.0 and its legacy format. It reads `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` ([plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)).
- **Codex** ([build plugins](https://developers.openai.com/codex/plugins/build/), [plugins](https://learn.chatgpt.com/docs/plugins)):
  - Manifest: a portable root `plugin.json` with `extensions.com.openai`. `.codex-plugin/plugin.json` remains a compatibility fallback.
  - "OpenAI also accepts legacy and Claude-compatible manifests."
  - Marketplaces: `.agents/plugins/marketplace.json` (repo and `~`), and `.claude-plugin/marketplace.json` as "legacy-compatible".
  - Plugins with hooks aren't eligible for the public directory. The IDE extension doesn't support plugins.
- **Cursor** ([cursor plugins reference](https://cursor.com/docs/reference/plugins)):
  - Two formats: Agent Plugins (root `plugin.json`, skills and MCP only) and Cursor Plugins (`.cursor-plugin/plugin.json`, which adds rules, agents, commands, hooks and variables). Marketplaces use `.cursor-plugin/marketplace.json`.
  - `${CLAUDE_PLUGIN_ROOT}` is expanded.
  - The third-party import toggle covers "Plugins, Skills, and Other Configs" ([third-party hooks](https://cursor.com/docs/reference/third-party-hooks)). Whether `.claude-plugin` packages install as-is is not documented.
- **Gemini CLI extensions** bundle prompts, MCP servers, commands, themes, hooks, sub-agents and skills. Install with `gemini extensions install <github-url>`. The manifest is `gemini-extension.json` (field list not fetched). No cross-compatibility is stated ([gemini extensions](https://geminicli.com/docs/extensions/)).
- **Claude Code:** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.

**Gemini CLI caveat:** "Gemini CLI was replaced by Antigravity CLI on June 18th, 2026" for unpaid-tier and Google One users (banner on every geminicli.com page). Enterprise Gemini Code Assist users reportedly keep Gemini CLI.
- Antigravity CLI (`agy`) reportedly renames extensions to plugins (`plugin.json`), reads `AGENTS.md` and `.agents/skills/`, keeps `GEMINI.md` for backward compatibility, and offers `agy plugin import gemini`.
- These details come from secondary sources, because the antigravity.google docs did not render ([search results](https://www.antigravity.google/docs/cli/plugins)). Low confidence. Re-check before relying on them.

**Cross-compatibility verdict:**
- The **Claude Code plugin layout is accepted for reading by Copilot CLI and Codex**, which means the manifest and marketplace locations, the `CLAUDE_PLUGIN_*` variables and the `skills/` folder. Cursor partly supports it.
- **Agent Plugins** is the emerging neutral format, supported by Copilot, Codex and Cursor. It standardises only skills and MCP. Hooks, agents and commands stay vendor-specific.
- Gemini or Antigravity is separate.

### B6. Sandboxing per agent (macOS and Windows)

| Agent | macOS | Windows | Default | Source |
|---|---|---|---|---|
| Copilot CLI | Seatbelt via MXC, macOS 15+ | MXC; **needs a recent Windows 11 update**; denied paths and proxying depend on version; reports instead of degrading | Off; `/sandbox enable` | [about sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes) |
| Codex | Seatbelt, works out of the box | Native: **`mxc`** (recommended; Windows 11 24H2 build 26100.9278 / 25H2 26200.9278+; no admin), **`elevated`** (legacy; admin setup; separate sandbox user plus firewall), **`unelevated`** (legacy; restricted token; weaker network isolation; no deny-read). WSL2 uses the Linux bubblewrap sandbox. | `sandbox_mode = "workspace-write"` plus `approval_policy = "on-request"` recommended | [windows-sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox.md), [sandboxing](https://learn.chatgpt.com/docs/sandboxing.md) |
| Cursor | Seatbelt via `sandbox-exec` (v2.0+) | **Not documented** on the official run-modes page. A forum post and a search summary say it is WSL2-based or "proxy-only, no filesystem sandbox" on Windows. Treat as weak or unknown. | Run modes: Auto-review, Allowlist, Run Everything. Network blocked by default. `~/.cursor/sandbox.json` and `.cursor/sandbox.json`. | [run-modes](https://cursor.com/docs/agent/security/run-modes), [forum](https://forum.cursor.com/t/ai-shell-now-sandboxed-can-t-run-real-git-powershell/153876) |
| Gemini CLI | Seatbelt (`sandbox-exec`, six profiles, default `permissive-open`) | "Windows Native Sandbox" using `icacls` Low Mandatory Level on writable paths; Docker or Podman | Opt-in via `-s`/`--sandbox`, `GEMINI_SANDBOX`, or `tools.sandbox` | [gemini sandbox](https://geminicli.com/docs/cli/sandbox/) |
| Claude Code | (not re-fetched today) | (not re-fetched today) | | |

---

## Bottom line for Wheelhouse

**What can be one core:**
- `AGENTS.md`: read by Copilot, Codex and Cursor. Gemini reads it once configured. Claude Code reads it only when no `CLAUDE.md` exists, so keep `CLAUDE.md` importing `@AGENTS.md`.
- `SKILL.md` skills: put them in `.agents/skills/` plus `.claude/skills/`.
- MCP servers: `.mcp.json` / `mcpServers` for most agents. Codex needs TOML.
- A Node hook script: stdin JSON in, exit 2 or a deny JSON out.

**What differs:**
- Hook registration files and event-name casing.
- Tool names: `Bash` (Claude Code, Codex), `shell` (Copilot), `Shell` (Cursor). Gemini's names were not checked.
- Output fields: `permissionDecision`, `permission`, `decision`.
- Fail-open versus fail-closed behaviour.
- Permission flags and sandbox mechanics.
- Plugin packaging beyond skills and MCP.

**Copilot CLI versus VS Code for safety:**
- Copilot CLI hooks are the stronger enforcement layer. They are not labelled preview.
- A crashing `preToolUse` hook fails closed. `ask` becomes `deny` in autopilot.
- Policy hooks are machine-wide and cannot be disabled by the repository.
- Deny rules beat every allow.
- Path and URL checks are explicit, and an OS sandbox is available.
- VS Code hooks are Preview, need Workspace Trust, and ignore matchers in Claude-format files. Behaviour also varies by harness.
- In VS Code, Copilot-harness sessions do use Copilot's hooks.
- Gaps remain:
  - Hook timeouts fail open.
  - HTTP hooks fail open.
  - Trusted-directory scoping is "heuristic".
  - The sandbox is off by default.

**Windows caveats for Copilot CLI:**
- It needs PowerShell 6+, and the docs' hook examples need `pwsh` 7+.
- Hooks need the `powershell` field, or `command` / `exec` (Node) to stay cross-platform.
- The local sandbox needs a recent Windows 11 update, with some features dependent on version.
- The cloud agent ignores `powershell` hook entries.
