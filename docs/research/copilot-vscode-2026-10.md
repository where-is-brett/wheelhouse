<!-- docs/research/copilot-vscode-2026-10.md -->

# GitHub Copilot in VS Code: what it supports on 20 October 2026

Research from official pages only, fetched on 20 October 2026. Each claim gives its source URL and the page date or release. "Not documented" means the official page I fetched does not say. "Inference" marks my own reading, not a documented fact.

## 0. Background you need first: harnesses

The docs have moved: `code.visualstudio.com/docs/copilot/...` now redirects into `/docs/agents/...` and `/docs/agent-customization/...`. VS Code now ships **weekly** (1.136 on 2 September, 1.137 on 9 September, 1.138 on 16 September, 1.139 on 23 September, 1.140 on 30 September, 1.141 on 7 October and 1.142 on 14 October 2026, the latest). Source: https://code.visualstudio.com/updates (1.142, 14 October 2026) and each release page below.

Almost every answer below depends on which **agent harness** a session uses:

| Harness | Runs in | Notes | Source |
|---|---|---|---|
| **Copilot** | Agent Host process, Copilot SDK (same runtime as Copilot CLI and the Copilot app) | Being rolled out as the **default for new sessions** in 1.142. Sessions outlive the window. | https://code.visualstudio.com/docs/agents/run/agent-harnesses (14 October 2026); https://code.visualstudio.com/updates/v1_142 (14 October 2026) |
| **Local** | Extension host (the older built-in harness) | Tied to the editor window. Prompt files and tool sets work only here. | same |
| **Claude** | Agent Host, Anthropic Claude Agent SDK | Enabled by default; needs a Copilot subscription or BYOK. | same |
| **Codex** | OpenAI Codex extension, or Agent Host integration (Experimental) | Not listed by default. | same |
| **Cloud** | Provider infrastructure, returns a PR | Claude and Codex cloud agents are Preview. | same |

Agent Host: "a dedicated process that runs agent harnesses and manages their sessions"; can run locally, in a Dev Container (Experimental), or on a remote machine (AHP JSON-RPC over WebSocket). Local harness sessions stay in the extension host. https://code.visualstudio.com/docs/agents/concepts/agent-host (14 October 2026)

Enterprise routing: if managed settings contain a non-empty `permissions` object or `sandbox.enabled: true`, VS Code forces the Copilot harness, moves open Local chats to it (archived read-only), and makes **Claude, Codex and terminal chat unavailable**. `vscode.temporaryDefaultToLocalHarness: true` opts out, with the warning that Local does not enforce runtime-only sandbox and permission rules. https://code.visualstudio.com/updates/v1_142 (14 October 2026); https://code.visualstudio.com/docs/enterprise/manage-ai-settings (14 October 2026)

---

## 1. Custom instructions

Source for this section unless noted: https://code.visualstudio.com/docs/agent-customization/custom-instructions (14 October 2026).

| Harness | Project-wide | Targeted |
|---|---|---|
| Copilot | `.github/copilot-instructions.md` or `AGENTS.md` | `.github/instructions/**/*.instructions.md` |
| Claude | `CLAUDE.md` (also `.claude/CLAUDE.md`, `~/.claude/CLAUDE.md`, `CLAUDE.local.md`) | Markdown in `.claude/rules` |
| Codex | `AGENTS.md` including subfolders | nested `AGENTS.md` |

- **User level:** Copilot reads `~/.copilot/instructions` and `~/.copilot/copilot-instructions.md`; Claude reads `~/.claude/rules`; Local keeps user instructions in VS Code profile storage. Harness user folders do not roam with Settings Sync.
- **Organisation level:** set on GitHub, additive; `github.copilot.chat.organizationInstructions.enabled`.
- **Front matter for `*.instructions.md`:** `name`, `description` (lets the agent pick the file by relevance), `applyTo` (glob from workspace root; `**` = all). Claude rules use `paths` (array of globs, default `**`). With neither `description` nor `applyTo`, the file is attached only by hand. `excludeAgent` is not documented.
- **Settings (Local harness unless noted):** `chat.useAgentsMdFile` (default `true`), `chat.useClaudeMdFile` (default `true`), `chat.useNestedAgentsMdFiles` (default `false`, **Experimental**), `github.copilot.chat.codeGeneration.useInstructionFiles`, `chat.includeApplyingInstructions`, `chat.includeReferencedInstructions`, `chat.useCustomizationsInParentRepositories`; `chat.instructionsFilesLocations` is deprecated. Defaults from https://code.visualstudio.com/docs/agents/reference/ai-settings (14 October 2026).
- **Does VS Code read CLAUDE.md?** Yes: the Claude harness uses it natively, and Local has `chat.useClaudeMdFile` on by default.
- **Nested AGENTS.md:** Experimental, off by default (Local); Codex reads subfolder `AGENTS.md` natively.
- **Precedence:** the page says not to rely on order; sources are additive and merging varies by harness.
- **Status/policy:** no status label on the core feature. Org instructions are governed by GitHub org settings. OS: no caveats documented.

## 2. Prompt files (`.prompt.md`)

Source: https://code.visualstudio.com/docs/agent-customization/prompt-files (14 October 2026).

- **Harness:** "Prompt files run only in **Local** harness sessions in the Chat view." For other harnesses the page says to use a skill instead (or convert the prompt file to one).
- **Location:** workspace `.github/prompts/`; user prompts in the VS Code profile. Monorepo parent discovery via `chat.useCustomizationsInParentRepositories`; `chat.promptFilesRecommendations` shows them as suggestions.
- **Front matter:** `description`, `name` (the slash name; defaults to file name), `argument-hint`, `agent` (`ask`, `agent`, `plan` or a custom agent name), `model`, `tools` (built-in, tool sets, MCP `<server>/*`, extension tools). No `mode` field is documented (it was renamed `agent`).
- **Invocation:** `/name [args]` in Local chat, **Chat: Run Prompt**, or the editor play button. Variables: `#file:`, `#tool:<name>`, `${input:var}`, `${input:var:placeholder}`, `${selection}`.
- **Status:** no label; not documented as deprecated. Tool-list priority: a prompt file's `tools` overrides the agent's (https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference, 16 October 2026).

