<!-- probes/35-node/run.md -->

# Check 35: Node.js and the hooks, for the director's sittings

What this finds out: whether Wheelhouse's hooks find `node` when Claude Desktop runs them on a fresh account, what PATH Desktop gives a hook (printed by a logging hook, not guessed), and what a Desktop session does when `node` is not there, since the guards carry `onFailure: block`. Sitting 1 is on the Mac and holds checks 36 (step 10a) and 37 (step 10b) as well: about an hour and a quarter at the computer, about 45 minutes of it the director's own steps (the list is in `docs/checks/35-node.md`, "Needs the director"). Sitting 2 is on a Windows computer.

**What is already known (19 October 2026, `docs/checks/35-node.md`).** A headless session in a scratch project with the plugin loaded, started with `node` off PATH, has every `Read` and `Bash` call refused: `PreToolUse:Read hook error: [node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/tool-guard.js"]: failed; blocking because onFailure is "block"`, then `/bin/sh: node: command not found`. Putting `node` into a folder already on PATH, with the session still running, let the next call through. The sittings find out whether Desktop does the same.

**This Mac has a system-wide Node.js already:** `/usr/local/bin/node`, version 20.9.0 (from an installer run in 2023), below the plugin's floor of 22. A new account sees it too: a fresh account has no shell profile of its own, but `/etc/zprofile` runs `path_helper`, which puts every folder in `/etc/paths`, `/usr/local/bin` among them, at the front of PATH for any login shell, and the Desktop documentation says a Dock launch reads the shell profile. A fresh account here is therefore not a "no Node.js" account, and a short PATH given on a command line would be undone by that profile. So for Trials C and D the agent writes a `~/.zprofile` in the throwaway account that sets a short PATH after `path_helper` has run, and the director reopens Desktop from the Dock: either Desktop reads the profile and gets the short PATH, or it does not and gets launchd's default PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). Neither holds `node`. The shell hook's log says which it was.

**Which `node` runs what.** In the director's own account the agent uses its own Node.js 22 or later, by its full path (check it with `<path> --version`), never `/usr/local/bin/node`: that is set-up (step 1) and cleanup (step 14). In the throwaway account the `node` on PATH is the system's 20.9.0, which the probe scripts of checks 35 and 36 accept (they need Node.js 20 or later); the plugin's hooks run on it too, which Trial A records.

**The notes file.** One file keeps every result: `/Users/Shared/wheelhouse-check35/notes.md` (made by step 1, writable by both accounts). Results must not live only in a session's memory, because the trials restart Desktop. The agent appends to it after every step that leaves its tools working. Each entry holds what was asked, whether each call went through, the exact words shown, and the logged PATH. In Trials C and D the session's `Read` and `Bash` are refused, so it can neither read nor write a file: the director pastes nothing into the notes, because the session's transcript (kept by Desktop under `~/.claude/projects/-Users-Shared-wheelhouse-check35-project/`) and the hooks' logs (`/Users/Shared/wheelhouse-check35/log/`) hold what happened, and the agent copies them into the notes once its tools work again (step 10).

**Messages after a restart.** A restarted Desktop starts a blank session. Before each quit, the agent writes in the notes where it is and gives the director a one-line message to paste into the new session (it names `run.md`, the notes file and the step to carry on from). At step 4 and step 5 the director types a short line instead, given below.

## Before anything (the agent, in the director's own account)

0. **The opening card.** Ask the director, in a card, and go no further without a yes. In plain words: "To check this on a clean account I need to make a throwaway user on this Mac, log into it with you, and delete it afterwards. Making and deleting it asks for your administrator password, typed by you in Terminal: I never see it. Deleting the user deletes its files. Checks 36 (usage counts) and 37 (the install line) run in the same throwaway user. It takes about an hour and a quarter at the computer; your part is about 45 minutes of it: the two Terminal lines and passwords, logging in, signing in to Claude there, quitting and reopening Claude four times, a few pasted lines, and the install line. Nothing in your own account changes. Go ahead?" On a no, the sitting does not happen.
1. **Make the shared folder.** From the Wheelhouse worktree, with the agent's own Node.js 22 or later by its full path:

   ```bash
   <node 22> probes/35-node/run.js setup --root /Users/Shared/wheelhouse-check35 --plugin-from "$PWD"
   ```

   This writes, under `/Users/Shared/wheelhouse-check35`, readable and writable by any account: `run.js` and `run.md` (copies, so the other account can read them), `project/` (a scratch project whose `.claude/settings.json` has the two logging hooks, on `SessionStart` and on every tool call), `log/` (where they write), `marketplace/` (a scratch marketplace holding a copy of the plugin, named `wheelhouse-check35`) and `notes.md`. It prints the paths. Check that `project/.claude/settings.json` names `/Users/Shared/wheelhouse-check35/run.js`.
   Check 36 (telemetry in Desktop sessions) is tried in this same sitting; make its folder now, while the worktree is readable, with the command under "Before the sitting" in `probes/36-telemetry/run.md`.
   Check 37 (the pasted install line) is tried in this same sitting too; make its folder now, with the commands under "Before the sitting" in `probes/37-install-line/run.md`. It needs the tag `v0.0.0-probe37` pushed beforehand (the main session does that; see "The tag" there): check it is readable without a login; if it is not, step 10b is left out and the rest goes ahead.
