<!-- probes/35-node/run.md -->

# Check 35: Node.js and the hooks, for the director's sittings

What this finds out: whether Wheelhouse's hooks find `node` when Claude Desktop runs them on a fresh account, what PATH Desktop gives a hook (printed by a logging hook, not guessed), and what a Desktop session does when `node` is not there, since the guards carry `onFailure: block`. Sitting 1 is on the Mac and takes about ten minutes of the director's time. Sitting 2 is on a Windows computer.

**What is already known (19 October 2026, `docs/checks/35-node.md`).** A headless session in a scratch project with the plugin loaded, started with `node` off PATH, has every `Read` and `Bash` call refused: `PreToolUse:Read hook error: [node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/tool-guard.js"]: failed; blocking because onFailure is "block"`, then `/bin/sh: node: command not found`. Putting `node` into a folder already on PATH, with the session still running, let the next call through. The sittings find out whether Desktop does the same.

**This Mac has a system-wide Node.js already:** `/usr/local/bin/node`, version 20.9.0 (from an installer run in 2023), and `/usr/local/bin` is in `/etc/paths`, so a new account sees it. A fresh account here is therefore not a "no Node.js" account. The sitting says what Desktop sees with it, and gets a Desktop with no `node` by starting Desktop with a short PATH (Trial C).

**The notes file.** One file keeps every result: `/Users/Shared/wheelhouse-check35/notes.md` (made by step 1, writable by both accounts). Results must not live only in a session's memory, because Trials C and D restart Desktop. After each trial that leaves tools working (A and B) the agent appends to it, and for C and D the director does (below); each entry holds what was asked, whether each call went through, the exact words shown, the logged PATH. In Trials C and D the session's tools are refused, so the agent cannot write to the file from that session: the director pastes the session's reply (or the agent's chat text) into the file in Terminal with `cat >> /Users/Shared/wheelhouse-check35/notes.md` (paste, then Ctrl-D), under a heading naming the trial, and the agent adds the rest afterwards. A restarted session in C or D cannot read this file or `run.md` while its tools are refused (see steps 9 and 10).

## Before anything (the agent, in the director's own account)

0. **The opening card.** Ask the director, in a card, and go no further without a yes. In plain words: "To check this on a clean account I need to make a throwaway user on this Mac, log into it with you, and delete it afterwards. Making and deleting it asks for your administrator password, typed by you in Terminal: I never see it. Deleting the user deletes its files. Nothing in your own account changes. Go ahead?" On a no, the sitting does not happen.
1. **Make the shared folder.** From the Wheelhouse worktree, with the agent's own Node.js 22 or later, by its full path (check it with `<path> --version`), not with the system's `/usr/local/bin/node`, which is 20.9.0, below the plugin's floor of 22:

   ```bash
   <node 22> probes/35-node/run.js setup --root /Users/Shared/wheelhouse-check35 --plugin-from "$PWD"
   ```

   This writes, under `/Users/Shared/wheelhouse-check35`, readable and writable by any account: `run.js` and `run.md` (copies, so the other account can read them), `project/` (a scratch project whose `.claude/settings.json` has the two logging hooks, on `SessionStart` and on every tool call), `log/` (where they write) and `marketplace/` (a scratch marketplace holding a copy of the plugin, named `wheelhouse-check35`). It prints the paths. Check that `project/.claude/settings.json` names `/Users/Shared/wheelhouse-check35/run.js`.
2. **Take stock of the Mac** and append it to the notes file under a "Starting point" heading it adds (the template starts the file with only a title): `/usr/local/bin/node --version`, `ls /usr/local/bin/node`, `cat /etc/paths`, and `claude --version`.

## Making the throwaway user (the director types, the agent waits)

3. **Director,** in Terminal.app, one line. It asks for the administrator password (sudo), then for the new user's password, twice. The director chooses any password and keeps it for the log-in at step 4.

   ```bash
   sudo sysadminctl -addUser wh35probe -fullName "Wheelhouse check 35" -password -
   ```

   The user is a standard one (not an administrator). The agent then checks `dscl . -read /Users/wh35probe UniqueID` and `ls /Users`.

## In the throwaway user (the director logs in; the agent works in a Desktop session there)

