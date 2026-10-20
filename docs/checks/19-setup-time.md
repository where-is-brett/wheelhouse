<!-- docs/checks/19-setup-time.md -->

# Check 19: setup time

**Answer:** Deferred — held for the director's sitting (sitting 3 in the setup plan's sittings table): setup is built and its times are recorded in its journal, and the timed run on a fresh Mac account is written out in `probes/19-setup-time/run.md`, with its script; it waits for check 37's sitting, a tag on the host and the director's time.

## Question

Setup time: a timed run on a fresh account on macOS and on Windows, including installing git, Node.js and the host tool. The design's target is about 15 minutes of the director's time, from the pasted install line to the green board (`TARGET_MINUTES` in `scripts/lib/setup-numbers.js`).

## Tested on

Not yet run. Prepared on 20 October 2026, on macOS 27, against the setup build at commit 260853f (Part 5a merged). The earlier evidence below is from the installers' official pages and release files, read on 17 October 2026.

## Method

The run sheet is `probes/19-setup-time/run.md`; its script, `probes/19-setup-time/run.js`, does the agent's steps (tested in `tests/probes/19-setup-time/run.test.js`, with no real `gh`):

- **Mac.** A throwaway standard user, made and deleted by one `sudo` line each that the director types. The agent puts a note on its desktop with the README's Install section and the line with the tag filled in (`desktop-note`, which reads the line from the README, the copy `tests/skills/setup.test.js` holds to `INSTALL_LINE`). The director logs in, opens Claude Desktop, signs in to Claude (not timed), and follows the note to the green board with no help.
- **The times come from setup's own records,** not a stopwatch (`times`, run in the throwaway user, whose `~/.wheelhouse` is its own only): each card's shown, clicked and finished times in the journal (`stepTimes`, `scripts/setup/journal.js`), each question's asking and answer, the start from step 1's `firstMessageAt` (ruling R76: the earliest entry of any session in the folder within 24 hours of the run's start, so the folder must be new and the session the director's only one there), and the end from the health check's green. Each step's share of the whole is counted from the step finished before it, so the shares add up to the total. The Node.js installer, if it is needed, comes before the pasted line, so it is timed separately from macOS's installer log.
- **The undo** is setup's own uninstall in the throwaway user (recommended in the run sheet, since uninstall for real is itself a pending sitting item), then the test repository deleted on its page and the 404 checked with the director's own signed-in `gh` (`gone`, which first asks who `gh` is signed in as, since a private repository answers 404 to anyone else), then the user deleted.
- **Windows.** No full run: that computer has no administrator rights and no host operations, and the stand-in host the plan named cannot run there (Task 17's end-to-end world is skipped on Windows, and the plugin has no stand-in mode). The agent asks the director the cards of steps 2, 4, 6 and 9 as the Mac run showed them (`cards.json`), and times each from the session's transcript (`asked`).

**How the Answer will be decided:** Yes when the total is within about 15 minutes (the run sheet reads "about" as up to 17); otherwise Partly, with the three slowest steps and what would shorten each; Partly as well if the board never goes green, naming where it stopped.

## Evidence

**Already known (20 October 2026), from the build and its tests:**

- Setup resumes after any step and never repeats a finished one: the journal records every change as it is made, and the end-to-end test stops at step 4 and resumes there (Task 17, `tests/e2e/setup.test.js`; ruling R136 lets a half-done setup's session start before step 7 installs the pins).
- A typed stop ends the playbook (the setup skill), and uninstall finishes from any point and leaves the home folder as it was but for what the director keeps (rulings R138 and R142, tested end to end).
- Task 17's end-to-end tests run a new product to the green board, an existing project with rules, a second computer and uninstall, against a stand-in host, fake installers and the real helper. They prove the steps and their order, not the minutes.

**Found while preparing the run (what blocks it, and what it changes):**

- **The pasted line must work in Desktop first.** Check 37's sitting (step 10b of check 35's Mac sitting) has not run; until it shows the line works, a timed run would time a fall-back.
- **A tag is needed on the host.** The README's line ends in `#<tag>`, and the throwaway user has no GitHub sign-in when it is pasted, so a tag of the build being timed must be on the public repository (`v0.0.0-probe19`, pushed by the main session and deleted afterwards; check 37's `v0.0.0-probe37` is an older build).
- **Node.js.** This Mac's system-wide Node.js is 20.9.0 (`docs/checks/35-node.md`), below the floor of 22, so a fresh account here has the README's step 2 install the LTS from nodejs.org: the administrator password a third time, and a change to the Mac for every user that is not undone. (The README asks the director to install it themselves; the comment at the top of `scripts/setup/tools.js` still says Claude starts the installer.)
- **The connection.** `scripts/host/app.json` holds no Wheelhouse app yet (Card 1), so step 3 offers My own app and Quick on GitHub, recommending Quick for a product without real users. Quick adds no clicks beyond the sign-in; My own app adds about six (the new-app page, a second code, the Install page) and an app to delete afterwards.
- **A second test repository.** Setup makes a private `wheelhouse-profile` on the director's account when there is none; the run sheet checks before the run whether one is there, and deletes it afterwards only if this run made it.
- **The phone test** keeps the screen locked for up to three minutes (`PUSH_TEST_LOCK_MS`), which counts in the director's time.
- **Left after the undo:** the GitHub CLI sign-in made in the throwaway user stays listed under GitHub CLI in the director's GitHub settings; its token goes with the user's keychain, and revoking the grant would also sign out the director's own `gh`.

