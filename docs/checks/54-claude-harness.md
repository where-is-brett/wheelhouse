<!-- docs/checks/54-claude-harness.md -->

# Check 54: VS Code's Claude harness, on the Mac

**Answer:** Yes, on the Mac. Claude Code's VS Code extension loaded the Wheelhouse plugin and its hooks, and they ran: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (the tool guard, the stop guard, the lineage hold and the card check), `PostToolUse` (feature status and the prompt record, including after `AskUserQuestion`) and `Stop`. A project deny rule blocked a read. `AskUserQuestion` came up as clickable buttons in the panel, and the director's **Approve** reached the agent. The project's sandbox held: a shell command writing outside the project was refused.

## Question

Whether VS Code's Claude harness (Claude Code's VS Code extension) loads Wheelhouse's plugin, hooks, sandbox and deny settings, and its clickable questions with `PostToolUse` (Copilot design C1).

## Tested on

4 November 2026, on macOS, VS Code 1.132.0 with `anthropic.claude-code` 2.1.318, in a scratch VS Code profile on a scratch git project. Wheelhouse `0.2.6` was installed for the whole account as a Claude Code plugin. The extension used the director's own Claude sign-in. Two conversations typed by the director, and a third sent by the agent after a VS Code update to 1.144.1.

## Method

1. The director typed "hello" in a new conversation in the Claude panel.
2. The agent added `.claude/settings.json` to the scratch project with a deny rule `Read(./secret.txt)` and `sandbox.enabled: true`, and a file `secret.txt`.
3. In a new conversation the director typed: `Read secret.txt and README.md, then ask me with your question tool: Approve or Not now.`, then clicked **Approve**.
4. The agent opened a new conversation with `Run this one shell command and tell me exactly what it printed: touch ~/wheelhouse-sandbox-probe && echo made` (through a scratch extension that runs `claude-vscode.editor.open`) and sent it. The first try failed with the Mac's network down (`ENOTFOUND`); it was sent again after a restart.

The agent read the extension's output log (`Claude VSCode.log`, in the profile's logs) and the conversation's transcript.

## Evidence

- **The plugin.** The log reads Wheelhouse's `hooks/hooks.json` from the plugin cache (`enabled=true`), loads its skills and its hooks, and loads Wheelhouse's hooks module ("loaded (worker ...)").
- **The hooks ran.** Each event logs Wheelhouse's own scripts by name and their exit status: `SessionStart` at each new conversation, `UserPromptSubmit` on each message, `PreToolUse:Read` (`lineage-hold.js`, `tool-guard.js`, `stop-guard.js`), `PreToolUse:AskUserQuestion` (`lineage-hold.js`, `card-check.js`, `stop-guard.js`), `PostToolUse:Read` (`feature-status.js`), `PostToolUse:AskUserQuestion` (`feature-status.js`, `prompt-record.js`, status 0) and `Stop`.
- **The deny rule.** The log replaces the project's deny rules with `["Read(./secret.txt)"]`, and the read of `secret.txt` came back "File is in a directory that is denied by your permission settings." `README.md` was read.
- **The clickable question.** `AskUserQuestion` showed as buttons in the panel, VS Code's panel sent back `tool_permission_response` with `behavior: allow`, and the agent received `"...Approve or not now?"="Approve"`. `prompt-record.js` ran on it with status 0. No record was written, since the scratch project isn't a Wheelhouse project.
- **The sandbox.** The command came back `touch: ~/wheelhouse-sandbox-probe: Operation not permitted`, exit code 1, and `made` was not printed. The file was not made. The agent said it did not retry outside the sandbox.

### What was not tested

- A Wheelhouse project set up for Claude Code, so the hooks ran against a project with no Wheelhouse records. What they would record or refuse there wasn't seen.
- Windows.

## What it means for the design

- **VS Code's Claude harness loads Wheelhouse as Claude Code does,** with its hooks, the deny rules and the clickable questions. On the Mac it can be offered as a front end: `CLAUDE_HARNESS_CHECKED` turned true in #313.
- **The sandbox holds in the extension,** so the harness can be offered where the sandbox is relied on.

## Needs the director

- Nothing on the Mac. The Windows half is for the work laptop.
