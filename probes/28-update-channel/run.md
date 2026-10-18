<!-- probes/28-update-channel/run.md -->

# Check 28: the update settings, for the director's sitting

What this finds out: whether the Claude Code inside Claude Desktop follows two settings, the stable channel and a minimum version. It takes about ten minutes on each computer. The settings file is copied first and put back at the end.

The two settings go in the user settings file (`~/.claude/settings.json`; on Windows `%USERPROFILE%\.claude\settings.json`). The agent edits that file. The director quits and reopens Desktop and reads out what they see.

**The agent works from a terminal, not from a Desktop session.** Quitting Desktop ends any Desktop session, so the agent runs in a terminal session (or a plain terminal) opened for the sitting, and keeps its notes in a file, not in its memory.

**The director does not accept any update.** Where a step says to look at the Check for Updates menu, the director looks at what it says and chooses Not now or Cancel. If it starts downloading by itself, the director says so and the agent writes it down. The one step that may let Desktop update itself is marked below.

## Before anything

1. **The agent takes a copy and a notes file.** With Node.js (so it works the same on both systems), it creates a folder `wheelhouse-check28` under `os.tmpdir()` and writes into it:
   - `settings.json.before`, a copy of the user settings file (or, if there is no such file, a note in `state.json` saying so, so the file is deleted at the end instead of left empty);
   - `state.json`, holding the copy's full path, the settings file's size and SHA-256, which of `autoUpdatesChannel`, `minimumVersion` and `env.DISABLE_AUTOUPDATER` / `env.DISABLE_UPDATES` the file already holds (and their values), and, as the steps go, each version read.

   If `DISABLE_AUTOUPDATER` or `DISABLE_UPDATES` is set, the agent says so and stops: it would spoil the trial.
2. **Read the starting point.**
   - **Start version:** the director starts a new local session in the Desktop Code tab, types `/status` and reads out the "Claude Code" row (the agent is in a terminal and cannot see it). The same goes for every `/status` reading below.
   - **Terminal version:** `claude --version` in the terminal.
   - **Desktop's copies:** list the folder where Desktop keeps its own copies of Claude Code, one subfolder per version. On the Mac that is `~/Library/Application Support/Claude/claude-code/`. On Windows it is expected at `%APPDATA%\Claude\claude-code\`, but that has not been seen; if it is not there, the agent looks under `%APPDATA%\Claude` and `%LOCALAPPDATA%` for a `claude-code` folder and writes down where it is.
   - **What is available:** fetch the latest version number from `https://downloads.claude.ai/claude-code-releases/latest` and the stable one from `.../stable`. The trial can only tell following from ignoring if the latest is newer than the start version; if not, say so now (see "Reading the result"). If `downloads.claude.ai` is blocked (a work network), note it. `claude update` has no check-only form (its help lists no options but help), so it must not be used to find the version: it would install. Without the number the answer is "cannot tell".
   - Write all of these into `state.json`.
3. **Does Desktop show a channel?** In the Code tab, try `/doctor` and open Settings, Claude Code (`/config` opens it). Write down exactly what each shows or says it cannot do, including any "Auto-update channel" line. Nothing is promised here; it is a look.

## Trial A: stable channel, minimum a little below (the harmless one)

4. The agent adds two keys to the user settings file and leaves every other key as it is. For the minimum it uses a valid version just below the start version: lower the last number by one (start 2.1.299, minimum "2.1.298"); if the last number is 0, use the previous minor (start 2.2.0, minimum "2.1.0"); if that is also 0, use the previous major (start 3.0.0, minimum "2.0.0"). It writes the two values to `state.json`.

   ```json
   {
     "autoUpdatesChannel": "stable",
     "minimumVersion": "2.1.298"
   }
   ```

5. **Director:** (for each trial the agent records how long Desktop had been open when `/status` was read.) Quit Claude Desktop completely (the Claude menu, Quit, on the Mac; the tray icon, Quit, on Windows), reopen it and start a new local session in the Code tab.
6. The director types `/status` in that session and reads out the "Claude Code" row; the agent lists Desktop's folder of copies again. Record whether the version or the folder changed.
7. The agent runs `claude doctor` in the terminal and writes down the "Auto-updates" line and any channel it reports (this only shows that the terminal command reads the settings).

