<!-- docs/checks/24-pinning.md -->

# Check 24: pinning through Wheelhouse's marketplace

**Answer:** Partly — in a shell trial, an entry's `sha` installed that exact commit for both Superpowers and Matt's skills (even when `ref` named a later tag), Anthropic's copy of Superpowers switched off in the project's settings, and auto-update stayed off; whether a Desktop session then lists only the pinned skills, with the synced copies off, is still to come in the director's sitting.

## Question

That a plugin entry's `sha` installs that exact commit for Superpowers and Matt's skills; that the project's settings can switch off Anthropic's copy and the synced copies; and that auto-update stays off.

## Tested on

18 October 2026, on macOS with Claude Code 2.1.302, against GitHub.com. Documentation read the same day: https://code.claude.com/docs/en/plugins/marketplace-reference and https://code.claude.com/docs/en/plugins/loading. The upstream tags and commits come from `git ls-remote` on https://github.com/obra/superpowers and https://github.com/mattpocock/skills, and the installed copies from the files under `~/.claude/plugins/`, read only. The Desktop step has not been done yet.

## Method

`probes/24-pinning/run.js --go` copied four of the director's files (`~/.claude/plugins/known_marketplaces.json`, `~/.claude/plugins/installed_plugins.json`, `~/.claude/settings.json` and `~/.claude.json`) to a backup folder under the temporary folder. It then made a scratch project and a scratch marketplace (`probes/lib/marketplace.js`, a git repository holding a `marketplace.json`) in the temporary folder. The marketplace listed two `github` sources:

- Superpowers: `ref` `v7.0.0`, `sha` `bb92a77741419a4ab5f06e711a283343f1ada0c3`.
- Matt's skills: `ref` `v1.3.1`, `sha` `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`, a commit older than that tag, to see which wins.

