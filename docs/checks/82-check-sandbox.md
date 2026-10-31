<!-- docs/checks/82-check-sandbox.md -->

# Check 82: a real Mac app's tests under the check sandbox

**Answer:** Partly. The real project's tests passed under the sandbox, but only by the Swift package row, since it holds no committed Xcode project. The draft profile of spec 4.4 failed: a program started by `open` ran outside the sandbox and read a planted secret, and `xcodebuild test` did the same with the project's own app. Apple Events got as far as macOS's consent prompt, which the director saw. A tightened profile, still allow-by-default, shut every way tried. Under it tests with no test host run, and hosted tests are refused in about two minutes, never run outside. So hosted tests can't count yet: clearing `TEST_HOST` is the only way forward found, and it passed only on a made-up app.

## Question

Spec sections 3 and 4.4, and the plan's part 0. Does a real Mac app's test run work under the profile: `xcodebuild test` with the switches and `CODE_SIGNING_ALLOWED=NO`, `prepare`, a separate `HOME`, and the time with and without kept build output? Does every way out fail from inside: `launchctl submit`, `open`, `osascript`, an Apple Event, reading the keychain, a login item? Which row of the table in 4.5 works, and does the profile stay allow-by-default?

## Tested on

31 October 2026, on macOS 27.0.1 (arm64) with Node.js 22.22.1 and Xcode 27.2. The real project is a Mac app: a `Package.swift` with one test target and an XcodeGen `project.yml`, whose `.xcodeproj` is generated and ignored by git. The main session ran the probe on it. It isn't named here, and the probe's report has its names taken out. The ways out and the made-up app ran on the same Mac.

## Method

`probes/82-check-sandbox/run.js` has four phases. Each works in a check folder of its own under `~/Library/Caches`, outside the temporary folders a check may write, as the real check folder is, and that folder goes to the Trash at the end.

- **`ways`.** A secret is planted in a folder on the profile's deny list. A way out counts as open only on proof: a job started from inside the sandbox reads that secret and writes it beside itself, in a folder the profile can't write. Near a real key, only characters are counted, and nothing is printed. Each way also ran with no sandbox as a control, leaving out those that touch a key or send an Apple Event.
- **`fixture`.** A made-up Mac app with hosted tests and tests with no host (`fixture.js`). The app's first line and each test report whether they can read the secret, write beside it and list the keychain folder.
- **`swift`.** A made-up Swift package, the next row of the table.
- **`project <folder>`.** The real project. It reads the folder's head commit by `git fetch` into the check folder and changes nothing in the folder. With a workspace or Xcode project it takes the Xcode route; with only `Package.swift` it takes the Swift route: `prepare`, the tests from nothing, then a reset and clean that keeps ignored output, and the tests again.

**The profiles.** `draft` is spec 4.4 with the device files any program needs. `tight` adds these lines, and is what ran on the real project:

```
(deny appleevent-send)
(deny lsopen)
(deny job-creation)
(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd")
                  (global-name "com.apple.coreservices.sharedfilelistd")
                  (global-name "com.apple.coreservices.sharedfilelistd.xpc")
                  (global-name "com.apple.pasteboard.1"))
(deny process-info*)     (allow process-info* (target self))
(deny signal)            (allow signal (target same-sandbox))
(deny network-outbound (remote unix-socket (path-regex "^<home>/")))
```

They name services and operations, not programs, so a compiled program gets no further than `open` does. A first version also denied running `launchctl`, `open` and `osascript` by path; that was taken out, and the ways stayed shut.

`open` is a profile with nothing denied at all (`(allow default)`), under `sandbox-exec`, as a control for the made-up app.

## Evidence

**The ways out.** "Shut" means no proof appeared.

