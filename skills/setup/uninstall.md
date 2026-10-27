<!-- skills/setup/uninstall.md -->

# Uninstall

Read by the setup playbook (`SKILL.md` beside it) only when the director asks to remove Wheelhouse, so a setup session doesn't carry it. The command is the setup command the playbook names.

When the director asks to remove Wheelhouse from the project, or types `/wheelhouse:uninstall`:

1. Run `uninstall plan`.
2. Ask each card in its `asks`, one at a time, before uninstall's own card. Each asks whether to delete something that can't come back, with Keep recommended. The director decides each one, even after "just get rid of all of it".
3. When uninstall's card points to `uninstall status`, run it first and show its lines plainly, then ask the card. Ask its `card`. Only after **Remove it**, run `uninstall apply <hash>` with the plan's `hash`. It answers `started`; uninstall goes on by itself, and may show the director a password window to leave Locked. Their password goes only into that window, never into the chat.
4. Run `uninstall status` about once a minute, saying nothing in between, until its first line says uninstall is done, stopped or did not finish. Show its lines plainly, each `Open <what>: <url>` line as a link: the pull request the director merges, and any installation page.
5. Tell them the last step is theirs: remove the Wheelhouse plugin from this project in Claude Desktop.

If apply says the list has changed, start again at 1. If it says uninstall needs the director's Remove it, start again at 1 and ask the card again; never apply without its click. If it says All stop is on, they lift All stop first. If plan's or status's first line says to start a new session, show its lines and stop there; don't ask the card again in this session. Otherwise, if status says uninstall stopped or did not finish, show what it says, then start again at 1: nothing is done twice.
