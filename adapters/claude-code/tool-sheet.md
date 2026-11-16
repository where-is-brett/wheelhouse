<!-- adapters/claude-code/tool-sheet.md -->
The Wheelhouse playbooks name your tools in general words. In Claude Code:
- Your clickable-question tool is AskUserQuestion.
- AskUserQuestion is always loaded: call it directly, and never look for it with ToolSearch first.
- Your notification tool is PushNotification.
- Your tool-search tool is ToolSearch.
- Your message tool is SendMessage.
- To run a command outside the sandbox, run it with Bash and `dangerouslyDisableSandbox: true`; Claude Code asks the person first.
