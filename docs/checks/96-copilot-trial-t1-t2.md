<!-- docs/checks/96-copilot-trial-t1-t2.md -->

# Check 96: Copilot trial stages T1 and T2

**Answer:** Partly. Run on 10 November 2026 on the Mac. Copilot's hooks can add context at the start of a session and of a prompt, a turn's end and a subagent's end can send work back, and a subagent's stop names the agent. A session id can be given up front, and the events file carries token counts. A compaction cannot be stopped by a hook, a hook past its time-out lets the action through, and a resume counts as a request. Six items stay open (the list at the end).

## Question

The Copilot return design (`docs/specs/2026-11-10-copilot-return-design.md`, section 7, stages T1 and T2): what do sections 3 and 5 mark "not confirmed", and what do parts 2 to 4 need changed once they are answered?

## Tested on

10 November 2026, on the Mac (macOS 27, Apple silicon), with Node.js 22 and Copilot CLI 1.0.105 (the installed copy; the design's flags were read at 1.0.101, and every flag the adapter passes is in 1.0.105's `--help`). Signed in as the director's GitHub account, which GitHub reports as `free_educational_quota`, 200 premium interactions a month, extra use off, reset on 1 December 2026. No `--model` and no `COPILOT_MODEL` was passed. Each run used a scratch Copilot home holding the sign-in's `config.json` and a logging hook on every event, in a throwaway folder.

## Method

Five `copilot -p` runs with `--output-format json --no-ask-user --usage-output-file`, and one `/compact`:

1. a hello run (read a file with the view tool), with a session id given by `--session-id`;
2. a run with a custom agent run through the `task` tool, a hook adding context at the start and at each prompt, a hook denying the shell, and blocks answered at `agentStop` and `subagentStop`;
3. a shell run with a hook that hangs past its time-out, and a block answered at `agentStop`;
4. a resume of run 3 with a one-word prompt;
5. a `/compact` on that session with a hook answering a block at `preCompact`;
6. a bare one-word run, with GitHub's figure read before and after.

The CLI counted **6 requests** (1, 1, 2, 1, 0, 1). T1's budget was 2 and T2's 8; together 6 of 10. The scripted guard attempts of T2 (a write outside the worktree, a key read, a nested program, a card left malformed) were not run: they need the guards in a session's clean home, which part 6 builds, so they move to the evaluation (part 10).

## Evidence

