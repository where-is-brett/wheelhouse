<!-- probes/19-setup-time/run.md -->

# Check 19: setup timed on a fresh account, for the director's sitting

What this finds out: how long setup takes the director on a fresh Mac account, from the pasted install line to the green board, read from setup's own journal rather than a stopwatch; which steps take the longest, and what would shorten each. It is sitting 3 in the setup plan's sittings table, on the Mac, with a short Windows part in the director's own account on that computer. The note it answers is `docs/checks/19-setup-time.md`.

Every step an agent can do is a command below. Only the passwords, the GitHub sign-in (with its two-factor code), the timed run's clicks and the host page's own clicks are the director's.

**The throwaway user** is `wh19probe` ("Wheelhouse check 19"), a standard user, made and deleted by one `sudo` line each, typed by the director. **The shared folder** is `/Users/Shared/wheelhouse-check19`, readable and writable by both accounts: it holds copies of `run.js` and this file, `notes.md` (every result, appended as it is made), `Start here.txt` (the note for the throwaway user's desktop), and, after the run, `times.json` and `cards.json`. Results must not live only in a session's memory: the agent's own session in the director's account waits behind the switch of user, and nothing of the throwaway user's survives its deletion.

**Which `node` runs what.** In the director's own account the agent uses its own Node.js 22 or later, by its full path (check it with `<path> --version`), never `/usr/local/bin/node` (20.9.0 on this Mac when check 35 looked, below the plugin's floor). In the throwaway user the director's one Terminal line uses the `node` on its PATH; `run.js` runs on Node.js 20 too, so `times` works whether or not the Node.js installer was run.

**No help during the run.** No agent session is open in the throwaway user while it is timed. The director follows the note and what setup shows. If they are stuck, they say so in the session and carry on as best they can, or stop: the journal still holds the times up to there.

## Before the sitting (the agent and the main session, in the director's account)

These are the prerequisites. The ones marked **blocks** stop the sitting until they hold.

P1. **Check 37's sitting has run (blocks).** It shows whether the pasted line works in Desktop at all (`docs/checks/37-install-line.md`). If it failed and the README now gives another route, `desktop-note` copies the README as it is then, so the note follows it; if the README still gives a line that does not work, the timed run waits for that to be put right.

P2. **A tag on the host (blocks).** The README's line ends in `#<tag>`, so a tag of the build being timed must be on the public repository and readable without a login (the throwaway user has none). The main session pushes `v0.0.0-probe19` on the merged commit to be timed (not `v0.0.0-probe37`, which is an older build), and deletes it after the sitting. The agent checks it at the sitting, with no sign-in: `git ls-remote --tags https://github.com/where-is-brett/wheelhouse v0.0.0-probe19` prints one line.

P3. **Node.js 22 or later for the throwaway user.** `/usr/local/bin/node --version`. While it is below 22, step 2 of setup stops with the README's Node.js line, and the README's step 2 has the director install the LTS from nodejs.org before pasting. That installer asks for the administrator password (a third password), writes to `/usr/local` for every user, and **is not undone**: macOS has no simple uninstall for it, so the Mac is left on the newer LTS for every account. It is part of a real first setup, so it is in the sitting, timed separately (S8), unless check 35's Trial B already installed it.

P4. **Claude Desktop for every user.** `ls -d /Applications/Claude.app` and `stat -f '%Su %Sp' /Applications/Claude.app`: in `/Applications` and readable by others, so the throwaway user can open it.

P5. **How agents reach GitHub.** `scripts/host/app.json` holds `null` for the Wheelhouse app (Card 1: the organisation and its app are not made yet), so step 3 offers two ways on GitHub: **My own app** and **Quick**, recommending Quick for a product without real users. Quick asks nothing beyond the sign-in. My own app adds the new-app page (tick Enable Device Flow, click Create), a second code typed on GitHub with Authorize, and the app's Install page (pick the repositories, click Install): about six more clicks, a few minutes, and an app to delete afterwards. The note asks the director to choose as for a personal project, so Quick is expected; whichever is chosen goes into the notes.