| Way | With no sandbox | Draft | Tight |
|---|---|---|---|
| Read the file on the deny list | Read | Shut | Shut |
| Write outside the allowed folders | Written | Shut | Shut |
| Read the login keychain file | Read | Shut | Shut |
| `security show-keychain-info` | Not run | Shut | Shut |
| `git-credential-osxkeychain get` | Not run | Shut, 0 characters | Shut, 0 characters |
| `gh auth token` | Not run | Shut, 0 characters | Shut, 0 characters |
| List `~/.wheelhouse` and `~/.ssh` | Listed | Shut | Shut |
| `curl` to the internet | 200 | Shut | Shut |
| `launchctl submit` | **Out** | Shut, exit 1 | Shut, exit 1 |
| `launchctl bootstrap` | **Out** | Shut, exit 5 | Shut, exit 5 |
| `open` on an app | **Out** | **Out: read the secret** | Shut, error -54 |
| A compiled program calling `NSWorkspace` | **Out** | **Out: read the secret** | Shut, exit 3 |
| `osascript` to Finder | Not run | "privilege violation" (-10004) | Shut, -54 |
| `osascript` to Terminal, `do script` | Not run | **Reached the consent prompt.** Timed out at 25 seconds, unanswered | Shut, -54 |
| `osascript` to System Events, login item | Not run | "privilege violation" (-10004) | Shut, -54 |
| Copy a plist into `~/Library/LaunchAgents` | Not run | Shut | Shut |
| A socket in a folder on the deny list | Connected | **Connected** | Shut |
| Read another process's environment with `ps eww` | Shut | Shut | Shut |
| Signal another process | Allowed | **Allowed** | Shut |
| Read the clipboard | Read | **Read, 43 characters** | Shut, 0 characters |

The Terminal line counts as open under draft. Only macOS's prompt stood in the way, and the main session told the director to press Don't Allow. On a computer where that permission was once granted, the event would have run a command outside the sandbox. The -10004 lines may rest on the same kind of consent, so they aren't counted as the profile's doing. Under tight, no Apple Event left the process and no prompt appeared. The probe no longer sends these under draft unless given `--prompts`. The probe's own table marks the clipboard as open under tight, as its test reads only the exit code; 0 characters came back.

**`xcodebuild test` on the made-up app.**

| Profile | Tests with no host | Hosted tests | The app's own first line |
|---|---|---|---|
| `open` | Passed; read the secret, as the control should | Hung, then failed: "The test runner hung before establishing connection" | Not measured |
| `draft` | Passed; no secret, no write outside, no keychain files | Hung until killed | **Ran outside, started by launchd (parent 1): read the secret, wrote outside, listed 10 keychain files** |
| `tight` | Passed; no secret, no write, no keychain files | Refused: "LaunchServices has returned error -54". The stage ended in about 130 seconds | Never ran |
| `tight`, with `TEST_HOST=` and `BUNDLE_LOADER=` set empty | Passed | **Passed, as tests with no host: no secret, no write, no keychain files.** 109 seconds | Not started |
| No sandbox at all | Not run | Passed | Not measured |

So the hang comes from `xcodebuild` being under `sandbox-exec` at all, even with nothing denied, and not from the profile's rules. One try at a way round: `xcodebuild` unsandboxed, with the app's program replaced by a small launcher that sandboxes itself and then starts the real program. It held: the app stayed inside although launchd started it. But the tests hung the same way, or the app aborted if `launchservicesd` was denied. That line was stopped, and the launcher isn't in the probe.

**The real project,** under tight, on the Swift route:

| Stage | Result | Time |
|---|---|---|
| `swift package resolve --disable-sandbox` (`prepare`) | Passed | 84 seconds |
| `swift test --disable-sandbox`, nothing kept | Passed | 116 seconds |
| `swift test --disable-sandbox`, build output kept | Passed | 86 seconds |

The test bundle's process stayed under the check's own process in every sighting. No macOS prompt appeared. `.build` is ignored by the project and survived the clean, at 277 MB. The separate `HOME` took 104 KB: `.swiftpm`, and `Library/HTTPStorages`.

**Other findings.**

- **Time.** On the made-up Swift package, the sandbox seemed to add over a minute: `swift package resolve` took 78 seconds under tight and 2 with no sandbox, and `swift test` took about 90 against 15. That minute was the probe's own reading of the log, not the sandbox (see part 1, below).
- **`/dev`.** The spec's blanket `(deny file-write*)` also denies `/dev/null` and `/dev/ptmx`. Without those, `xcodebuild` stops with "Pseudo Terminal Setup Error".
- **`prepare`'s denial of the home folder** also denies the folders on the way down to the check folder. Swift stops with "unable to set working directory" until each is allowed by `literal`.
- **`HOME` isn't the whole story.** Foundation's `NSHomeDirectory()` still gave the real home, with `HOME` and `CFFIXED_USER_HOME` both set. SwiftPM's writes to the real `~/Library/Caches` are refused and only warn.
- **`xcode-select`** points at the Command Line Tools on this Mac, so the tools need `DEVELOPER_DIR` set to Xcode's folder. `testEnv` doesn't set it.
- **Ending a run.** A check can't end what launchd started: hung apps outlived `xcodebuild` and were ended by process number. Waiting for the output to close also overran: one 2-minute limit took 21 minutes, and one 8-minute limit took over two hours, while the Mac may have slept. The probe now stops waiting past the limit.
- **The kernel's denial lines.** `log show` gave no lines for the check's own processes, so the probe's `refused` lists show only other programs. They prove nothing either way.

