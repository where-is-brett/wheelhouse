<!-- probes/36-telemetry/run.md -->

# Check 36: telemetry in Desktop sessions, for the director's sittings

What this finds out: whether a Desktop session sends Claude Code's usage counts to a local receiver when the telemetry settings (the four of `scripts/telemetry/env.js`, plus a fifth that only this probe adds, `OTEL_METRIC_EXPORT_INTERVAL=1000`) are put (1) in the user settings file's `env`, or (2) in the environment Desktop starts with (macOS `launchctl setenv`; Windows user environment variables), and whether Desktop needs a restart for each. A project's own settings are known not to work (check 7; the documentation says why, see `docs/checks/36-telemetry.md`), so they are not tried again here.

**It runs inside the sittings of check 35, not as sittings of its own.** On the Mac it is steps M1 to M8 (and the optional M8b) below, done in the throwaway account while it exists (they go in at step 10a of `probes/35-node/run.md`). On Windows it follows check 35's W6 (W7 there points here). The director's part on the Mac: one yes, and quitting and reopening Desktop twice (M6, M8), with a session started and a message pasted after each; a third time if a new session is not enough in trial 1, and the editor's clicks if the optional trial 3 is wanted. On Windows: one yes, a new session and the prompt in each trial, and quitting and reopening Desktop twice (W10, W11), with the same optional extras.

