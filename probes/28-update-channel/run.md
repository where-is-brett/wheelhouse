<!-- probes/28-update-channel/run.md -->

# Check 28: the update settings, for the director's sitting

What this finds out: whether the Claude Code inside Claude Desktop follows two settings, the stable channel and a minimum version. It takes about five minutes on each computer. Nothing is installed and nothing is deleted. The settings file is copied first and put back at the end.

The two settings go in the user settings file (`~/.claude/settings.json`; on Windows `%USERPROFILE%\.claude\settings.json`). The agent edits that file; the director only quits and reopens Desktop and reads out a version.

## Before anything

1. **The agent takes a copy.** It copies the user settings file to a scratch folder (outside the repository) as `settings.json.before`, and records the file's size and a fingerprint (`shasum -a 256` on the Mac, `Get-FileHash` on Windows). If the file does not exist, it records that, so it can delete the file at the end instead of leaving an empty one.
2. **Read the starting versions.**
   - In Desktop, in a local session in the Code tab, the agent types `/status` and reads the "Claude Code" row. Call it the **start version**.
   - In a terminal, `claude --version`. Call it the **terminal version**.
   - The agent notes which of `autoUpdatesChannel`, `minimumVersion` and `env.DISABLE_AUTOUPDATER` the file already holds, and their values. If `DISABLE_AUTOUPDATER` or `DISABLE_UPDATES` is set, it says so and stops: that would spoil the trial.

## Trial A: stable channel and a minimum one below

3. The agent adds these two keys to the user settings file, leaving every other key as it is. For the minimum it uses the start version with its last number lowered by one (start version 2.1.299, minimum "2.1.298"):

   ```json
   {
     "autoUpdatesChannel": "stable",
     "minimumVersion": "2.1.298"
   }
   ```

4. **Director:** quit Claude Desktop completely (Claude menu, Quit on the Mac; right-click the tray icon and Quit on Windows), reopen it, and start a new local session in the Code tab.
5. The agent types `/status` and reads the "Claude Code" row. Write down whether it is the same as the start version or different. Also write down what **Claude, Check for Updates** (Windows: **Help, Check for Updates**) says, and whether it offers anything.
6. The agent lists the folder where Desktop keeps its own copies of Claude Code (on the Mac, `claude-code` inside Claude's application-support folder) and notes the versions present, before and after.
7. The agent runs `claude doctor` in a terminal and notes the "Auto-updates" line and the channel it reports, so we know the terminal command reads the settings.

## Trial B: a minimum above the installed version

8. The agent changes only the minimum, to a version far above anything published ("9.0.0"). The channel stays "stable".
9. **Director:** quit Desktop completely, reopen it, start a new local session.
10. The agent notes: does the session start; does `/status` read the same version; does Desktop show any message, warning or error about the version; does Check for Updates behave differently. The expectation from the documentation is that nothing is refused, because the minimum only limits updates and does not block starting. Any refusal to start would be a surprise worth recording exactly.
11. The agent notes whether the folder of Desktop's copies gained or lost a version.

## Putting it back

12. The agent restores the user settings file from `settings.json.before` (or deletes it if it did not exist), then checks the size and fingerprint match step 1. If anything else has changed in the file in the meantime (for example Claude Code rewrote the channel key through its own `/config`), the agent removes only the two keys it added and says what it saw.
13. **Director:** quit and reopen Desktop once more so it runs on the original settings. The agent checks `/status` still reads a version, and tells the director the settings are as they were.

## What to bring back

For each computer: the start version, the terminal version, the version after Trial A, what happened in Trial B, the versions in Desktop's folder before and after, and the `claude doctor` line. Windows is the same steps, with the Windows paths above.
