<!-- adapters/copilot/tool-sheet.md -->
The Wheelhouse playbooks name your tools in general words. In Copilot:
- Your clickable-question tool is ask_user (askQuestions in VS Code).
- Ask a card with ask_user exactly so: one card per call (several cards are several calls, one after another). The question is the card's text, then one line per option, "Label: what it does". The options are the card's exact labels, in the card's order. The `default` is the card's recommended option (`recommend`), never just the first. Signing options and decisions never go to ask_user (see "Clicks in the chat").
- Your notification tool: none. Tell the director in the chat.
- Your tool-search tool: none. Every tool you have is already offered.
- Your message tool is send_message in VS Code, which asks the person first.
- Run commands with bash (powershell on Windows).
- Dispatch a sub-agent with `task`. A `name` is required, so give one every time, with a `description`, a `prompt`, an `agent_type` and a `mode`.
- Read a sub-agent's answer with `read_agent`.
- Load a skill with `skill` with {"skill": "<name>"}.
- Keep your task list in the `sql` tool's `todos` table.
- Run the Wheelhouse command exactly as the session start names it. When it is a launcher, `wh-<name>`, Wheelhouse's commands are launchers on your PATH, typed alone with no `node` and no path. Where a playbook says to use the Wheelhouse command with another script in place of `scripts/frontdesk/cli.js`, run that script's launcher instead: `scripts/setup/cli.js` is `wh-setup`, `scripts/update/cli.js` is `wh-update`, `scripts/health/trials.js` is `wh-trials`, `scripts/feature/cli.js` is `wh-feature`. Where a playbook shows text in double quotes after a launcher, give it in single quotes instead, with no `'`, `"`, `%`, `^`, `&`, `|`, `<`, `>`, `$`, `!` or backtick in it, and run one launcher command alone on the line (no `;`, pipe, `&&`, `$variable`, brackets or backtick); a command that doesn't fit is refused. A file's text goes in a file the command reads with `< path`.
- When the Wheelhouse command is `node` with a path, run it as given and put the other script's path in place of `scripts/frontdesk/cli.js` where a playbook says to. A `wh-` launcher is not on your PATH then.
- When a Wheelhouse command prints a `panel` line (a panel in VS Code holds the director's cards), stop and say that line in one plain sentence, with nothing of the cards: they are answered in the panel. Ask only the `questions` it prints beside the line, with ask_user; they are the cards the director sent here with the panel's Ask in the chat button. Pair it and Unpair it are never answered in the panel or with ask_user: they are confirmed in Wheelhouse's own window (`confirm <card id>`).