P6. **The test repositories.** Setup makes a private repository named after the folder (`wh19-trial`) on the director's GitHub account, and a private `wheelhouse-profile` there if the account has none. At the sitting, before the run, the agent asks the host with the director's own signed-in `gh` (S1) whether each is there. `wh19-trial` must be absent. For the profile either answer is fine; it decides the undo: one made by this run is deleted afterwards, one that was there is kept, and only this computer's enrolment is taken off it.

P7. **The director's phone.** Step 9 sends a test push to the phone with the screen locked, for up to three minutes. The phone needs the Claude app signed in to the same Claude account; if it has not, step 9's "It didn't" is an answer too.

## The opening card (the agent, before anything)

S0. Ask the director, in a card, and go no further without a yes. The card is in Task 18's report; in short: a throwaway user on this Mac (their password to make it and to delete it), a test repository `wh19-trial` on their GitHub account (and `wheelhouse-profile` if they have none), both deleted afterwards; the Node.js installer if P3 needs it, which stays; the GitHub CLI sign-in made in the throwaway user, which goes with it; about 45 minutes at the computer, the timed part 15 to 25 of them. Options: book the sitting; fold it into check 35's sitting; not now.

## Setting up (the agent, in the director's account)

S1. From the Wheelhouse worktree, with the agent's own Node.js 22 by its full path:

```bash
<node 22> probes/19-setup-time/run.js setup
<node 22> probes/19-setup-time/run.js desktop-note --tag v0.0.0-probe19
```

Then append to the notes, under "Starting point": `sw_vers -productVersion`, `/usr/local/bin/node --version`, `defaults read /Applications/Claude.app/Contents/Info CFBundleShortVersionString`, the date and time (`date -u +%FT%TZ`), the tag check (P2), and the two host checks, with the director's own `gh` (signed in as them in this account; a private repository answers 404 to anyone else, which is why `gone` first asks who it is signed in as):

```bash
<node 22> probes/19-setup-time/run.js gone <login>/wh19-trial
<node 22> probes/19-setup-time/run.js gone <login>/wheelhouse-profile
```

The first must say "wanted absent: yes". Write down what the second said: absent means this run will make the profile, and it is deleted at the end.

## Making the throwaway user (the director types, the agent waits)

S2. **Director,** in Terminal.app, one pasted line. It asks for the administrator password (sudo), then for the new user's password, twice; the director chooses any password and keeps it for S3. The second and third commands make the user's home folder now, so the note can be put on its desktop.

```bash
sudo sysadminctl -addUser wh19probe -fullName "Wheelhouse check 19" -password - && sudo createhomedir -c -u wh19probe && sudo install -o wh19probe -g staff -m 0644 "/Users/Shared/wheelhouse-check19/Start here.txt" "/Users/wh19probe/Desktop/Start here.txt"
```

The agent then checks `dscl . -read /Users/wh19probe UniqueID` and `ls /Users`. If the note is not on the desktop at S3, the director opens it from Finder (Go, Go to Folder, `/Users/Shared/wheelhouse-check19`); that is not timed.

## The timed run (the director, in the throwaway user)

S3. **Director, not timed:** the fast-switch menu in the menu bar (or Lock Screen, Switch User), log in as "Wheelhouse check 19", dismiss macOS's set-up prompts (skip Apple ID, Siri and so on), open Claude Desktop from /Applications and sign in with their own Claude sign-in. Open `Start here.txt` on the desktop.

S4. **Director, timed:** follow the note from the README's step 1, as on a new computer: make the folder `wh19-trial` under Projects in the folder picker, open a session on it, install Node.js if the README's step 2 says so (P3), paste the line, and go through setup's cards to the green board, signing in to GitHub in the browser when setup asks (with the two-factor code), and locking the screen for the phone test when step 9 asks. The time runs from the first message of the session on the folder (step 1's `firstMessageAt`, ruling R76) to the health check's green; the journal records each card's shown, clicked and finished times, and each question's asking and answer. The agent does nothing meanwhile.