**What the script does** (`run.js`, Node.js 20 or later, no installs; on the Mac the system `node` 20.9.0 does). A capture server on 127.0.0.1 keeps only a summary of each request: the time, the URL, `service.name`, the metric names with their point counts and the token totals by kind. It does not keep the account's email or IDs, or the session. `mark <label>` starts a new count: `read` then counts only the requests that arrive after the latest mark (and says how many earlier ones it left out), so one trial's requests, or a session still running from the trial before, never make the next trial say "Points arrived: YES". `read --all` counts everything, `read --since <time>` from a time. `settings set|unset` adds and removes the five keys (`scripts/telemetry/env.js`'s `telemetryEnv(port)`, plus `OTEL_METRIC_EXPORT_INTERVAL=1000`, this probe only, so counts arrive within a second of each other) under `env` in a settings file, by key. A `--file` that is the running account's own user settings is treated as `--user` and guarded the same way. It first copies the file, notes which keys held a value before, and on `unset` puts those values back, leaves a key someone changed since, and checks the parsed file against the copy. `launch-env set|unset` does the same for the launch environment (it reads each variable first and puts it back or removes it). Neither route sets anything that records prompts or tool details.

**Rules for the agent**

- One route at a time: undo the first before trying the second. The documentation says a variable already in Desktop's launch environment wins over the same key in a settings file, so a leftover would spoil the second trial.
- Each trial has its own count: `node RUN mark "<trial>"` at the point the step says, before that trial's new session starts, and every `read` after it counts only from there. A Desktop quit ends every session started under the trial before, so each mark after a quit is clean.
- Every `set` is followed by its `unset` before the sitting ends, even when a trial finds nothing. Check with the commands under "Undo" below.
- Write each result into the notes file (Mac: `/Users/Shared/wheelhouse-check35/notes.md`, under a heading "Check 36, trial 1" and so on; Windows: `notes.md` in the check 36 folder, which `setup` starts). A Desktop restart ends the session that wrote it.
- Use the prompt exactly: `Write the numbers one to forty in words, one per line.` A session that answers it sends token usage as well as the session count.

## Before the sitting (the agent, in the director's own account)

Done together with step 1 of `probes/35-node/run.md`, from the Wheelhouse worktree, with the agent's own Node.js 22 by its full path:

```bash
<node 22> probes/36-telemetry/run.js setup --root /Users/Shared/wheelhouse-check35/check36
```

It makes `check36/` inside check 35's shared folder (readable and writable by any account): `run.js`, `env.js` (copied from `scripts/telemetry/env.js`) and `run.md`, `project/` (an empty folder with `hello.txt`, no settings, no plugin), `log/`, and `state.json` with a free port. It prints the port. Check 35's cleanup removes this folder with the rest.

## The Mac, in the throwaway account (step 10a of check 35)

Where it starts: Trials A to D of check 35 are finished, the director has reopened Desktop normally (Dock) and the agent is a Desktop session in the throwaway account with `Read` and `Bash` working. `RUN` below is `/Users/Shared/wheelhouse-check35/check36/run.js`, run with the `node` on PATH (20.9.0 is fine).

M1. **Opening card (a plain yes or no).** "To check how Desktop picks up the usage counts I will add five settings to this throwaway user's Claude settings (the four Wheelhouse would use, and one that makes the counts come every second), then take them out, and do the same with the user's launch environment. The counts go only to a small program on this computer, which I start and stop. It needs you to quit and reopen Desktop twice, and start a session after each. Nothing in your own account changes. Go ahead?" On a no, skip to step 10b of check 35 (check 37), in this session.

M2. **Start the receiver, apart from this session** (so quitting Desktop does not end it): `node RUN receiver --detach --minutes 60`. Run `node RUN read` once: it must say "Points arrived: NO". Write the port into the notes.

M3. **Trial 1, user settings.**
   - `node RUN settings set --user` (this account's `~/.claude/settings.json`; the account is new, so the file is probably created). Write down what it printed.
   - `node RUN mark "trial 1"`.
   - Start a **new** Desktop session in `/Users/Shared/wheelhouse-check35/check36/project` with `start_session` and send the prompt above. (If `start_session` is not available in Desktop, the director starts the session by hand and types the prompt. Desktop may ask to trust the folder: yes.) Do not restart Desktop yet.
   - After about 90 seconds: `node RUN read`. Write down: arrived or not; `service.name` (the documentation says `claude-code-desktop` for a local Desktop session); the metric names; whether token usage came (it needs the answer to finish).
   - If nothing arrived: **the director's restart click.** Quit Desktop (Claude menu, Quit) and reopen it from the Dock, start a new session in the same folder, giving it the notes file and saying this is check 36 trial 1 after the restart; it sends the prompt (this ends the agent's session; the new one reads the notes file first). No new mark: nothing arrived since "trial 1". Wait 90 seconds, `node RUN read`. Write down whether the restart made the difference.
   - If still nothing: look for the reason without printing values: `grep -il telemetry ~/Library/Logs/Claude/*.log` and, for each file found, the matching lines with any value after `=` or `:` left out. Write down what is there. Also ask the new session for `claude --version` or `/status` (the Claude Code version it runs; the project-settings rule needs 2.1.282 or later, the user-settings route has no version noted).

M4. **Undo trial 1.** `node RUN settings unset`. It must print "matches the copy taken before: YES" or, where the file did not exist, that it removed the file. Write it down. (The session started in M3 keeps its startup values until Desktop quits at M6; trial 2's mark comes after that quit.)

M5. **Trial 2, the launch environment.** `node RUN launch-env set` (runs `launchctl setenv` for this user; if it fails from the session, the director types the same command in Terminal.app in this user and the agent writes down what failed). It prints each variable read back. Write down the state in the notes ("launch-env set; receiver running; next: mark trial 2, start a session with the prompt, read, then unset") **before** the restart, since the restarted session starts blank, and give the director the message to paste after it: "This is check 36 trial 2. Read /Users/Shared/wheelhouse-check35/notes.md and /Users/Shared/wheelhouse-check35/check36/run.md, then carry on from M6's agent part." M8 gives a message in the same form before its quit ("check 36, after M8").

M6. **The director's restart click.** Quit Desktop completely (Claude menu, Quit) and reopen it from the Dock or Finder, **not** from Terminal (a program started from Terminal gets Terminal's environment, not the launch environment under test). Sign-in stays. Start a session in `/Users/Shared/wheelhouse-check35/check36/project` and paste the message the agent gave before the quit (it names the notes file and says this is check 36 trial 2). The agent, first thing: `node RUN mark "trial 2"`; then it starts a **new** session in the same folder with `start_session` and sends the prompt (or the director starts it by hand and types the prompt).

M7. After about 90 seconds: `node RUN read`. Write down arrived or not, `service.name`, metric names, token usage. If nothing arrived, run the grep in M3's last bullet.

M8. **Undo trial 2.** `node RUN launch-env unset`. It must print "Launch environment is back to how it was". Then `launchctl getenv CLAUDE_CODE_ENABLE_TELEMETRY` and `launchctl getenv OTEL_EXPORTER_OTLP_ENDPOINT` must print nothing. Write it in the notes. Then **the director's restart click**, so that Desktop drops the variables it started with: quit Desktop completely and reopen it from the Dock, start a session in `/Users/Shared/wheelhouse-check35/check36/project` (this folder has no plugin, so its tools keep working) and paste the message the agent gave before the quit (the notes file, and "check 36 after M8"). That session is the agent from here on, and check 37 (step 10b of check 35) goes on in it as its session X. Then, unless M8b follows, `node RUN stop`.

M8b. **Trial 3, optional: Desktop's local environment editor** (found in the documentation, not yet tried; the director's clicks only). Only after M8, so that nothing else is set.
   - **The control first.** `node RUN mark "control"`, then a **new** session in the check 36 `project` folder (with `start_session`, or by hand) with the prompt; after 90 seconds `node RUN read` must say "Points arrived: NO". If it says YES, something is still set: write it down, stop the trial here, and look for the leftover with M8's `launchctl getenv` lines and `cat ~/.claude/settings.json`.
   - `node RUN show-env` prints the five `NAME=value` lines (the endpoint holds the port); the agent reads them out. `node RUN mark "trial 3"`. **Director:** in the Code tab open the environment dropdown in the prompt box, hover **Local**, click the gear icon, add those five variables, save. Start a **new** session in the check 36 `project` folder, send the prompt; after 90 seconds `node RUN read`. If nothing arrived, the director quits and reopens Desktop from the Dock and tries once more (a new session and the prompt; no new mark). That quit ends session X too: before it, the agent writes where it is in the notes and gives the director a message in M5's form ("check 36, M8b after the restart"), and the session the director starts with it in `check36/project` is session X from then on. Write down arrived or not, whether a new session was enough, and what the editor looked like (the documentation says the variables are stored encrypted on the machine).
   - **Undo:** the director deletes the five variables in the same editor and saves; the agent asks them to reopen the editor and confirm none is left, and writes that down. Then `node RUN stop`.