2. **Take stock of the Mac** and append it to the notes file under the "Starting point" heading the template starts with: `/usr/local/bin/node --version`, `ls -l /usr/local/bin/node`, `cat /etc/paths`, `cat /etc/zprofile`, and `claude --version`. Then tell the director the line they will type at step 4: `Follow /Users/Shared/wheelhouse-check35/run.md from step 5.` This session stays running in the director's account behind the switch and carries on at step 12.

## Making the throwaway user (the director types, the agent waits)

3. **Director,** in Terminal.app, one line. It asks for the administrator password (sudo), then for the new user's password, twice. The director chooses any password and keeps it for the log-in at step 4.

   ```bash
   sudo sysadminctl -addUser wh35probe -fullName "Wheelhouse check 35" -password -
   ```

   The user is a standard one (not an administrator). The agent then checks `dscl . -read /Users/wh35probe UniqueID` and `ls /Users`.

## In the throwaway user (the director logs in; the agent works in a Desktop session there)

4. **Director:** Apple menu, then the fast-switch menu in the menu bar (or Lock Screen, Switch User), and log in as "Wheelhouse check 35". Dismiss the set-up prompts (skip Apple ID, Siri and so on). Open Claude Desktop (from /Applications) and sign in with their own Claude sign-in. Open the Code tab, start a local session in the folder `/Users/Shared/wheelhouse-check35/project`, and type: `Follow /Users/Shared/wheelhouse-check35/run.md from step 5.` If Desktop asks to trust the folder, the director says yes. The agent is that session, and reads the notes file first.
5. **Install the plugin from the scratch marketplace** (project scope, the same route as check 24). The agent, from the project folder, with the `claude` that Desktop keeps under `~/Library/Application Support/Claude/claude-code/<version>/` (find it with `ls`; write the version into the notes):

   ```bash
   "<that claude>" plugin marketplace add /Users/Shared/wheelhouse-check35/marketplace --scope project
   "<that claude>" plugin install wheelhouse@wheelhouse-check35 --scope project
   ```

   If that fails, write down what it said; the fall-back is the director typing `/plugin marketplace add /Users/Shared/wheelhouse-check35/marketplace`, then `/plugin install wheelhouse@wheelhouse-check35` (project scope) in the session. Then the plugin is read at a session's start: the agent writes in the notes that step 5 is done, and the **director** starts a new session in the same folder and types `Follow /Users/Shared/wheelhouse-check35/run.md from step 6.` The new session writes down whether `wheelhouse` is loaded (the director says what the session start showed, if anything).
