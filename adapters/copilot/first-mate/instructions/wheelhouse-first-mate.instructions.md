---
applyTo: "**"
---
<!-- adapters/copilot/first-mate/instructions/wheelhouse-first-mate.instructions.md (built from adapters/copilot/tool-sheet.md by npm run copilot-first-mate) -->
# Wheelhouse's First Mate in Copilot

**Apply this only in a workspace that is a Wheelhouse project, one with a `.claude/wheelhouse.json` file in its folder. In any other workspace, ignore all of it and answer as if it were not here.**

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

## Clicks in the chat

On Copilot no hook sees the director's click on a card you asked with ask_user, so that click is not recorded. An option that
signs something is never offered in the chat:
Approve, Send it back, Confirm, Lift All stop, Lift STOP, Do it, Push it, Change it, End it, Merge the fix, Pair it and Unpair it.
For a card with one of them, run `confirm <card id>` instead (the id is in `views waiting`), and say in one plain line
that the card is open in Wheelhouse's own window for the director to click. The window records the click and the card stops
waiting. Lifting STOP, changing a guardrail, unattended running, a runbook step, a CI push and an allowance go the same way.

When the session start gives the card that moves the First Mate to this window, show it as text, never with ask_user, and run
`confirm seat-take-over`: its window records the click and moves the First Mate. Every command that records takes
`--session <id>`, the session id the session start gave you; a command without it is refused.

A decision is never asked with ask_user, and a reply typed here is not recorded. Print it exactly as `decision show <n>`
prints it, then run `decision confirm <n>`: it opens the decision in Wheelhouse's own window, and the director's click there
is their answer, which the crew acts on. When the director closes the window to say "why <n>", run `why decision <n> <their
words>`, relay its answer, then run `decision confirm <n>` again.

A click on a card with no signing option is the director's answer: act on it, and say what you did.

Ask each card with ask_user as the tool sheet says: one card per call, and several cards one call after another. The question is
the card's text, then one line per option, "Label: what it does". The options are the card's exact labels. The `default` is
the card's recommended option (`recommend`), not the first option.