Afterwards the sitting goes on at step 10b of check 35 (check 37), in the session M8 started. Before the account is removed (step 12 there), copy `check36/log/requests.jsonl` out with the notes file. It holds only the summaries.

## Windows (follows W6 of check 35, in the director's own account)

The agent works in a PowerShell window (or a terminal session), not in the Desktop session that gets restarted. `<root>` is the folder `setup` prints, and the commands run it as `node "<root>\run.js"` (in double quotes, see W7b), with `node` as in check 35 (put back on PATH: W5 of check 35 ended). `settings set --user` and `launch-env set` carry `--allow-own-account` here: the script refuses them on Windows without it, because they change this account's own settings, which is what this sitting does on purpose and then undoes.

W7a. **Opening card.** "To check how Desktop picks up the usage counts I will add five settings to your Claude user settings file (the four Wheelhouse would use, and one that makes the counts come every second), then take them out again, and do the same with five Windows user environment variables. The counts go only to a small program on this computer, which I start and stop. It needs you to quit and reopen Desktop twice, and start a session with a prompt in each trial. Each setting is removed by name afterwards, your settings file is checked against a copy taken first, and your other settings are left alone. Go ahead?"

W7b. **Paths in double quotes.** The temporary folder can have a space in its path (a user name with a space), so every command below that names `<root>` puts it in double quotes, and the quotes stay when the real folder is pasted in. `node probes/36-telemetry/run.js setup` (it prints the folder under `%TEMP%`, named `wheelhouse-check36-…`, and the port, and starts `<root>\notes.md`). `node "<root>\run.js" receiver --detach --minutes 60`, then `node "<root>\run.js" read` must say "Points arrived: NO". Note the starting facts in `<root>\notes.md`: `claude --version`, the Desktop Claude Code version (`/status` in Desktop, read out by the director), whether `%USERPROFILE%\.claude\settings.json` exists, and whether `CLAUDE_CONFIG_DIR` is set.

W8. **Trial 1, user settings.** `node "<root>\run.js" settings set --user --allow-own-account`, then `node "<root>\run.js" mark "trial 1"`. **Director:** with Desktop still running, start a **new** session in `<root>\project` (trust the folder) and send the prompt. After about 90 seconds: `node "<root>\run.js" read`. Write down arrived or not, `service.name`, the metric names, token usage. If nothing arrived, **the restart click:** the director quits Desktop completely (tray icon, Quit), reopens it from the Start menu, starts a new session in the same folder and sends the prompt again (no new mark); read again after 90 seconds and write down whether the restart made the difference.