6. **Trial A: Node.js found.** The agent, in this session: read `hello.txt` with the Read tool, then run `echo hi` with the Bash tool; write down what happened with each, quoting any hook message. Then run `node /Users/Shared/wheelhouse-check35/run.js read /Users/Shared/wheelhouse-check35/log` and write down: the `execPath`, the version, and the full PATH of the first line (the SessionStart one), and the shell hook's `node=` line. Also write down what the session start showed the director, if anything.
7. **Is the version a problem?** The system `node` is 20.9.0 and the plugin asks for 22 or later. Write down whether the Wheelhouse guards ran quietly in Trial A (no error in the session) and the Node.js version the hooks logged.
8. **Trial B: the installer (optional; ask first).** This changes the computer for every account: the official installer replaces `/usr/local/bin/node` (20.9.0) with the current LTS, and asks for an administrator password typed by the director. **This step is not reversed in this sitting.** macOS has no simple uninstall for the official installer (an older Node.js package could be reinstalled by hand, which is not part of this sitting), and the throwaway user's deletion does not touch it: the installer writes to `/usr/local` for every user, so the Mac is left on the newer LTS afterwards, in place of the 20.9.0 that step 2 recorded in the notes file. A card, saying so: "Run the official Node.js installer now, to see whether a running Desktop session notices it? It will not be put back in this sitting: it replaces the Node.js on this Mac (20.9.0, recorded in the notes) with the current LTS for every user, and I will not reinstall the old one. It needs your administrator password, and one more quit and reopen of Claude. Options: skip it (recommended: the answer for a running Desktop is cheaper to get from Trial D); run it." On a skip, go to step 9. On a run: the agent downloads nothing by itself; the director opens https://nodejs.org, takes the macOS installer for the LTS, runs it, types the password. Then the agent repeats step 6's two calls in the same session (no restart) and reads the log again. Write down whether the execPath or version changed without a restart; then, with a message ready as above, the director quits and reopens Desktop from the Dock and starts a new session in the project folder, and the agent repeats it once more.
9. **Trials C and D: Desktop with no `node`, then `node` put on PATH with the session running.** One Desktop restart serves both: Trial C is the session's first two calls, Trial D the same calls again after `node` is put on its PATH (what the installer does to a folder already on PATH).
   - **The agent, while its tools still work:**

     ```bash
     mkdir -p /Users/Shared/wheelhouse-check35/bin-d && ls -A /Users/Shared/wheelhouse-check35/bin-d
     test -e ~/.zprofile && echo "STOP: ~/.zprofile exists" || echo 'export PATH=/Users/Shared/wheelhouse-check35/bin-d:/usr/bin:/bin:/usr/sbin:/sbin  # check 35, Trials C and D; removed at step 10' > ~/.zprofile
     zsh -l -c 'echo "$PATH"; command -v node || echo "no node"'
     ```

     The `ls` must print nothing (the folder is empty) and the last line must print the short PATH and `no node`. If `~/.zprofile` already exists, stop and say so. Write into the notes the time (`date -u +%FT%TZ`) and "Trials C and D: ~/.zprofile written, bin-d empty". Then give the director this message to copy:

     > This is Trials C and D of check 35. Use the Read tool to read hello.txt, then use the Bash tool to run `echo hi`. Tell me what happened with each, quoting any hook message in full. Do not try to work round a refusal. When I say "again", make the same two calls again. If they go through then, read /Users/Shared/wheelhouse-check35/run.md and carry on from step 10.

   - **Director (Trial C):** quit Desktop (Claude menu, Quit) and reopen it from the Dock. Start a new session in `/Users/Shared/wheelhouse-check35/project` and paste the message. When the session has answered, type in the same session, in your own words, anything Desktop itself showed: at the session start, or around the refusals (a banner, a box, a red line), or "nothing". (That goes into the transcript, which the agent reads later.) If the two calls went through, Desktop did not take the short PATH: skip the link and type `again`; the session then carries on from step 10, and Trial D has nothing to show.
   - **Director (Trial D):** with the session still open, open Terminal.app in this user (Spotlight, "Terminal") and paste:

     ```bash
     ln -s /usr/local/bin/node /Users/Shared/wheelhouse-check35/bin-d/node
     ```

     Then type `again` in the session. The command-line trial's calls went through at this point.
   - **If the second calls are refused too,** the director pastes `rm ~/.zprofile` in the same Terminal window, so the next Desktop start has its usual PATH; the agent does step 10's copying at 10a.