## 3. Custom agents (formerly custom chat modes)

Sources: https://code.visualstudio.com/docs/agent-customization/custom-agents (14 October 2026); https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference (16 October 2026); https://code.visualstudio.com/docs/agents/run/subagents (14 October 2026).

- **Files:** `.agent.md` (or plain `.md` in some locations). Rename legacy `.chatmode.md` to `.agent.md`.
- **Locations:** workspace `.github/agents` (`.agent.md`/`.md`) and `.claude/agents` (Claude format); user `~/.copilot/agents` and `~/.claude/agents`. Local stores user agents in profile storage. `chat.agentFilesLocations` and `chat.modeFilesLocations` are deprecated (Local only). Org-level agents appear from GitHub (`github.copilot.chat.organizationCustomAgents.enabled`, default on).
- **Front matter (all optional):** `name`, `description`, `argument-hint`, `tools` (string or array; "If the agent specifies a `tools` list, only those tools are available"), `agents` (allowed subagents; `['*']`/omitted = all; `[]` = none; needs the `agent` tool set), `model` (string or prioritised array), `reasoning-effort` (Copilot harness only: `low`…`max`), `user-invocable` (default `true`), `disable-model-invocation` (default `false`), `infer` (**deprecated**, replaced by the previous two), `target` (`vscode` or `github-copilot`; not a harness selector), `mcp-servers` (Copilot cloud agent only, not VS Code), `handoffs` (Local; items `label`, `agent`, `prompt` required, `send` default `false`, `model`), `hooks` (**Preview**, Local only; needs `chat.useHooks` and a trusted workspace).
- **Claude agent format** (`.claude/agents/*.md`): `name`, `description` required; `tools` as a comma string; `disallowedTools`; `model` (a model alias or `inherit`); `permissionMode`; `skills`, `mcpServers`, `hooks`, `memory`. Local maps supported Claude tool and model names to VS Code ones; "not all Claude runtime features are available".
- **Harness support:** Local supports tool names, subagents, handoffs and agent hooks. Copilot supports custom agents "through its runtime" but **not** handoffs or agent-scoped hooks. Claude uses its own format.
- **Subagents:** Local uses the `runSubagent` tool (`agent/runSubagent`, part of the `agent` tool set). Stateless, isolated context; no follow-up messages. Nesting off by default (`chat.subagents.allowInvocationsFromSubagents`, max depth 5). Subagents cannot use the ask-questions or todo tools in Local. Parallel running is **not documented** on the page. Model choice order: explicit → agent `model` → Auto (`chat.subagents.defaultToAuto`, Experimental) → parent model; a subagent will not run on a model above the parent's cost tier. Copilot, Claude and Codex harnesses use their provider-native subagents.
- **Tool restriction:** yes, via `tools`; the docs' own pattern is read-only workers (`read`, `search`) with an editing coordinator.

## 4. Agent skills (`SKILL.md`)

Source: https://code.visualstudio.com/docs/agent-customization/agent-skills (14 October 2026); settings from https://code.visualstudio.com/docs/agents/reference/ai-settings (14 October 2026).

- **Locations:** project `.github/skills/`, `.claude/skills/`, `.agents/skills/`; personal `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/`. So **VS Code reads Claude Code's skill folders directly.** The Codex integration also reads `.github/skills/`.
- **Front matter:** `name` (required; lowercase, digits, hyphens; must match folder; ≤64 chars), `description` (required; ≤1024 chars), `argument-hint`, `user-invocable` (default `true`), `disable-model-invocation` (default `false`), `context: fork` (**Experimental**; runs in a subagent; needs `github.copilot.chat.skillTool.enabled`, default `false`). `license`, `allowed-tools`, `compatibility`, `metadata` are not documented.
- **Settings:** `chat.useAgentSkills` (default `true`, no status label); `chat.agentSkillsLocations` deprecated (Local only, not read by Copilot harness); Customization Marketplace `chat.customizations.marketplace.enabled` (Experimental).
- **Scripts:** yes. Scripts must be referenced from `SKILL.md` by relative path; they run through the terminal tool and its approval and auto-approve rules.
- **Invocation:** `/skill-name`, or loaded automatically by description. Extensions can contribute skills (`chatSkills`).

## 5. Hooks

### 5a. VS Code page (all harnesses)

Source: https://code.visualstudio.com/docs/agent-customization/hooks (14 October 2026).

