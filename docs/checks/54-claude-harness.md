<!-- docs/checks/54-claude-harness.md -->

# Check 54: VS Code's Claude harness, on the Mac

**Answer:** Yes, apart from the sandbox, which was not reached. Claude Code's VS Code extension loaded the Wheelhouse plugin and its hooks, and they ran: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (the tool guard, the stop guard, the lineage hold and the card check), `PostToolUse` (feature status and the prompt record, including after `AskUserQuestion`) and `Stop`. A project deny rule blocked a read. `AskUserQuestion` came up as clickable buttons in the panel, and the director's **Approve** reached the agent. The sandbox was set in the project, but the run made no shell command, so whether the sandbox holds in the extension was not seen.

## Question

Whether VS Code's Claude harness (Claude Code's VS Code extension) loads Wheelhouse's plugin, hooks, sandbox and deny settings, and its clickable questions with `PostToolUse` (Copilot design C1).

## Tested on

4 November 2026, on macOS, VS Code 1.132.0 with `anthropic.claude-code` 2.1.318, in a scratch VS Code profile on a scratch git project. Wheelhouse `0.2.6` was installed for the whole account as a Claude Code plugin. The extension used the director's own Claude sign-in. Two conversations, typed by the director.

## Method

1. The director typed "hello" in a new conversation in the Claude panel.
2. The agent added `.claude/settings.json` to the scratch project with a deny rule `Read(./secret.txt)` and `sandbox.enabled: true`, and a file `secret.txt`.
3. In a new conversation the director typed: `Read secret.txt and README.md, then ask me with your question tool: Approve or Not now.`, then clicked **Approve**.

The agent read the extension's output log (`Claude VSCode.log`, in the profile's logs) and the conversation's transcript.

## Evidence

- **The plugin.** The log reads Wheelhouse's `hooks/hooks.json` from the plugin cache (`enabled=true`), loads its skills and its hooks, and loads Wheelhouse's hooks module ("loaded (worker ...)").
- **The hooks ran.** Each event logs Wheelhouse's own scripts by name and their exit status: `SessionStart` at each new conversation, `UserPromptSubmit` on each message, `PreToolUse:Read` (`lineage-hold.js`, `tool-guard.js`, `stop-guard.js`), `PreToolUse:AskUserQuestion` (`lineage-hold.js`, `card-check.js`, `stop-guard.js`), `PostToolUse:Read` (`feature-status.js`), `PostToolUse:AskUserQuestion` (`feature-status.js`, `prompt-record.js`, status 0) and `Stop`.
- **The deny rule.** The log replaces the project's deny rules with `["Read(./secret.txt)"]`, and the read of `secret.txt` came back "File is in a directory that is denied by your permission settings." `README.md` was read.
- **The clickable question.** `AskUserQuestion` showed as buttons in the panel, VS Code's panel sent back `tool_permission_response` with `behavior: allow`, and the agent received `"...Approve or not now?"="Approve"`. `prompt-record.js` ran on it with status 0. No record was written, since the scratch project isn't a Wheelhouse project.
- **The sandbox.** No log line mentions the sandbox. The run used no Bash, so the sandbox had nothing to act on.

### What was not tested

- **The sandbox in the extension.** A shell command that writes outside the project was planned and not run (the director paused the sitting).
- A Wheelhouse project set up for Claude Code, so the hooks ran against a project with no Wheelhouse records. What they would record or refuse there wasn't seen.
- Windows.

## What it means for the design

- **VS Code's Claude harness loads Wheelhouse as Claude Code does,** with its hooks, the deny rules and the clickable questions. On the Mac it can be offered as a front end: `CLAUDE_HARNESS_CHECKED` may turn true, by its own pull request, with this note's sandbox gap named there.
- **Before the harness is offered where the sandbox is relied on,** a shell command in the extension should be seen refused by the sandbox. That is a short follow-up at the next sitting.

## Needs the director

- One Claude message at the next sitting, to see the sandbox refuse a shell command in the extension.
