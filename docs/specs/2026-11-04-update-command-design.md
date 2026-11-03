<!-- docs/specs/2026-11-04-update-command-design.md -->

# Updating Wheelhouse with one command: `/wheelhouse:update` (4 November 2026)

Status: draft for the director's approval. Nothing is built from it until they approve it; the build plan follows.

## 1. The problem in plain words

Moving a project from one Wheelhouse release to the next takes five hand steps today: change the catalogue's release in the account's settings and in the project's, add the catalogue again by its git address (changing the release can make `claude plugin marketplace update` say the catalogue is not found), run `claude plugin update wheelhouse@wheelhouse` at both scopes, rewrite the paths in `.claude/settings.local.json` that name the old version's folder, and start a new session.

Moving the director's real project from 0.2.5 to 0.2.6 went wrong twice:

1. **The old helper kept running.** It was 0.2.2. Helpers learned to step down for a newer version only in 0.2.5 (`/helper/retire`, asked by `ensureHelper` in `scripts/hooks/session-start.js`), so an older one never does. Until it was replaced, pushes and merges were refused, and the director was told to quit `helper-main.js` in Activity Monitor.
2. **A false warning.** The weekly look at Wheelhouse's own files (`scripts/health/own-files.js`) put a watch line on the board, naming Wheelhouse's own files as changed.

The cause of the second, found for this design: the look hashes every file under the plugin's folder, and Claude Code keeps its own bookkeeping there. Each running session adds a file under `.in_use/` (named for its process number), and a version left behind by an update gets an `.orphaned_at` file. Both are in the cached folders on the maintainer's Mac today, and `~/.wheelhouse/own-files.json` holds `.in_use/<pid>` entries. The old helper looked at its own (old) folder, whose version never moved, so the look's "re-baseline after an update" never ran, and Claude Code's new `.orphaned_at` and changing `.in_use` files read as tampering. The same files change whenever a session starts or ends, so the line could come back with no update at all.

## 2. Goals, non-goals and anti-goals

**Goals**

- One command, `/wheelhouse:update`, does the whole update on this computer for this project. The director clicks one card and, at the end, starts a new session.
- It works on macOS and on Windows without administrator rights, with or without `gh` and `glab`.
- The project's committed files move only through the usual reviewed change.
- An update can stop part-way and carry on, and a bad one can be put back.
- The old helper is handed over by asking it, and only a process Wheelhouse can prove is its own is ever stopped.
- The own-files look accepts an update the director approved and still catches real tampering.

**Non-goals**

- Updating by itself. Wheelhouse never updates without the director's click (main design, section 12.4).
- Updating Claude Code, Node.js, VS Code or Copilot.
- Installing the VS Code add-on; it stays installed by hand (section 12.3).
- Updating every project on the computer at once (section 10.3).

**Anti-goals: it fails even if it works, if**

- it ever ends a process found by its name;
- it commits, pushes or merges a change to the project's files without the review the project's rules ask for;
- it leaves the director with a half-installed Wheelhouse and no plain line saying what to do;
- it teaches the own-files look to accept any change, so tampering hides behind "an update".

## 3. What already exists to build on

The update is mostly a sequence of parts Wheelhouse already has. A builder should reuse them, not write new ones. Where a part needs changing to fit, the table says so.

