<!-- docs/checks/08-prompt-record.md -->

# Check 8: the prompt-record hook

**Answer:** Yes, with a change — card clicks can be recorded and can't be forged by an agent; but a project hook can't reliably tell the director's typing from a relayed or mod message, and a mod can.

## Question

That the prompt-record hook can tell a message the director typed from one relayed by another session, and from one submitted by a mod; that a `PostToolUse` hook sees the director's answer to a clickable question; and that an agent can't supply that answer itself (the question tool accepts pre-filled answers).

## Tested on

https://code.claude.com/docs/en/hooks, read on 17 October 2026, and trials in Claude Desktop on macOS, Claude Code 2.1.299, the same day. The logging hooks sat in this repository's git-ignored `.claude/settings.local.json` and were removed afterwards.

## Method

Read the hooks reference. Then ran the trials in this session, with `hook-logger.js` on `UserPromptSubmit` and on `PostToolUse` for the question tool:

1. the director typed a message;
2. a background agent's report arrived;
3. the director clicked an answer on a card;
4. the session called the question tool with an answer already filled in;
5. the probe mod's button submitted a message (check 9).

## Evidence

- **Pre-filled answers:** the documentation says of the question tool's `answers` field, "Claude doesn't set this field; supply it via `updatedInput` to answer programmatically". Only a hook can fill it in, and hooks are guardrails (design section 12.4).
- **`PostToolUse`** can match the question tool by name. The shape of the answer it receives isn't documented.
- **`UserPromptSubmit` also runs** for "a message another session sends to your main conversation".
- **Trial 4 (pre-filled):** the session filled in "Apples"; the question was still shown to the director, who clicked "Pears", and "Pears" is what came back. The pre-filled answer was ignored.
- **Trial 3 (click):** `PostToolUse` received the question and the director's answer in `tool_input.answers`.
- **Trial 2 (relayed):** `UserPromptSubmit` fired, and the only sign of where it came from was text the harness wraps around it (`<agent-message from=…>`). No separate field says so.
- **Trials 1 and 5 (typed, and from a mod):** `UserPromptSubmit` received just the text in both cases ("hello from the director", "probe: mod button"), with nothing to tell them apart. The mod's own `prompt.submit` hook did: the typed message carried `origin: { kind: "composer" }` (check 9).

## What it means for the design

- Section 12.5: a card answer can only come from the director's click, or from a hook. Scenario 19 in section 18 tests the first; the gate's guardrail rule covers the second.
- Section 12.3: until the mod exists, approvals and confirmations come only from card clicks, recorded by a `PostToolUse` hook on the question tool. A typed "yes" is not an approval.
- Sections 12.3 and 17.1: once the mod exists, it records typed messages as the director's only when their origin is `composer` or `bridge`, and its buttons record clicks.

## Needs the director

No.
