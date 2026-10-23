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
