<!-- docs/evals/rehearsal-project-under-way.md -->

# Rehearsal: setup on a project already under way

A practice run of Wheelhouse v0.1.0's setup on a project that is already in flight, end to end, before a director sets up their own. It covers the "fitting around a project already under way" path (design section 15, rulings A1 to A9), which had only been tested in pieces.

**Run on** 24 and 25 October 2026, on macOS, with Claude Code 2.1.302 and the plugin at the `v0.1.0` tag.

## The project

A made-up but ordinary project, `recipe-box` (a small Node.js app), on a stand-in GitHub:

- **its own `CLAUDE.md`**, with rules of its own, two of them at odds with Wheelhouse: "Use American English in the interface" and "Push straight to main for small fixes";
- **another agent setup**: `AGENTS.md`, `.github/copilot-instructions.md`, `.claude/agents/code-reviewer.md` and `.claude/skills/release-notes/SKILL.md`, and a `.claude/settings.json` of its own (two allow rules);
- **work in progress**: an open pull request (#3, `add-search`); the folder checked out on `ingredient-units`, a line of the director's with one commit not pushed; a change to `src/recipes.js` not committed and a new `notes.md`; a `.env` file;
- **the install line's own change**: the plugin's lines added to the project's `.claude/settings.json`, as a project-scope install leaves them, not committed.

## How it was run

- **The session** was a real `claude -p` session on Sonnet, in stream-json both ways, with `--permission-prompt-tool stdio`. A small permission host answered each card as the director would (real users: yes; Standard, not Locked; Quick; the README's words; no live data; Go ahead on each step; the phone test arrived; Carry on with it), let through only the Wheelhouse command, and refused any other command.
- **The world** was setup's end-to-end world from the same tag (`tests/helpers/setup-e2e.js`): a real helper on a socket in a scratch Wheelhouse home, setup's ten real steps on a stand-in computer, a host of bare repositories, stand-ins for `gh`, `claude`, `curl` and the rest on the PATH. Installs (gh, the kits) and the host's protection are stood in, so steps 2 and 7 are faster here than on a real computer.
- **Isolation.** A scratch `CLAUDE_CONFIG_DIR` has no sign-in ("Not logged in", as checks 36 and 37 found), so the session used the computer's own sign-in with the evaluation harness's isolation instead: project and local settings only, no MCP servers, the harness's denied tools, the plugin from a copy of the tag (`--plugin-dir`, nothing written to `~/.claude`), reads of the director's own places denied. The real `~/.wheelhouse` was never written; the kits' Claude Code folder was the scratch one. Only the runs' transcripts went to `~/.claude/projects`.
- **No sandbox at first.** A project not yet set up has no sandbox; step 7 writes the project's own, and Claude Code picked it up mid-session, as it would for the director.
- **Usage.** Eight real sessions (three stopped early while the rehearsal itself was put right), about 12M input tokens in all, nearly all cache reads, on Sonnet.

What couldn't be driven headless: the trust dialog (the folder stayed untrusted, so the project's own allow rules were ignored, which changed nothing here); Locked's password box (Standard was chosen); the phone itself (the push was turned away by a hook, as the eval harness does); Claude Desktop's own screens.

## Timings

Seconds from setup's start, run 5 (the folder switched to main by the director after step 7 refused; installs stood in):

| Step | What | Card shown | Clicked | Done |
|---|---|---|---|---|
| 1 | Install | – | – | 0 |
| 2 | Tools | 3 | 6 | 8 |
| 3 | Host and connection (3 questions, then Go ahead) | 24 | 26 | 30 |
| 4 | Three questions (2 asked) | – | – | 45 |
| 5 | Rules found | – | – | 47 |
| 6 | Changes to this computer | 49 | 55 | 58 |
| 7 | Project files, pins, protection | 369 | 373 | 378 |
| 8 | Locked (Standard: nothing) | – | – | 379 |
| 9 | Phone notifications (2-minute locked-screen wait) | – | – | 521 |
| 10 | Health check | 523 | 526 | 530 |

Steps 1 to 6 took under a minute. Step 7 waited about five minutes for the director to switch the folder. Twelve cards in all, and three permission prompts, all before step 2 wrote setup's own allow rule. On a real computer, step 2 (fetching gh) and step 7 (installing the kits) add their own time.

## Findings

### 1. A folder on a line of unfinished work stops setup at step 7, and the session's advice could break Wheelhouse (fixed in part; card below)

Most projects under way are checked out on a line of work, not on `main`. Step 7's plan refused, and because `resume` asks for the next step's plan, `resume` itself failed with the refusal. Its words were: "Switch this folder to main, or make ingredient-units the default on GitHub, then ask again".

In three runs the session then told the director:

- to **commit or stash** their changes first, then switch. Stashing would take the install's own lines in `.claude/settings.json` with the director's changes, so the plugin would switch itself off in that folder;
- or to **make `ingredient-units` the default branch on GitHub**, which would make unfinished work the product's main line;
- and, asked "Can you do it for me?", it gave four terminal commands (`git stash --include-untracked`, `git checkout main`, …), to a director who rarely uses the terminal.

In fact a plain `git switch main` carries the changes not yet committed across, and refuses (changing nothing) when it can't. With the folder switched, setup finished: step 7 committed only its own files, the install's lines among them, and left `src/recipes.js` and `notes.md` as they were.

**Fixed:**

- `scripts/setup/project-files.js`: the refusal never suggests changing the host's default branch. For a line of work, it says the line is left as it is, to switch the folder to the default, and to keep the changes not yet committed as they are, naming the install's lines in `.claude/settings.json` when they are among them. For a folder on `main` or `master` while the host's default is another line (`gh-pages`, say), it says to ask whoever looks after the repository which line is the product's own.
- `skills/setup/SKILL.md`: a rule for this refusal. Say the director's work is safe and left as it is. Never suggest stashing, undoing, committing or deleting their changes, or changing the host's default branch. If they ask how, give one command, `git switch <branch>`.

**Left as a card:** whether setup should do the switch itself, or fit around the line. See "For the director" below.

### 2. With the helper unreachable, the session sent the director to a Wheelhouse app that doesn't exist (fixed)

When the setup command answered "the host helper could not be reached: is it running?", the session told the director to "start or restart the Wheelhouse app", or to check that "the Wheelhouse plugin is installed and up to date in Claude Desktop". There is no such app. The session start starts the helper, so a new session in the folder is the remedy. The same improvising showed on an unknown refusal: "check that the Wheelhouse plugin is installed and up to date".

**Fixed:** `skills/setup/SKILL.md` names the refusal: a new session in this folder starts the helper, then "carry on with setup", and there is no Wheelhouse app to suggest.

### 3. The step 9 wait cost a refused call (fixed)

On step 9's two-minute wait, the session first ran `sleep 118` in the foreground. Claude Code 2.1.302 refuses that ("Blocked: sleep … use run_in_background"). The session then ran it in the background and was woken when it ended, so the push went out on time. It costs one refused call each time. Every playbook "wait" works this way (setup's `wait`, uninstall's once-a-minute status). **Fixed** (pull request after #75): `scripts/setup/cli.js` has a `wait <step>` form, which waits in the command itself while the step's plan is a wait, up to a minute and a half a call, then answers `waited: true` or how long is left. The setup playbook uses it for every wait, step 9's included, and STOP lets it through as a reading form. Uninstall's once-a-minute status is unchanged.

### 4. Step 5 says the project's rules are "followed as they are", even one protection now blocks (fixed)

Step 5 said "Found 9 rules in the project; they're followed as they are." One of those rules is "Push straight to main for small fixes", which step 7's protection blocks a few seconds later. Another is "Use American English in the interface". The first briefing says "Mine come first where they differ", but only after setup. The step 7 card says "protection sends later changes through Wheelhouse's checks". It doesn't say this ends the project's own habit of pushing straight to main, which matters if other people push to it. **Fixed** (pull request after #75): step 5's line names a rule that pushes, commits or merges straight to the main line and says it stays off: 'Found 9 rules in the project; they're followed as they are, except your rule "Push straight to main for small fixes; …" where it pushes straight to the main line: that stays off, as changes go through Wheelhouse's checks.' A rule that says not to ("Never push straight to main") isn't named.

### 5. Recording the carried-on work took three refusals (fixed)

After **Carry on with it**, the front desk wrote a brief for each piece and recorded it. Its first `record work` was refused for a missing `title`, the next for a missing `dependsOn`, and the third because `doc` was a plain path. The intake playbook says a work event names its document "by its path", but the command took only `{ "path": … }`. The fourth try went through. The same happened for the second piece's record, one refusal fewer.

**Fixed:**

- `scripts/state/events.js`: a record missing fields names every missing field at once, and the fields the kind takes, as a stray field's refusal already did.
- `scripts/frontdesk/cli.js`: a work event's `doc` given as a plain path is taken as `{ path }`, and its hash worked out.

### 6. The green ending (run 6)

With the folder switched, setup ended green (12 of 12). Then:

- **The carry-on card** read: "Wheelhouse found work already under way in recipe-box: 1 change waiting to be merged on GitHub, and 1 piece of unfinished work on this computer. Shall I carry them on?" It was plain, and the open pull request and the director's own line were both counted.
- **The briefing** said the other agent setup's line once ("AGENTS.md and 3 more files … Mine come first where they differ. I can move them into an archive folder, which you can undo at any time."), as designed.
- **The briefing also said "Locked would protect it more"**, a few minutes after the director chose Standard. This is fair as a health line, but it re-raises a choice just made. **Fixed** (pull request after #75): the line is now one of the briefing's weekly lines. Setup's own briefing holds it back and starts the weekly count, so it comes back at the next week's first briefing. The board shows it all the while, as before.
- **Each piece got its own approval card**, which explained "pull request", "merge" and "review" in plain words. The session's closing words were right: the original work isn't changed, and the director's changes not yet committed (`src/recipes.js`, `notes.md`) were left alone.

### 7. Smaller things seen

- **Step 7's card is one long sentence** (about 600 characters: settings, the CLAUDE.md section, local settings, `.wheelhouse/`, the front desk's model, `.env`, the kits, the commit, protection, the release). It is accurate, but hard to read for a director. This is the known "the pane needs real design" item.
- **Step 7 adds a "Compact instructions" section to the project's own `CLAUDE.md`**, keeping the director's text. The card says so ("keeping yours"); nothing went wrong.
- **`resume` loses the status lines when the next step's plan refuses.** The session gets only the refusal, so it can't say which steps are done without a second call. The sessions did call `status`, so no harm came of it.
- **The session never asked about the open pull request or the other agent setup during setup**, as designed (A2, A4): they come at the end, on the carry-on card and in the briefing.

## Rehearsal artefacts (not faults)

These came from how the rehearsal was built, and were checked against real use:

- **The keys trial failed** ("read keys folder: refused / could not run"). `scripts/health/trials.js` reads the real `~/.wheelhouse/keys`. In real use the helper's signing key has made that folder by step 10. Here the key lives in the scratch home, and inside a denied folder a missing path answers ENOENT, not EPERM (tried directly: a sandboxed `readdirSync` of a missing folder under a denied one gives ENOENT). Run 6 took that one line as refused, through a hook of the rehearsal's own.
- **The helper was unreachable after step 7**, in one run: the scratch home was under `/var/folders`, which macOS also spells `/private/var/folders`, and the sandbox's socket rule named the other spelling. The real home, `~/.wheelhouse`, has one spelling.
- **The eval harness's sandbox hides the harness's own repository**, which here was the plugin's copy, so the first run couldn't load the setup command.
- **Run 6 had no push tool**: the rehearsal switched off Claude Code's background traffic, to keep its marketplace refresh out of `~/.claude`, and that removes the push tool too. The session said plainly that it couldn't send the test and left step 9 open, which was right; the rehearsal's own answer, "It arrived", was not what a director would have clicked.
- **The test stand-ins include `security`**, which Claude Code needs to read its sign-in, so the session got the stand-ins without it.

## For the director

**A card: what setup does when your project's folder is on a line of unfinished work.**

- *What this is:* most projects already under way have their folder on a line of work, not on the main line. Setup puts its files on the main line, so today it stops and asks you to switch the folder yourself, with a command in a terminal.
- *Why it comes to you:* it decides what setup may do with your own unfinished work and your folder.
- *The options:*
  1. **Setup switches the folder for you, on your click** (recommended). Step 7's card lists "switch this folder to main; your unfinished work stays on ingredient-units, and your changes not yet committed come along". It does this only when git can switch without touching your changes; otherwise it says why and waits. Everything after step 7 works as it does today, as the folder ends up on the main line with setup's commit in it.
  2. **Setup leaves the folder where it is** and makes its commit on the main line through the helper's own copy of the repository. Your folder never moves, which fits round a project best. But it is a bigger change: setup's three files would have to be worked out from the main line's versions, not the folder's. The health check, uninstall and the session start all expect the folder to hold setup's commit. And your folder holds Wheelhouse's protections only as changes not yet committed until you next bring in the main line.
  3. **Keep it as it is now**: setup stops and you switch the folder yourself, with one command, `git switch main`.
- *Recommendation:* 1. It is a small, contained change to step 7 and keeps everything else as tested. 2 is worth designing later, with the setup redesign that follows the first real setup.
- *What happens meanwhile:* setup stops at step 7 with plain words and one safe command. Steps 1 to 6 stay done.