- **Status:** the VS Code hooks experience is **Preview**; agent-scoped hooks are Preview and Local-only. "Hooks follow the selected harness": Copilot harness → GitHub Copilot hooks reference; Claude harness → Claude Code hooks reference (`https://code.claude.com/docs/en/hooks`); Codex → Codex hooks docs; Cloud → the cloud agent's own reference.
- **Local harness settings:** `chat.useHooks` (default `true`, Preview), `chat.hookFilesLocations` (Preview), **`chat.useClaudeHooks` (default `false`, Preview)**, `chat.useCustomizationsInParentRepositories`. Workspace hook files are subject to Workspace Trust. (Defaults: https://code.visualstudio.com/docs/agents/reference/ai-settings, 14 October 2026.)
- **Local harness file locations:** `.github/hooks/*.json`; `.claude/settings.json` and `.claude/settings.local.json` (only with `chat.useClaudeHooks`); `~/.copilot/hooks/*.json`; `~/.claude/settings.json` (with `chat.useClaudeHooks`); `hooks` in `.agent.md` front matter; plugin `hooks.json` / `hooks/hooks.json`.
- **Claude-format files in Local:** parsed, but **matcher values are ignored, so every command for the event runs**; filter inside the script.
- 1.136: hooks are scoped to one workspace folder; in multi-root, VS Code asks you to pick the primary folder. https://code.visualstudio.com/updates/v1_136 (2 September 2026)

### 5b. Local harness reference

Source: https://code.visualstudio.com/docs/agents/reference/hooks-reference (14 October 2026).

- **Events (PascalCase):** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`. A custom agent's `Stop` hook becomes `SubagentStop` when it runs as a subagent.
- **Config:** `{ "hooks": { "PreToolUse": [ { "type": "command", "command": "...", "windows": "...", "linux": "...", "osx": "...", "cwd": "...", "env": {}, "timeout": 15 } ] } }`. `timeout` is in **seconds, default 30**. The OS override follows the extension host's platform (which can differ from the UI in remote windows). The Local parser also accepts Copilot format (numeric `version`, camelCase events) and Claude format.
- **Common input (stdin):** `timestamp`, `hook_event_name`, optional `cwd`, `session_id`, `transcript_path` ("not a stable hook API").
- **Event input:** `PreToolUse`: `tool_name`, `tool_input`, `tool_use_id`; `PostToolUse`: adds `tool_response`; `UserPromptSubmit`: `prompt`; `SessionStart`: `source` (always `"new"`); `Stop`: `stop_hook_active`; `SubagentStart`: `agent_id`, `agent_type`; `SubagentStop`: + `stop_hook_active`; `PreCompact`: `trigger`.
- **Common output:** `continue` (`false` stops the agent), `stopReason`, `systemMessage`.
- **Exit codes:** `0` = parse stdout; **`2` = "Treat stderr as a blocking error and provide it to the model"**; other = non-blocking warning. Most restrictive outcome wins.
- **`PreToolUse` output:** `hookSpecificOutput.permissionDecision` = **`allow` | `deny` | `ask`**, `permissionDecisionReason`, **`updatedInput`** (must match tool schema or is ignored), `additionalContext`. Multiple hooks: `deny` > `ask` > `allow`.
- **`PostToolUse`:** `decision: "block"`, `reason`, `additionalContext`. **`SessionStart` / `SubagentStart`:** `additionalContext`. **`Stop`:** `decision: "block"` + `reason` forces another turn (costs AI credits; check `stop_hook_active`). **`SubagentStop`:** `decision`, `reason`. `UserPromptSubmit` and `PreCompact`: common output only (so in Local, `UserPromptSubmit` can stop but not add context — inference from the table).
- **Matcher syntax:** not covered for native Local files.
- The approvals page confirms that in Local, a `false` terminal auto-approve rule does not block; blocking requires a `PreToolUse` hook returning `deny`. https://code.visualstudio.com/docs/agents/run/approvals (14 October 2026)

### 5c. Copilot harness (Copilot SDK / CLI hooks)

Source: https://docs.github.com/en/copilot/reference/hooks-reference (fetched 20 October 2026; no page date shown). The page names Copilot CLI and cloud agent as surfaces; VS Code's hooks page says the Copilot harness "uses the same SDK hook implementation as Copilot CLI". **Inference:** the Copilot harness in VS Code therefore reads the same locations; VS Code says to check that each event exists in your VS Code version.

- **Locations (combined, in order):** **policy hooks** `/etc/github-copilot/policy.d/*.json` (Linux/macOS), `C:\ProgramData\GitHub\Copilot\policy.d\*.json` (Windows) or `HKLM\Software\Policies\GitHub\Copilot` (admin-managed; load first; **cannot be disabled by `disableAllHooks`**; always run on the host, outside the sandbox); repo `.github/hooks/*.json`; user `~/.copilot/hooks/*.json` (`%USERPROFILE%\.copilot\hooks\`); inline `hooks` in `.github/copilot/settings.json`, `.github/copilot/settings.local.json`, `~/.copilot/settings.json`; **repo `.claude/settings.json` and `.claude/settings.local.json` are also read**; plugin `hooks.json`/`hooks/hooks.json`; agent-scoped (CLI only).
- **Format:** `{ "version": 1, "hooks": { ... } }`, optional `disableAllHooks`.
- **Types:** `command` (`bash`, `powershell`, `command` fallback, `cwd`, `env`, `timeoutSec` default 30, CLI-only `exec`+`args`), `http` (`url`, `headers`, `allowedEnvVars`; https required for `preToolUse`/`permissionRequest`), `prompt` (CLI only, `sessionStart`).
- **Events:** `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `userPromptTransformed`, `preToolUse`, `permissionRequest`, `postToolUse`, `postToolUseFailure`, `agentStop`, `subagentStart`, `subagentStop`, `errorOccurred`, `preCompact`, `notification` (types include `permission_prompt`, `elicitation_dialog`, `agent_completed`). camelCase or PascalCase; PascalCase switches to snake_case fields and Claude-style tool names (`Bash`, `Edit`).
- **Outputs:** `preToolUse`: `permissionDecision` (`allow`/`deny`/`ask`), `permissionDecisionReason` (required for deny), **`modifiedArgs`** (rewrite input). `permissionRequest`: `behavior` (`allow`/`deny`), `message`, `interrupt`. `postToolUse`: `modifiedResult`, `additionalContext` (10 KB cap). `agentStop`/`subagentStop`: `decision` (`block`/`allow`), `reason` (CLI ends the turn after 8 consecutive blocks). `sessionStart`/`subagentStart`: `additionalContext`. `userPromptSubmitted`: `modifiedPrompt` (SDK only). `notification`: `additionalContext`.
- **Exit codes:** `2` = deny for `preToolUse`/`permissionRequest` even if stdout says allow; **other non-zero on `preToolUse` fails closed (deny)**; **timeouts always fail open, including policy hooks**.
- **Matchers:** regex anchored `^(?:PATTERN)$` on tool name, notification type, trigger or agent name.
- **Tool names:** `bash`, `powershell` (Windows only), `view`, `create`, `edit`, `grep`, `glob`, `web_fetch`, `task`, `ask_user`.
- **Sandbox:** in sandboxed sessions, repo, user and plugin command hooks run inside the sandbox; policy hooks run on the host.

### 5d. Claude harness and Claude Code hook config

- Claude harness: VS Code points to the Claude Code hooks reference; it does not say which settings files the Claude harness loads. https://code.visualstudio.com/docs/agent-customization/hooks (14 October 2026)
- **Does VS Code read Claude Code hook configuration?** Local: yes, opt-in via `chat.useClaudeHooks` (off by default), matchers ignored. Copilot harness: the Copilot hooks reference says repo `.claude/settings.json` is read (documented for CLI). Claude harness: not documented.

### 5e. Hooks and enterprise policy

Source: https://code.visualstudio.com/docs/enterprise/manage-ai-settings (14 October 2026); https://code.visualstudio.com/docs/enterprise/policies (14 October 2026).

- `ChatHooks` (→ `chat.useHooks`) disables hooks, **Local harness only**.
- Copilot harness enforcement uses **Policy Hooks** (Copilot SDK); "Local harness sessions do not load them". "Hook config for one harness is not enforced in the other."
- `ChatAllowManagedHooksOnly`: hooks only from managed sources and policy force-enabled plugins. `ChatStrictPluginOnlyCustomization`: also blocks standalone user and workspace skills, agents, instructions and MCP servers.

### 5f. Windows

Local: `windows` override, example `powershell -File scripts\validate-tool.ps1`. Copilot: `powershell` field, and `powershell` is a Windows-only tool name. Policy hooks at `C:\ProgramData\GitHub\Copilot\policy.d\`. No other Windows caveat is documented.

## 6. MCP servers

Sources: https://code.visualstudio.com/docs/agents/reference/mcp-configuration (16 October 2026); https://code.visualstudio.com/docs/agent-customization/mcp-servers (16 October 2026).

- **Files:** VS Code format `.vscode/mcp.json` (workspace) or user-profile `mcp.json`, top-level `servers`. Portable format: workspace-root `.mcp.json` (top-level `mcpServers`; needs Experimental `chat.mcp.workspaceRootConfig.enabled`) and user `$COPILOT_HOME/mcp-config.json` / `~/.copilot/mcp-config.json`. Since 1.140 **MCP: Add Server** writes portable files and labels `.vscode/mcp.json` and user config **deprecated** (still read). https://code.visualstudio.com/updates/v1_140 (30 September 2026)
- **stdio fields:** `type`, `command`, `args`, `cwd`, `env`, `envFile`, `dev`, `sandboxEnabled`, `sandbox`. **HTTP/SSE:** `type`, `url`, `headers`, `oauth.clientId`. Inputs: `promptString`, `pickString`, `command` → `${input:id}`.
- **Harness differences:** Copilot harness reads the portable format; VS Code forwards eligible VS Code-format servers, except ones needing `${input:...}`.
- **Per-server sandbox (VS Code format):** **macOS and Linux only**; `sandboxEnabled: true`, `sandbox.allowWrite`, `sandbox.allowedDomains`, top-level `denyRead`/`denyWrite`/`deniedDomains`. "Tool confirmations are auto-approved when sandboxing is enabled." Per-server MCP sandboxing "is not available on Windows". https://code.visualstudio.com/docs/agents/run/agent-sandboxing (14 October 2026)
- **Session sandbox (Copilot harness):** `chat.agent.sandbox.mcpServers` (default `true`) sandboxes Agent Host-started MCP servers when sandboxing is on.
- **Trust:** workspace servers inherit Workspace Trust; **MCP: Reset Trust**. Tool controls: Copilot → **Chat: Open Customizations > Tools**; Local → **Configure Tools**. Discovery from other apps: `chat.mcp.discovery.enabled` (Copilot CLI on by default; Claude Desktop, Cursor, Windsurf off).
- **Status:** MCP gallery Preview; MCP Apps, Customization Marketplace and workspace-root `.mcp.json` Experimental.
- **VS Code device policies:** `ChatMCP` (`chat.mcp.access`; security page says values `registryOnly` or `off`), `ChatAllowedMcpServers`, `ChatDeniedMcpServers`, `ChatAllowManagedMcpServersOnly`, `McpGalleryServiceUrl`, `McpEnterpriseManagedAuthIdp`. https://code.visualstudio.com/docs/enterprise/policies (14 October 2026); https://code.visualstudio.com/docs/agents/run/security (14 October 2026)
- **GitHub policy:** "MCP servers in Copilot" policy is "disabled by default" and applies only to Business/Enterprise seats. https://docs.github.com/en/copilot/concepts/context/mcp (no date shown). Recommended allowlist: `allowedMcpServers`/`deniedMcpServers` in managed settings (GA; users cannot override); custom registry allowlist is public preview, "not prioritized for development", and users can bypass it by editing config. https://docs.github.com/en/copilot/concepts/enterprise/mcp-management (no date shown)

## 7. Tool approval and safety

Sources: https://code.visualstudio.com/docs/agents/run/approvals (14 October 2026); https://code.visualstudio.com/docs/agents/reference/ai-settings (14 October 2026); https://code.visualstudio.com/docs/agents/run/security (14 October 2026).

- **Permission levels** (`chat.permissions.default`, Experimental): **Manual** (default), **Assisted** (Experimental; an LLM judge reviews each call; `chat.assistedPermissions.enabled` off in Stable; needs Folder isolation; not in Local), **Allow all**, **Autopilot** (agent mode in Copilot harness, a permission level in Local). Claude harness modes: Edit automatically, Request approval, Plan. Codex presets: Default Permissions, Auto-Review, Full Access.
- **Worktree sessions always use Allow all** and offer no manual approval prompts. https://code.visualstudio.com/docs/agents/run/agents-window (14 October 2026)
- **Global "YOLO":** `chat.tools.global.autoApprove` (default `false`; "disables critical security protections"); `/yolo` or `/autoApprove` for one session.
- **Per-tool:** `chat.tools.eligibleForAutoApproval` (Experimental) removes the auto-approve option for named tools. **Chat: Manage Tool Approval**, **Chat: Reset Tool Confirmations**.
- **Terminal:** `chat.tools.terminal.autoApprove` rules (`true`/`false`, `/regex/`, `matchCommandLine`); default denies `rm`, `rmdir`, `del`, `kill`, `curl`, `wget`, `eval`, `chmod`, `chown`, `Remove-Item`. Compound commands need every part to match. **"a best-effort convenience, not a security boundary."** `chat.tools.terminal.blockDetectedFileWrites` default `outsideWorkspace` (Experimental). `chat.tools.terminal.enableAutoApprove` toggles rule-based approval.
- **Edits:** `chat.tools.edits.autoApprove` glob map (e.g. `"**/.env": false`); default listed as `{}` and the security page lists no default sensitive patterns. Built-in tools read and write only inside the workspace; extra read-only folders via `chat.additionalReadAccessFolders` / `github.copilot.chat.additionalReadAccessFolders`.
- **URLs:** two-step (request, then response review); Trusted Domains skip the request step; `chat.tools.urls.autoApprove` takes URLs/globs with `true` or `{approveRequest, approveResponse}`.
- **Terminal sandbox (Copilot harness):** `chat.agent.sandbox.enabled` (default `"off"`); sandboxes terminal commands and children, plus MCP/LSP servers it starts; "not a VM or user-account boundary"; works independently of the permission level (still applies under Allow all). Outbound network **allowed by default** (`network.allowNetwork: true`); `allowUnsandboxedCommands` default `true`. OS: **macOS no prerequisites; Linux/WSL2 need `bubblewrap` and `socat`; Windows needs the 8 September 2026 security update (KB5124008 / KB5124012) and is Experimental.** https://code.visualstudio.com/docs/agents/run/agent-sandboxing (14 October 2026). Approvals page: Preview on macOS, Linux, WSL2; Experimental on Windows.
  - **Disagreement:** the GitHub changelog says local sandboxing became **generally available** on 7 October 2026 for Copilot CLI, the Copilot app and "VS Code sessions using Agent Host", on Windows, macOS and Linux (MXC). https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available (7 October 2026). The VS Code docs (14 October 2026) still call Windows Experimental and managed enforcement Preview.
  - Local harness: sandboxes terminal commands on macOS and Linux only; **Windows sandboxing for Local is deprecated in 1.142**. 1.141 notes had said sandboxing was "Available on Windows, macOS, and Linux". https://code.visualstudio.com/updates/v1_142 (14 October 2026); https://code.visualstudio.com/updates/v1_141 (7 October 2026)
- **Workspace Trust:** "Restricted mode disables agents in that workspace"; workspace MCP config and hook files inherit trust; agent-scoped hooks need a trusted workspace.
- **Locking settings (three layers)** — https://code.visualstudio.com/docs/enterprise/manage-ai-settings (14 October 2026):
  1. **VS Code device policies** (Group Policy/ADMX → `Software\Policies\Microsoft\VSCode`; macOS `.mobileconfig`; Linux `/etc/vscode/policy.json`). "Override the corresponding user settings". Relevant: `ChatAgentMode`, `ChatToolsAutoApprove`, `ChatToolsEligibleForAutoApproval`, `ChatToolsTerminalEnableAutoApprove`, `ChatAgentExtensionTools`, `ChatHooks`, `ChatAllowManagedHooksOnly`, `ChatStrictPluginOnlyCustomization`, `ChatPluginsEnabled`, `ChatEnabledPlugins`, `ChatStrictMarketplaces`, `Claude3PIntegration`, `Codex3PIntegration`, MCP policies, `AllowedExtensions`, network filter policies; sandbox device policies are **deprecated** and do not enforce for Copilot harness. https://code.visualstudio.com/docs/enterprise/policies (14 October 2026)
  2. **Copilot enterprise-managed settings** (cross-client; win over device policies for the same control). Keys: `permissions.allow`/`ask`/`deny` (rules `Shell(git push *)`, `Read(...)`, `Edit(...)`, `Domain(...)`; deny > ask > allow; deny from any source blocks), `permissions.disableBypassPermissionsMode: "disable"`, `permissions.disableAssistedPermissionsMode`, `permissions.defaultMode`, `sandbox` (`enabled`, `failIfUnavailable`, `allowBypass`, `sandboxMcpServers`, `userPolicy.filesystem/network`…; VS Code 1.141+), `enabledPlugins`, `strictKnownMarketplaces`, `allowedMcpServers`, `deniedMcpServers`, `forceRemoteSettingsRefresh` (fail closed), `remoteControl`. https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings (no date shown); https://github.blog/changelog/2026-10-13-enterprise-managed-settings-enforcement-updates (13 October 2026). Delivery: server-managed (`.github-private` repo `copilot/managed-settings.json`, enterprise-licensed users only); MDM (Windows `HKLM\SOFTWARE\Policies\GitHubCopilot`, macOS `com.github.copilot` managed prefs, no Linux); **file-based** (Windows `%ProgramFiles%\GitHubCopilot\managed-settings.json`, macOS `/Library/Application Support/GitHubCopilot/managed-settings.json`, Linux `/etc/github-copilot/managed-settings.json`). **MDM and file-based apply "regardless of license source"** (so they work for a Pro user too); CLI requires root-owned, non-writable, non-symlink file on macOS/Linux. https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/deploy-managed-settings (no date shown)
  3. **GitHub org/enterprise policy** (follows the account): access, models, content exclusions, MCP policy, cloud agent and partner agents.
  - Important: permission and sandbox managed settings are enforced by the **Copilot harness**; Local "does not enforce runtime-only sandbox and permission rules". Assisted permissions is not yet compatible with `permissions.allow/ask/deny`. Legacy `ChatToolsAutoApprove: false` still blocks Allow All and Assisted. https://code.visualstudio.com/updates/v1_142 (14 October 2026)

## 8. Background and parallel agents, sessions, programmatic start

- **Sessions view / Agents window:** dedicated window to run and monitor many sessions; open with **Chat: Open Agents window**, `code --agents`, Windows taskbar jump list, or a browser (insiders.vscode.dev/agents). Isolation: Folder, **New Worktree** (Allow-all only), Dev Container (Experimental, desktop), Quick chats, Cloud (GitHub repos only). Grid layouts, peer chats, side chats, read-only subagent chats. https://code.visualstudio.com/docs/agents/run/agents-window (14 October 2026)
- **Session types:** Local (editor only), Copilot (multiple chats, worktrees, forking; continues after the window closes), Claude (multiple chats and side chats), Codex, Copilot CLI (terminal; Copilot harness sessions resumable in terminal), Cloud. Copilot CLI and Copilot app sessions appear automatically ("Created Externally"). https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions (14 October 2026); https://code.visualstudio.com/updates/v1_141 (7 October 2026)
- **Worktrees:** from committed state; need ≥1 commit; archiving commits leftovers to the session branch; **Chat: Open Worktree Cleanup** (1.141); `git.worktreeSymlinkFolders` (Experimental, 1.140).
- **Cloud agent delegation:** `/delegate` from Copilot; Session Target dropdown hands off from Local to Copilot, Claude, Codex or Cloud. https://code.visualstudio.com/docs/agents/run/agent-harnesses (14 October 2026)
- **Claude in VS Code:** VS Code hosts the **Claude Agent SDK** as the Claude harness, enabled by default (`github.copilot.chat.claudeAgent.enabled`; policy `Claude3PIntegration`). Needs a Copilot subscription or BYOK; signed-out use with `ANTHROPIC_API_KEY` (env or `~/.claude/settings.json` `env`) is Experimental. The SDK is **downloaded on first need** (no Claude Code install documented as required). `github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions` default `false`. https://code.visualstudio.com/docs/agents/run/agent-harnesses (14 October 2026); https://code.visualstudio.com/updates/v1_138 (16 September 2026); https://code.visualstudio.com/docs/agents/reference/ai-settings (14 October 2026). Third-party agents are "public preview" in the plans table. https://docs.github.com/en/copilot/get-started/plans (no date shown)
- **Codex:** OpenAI Codex extension (`openai.chatgpt`) or Agent Host integration (`chat.agentHost.codexAgent.enabled`, Experimental); Copilot Pro+ or ChatGPT account.
- **Subagents in parallel:** not documented for Local; provider-native in other harnesses.
- **Programmatic start:**
  - `vscode://agents/new?prompt=...&workspace=...` opens a draft session in the Agents window; **does not submit**; keeps an existing draft. https://code.visualstudio.com/docs/configure/command-line (14 October 2026); https://code.visualstudio.com/updates/v1_140 (30 September 2026)
  - `code chat "<prompt>"` with `-m/--mode` (`ask`/`edit`/`agent`/custom agent), `-a/--add-file`, `--maximize`, `-r`, `-n`; stdin with `-`. Same source.
  - `workbench.action.chat.open` arguments: **not documented** on any page I found.
  - Agents can create sessions and chats via built-in session-management tools (limits: `chat.agentHost.agentOrchestrationLimits`). https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions (14 October 2026)
- **Session to session messaging:** yes, in Copilot or Claude harness (and Experimental Codex): `send_message` to another session or chat; **sending always requires the user's confirmation**; can't message itself; bursts capped; queued, does not interrupt the active turn. Same source; https://code.visualstudio.com/updates/v1_141 (7 October 2026); https://code.visualstudio.com/updates/v1_137 (9 September 2026). Remote delegation tools `list_agent_hosts`, `create_remote_session`, `get_remote_session`, `send_remote_message` (Experimental, off by default). https://code.visualstudio.com/updates/v1_140 (30 September 2026)
- **Automations (Preview):** scheduled agent tasks hourly/daily/weekly; `chat.automations.enabled` (enabled by default as of 1.138). https://code.visualstudio.com/updates/v1_137 (9 September 2026); https://code.visualstudio.com/updates/v1_138 (16 September 2026)

## 9. Notifications

- `chat.notifyWindowOnConfirmation` and `chat.notifyWindowOnResponseReceived` — both default `"windowNotFocused"`; alert when a session needs input or finishes; each notification links back to the session. https://code.visualstudio.com/docs/agents/reference/ai-settings (14 October 2026); https://code.visualstudio.com/updates/v1_136 (2 September 2026). OS toast introduced in 1.103; `always` value added in 1.110 (search result summaries of https://code.visualstudio.com/updates/v1_103 and https://code.visualstudio.com/updates/v1_110; not re-read in full).
- Accessibility signals: `accessibility.signals.chatRequestSent`, `chatResponseReceived`, `chatUserActionRequired` (sound/announcement `auto`); `accessibility.signals.confetti` (1.140). https://code.visualstudio.com/docs/agents/reference/ai-settings (14 October 2026)
- App badge (Preview): `sessions.showApplicationBadge` (default `true` Insiders, `false` Stable) on dock/launcher/taskbar for new results, input requests, failing PR checks. Command-centre status `chat.agentsControl.enabled` (Experimental). https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions (14 October 2026); https://code.visualstudio.com/updates/v1_138 (16 September 2026)
- Phone: GitHub Mobile live notifications for **remote Copilot CLI sessions** (in progress, **waiting for user input**, idle, finished). https://github.blog/changelog/2026-07-08-github-mobile-live-notifications-for-copilot-cli-sessions/ (8 July 2026). For cloud agent: in progress, completed, failed, cancelled (no needs-input state). https://github.blog/changelog/2026-02-26-github-mobile-track-coding-agent-progress-in-real-time-with-live-notifications/ (26 February 2026). Not documented for VS Code Local or Agent Host sessions.
- Copilot hook `notification` event (types `permission_prompt`, `elicitation_dialog`, `agent_completed`, `shell_completed`) could drive a custom push; it does not fire on cloud agent. https://docs.github.com/en/copilot/reference/hooks-reference

## 10. Clickable questions

- Tool `#vscode/askQuestions`: "Ask clarifying questions with interactive controls." https://code.visualstudio.com/docs/agents/reference/tools-reference (14 October 2026)
- History (search summaries of release notes): introduced in 1.109 as experimental (`chat.askQuestions.enabled`) with single/multi-select options, free text and a highlighted recommended answer; moved into core in 1.110 and works in subagents; reused for MCP elicitation (1.112) and terminal prompts (1.116, 1.118); Agents window box (1.127). https://code.visualstudio.com/updates/v1_109, https://code.visualstudio.com/updates/v1_110 (not re-read in full).
- Not available to Local subagents. https://code.visualstudio.com/docs/agents/run/subagents (14 October 2026)
- Copilot harness equivalent: tool name `ask_user`. https://docs.github.com/en/copilot/reference/hooks-reference
- **Can a hook see the answer?** Not documented. **Inference:** since `ask_user` and `askQuestions` are tools, `PostToolUse`/`postToolUse` should receive the tool result (the answer) and `PreToolUse` the questions; verify in the agent debug logs (Local docs say tool names and schemas vary).

## 11. Extension API and plugins

- **Language Model Tools:** `vscode.lm.registerTool` plus `contributes.languageModelTools` (`name`, `displayName`, `modelDescription`, `userDescription`, `canBeReferencedInPrompt`, `toolReferenceName`, `icon`, `inputSchema`, `when`, `tags`); `prepareInvocation` returns `invocationMessage` / `confirmationMessages`. https://code.visualstudio.com/api/extension-guides/ai/tools (14 October 2026). Extension tools work only in chats in a window where the extension runs; Copilot-harness tools from the client vanish when it disconnects. https://code.visualstudio.com/docs/agents/concepts/agent-host (14 October 2026); https://code.visualstudio.com/docs/agents/run/tools (14 October 2026). Policy `ChatAgentExtensionTools` can switch them off.
- **Contribution points:** `chatAgents` (`path`, `when`, `sessionTypes`), `chatInstructions`, `chatPromptFiles`, `chatSkills` (each `path`, `when`), `languageModelTools`, `languageModelChatProviders`; none marked proposed. https://code.visualstudio.com/api/references/contribution-points (14 October 2026)
- **Chat participants:** `vscode.chat.createChatParticipant`; no statement on Copilot-harness support. https://code.visualstudio.com/api/extension-guides/ai/chat (14 October 2026). A chat-sessions provider API is not documented on these pages.
- **Agent plugins (yes, they exist):** installable bundles of skills, MCP servers, custom agents, hooks, automation templates and slash commands. VS Code supports **Copilot, Claude and legacy OpenPlugin formats** plus "Agent Plugins 1.0" (open standard). Install from the Marketplace (`@agentPlugins` in Extensions view), **Chat: Install Plugin From Source** (git URL), local folders (`chat.pluginLocations`, Experimental); Copilot CLI's `~/.copilot/installed-plugins/` are picked up. Marketplaces: `owner/repo`, HTTPS/SSH git, `file:///`; defaults `github/copilot-plugins`, `github/awesome-copilot`. Workspaces can recommend via `extraKnownMarketplaces` and `enabledPlugins` in `.claude/settings.json` or `.github/copilot/settings.json`. Trust prompt on first install from a new marketplace. `/plugin` commands in Copilot harness. https://code.visualstudio.com/docs/agent-customization/agent-plugins (14 October 2026)
  - **`chat.plugins.enabled` default `false`**; `chat.plugins.marketplaces`, `chat.plugins.strictMarketplaces`, `chat.pluginLocations` Experimental. https://code.visualstudio.com/docs/agents/reference/ai-settings (14 October 2026)
  - Manifest detection: root `plugin.json` with `$schema` (Agent Plugins 1.0), root `plugin.json` (Copilot), **`.claude-plugin/plugin.json` (Claude)**, `.plugin/plugin.json` (OpenPlugin). Hooks: `hooks/hooks.json` (Claude), `hooks.json` (Copilot), `com.github.copilot/hooks/hooks.json` (1.0). MCP: `.mcp.json` / `mcp.json`. `${CLAUDE_PLUGIN_ROOT}` (Claude, Copilot), `${PLUGIN_ROOT}`, `${PLUGIN_DATA}` (1.0) expanded in MCP fields and hook commands. Local ignores Claude matcher values. Under `allowManagedHooksOnly`, plugin hooks run only if managed settings force-enable the plugin. No Windows notes. https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference (16 October 2026)
  - Policies: `ChatPluginsEnabled`, `ChatEnabledPlugins` (`{plugin}@{marketplace}`), `ChatExtraMarketplaces`, `ChatStrictMarketplaces`. https://code.visualstudio.com/docs/enterprise/policies (14 October 2026)
- **Dashboard surfaces:** webviews and status bar are standard extension API (not re-checked). New: **Canvases (Preview)**, `chat.canvases.enabled`, interactive panes beside chat for local Copilot-harness sessions, delivered as canvas extensions or via a chat plugin; `/create-canvas`. https://code.visualstudio.com/updates/v1_142 (14 October 2026)

## 12. Models, billing, usage

- **Billing is now usage-based "GitHub AI Credits"** (from 1 June 2026; token-metered at API rates; completions and NES excluded). https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/ (27 April 2026). 1 AI credit = US$0.01 (search summary of https://docs.github.com/en/rest/billing/usage).
- **Plans:** Free (allowance; Auto model only; no cloud agent; no third-party agents), Pro $10 (1,500 credits), Pro+ $39 (7,000), Business $19/seat (1,900/user), Enterprise $39/seat (3,900/user); also Student and Max. Third-party agents (public preview) in Pro, Pro+, Max, Business and Enterprise. https://docs.github.com/en/copilot/get-started/plans (no date shown)
- **Claude models:** several current Anthropic models are offered in Copilot, with long-context options in VS Code and the CLI, and older ones retired on a published schedule. https://docs.github.com/en/copilot/reference/ai-models/supported-models (no date shown); model retirements in the changelog index https://github.blog/changelog/ (October 2026).
- **Usage readable programmatically:** REST `GET /users/{username}/settings/billing/ai_credit/usage` (personal plan; fine-grained token "Plan" read), `/organizations/{org}/...`, `/enterprises/{enterprise}/...`; summarised only; detailed per-user report is web-only. https://docs.github.com/en/rest/billing/usage (search summary, no date). `chat.subagents.showCreditUsage` shows subagent credit use in VS Code. https://code.visualstudio.com/docs/agents/run/subagents (14 October 2026)

## 13. Plan restrictions and default-off items for Business/Enterprise

- "MCP servers in Copilot" policy: **disabled by default**; applies only to Business/Enterprise. https://docs.github.com/en/copilot/concepts/context/mcp
- **Editor preview features** policy: must be enabled by the org for preview editor features; preview features are excluded from the new default-on policy. https://docs.github.com/en/copilot/concepts/enterprise/default-availability (effective date 22 October 2026)
- From **22 October 2026**, unconfigured GA features default to enabled unless the enterprise changes "Default policy for new features". Same source.
- Partner agents (Claude, Codex) for cloud need enterprise and org toggles (Settings > Copilot > Cloud agent > Partner agents); these do not govern local VS Code agents. https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents (search summary)
- Voice Mode not available with Business or Enterprise. https://code.visualstudio.com/updates/v1_137 (9 September 2026)
- `ChatApprovedAccountOrganizations` can keep AI off until an approved org account signs in (fail closed). https://code.visualstudio.com/docs/enterprise/manage-ai-settings (14 October 2026)

## 14. What a safety layer can and cannot enforce (analysis)

**Can enforce**
- **Deny tool calls with hooks**, in both main harnesses: Local `PreToolUse` → `permissionDecision: "deny"` or exit 2; Copilot `preToolUse` → `deny`, exit 2, or any other non-zero exit (fails closed). Hooks can also rewrite input (`updatedInput` / `modifiedArgs`), add context, block `Stop` to force another turn, and stop the session (`continue: false`).
- **One Node.js script per event works on macOS and Windows** (`command` plus `windows`/`osx` in Local; `command` or `bash`/`powershell` in Copilot).
- **Tamper-resistant hooks via Copilot policy hooks** in `policy.d` (cannot be disabled by `disableAllHooks`; run on the host outside the sandbox). Needs admin rights to write the file.
- **Locked permissions via file-based managed settings** (`/Library/Application Support/GitHubCopilot/managed-settings.json`, `%ProgramFiles%\GitHubCopilot\managed-settings.json`): `permissions.deny`, `disableBypassPermissionsMode`, `sandbox.enabled` + `allowBypass: false`, `deniedMcpServers`, `enabledPlugins`. Applies regardless of licence source. Needs admin rights.
- **VS Code device policies** lock YOLO off (`ChatToolsAutoApprove`), terminal auto-approve, plugins and marketplaces, managed-only hooks, and Claude/Codex.

**Cannot, or only partly**
- **Hook timeouts fail open** in Copilot, policy hooks included. In Local, exit codes other than 0 and 2 are only warnings, so a crashing Local hook allows the call.
- **Local reads Claude-format hooks only if `chat.useClaudeHooks` is on (off by default), and ignores matchers.** Claude Code `.claude/settings.json` hooks do not carry over as-is.
- **Hooks are per harness.** `ChatHooks` and Local hooks do not reach Copilot-harness sessions, and Copilot policy hooks do not load in Local. The Claude harness's hook loading is not documented.
- **Worktree sessions force Allow all.** Only hooks and the sandbox stand between the agent and the machine there.
- **Terminal auto-approve rules are not a security boundary,** and in Local a `false` rule does not block.
- **The sandbox is not a VM boundary.** It allows outbound network by default and is Experimental on Windows. Per-server MCP sandboxing is not available on Windows. Local-harness Windows sandboxing is deprecated.
- **Locking anything needs admin rights** (HKLM, ProgramData, ProgramFiles, root-owned files) or MDM, which matters on a Windows computer without admin rights. Without admin, settings stay user-editable: hooks in `.github/hooks` and `~/.copilot/hooks` can be edited or switched off by the user or by the agent itself, unless edits to those paths are denied.
- **Session-to-session messages always need user confirmation,** and `vscode://agents/new` does not submit its prompt. Fully unattended orchestration from outside is not documented.
