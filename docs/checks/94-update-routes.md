<!-- docs/checks/94-update-routes.md -->

# Check 94: the update command's routes (checks U1 to U5)

**Answer:** Yes on the Mac, with one change to the design. `claude plugin marketplace add <address>#<new tag>` moves this computer's copy of a catalogue already added to the new tag, without uninstalling anything. At `--scope user` or `--scope local` it leaves the project's committed settings alone; at `--scope project` it rewrites them. Each install then moves with `claude plugin update --scope <scope>`. A pre-release version installs and updates like any other, and so does a move to an older tag. The only files Claude Code adds to a plugin's cached folder are `.in_use/<pid>` and `.orphaned_at`; everything else matches the tag's git tree exactly. On macOS, `lsof -t <socket>` names the helper's process by its address. Windows was not tried.

## Question

Spec `docs/specs/2026-11-04-update-command-design.md`, section 17:

- **U1.** The route that moves Claude Code's copy of the catalogue to a new tag without uninstalling anything.
- **U2.** Finding the process at the helper's address.
- **U3.** Every file Claude Code adds to a plugin's cached folder, and whether the rest matches the tag's tree.
- **U4.** That a pre-release version in `plugin.json` installs and updates like any other.
- **U5.** That the second half can run from the new folder while the session that started the update still runs the old version.

## Tested on

4 November 2026, macOS, Claude Code 2.1.302, Node.js 22. U1 and U4 ran against a scratch catalogue and a scratch Claude Code home (`CLAUDE_CONFIG_DIR` pointed at a temporary folder), so none of the director's own files was read or written. U2 and U3 only read the maintainer's live helper and plugin cache.

## Method and evidence

### U1: moving the catalogue

A scratch repository held a catalogue and one plugin in the same repository, as Wheelhouse's does (`"source": "./"`), with tags `v1.0.0`, `v1.1.0` and `v1.2.0-rc.1` and matching `plugin.json` versions. It was served over HTTP on 127.0.0.1 by `git http-backend`. `claude plugin marketplace add` refuses `file://` addresses ("Invalid marketplace source format"). A shell `claude plugin install` doesn't read `extraKnownMarketplaces` from a project's settings either ("Plugin not found"), which agrees with the comment in `reinstall`.

Each route started from the same state: the catalogue added at `v1.0.0` at project scope, and the plugin installed at both project and user scope at `1.0.0`.

- **Adding again with the new tag, at project scope.** The command said "Marketplace 'scratchmk' was already added from …@v1.0.0 and now points at …@v1.1.0. Plugins already installed from it now update from the new source." `known_marketplaces.json` and Claude Code's clone moved to `v1.1.0`, and nothing was uninstalled. **It also rewrote the `ref` in the project's `.claude/settings.json`**, the committed file.
- **Adding again at `--scope user`.** The same move, but the declaration went to the account's `settings.json`, and the project's settings kept `v1.0.0`.
- **Adding again at `--scope local`.** The same move, with the declaration in the project's `.claude/settings.local.json`; the committed file was untouched.
- **After any of the three,** `claude plugin update demo@scratchmk --scope project` said "updated from 1.0.0 to 1.1.0 for scope project", and `--scope user` did the same for the user install. Each scope moves only when it is updated: after the project update alone, the user install stayed at `1.0.0`. `installed_plugins.json` recorded each scope's `gitCommitSha` as the tag's commit.
- **Editing `known_marketplaces.json`'s `ref` and running `claude plugin marketplace update`** also moved the clone ("Clone complete, validating marketplace"). It works, but it edits Claude Code's own record by hand.

### U4: pre-releases and moving back

From `v1.0.0`, adding at `--scope local` with `#v1.2.0-rc.1`, then updating the project install, gave "updated from 1.0.0 to 1.2.0-rc.1". The cache folder was named `1.2.0-rc.1` and the commit was the tag's. Adding again with `#v1.1.0` and updating gave "updated from 1.2.0-rc.1 to 1.1.0", so an older tag installs the same way. The folder left behind got `.orphaned_at`.

### U3: what Claude Code adds to the cached folder

The maintainer's cached `0.2.6` folder, compared file by file with `git ls-tree -r v0.2.6`, has the same 1,945 paths. Every file's `git hash-object --no-filters` equals its blob in the tag, apart from what is listed here:

- `.in_use/<pid>`: one small file per Claude Code process using the folder, each holding `{"pid": …, "procStart": "…"}`. They come and go with sessions, and with `claude plugin` commands too.
- `.orphaned_at`: a number of milliseconds since 1970, written when a version is left behind. The `0.2.5` folder has it, and is otherwise the `v0.2.5` tree.

The repository's `.gitattributes` sets `* text=auto eol=lf`, so a Windows checkout should hold LF too. That hasn't been tried.

`~/.wheelhouse/own-files.json` on the same Mac holds `.in_use/<pid>` entries for the `0.2.6` folder. This confirms the cause the design gives for the false watch line.

### U2: the process at the helper's address

`lsof -t ~/.wheelhouse/helper.sock` printed one pid in about a quarter of a second. `lsof -U -F pn` showed that pid holding a socket named by that path, and `ps` gave its command as Node.js running `~/.claude/plugins/cache/wheelhouse/wheelhouse/0.2.6/scripts/host/helper-main.js`. No client was connected at the time. A client's end of a Unix socket isn't named by the path on macOS, but the design's rule of exactly one matching process covers the case where one is.

### U5: running the second half from the new folder

U1 showed that the new version's cached folder exists as soon as `claude plugin update` returns, and that the old folder stays (marked orphaned) while sessions use it. The helper already starts long-lived processes detached (`ensureHelper`, the watcher), and such a process outlives the one that started it. Nothing here needs the old session to end. Running it end to end belongs to the plan's rehearsal.

## What it means for the design

- **Section 6.4, step 3, the route:** `claude plugin marketplace add https://github.com/where-is-brett/wheelhouse.git#<tag> --scope user` where the account's settings already name Wheelhouse's catalogue, otherwise `--scope local`. Never `--scope project`, which rewrites the committed file. The account's `ref` (step 2) then comes from this command rather than a hand edit. Then `claude plugin update <plugin>@wheelhouse --scope <scope>` for each install, and `gitCommitSha` is checked. The fallback, if the add is refused, is the `known_marketplaces.json` edit and `marketplace update`.
- **The address form.** The scratch catalogue used a `git` source over HTTP. Wheelhouse's catalogue was added as `where-is-brett/wheelhouse#vX` (a `github` source), and its upstream entries use `https` `url` sources. Whether adding again with the `github` form at a new tag gives the same message is the first thing the rehearsal tries. If the source types differ, Claude Code may treat them as two catalogues.
- **Section 8:** the skip list is exactly `.in_use/` and `.orphaned_at`, at the top of a plugin folder.
- **Section 7.3:** on macOS the lookup by address is `lsof -t <socket path>`, then `ps -o user=,lstart=,command= -p <pid>`.
- **Section 5:** pre-releases need nothing special from Claude Code.

## Not tried

- Windows: the named pipe's server process without administrator rights (U2), line endings in the cache (U3), and every route above. All go to the Windows rehearsal by hand, and the design's fallbacks stand until then.
- A `github` source and the real GitHub, which the plan's Mac rehearsal covers.