### Part 1: the deny-by-default profile

Main ruled for deny-by-default (spec 4.4). `checkProfile` (`scripts/checks/profile.js`) is that profile, and `--profile deny` is now the probe's default. These ran on the same Mac on 31 October 2026.

**Every way out is shut.** All 27 ways of `ways` under the test stage, and all but `curl` under `--stage prepare`, whose network is its purpose. The control got out on 17 of the 19 ways it tries; of the other two, reading another process's environment is shut with no sandbox too, and the clipboard was empty. The probe now lays the check folder out as the real one is, deep inside a folder on the deny list, and added five ways: listing a folder above the check folder, planting a file in the per-user temporary folder, writing a preference, the SSH agent's socket, and a compiled program calling `LSOpenCFURLRef`, an older door than `NSWorkspace`. All five are shut.

**The real project under this profile.** Its first run read as red, on tests that pass elsewhere, and the tail of a timed-out run shows a hang on the second try, after that red run: a build of under a second can't be a first build from a cleared tree. The `hang` phase names what the sandbox refused, and the failure came from a lookup of file types. On a made-up program, `UTType(filenameExtension:)` gave a made-up `dyn.` type for every extension until `com.apple.lsd.mapdb` was allowed; `lsd.modifydb` and `coreservicesd` weren't needed. 34 other common calls showed no hang, from windows and fonts to Core Data and `URLSession`. The map service reads and starts nothing: the tight profile allowed it and every way stayed shut, and with it allowed here `open`, `NSWorkspace`, `LSOpenCFURLRef` and Apple Events all still fail, since `launchservicesd` and `lsopen` stay refused. Only the test stage has it.

**The stall, and free disk space.** The remaining red tests had one cause: the free-space lookup answered 0 with `com.apple.cache_delete.public` refused, so a project that checks for room failed. On a made-up program the answer was right with that service allowed, and `vfs.disk-space` alone didn't change it. The hang came back on a repeat run, as it does on only some runs, and `sample` showed test threads waiting for replies from three refused services, with the rest queued behind them. A made-up program reproduced it every time, with the same stacks: one refused service, called at once from as many Swift tasks as the Mac has cores. 11 tasks ended, 12 stalled, on 12 cores. The audio registrar, the telemetry registration service and `cache_delete.public` are now allowed to tests alone, and 192 tasks across those calls ended 16 times out of 16.

That cures what was found, not the kind: a refused service called by a full task pool stalls, whichever it is. 40 parallel tests on a made-up package stalled under the earlier profile, and with `swift test --no-parallel` they passed in the same sandbox.

What the three can do: none starts a program a test chooses. The new `audio-component-host` way plants an audio component in the check's home that would run the payload, and asks for it out of process: the planted component left no proof, and the host was refused with -10875. It has no control, since the registrar reads the real home, which the probe leaves alone. `cache_delete.public`'s purge calls weren't tried, as a purge deletes real files. That a caller without an Apple entitlement is refused is read from the daemon's own text, not tested.

**How a stall reads.** `timed-out`, never red: the time limit ends the run, on the first try or on the rerun after a red one, and a test in `tests/scripts/checks/run.test.js` holds the second case. A stall in the Xcode second try reads `could-not-run`, as anything but a pass does there. The stall stays a known limit, not a cured one: part 3's finder writes `swift test --no-parallel` for Swift packages, a project can change that, and part 1's default command stays as it is.

**The real project, at the end.** With the three allowed: ten repeats of `swift test` passed in 1.1 minutes with no process sampled, and `runner` passed twice, in 0.7 minutes each. All the project's tests passed on every run, and no proof appeared beside the secret. The audio and telemetry allowances stay: they're proved on the real project, and `--no-parallel` isn't yet.

