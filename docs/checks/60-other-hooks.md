<!-- docs/checks/60-other-hooks.md -->

# Check 60: what Copilot's other hooks can do

**Answer:** Partly. `sessionStart` and `userPromptSubmitted` can add text the agent reads, through `additionalContext` (and `userPromptSubmitted` can also rewrite the prompt with `modifiedPrompt`), registered in Copilot's own spelling; `subagentStop` names the agent that stopped. `/compact` works from a script and runs `preCompact`, but whether `preCompact` can block is not settled: the one blocked attempt ended in "Nothing to compact", which does not tell a block from an empty session.

## Question

Can a `sessionStart` or `userPromptSubmitted` hook answer with text the agent reads, and under which field and which spelling of the event name (camelCase, PascalCase, Claude Code's `UserPromptSubmit`)? Can a `preCompact` hook block a compaction, and can a compaction be forced from a script? Does `subagentStop` say which agent stopped?

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. Nine real model runs by `probes/60-other-hooks/run.js`, in two goes. First go (5): `markers` and `subagent` exit 0; the three compaction runs exit 1 (one for an argument fault of the probe's, two for "Nothing to compact"). Second go, after the probe's fix (4): `markers`, `compact-log` and `subagent` exit 0, `compact-block` exit 1. The raw results (every run's arguments, output, hook log lines and counts) are kept with the build's working papers, not in the repository.

## Method

`node probes/60-other-hooks/run.js`. A small hook (`probes/60-other-hooks/hook.js`) is registered in the scratch home's `hooks/` folder (check 56: that folder loads everywhere) in three files, by spelling of the event: camelCase (`sessionStart`, `userPromptSubmitted`, `preCompact`, `subagentStart`, `subagentStop`, `agentStop`, `sessionEnd`), PascalCase of the same names, and `UserPromptSubmit` (Claude Code's own name). Every run passes `--allow-all-tools --trust-folder --no-ask-user --log-level debug`, and the hook keeps only `COPILOT_*` environment values.

- **markers.** On `sessionStart` and `userPromptSubmitted`, one hook per spelling and field, each answering with a sentence carrying a code of its own (`WHMARK-` and six hex digits): `additionalContext`, `hookSpecificOutput.additionalContext`, `systemMessage`, plain stdout, and for the prompt event `modifiedPrompt` (the prompt it was given plus the sentence). 23 hooks. The prompt asked the agent, with no tools, to list every code starting with `WHMARK`. Each code was looked for in the reply and in every event of Copilot's JSON output.
- **compact-log, compact-fresh, compact-block.** `/compact` as the prompt: on the `markers` session resumed with `--resume` (Copilot refuses `--trust-folder` with it, so a resumed run goes without), as the first prompt of a new session (first go only), and again on the resumed session with the camelCase `preCompact` hook answering `{"decision":"block"}`. The probe now also runs one resumed turn ("Reply with the single word ok") before each blocking attempt, so the session has history to compact; the second go did not have that.
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

- **`/compact` is understood by `-p`, and it runs `preCompact`.** In every go it ran the camelCase and PascalCase `preCompact` hooks. The input has `trigger` (`manual`), `customInstructions` and the transcript path (`transcriptPath`, or `transcript_path` with `hook_event_name: PreCompact` under the PascalCase name).
- **A resumed session with history did compact.** `compact-log` (exit 0, 23 seconds) made a summary call and Copilot's debug log says "Persisted compaction checkpoint" and "Compacted conversation history" (one message removed). **The JSON output has no compaction event at all** (its only event was `result`), so a script cannot see a compaction from the output; the debug log is the only place. The probe's first detector looked for events and found none.
- **A new session has nothing to compact.** `/compact` as a first prompt stopped with "Nothing to compact" and exit 1, after running the `preCompact` hooks.
- **The block is not settled.** `compact-block` ran straight after `compact-log` on the same session, so there was nothing left to compact. Copilot's debug log shows the hook's `{"decision":"block","reason":...}` read, then "Nothing to compact" and exit 1: the same error an empty session gives, so it does not show whether the block did anything. Exit 2 and the PascalCase block were not reached. The probe has been changed to refill the session before each attempt; the answer waits for that run.
- **Compaction is slow:** about 23 seconds, with a model call for the summary.

### `subagentStop`

Both spellings ran once per sub-agent, and `subagentStart` too. The stop input names the agent in three keys: `agentType`, `agentName` and `agentDisplayName` (camelCase), or `agent_type`, `agent_name` and `agent_display_name` (PascalCase, with `hook_event_name`). It also carries `agentId`, the parent's id, the transcript path, the agent's last answer (`response` in camelCase, `last_assistant_message` in PascalCase), `stopReason` and `stop_hook_active`. The `task` call completed successfully. Whether `subagentStop` can block (`decision: block`) was not tried.

### What was not tested

- Blocking a compaction (any shape) on a session that has history to compact. Exit 2 on `preCompact` and the PascalCase block were not reached.
- Why `UserPromptSubmit` answers were ignored; `UserPromptSubmit` registered alone.
- `additionalContext` from other events, a `modifiedPrompt` that differs from the typed prompt, and an `additionalContext` over the size caps.
- Whether text added by `sessionStart` survives a compaction.
- Other models.

## What it means for the design

- **Part 5 Task 3 (the STOP word's reply and the briefing).** The brief's "if the answer differs" paragraph applies in part. `userPromptSubmitted` can add text the agent reads, so the STOP word's reply can come from the hook, but only from the camelCase registration through `additionalContext` (it arrives as a system reminder after the prompt) or `modifiedPrompt`. Register under `$COPILOT_HOME/hooks` with the camelCase names, not `UserPromptSubmit` and not `UserPromptSubmitted`. The `systemMessage` and plain-stdout answers do nothing, so the hook cannot show the person text directly. The briefing at the start of a session can use `sessionStart` with `additionalContext` (either spelling). Because the front desk's own skill (`wheelhouse-briefing`) is the fallback the brief names, the plan should keep the STOP word's reply readable by the front desk from the helper's answer, as the brief says, until `UserPromptSubmit` is understood.
- **Part 4 Task 3 (hooks that depend on compaction and sub-agents).** `subagentStop` names the agent that stopped in `agentName` / `agentType`, so a hook can act on a named agent. `preCompact` fires on `/compact` (also from a script, on a resumed session) and says its trigger, but whether it can stop a compaction is not settled: design as if it cannot until it is tested, and do not rely on it to keep the briefing or a rule in context. A script cannot see a compaction in the JSON output; the debug log says it.
- **Register once, in one spelling.** Registered under two spellings, the same event runs both hooks (check 58), and here the two spellings did not behave alike for the prompt event. Use the camelCase names throughout.

## Needs the director

Nothing now.
