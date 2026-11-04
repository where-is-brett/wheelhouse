<!-- probes/95-update/run.md -->

# Check 95: the update on Windows, for the director's sitting

What this finds out, on a Windows computer with no administrator rights: whether the update can read Wheelhouse's releases without `gh`, whether it can name the process that serves the helper's named pipe, whether Claude Code's plugin cache holds the release's files byte for byte (line endings included), and whether one update goes through from start to end. The design is `docs/specs/2026-11-04-update-command-design.md` (sections 5, 7.3, 8 and 11). The Mac's half is `docs/checks/95-update-rehearsal.md`.

Every step an agent can do is a command below, run in PowerShell, not as administrator. Only a click in a card is the director's. Nothing here needs a password, and no key is typed anywhere.

**Notes** go in `%TEMP%\wheelhouse-check95\notes.md`, appended after each part. Nothing is written in the repository. Write `<version>` for the installed Wheelhouse version (the folder name under `%USERPROFILE%\.claude\plugins\cache\wheelhouse\wheelhouse\`), and `<tag>` for a release tag such as `v0.2.7`.

## Before the sitting

1. Make the notes folder: `New-Item -ItemType Directory -Force "$env:TEMP\wheelhouse-check95"`.
2. Write down, in the notes:
   - `git --version`, `node --version` (22 or later) and `claude --version`;
   - `Get-Command gh -ErrorAction SilentlyContinue` (blank is the case being tried; if `gh` is installed, run the part 1 commands with it hidden: `$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notmatch 'GitHub CLI' }) -join ';'`);
   - `$ExecutionContext.SessionState.LanguageMode` (it must say `FullLanguage`; the pipe lookup exits otherwise, which is itself a finding);
   - that this window is not elevated: `net session` should answer "Access is denied".
3. Close every Claude Code session except the one the director is using for the sitting.

## Part 1: the releases, without `gh`

1. Tags straight from git over HTTPS: `git ls-remote --tags https://github.com/where-is-brett/wheelhouse.git`. Expect a list ending in the latest release. Behind a company proxy this may ask for a sign-in or fail; write down which, and the text.
2. The update's own reading of them, from the installed folder:

   ```text
   node --input-type=module -e "import('file:///' + (process.env.USERPROFILE + '/.claude/plugins/cache/wheelhouse/wheelhouse/<version>/scripts/update/release.js').replace(/\\/g,'/')).then(async m => console.log(JSON.stringify(await m.listReleases(), null, 1)))"
   ```

   Expect a list of `{ tag, sha }` entries with the same tags. If it throws or gives an empty list, copy the message as it is.
3. Write: whether `gh` was absent, whether both commands gave the same newest tag, and how long each took.

## Part 2: the pipe's server process, without administrator rights

1. Make sure the helper is running (start a session on a Wheelhouse project, or `node "$env:USERPROFILE\.claude\plugins\cache\wheelhouse\wheelhouse\<version>\scripts\host\helper-main.js"` in another window).
2. The address and what answers there:

   ```text
   node --input-type=module -e "const r='file:///'+(process.env.USERPROFILE+'/.claude/plugins/cache/wheelhouse/wheelhouse/<version>/scripts/').replace(/\\/g,'/'); const {helperAddress}=await import(r+'lib/paths.js'); const {helperClient}=await import(r+'host/helper-client.js'); const a=helperAddress(); console.log(a); console.log(JSON.stringify(await helperClient({address:a}).health()))"
   ```

   Expect `\\.\pipe\wheelhouse-<user>-helper` and `{"ok":true,"version":"<version>"…}`.
3. The lookup the update will make:

   ```text
   node --input-type=module -e "const r='file:///'+(process.env.USERPROFILE+'/.claude/plugins/cache/wheelhouse/wheelhouse/<version>/scripts/').replace(/\\/g,'/'); const {helperAddress}=await import(r+'lib/paths.js'); const {run}=await import(r+'lib/run.js'); const o=await import(r+'update/old-helper.js'); console.log(JSON.stringify(await o.findByAddress({address:helperAddress(), run, version:'<version>', cacheRoot:process.env.USERPROFILE+'\\\\.claude\\\\plugins\\\\cache'})))"
   ```

   Expect `{"pid":…,"startTime":"…","command":"…\\node.exe …\\helper-main.js"}`. Compare the pid with the one Task Manager (Details tab) shows for that `node.exe`. Anything else is the finding: `{"why":"not told"}` means the computer would not say who serves the pipe (the update then leaves the old helper running and says it is replaced after a restart or a sign-out), and `{"why":"not Wheelhouse's helper …"}` means the program's path or command line did not match; copy the `why`.
