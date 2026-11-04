<!-- docs/checks/95-update-rehearsal.md -->

# Check 95: the update command's Mac rehearsal

**Answer:** Partly. On the Mac the update's install, its put-back, its journal, the stop of an old helper and the own-files look all behaved as designed against the real GitHub tags v0.2.2, v0.2.5 and v0.2.6, in a temporary home. Adding the `github` form again at a new tag works at project and local scope. Three things need mending: when the account's own settings declare the catalogue at the old tag, no route moves it (the install stops and puts the computer back, but the update cannot proceed on that computer); the README's hand steps leave the plugin where it was; and no tag carries the update command yet, so the second half and the bootstrap could not be run for real. Windows and the director's own steps are listed at the end.

## Question

Spec `docs/specs/2026-11-04-update-command-design.md`, sections 16 and 17, and part 13 of `docs/superpowers/plans/2026-11-04-update-command.md`:

- adding again with the recorded `github` address form at a new tag (check 94's open question);
- v(n) to v(n+1) with an older helper running;
- a failure injected after each journal step, then carrying on;
- a put-back;
- the own-files look the day after, with no line;
- the README's hand steps for the bootstrap, if they can be tried inside a temporary home.

## Tested on

4 November 2026, macOS, Claude Code 2.1.302, Node.js 22, Wheelhouse's code at the merge of pull request #302 (parts 1 to 11 of the plan). Everything ran in a temporary home (`HOME`, `CLAUDE_CONFIG_DIR` and `WHEELHOUSE_HOME` all pointed there) with a scratch git project in it. The real `~/.wheelhouse`, `~/.claude`, projects and installed plugin were not read or written. The real GitHub was used read-only: listing tags, `git clone --depth 1` of public tags, and Claude Code's own fetch of the public catalogue at a tag. The temporary home was a short path (`/private/tmp/w95`), because the helper refuses a socket path longer than 103 bytes.

## Method

Small driver scripts, kept outside the repository, called the update's own modules (`installRelease`, `putBack`, `runJob`, the old-helper functions, `checkOwnFiles`) with the temporary home, and the real `claude plugin` commands were run by hand beside them. The old helper was the v0.2.2 release's `helper-main.js`, cloned from the real tag into the temporary plugin cache and started by the rehearsal (the only process stopped was that one).

## Evidence

### Adding again with the `github` form (the open question of check 94)

- **Catalogue first declared at project scope** (the README's own way: `claude plugin marketplace add "where-is-brett/wheelhouse#v0.2.5" --scope project`, then install at project scope). Adding again at `--scope local` with `#v0.2.6` printed "Marketplace 'wheelhouse' was already added from github:where-is-brett/wheelhouse@v0.2.5 and now points at github:where-is-brett/wheelhouse@v0.2.6". The record in `known_marketplaces.json` moved, the declaration went to `.claude/settings.local.json`, and the committed `.claude/settings.json` kept `v0.2.5`. `claude plugin update wheelhouse@wheelhouse --scope project` then went from 0.2.5 to 0.2.6 with the tag's commit. Adding again at `--scope user` afterwards was accepted. So the `github` form counts as the same catalogue; it is not two.
- **Catalogue first declared in the account's `settings.json`** (`--scope user`). Adding again at the new tag was **refused** at `--scope user` and at `--scope local`: "its source doesn't match its extraKnownMarketplaces entry in user or managed settings; add it from the source that entry lists, or change the entry." The design's fallback (set `ref` in `known_marketplaces.json`, then `claude plugin marketplace update wheelhouse`) **also fails**: with the record and the account's declaration disagreeing, Claude Code stops listing the catalogue at all ("Marketplace 'wheelhouse' not found"). What did work: changing the `ref` in the account's `settings.json` itself and then adding at `--scope user`; the catalogue and the plugin then moved. The update's own `installRelease` met this: "Wheelhouse v0.2.6 was not installed: Claude Code would not move the Wheelhouse catalogue to the new release. This computer was put back to v0.2.5."

### v(n) to v(n+1) and the put-back (real tags v0.2.5 and v0.2.6)

With the catalogue added the README's way (project scope):

- `installRelease` moved the catalogue, Wheelhouse, Superpowers and Matt Pocock's skills to the v0.2.6 pins (`e5bd79439249`, `bb92a7774141`, `24fe0ef7737e`), and said so. The committed project settings were untouched and `git status` in the project stayed clean. The v0.2.5 cached folder got `.orphaned_at`, and v0.2.6's folder held `.in_use/`.
- Running it again at the same tag changed nothing.
- A check that failed after the catalogue had moved (the pin given was the earlier release's commit) gave "the catalogue is at e5bd79439249, not v0.2.6 (f1e4dc56ab87). This computer was put back to v0.2.5." and the record, the installs and the project settings were all at v0.2.5 again.
- After a clean install, `putBack` to v0.2.5 gave "This computer was put back to v0.2.5." with the same end state.
- The v0.2.6 cached folder held the same 1,945 paths as the tag, and `diff` against a fresh clone of the tag found no file different, apart from `.in_use/`.

### A v0.2.2 helper running

Started by the rehearsal under the temporary home, with node's full path (as the helper's own starter uses). It reported `{"ok":true,"version":"0.2.2"}` and answered `/helper/retire` with `forUpdate` as "unknown request", as the design says an old helper does. It has no `helper.json`.

- `findByAddress` (`lsof -t` on the socket, then `ps`) named its one process, its start time and its command, and refused the same lookup with the wrong version ("not Wheelhouse's helper from the plugin cache at the reported version").
- `stopProved` looked again, sent the polite stop, waited for the address to go quiet and answered `{"stopped":true}`. The process was gone and its socket removed.
- When the same helper was started with a bare `node` instead of its full path, the lookup refused it (`ps -o comm=` gave `node`, not a path, and the check requires a full path). That fails safe: nothing is stopped, and the restart line applies.

### Failure after each journal step, then carrying on

`runJob` ran the ten journal steps with a failure injected after each in turn, then a second run from a freshly opened journal. The `checks` step (the real fetch and tag check against GitHub) and the install were the update's real code; the steps that need a host (the reviewed change, its merge, work in progress, backup and the hand-over) were counters. For all ten cases the first run stopped at the step with that step `failed` and the later ones `todo`, the second run finished, and only the step that failed ran a second time. A run with no failure finished in one go. The lock was taken and released each time.

### The own-files look the day after

With the look's baseline made at v0.2.5 and `.in_use/<pid>` files planted in the cached folders, the install moved the computer to v0.2.6:

- the next day's look found nothing changed, and its calm line was "Wheelhouse moved to v0.2.6 outside the update command" (no update record had been written, as the rehearsal's job was not the real one);
- two days on, with another `.in_use` file planted, the look gave no line at all;
- a line appended to one of the folder's files was named, and only that file.

### The README's hand steps

- The clone line (`rm -rf` then `git clone --depth 1 --branch v0.2.6 … ~/.wheelhouse/update/bootstrap/v0.2.6`) ran, and ran again over the first copy with no error. v0.2.6 has no `scripts/update/`, as expected, so `cli.js bootstrap` itself could not run from it.
- **The hand steps do not move the plugin as written.** With the catalogue listed, the Install step's rule skips the add; running only `claude plugin install wheelhouse@wheelhouse --scope project` answered "already installed" and changed nothing. With the add run at `--scope project` and `#v0.2.6`, the catalogue and the committed project settings moved to `v0.2.6`, but the install still answered "already installed … run `claude plugin update wheelhouse@wheelhouse --scope project` to get it". Only that `claude plugin update` moved the plugin to 0.2.6.

## What it means for the design

1. **Section 6.4, steps 2 and 3.** The account-declared case is not covered. Neither add route nor the `known_marketplaces.json` fallback moves a catalogue the account's `settings.json` declares at the old tag. Either the job edits that declaration's `ref` itself (the file is Claude Code's, and the design says "not a hand edit"), or the update refuses plainly on such a computer and says what to do, or setup stops declaring the catalogue in the account's settings. This is a decision for the designer and the director; nothing was changed in this part.
2. **The README's hand steps** (written in part 11) need `claude plugin update wheelhouse@wheelhouse --scope project` after the add, and need to say that the add is not skipped when the catalogue is already listed.
3. **Section 7.3.** The lookup works on macOS as designed. A helper started by a bare `node` name is left running, with the restart line, which is the intended safe failure. `defaultCacheRoot` looks in `~/.claude`, so a computer that sets `CLAUDE_CONFIG_DIR` elsewhere would not match its own helper; not tried.
4. **Section 8.** Skipping `.in_use/` and `.orphaned_at` works, a version move is accepted only against the tag's tree, and a changed file is still named.
5. **Check 94's open question** is answered: the `github` and `git` source forms move the same way, with the account-declared case above as the exception.

## Needs the director

### Left undone, and why

- **The second half and the bootstrap, end to end.** No tag carries the update command yet, and the release address is written into `scripts/lineage/manifest.js` with no way to override it, so the job cannot be pointed at a scratch catalogue. The first run of the whole update is the first release with the command: `finish.js` from the new folder, the hand-over to the new helper, and `bootstrap`. They go to the director's sitting.
- **Known gaps, recorded as such:**
  - The Copilot click path for the Update card is not built.
  - `addonNewer` is false, so the add-on's newer-version line is not yet raised.
  - No automated test drives the live Terminal for bootstrap. Bootstrap refuses inside a Claude Code or Wheelhouse session and needs the director's own terminal, so it was not run here; that guard was left alone.
  - The README hand steps for bootstrap are unrehearsed beyond the clone line above; the rest of them is item 2 of the design list.
  - The update cards are asked in the chat, not the panel, by design (the one-card design's ruling).

### For the director's sitting

Exact steps, on the Mac, once the release with the command is tagged (replace `<tag>` with it):

1. In Terminal, in the product's folder: `rm -rf ~/.wheelhouse/update/bootstrap/<tag> && git clone --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git ~/.wheelhouse/update/bootstrap/<tag> && node ~/.wheelhouse/update/bootstrap/<tag>/scripts/update/cli.js bootstrap "$PWD"`. Type `1` at the card. Expect the install, the hand-over to the new helper (an old helper is found by its address and a stop card asked in the Terminal) and the project's change opened; merge it.
2. Check `~/.wheelhouse/helper.json` exists and names the new version, then start a session on the product: its board should show the new helper's version.
3. Type `/wheelhouse:update` in a session when a later tag exists, click **Update**, and watch the card, the wait and the board's line.
4. A day after, look at the board: no own-files watch line.
5. Whether the account's `settings.json` on this computer declares the Wheelhouse catalogue: `grep -c extraKnownMarketplaces ~/.claude/settings.json`. If it does, the update will stop as in the first finding above.

The Windows sheet is `probes/95-update/run.md`.
