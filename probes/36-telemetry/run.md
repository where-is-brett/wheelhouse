<!-- probes/36-telemetry/run.md -->

# Check 36: telemetry in Desktop sessions, for the director's sittings

What this finds out: whether a Desktop session sends Claude Code's usage counts to a local receiver when the four telemetry settings are put (1) in the user settings file's `env`, or (2) in the environment Desktop starts with (macOS `launchctl setenv`; Windows user environment variables), and whether Desktop needs a restart for each. A project's own settings are known not to work (check 7; the documentation says why, see `docs/checks/36-telemetry.md`), so they are not tried again here.

**It runs inside the sittings of check 35, not as sittings of its own.** On the Mac it is steps M1 to M8 below, done in the throwaway account while it exists (they go in at step 10a of `probes/35-node/run.md`). On Windows it follows check 35's W6 (W7 there points here). Nothing here needs more of the director than a Desktop restart and, on the Mac, quitting and reopening Desktop once more.

**What the script does** (`run.js`, Node.js 20 or later, no installs; on the Mac the system `node` 20.9.0 does). A capture server on 127.0.0.1 keeps only a summary of each request: the time, the URL, `service.name`, the metric names with their point counts and the token totals by kind. It does not keep the account's email or IDs, or the session. `settings set|unset` adds and removes the keys of `scripts/telemetry/env.js`'s `telemetryEnv(port)`, plus `OTEL_METRIC_EXPORT_INTERVAL=1000` (this probe only, so counts arrive within a second of each other), under `env` in a settings file, by key. It first copies the file, notes which keys held a value before, and on `unset` puts those values back, leaves a key someone changed since, and checks the parsed file against the copy. `launch-env set|unset` does the same for the launch environment (it reads each variable first and puts it back or removes it). Neither route sets anything that records prompts or tool details.

**Rules for the agent**

- One route at a time: undo the first before trying the second. The documentation says a variable already in Desktop's launch environment wins over the same key in a settings file, so a leftover would spoil the second trial.
- Every `set` is followed by its `unset` before the sitting ends, even when a trial finds nothing. Check with the commands under "Undo" below.
- Write each result into the notes file (Mac: `/Users/Shared/wheelhouse-check35/notes.md`, under a heading "Check 36, trial 1" and so on; Windows: `notes.md` in the check 36 folder). A Desktop restart ends the session that wrote it.
- Use the prompt exactly: `Write the numbers one to forty in words, one per line.` A session that answers it sends token usage as well as the session count.

## Before the sitting (the agent, in the director's own account)

Done together with step 1 of `probes/35-node/run.md`, from the Wheelhouse worktree, with the agent's own Node.js 22 by its full path:

```bash
<node 22> probes/36-telemetry/run.js setup --root /Users/Shared/wheelhouse-check35/check36
```

It makes `check36/` inside check 35's shared folder (readable and writable by any account): `run.js`, `env.js` (copied from `scripts/telemetry/env.js`) and `run.md`, `project/` (an empty folder with `hello.txt`, no settings, no plugin), `log/`, and `state.json` with a free port. It prints the port. Check 35's cleanup removes this folder with the rest.

## The Mac, in the throwaway account (step 10a of check 35)

Where it starts: Trials A to D of check 35 are finished, the director has reopened Desktop normally (Dock) and the agent is a Desktop session in the throwaway account with `Read` and `Bash` working. `RUN` below is `/Users/Shared/wheelhouse-check35/check36/run.js`, run with the `node` on PATH (20.9.0 is fine).

M1. **Opening card (a plain yes or no).** "To check how Desktop picks up the usage counts I will add four settings to this throwaway user's Claude settings, then take them out, and do the same with the user's launch environment. The counts go only to a small program on this computer, which I start and stop. It needs you to quit and reopen Desktop once, in the middle. Nothing in your own account changes. Go ahead?" On a no, skip to step 11 of check 35.

M2. **Start the receiver, apart from this session** (so quitting Desktop does not end it): `node RUN receiver --detach --minutes 60`. Run `node RUN read` once: it must say "Points arrived: NO". Write the port into the notes.

M3. **Trial 1, user settings.**
   - `node RUN settings set --user` (this account's `~/.claude/settings.json`; the account is new, so the file is probably created). Write down what it printed.
   - Start a **new** Desktop session in `/Users/Shared/wheelhouse-check35/check36/project` with `start_session` and send the prompt above. (If `start_session` is not available in Desktop, the director starts the session by hand and types the prompt. Desktop may ask to trust the folder: yes.) Do not restart Desktop yet.
   - After about 90 seconds: `node RUN read`. Write down: arrived or not; `service.name` (the documentation says `claude-code-desktop` for a local Desktop session); the metric names; whether token usage came (it needs the answer to finish).
   - If nothing arrived: **the director's restart click.** Quit Desktop (Claude menu, Quit) and reopen it from the Dock, start a new session in the same folder and send the prompt again (this ends the agent's session; the new one reads the notes file first). Wait 90 seconds, `node RUN read`. Write down whether the restart made the difference.
   - If still nothing: look for the reason without printing values: `grep -il telemetry ~/Library/Logs/Claude/*.log` and, for each file found, the matching lines with any value after `=` or `:` left out. Write down what is there. Also ask the new session for `claude --version` or `/status` (the Claude Code version it runs; the project-settings rule needs 2.1.282 or later, the user-settings route has no version noted).

