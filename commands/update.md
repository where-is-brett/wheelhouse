---
description: Update Wheelhouse on this computer and in this project to its latest release, or put it back to an earlier one. Nothing changes until you click Update on its card.
disable-model-invocation: true
---
<!-- commands/update.md -->
Update Wheelhouse for the folder this session is in. The host helper makes every change, and only after the director's click; you only talk. Type each command exactly so, one per call, in this folder. If the director named a release (`/wheelhouse:update v0.2.8`), put it after `plan`.

1. Say "Looking for the latest Wheelhouse release." Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/update/cli.js" plan`. If a stop guard answers instead, All stop is on: tell the director to lift All stop first, and stop there.
2. If its answer has no `card`, show its `lines` as they are, and stop. (When nothing is newer, that is one line: the director has the latest.)
3. Ask its `card` with AskUserQuestion exactly as given, with nothing added. Don't mention the hash.
4. If the director chose **Not now**, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/update/cli.js" answer <hash> "Not now"`, with the `hash` from step 1, show its lines as they are, and stop. Their click on the card is what records the decline; this only reports it. Nothing else is done.
5. Only if the director chose **Update**, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/update/cli.js" apply <hash>`, with the `hash` from step 1. It starts the update and answers `started`; the update goes on by itself, and may show the director a password window. Their click on **Update** only starts it: it is never their approval of the change to the project's safety settings, which comes on its own card.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/update/cli.js" status` about once a minute, saying nothing in between. When its answer has `asks`, ask each one's `card` with AskUserQuestion exactly as given, one at a time, and then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/update/cli.js" answer <id> "<label>"` with that ask's `id` and the label the director chose, so the update looks again at once. A card is asked once: don't ask it again while a later `status` still lists it, unless the director says they didn't answer it.
7. Keep going until `state` is `done`, `stopped` or `none`. Then show the `lines` as they are. If `state` stays `unreachable` for several minutes, say what the line says. Don't make up what is happening between checks.
8. If apply says the director has not clicked Update, ask the card again exactly as given and run `apply` only after their click on it. If it says the plan is not the one last shown, start again at step 1. If it says to lift All stop first, tell the director to lift All stop first. If it says a feature session can't run it, say the update is the director's own command, to be typed in their main session.

For how an update stands without starting one, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/update/cli.js" status` and show its lines as they are.
