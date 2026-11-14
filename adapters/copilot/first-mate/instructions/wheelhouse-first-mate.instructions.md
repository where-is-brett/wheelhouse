---
applyTo: "**"
---
<!-- adapters/copilot/first-mate/instructions/wheelhouse-first-mate.instructions.md (built from adapters/copilot/tool-sheet.md by npm run copilot-first-mate) -->
# Wheelhouse's First Mate in Copilot

**Apply this only in a workspace that is a Wheelhouse project, one with a `.claude/wheelhouse.json` file in its folder. In any other workspace, ignore all of it and answer as if it were not here.**

The Wheelhouse playbooks name your tools in general words. In Copilot:
- Your clickable-question tool is ask_user (askQuestions in VS Code).
- Your notification tool: none. Tell the director in the chat.
- Your tool-search tool: none. Every tool you have is already offered.
- Your message tool is send_message in VS Code, which asks the person first.
- Run commands with bash (powershell on Windows).
- Dispatch a sub-agent with `task`. A `name` is required, so give one every time, with a `description`, a `prompt`, an `agent_type` and a `mode`.
- Read a sub-agent's answer with `read_agent`.
- Load a skill with `skill` with {"skill": "<name>"}.
- Keep your task list in the `sql` tool's `todos` table.
- Wheelhouse's commands are launchers on your PATH, each named `wh-<name>`, typed alone with no `node` and no path. Where a playbook says to use the Wheelhouse command with another script in place of `scripts/frontdesk/cli.js`, run that script's launcher instead: `scripts/setup/cli.js` is `wh-setup`, `scripts/update/cli.js` is `wh-update`, `scripts/health/trials.js` is `wh-trials`, `scripts/feature/cli.js` is `wh-feature`. Where a playbook shows text in double quotes after a launcher, give it in single quotes instead, with no `'`, `"`, `%`, `^`, `&`, `|`, `<`, `>`, `$`, `!` or backtick in it, and run one launcher command alone on the line (no `;`, pipe, `&&`, `$variable`, brackets or backtick); a command that doesn't fit is refused. A file's text goes in a file the command reads with `< path`.

## Clicks in the chat

A click on an option of a card you asked with ask_user is recorded by Wheelhouse's helper with the proof chat-click: your
own account of the click, **not proven** until a check shows a hook sees the director's own click. It is enough for the
everyday approvals the director ruled on, and for nothing more.

These steps are never decided by a click in the chat: lifting STOP (Lift STOP), changing a guardrail, unattended running,
a runbook step, a CI push and an allowance. Each goes to the helper's own window with `confirm`. A card for one of them
that you ask in the chat is answered only by the window.
