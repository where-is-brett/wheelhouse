<!-- adapters/copilot/tool-sheet.md -->
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
