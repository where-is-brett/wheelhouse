---
description: Remove Wheelhouse from this project, putting back what setup changed. Nothing changes until you click Remove it on its card.
disable-model-invocation: true
---
<!-- commands/uninstall.md -->
Remove Wheelhouse from the folder this session is in. The host helper makes every change, and only after the director's click; you only talk. Type each command exactly so, one per call, in this folder:

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall plan`.
2. For each entry in its `asks`, ask that `card` with AskUserQuestion exactly as given, one at a time. Each asks whether to delete something that can't come back, and Keep is recommended. Ask them all now, before the next step: an answer given before this plan, or after the click, counts for nothing.
3. If the card points to `uninstall status`, first run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall status` and show its lines as they are. Then ask its `card` exactly as given. Don't mention the hash.
4. Only if the director chose Remove it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall apply <hash>`, with the `hash` from step 1. It starts uninstall and answers `started`; uninstall goes on by itself, and may show the director a password window.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall status` about once a minute, saying nothing in between, until its first line says uninstall is done, stopped or did not finish. Then show its lines as they are, each `Open <what>: <url>` line as a link. If it said done and the helper stops, say Wheelhouse has left this computer.
6. If apply says the list has changed, start again at step 1. If it says All stop is on, tell the director to lift All stop first. If plan's or status's first line says to start a new session, show its lines and stop there; don't ask the card again in this session. Otherwise, if status says uninstall stopped or did not finish, show what it says, then start again at step 1: what was done is not done twice.

For the whole list before uninstall starts, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall status` and show its lines as they are.
