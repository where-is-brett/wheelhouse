<!-- docs/checks/38-host-tools.md -->

# Check 38: `gh` and `glab` without an installer

**Answer:** Partly — on macOS (Apple silicon) both tools were fetched by a script from their official release pages, matched their published checksums, unpacked with the system's own `tar`, ran, and carried no quarantine mark; both programs are signed with the maker's Developer ID and notarised, so macOS has nothing to warn about. No password and no installer were involved. The same on Windows waits for the Windows sitting, which is written out below and needs only an agent.

## Question

Whether `gh` and `glab` can be fetched by a script from their official release archives, checked against the published checksums and run from `~/.wheelhouse/tools/`, on macOS (where `gh`'s package is unsigned, check 19) and on Windows, with no installer, no password and no warning; and how long it takes.

## Tested on

macOS 27.0.1 on Apple silicon (arm64), Node.js 22.22.1, 19 October 2026. `gh` 2.102.0 (released 30 September 2026) and `glab` 1.123.0 (the version check 5 used), the latest of each on that day. Three runs, and a fourth with a deliberately changed byte. Windows was not used.

The script ran from a new folder under the temporary folder, and it ran each tool with an empty home folder and none of the token variables, so the director's own `gh` and `glab` sign-ins were neither read nor used. Every request was anonymous. The folder was removed at the end of each run (the script reports `scratchRemoved: true`; no `wheelhouse-check38-` folder was left).

## Method

`node probes/38-host-tools/run.js` (no installs, `fetch` from Node itself):

1. **Find the latest release.** `gh`: `https://github.com/cli/cli/releases/latest` is read for its redirect (the tag is in the address), so no API call is made. `glab`: GitLab's release API, `https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest`, which lists each file's address.
2. **Fetch the checksum list**, and pick this system's archive from the names on it (or on GitLab's list of links). The pick refuses unless exactly one archive matches, so a package or installer is never taken by mistake.
3. **Download the archive**, check its SHA-256 against the list, and **stop at a mismatch** (nothing is written or unpacked).
4. **Unpack** with `tar -xf` (macOS's `tar` is bsdtar 3.5.3, which reads both the zip and the tar.gz).
5. **Run `<tool> --version`**, and look at the unpacked program with `xattr -l`, `codesign -dvv`, `codesign --verify --strict`, and `spctl --assess` (two ways, below). These are evidence of what Gatekeeper would say for a file a script downloaded, with no quarantine mark, since Gatekeeper acts on a file only when a browser, mail program or similar has marked it.
6. Time each part.

Unit tests with no network (`tests/probes/38-host-tools/run.test.js`, eleven) cover picking the archive for each system and processor, reading a checksum list, refusing a mismatch or a name that is not on the list, reading the tag, finding the unpacked program, and the Windows unpack command. `--tamper` changes one byte of each download before the check; run once, it refused with "Checksum mismatch", exited 1, removed the folder, and unpacked nothing.

## Evidence

**Where the files are, and what they are called** (the version is in every name):

| System | `gh` archive | `glab` archive |
| :- | :- | :- |
| macOS, Apple silicon (`darwin`, `arm64`) | `gh_<v>_macOS_arm64.zip` | `glab_<v>_darwin_arm64.tar.gz` |
| macOS, Intel (`darwin`, `x64`) | `gh_<v>_macOS_amd64.zip` | `glab_<v>_darwin_amd64.tar.gz` |
| Windows, Intel/AMD (`win32`, `x64`) | `gh_<v>_windows_amd64.zip` | `glab_<v>_windows_amd64.zip` |
| Windows, Arm (`win32`, `arm64`) | `gh_<v>_windows_arm64.zip` | `glab_<v>_windows_arm64.zip` |

- **Checksum files.** `gh`: `gh_<v>_checksums.txt` ("<sha256>  <name>" lines, one per file, packages included). `glab`: `checksums.txt`, listed among the release's links.
- **Addresses.** `gh`: `https://github.com/cli/cli/releases/download/v<v>/<name>`. `glab`: each link's `direct_asset_url`, `https://gitlab.com/gitlab-org/cli/-/releases/v<v>/downloads/<name>`, which redirects to GitLab's package store and needs no sign-in.
- **Names to avoid.** `gh` also publishes `gh_<v>_macOS_universal.pkg` (the package of check 19), `.msi` files and Linux files; `glab` publishes `glab_<v>_Windows_x86_64_installer.exe` and `..._Windows_arm64_installer.exe` (capital W and `x86_64`, where the zip says `windows_amd64`), `.deb`, `.rpm`, `.apk` and a `_source.tar.gz`. The pick matches only the four names above.
- **Inside.** `gh` zip: a folder `gh_<v>_macOS_arm64/` with `bin/gh`. `glab` tar.gz: `bin/glab` with nothing above it. The Windows zips were not opened; the script looks for `gh.exe` and `glab.exe` anywhere under the unpacked folder.
- **Sizes** (Apple silicon): `gh` 14.4 MB, `glab` 17.7 MB.

**No token is needed to fetch either.** GitHub's release pages and downloads are public. GitHub's anonymous API is not usable for this: it answered HTTP 403 "API rate limit exceeded" from this computer's address (60 requests an hour for anyone without a token, shared by the whole address), which is why the script reads the "latest" redirect instead. GitLab's release API answered HTTP 200 with no token; it reports `ratelimit-limit: 500` for unauthenticated requests, and a run makes one.

**Result, macOS Apple silicon** (the three runs agreed; the first ran before the script recorded the full `codesign` text, so its signing detail comes from the second and third):

| | `gh` | `glab` |
| :- | :- | :- |
| Checksum matched the published list | Yes (`da922c20…c337e`) | Yes (`bf776ea4…386df`) |
| `--version` | `gh version 2.102.0 (2026-09-30)` | `glab 1.123.0 (5686d7484)` |
| `com.apple.quarantine` on the program | No | No |
| Signed | Yes: Developer ID Application: GitHub (VEKTX9H2N7), hardened runtime, timestamp 30 Sep 2026 | Yes: Developer ID Application: GitLab Inc. (W6RC2CZR58), hardened runtime, timestamp 13 Oct 2026 |
| `codesign --verify --strict` | valid, satisfies its Designated Requirement | the same |
| `spctl --assess -t open --context context:primary-signature` | accepted, `source=Notarized Developer ID` | accepted, `source=Notarized Developer ID` |
| `spctl --assess -t exec` | rejected: "the code is valid but does not seem to be an app" | the same |

- **What the two `spctl` lines mean.** `-t exec` is the test for an application, and it rejects any bare command-line program for being "not an app"; that line is not a warning anyone would see. `-t open … primary-signature` is the test for a file that is not an app, and it is the one that names notarisation: both programs pass it as notarised. A notarisation ticket cannot be stapled to a bare program, so macOS may need to look it up online; this computer was online, and an offline first launch was not tried.
- **The only extended attribute** on the downloaded archive and the unpacked program was `com.apple.provenance`, which macOS adds itself to files written by a process it tracks. It is not the quarantine mark and asked nothing. Node's `fetch` and `tar` set no `com.apple.quarantine`; that mark is set by programs that choose to (browsers, mail, messaging). Nothing was dragged through Finder or opened by a person, so what macOS would show a person double-clicking the file in Finder was not seen, and the programs run from a terminal or from a script, which is how setup would run them.
- **No warning, prompt, or password** appeared in any run: `--version` ran at once, from the unpacked folder, the first time.
- **The unsigned `gh` package of check 19 was not re-tested** (it was not downloaded). The standalone program inside the zip is signed and notarised, so the route in this note does not depend on the package.

**Time** (this computer's own connection, 19 October 2026; three runs, in milliseconds):

| | find release | download | checksum | unpack | `--version` | total |
| :- | -: | -: | -: | -: | -: | -: |
| `gh` | 456 – 742 | 352 – 685 | 6 – 12 | 175 – 1800 | 411 – 420 | 1681 – 3320 |
| `glab` | 1419 – 1597 | 1012 – 1283 | 8 – 9 | 91 – 974 | 536 – 561 | 3118 – 4136 |

Both tools together took about 5 to 7 seconds. The download is the part that depends on the connection; the unpack time swung most between runs (the first time macOS meets a new program). The Windows time is not measured.

## What it means for the design

For Task 7 (setup's host-tools step) and the step-2 card of section 15:

- **macOS: fetch, don't install.** Setup can put `gh` and `glab` in `~/.wheelhouse/tools/` itself: find the latest release as above, take the one archive named in the table for the Mac's processor (`process.arch`: `arm64` or `x64`, written `arm64` and `amd64` in the names), check its SHA-256 against the release's checksum file and stop at a mismatch, unpack with `tar -xf`, and keep `bin/gh` and `bin/glab`. No installer, no password and no system prompt, and the card need not say that the system will ask to open anything. The "if the answers differ" fallback (use the official package and tell the director the system will ask to open it) is not needed on Apple silicon. Intel Macs: the archive names are listed and were not run, so treat them as unconfirmed until run on one.
- **Pick the archive by matching a list, not by building a name.** The two tools name Windows and macOS files differently (`macOS` against `darwin`, `windows` against `Windows` for the installer only), and a package or installer sits beside every archive. `pickArchive` in `probes/38-host-tools/run.js` refuses unless exactly one name matches; Task 7 can copy it into its own script (a probe is not a module the plugin loads).
- **Unpack only after the checksum passes, and never with `-P`.** Task 7 writes nothing out of an archive until its SHA-256 has matched, and unpacks into a new, empty folder with `tar -xf` and never `-P`, so `tar` (bsdtar, on macOS and as Windows' `System32\tar.exe`) keeps its default of stripping a leading `/` and refusing a path with `..` or one that goes through a link, and nothing in the archive can land outside that folder.
- **Say what the checksum does.** The checksum list comes from the same release page as the archive. It catches a damaged or cut-short download and a swapped file on a mirror; it does not protect against a release that was itself replaced. The signature gives a second line: the unpacked program can be checked on the Mac with `codesign --verify --strict` and `spctl --assess -t open --context context:primary-signature`, which pass only for a notarised Developer ID, and setup can use that as a further check before first use.
- **Do not use GitHub's API to find the version.** Anonymous calls are limited to 60 an hour per address and were already refused here. Use the "latest" redirect.
- **If setup should keep a version.** Both tools name the version in the archive and the tag; setup should record the tag it fetched in `~/.wheelhouse/tools/`, so an update is a deliberate fetch and not a surprise.
- **Time.** On a fast connection, about 5 to 7 seconds for both tools on the Mac, against a minute or more for two installers with prompts (check 19); it costs far less of step 2's time than installers would.

## Needs the director

Nothing for the Mac part. For the Windows part (**the Windows sitting, R1**), the director is only at the computer; the agent runs it:

1. Get `probes/38-host-tools/run.js` onto the Windows computer. It is one file with no installs. It was written and run on Node.js 22, but it uses only the built-in `fetch` and Node's standard modules, so Node.js 18 or later runs it. Check 35's sitting installs nothing on Windows (there are no administrator rights there): it uses the `node` it finds, and if that is missing or too old, its step W2 has the agent fetch the portable Node.js zip into `%TEMP%\wheelhouse-node`, check it against the release's `SHASUMS256.txt`, and run it by its full path, in double quotes, without putting it on PATH. Use that same `node.exe` here. Paths with spaces are quoted throughout.
2. In PowerShell: `node "C:\path to\run.js"` (the script makes and removes its own folder under `%TEMP%`, named `wheelhouse-check38-…`). Then `node "C:\path to\run.js" --tamper`, which must refuse and exit with code 1.
3. Record from the JSON: the archive names the script picked (expected `gh_<v>_windows_amd64.zip` or `_arm64.zip`, and the `glab` ones), that `tar.exe` from `System32` unpacked the zip (the script names that copy on purpose, so a GNU `tar` from Git for Windows on the path is not used; if it fails, `Expand-Archive` is the alternative to try), `--version` for both, the times, `zoneIdentifier` (expected none, as Node's `fetch` writes no Mark of the Web), and `authenticode` for each program (the Windows programs' signing was not looked up before running).
4. Also note whether Windows Defender or any policy (SmartScreen, AppLocker, a security product on a work computer) blocked, delayed or asked about either program, and that nothing needed administrator rights. A program started by a script may not be able to show a SmartScreen dialog, so a hang or a refusal is the sign to look for; where it happens, the director is asked to say what the screen shows.
5. Remove anything left: `Get-ChildItem $env:TEMP -Filter wheelhouse-check38-*` should show nothing.
6. Then update this note's Answer to Yes or No, with the Windows table filled in.

The Windows code in `run.js` (the PowerShell lines for `Zone.Identifier` and `Get-AuthenticodeSignature`, the System32 `tar.exe` path) has been written and unit-tested for its command, not run.