4. Do not stop anything in this part. The stop is tried in part 4 with the director's click.
5. Write: `FullLanguage` or not, the `why` or the pid, and whether the pid matched Task Manager.

## Part 3: line endings in the cache

1. A clean copy of the installed release's tag: `git clone --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git "$env:TEMP\wheelhouse-check95\tag"`. Write `git config --get core.autocrlf` (blank is fine).
2. Compare each file in Claude Code's cached folder with the tag's own blob, ignoring any conversion:

   ```text
   $cache = "$env:USERPROFILE\.claude\plugins\cache\wheelhouse\wheelhouse\<version>"
   Set-Location "$env:TEMP\wheelhouse-check95\tag"
   $bad = @(); $n = 0
   git ls-tree -r HEAD | ForEach-Object {
     $parts = $_ -split "`t", 2; $sha = ($parts[0] -split ' ')[2]; $file = $parts[1]
     $path = Join-Path $cache $file
     if (Test-Path -LiteralPath $path) { $n++; $h = git hash-object --no-filters -- $path; if ($h -ne $sha) { $bad += $file } } else { $bad += "$file (missing)" }
   }
   "$n files compared; $($bad.Count) differ"; $bad | Select-Object -First 20
   ```

   The repository's `.gitattributes` sets `* text=auto eol=lf`, so every file should match, none differing. If files differ, run `git hash-object --no-filters` on the cache copy and `git cat-file -p <sha> | Measure-Object -Character` against the file's length, and write whether the cache copy has CRLF endings (`(Get-Content -Raw -LiteralPath $path) -match "`r`n"`). The update's check of a release against its tag would call each such file changed.
3. Which files exist in the cache and not in the tag: `Get-ChildItem -Recurse -Force -File $cache | Where-Object { $_.FullName -notmatch '\\\.in_use\\' } | ForEach-Object { $_.FullName.Substring($cache.Length + 1) -replace '\\','/' }` against the tag's `git ls-files`. Expect only `.orphaned_at` (on a folder left behind) and `.in_use\<pid>` files.
4. Write: the count compared, the count differing and the cause.

## Part 4: one update, end to end

This needs a release newer than the one installed that carries `/wheelhouse:update`. Until one is tagged, do parts 1 to 3 and do part 4 with the PowerShell paste (step 4b) from a release that has it.

1. Use a scratch product, not a real one: a folder with a git repository and Wheelhouse installed for it, set up as the README says. Write the installed version.
2. Start a session on that folder. Type `/wheelhouse:update`.
3. Expect a card naming the installed release, the new one and what changes. Click **Update**. Watch the lines (waiting for the project's change, installing, handing over the helper). When the change is shown for review, merge it as for any change.
   - If a card says the old helper isn't answering and asks to stop it, the process named must be the pid from part 2. Click **Stop it**. Expect the new helper to answer within a minute; write how long it took, and that no administrator prompt appeared.
4. a. After the session reports the update done, run part 2 step 3 again with the new version: the pid should have changed, and `%USERPROFILE%\.wheelhouse\helper.json` should name the new version and pid.
   b. For a computer still on v0.2.6 or earlier, the paste from the README instead: open PowerShell in the scratch folder and paste the Windows line with `<tag>` replaced. Type `1` at the card. Write what it printed, whether it needed anything typed but `1`, and whether the stop card appeared in the window.
5. A day later, or by changing the clock on the checking only if the director agrees: the board shows no watch line about Wheelhouse's own files.
6. Optional put-back: `/wheelhouse:update <old tag>` offers a put-back card; write whether it went through.

## After the sitting

Add the notes to `docs/checks/95-update-rehearsal.md` under "Needs the director", with what was seen on Windows: the tags without `gh` (part 1), the pipe lookup (part 2), the line endings (part 3) and the update (part 4), each as passed, failed or not tried.
