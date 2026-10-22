<!-- docs/checks/73-keychain.md -->

# Check 73: the keychain inside the sandbox

**Answer:** Deferred — waiting for a Mac sitting. What can be known without touching a keychain is recorded below (no project setting stops a sandboxed program running `security`); whether denying reads of the keychain files stops it is what the probe measures, and it has not been run.

## Question

Whether denying reads of `~/Library/Keychains` stops a sandboxed `security find-generic-password -s <name> -w` from returning an item. It depends on whether the file keychain is read in the calling process, which the denial would stop, or by the security service, which it would not. If the denial holds, what it costs: `codesign` and signing in iOS builds use the keychain too. A second question, for Windows: whether a process at low integrity can read an item in Credential Manager, where `gh` keeps its token (this is check 52's `credential-manager-low` line). The answers set what Task 10 changes in the sandbox settings, after the Copilot plan's Part 3.

## Tested on

21 October 2026, on macOS 27, with `sandbox-exec` and `security help` only; no keychain was read, written or listed. The probe itself (`probes/73-keychain/run.js`) has not been run: it is for the director's sitting. Its pure helpers (the options, the search list, the profile, the result line) have tests (`tests/probes/73-keychain/run.test.js`).

## Method

`node probes/73-keychain/run.js --consent`, run by the agent at the sitting on the Mac, in an ordinary terminal. It refuses to run without `--consent`. It:

1. Records the user keychain search list (`security list-keychains -d user`).
2. Makes a throwaway keychain file in a scratch folder under the temporary folder (`security create-keychain`), and stores one made-up item, `wheelhouse-probe-73`, with a random value, in that file only.
3. Runs `security find-generic-password -s wheelhouse-probe-73 -w <file>` three ways and prints one line for each, `read n characters` or `refused`, never the value:
   - `plain`, with no sandbox;
   - `deny-scratch-folder`, under `sandbox-exec` denying `file-read*` of the scratch keychain's folder;
   - `deny-real-keychains`, under `sandbox-exec` denying `file-read*` of `~/Library/Keychains` while reading the scratch file by path (the control: it should read, as the denial does not cover the file).
4. Deletes the keychain file, puts the search list back exactly, checks it is as it was, and prints `search-list: as it was`. It never reads any other item and never touches the login keychain.

The Windows half is check 52's, in `probes/52-low-integrity/run.js`: a made-up `PasswordVault` item stored at the normal level, read from the low process, removed.

## Evidence

Measured on 21 October 2026 with `sandbox-exec` on macOS 27, without touching any keychain (`security help` only):

- A Seatbelt rule denying `file-read*` of `/usr/bin/security` does not stop it running (exit 0); it only stops it being copied.
- A `process-exec` denial of it does stop it (exit 71).
- Claude Code's sandbox settings offer read and write denials, network lists, `credentials` (files denied, environment variables removed or masked) and `allowMachLookup` (which only adds services). None denies running a program or reaching the security service. So no project setting stops a sandboxed program running `security find-generic-password -w`.
- `gh` and Claude Code both keep their items through `/usr/bin/security`, and `/usr/bin/security` reads those items without a prompt (check 11).

The probe's three lines, and check 52's `credential-manager-low` line, are not yet recorded.

## What it means for the design

- Today nothing in a project's settings stops a sandboxed agent reading the director's `gh` or Claude Code sign-in through `security` (design section 12.9, the keychain item).
- What settings can still do is deny reads of the keychain files (`~/Library/Keychains`). If `deny-scratch-folder` prints `refused` while `deny-real-keychains` reads, the denial holds and Task 10 adds it to the sandbox settings; the cost to weigh is `codesign` and iOS signing, which read the same files. If `deny-scratch-folder` reads, the security service reads the file for the caller, the denial does nothing, and the design says the keychain stays open to a sandboxed agent. If the control `deny-real-keychains` is refused, the probe's reading of the scratch file is not what it was meant to be, and the result is not used.
- On Windows there is no sandbox (check 10), so any agent command can read Credential Manager (`gh` keeps its token there) through PowerShell's `PasswordVault` or `cmdkey`-style calls. Under Guarded, commands run at low integrity; `credential-manager-low` says whether a low process can. If it reads, Guarded's card must not claim it keeps the host sign-in from a build.
- Task 10 changes the sandbox settings, after Copilot Part 3, from this check's answer.

## Needs the director

A Mac sitting of about 5 minutes, with the agent running it. Nothing to type except agreeing to `--consent`: it makes and removes a throwaway keychain and briefly changes, then restores, the keychain search list. The run sheet is `probes/73-keychain/run.md`. The Windows line comes with the Windows sitting for check 52.

Until then the Answer stays Deferred.