| Need | Already there |
|---|---|
| The project's release change as a reviewed change | `releaseChange`, `releaseBranch`, `settingsText` and `pinsOnlyChange` in `scripts/lineage/release.js`; the helper's `/pr/open` (in every release since 0.2.0), which `undo` already uses to open its change; the gate in `scripts/host/helper.js` weighs a `wheelhouse-release-<commit>` branch, but only to waive the director's approval for a pins-only release. Accepting the director's approval for one other release is a new gate rule (section 6.2) |
| Waiting until no feature is running | `canInstall` in `scripts/lineage/release.js` |
| Installing a release and checking it is the release's commit | `reinstall` (check 30's route) in `scripts/lineage/release.js`, reading `gitCommitSha` from `installed_plugins.json`. It works at project scope only and its catalogue move is "not yet proven" by its own comment: user scope is new work, and the move waits on check U1 |
| Putting back an earlier release | `undo` in `scripts/lineage/release.js`, on a `wheelhouse-undo-<commit>` branch |
| Fetching a tag and checking it is on Wheelhouse's protected default branch | the mirror and the fetch, tag-commit and default-branch checks inside `checkRelease`. They are split out from its pins-only verdict, which refuses every other release, and the tag is kept in the mirror for the own-files check (section 8); the `plugin.json` version check is new |
| Rewriting this computer's `settings.local.json` paths | `scripts/setup/local-refresh.js` (already run at each session start) |
| Asking the helper to step down | `/helper/retire` and `isOlder` (`scripts/host/retire-helper.js`) |
| Stopping a process only when it is provably Wheelhouse's | `stopWatcher` and `stopForeman` in `scripts/foreman/start.js`: a recorded pid, its start time compared, failing closed |
| Updating Locked's administrator-only copy | `updateLocked` in `scripts/protection/locked.js` |
| A card, a hash, an apply that runs on by itself, and a status to poll | setup's and uninstall's forms in `scripts/setup/cli.js` and `commands/uninstall.md` |
| Calling `claude` safely on both systems | `resolveClaude` and `invocation` in `scripts/lib/claude.js` |

## 4. What the director sees

