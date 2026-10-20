---
description: Remove Wheelhouse from this project, putting back what setup changed. Nothing changes until the director clicks Remove it on its card.
disable-model-invocation: true
---
<!-- commands/uninstall.md -->
Remove Wheelhouse from the folder this session is in. The host helper makes every change, and only after the director's click; you only talk. Type each command exactly so, one per call, in this folder:

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall plan`.
2. For each entry in its `asks`, ask that `card` with AskUserQuestion exactly as given, one at a time. Each asks whether to delete something that can't come back, and Keep is recommended. Ask them all before the next step: an answer given after the click counts for nothing.
3. Ask its `card` exactly as given. Don't mention the hash.
4. Only if the director chose Remove it, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall apply <hash>`, with the `hash` from step 1. Show each of its `lines` as it is, and each of its `pages` as a link with its `what`. If it says the helper stops, say Wheelhouse has left this computer.
5. If it says the list has changed, start again at step 1. If it says STOP is on, tell the director to lift STOP first. If it stopped part-way, show what it says, then start again at step 1: what was done is not done twice.

For the whole list, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup/cli.js" uninstall status` and show its lines as they are.