This trial cannot tell following from ignoring. The stable version is below the installed version and the minimum only forbids going lower, so "no change" is what both would do. It shows the settings cause no harm and that the terminal reads them.

## Trial B: a minimum above every available version (the one that tells)

8. The agent changes only the minimum, to "9.0.0", above any version that exists. The channel stays "stable". Written to `state.json`.
9. **Director:** quit Desktop completely and reopen it, then wait two minutes (Desktop checks on its own at launch and from time to time), then start a new local session.
10. The director reads out `/status`, and the agent lists Desktop's folder of copies. Record whether the version went up, whether a new subfolder appeared, and any message, warning or error about the version. The expectation from the documentation is that nothing refuses to start, because this minimum only limits updates.
11. **Director:** open the Check for Updates menu and read out what it says. Do not accept. The agent writes it down.

## Trial C: the settings off again (the control)

12. The agent takes the settings back to how they were, carefully. It compares the settings file with "the copy plus the two keys" (`settings.json.before` with `autoUpdatesChannel` "stable" and `minimumVersion` "9.0.0" added). The comparison is of parsed JSON (the same keys and values), not of bytes, since Claude Code may reformat the file. If they match, it copies `settings.json.before` back over the settings file (or deletes the file, if there was none before). If they do not match, something else changed the file meanwhile (for example Claude Code rewrote a key): it does not overwrite, it removes only those two keys and writes down what else differed. Then it compares the file with `settings.json.before`, again as parsed JSON (the size and SHA-256 in `state.json` are for the record), and, if they differ, reports exactly how and leaves the file for the director to decide. Written to `state.json`.
13. **Ask first.** Before this step the agent asks the director a yes or no question, in a card, and goes no further without a yes. In plain words: "Next, with the settings off, Claude Desktop may download a newer Claude Code on its own. This cannot be undone: the updated copy and its new version folder stay on this computer, and Desktop may restart itself to install an app update. It is what Desktop would do anyway with no settings. Go ahead?" If the answer is no, the trial stops here, the result is "cannot tell" unless Trial B already showed the copy moving, and the agent goes to Finishing.

    **Director (after a yes):** quit Desktop completely and reopen it, wait two minutes, start a new local session. The director does not click anything to accept an update.
14. The director reads out `/status`, and the agent lists Desktop's folder again and records whether the version went up.

## Reading the result

This rule needs a newer version to exist than the one Desktop has. It was written when the latest was 2.1.302 and Desktop's copies were 2.1.299 and 2.1.295.

- **Desktop ignores the settings:** the copy went up to a newer version in Trial B (with the minimum at "9.0.0", a Desktop that followed it would install nothing).
- **Desktop follows the settings:** the copy did not move in Trial B, and it did move to a newer version in Trial C. The settings held it back and removing them let it through.
- **Cannot tell:** the copy did not move in either trial (Desktop updates on its own schedule, or it was already on the newest), or the latest was not newer than the start version. Say so plainly. No trial that avoids installing can tell more than this. Record how long Desktop was open in each trial, and do not guess.
- **Anything refused to start, or an error mentioned the version:** write down the exact words. That is a separate finding.

## Finishing

15. **Director:** quit and reopen Desktop once more if Trial C's reopening left it on anything else. The director reads out `/status` to show it still reads a version and that the settings file is as step 12 left it, and tells the director the settings are as they were (or says exactly how they differ).

## What to bring back

For each computer: the start version, the terminal version, the versions in Desktop's folder at each step, the version after Trial A, Trial B and Trial C, what the Check for Updates menu said, what `/doctor` and Settings, Claude Code showed, the `claude doctor` line, which of the four results above it was, and the latest and stable numbers fetched. Windows is the same steps with the Windows paths above, and the agent writes down where Desktop's folder of copies turned out to be.
