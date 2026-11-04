<!-- docs/checks/55-addon-contributions.md -->

# Check 55: what an add-on's contributions reach, on the Mac

**Answer:** Yes for the chat tools. Both of the add-on's chat tools, `wheelhouse_board` and `wheelhouse_record`, reached VS Code's Copilot chat. The chat called `wheelhouse_record` with no **Allow** prompt, and the tool refused a made-up card: "Nothing was recorded: a click needs a card, its hash and a button." The skills, agents and instructions the chat listed came from Lean's kit in `~/.copilot/`, not from the add-on, which contributes none.

## Question

Which of the add-on's contributions reach VS Code's chat: its chat tools, and whether skills, agents and instructions would come through it (Copilot design C2). It decides whether Part D keeps the chat tools as the chat's way in.

## Tested on

4 November 2026, on macOS, VS Code 1.132.0 with the built-in GitHub Copilot Chat, in a scratch VS Code profile on the scratch project from checks 59 and 70, in Agent mode, with the Local session target. Model Auto (`mai-code-1.1-flash`). The add-on was built from `main` (its hash matching `vscode/vsix.sha256`) and installed in the scratch profile. Lean's kit from check 70 was in `~/.copilot/`. The agent sent the request through a scratch extension that opens the chat with a query; nobody typed.

## Method

One new chat turn: `List the tools you can call whose names contain wheelhouse, and the Wheelhouse skills, agents and instructions you were given. Then call the Wheelhouse record tool once with card test-1, hash 0000…0000 and label Approve, and say exactly what it returned. Do not run terminal commands.` The hook logger from check 59 logged the tool calls, and the agent read the chat's saved session.

## Evidence

- **The tools.** The chat listed `wheelhouse_board` and `wheelhouse_record` as tools it can call.
- **The record tool.** The hook log has `preToolUse` and `postToolUse` for `wheelhouse_record` with the arguments as sent, and the result "Nothing was recorded: a click needs a card, its hash and a button." No **Allow** prompt came up. The add-on wrote nothing.
- **Skills, agents and instructions.** The chat listed the eleven `wheelhouse-*` skills, the four agents and `wheelhouse.instructions.md`. These are Lean's kit in `~/.copilot/` (check 70). The chat also had the person's `~/.claude/skills/` and `~/.agents/skills/`, as in check 70.
- **A screenshot** of the turn was kept outside the repository.

### What was not tested

- The board tool's answer in a Wheelhouse project with cards, and a real card through the record tool. The scratch project has no helper running (check 72).
- Skills or agents contributed through the add-on itself: it has none, as designed.
- The Copilot session target, other models, and Windows.

## What it means for the design

- **Part D's chat tools stay as the chat's way in.** They reach the chat, and the record tool refuses what it can't check, with no prompt to the person.
- **A tool that runs with no prompt can be called by the agent at will,** so it must keep binding nothing, as `chat-tools.cjs` does: a click is recorded only from the pane.
- **Skills and agents need no add-on route.** Lean's kit already brings them.

## Needs the director

- Nothing on the Mac. The Windows half is for the work laptop.