**The extra minute was the probe.** It gave `log show --start` UTC time, which that reads as local, so at 11 hours from UTC it searched 11 hours of logs, inside the stage's timer. Each stage's time in the tables above is about a minute too long. Measured with that taken out, `swift package resolve` took 2 seconds and `swift test` of the made-up package under 20. The sandbox costs nothing to notice.

**A new way out, found on the way.** `xcrun` keeps its lookup of tools in the per-user temporary folder, which the draft and tight profiles let a check write. A test could plant a lookup there and the director's next build, outside the sandbox, would run what it names. It wasn't tried, since the fix is simple. Leaving `com.apple.bsd.dirhelper` off the service list sends `xcrun`, SwiftPM and `xcodebuild` to the check's own `TMPDIR`, and those folders stay shut.

**Swift.** `runner` runs the whole of `runCheck`: a made-up package with a real dependency fetched from GitHub, on the main line from nothing, passed in 0.9 minutes. `prepare` fetched over https through git, and `ls` of the real home was refused.

**Xcode.** `xcodebuild test` can't run under this profile: it first stopped on holding off sleep, and given that it stopped on `testmanagerd.control`. Allowing that service once got it further, and it still failed; it wasn't kept, since that service starts programs. `xcodebuild build-for-testing` with `TEST_HOST=` and `BUNDLE_LOADER=` empty, then `xcrun xctest` on each bundle, passed both the made-up app's bundles inside the sandbox with no service added. `runner --fixture` took that second try and passed in 0.4 minutes, with no proof beside the secret.

### What was not tested

- `xcodebuild test` on a real app. The real project has no committed Xcode project, and its generated one wasn't built. So the hosted-test finding comes from the made-up app, and whether `TEST_HOST=` builds when tests link the app's own code is unknown.
- Whether the real app's tests that live only in XcodeGen's targets were reached. `swift test` ran the package's one test target.
- `crontab`, which might have changed the director's own table, and other Apple services by name.
- The ways out run from inside a real test, as opposed to the shell under the same profile, except the three reports of the made-up app.
- Tight on a project whose test needs `NSApplication`. With `launchservicesd` denied, such a test aborts.

## What it means for the design

For the main session as cards, not yet changed in the design:

- **Section 4.4's profile must change.** The draft isn't safe: on an Xcode project it runs an agent's code outside the sandbox with the signing key in reach. Part 1's `checkProfile` should be the tight profile, plus the `/dev` lines and `prepare`'s `literal` lines.
- **The spec says one escape moves the profile to deny-by-default.** The recommendation is to stay allow-by-default with the lines above, since they block by operation and service, not by name. The spec's reason still stands: a deny-by-default list breaks on each macOS update. This is a change to a designer's call (13.6), and it's the main session's to rule on. Part 1 can build either: the lines all sit in `checkProfile`.
- **The table in 4.5.** The `Package.swift` row works as written, on a real project. The `*.xcworkspace or *.xcodeproj` row works only for tests with no host. A project with hosted tests gets `could-not-run` from the sandbox, which is safe, and the risk table's card covers it: no check runs unsandboxed without the director's say. The finder could try `TEST_HOST= BUNDLE_LOADER=` as the row's command, if a real project shows it builds.
- **A new row, or a note on the first.** `project.yml` with an ignored `.xcodeproj` is a real shape. The real project reads as a `Package.swift` project, and it passed. If its tests live in XcodeGen's targets, the finder would need `xcodegen generate` first, in `prepare`.
- **Later parts may go ahead.** The way forward holds for Swift packages and tests with no host, and part 1 waits on no other answer. A hosted Xcode project stays at `could-not-run` until a route is found.
- **Part 1's run** must also set `DEVELOPER_DIR`, stop waiting at the time limit, and find out what the minute of waiting is. Tests that read `NSHomeDirectory()` see the real home's name, though nothing there can be read.
- **`checks.network`, and a test's localhost.** Tight still lets a test reach any localhost port and sockets outside the home. Nothing listening there was tried.

## Needs the director

Nothing to do. One macOS prompt reached the director during this check, with word to press Don't Allow. Whether a project with hosted tests gets a way to run is for the main session, and it reaches the director only as the card already designed.

Nothing was changed in the real project. No login item, launch agent or job was left behind: `launchctl list`, `~/Library/LaunchAgents` and the login items were read after the runs. Each check folder went to the Trash, and so did the crash reports the made-up app left.
