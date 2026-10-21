<!-- docs/checks/60-other-hooks.md -->

# Check 60: what Copilot's other hooks can do

**Answer:** Partly. `sessionStart` and `userPromptSubmitted` can add text the agent reads, through `additionalContext` (and `userPromptSubmitted` can also rewrite the prompt with `modifiedPrompt`), registered in Copilot's own spelling; `subagentStop` names the agent that stopped. Whether `preCompact` can block is untested: no run got as far as a compaction that could be blocked.

## Question

Can a `sessionStart` or `userPromptSubmitted` hook answer with text the agent reads, and under which field and which spelling of the event name (camelCase, PascalCase, Claude Code's `UserPromptSubmit`)? Can a `preCompact` hook block a compaction, and can a compaction be forced from a script? Does `subagentStop` say which agent stopped?

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. Five real model runs by `probes/60-other-hooks/run.js`: `markers` and `subagent` exit 0; the three compaction runs (`compact-log`, `compact-fresh`, `compact-block`) exit 1. The raw results (every run's arguments, output, hook log lines and counts) are kept with the build's working papers, not in the repository.

## Method

`node probes/60-other-hooks/run.js`. A small hook (`probes/60-other-hooks/hook.js`) is registered in the scratch home's `hooks/` folder (check 56: that folder loads everywhere) in three files, by spelling of the event: camelCase (`sessionStart`, `userPromptSubmitted`, `preCompact`, `subagentStart`, `subagentStop`, `agentStop`, `sessionEnd`), PascalCase of the same names, and `UserPromptSubmit` (Claude Code's own name). Every run passes `--allow-all-tools --trust-folder --no-ask-user --log-level debug`, and the hook keeps only `COPILOT_*` environment values.

- **markers.** On `sessionStart` and `userPromptSubmitted`, one hook per spelling and field, each answering with a sentence carrying a code of its own (`WHMARK-` and six hex digits): `additionalContext`, `hookSpecificOutput.additionalContext`, `systemMessage`, plain stdout, and for the prompt event `modifiedPrompt` (the prompt it was given plus the sentence). 23 hooks. The prompt asked the agent, with no tools, to list every code starting with `WHMARK`. Each code was looked for in the reply and in every event of Copilot's JSON output.
- **compact-log, compact-fresh, compact-block.** `/compact` as the prompt: first on a resumed session, then as the first prompt of a new session, then again with the camelCase `preCompact` hook answering `{"decision":"block"}`.
- **subagent.** A prompt asking for the `task` tool with a custom agent `probe-agent`, with `subagentStart` and `subagentStop` hooks logging in two spellings.

### Undo

The probe makes everything under the system's temporary folder and removes it itself, also on Ctrl-C: the scratch Copilot home (with its hook files and agent), the scratch project, and Copilot's log folders. Nothing was written to the real `~/.copilot` or `~/.wheelhouse`. The only thing left is the results file in `<temporary folder>/wheelhouse-probe-results/`, which can be deleted. Nothing needs undoing by hand.

## Evidence

### Text from `sessionStart` and `userPromptSubmitted`

| Event and spelling | `additionalContext` | `hookSpecificOutput` | `systemMessage` | plain stdout | `modifiedPrompt` |
| --- | --- | --- | --- | --- | --- |
| `sessionStart` | reached the agent | not seen | not seen | not seen | n/a |
| `SessionStart` | reached the agent | not seen | not seen | not seen | n/a |
| `userPromptSubmitted` | reached the agent | not seen | not seen | not seen | reached the agent |
| `UserPromptSubmitted` | hook never ran | hook never ran | hook never ran | hook never ran | hook never ran |
| `UserPromptSubmit` | ran, not seen | ran, not seen | ran, not seen | ran, not seen | ran, not seen |

"Reached the agent" means the code came back in the reply. "Not seen" means the code was absent from the reply and from every JSON event; Copilot's debug log shows it read each hook's stdout.

- **`sessionStart`.** `additionalContext` worked in both camelCase and PascalCase registrations. The nested `hookSpecificOutput` form, `systemMessage` and plain stdout did not. The input has `sessionId`, a `timestamp` in milliseconds, `cwd`, `source` (`new`) and `initialPrompt`.
- **`userPromptSubmitted`, `additionalContext`.** The `user.message` event carries both the typed text (`content`) and what the model was given (`transformedContent`): a date line, the typed prompt, the `modifiedPrompt` text, and the `additionalContext` sentence wrapped in a `<system_reminder>` block. So this field arrives as a system reminder after the prompt.
- **`userPromptSubmitted`, `modifiedPrompt`.** The model's input (`transformedContent`) held the hook's returned text in place of the typed prompt. The hook returned the typed prompt plus a sentence, so the run shows the replacement was used, not whether a different text would have been accepted. The input to this hook has `prompt`.
- **PascalCase `UserPromptSubmitted` never loaded.** Copilot's debug log says, for the PascalCase file: "Ignoring unknown hook event(s) ... UserPromptSubmitted, AgentStop". The PascalCase form of an event name works only where it is Claude Code's name (`SessionStart`, `PreCompact`, `SubagentStart`, `SubagentStop`, `SessionEnd`, and `UserPromptSubmit`); the rest of the file loaded. Copilot's `agentStop` loaded in camelCase; Claude Code's name for it is `Stop`.
- **`UserPromptSubmit` (Claude's name) ran, but none of its five answers reached the agent**, including `additionalContext` and `modifiedPrompt`, which worked from the camelCase registration in the same run. The cause was not isolated: the answers may be ignored, or lost to the camelCase hooks answering the same event. Its input is Claude-shaped (`hook_event_name`, `session_id`, `prompt`).

### Compaction

- **`/compact` is understood by `-p`, and it runs `preCompact`.** In a new session it ran the camelCase and PascalCase `preCompact` hooks, and Copilot's telemetry lines show a compaction started and finished. The input has `trigger` (`manual`), `customInstructions` and the transcript path (`transcriptPath`, or `transcript_path` with `hook_event_name: PreCompact` under the PascalCase name).
- **A new session has nothing to compact.** Copilot stopped with "Nothing to compact" and exit 1, with and without the blocking hook (the same error and the same hook counts in `compact-fresh` and `compact-block`). The hook's block therefore changed nothing visible, and the block was **not tested**.
- **The resumed session never started.** `compact-log` was rejected by Copilot's argument parser: `--trust-folder` cannot be used with `--resume`. That was a fault in the probe's arguments, not a finding about compaction. No session with history was compacted, so `preCompact` blocking, exit 2 on `preCompact`, and the PascalCase block were all untried.

### `subagentStop`

Both spellings ran once per sub-agent, and `subagentStart` too. The stop input names the agent in three keys: `agentType`, `agentName` and `agentDisplayName` (camelCase), or `agent_type`, `agent_name` and `agent_display_name` (PascalCase, with `hook_event_name`). It also carries `agentId`, the parent's id, the transcript path, the agent's last answer (`response` in camelCase, `last_assistant_message` in PascalCase), `stopReason` and `stop_hook_active`. The `task` call completed successfully. Whether `subagentStop` can block (`decision: block`) was not tried.

### What was not tested

- Blocking a compaction (any shape), and a compaction of a session with history, resumed with a command-line form that does not clash with `--trust-folder`.
- Why `UserPromptSubmit` answers were ignored; `UserPromptSubmit` registered alone.
- `additionalContext` from other events, a `modifiedPrompt` that differs from the typed prompt, and an `additionalContext` over the size caps.
- Whether text added by `sessionStart` survives a compaction.
- Other models.

## What it means for the design

- **Part 5 Task 3 (the STOP word's reply and the briefing).** The brief's "if the answer differs" paragraph applies in part. `userPromptSubmitted` can add text the agent reads, so the STOP word's reply can come from the hook, but only from the camelCase registration through `additionalContext` (it arrives as a system reminder after the prompt) or `modifiedPrompt`. Register under `$COPILOT_HOME/hooks` with the camelCase names, not `UserPromptSubmit` and not `UserPromptSubmitted`. The `systemMessage` and plain-stdout answers do nothing, so the hook cannot show the person text directly. The briefing at the start of a session can use `sessionStart` with `additionalContext` (either spelling). Because the front desk's own skill (`wheelhouse-briefing`) is the fallback the brief names, the plan should keep the STOP word's reply readable by the front desk from the helper's answer, as the brief says, until `UserPromptSubmit` is understood.
- **Part 4 Task 3 (hooks that depend on compaction and sub-agents).** `subagentStop` names the agent that stopped in `agentName` / `agentType`, so a hook can act on a named agent. `preCompact` fires on `/compact` and says its trigger, but nothing here shows it can stop a compaction: design as if it cannot until it is tested, and do not rely on it to keep the briefing or a rule in context.
- **Register once, in one spelling.** Registered under two spellings, the same event runs both hooks (check 58), and here the two spellings did not behave alike for the prompt event. Use the camelCase names throughout.

## Needs the director

Nothing now.