It added the marketplace to the scratch project at project scope (`claude plugin marketplace add <folder> --scope project`), installed both at project scope, and read `~/.claude/plugins/installed_plugins.json`. It then set `autoUpdate: false` on the marketplace in the project's settings, wrote `enabledPlugins` with `superpowers@claude-plugins-official` set to `false`, and ran `claude plugin list` in the project. Last, it changed both entries' `ref` (Superpowers to `v6.4.2`, Matt's skills to `main`) without changing `sha`, ran `claude plugin marketplace update` and `claude plugin update`, and read the records again. It then uninstalled both, removed the marketplace and the scratch folders, and compared the four files with the copies.

`probes/24-pinning/run.js --sitting` is the Desktop step: the same set-up, plus `superpowers@synced` and `mattpocock-skills@synced` set to `false` in the project's settings; it prints the scratch project's folder, waits for Enter, then undoes everything and compares.

## Evidence

**The shell trial** (log kept outside the repository): 8 of 8 checks passed, and the four files were byte-identical to their copies afterwards.

- **`sha` beats `ref`.** Both installs recorded the pinned commit: Superpowers `bb92a77…` and Matt's skills `c55ee46…`, although Matt's entry named the later tag `v1.3.1`. The installed manifests read 7.0.0 and 1.2.3 (the version in `v1.3.1` is later).
- **Where it installs.** `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, here `…/wheelhouse-probe-pins/superpowers/7.0.0` and `…/mattpocock-skills/1.2.3`. The folder is named for the manifest's version, not the commit, and holds no `.git` folder. The commit is only in `~/.claude/plugins/installed_plugins.json`, under the id `<plugin>@<marketplace>`, with `scope` `project`, `projectPath` (the scratch project), `installPath`, `version` and `gitCommitSha`.
- **Project settings after install.** `enabledPlugins` had `<plugin>@<marketplace>: true` for both, and `extraKnownMarketplaces` held the marketplace with its `source`. `~/.claude/plugins/known_marketplaces.json` also got an entry (it is one file per computer), with no `autoUpdate` key.
- **Auto-update.** Not recorded anywhere by default; the documentation says it is off for every marketplace except Anthropic's own. Setting `"autoUpdate": false` on the marketplace's `extraKnownMarketplaces` entry in the project's settings was accepted. The documentation says that entry is consulted first. No update ran by itself during the trial (the automatic pass starts up to ten minutes into a session, so this is from the documentation, not seen).
- **Switching off Anthropic's copy.** With `superpowers@claude-plugins-official: false` in the project's settings, `claude plugin list` run in the project showed that copy as disabled (its scope is `user`, where it is enabled) and the pinned copy as enabled at project scope. The project's `false` overrides the user's `true`, as the documentation's precedence table says.
- **Synced copies.** `claude plugin list --json` did not list any `@synced` plugin on this Mac, although the files for them are under `~/.claude/plugins/synced/`. The names `superpowers@synced` and `mattpocock-skills@synced` come from the documentation (`<name>@synced`, the manifest name). Whether the keys switch the synced copies off in a Desktop session is what the sitting tests.
- **`plugin update` after the refs moved.** Both updates failed: "Failed to clone repository … `git@github.com`: Permission denied (publickey)". The install had said "SSH not configured, cloning via HTTPS", so the install used HTTPS and the update tried SSH, and this Mac has no SSH key for GitHub. The installed commits and folders did not move, so this does not show that `sha` holds when an update succeeds. It does show that the failure leaves the install alone.

**What the installed copies are** (read only, 18 October 2026):

- **Superpowers 7.0.0** is installed from Anthropic's marketplace, which lists `https://github.com/obra/superpowers.git` at `bb92a77741419a4ab5f06e711a283343f1ada0c3`. That is the commit of the upstream tag `v7.0.0` and of `HEAD`. Its folder is `~/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0` and holds no `.git` folder. A synced Superpowers 7.0.0 also sits under `~/.claude/plugins/synced/`.
- **Matt's skills are a synced plugin**, not a marketplace install: manifest name `mattpocock-skills`, version 1.2.3, repository https://github.com/mattpocock/skills, in a folder under `~/.claude/plugins/synced/` that has no git data and no entry in `installed_plugins.json`. Comparing every file with the upstream history found one match, commit `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` (18 September 2026, "Modified the PR body template to make it easier to scan"), apart from one file, `AGENTS.md`. That commit has no tag: it falls between `v1.2.3` (`6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`) and `v1.3.0` (`984a2c023c9fb42bb6ea40c70a652284a109dc05`), which is why the manifest still says 1.2.3. The next tag is `v1.3.1` (`24fe0ef7737efae15c87225755e9f6f5965e4888`); upstream `HEAD` was `49dd158d1076134a641b33efb035946536778336`, which is also the commit Anthropic's plugin directory lists for it.

## What it means for the design

- **Pin with `ref` and `sha`, and rely on `sha`.** Wheelhouse's marketplace (section 14 of the build-loop design) lists each of Superpowers and Matt's skills as `{ "source": "github", "repo": …, "ref": <tag>, "sha": <full commit> }`. Superpowers: `obra/superpowers`, `v7.0.0`, `bb92a77741419a4ab5f06e711a283343f1ada0c3`. Matt's skills: `mattpocock/skills`; pin a tagged commit, not the untagged one the synced copy happens to be at: `v1.3.1`, `24fe0ef7737efae15c87225755e9f6f5965e4888` (an install at that commit has not been tried).
- **Find what is installed from `installed_plugins.json`, not the folder.** Read `gitCommitSha` for the id `<plugin>@<wheelhouse's marketplace>` with `scope` `project` and the project's `projectPath`. The cache folder is named for the manifest version and has no git data, so two commits with the same manifest version would share a folder name. The fingerprints and the hold (Part 7) should compare `gitCommitSha`.
- **The names to switch off in the project's `enabledPlugins`:** `superpowers@claude-plugins-official: false` (confirmed), and `superpowers@synced: false` and `mattpocock-skills@synced: false` (from the documentation; confirmed or not by the sitting). Both Anthropic's and the pinned copy have the manifest name `superpowers`, so they must not both be on. A project-level `false` beats the user's `true`.
- **Auto-update:** nothing to set for a non-official marketplace, as the default is off; set `"autoUpdate": false` on the marketplace's `extraKnownMarketplaces` entry as well, so a later change of default does not matter. Note that the director's own computer-wide `known_marketplaces.json` gets an entry too.
- **Updates and the undo are not `claude plugin update`.** An update fetches by SSH on a computer with no GitHub SSH key and fails; because a manifest `version` that does not change makes an update a no-op anyway ("already at the latest version"), neither Wheelhouse's upgrade nor its undo (check 30) should rely on it. Move a pin by changing the marketplace entry's `ref` and `sha`, then uninstall and install again at the new pin; that was not tried here and is for check 30.
- **A committed `enabledPlugins` is not enough on another computer.** The documentation says a plugin whose only `true` is in the project's committed `.claude/settings.json` is not fetched on a computer where it is not installed (the Errors tab shows "enabled in project settings but isn't installed here"), unless the marketplace entry is a relative path. Each computer needs a real install at project scope, so setup runs `claude plugin install … --scope project`, and Part 7's session-start warning has to treat "not installed here" as a case.
- **A marketplace may also be declared inline** (a `settings` source, object sources only) in the project's settings; this was not tried.

## Needs the director

Yes, once, in the sitting: about 5 minutes on the Mac. Run `node probes/24-pinning/run.js --sitting`; it sets up a scratch project and prints its folder. In a new Desktop session opened in that folder, ask the session to list the skills it has. Pass: only the pinned Superpowers and Matt's skills appear, and Anthropic's copy and the synced copies do not. Then press Enter in the terminal; the scratch project, marketplace and installs are removed. Opening the folder changes Claude Code's own state file (`~/.claude.json`, the trust entry), so that file may then differ from its copy; the run says so and prints the copy-back command.