W9. **Undo trial 1.** `node "<root>\run.js" settings unset`; it must print the matches-the-copy line (or that it removed the file).

W10. **Trial 2, user environment variables.** `node "<root>\run.js" launch-env set --allow-own-account` (PowerShell `SetEnvironmentVariable` at user level). **Director:** quit Desktop completely (tray icon, Quit), which ends trial 1's session. The agent then runs `node "<root>\run.js" mark "trial 2"`. **Director:** reopen Desktop from the Start menu; start a session in `<root>\project` and send the prompt. After 90 seconds `node "<root>\run.js" read`. If nothing arrived, ask the director to sign out of Windows and in again, reopen Desktop, repeat (no new mark), and write down whether that was needed.

W11. **Undo trial 2.** `node "<root>\run.js" launch-env unset`, then check each is empty: `[Environment]::GetEnvironmentVariable('CLAUDE_CODE_ENABLE_TELEMETRY','User')` and the same for `OTEL_EXPORTER_OTLP_ENDPOINT`. **Director:** quit Desktop and reopen it from the Start menu, so it drops them. Then, unless W11b follows, `node "<root>\run.js" stop`.

W11b. **Trial 3, optional: Desktop's local environment editor** (found in the documentation, not yet tried; the director's clicks only).
   - **The control first.** `node "<root>\run.js" mark "control"`. **Director:** a **new** session in `<root>\project` with the prompt. After 90 seconds `node "<root>\run.js" read` must say "Points arrived: NO"; if it says YES, something is still set: write it down, stop the trial, and look with W11's lines and the settings file.
   - Run `node "<root>\run.js" show-env` and read the five `NAME=value` lines out to the director (the endpoint holds the port), then `node "<root>\run.js" mark "trial 3"`. **Director:** in the Code tab open the environment dropdown in the prompt box, hover **Local**, click the gear icon, add those five variables, save. Start a **new** session in `<root>\project`, send the prompt, and after 90 seconds `node "<root>\run.js" read`; if nothing arrived, restart Desktop and try once more (no new mark). Write down arrived or not, whether a new session was enough, and what the editor looked like.
   - **Undo:** the director deletes the five variables in the same editor and saves; the agent asks them to reopen the editor and confirm none is left, and writes that down. Then `node "<root>\run.js" stop`.

W12. Copy the results out before the folder goes, every time: `New-Item -ItemType Directory -Force "$env:TEMP\check36-results"; Copy-Item "<root>\notes.md", "<root>\log\requests.jsonl" "$env:TEMP\check36-results"`, and check both copies are there (`Get-ChildItem "$env:TEMP\check36-results"`). Then `node "<root>\run.js" cleanup "<root>"`. The copies (summaries only) come back with check 35's.

## Undo, in one place

On Windows read `node RUN` as `node "<root>\run.js"` (double quotes). `unset` needs no `--allow-own-account`, so an undo is never refused.

- Settings route: `node RUN settings unset` removes only the keys this probe wrote (by key), puts back any value a key held before, deletes `env` if it did not exist before and the file if it did not exist before and is empty. The copy it compares with is `settings.before.json` in the check 36 folder.
- Launch route, macOS: `node RUN launch-env unset`; by hand, `launchctl unsetenv` for `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_METRIC_EXPORT_INTERVAL`. `launchctl setenv` does not survive a restart of the Mac in any case.
- Launch route, Windows: `node RUN launch-env unset`; by hand, Settings, System, About, Advanced system settings, Environment Variables, and delete the same five names under "User variables"; or in PowerShell `[Environment]::SetEnvironmentVariable('<name>', $null, 'User')` for each.
- Desktop's local environment editor (optional trial): the director deletes the five variables there and saves; nothing in a file or command undoes it.
- The receiver: `node RUN stop` (it also ends by itself after the minutes given).
- Desktop itself: after each launch-route undo, the director quits and reopens Desktop (M8, W11), since a running Desktop keeps the variables it started with.

## What to bring back

For each system and each route: arrived or not; `service.name`; the metric names and whether token usage came; whether a new session was enough or Desktop had to be restarted (and, on Windows, a sign-out); the Claude Code version the Desktop session ran; the exact output of each `unset`; and any error from `launchctl` or the PowerShell calls.
