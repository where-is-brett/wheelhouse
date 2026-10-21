<!-- docs/checks/58-hook-input.md -->

# Check 58: what a Copilot guard is given, and how its answer lands

**Answer:** Partly. A `preToolUse` guard gets the tool's name and arguments, the session id and the folder, and nothing about the permission mode, a sandbox or the runtime's version in its input. A deny answer, an exit 1 and an exit 2 each stop the tool call, and a hook that runs past its `timeoutSec` is let through. But the tool names are not the ones the plan assumed (file edits and creates arrive as `apply_patch`, searches as `rg`), and `ask_user`, `edit`, `create` and PowerShell were not seen at all.

## Question

What a Copilot guard is given and how its answer lands, for every tool: the tool names and argument names for shell, PowerShell, view, edit, create, grep, glob, web fetch, `task`, `ask_user` and an MCP tool; whether camelCase registration (`preToolUse`) and PascalCase registration (`PreToolUse`) give different payloads; whether the input says the permission mode, whether the session or the command is sandboxed, and the runtime's version; and what a deny answer, a non-zero exit, an exit 2 and a hook that sleeps past `timeoutSec` each do.

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. One model was in use throughout. Seven real model runs by `probes/58-hook-input/run.js`, all exit 0. The raw results are kept with the build's working papers, not in the repository. `pwsh` is not installed on this Mac, so PowerShell was not tried.

## Method