The start is the earliest entry of any session in the folder within 24 hours of the run's start (14a's M4): the folder is new and the director opens one session on it, so that is the pasted line. A session opened on the folder and left before the paste would move the start earlier; if that happened, say so in the notes, and the session's transcript gives the paste's own time.

S5. **Director, not timed:** at the green board, open Terminal in this user (Spotlight, "Terminal") and paste:

```bash
node /Users/Shared/wheelhouse-check19/run.js times --folder "$HOME/Projects/wh19-trial"
```

It reads this user's setup journal and records (`~/.wheelhouse`, readable by this user only) and writes the table of minutes into the notes, with `times.json` (the times only, no answer's words) and `cards.json` (the cards as shown, for the Windows part). It prints the table: the director reads out the total if they like. It must run before S6, since uninstall removes setup's records of the questions and answers (the journal stays).

## The undo (the director, in the throwaway user, then the agent)

S6. **Setup's own uninstall, as the undo (recommended).** It is the pending "uninstall for real" sitting item (Part 4's handover, section 6), it puts back what setup changed in this user, and it takes this computer's enrolment off the profile, which deleting the user would leave on GitHub. Not timed. **Director:** in the session on `wh19-trial`, type `/wheelhouse:uninstall`, read its card and click Remove it; to its questions, answer Delete for `wh19-trial`, and for `wheelhouse-profile` Delete only if S1 found it absent (Keep if it was there before); when it gives a pull request to merge or close, or a repository's settings page, do it there (the Danger zone at the bottom, Delete, typing the repository's name); last, remove the plugin from the project in Desktop as its last line says. If My own app was chosen at step 3, also delete that app on GitHub (Settings, Developer settings, GitHub Apps, the app, Advanced, Delete). Then paste in the Terminal window:

```bash
{ echo; echo '## After uninstall'; date -u +%FT%TZ; ls -AR ~/.wheelhouse 2>&1 | head -60; } >> /Users/Shared/wheelhouse-check19/notes.md
```

If uninstall stops or fails, write down its words in the session and go on: deleting the user takes everything on this Mac, and S10 lists what is left on GitHub to remove by hand.

Without uninstall (if the director prefers it shorter), the director deletes `wh19-trial` (and a profile this run made) on each repository's settings page, and, when the profile was there before, the agent deletes this computer's `enrolments/<id>.json` from it with the director's `gh` at S10, after asking.

S7. **Director:** quit Desktop, log out of the throwaway user (Apple menu, Log Out), log back in to their own account, and type to the agent's session there: `Carry on from step S8 of check 19.`

S8. **The agent:** copy the results out first: `mkdir -p "$TMPDIR/check19-results" && cp /Users/Shared/wheelhouse-check19/{notes.md,times.json,cards.json} "$TMPDIR/check19-results/"`, and check they are there. If the Node.js installer ran, read its times: `grep -iE "node" /var/log/install.log | grep -iE "PackageKit|Installer\[" | head -5; grep -iE "node" /var/log/install.log | tail -5` and write the first and last times into the notes as the installer's minutes (beside the total, not inside it, since it came before the pasted line).

S9. **Director,** in Terminal.app, one line, with the administrator password (only after the throwaway user has logged out):

```bash
sudo sysadminctl -deleteUser wh19probe
```

S10. **The agent** checks:

- `dscl . -list /Users | grep -c wh19probe` prints 0, and `ls /Users/wh19probe` fails;
- `<node 22> probes/19-setup-time/run.js gone <login>/wh19-trial` says "wanted absent: yes"; the same for `wheelhouse-profile` when this run made it;
- when the profile was there before: `gh api repos/<login>/wheelhouse-profile/contents/enrolments --jq '.[].name'` no longer lists `<computer>.json`, the id `times.json` recorded as `summary.computer`;
- for My own app: `gh api -i /apps/<its slug> | head -1` answers 404 once the app is deleted (the slug is on uninstall's card and in the notes);
- the GitHub CLI grant: signing in `gh` in the throwaway user added a sign-in under GitHub CLI in the director's GitHub settings (Applications, Authorized OAuth Apps). Its token went with the user's keychain. Revoking the grant there would also sign out the director's own `gh` in their own account, so it is left; say so in the notes.

Then remove the shared folder: `<node 22> probes/19-setup-time/run.js cleanup /Users/Shared/wheelhouse-check19` (the results were copied at S8). `ls /Users/Shared/wheelhouse-check19` must fail; if anything is left, list it and say so (do not use `sudo`). Tell the main session the tag `v0.0.0-probe19` can be deleted.

## The Answer (the agent, afterwards)

From `times.json` and the notes, rewrite `docs/checks/19-setup-time.md` (Task 18, step 5): **Yes** when the total, first message to green board, is within about `TARGET_MINUTES` (15; this sheet reads "about" as up to 17, `ABOUT_MINUTES` in `run.js`); otherwise **Partly**, with the slowest three steps by their share of the whole and what would shorten each. Report the Node.js installer's minutes beside the total. With no green board, **Partly**, naming the step it stopped at and why. Report uninstall's result separately, for the "uninstall for real" item.

## Windows (the director's own account, a work computer with no administrator rights)

A full timed run on Windows needs an account where the director has administrator rights and may use the host; this computer has neither. The plan's call was to time steps 2, 4, 6 and 9 there with a stand-in host, but nothing that ships can do that: Task 17's end-to-end world, which holds the stand-in host, is skipped on Windows (its session start reaches the helper at the user's own named pipe), and the plugin has no stand-in mode. So on Windows the agent times the director's reading and answering of those steps' cards, as the Mac run showed them, and says plainly that this is what was measured. The brief travels to that computer as a file, with `cards.json` from S8.

W1. **Opening card:** "To time how long the setup cards take you on this computer, I will make a scratch folder in your temporary folder and open a Claude session in it (it stays in Desktop's list of sessions, like any session; the folder is removed at the end). I ask you the cards of setup's steps 2, 4, 6 and 9 as the Mac showed them, one at a time; answer as you would. Nothing is installed and no setting changes. About ten minutes. Go ahead?"
W2. The agent: `node probes\19-setup-time\run.js setup` (it prints the scratch folder, `%TEMP%\wheelhouse-check19-…`), copies `cards.json` into it, and checks the cards with `node "<root>\run.js" cards "<root>\cards.json"`. Write into the notes: `node --version`, `where.exe git` (whether step 2 would have an installer to start), and the Desktop version.
W3. **Director:** start a Desktop session in `<root>` (trust the folder) and paste the message the agent gives: "This is check 19 on Windows. Run `node \"<root>\run.js\" cards \"<root>\cards.json\"` and ask me each card it prints with AskUserQuestion, exactly as written, one at a time, in step order, saying nothing between them. Then say Done." Answer each card as on a real setup.
W4. The agent: `node "<root>\run.js" asked "<the session's transcript>"` (the newest `.jsonl` under `%USERPROFILE%\.claude\projects\` for `<root>`), and writes each card's minutes into the notes. The director has seen these cards on the Mac, so these times are likely shorter than a first sight; Windows words differ on step 6 (a user environment variable where the Mac uses `launchctl`) and step 2 (Git for Windows' installer where the Mac uses Apple's tools); the note says both.
W5. **Step 2's installer, not run.** If `where.exe git` finds no git, setup's step 2 would start Git for Windows' installer with `/SILENT /NORESTART`; whether it then asks for administrator rights on a computer without them is not tried here (it would leave git installed for this user if it went through). Write it down as open.
W6. Copy the notes out (`Copy-Item "<root>\notes.md" "$env:TEMP\check19-results.md"`), then `node "<root>\run.js" cleanup "<root>"`.

## What to bring back

From the Mac: the starting point; `times.json` (each step's card and question minutes, waits and share, the total and the verdict); whether each card made sense to the director without help (their own words, from the session); the Node.js installer's minutes, if run; the connection chosen; uninstall's result and what was left anywhere; the checks of S10. From Windows: each card's minutes, and whether git was there.