4. **Director:** Apple menu, then the fast-switch menu in the menu bar (or Lock Screen, Switch User), and log in as "Wheelhouse check 35". Dismiss the set-up prompts (skip Apple ID, Siri and so on). Open Claude Desktop (from /Applications) and sign in with their own Claude sign-in. Open the Code tab and start a local session in the folder `/Users/Shared/wheelhouse-check35/project`, and give the session this file to follow: `/Users/Shared/wheelhouse-check35/run.md`, from "In the throwaway user" down, and the notes file `/Users/Shared/wheelhouse-check35/notes.md`, which it reads first and appends to after every trial. If Desktop asks to trust the folder, the director says yes. The agent is that session.
5. **Install the plugin from the scratch marketplace** (project scope, the same route as check 24):
   - `/plugin marketplace add /Users/Shared/wheelhouse-check35/marketplace`, then `/plugin install wheelhouse@wheelhouse-check35`, choosing project scope. If Desktop's slash command cannot do this, say so and write down what it said; the fall-back is the `claude` that Desktop keeps under `~/Library/Application Support/Claude/claude-code/<version>/` run in a Terminal: `claude plugin marketplace add … --scope project` and `claude plugin install … --scope project` from the project folder.
   - Start a new session in the same folder (the plugin is read at the start). Write down (in the notes file) whether Desktop lists `wheelhouse` as loaded.