10. **After Trial D (the agent, once its tools work).** In the session of Trials C and D if its second calls went through, or else first thing at 10a:
    - `rm -f ~/.zprofile`, then `zsh -l -c 'command -v node'` must print `/usr/local/bin/node`. (The link in `bin-d` stays; the cleanup at step 14 removes it with the folder.)
    - Copy into the notes, under "Trial C" and "Trial D", from the session's transcript (the newest `.jsonl` in `~/.claude/projects/-Users-Shared-wheelhouse-check35-project/`): the tool results of the four calls (the exact refusal words), the session's replies, and what the director said Desktop showed. Leave usernames out.
    - Run `node /Users/Shared/wheelhouse-check35/run.js read /Users/Shared/wheelhouse-check35/log` and write down, for the lines after the time step 9 wrote: the PATH the shell hook logged at the session start and for each call (does it hold `bin-d`, or is it launchd's default, or something else); whether the node hook logged anything before the link was made (it should not: `node` was missing); and the lines after the link (`execPath`, version).
    - Write down whether Desktop took the short PATH, whether `Read` and `Bash` were refused, and whether the second calls went through without a restart.
10a. **Check 36, while this account exists.** The agent gives the director the message for after the restart ("This is check 35 step 10a. Read /Users/Shared/wheelhouse-check35/run.md and carry on from step 10a."). **Director:** quit Desktop and reopen it from the Dock (now with its usual PATH, `~/.zprofile` being gone), start a session in `/Users/Shared/wheelhouse-check35/check36/project` (it has no plugin, so its tools work whatever happened above), and paste the message. The agent first does step 10 if it is not done yet, then follows steps M1 to M8 (and the optional M8b) of `/Users/Shared/wheelhouse-check35/check36/run.md` (the copy made at step 1). They take about twenty minutes, with two more quits and reopens of Desktop (M6, M8; a third if a new session is not enough in trial 1, and the editor's clicks if M8b is wanted). Their results go into the same notes file under "Check 36" headings.
10b. **Check 37, while this account exists.** Check 36 is finished and Desktop is open normally; the agent is the session M8 started in `check36/project` (session X of check 37). It follows `/Users/Shared/wheelhouse-check35/check37/run.md` (the copy made at step 1) from "In the throwaway user" down: the director starts a second, new Desktop session in a scratch project, says yes to trusting it, pastes the install line, clicks through what Desktop shows choosing the project option, and types `/reload-plugins` up to three times along the way. It takes about ten minutes of the director's time. Its results go into the same notes file under "Check 37" headings.
11. **Before the log-out (the agent):** run `chmod -R a+rwX /Users/Shared/wheelhouse-check35`, so that step 14's cleanup from the director's account can remove the folders and files this account made (`bin-d`, logs, check 37's copies); check `~/.zprofile` is gone (`ls ~/.zprofile` fails); and check the notes file holds every trial's results (A, B if run, C, D, check 36's trials and undo, check 37's lines and undo). **Director:** then quit Desktop, log out of the throwaway user (Apple menu, Log Out), log back in to their own account, and type in the agent's session there: `Carry on from step 12 of check 35.`

## Taking the throwaway user away (the agent, in the director's account)

12. Copy the notes file and the logs to a folder in `os.tmpdir()` first: `cp /Users/Shared/wheelhouse-check35/notes.md "$TMPDIR/check35-notes.md" && cp -R /Users/Shared/wheelhouse-check35/log "$TMPDIR/check35-log" && cp -R /Users/Shared/wheelhouse-check35/check36/log "$TMPDIR/check36-log"`, and check the copies are there before the account is deleted.
13. **Director,** in Terminal.app, one line, asking for the administrator password:

    ```bash
    sudo sysadminctl -deleteUser wh35probe
    ```

    (It deletes the user's home folder too, `~/.zprofile` and the check 37 scratch project with it. Do this only after the throwaway user has logged out.) If the Mac says the user is still logged in, log out of it first.
14. The agent checks it is gone: `dscl . -list /Users | grep -c wh35probe` prints 0, `ls /Users` has no `wh35probe`, and `ls /Users/wh35probe` fails. Then removes the shared folder from the worktree, with its own Node.js 22 by its full path, never the world-writable copy in `/Users/Shared`: `<node 22> probes/35-node/run.js cleanup /Users/Shared/wheelhouse-check35` (the notes were copied out at step 12). `ls /Users/Shared/wheelhouse-check35` must then fail; if anything is left, list it and say so (do not use `sudo`). If the installer was run in step 8, say that the system `node` is now the new one, and its version.

## Sitting 2: Windows

Run in the director's own account on a Windows computer, because a fresh account there needs administrator rights. The agent runs in a terminal session or in a PowerShell window, not in the Desktop session that is restarted.

W1. **Opening card.** List every change and its undo: "To see what the plugin's checks do when Node.js is missing, I will: (1) make a scratch folder under your temporary folder with a test project and a copy of Wheelhouse in it (removed at the end, after its notes are copied out); (2) add that copy to your Claude Code as a scratch plugin source called `wheelhouse-check35`, and install it in the test project only (both removed by name at the end); (3) start Claude Desktop once with Node.js taken off its PATH, for that one start (closing it ends it). The test sessions stay in Desktop's list of past sessions, like any session. If Node.js is missing or old here, I fetch a portable copy into the temporary folder for my own scripts only, not put on your PATH, and remove it at the end. Nothing is uninstalled, and no other setting changes. You start a session and paste a request twice, and quit and reopen Claude twice. Checks 36 and 37 follow, each with its own card. Go ahead?"
W2. Note the starting point: `where.exe node`, `node --version`, `claude --version` if present, and `(Get-Process claude -ErrorAction SilentlyContinue | Select-Object -First 1).Path` while Desktop is running (this is the path to start it from; write it down). Check whether Git for Windows is installed (`where.exe bash`), since hooks use Git Bash or PowerShell. **If `node` is missing or older than 20** (the probe scripts of checks 35 and 36 need Node.js 20 or later; check 38's needs 18 or later, for the built-in `fetch`): the agent fetches the Node.js LTS Windows zip for this processor from https://nodejs.org/dist/ into `%TEMP%\wheelhouse-node`, checks it against that release's `SHASUMS256.txt`, unpacks it with `C:\Windows\System32\tar.exe`, and runs every probe with that `node.exe` by its full path, in double quotes. It is not put on PATH, so the trials still see the computer's own state; Trial A then shows what the hooks do with the computer's own `node`, or with none. `%TEMP%\wheelhouse-node` is removed at the end of the sitting (W9).
W3. Set up: `node probes/35-node/run.js setup --plugin-from .` in a PowerShell window (it prints the scratch folder under `%TEMP%`, named `wheelhouse-check35-…`, and starts `notes.md` there). The agent adds the scratch marketplace and installs the plugin at project scope, from `<root>\project`, with `claude` if it is on PATH, else the `claude.exe` Desktop keeps under `%APPDATA%\Claude\claude-code\<version>\`: `claude plugin marketplace add "<root>\marketplace" --scope project`, then `claude plugin install wheelhouse@wheelhouse-check35 --scope project`. The Windows logging hook is a PowerShell one; it has not been run on Windows before, so say whether its log (`hook-sh.log`) has lines.
W4. **Trial A. Director:** start a Desktop session in `<root>\project` (trust the folder) and paste the request the agent gives (step 6's two calls, worded as the Trials C and D message without its last two sentences). Then the agent runs `node "<root>\run.js" read "<root>\log"` and writes down `execPath`, the version and the PATH, and the session's answer from its transcript (`%USERPROFILE%\.claude\projects\`, the newest folder for `<root>\project`).
W5. **Trial C, no `node`. Director:** quit Desktop (tray icon, Quit). The agent, in a PowerShell window of its own (if its tools cannot start Desktop, the director opens PowerShell and pastes the three lines):

    ```powershell
    $env:Path = ($env:Path -split ';' | Where-Object { $_ -notmatch 'nodejs' }) -join ';'
    where.exe node
    & "<the path from W2>"
    ```

    `where.exe node` must print nothing (if another folder holds `node`, remove it from this window's PATH as well). **Director:** start a session in `<root>\project`, paste the same request, and type in the session anything Desktop itself showed. The agent writes down, from the transcript and the log, whether each call was refused, the exact words, and what the PowerShell hook logged. **Director:** close that Desktop and start it normally from the Start menu.
W6. **Copy out, then undo.** Copy the results out first, every time: `New-Item -ItemType Directory -Force "$env:TEMP\check35-results"; Copy-Item "<root>\notes.md", "<root>\log" "$env:TEMP\check35-results" -Recurse`, and check the copies are there (`Get-ChildItem -Recurse "$env:TEMP\check35-results"`). Then, from `<root>\project`, `claude plugin uninstall wheelhouse@wheelhouse-check35 --scope project` and `claude plugin marketplace remove wheelhouse-check35`; `claude plugin marketplace list` must not list it. Then remove the scratch folder with `node "<root>\run.js" cleanup "<root>"` (it refuses anything not named `wheelhouse-check35…` under the temporary folder). The copies in `check35-results` come back with the notes.

W7. **Check 36** follows in this sitting: `probes/36-telemetry/run.md`, from W7a. It uses the director's own user settings file and user environment variables for a few minutes and puts them back by name.

W8. **Check 37** follows, if the tag is pushed: `probes/37-install-line/run.md`, "Windows". It adds the Wheelhouse marketplace to the director's own Claude settings and installs the plugin in a scratch project for a few minutes, and removes both again, so it asks first.

W9. **Check 38** (agent only): `docs/checks/38-host-tools.md`, "Needs the director", with the `node` W2 found or fetched. Then, last of the sitting, remove `%TEMP%\wheelhouse-node` if W2 made it (`Remove-Item -Recurse -Force "$env:TEMP\wheelhouse-node"`).

## What to bring back

For each computer: the starting facts (step 2 or W2); in each trial whether `Read` and `Bash` went through, the exact words of any refusal, and what the session start showed; the logged `execPath`, Node.js version and PATH (leave out usernames in the note; keep folder names); whether a session that was refused went through once `node` was put on PATH without a restart; and whether Desktop took the short PATH (from `~/.zprofile`, or launchd's default) in Trial C, and honoured the PowerShell window's PATH in W5.