`node probes/58-hook-input/run.js`. One small hook (`probes/58-hook-input/guard.js`) is registered in the scratch home's hook folder, three ways: a flat file with camelCase events, a flat file with PascalCase events, and Claude Code's nested form with PascalCase events. It logs everything it is given, on `sessionStart`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStart` and `subagentStop`. Every run uses `--allow-all-tools`, `--trust-folder` and `--no-ask-user` (except the `ask_user` run), in a scratch project with a `README.md` holding a random secret word. A stand-in MCP server (`probes/58-hook-input/mcp.js`, one tool `echo`) and a custom agent `probe-agent` are set up in the scratch home.

1. `all-tools`: one prompt asking for each tool once. Then `gap-fill` (a prompt for the tools not seen) and `ask-user` (a prompt for `ask_user` alone, run without `--no-ask-user`).
2. Four runs where only the camelCase `preToolUse` hook acts, on a prompt asking the session to view `README.md` and create `out.txt`: `deny-view` (answers `{"permissionDecision":"deny","permissionDecisionReason":...}` for `view`), `exit-1`, `exit-2`, and `sleep` (`timeoutSec: 5`, sleeps 10 seconds). Whether a call went through is read from the tool events in Copilot's own output (`tool.execution_complete` with `success` and `error`), and from the file system.

**Undo.** The probe made only temporary folders (a Copilot home, a scratch project, a work folder) and removed them when it ended. The one thing left is the results file in `<temporary folder>/wheelhouse-probe-results/`, which can be deleted. Nothing needs undoing by hand.

## Evidence

### The tools and their arguments

Names as the camelCase hook sees them, then as the PascalCase hook sees them. The arguments (`toolArgs` and `tool_input`) are the same object in both. Fixtures for every row are in `tests/fixtures/copilot/hook-input/`.

| What was asked | camelCase `toolName` | PascalCase `tool_name` | Arguments |
| --- | --- | --- | --- |
| Shell | `bash` | `Bash` | `command`, `description`, `mode`, `initial_wait` |
| View | `view` | `Read` | `path` |
| Search | `rg` (asked for grep) | `Grep` | `pattern`, `paths`, `output_mode`, `head_limit` |
| Glob | `glob` | `Glob` | `pattern`, `paths` |
| Web fetch | `web_fetch` | `WebFetch` | `url`, `max_length` |
| `task` with a custom agent | `task` | `Agent` | `description`, `prompt`, `agent_type`, `name`, `mode` |
| MCP tool `echo` of server `probe58` | `probe58-echo` | `probe58-echo` | `text` (the tool's own arguments) |
| Edit and create | `apply_patch` | `Edit` | a string: the patch (`*** Begin Patch`, `*** Add File: <path>` ...), not an object |
| PowerShell | not tried | not tried | |
| `ask_user` | never offered | never offered | |

- **Edit and create.** With this model the session said it had no `edit` or `create` tool, in the first run, the gap-fill and the extra runs. File changes (the new file, and the edit) went through `apply_patch` alone. A guard that watches for `edit` and `create` would watch for nothing. Which tools a session has may depend on the model; this was one model.
- **`ask_user`.** In the run made without `--no-ask-user` the session said the tool "isn't available in this session". So it was not triggered headlessly (`-p`), and no hook input was seen for it.
- **Web fetch to the local stand-in page** was refused by Copilot itself ("resolves to blocked address 127.0.0.1"), after the `preToolUse` hook had run; the hook then received a `postToolUseFailure` with an `error` field. A local page cannot be fetched; a real address would be needed for a success.
- **MCP.** The name is `<server>-<tool>`, with no prefix and no change under PascalCase.
- **`postToolUse`** adds the result: `toolResult` (`resultType`, `textResultForLlm`) in camelCase, `tool_result` (`result_type`, `text_result_for_llm`) in PascalCase.

### CamelCase and PascalCase registrations

The same file shape registered under `PreToolUse` and under the nested Claude form gave identical payloads. They differ from the camelCase one in:

- key names: `hook_event_name`, `session_id`, `tool_name`, `tool_input`, `tool_result` against `sessionId`, `toolName`, `toolArgs`, `toolResult`; the timestamp is an ISO string, not a number of milliseconds;
- built-in tool names, as the table shows (`Bash`, `Read`, `Grep`, `Glob`, `WebFetch`, `Agent`, `Edit`);
- `SubagentStart` kept the camelCase keys even under the PascalCase name (`sessionId`, `agentName`, `transcriptPath` ...) and has no `hook_event_name`.

Both payloads carry `cwd`, the session id and the timestamp, and `sessionStart` adds `source` and `initialPrompt`. Registered both ways, every tool call ran the hook once in each registration, so a hook registered under both spellings runs twice.

### Mode, sandbox and version

No input field names the permission mode, a sandbox or a version. The hook's environment has `COPILOT_CLI=1`, `COPILOT_CLI_BINARY_VERSION=1.0.101`, `COPILOT_HOME`, `COPILOT_HOOK_DIR` and `COPILOT_PROJECT_DIR`, so the runtime's version is in the environment, not the input. Nothing in the environment mentions a sandbox. (The shell tool's result telemetry carries `sandboxApplied: false`, but that goes to Copilot's output, not to the guard.)

### How each answer landed

| Answer | Did the tool run? | What Copilot said |
| --- | --- | --- |
| Deny, `permissionDecision: deny` with a reason, on `view` | No. Both `view` calls failed with code `denied`. | "Denied by preToolUse hook: <reason>". Copilot's debug log shows it read the hook's stdout. |
| Exit 1 (every tool) | No. `view`, `bash` and `apply_patch` all failed. | "Denied by preToolUse hook from <hook file> (hook errored)". The hook's stderr is not shown. |
| Exit 2 (every tool) | No. | "Denied by preToolUse hook: hook exited with code 2". |
| Sleep 10 s with `timeoutSec: 5` | Yes. `view` and `apply_patch` both completed, `out.txt` was written. | The call took about 7 seconds (5 for the time-out, and a little more); the hook never got to log that it woke, so it was killed. Nothing was shown to the model. |

- **Exit 1 did stop the tool**, it was not that the model did not retry: each refused call has a `tool.execution_complete` with `success: false` and the `denied` code, and the model said the hook "errored and blocked" it.
- **The deny worked, and the first reading of the run was wrong.** The summary said the `view` "went through" because the secret word was in the output. It was not: both `view` calls were denied. The model then read `README.md` with `cat` in the shell, and wrote the file with `apply_patch`, which the deny did not cover. A guard that refuses one tool name is gone round by a session that picks another; a guard has to decide on what is done (a file read, a file written), across `bash`, `view`, `rg`, `glob`, `apply_patch` and the rest.
- **The answer's shape.** The deny that worked is the one the research gives for camelCase: stdout JSON `{"permissionDecision":"deny","permissionDecisionReason":"..."}` and exit 0. The same deny answered from a PascalCase registration was not tried.

### What was not tested

- A deny answer from a PascalCase registration, and Claude Code's `hookSpecificOutput` shape.
- `ask`, `modifiedArgs`, and a hook that writes invalid JSON.
- PowerShell (`pwsh` is absent here) and Windows hooks.
- Other models: the tool set may differ.
- A web fetch that succeeds, `ask_user` in an interactive session, `edit` and `create` as such.

## What it means for the design

- **Part 5 Task 1 (the guards' translation).** The brief's "if the answer differs" paragraph applies in part. PascalCase registration gives Claude Code's key names and its names for the built-ins, but not Claude Code's payload in full: there is no `Write` (creates and edits arrive as one `Edit` whose input is a patch string), results are `tool_result` with `result_type`, and `SubagentStart` stays camelCase. So the translation keeps the answer's shape (stdout JSON with `permissionDecision`, exit 0; exit 2 also denies) and a tool-name table, and adds two things: it reads either spelling of the keys, and it reads `apply_patch` (`*** Add File:`, `*** Update File:`, `*** Delete File:` lines) to find the paths being changed. Register under one spelling only, or the hook runs twice per call. The guards must not rely on a tool name alone: the deny on `view` was walked round with `cat`.
- **Part 4 Task 1 (the board's Copilot line).** A hook that times out is let through, not refused, so the line keeps its time-out sentence.
- **A crashing guard blocks.** Exit 1 and exit 2 both refuse the call, so a guard that throws stops all work, and its stderr is not shown to the model; a guard should catch its own errors and answer deliberately.
- **No sandbox or mode in the input.** A guard that needs to know the permission mode or whether the session is sandboxed cannot read it from the hook's input; the version can be read from `COPILOT_CLI_BINARY_VERSION`.

## Needs the director

Nothing now. The Windows part (PowerShell, `powershell` hook commands) is the director's sitting.
