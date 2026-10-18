<!-- docs/checks/30-undo.md -->

# Check 30: the undo

**Answer:** Yes — against a scratch marketplace and plugin on macOS, moving the marketplace entry back to the previous release's `ref` and `sha`, then `claude plugin marketplace update` and `claude plugin update <plugin>@<marketplace> --scope project`, reinstalled the previous commit every time, including when that release's cached folder had been deleted first; the 14-day clean-up itself was stood in for by that deletion, not waited for, and a `github` source was not tried.

## Question

That the undo script reinstalls a previous commit from Wheelhouse's marketplace, including after Claude Code's 14-day clean-up.

## Tested on

18 October 2026, on macOS with Claude Code 2.1.302, with no network. Documentation read the same day: https://code.claude.com/docs/en/plugins/loading (clean-up of previous versions, versions and updates, where plugins live on disk) and https://code.claude.com/docs/en/plugins/marketplace-reference (the `url` plugin source accepts a `file://` address; when `ref` and `sha` are both set, `sha` is checked out). Windows was not tried.

## Method

`probes/30-undo/run.js --go`, run once with the director's yes. It copied four of the director's files (`~/.claude/plugins/known_marketplaces.json`, `~/.claude/plugins/installed_plugins.json`, `~/.claude/settings.json` and `~/.claude.json`) to a backup folder under the temporary folder, and refused to start if the scratch marketplace or its cache folder already existed.

- **The scratch plugin** was a local git repository in the temporary folder, so nothing needed GitHub. It held two commits: release A (tag `v1`, `plugin.json` `version` 1.0.0, a file saying "release A") and release B (tag `v2`, version 2.0.0, "release B"). The versions differ because an update does nothing when the manifest `version` is unchanged (check 24). A branch `release-line` was left at B.
- **The scratch marketplace** was a second git repository (`probes/lib/marketplace.js`), added at project scope as a folder, with one entry of source type `url` giving the plugin repository's `file://` address, a `ref` and a `sha`. Release A's entry named `release-line` as its `ref`, which points at B, with A's `sha`, so the run shows which of the two wins.
- **The moves.** Install A in a scratch project at project scope; move to B; move back to A with A's folder still in the cache; move to B again; delete A's folder from the cache; move back to A. Each move edited the entry's `ref` and `sha` and committed it, ran `claude plugin marketplace update`, then `claude plugin update <plugin>@<marketplace> --scope project`. The probe was written to fall back to uninstall then install if the update did not leave the wanted commit installed, and to check, after every move, the commit recorded in `installed_plugins.json`, the manifest version and the release file in the installed folder.
- **The deletion** was of only `~/.claude/plugins/cache/<marketplace>/<plugin>/1.0.0`, the folder recorded at A's first install, after checking it was inside the scratch marketplace's own cache folder, existed, and was not the folder in use. It stands in for the 14-day clean-up: the documentation says an `.orphaned_at` marker is written into the previous version's folder on update or uninstall, and the folder is removed 14 days later.
- **The undo.** The probe uninstalled the plugin, removed the marketplace, deleted the scratch cache folder and the scratch repositories, and compared the four files with the copies.

## Evidence

18 of 18 checks passed, and the four files were byte-identical to their copies afterwards (log kept outside the repository).

- **Every move went by `plugin update`;** the fallback never ran. Each reported "updated from 1.0.0 to 2.0.0" or the reverse, in about a second.
- **A was installed at its `sha`.** The first install recorded `gitCommitSha` `ceb7362…` (A) with the folder `~/.claude/plugins/cache/<marketplace>/<plugin>/1.0.0`, and the installed release file read "release A". Going back later recorded `ceb7362…` again, version 1.0.0 and "release A" in the folder.
- **`sha` beat `ref`.** A's entry named `release-line`, which pointed at B (`069cd52…`), and A still installed: the commit, the manifest version and the files were A's.
- **Orphaning.** After the move to B, A's folder carried an `.orphaned_at` marker holding a number (milliseconds since 1 January 1970, here `1792320643523`) and B's did not. After going back to A with the folder kept, A's marker was gone and B's was set. After moving to B again, A's was set and B's was gone. So a move back does clear the marker on the release that is installed again, which matters because a stale marker could get a live folder swept.
- **After the folder was deleted.** With A's folder gone from the cache (B installed and in use), moving the entry back to A's `ref` and `sha` and running `marketplace update` and `plugin update` fetched A again: the folder was recreated with A's files, `gitCommitSha` was A's, and the folder had no marker. B's was then marked orphaned.
- **The cache folder is named for the manifest version,** and `installed_plugins.json` keeps `installedAt` from the first install and moves `lastUpdated` and `gitCommitSha` with each update, so the installed commit is read from `gitCommitSha`, not the folder (as in check 24).
- **A `file://` git address worked with `update`.** Check 24 found `update` on a `github` source tried SSH and failed without a key; here there was no remote to authenticate to.

## What it means for the design

- **The undo's route (for the undo script):** in Wheelhouse's marketplace, set the plugin entry's `ref` and `sha` back to the previous release's; run `claude plugin marketplace update <marketplace>`; then `claude plugin update <plugin>@<marketplace> --scope project`, once for Superpowers and once for Matt's skills. Afterwards read `gitCommitSha` in `installed_plugins.json` for the project (not the folder name) to confirm each is back at the previous release's commit.
- **It works after the 14-day clean-up,** because the entry is fetched again at its `sha` into a new folder; nothing depends on the old folder still being in the cache. What was tried is a deleted folder, not a swept one after 14 days, and the same sweep skips when no install is recorded (documentation), which does not arise while the project's plugins stay installed.
- **Releases must differ in `plugin.json` `version`,** or `update` is a no-op ("already at the latest version") and the undo would leave the later commit in place. Wheelhouse's pins of other people's plugins carry their own versions; where two pinned commits share a version string, the undo cannot use `update` and has to uninstall and install (the probe's fallback route, which was not exercised).
- **A `github` source is not covered.** Check 24 found `plugin update` on a `github` source cloned over SSH and failed on a Mac with no GitHub SSH key, while the install had used HTTPS. This check used a local `file://` address, so it does not show that `update` works for a `github` entry. Task 29's undo must not assume it: the undo needs a route that works without SSH (for example uninstall then install, which check 24 saw use HTTPS), and that route was not tried here for a `github` source.

## Needs the director

Nothing on the Mac: the probe ran and undid itself. Windows was not tried.