| Question (design section) | Answer |
|---|---|
| Can a hook add context? (3) | **Yes** at `sessionStart` and `userPromptSubmitted`, as `{ "additionalContext": "..." }`: the agent repeated both words back. `userPromptSubmitted` also runs for a subagent's prompt, with `agentId`, `agentType` and `parentAgentId` in its input |
| Can `agentStop` block? (3) | **Yes** for the main agent: `{ "decision": "block", "reason": "..." }` with exit 0 starts another turn whose prompt is the reason (a `userPromptSubmitted` follows, then `agentStop` again with `stop_hook_active: true`). A block at a subagent's own `agentStop` was ignored |
| Can `subagentStop` block, and does it name the agent? (3) | **Yes to both.** The same answer sends the subagent back with the reason as its prompt. The input names `agentName`, `agentType`, `agentDisplayName`, `agentId`, `parentAgentId`, and carries the subagent's final text as `response`. Its `transcriptPath` is the parent session's events file |
| Does a hook time-out let the action through? (3) | **Yes.** A `preToolUse` hook that slept 15 seconds under a 4-second `timeoutSec` was stopped, and the shell command ran |
| Does `preToolUse` deny hold? (3) | **Yes.** `{ "permissionDecision": "deny", "permissionDecisionReason": "..." }` refused the shell command; the agent reported it as blocked |
| Can `preCompact` block? (3) | **No**, for a manual compaction: the input has `trigger: "manual"` and `customInstructions`, a block was answered, and the compaction started and completed. An automatic compaction was not run (open) |
| Can a session id be given up front? (3) | **Yes**, `--session-id <uuid>`: the run's `sessionId`, every hook's `sessionId` and the folder under `session-state/` all carried it. A resume (`--resume=<id>`) keeps the id, and its `sessionStart` input has `source: "resume"` |
| Is there an effort flag? (3) | **Yes**: `--reasoning-effort` with `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Whether Auto honours it was not run (open) |
| The events file's format and token counts (3) | One JSON object per line: `type`, `data`, `id`, `parentId`, `timestamp`. Types seen: `session.start`, `session.model_change`, `hook.start`, `hook.end`, `user.message`, `assistant.message`, `tool.execution_start`, `tool.execution_complete`, `assistant.turn_start`, `assistant.turn_end`, `session.usage_record`, `session.usage_checkpoint`, `session.compaction_start`, `session.compaction_complete`, `session.resume`, `session.shutdown`. **Token counts are there** per model call in `session.usage_record` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `cost`), and in total in `session.shutdown`. `--output-format json` prints the same events and ends with a `result` line |
| Where does the model Auto chose appear? (3.2) | In the JSON output as `session.auto_mode_resolved` (`chosenModel`, `selectionReason`, `availableModels`); also in `session.usage_record.usage.model`, in the usage file's `currentModel` and in `session.model_change` as `auto`. On this plan `availableModels` held one model |
| How is use reported? (3, 5) | The `result` line's `usage.premiumRequests`, and the usage file's `totalPremiumRequestCost`, `totalUserRequests`, `totalNanoAiu`, `tokenDetails` and `modelMetrics`. Both are **cumulative for the session across resumes** (a 2-request session resumed once read 3). GitHub's figure moves far less: one short run took `quota_remaining` in `gh api /copilot_internal/user` from 148.7 to 148.6. The CLI's count therefore overstates the account's, as check 57 found |
| Does a subagent's turn count as its own request? (5) | **No.** The run with a subagent that was sent back once, and a main turn, counted 1 |
| Does a block's continuation count? (5) | **Yes.** The run whose `agentStop` was blocked once counted 2 |
| Does a resume count as a new prompt? (5) | **Yes**, one request |
| Does `/compact` count? (5) | No: 0 requests |
| When does the allowance reset? (5) | `quota_reset_date` was 2026-12-01: the 1st |

## What it means for the design

- Section 3's rows for hooks on stop and subagents, subagents and headless sessions are **Matches**: `agentStop` and `subagentStop` send work back, and `subagentStop` names the agent. A card left malformed at the end of a turn is caught at once, not at the next prompt.
- The compaction hold **loses**, as the design allowed: a long Copilot session may compact before its notes are written.
- Section 5.2's estimate holds in one respect: subagents are free of their own request. A blocked `agentStop` costs one more, so a card check that blocks should be rare.
- The session id is given up front, so the sessions part needs no `idFromRun`.

## What changed in parts 2 to 4

- `adapters/copilot/hooks.js` registers `agentStop`, `subagentStop` and `sessionEnd` as well (seven events). `postToolUse` stays out until check C6.
- `adapters/copilot/translate.js`: a block at the end of a turn is answered with exit 0 (the form seen to work); `exitCodeFor` takes the event, and a block still exits 2 at `preToolUse` or when no event is given.
- `scripts/agents/copilot/hook-entry.js`: a subagent's own `userPromptSubmitted` and `agentStop` (named by `agentId`) run no step. The prompt is the parent's task, not the director's words, and a block there is ignored.
- Fixtures: `tests/fixtures/copilot/hook-input/` gains `userPromptSubmitted`, `agentStop` (main and subagent), `sessionEnd` and `preCompact`; `tests/fixtures/copilot/run/` holds one run's output lines and usage file. Model names are replaced by placeholders.

## Still open

- Whether `ask_user`'s answer reaches a `postToolUse` hook, and whether an agent can fill it in: check C6, stage T5.
- Whether an automatic compaction can be held (only a manual one was run), and whether Auto honours `--reasoning-effort`.
- Whether a step that fails part-way still counts as a request, and whether Auto ever picks a model that costs nothing (the plan offered one model).
- Whether a block answered with exit 2 also works at `agentStop` (the entry sends exit 0).
- A prompt made of a hook's own block reason reaches `userPromptSubmitted` as if typed; the entry cannot tell it from the director's words. It matters only to `prompt-record`, and only for a reply code, which a reason would not hold.
- A top-level session's input that carried `agentId` and `parentAgentId` would have its prompt and `agentStop` steps skipped. None was seen: only a subagent's inputs carry both.