6. **Trial A: Node.js found.** Ask the session: "Use the Read tool to read hello.txt, then use the Bash tool to run `echo hi`. Tell me what happened with each, quoting any hook message." Then run `node /Users/Shared/wheelhouse-check35/run.js read /Users/Shared/wheelhouse-check35/log` and write down: the `execPath`, the version, and the full PATH of the first line (the SessionStart one), and the shell hook's `node=` line. Also write down what the session start showed the director, if anything.
7. **Is the version a problem?** The system `node` is 20.9.0 and the plugin asks for 22 or later. Write down whether the Wheelhouse guards ran quietly in Trial A (no error in the session) and the Node.js version the hooks logged.
8. **Trial B: the installer (optional; ask first).** This changes the computer for every account: the official installer replaces `/usr/local/bin/node` (20.9.0) with the current LTS, and asks for an administrator password typed by the director. **This step is not reversed in this sitting.** macOS has no simple uninstall for the official installer (an older Node.js package could be reinstalled by hand, which is not part of this sitting), and the throwaway user's deletion does not touch it: the installer writes to `/usr/local` for every user, so the Mac is left on the newer LTS afterwards, in place of the 20.9.0 that step 2 recorded in the notes file. A card, saying so: "Run the official Node.js installer now, to see whether a running Desktop session notices it? It will not be put back in this sitting: it replaces the Node.js on this Mac (20.9.0, recorded in the notes) with the current LTS for every user, and I will not reinstall the old one. It needs your administrator password. Options: skip it (recommended: the answer for a running Desktop is cheaper to get from Trial D); run it." On a skip, go to Trial C. On a run: the agent downloads nothing by itself; the director opens https://nodejs.org, takes the macOS installer for the LTS, runs it, types the password. Then repeat step 6's request in the same session (no restart), then read the log again. Write down whether the execPath or version changed without a restart, and again after quitting and reopening Desktop and starting a new session.
9. **Trial C: Desktop with no `node`.** The agent tells the director to quit Desktop (Claude menu, Quit) and, in Terminal.app in this user, run:

    ```bash
    env PATH=/usr/bin:/bin:/usr/sbin:/sbin /Applications/Claude.app/Contents/MacOS/Claude
    ```

    (A Desktop started this way gets this PATH from the terminal; one started from the Dock reads the user's shell profile, as the Desktop documentation says. A fresh account has no profile, so whether the short PATH survives is part of what is found out.) Start a session in the project folder and repeat the Trial A request. Because Desktop was restarted and this session's `Read` and `Bash` are refused, it cannot read `run.md` or the notes file: the director pastes into its first message the Trial A request, the words "this is Trial C of check 35: do not try to work round a refusal, just report each result in full", and the notes text so far (from `cat /Users/Shared/wheelhouse-check35/notes.md` in Terminal). Write down in the notes file (pasted by the director, as the notes-file paragraph says): whether the `Read` and `Bash` calls were refused; the exact words the session showed the director and the agent (the check 35 note has the command-line wording); whether the session start said anything; the logged PATH from the shell hook (the node hook cannot run). The blocked session cannot read or write files itself, because `Read` and `Bash` are both refused: the director runs `cat /Users/Shared/wheelhouse-check35/log/hook-sh.log` in Terminal, or the agent reads it from a session that has `node`; and whether the node hook's log gained any line. If the Terminal command fails to start Desktop, or Desktop ignores the PATH, say so; the answer for that half then rests on the command-line trial.
10. **Trial D: `node` put on PATH with the session running** (what the installer does to a folder already on PATH). The director, in Terminal in this user, quits Desktop, makes an empty folder with `mkdir -p ~/bin-check35`, and starts Desktop as in Trial C with `PATH=$HOME/bin-check35:/usr/bin:/bin:/usr/sbin:/sbin`. In a new session in the project folder the agent makes the Trial A request (expected: refused), then the director runs `ln -s /usr/local/bin/node ~/bin-check35/node` with the session still running, and the agent makes the request again in the same session. The new session after the restart is in the same position (tools refused until the link is made): the director pastes the Trial A request, the words "this is Trial D of check 35", and the notes so far into its first message, and tells it once the link is made, so that the second request runs with tools working; the notes file is read by the session only after that, or the director pastes it. Paste what it says for both requests into the notes file, and write down whether the second request goes through. The command-line trial did.
11. **Director:** make sure the notes file holds every trial's results, then quit Desktop, log out of the throwaway user (Apple menu, Log Out), and log back in to their own account.

## Taking the throwaway user away (the agent, in the director's account)

12. Copy the notes file and `log/` to a folder in `os.tmpdir()` first: `cp /Users/Shared/wheelhouse-check35/notes.md "$TMPDIR/check35-notes.md" && cp -R /Users/Shared/wheelhouse-check35/log "$TMPDIR/check35-log"`, and check both copies are there before the account is deleted.
13. **Director,** in Terminal.app, one line, asking for the administrator password:

    ```bash
    sudo sysadminctl -deleteUser wh35probe
    ```

    (It deletes the user's home folder too. Do this only after the throwaway user has logged out.) If the Mac says the user is still logged in, log out of it first.
14. The agent checks it is gone: `dscl . -list /Users | grep -c wh35probe` prints 0, `ls /Users` has no `wh35probe`, and `ls /Users/wh35probe` fails. Then removes the shared folder: `node /Users/Shared/wheelhouse-check35/run.js cleanup /Users/Shared/wheelhouse-check35` (copy the notes out first). If the installer was run in step 8, say that the system `node` is now the new one, and its version.

## Sitting 2: Windows

Run in the director's own account on a Windows computer, because a fresh account there needs administrator rights. The agent runs in a terminal session or in a PowerShell window, not in the Desktop session that is restarted.

W1. **Opening card.** "I will start Claude Desktop once with Node.js taken off its PATH, only for that start, to see what the plugin's checks do when Node.js is missing. Nothing is uninstalled or changed on your computer; closing Desktop ends it. Go ahead?"
W2. Note the starting point: `where.exe node`, `node --version`, `claude --version` if present, and `(Get-Process claude -ErrorAction SilentlyContinue | Select-Object -First 1).Path` while Desktop is running (this is the path to start it from; write it down). Check whether Git for Windows is installed (`where.exe bash`), since hooks use Git Bash or PowerShell.
W3. Set up: `node probes/35-node/run.js setup --plugin-from .` in a PowerShell window (it prints the scratch folder under `%TEMP%`, named `wheelhouse-check35-…`). Add the scratch marketplace as at step 5 (`/plugin marketplace add <marketplace folder>` and `/plugin install wheelhouse@wheelhouse-check35` at project scope). The Windows logging hook is a PowerShell one; it has not been run on Windows before, so say whether its log (`hook-sh.log`) has lines.
W4. **Trial A:** a Desktop session in the scratch project, ask for a `Read` and a `Bash` command, then `node run.js read <log folder>`. Write down `execPath`, the version and the PATH.
W5. **Trial C, no `node`:** quit Desktop (tray icon, Quit). In a PowerShell window:

    ```powershell
    $env:Path = ($env:Path -split ';' | Where-Object { $_ -notmatch 'nodejs' }) -join ';'
    where.exe node
    & "<the path from W2>"
    ```

    `where.exe node` must print nothing (if another folder holds `node`, remove it from this window's PATH as well). Repeat the Trial A request. Write down whether each call was refused, the exact words, and what the PowerShell hook logged. Close that Desktop, and start it normally.
W6. Remove the scratch folder with `node run.js cleanup <the folder>` (it refuses anything not named `wheelhouse-check35…` under the temporary folder), and remove the plugin and marketplace from the director's list (`/plugin uninstall`, `/plugin marketplace remove`).

## What to bring back

For each computer: the starting facts (step 2 or W2); in each trial whether `Read` and `Bash` went through, the exact words of any refusal, and what the session start showed; the logged `execPath`, Node.js version and PATH (leave out usernames in the note; keep folder names); whether a session that was refused went through once `node` was put on PATH without a restart; and whether Desktop honoured the short PATH in Trial C and W5.