M4. **Undo trial 1.** `node RUN settings unset`. It must print "matches the copy taken before: YES" or, where the file did not exist, that it removed the file. Write it down.

M5. **Trial 2, the launch environment.** `node RUN launch-env set` (runs `launchctl setenv` for this user; if it fails from the session, the director types the same command in Terminal.app in this user and the agent writes down what failed). It prints each variable read back. Write down the state in the notes ("launch-env set; receiver running; next: read, then unset") **before** the restart, since the restarted session starts blank.

M6. **The director's restart click.** Quit Desktop completely (Claude menu, Quit) and reopen it from the Dock or Finder, **not** from Terminal (a program started from Terminal gets Terminal's environment, not the launch environment under test). Sign-in stays. Start a session in `/Users/Shared/wheelhouse-check35/check36/project`; the director gives it the notes file path and says this is check 36 trial 2. Its first message is the prompt.

M7. After about 90 seconds: `node RUN read`. Write down arrived or not, `service.name`, metric names, token usage. If nothing arrived, run the grep in M3's last bullet.

M8. **Undo trial 2.** `node RUN launch-env unset`. It must print "Launch environment is back to how it was". Then `launchctl getenv CLAUDE_CODE_ENABLE_TELEMETRY` and `launchctl getenv OTEL_EXPORTER_OTLP_ENDPOINT` must print nothing. Then `node RUN stop`.

Afterwards the sitting goes on at step 11 of check 35. Before the account is removed (step 12 there), copy `check36/log/requests.jsonl` out with the notes file. It holds only the summaries.

## Windows (follows W6 of check 35, in the director's own account)

The agent works in a PowerShell window (or a terminal session), not in the Desktop session that gets restarted. `RUN` is `<root>\run.js`, with `node` as in check 35 (put back on PATH: W5 of check 35 ended).

W7a. **Opening card.** "To check how Desktop picks up the usage counts I will add four settings to your Claude user settings file, then take them out again, and do the same with four Windows user environment variables. The counts go only to a small program on this computer, which I start and stop. It needs you to restart Desktop twice. Each setting is removed by name afterwards and your other settings are left alone. Go ahead?"

W7b. `node probes/36-telemetry/run.js setup` (it prints the folder under `%TEMP%`, named `wheelhouse-check36-…`, and the port). `node <root>\run.js receiver --detach --minutes 60`, then `node <root>\run.js read` must say "Points arrived: NO". Note the starting facts in `<root>\notes.md`: `claude --version`, the Desktop Claude Code version (`/status` in Desktop, read out by the director), whether `%USERPROFILE%\.claude\settings.json` exists, and whether `CLAUDE_CONFIG_DIR` is set.

W8. **Trial 1, user settings.** `node RUN settings set --user`. **Director:** with Desktop still running, start a **new** session in `<root>\project` (trust the folder) and send the prompt. After about 90 seconds: `node RUN read`. Write down arrived or not, `service.name`, the metric names, token usage. If nothing arrived, **the restart click:** the director quits Desktop completely (tray icon, Quit), reopens it from the Start menu, starts a new session in the same folder and sends the prompt again; read again after 90 seconds and write down whether the restart made the difference.

W9. **Undo trial 1.** `node RUN settings unset`; it must print the matches-the-copy line (or that it removed the file).

W10. **Trial 2, user environment variables.** `node RUN launch-env set` (PowerShell `SetEnvironmentVariable` at user level). **Director:** quit Desktop completely and reopen it from the Start menu; start a session in `<root>\project` and send the prompt. After 90 seconds `node RUN read`. If nothing arrived, ask the director to sign out of Windows and in again, reopen Desktop, repeat, and write down whether that was needed.

W11. **Undo trial 2.** `node RUN launch-env unset`, then check each is empty: `[Environment]::GetEnvironmentVariable('CLAUDE_CODE_ENABLE_TELEMETRY','User')` and the same for `OTEL_EXPORTER_OTLP_ENDPOINT`. **Director:** quit Desktop and reopen it so it drops them. `node RUN stop`.

W12. Copy `<root>\notes.md` and `<root>\log\requests.jsonl` out if wanted, then `node RUN cleanup <root>`.

## Undo, in one place

- Settings route: `node RUN settings unset` removes only the keys this probe wrote (by key), puts back any value a key held before, deletes `env` if it did not exist before and the file if it did not exist before and is empty. The copy it compares with is `settings.before.json` in the check 36 folder.
- Launch route, macOS: `node RUN launch-env unset`; by hand, `launchctl unsetenv` for `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_METRIC_EXPORT_INTERVAL`. `launchctl setenv` does not survive a restart of the Mac in any case.
- Launch route, Windows: `node RUN launch-env unset`; by hand, Settings, System, About, Advanced system settings, Environment Variables, and delete the same five names under "User variables"; or in PowerShell `[Environment]::SetEnvironmentVariable('<name>', $null, 'User')` for each.
- The receiver: `node RUN stop` (it also ends by itself after the minutes given).

## What to bring back

For each system and each route: arrived or not; `service.name`; the metric names and whether token usage came; whether a new session was enough or Desktop had to be restarted (and, on Windows, a sign-out); the Claude Code version the Desktop session ran; the exact output of each `unset`; and any error from `launchctl` or the PowerShell calls.
