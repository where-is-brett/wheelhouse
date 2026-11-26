<!-- docs/specs/notes/2026-11-24-desktop-probe.md -->
# Desktop probe findings

Recorded on 24 November 2026 by the sitting in `probes/97-desktop-builders/README.md`. Parts 6 and 7 of the builders plan follow these.

- `cwdOnOffer`: Not settable. On Windows Desktop, start_session's `cwd` is for `user_asked` only; an `offer` takes only a title, and after the card the brief takes only `prompt` and `background`. All three probe sessions opened in the starter's own folder (C:\Users\<user>\wheelhouse-t6; Desktop's record has originCwd = that folder, folderPlace shared), not the scratch project.
- `worktreePath`: none: the worktree choice is the director's on the card, not the starter's; the starter's folder is not a git repository, so no worktree was offered or made (inWorktree false in every try)
- `worktreeBranch`: none (gitRoot and branch null in every try)
- `projectHooks`: hookRan false in all three tries, because none opened in the scratch project. User-level SessionStart hooks from installed plugins did run and add context in every try.
- `entrypoint`: claude-desktop
- `pluginLoad`: Wheelhouse not loaded: pluginRoot null and no Wheelhouse skills listed in any try. Other user plugins (for example superpowers) loaded. Wheelhouse is not enabled in Claude Desktop on this computer, so this says nothing about a Desktop where it is.
- `sendMessage`: All three probe-done lines reached the starter as cross-session messages within about a minute of the start. probe-cwd first tried the starter's transcript-derived id (local_<transcript id>) and got 'session not found'; a reply to the starter by its real local_ session id went through. The ids a session sees for itself and for its starter differ, so a brief must name the starter by its local_ session id, or say 'reply to the session that started you'.
- `wakeWhenDone`: Not passable: after an offer card, the brief call takes only prompt and background, so wake_when_done could not be set. The starter was woken anyway, with a note each time a probe session ended its turn (within seconds), and its messages arrived as separate turns.
- `quitAndReopen`: not tried: needs Desktop to be closed
- `desktopFlag`: `claude --help` lists `--desktop  Open in the Claude Desktop app instead`. `claude --desktop --help` prints the general help with no more detail. Not started: the help does not say it needs no click and sends a prompt.

## Nesting

- The sessions nested under the foreman: yes, by `automatic, no option: Desktop's own session record for each started session holds spawnedFrom {sessionId: the starter's id, taskId, title, sideSession: true, sharedFolder: true, name} and startChain {firstSessionId: the starter's id, depth: 1}. start_session has no parent, owner, group or 'started by' field. The run.js scan only reads top-level fields, so it found originCwd and lastSpawnRootDetected, not the nested spawnedFrom.`.
- The sidebar showed: not looked at: no screenshot was taken, to avoid a screen-access prompt for the director. The app lists all three as linked sessions of the starter (list_sessions linked).

## Offers

- Each `offer` must be the only call in its message, so there is no single Start all: one card per try.
- An offer in a turn that another session's message started is refused ("No card was shown: this turn's request did not come from someone at this app's composer"). The director typed one message per card: 4 messages and 3 clicks for 3 tries.