1. They type `/wheelhouse:update` (or ask "update Wheelhouse"; the front desk and setup hand that to the command). They may name a release: `/wheelhouse:update v0.2.8`.
2. One line while it looks: "Looking for the latest Wheelhouse release."
3. **One card**, for example:

   > **Update Wheelhouse** · v0.2.6 → v0.2.7
   > What's new: GitLab merges no longer need `glab`; the board shows when a release is out.
   > What happens: your project gets a small reviewed change naming v0.2.7, then this computer installs it and hands over to the new helper. About five minutes. Work in progress finishes first.
   > Meanwhile: nothing stops; sessions open now keep v0.2.6 until you start a new one.
   > [ Update ] (recommended) [ Not now ]

   When the project's rules need the director's approval for the change (any release that isn't pins-only, section 6.2), the card says so: once the change is ready, the helper's window asks them to confirm it, as for any change to the safety rules.
4. Progress lines, one per step, from `status`, as uninstall does.
5. Only if needed, one more card: a password window for Locked, or stopping an old helper that can't be asked (section 7.3).
6. The last line: "Wheelhouse v0.2.7 is installed. Start a new session on this folder to use it." The next session's board says once: "Wheelhouse v0.2.7 is running (updated today, approved by you)."

When there is nothing newer: "You have the latest Wheelhouse, v0.2.6." No card.

## 5. Finding the release

- **Where from.** Wheelhouse's own repository, read with the fenced git (`scripts/lib/safe-git.js`): `git ls-remote --tags` over HTTPS. No `gh`, no `glab`, no GitHub API, no sign-in: the repository is public. The helper's certificate settings (`caEnv`) apply, so a company proxy that git already passes works.
- **Latest.** The highest tag of the form `vX.Y.Z`, compared as numbers. The tag must be on the default branch and its commit must carry `.claude-plugin/plugin.json` with the same version (checked in the mirror with the checks split out of `checkRelease`, plus a new version check).
- **Named.** A tag the director names, checked the same way. An older one is a put-back (section 9.3).
- **Pre-releases.** Tags `vX.Y.Z-<label>` (for example `v0.3.0-rc.1`) are never "latest" and never shown on the board; they install only when named. Version comparison follows semantic versioning precedence, so `0.3.0-rc.1` is older than `0.3.0`. `versionParts` and `isOlder` in `scripts/host/retire-helper.js` cut pre-release labels off today, which would leave an `rc` helper in place when the final release comes; they move to a full comparison (section 7.1).
- **What's new.** Each release carries two or three plain lines for the card in `lineage/release.json` (a new `says` field beside `kind`), read from the fetched tag. A release with none shows "No summary was given for this release."
- **Pinning.** A project is already pinned: its committed settings name a tag, and auto-update is off. Nothing moves unless the director runs the command and clicks **Update**. **Not now** records the release it declined (in the project's folder under the Wheelhouse home), so nothing asks about that release again.
- **The board's line.** Once a week the helper looks for a newer release (one `ls-remote`, no download). When there is one the director hasn't declined, the board's version line adds: "v0.2.7 is out; type /wheelhouse:update when you want it." No card, no notification. *Designer's call.*

## 6. The update, step by step

The command is a short playbook over `scripts/update/cli.js`, in the uninstall pattern: `plan [<tag>]` gives the card and a hash; `apply <hash>` starts the update and answers `started`; `status` gives the lines. The helper does every change, never the session (a session's commands run in the sandbox, which can't write Claude Code's plugin folders or reach the network freely).

The update runs as a **journalled job** under the Wheelhouse home (`~/.wheelhouse/update/<project>/journal.json`), one entry per step with its state. Every step can be run again safely; `apply` on a journal part-way carries on from the first step not done, and never does a done step twice. One update at a time per computer, held by a lock.

The job has two halves.

- **The first half runs the installed (old) version's code** in the helper: the checks, the reviewed change, the wait, and the install. These rely only on parts that have been in Wheelhouse since 0.2.0.
- **The second half runs the new version's code**, from its freshly installed plugin folder, as a detached process the helper starts (`node <new folder>/scripts/update/finish.js <project>`). It does the refreshes, the own-files record and the helper hand-over. So a fix to how an update finishes ships with the release being installed, and the process that retires the old helper is not the old helper.

### 6.1 Checks before the card

- The release is found and checked (section 5).
- Its requirements are met: the lowest Node.js and Claude Code it names (its manifest's `claudeCode.floor`, and a new `node` floor beside it). A computer below them gets a plain line saying what to install first, and no card.
- All stop is not on (otherwise: "Lift All stop first").
- Another update is not part-way. If one is, the card is "Carry on with the update to v0.2.7" instead.

### 6.2 The project's reviewed change

The committed `.claude/settings.json` names the release in `extraKnownMarketplaces.wheelhouse.source.ref`. The update never writes that file in the director's main checkout. It opens the change the way the build loop does (build-loop design, section 14.4):

- **Hosted project:** a pull request on `wheelhouse-release-<commit>`, changing only that `ref` (`releaseChange`), opened through the helper's `/pr/open`. A pins-only release needs Wheelhouse's review and no approval. Any other release changes a guardrail (`.claude/settings.json`, which can bring new hooks), so it needs the director's confirmed approval, not a click in the chat: today a chat click is only the agent's own account of it (`scripts/agents/chat-clicks.js`), and guardrail changes need a click confirmed in the helper's window (`CONFIRMED_STEPS`). **Recommended:** the **Update** card's click starts the update, and when the reviewed change is ready the helper's window asks for the usual confirmation, naming the release and its commit; the gate takes that confirmation as the approval for that pull request only (a new gate rule beside the pins-only one). The trust rules don't change. *Open decision D3.* Merging follows the project's usual gate; nothing skips CI.
- **Project kept on the computer:** the same change on the local queue (local checks design), with the same rule.
- **Before setup's step 7:** the project's settings don't name the catalogue yet; there is nothing to change, and the update moves only this computer.
- **Already merged** (another computer updated the project first, section 10.2): skipped.

The job waits for the merge, and the merged settings to reach the main checkout, before it installs anything. While it waits, `status` and the board say "Waiting for the change naming v0.2.7 to be merged". A change refused by the gate or closed ends the update with nothing installed.

### 6.3 Waiting for work in progress

Plugins are shared across the computer, so the install waits until no feature is past `started` (`canInstall`). The board line says so. New features don't start while the update waits to install (the foreman holds its queue, as for a release today).

### 6.4 Installing on this computer

1. **Back up** `~/.claude/settings.json`, `~/.claude/plugins/known_marketplaces.json`, `installed_plugins.json` and the project's `.claude/settings.local.json` into the journal's folder.
2. **Account settings.** Where `~/.claude/settings.json` names Wheelhouse's catalogue (check 37), its `ref` moves to the new tag, but only when every other project registered on this computer has its own project-scope install, so none of them follows the account's. Otherwise the account's `ref` and user-scope install stay, and the last line says which projects keep them. Nothing else in the file changes.
3. **Move the computer's copy of the catalogue** to the tag. Which route does this without uninstalling anything is the first check (section 17, check U1): changing the recorded source and running `claude plugin marketplace update`; adding the catalogue again by its git address; or fetching the tag into Claude Code's own clone with the fenced git. The route is chosen by the check, and `reinstall`'s test (the clone's HEAD is the tag's commit) confirms it.
4. **Update every install.** From `installed_plugins.json`, every install of each plugin the release's catalogue lists (Wheelhouse, Superpowers, Matt Pocock's skills), at each scope it is installed: user (under step 2's condition), and project for this project's folder. `claude plugin update <plugin>@wheelhouse --scope <scope>`, then uninstall and install where the update leaves another commit, as `reinstall` does. Installs at project scope for other projects are left alone (section 10.3).
5. **Check.** Each install's `gitCommitSha` is the release's pin. A project settings file Claude Code rewrote on the way is put back as merged, as `reinstall` does.

### 6.5 Refreshes from the new release (second half)

- **This computer's local settings:** `local-refresh` with the new folder, so the allow rules and the status line name it before the next session starts. The session start's refresh stays as the safety net.
- **Locked,** where this computer has Locked: `updateLocked`, which shows the administrator password window. Locked is one copy for the whole computer, so it follows the newest release installed, as the helper does; the card in section 4 lists it when it will be needed, and names any other Locked project still on an older release. *Designer's call.*
- **Copilot's files,** where this computer has Wheelhouse's Copilot files (hooks, agents, the clean home): written again from the new release by the code setup uses.
- **The build engine,** where the release moves the engine's pins: the engine's own update step, as setup's. Otherwise nothing.

### 6.6 The own-files record

The second half records the update for the own-files look (section 8): the old and new versions, the time, the signed click it came from, and the hash of every file the update itself wrote. No watch line follows.

### 6.7 Handing over the helper

Section 7.

### 6.8 The watcher and the foreman

The project's watcher runs the old version's code. Once the new helper answers, the second half stops it with `stopWatcher` (pid and start time, failing closed) and starts it from the new folder with `startWatcher`. A Shape 1 foreman is started afresh at each wake, so it picks up the new version by itself. A Shape 2 foreman's long session is the director's own terminal; the last line tells them to restart it.

### 6.9 The end

`status` gives the last line (section 4) and the journal is marked done. The next session start sees the record and puts the one confirming line on the board, naming the version that session runs and the helper's. If the new session still runs the old version (for example, Claude Desktop cached it), the line says so and to start one more new session.

## 7. The helper hand-over

### 7.1 What changes in the helper

- **A running record.** The helper writes `~/.wheelhouse/helper.json` once it is listening: its pid, its process start time, its version, its plugin folder and its address. It removes it when it closes. This is the same kind of record the watcher and the foreman already keep, and the proof a later update relies on.
- **`/health` gives its pid** beside its version, so a client can match the record with the process that answers at the address.
- **`/helper/retire` takes a reason.** An update asks with `{ forUpdate: true }`: the helper finishes what it is doing, refuses new work with "Wheelhouse is updating; try again in a minute", and closes. Without a reason it behaves as today (refuses while busy).
- **Version comparison** follows semantic versioning, pre-releases included (section 5).
- **Compatibility, one release back.** A helper must answer the sessions of the release before it, since open sessions keep their version. A test starts the new helper and runs the previous release's client calls against it.

### 7.2 The hand-over, in order

1. Ask the helper at the address for `/health`. If it is already the new version, nothing to do.
2. Ask it to retire, `forUpdate`. Wait for its address to stop answering, up to two minutes, saying "Waiting for the old helper to finish what it's doing" after twenty seconds.
3. Start the new helper from the new folder, exactly as `ensureHelper` does, and wait for `/health` to answer with the new version.

### 7.3 A helper that can't be asked

A helper from 0.2.4 or earlier answers `/helper/retire` with "unknown request". A helper from 0.2.5 or 0.2.6 knows `/helper/retire` but not `forUpdate`: it refuses while busy, so the update asks again every ten seconds within the two minutes, then offers a card to wait longer (recommended) or to stop it by the unrecorded path below; it keeps no record either. A helper of any version may also hang.

- **Recorded helper (0.2.7 and later).** Wheelhouse can prove it started it: `helper.json`'s pid is alive, its start time matches to the second, and `/health` at the address gives the same pid. Only then, and after a card asking the director ("The old helper isn't answering. Stop it? Work it was doing is picked up again by the new one." [Stop it] (recommended) [Leave it]), it is sent the polite stop (`SIGTERM` on macOS, which the helper already handles; on Windows the process is ended, which needs no administrator rights for one's own process). Then step 3 above.
- **Unrecorded helper (0.2.6 or earlier).** There is no record. **Recommended:** find it by its address, not its name: the process holding the helper's socket (`~/.wheelhouse/helper.sock`) on macOS, or the server end of its named pipe on Windows. Stop it only when every one of these holds: it belongs to this user; its command runs `scripts/host/helper-main.js` from a folder of Wheelhouse's in Claude Code's plugin cache; that folder's version is the one `/health` reported; and exactly one process matches. Then the same card. Where the computer won't say who holds the address (a laptop that blocks the lookup), it is left running and the line says it is replaced when the computer restarts or the director signs out and in. *Open decision D2.*
- **Nothing found, or a check fails:** nothing is stopped; the update still finishes, the new helper starts when the old one goes, and the board says why the old one is still answering, as today.

Nothing is ever ended by its name alone, and nothing is ended without the card.

## 8. The own-files look

Three changes to `scripts/health/own-files.js`.

1. **Claude Code's bookkeeping is not Wheelhouse's files.** `.in_use/` and `.orphaned_at` at the top of a plugin folder are skipped, by those exact names. A test plants both and expects no line.
2. **The look follows the folders in use, not the helper's own.** Today there is one baseline and the helper walks its own `pluginRoot`. Instead the baseline keeps one entry per Wheelhouse folder that `installed_plugins.json` lists for a registered project or for the account, each with its own version; a folder no install lists any more drops out (it is Claude Code's to delete). An old helper looking at its own left-behind folder was the second half of the false warning, and two projects on different releases each keep their own entry. The board's line for a project names only the folder that project uses.
3. **A version move is accepted only when it can be explained.** Today any move of the version silently makes a fresh baseline, so swapping in a different folder that claims a new version hides itself. Instead:
   - **After `/wheelhouse:update`:** the update's record (section 6.6) names the version and the files the update wrote. The plugin folder is checked against the release's own files: each file's git blob hash against the tag's tree in the mirror the update fetched. Matches make the new baseline, and the board's calm line says the update happened, with the director's approval. A file that doesn't match the tag is named in a watch line, update or not.
   - **A version move with no update record** (someone ran `claude plugin update` by hand): the same check against the tag's tree. A match is accepted with a calm line, "Wheelhouse moved to v0.2.7 outside the update command"; a mismatch is a watch line.
   - **Copilot's and the add-on's files** an update wrote are accepted only at the hashes the update recorded writing. Any other change to them is still a watch line.

Whether Claude Code adds or changes any other file when it copies a plugin into its cache is check U3 (section 17); anything it does goes in the skip list by name, never by pattern.

## 9. Failures and putting back

### 9.1 What can go wrong, and what the director is told

| Where | What happens | Left as |
|---|---|---|
| The tags can't be read (offline, proxy, GitHub down) | "Wheelhouse's releases couldn't be read just now. Nothing has changed." | as it was |
| The tag fails its checks (not on the default branch, version mismatch) | "Release v0.2.7 doesn't check out, so it won't be installed." | as it was |
| The reviewed change is refused or closed | "The change naming v0.2.7 was not merged, so nothing was installed." | as it was |
| The catalogue can't be moved, or an install fails part-way | Every install already moved is put back to the previous release by `reinstall` at its tag, the backed-up account settings are restored, and the line says what failed. The merged project change stays; the board says "This project names v0.2.7 but this computer has v0.2.6: type /wheelhouse:update to try again." | the previous release, working |
| The put-back itself fails | The line names what is installed and gives the one command that finishes it, `/wheelhouse:update` again, which carries on from the journal. | journal part-way |
| A refresh fails (Locked's password refused, Copilot's files) | The install stands; the line names what is left and the board keeps a line until it is done. Running `/wheelhouse:update` again runs only that refresh. | new release, one refresh left |
| The computer sleeps, the helper restarts, the session closes | The journal holds; the next `/wheelhouse:update`, or the next session start (which notices a journal part-way and says so), carries on. | journal part-way |

### 9.2 Order chosen so a failure leaves something that works

Nothing on the computer moves before the project's change is merged, and the old helper is not touched until the new release is installed and checked. So the only half-states are: the project names a release this computer doesn't have yet (which the board says, and an update fixes), or the new release is installed with a refresh left (which works, with a line).

### 9.3 Putting back on purpose

`/wheelhouse:update v0.2.7` on a computer with v0.2.8 is a put-back. Its card says "Put Wheelhouse back to v0.2.7". It runs the same steps with `undo`'s `wheelhouse-undo-<commit>` branch, which the gate weighs as a release. A put-back to a release from before this command exists (v0.2.6 or earlier) is refused, since that release can't finish an update; the line says so.

## 10. Sessions, computers and projects

### 10.1 Sessions already open

They keep the version they started with until restarted; Claude Code keeps an in-use version's folder. The card says so up front, the last line says to start a new session, and the new helper answers the old sessions meanwhile (section 7.1). An old session's lineage check still matches its own version's manifest, so no hold.

### 10.2 The same project on another computer

Once the change is merged, that computer's next session start sees the project naming a release it doesn't have. The board says "This project now uses v0.2.7: type /wheelhouse:update on this computer." There, the update skips section 6.2.

### 10.3 Other projects on this computer

Each project follows its own committed release, so the update moves only this project's install, and the account-wide one only under section 6.4's condition. Other projects keep their project-scope installs. The newest helper serves them all (a session never retires a newer helper), so the one-release-back rule (section 7.1) matters most here. When the update would leave another registered project more than one release behind the new helper, the card names it and recommends updating it next; that project's board says so too. *Designer's call.*

## 11. macOS and Windows

- Every part is Node.js. No shell scripts, no PowerShell for the update itself.
- No administrator rights anywhere, except Locked's password window, and Locked is macOS-only.
- No `gh` or `glab`: tags through the fenced git over HTTPS; the reviewed change through the project's own adapter, which already works without them (host access design).
- The helper's address on Windows is its named pipe; retire works the same.
- Paths in `settings.local.json` are written by `local-refresh`, which already handles Windows paths and quoting.
- Finding the holder of a named pipe (section 7.3) is check U2: whether it can be done without administrator rights on a locked-down laptop. If not, the fallback in section 7.3 applies there.

## 12. Copilot

### 12.1 Lean

Lean installs nothing and may have no Node.js, so it can't use the helper's job. It gets its own path: a skill, `wheelhouse-update`, in `adapters/copilot/home/skills/`, that the chat follows as it follows `setup-lean`:

1. Find the latest tag with `git ls-remote --tags` (or the one named).
2. Clone it into `~/.copilot/wheelhouse/<tag>/`, as setup's step 2 does.
3. Copy the kit into `~/.copilot/`, checking every file against `MANIFEST.txt` with `git hash-object`; a mismatch stops before anything is replaced. On a Mac without Node.js, the shell guard and its hook file too.
4. Change the project's files that name the old tag's folder (the helper's start command in the Logbook's instructions, `.vscode/settings.json` where it names it) through Lean's usual change, with the director's click in the chat.
5. Keep the previous tag's folder until the next update, so putting back is copying it again.
6. Tell the director to reload VS Code's window.

*Open decision D4.*

### 12.2 Beyond Lean

Copilot projects on a Mac use the Claude Code plugin and the helper, so they take the main path. The refresh in section 6.5 rewrites Copilot's files from the new release, and the own-files look accepts them at the hashes written.

### 12.3 The VS Code add-on

Installed by hand, so the update doesn't install it. When the release carries a newer add-on, the last line says so and where to get it.

## 13. Updating from v0.2.6 or earlier

The command first ships in the next release, so a computer on v0.2.6 or earlier has no command and a helper without the job. It needs one last update by another route. *Open decision D1.*

- **Recommended: one paste in a session that is not on a Wheelhouse project** (for example, a new Claude Desktop session on the home folder, which has no sandbox from Wheelhouse). The README gives the message: it clones the new release into a temporary folder with git, checked as in section 5, and runs `node <that folder>/scripts/update/cli.js bootstrap <project folder>`. Bootstrap runs the same journalled job directly rather than through the old helper's job (which it doesn't have), and asks the same cards. It still uses the running helper for everything that needs the host: the reviewed change goes through its `/pr/open`, which v0.2.6 has, so bootstrap holds no keys and has no host code of its own. It then uses section 7.3's paths for the old helper. Afterwards every update is `/wheelhouse:update`.
- **Alternative:** the same command pasted into Terminal (or PowerShell), answering the cards as typed choices.
- **Alternative:** the hand steps, written out in the README once more.

## 14. What the board and setup say afterwards

- **Board, version line:** "Wheelhouse v0.2.7 (updated 4 November 2026)" for a week, then just the version. "v0.2.8 is out; type /wheelhouse:update when you want it" when there is a newer release (section 5).
- **Board, health lines:** an update part-way ("Wheelhouse's update to v0.2.7 is waiting for its change to merge", "…for work in progress to finish", "…stopped: type /wheelhouse:update to carry on"); a project naming a release this computer doesn't have; a refresh left; an old helper still answering. Each is a `watch` line only where something needs the director; the rest are calm lines.
- **Board, own files:** no watch line after an approved update (section 8).
- **Setup:** setup never stands in the way (as `skills/setup/SKILL.md` already says). An update during setup moves only what setup has already put in place; steps not run yet run from the new release. Setup's journal already says when a newer Wheelhouse wrote it; nothing else changes.
- **Front desk and setup playbooks:** "update Wheelhouse", in any words, goes to `/wheelhouse:update`.

## 15. Where the command may run

- **In the sandbox.** The session runs only `scripts/update/cli.js`, which talks to the helper over its address; `local-refresh` adds that command to the allow rules beside setup's.
- **Under All stop:** refused, with "Lift All stop first".
- **Under a lineage hold:** `plan`, `apply` and `status` go through, as the hold's own check does, since an update is often the way out of a broken install. *Designer's call.*
- **In a feature session or the foreman:** refused; the command is the director's.

## 16. Testing

- Unit tests for each new part: tag choice and semantic version comparison; the journal's carry-on; the own-files skip list and the release-tree check; the helper's record and the proofs of section 7.3 (pid reused, start time off by more than a second, two matching processes, a process of another user: each stops nothing).
- A rehearsal on the Mac, in a scratch project with a scratch catalogue (as the lineage probes do): v(n) to v(n+1) with an old helper running; a failure injected at each step, then carry on; a put-back.
- The same rehearsal on Windows by hand, without administrator rights, recorded in `docs/checks/`.
- A test that the new helper answers the previous release's clients (section 7.1).

## 17. Checks to make before building

- **U1.** The route that moves Claude Code's copy of the catalogue to a new tag without uninstalling anything, on macOS and Windows (section 6.4, step 3).
- **U2.** Finding the process at the helper's address: `lsof` on the socket on macOS; the named pipe's server process on Windows without administrator rights (section 7.3).
- **U3.** Every file Claude Code adds to a plugin's cached folder, and whether the rest matches the tag's tree byte for byte, line endings included on Windows (section 8).
- **U4.** That a pre-release version in `plugin.json` (`0.3.0-rc.1`) installs and updates like any other.
- **U5.** That the second half can run from the new folder while the session that started the update still runs the old version (section 6).

## 18. Rulings to add to the main design

- Updating Wheelhouse is one command, `/wheelhouse:update`, run by the director; the helper does the work as a journalled job, and the new version's code finishes it.
- The project's release changes only through the usual reviewed change; where the director's approval is needed, it is confirmed in the helper's window as for any change to the safety rules (subject to D3).
- A helper keeps a running record and answers the previous release's sessions. Only a provably Wheelhouse-started process is ever stopped, and only after the director's click.
- The own-files look skips Claude Code's own bookkeeping by name, follows the installed version, and accepts a version move only when the files match the release's tag.

## 19. Left to the builder

- File names and the module split under `scripts/update/`.
- The journal's exact format and lock.
- The wording of progress lines, within the voice (main design, section 23.7).
- How long each wait lasts, within the bounds above.

## 20. Decisions

### 20.1 Open, for the director (each with a recommendation)

- **D1. Getting from v0.2.6 to the first release with the command.** (a, recommended) One message pasted into a session on the home folder, which runs the new release's update; (b) the same in Terminal; (c) the hand steps once more.
- **D2. An old helper (v0.2.6 or earlier) that can't be asked, or stays busy.** (a, recommended) Find it by its address, check it is Wheelhouse's own beyond doubt, ask, then stop it; fall back to "it goes when you restart" where the computer won't say; (b) never stop it: always "it goes when you restart".
- **D3. The approval for a release that isn't pins-only.** (a, recommended) The **Update** card in the chat, then the helper's window confirming the change when it is ready, as for any change to the safety rules today; (b) the chat click alone counts as the approval, which loosens today's rule that a chat click is only the agent's own account.
- **D4. Lean's update.** (a, recommended) A Lean skill the chat follows, as setup does; (b) Lean updates by pasting the setup line again with the new tag.
- **D5. The board's line when a release is out.** (a, recommended) One quiet line, weekly look, no card; (b) nothing until the director runs the command; (c) a card in the briefing.

### 20.2 The designer's calls (the director may override)

- The two halves: the old version's code up to the install, the new version's code after it.
- Nothing on the computer moves before the project's change merges.
- Pre-releases install only when named and are never announced.
- A put-back below the first release with the command is refused.
- The command goes through a lineage hold but not All stop.
- Other projects on the computer are not updated with this one; the account-wide install moves only when no other project follows it.
- Locked follows the newest release on the computer.
- The own-files look keeps one entry per Wheelhouse folder in use.