**Earlier evidence (17 October 2026), the installers:**

- **macOS git:** comes with Apple's command-line tools ("click Install and then agree to the … License Agreement"). Apple gives no size or time.
- **Windows:** Claude Code itself "do[es] not need" Git for Windows; without it, Claude uses PowerShell instead of Bash. Builders still need git.
- **Node.js LTS:** about 33 MB on Windows (.msi, installs for the whole computer, so it asks for administrator rights) and about 94 MB on macOS (.pkg).
- **`gh`:** about 16 MB on Windows (.msi) and 29 MB on macOS (.pkg, currently unsigned). Setup no longer uses either package: it fetches `gh` or `glab` from the release's archive, needing no installer and no password (check 38).

## What it means for the design

- Section 15, "Before starting": Claude Code on Windows does not need Git for Windows; setup installs git on Windows too (17 October 2026).
- Section 15, step 2: on a fresh computer, Node.js comes before the plugin, through the README; git's installer is started first and runs while the director answers the next questions, which is what keeps the run near 15 minutes. The sitting measures whether it does.
- The measured minutes per step, and the slowest steps with what would shorten each, go into section 15 once the sitting has run (Task 19).
- On Windows, a full timed run waits for an account with administrator rights where the host may be used; until then only the cards' reading time is measured there.

## Needs the director

Yes, one Mac sitting (sitting 3), written out in `probes/19-setup-time/run.md`, after check 37's sitting and once the tag is pushed. About 45 minutes at the computer:

1. A yes on the opening card (S0), about 1 minute.
2. In Terminal.app, one pasted `sudo` line, the administrator password, and a chosen password for the throwaway user, twice (S2), about 2 minutes.
3. Logging in to the throwaway user, dismissing macOS's set-up prompts, opening Claude Desktop and signing in to Claude (S3), about 5 minutes, not timed.
4. The timed run (S4): the folder, the pasted line and its boxes, every setup card to the green board, the GitHub sign-in in the browser with the two-factor code, and locking the screen for the phone test; if Node.js is below 22, its installer first, with the administrator password. About 15 to 25 minutes.
5. One pasted Terminal line for the times (S5), about 1 minute.
6. The undo (S6): `/wheelhouse:uninstall`, its card and questions, the pull request and each test repository's Delete on GitHub's page, removing the plugin in Desktop, and one pasted line; about 8 minutes.
7. Logging out and back in to their own account, and one line to the agent (S7), about 2 minutes.
8. In Terminal.app, one pasted `sudo` line to delete the user, with the administrator password (S9), about 1 minute.

On Windows, when next at it, about 10 minutes: a yes on a card, one session with a pasted message, and answering the cards of steps 2, 4, 6 and 9 (W1 to W4).
