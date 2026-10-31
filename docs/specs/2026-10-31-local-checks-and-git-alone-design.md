<!-- docs/specs/2026-10-31-local-checks-and-git-alone-design.md -->

# Local checks and git alone: design

**Status:** approved by the director on 31 October 2026 ("Build it"). The build plan is `docs/superpowers/plans/2026-10-31-local-checks-and-git-alone.md`. Nothing in it is built yet.

**The ruling this answers (the director, 31 October 2026).** Wheelhouse must not insist on GitHub or GitLab. A project kept only on this computer, in git alone with no code host, is fully supported, building included, on the Archon engine.

**The ruling on checks (the director, 31 October 2026).** A project with no CI minutes has its tests run on this computer inside Wheelhouse's sandbox, and the result counts as the check. A self-hosted GitHub Actions runner was turned down, because it runs agent code outside the sandbox, and so was waiting for CI minutes. Local checks are the first part built, and they work for a hosted project with no CI as well as for git alone.

**The rulings on backups and tests (the director, 31 October 2026).** Section 12 records both: one warning at setup and then a calm status, in place of reminders; and a project with no passing tests still merges, with the tests counting for good once they pass.

**What it changes.** Two pieces, designed together and built in this order:

1. **Local checks.** The project's tests run on this computer, inside Wheelhouse's sandbox, and their result counts as the check the merge gate needs. A GitHub project with no CI uses the same thing, with the helper reporting the result to GitHub as a commit status.
2. **Git alone.** A project with no host at all: the project's history has a home on this computer that only the helper can write, a local change stands in for a pull request, and a small local queue stands in for Archon's merge queue.

Where this design and `docs/specs/2026-10-29-wheelhouse-on-archon-design.md` (the Archon design) differ, this one wins once approved. It carries out ruling A7 of `docs/specs/2026-10-17-wheelhouse-design.md` (section 15) and leaves section 24 of that design as it is: the private record is already local.

**Marks.** *Designer's call* marks a choice the designer made, which the director may override; section 13 lists them. Section 12 holds the questions that are the director's.

## 1. Intent

Today a project needs a host, and a host needs checks. Setup refuses a remote that isn't GitHub or GitLab (`detectHost`, `scripts/host/adapter.js`), and without CI nothing can merge: Archon's gate refuses a change with no checks, and the protection step already says so ("the project has no checks yet, so Wheelhouse won't merge anything until it has CI", `scripts/host/protection.js`). So a person with no CI minutes, or who doesn't want their work online, can't use the engine at all.

The director wants neither to be a condition. A product kept on one computer is a real product. Wheelhouse fits it as it stands, keeps it as safe as a hosted one, and is honest about the one thing a host gave for free: a second copy.

## 2. Goals, non-goals and anti-goals

**Goals**

- A hosted project with no CI, or no CI minutes, builds and merges through the normal path, with no change to the project and no minutes spent.
- A project in git alone gets every lane, every review, previews, approvals, All stop, a red-main fix, the Logbook and the briefing.
- No new question for a project that needs none. Wheelhouse finds the test command, finds that there is no host, and goes on.
- No agent can move the main version, or plant a passing check, on either kind of project.
- A project can move to a host later with one card, losing nothing.

**Non-goals**

- GitLab or ssh remotes on Archon. They stay on the old engine (Archon design, section 16), so "hosted" in this design means GitHub.
- Windows. The checks' sandbox is macOS's. Windows follows with Windows itself.
- A second computer driving a git-alone project. One computer drives it, and a backup restores it.
- Moving a hosted project back to git alone.
- Copying the private record off the computer (main design, section 24.7, answer 4).

**Anti-goals** (failures even if everything technically works)

- A check result an agent could write, or a test command a branch could change.
- The director reading "commit status", "bare repository", "remote" or "forge".
- A project that looks backed up and isn't.
- Wheelhouse pretending to be GitHub: a stand-in that imitates a host's API for Archon to read.
- Moving the project's `.git` or changing how the director works in their own folder.

## 3. What Archon v0.13.0 needs from a host

Read from the source at tag v0.13.0 (commit `0d39c1f2`). Paths under `.shared/` are in `.archon/workflows/sdlc/.shared/`.

| # | Fact | Where |
|---|---|---|
| A1 | The gate merges only when the state of the checks at the head is `green`. The states are `none`, `pending`, `green` and `red`, and `none` is refused like `red`. **No checks at all means nothing merges** | `.shared/merge.ts:199`, `:312`, `:577` |
| A2 | The state rolls up **every** check on the commit, both check runs and commit statuses, with no idea of "required". One failing or stuck check that isn't ours holds the merge | `.shared/merge.ts:283`, `:292-313` |
| A3 | **The check status can come from elsewhere.** A commit status counts like a CI job. Check 76 merged real pull requests with nothing but statuses posted by a script and no Actions at all | `docs/checks/76-archon-merge.md` |
| A4 | The main line holds merges only when `red`. A `pending` or `none` main line doesn't | `.shared/merge.ts:581`; `merge-queue/scripts/facts.ts:168` |
| A5 | `requires: [github]` on the queue isn't the barrier: it is enforced only in Archon's per-user GitHub mode, which Wheelhouse doesn't use | `packages/core/src/orchestrator/dispatch/gates.ts:89`, `packages/cli/src/commands/workflow-run-preflight.ts:155` |
| A6 | **The queue can't run on a local repository.** Its first step needs a repository `{host, path}` and a remote whose URL names it, and a local path names none | `.shared/remote.ts:20-46`, `:89-93`; `.shared/maintainers.ts:64`; `merge-queue/scripts/facts.ts:186` |
| A7 | Archon has one seam for this: `ARCHON_SDLC_FORGE=forge` with an `archon-forge-<name>` plugin answering seven typed operations. There is no local plugin: a local remote resolves to "none" | `.shared/forge.ts:26`; `.shared/merge.ts:259`; `packages/forge/src/discovery.ts`; `reference/forge.md` |
| A8 | Even on that seam the queue's agent still calls `gh` (`pr view`, `pr edit`, `issue view`, `run rerun`) and fetches `refs/pull/<n>/head` | `merge-queue/commands/sweep.md`, lines 16, 20, 30 |
| A9 | The forge call runs `archon forge` from inside the agent's step, so it would have to read Archon's `config.yaml` and `plugins/`, which Wheelhouse's sandbox denies to every agent (Archon design, section 6.4). `ARCHON_CLI_COMMAND` can't be swapped: Archon sets it itself | `packages/cli/src/commands/forge.ts:23`; `packages/paths/src/cli-command.ts`; `packages/workflows/src/exec-environment.ts:78` |
| A10 | **A build run needs a remote, not a host.** Making a worktree fails with "no git remote is configured" when there is none, but any remote will do: it fetches from it and reads its default branch. `worktree.remote` and `worktree.baseBranch` name them | `packages/isolation/src/providers/worktree/create.ts:370-416`, `:420-456`; `packages/git/src/branch.ts:16` |
| A11 | A repository with no recognised remote is a normal Archon project, kept under a `_local` owner | `packages/paths/src/project-paths.ts:94-107` |

**Wheelhouse's side:** every step of the pack reaches the host only through the helper's routes (`scripts/engine/routes.js`: `host.push`, `host.open`, `comment`, `merge`, `changesOf`, `refresh`), so the lanes don't know what is behind them.

**So:** Archon's build lanes run on a local repository as they are. Archon's merge queue doesn't, and that is the one place a Wheelhouse piece stands in (section 7.4).

## 4. Local checks

### 4.1 Where checks run

Each project has one answer, worked out and shown on the Logbook, never asked:

| The project | Checks run |
|---|---|
| In git alone | Here |
| Hosted, with working CI | On the host, as today. Nothing changes |
| Hosted, with no CI (`hasCi` finds no checks and no workflows) | Here, reported to the host |
| Hosted, with CI that never reports | See below |

**CI that never reports.** A workflow can be present while no job ever starts. Fact A2 means a stuck check can't simply be ignored, since the gate reads every check on the commit. When the head's host checks stay queued for 30 minutes, or fail without any job having run, on two heads in a row, the project gets one level-3 card. Wheelhouse can't do this step itself: the connection is barred from a repository's administration and workflows (`NEVER`, `scripts/setup/own-app.js`), and that bar stays. So **Run the checks here**, recommended, opens the page on GitHub where the director turns the project's own checks off with one click, reversibly; the card says exactly what to press. Wheelhouse sees the checks stop and carries on. **Leave them** keeps waiting. The same card covers a check from another app that never reports. The card says only that the host's checks aren't running. It never talks about billing. *Designer's call.*

The setting is `checks.where` in `.claude/wheelhouse.json`: left out, it is worked out as above; `here` or `host` fixes it.

### 4.2 The settings

These live in `.claude/wheelhouse.json` on the **default branch**, a guardrail file, and the helper reads them from there, never from the branch being checked. A branch can't change what its own check runs.

```json
{
  "testCommand": "swift test --disable-sandbox",
  "checks": { "where": "here", "prepare": "swift package resolve", "minutes": 20 }
}
```

- `testCommand` is the field the done checks and the work order already use.
- **Before the file holds it.** Wheelhouse's own finder (section 4.5, a script, not an agent) keeps what it found in the project's private record, and that is what runs until the default branch names a command. A new project gets the command in setup's project files, under the one card. A project already set up gets it through the helper's own route for project files, with that first check as its check. It is the one guardrail change no one approves, since no agent wrote it. After that, any change to the command is an ordinary guardrail change for the director.
- `checks.prepare` is an optional command that fetches what the tests need. It alone has the network (section 4.4).
- `checks.minutes` is the time limit, 20 by default.

### 4.3 What happens in a check

The check runner is a new core module, `scripts/checks/`, run by the helper. No agent, no model and no tokens.

1. **When.** A check starts when the helper takes in a new head (the lanes' push), and when the default branch's head has no result. The main line goes first, since it holds merges. One check runs at a time on the computer, since a build can take every core. *Designer's call.*
2. **Pending.** A hosted project gets a `pending` status at once, so the gate reads "pending", which waits, not "none". The merge queue's `wait` then covers it.
3. **The check folder.** `<engine>/checks/<project>/tree` holds its own git repository, fetched to exactly that commit by the helper through `safeGit`. It has no link into the project, the home or any mirror, so nothing in it reaches them. Between checks it is reset and cleaned, keeping only what the project's own `.gitignore` ignores, so builds reuse earlier work.
4. **The main line is checked clean.** A main-line check first clears the folder entirely. An earlier head's tests can write to the kept build output, and that must never decide whether the main line is green. It also has its own `HOME` (section 4.4). *Designer's call.*
5. **The environment** is `testEnv` from `scripts/lean/store.js`, moved to a shared module: Wheelhouse's, the hosts' and the agents' variables and the SSH agent are all cleared.
6. **The run.** `prepare`, if any, then `testCommand`, both in the sandbox (section 4.4), within the time limit, with output kept to the last 64 KB.
7. **One second try.** A red result runs once more at the same head before it counts, as Archon's queue reruns a failed job once. A timeout doesn't. *Designer's call.*
8. **The record comes first.** The result is a new signed event kind, `check`: `{ commit, command (its digest), result (passed, failed, timed-out, could-not-run), minutes, tail }`, with `tail` the last 4 KB of output, run through the secret scan. Only then is it reported.
9. **Reporting.** Hosted: a commit status with the context `wheelhouse/checks`, through a new host-adapter method, `setStatus`. In git alone the record is the report. A status that can't be posted is tried again on the dispatcher's next tick. The record stands meanwhile.
10. **The permission.** Reporting needs `statuses: write`, new in the App manifest. A connection set up before this needs the director to accept it on GitHub, and an own app needs it changed by hand. A refused status raises one level-3 card with the link. Until then merges wait, and the pane says "Waiting for you to let Wheelhouse report checks".

### 4.4 The sandbox

The checks run the project's own code, which an agent wrote, so they run sandboxed even though no agent is present. Claude Code's sandbox covers only its own Bash tool, so the helper starts the run under macOS's `sandbox-exec` with a profile it writes, `scripts/checks/profile.js`. It is the same mechanism Claude Code uses on the Mac. *Designer's call.*

```
(version 1)
(deny default)
(allow process-exec) (allow process-fork)
(allow process-info* (target same-sandbox)) (allow signal (target same-sandbox))
(allow sysctl-read) (allow pseudo-tty) (allow ipc-posix-shm) (allow ipc-posix-sem)
(allow file-ioctl <the /dev files>)
(allow mach-lookup <a short list of services, each named>)
(allow file-read*)
(deny file-read*  <the deny list of scripts/protection/settings.js: ~/.wheelhouse, the keychain, ssh and cloud keys, Archon's private files>)
(deny file-read*  <the home folder>)                 ; prepare only
(allow file-read-metadata <each folder above the check folder, by literal>)
(allow file-read* <the check folder, tree.git, the check's own home>)
(allow file-write* <the check folder, the check's own home, /private/tmp, /private/var/tmp, the /dev files>)
(allow network-* <localhost; unix sockets inside the check folder and its own home>)
(allow network-outbound (remote ip "*:*"))           ; prepare, or checks.network
```

- **A project can still read as red.** A test may need a service the list leaves out, as the first real project did. That shows as a failed check on a project whose tests pass elsewhere, not as a way out. Check 82's `hang` phase names what was refused, and the service is looked at and added by hand.
- **It denies by default.** Check 82 showed an allow-by-default draft isn't safe: `open`, a compiled program and `xcodebuild test` each started the project's own app outside the sandbox, with the signing key in reach. A list of denials shuts only the ways someone thought of. So what isn't named is refused: Apple Events, opening apps, launchd jobs, the clipboard, the keychain's services. A macOS update that a build tool needs a new service for then fails as `could-not-run`, which is safe, and the line is added after looking at the service.
- **The services named** answer questions and start nothing: system logging, notifications, file events and looking up the user, and for the network names and certificates. The tests alone also get `lsd.mapdb`, the read-only map of file types: without it a lookup of a file's type gives a made-up answer, and a project's passing tests read as red. It starts nothing, since starting an app takes `launchservicesd` and the `lsopen` operation, and both stay refused. Its partner that writes the map, `lsd.modifydb`, stays out. Three others are left out on purpose. `launchservicesd` and `testmanagerd.control` start programs outside the sandbox. `dirhelper` names the per-user temporary and cache folders: without it the tools fall back to the check's own `TMPDIR`, so those folders stay shut. They have to, because programs outside the sandbox trust what is in them: `xcrun` keeps its lookup of tools there, so a test could plant what the director's next build runs.
- **It fails closed.** No `sandbox-exec`, or a profile that won't load, gives `could-not-run` and one card. Each stage first runs a command that does nothing under its profile, so the project's own command never starts until the profile has loaded. Nothing ever runs unsandboxed.
- **The network.** `prepare` has it, as a CI job does, and the tests don't. `prepare` always comes from the default branch, and its profile also denies reading the rest of the home folder. A test that needs the internet fails, and the fix is the project's: `checks.network: true`, a guardrail change the director approves. A test can still reach this computer's own ports, as a test server needs, but no socket outside the check's folders, so the SSH agent is out of reach. **A risk accepted:** the install scripts of a branch's dependencies run during `prepare` with the network on, so they could send out the project's own code. Nothing else is in reach, and a CI job has the same exposure. *Designer's call.*
- **Tool caches stay inside.** `HOME` for a check is a folder of its own, so `~/.npm`, `~/.cargo`, `~/.swiftpm` and the like land there, and the director's own caches are neither read nor written. `TMPDIR` is a folder inside it. Heads use `<engine>/checks/<project>/home`, and the main line uses `main-home` beside it, which no head can write. So a head can't poison what a main-line check reads.
- **The folders above.** The check folder sits inside `~/.wheelhouse`, which is denied, and a program must be able to look at each folder on its way down to start there. Those get `file-read-metadata` by `literal`, which doesn't let a program list them.
- **`DEVELOPER_DIR` is set** to a full Xcode: `xcode-select` may point at the Command Line Tools, which have no `xctest`.
- **The time limit is kept.** At the limit the check's process group is ended, and the wait for its output stops 5 seconds later, whatever still holds it open. Check 82 saw a 2-minute limit take 21 minutes without this. A job a test leaves behind ends with its process group at the end of each stage.
- **All stop** ends the check's process tree with the others. Its result is `could-not-run`, and it runs again after All stop lifts.

**Tried on this Mac, 31 October 2026.** Check 82 records every way out shut under this profile, in both stages, and `curl` out only in `prepare`. Swift's own tools sandbox themselves, and macOS refuses a sandbox inside a sandbox, so `swift test` needs `--disable-sandbox`; `xcodebuild` needs `-IDEPackageSupportDisableManifestSandbox=YES -IDEPackageSupportDisablePackageSandbox=YES`. A tool refused in this way gives `could-not-run`, not red. The same refusal hits an agent's own Bash, so the test command must carry these switches everywhere it runs.

### 4.5 Finding the test command

A script, not an agent, finds `testCommand` for setup and the survey with no question, from what the project holds, first match wins:

| The project holds | `testCommand` | `prepare` |
|---|---|---|
| `testCommand` already set | as set | as set |
| `*.xcworkspace` or `*.xcodeproj` | `xcodebuild test -scheme <its shared scheme> -destination 'platform=macOS' -derivedDataPath .build/checks`, with the switches of section 4.4 and `CODE_SIGNING_ALLOWED=NO`, and the second try below | `xcodebuild -resolvePackageDependencies`, with the same switches |
| `Package.swift` | `swift test --disable-sandbox` | `swift package resolve --disable-sandbox` |
| `package.json` with a test script | `npm test` | `npm ci` |
| `Cargo.toml` | `cargo test` | `cargo fetch` |
| `go.mod` | `go test ./...` | `go mod download` |
| `pyproject.toml` or `pytest.ini` | `python3 -m pytest` | none |
| a `Makefile` with a `test` target | `make test` | none |

**Xcode's tests.** The sandbox always refuses `xcodebuild test` itself, since it needs `testmanagerd` and hosted tests need LaunchServices, and both start programs outside the sandbox. So when the first run shows that refusal, the check takes one second try: `xcodebuild build-for-testing` with `TEST_HOST=` and `BUNDLE_LOADER=` set empty, then `xcrun xctest` on each test bundle, which stays inside the sandbox. On that try a pass counts, as tests with no host, and anything else is `could-not-run`, never red. Tests that can't build without their app, or that need one running, end at the card in section 4.8. This takes the place of the ordinary second try. *Designer's call.*

**A generated Xcode project.** A project may hold an XcodeGen `project.yml` with its `.xcodeproj` ignored by git. It has no committed Xcode project, so it reads as its `Package.swift` row, which reaches every test in the package's own test targets. Tests that live only in `project.yml`'s targets would need `xcodegen generate` in `prepare`.

Then the check runs once on the default branch, and the first result decides what the director hears:

- **Passed:** one line on the Logbook.
- **Failed:** the project's tests don't pass as they stand. A level-3 card offers **Get them passing first**, recommended, which starts a fix-main run. **Carry on anyway** sets the project to *not counting*, below. Wheelhouse fits a project as it stands, so a red start doesn't hold the project up unless the director says so. *Designer's call.*
- **Nothing found:** the project starts in the not-counting state below.
- **Could not run:** the card in section 4.8.

**Not counting.** A project whose tests already fail, or which has none, has nothing a check can show. It is one state in the project's private record, set only by the director's click or by the finder finding nothing. While it holds, each check still runs where there is a command, and its result is `not-counted`, whatever the exit. The status is `success`, described as "tests not counted yet", so Archon's gate reads green, and a local queue or permit accepts `not-counted` only for a project in this state. The Logbook says "Tests aren't counting yet" on every merge, and the First Mate offers to add tests or repair them. Merges rest on the review and the work's own done checks (ruling 2, section 12). The first time the command passes on the main line, the state ends for good: every check counts from then on, and a head that fails is red.

### 4.6 Why the result can be trusted

| An agent tries to | What stops it |
|---|---|
| Write a passing result | Results are signed events in the private record, under the sandbox's `~/.wheelhouse` denial |
| Post a status itself | It holds no key, and the broker's list has no such call. The permit (below) doesn't rest on the status alone |
| Change the command on its branch | The helper reads it from the default branch, and the file is a guardrail |
| Change what the command runs (`package.json`, a scheme, a test plan) | The protected-tests guard and check (Archon design, section 11), whose list gains `*.xcscheme`, `*.xctestplan` and `Package.swift` test targets. The review lenses look too |
| Make the tests pass by leaving things in the build output | Main-line checks start clean, so a poisoned head can't hide a red main line |
| Read keys, or call out, from a test | The sandbox |

**The permit gains one condition** (`brokerDecision`, `scripts/engine/broker/rules.js`). Where checks run here, a merge needs a signed `check` naming that head, that passed, for the command now on the default branch. The host's green status gets the merge past Archon's gate, and the signed check gets it past the broker. On a hosted project an old head's status can't stand in for a run that never happened.

### 4.7 A red check

- **At a change's head.** The check runner sends it back itself, as soon as the result is in, rather than leaving it to Archon's queue, whose sweep finds no job logs to read for a status. Whatever the sweep then does with a red status at a head that is going back is harmless. The dispatcher's `sentBack` is the existing path, but nothing calls it yet (`scripts/engine/dispatch-run.js`), so part 2 wires it up: it gains a reason, `red`, beside `clash`, and the dispatcher starts the same lane again on the same branch with the check's `tail` in the order, kept by the helper. A second red on the same work is a level-3 card. Done checks run inside the lanes, so this should be rare.
- **On the main line.** Hosted: Archon's queue holds, and raises its `hold` ask, and the existing path runs (Archon design, section 7.7). Its sweep looks for Actions runs to rerun and finds none, which check 76 saw it handle. In git alone: section 7.6.

### 4.8 What the director sees

- The Logbook's build tab: "Checks ran on this computer: passed, 3 minutes." Hosted projects say the same; the words don't change with the host.
- The pane: while a check runs, "Checking on this computer".
- A card only for `could-not-run` twice in a row, or the cards in sections 4.1 and 4.5.
- The briefing's cost line gains nothing: checks spend no tokens. The Logbook shows their minutes.

## 5. Git alone: the shape

### 5.1 The home

A project in git alone has a **home**: a bare git repository at `~/.wheelhouse/projects/<project>/home.git`, a full copy of the project's history, made at setup with `git clone --bare --no-hardlinks` from the project's folder.

- **Only the helper writes it.** The sandbox denies `~/.wheelhouse` to every agent. The home takes the place of the host: the main version there is the truth.
- **The folder is left alone.** Its `.git`, its branches, Xcode's or the director's own tools all work as before.

**Why not Lean's store.** Lean moves the project's `.git` into Wheelhouse's folder and leaves the project folder a detached worktree of it (`scripts/lean/store.js`), which keeps the main version out of an agent's reach. It can't serve Archon: builders are sandboxed agents working in worktrees, a worktree's commits are written into its repository, and the sandbox would have to open that repository to them, main version and all. It also changes how the director's folder behaves, refuses projects with submodules or a default branch not called `main`, and fails Wheelhouse's rule of fitting a project as it stands. A separate home costs a second copy on disk and solves all of these. Lean stays as it is. *Designer's call.*

What Lean's code gives this design: `withLocalLock`, the compare-and-swap move of the main version, the temporary worktree for merges, `lookAtMain` and its card for a main version moved outside the helper, `undoMerge`, `updateCopy` and `testEnv`. They move to `scripts/lib/local-git.js`, take the default branch as an argument in place of `main`, and Lean imports them.

### 5.2 The project's record

`project.json` gains `host: 'local'`, with `repo: 'local/<project>'`, `remoteUrl: null` and a connection of kind `none`. So a git-alone project is a registered project like any other, not a Lean one, and every helper route runs for it. `detectHost` stops throwing for a folder with no remote. A folder whose only remotes aren't GitHub or GitLab (a server of the director's own) is also treated as git alone: its remotes are left as they are, Wheelhouse pushes nothing to them, and the Logbook says so.

### 5.3 How builds reach it

```
the project's folder (agents' worktrees)
   |  helper fetches a run's branch
   v
the helper's mirror (disposable)  -->  home.git  -->  the engine's mirror  -->  Archon reads it
```

- **Archon needs a remote (A10).** Setup adds one remote to the folder, `wheelhouse`, a plain path to the engine's mirror, and `.archon/config.yaml` names it (`worktree.remote: wheelhouse`). It is one line of the folder's git settings, and uninstall takes it away. The mirror is refreshed from the home by the existing `refreshMirror`, so Archon reads the mirror as on a hosted project, and an agent never reaches the home.
- **Agents commit in worktrees as on any project.** Those commits are in the folder's `.git`. They reach nothing until the helper takes them.
- **`host.push`** runs `doPush` and `pushFrom` unchanged. The helper's own `mirror.git` stays what it is on a hosted project, disposable and rebuilt when a shallow marker arrives, so it is never the home. Its push target is the home's path, with no key, in place of a host's address, and `mirrorFor` takes that target from the adapter rather than `remoteUrl`. So the same checks stand, and a branch can't land on the default branch this way. Then the engine's mirror is refreshed.

### 5.4 Changes made by hand

A person can still commit in the folder. Nothing they do reaches the home by itself, so at each dispatcher tick the helper compares the folder's default branch with the home's.

- **The home is ahead:** the helper brings the folder up, fast-forward only, through `safeGit`, as long as the folder is on that branch with nothing uncommitted. Otherwise it leaves the folder and says one line: "Your folder has changes of its own, so the newest version waits."
- **The folder is ahead:** one level-3 card, once for each tip: "Changes were made by hand in your project folder." **Check and add them** (recommended) opens a local change for them through the survey's "work carried on" route, so they get the same review and checks as anything else. **Leave them out** leaves them in the folder. **Not now** puts it off.
- **The two have parted:** the same card, and the work goes through the same lane's "bring it up to date" step first.

**Everything enters the home through a local change.** An agent that wrote to the folder's main branch gets exactly the same treatment: a card, a review and the checks, never a quiet merge. *Designer's call.*

If the home's own main version ever moves outside the helper, Lean's existing **Main moved** card (Undo it, Keep it) applies unchanged.

## 6. The local host adapter

`scripts/host/local/adapter.js` gives the same methods as `makeAdapter` (`scripts/host/adapter.js`), and `adapterFor` returns it for `host: 'local'`. The core stays unaware of the difference.

| Method | In git alone |
|---|---|
| `defaultBranch`, `branchHead` | Read from the home |
| `openPr`, `updatePr`, `closePr`, `prState` | A local change (section 7.1) |
| `ciState(sha)`, `hasCi` | From `check` events; `hasCi` is always true |
| `setStatus` | Does nothing: the record is the report |
| `previewUrl` | Always null, so the preview step uses the project's preview command (Archon design, section 9.1) |
| `merge` | Section 7.4 |
| `openRequests`, `requestDetails`, `pullRef` | From changes and the home; `pullRef` is `refs/pull/<n>/head`, written at open |
| `verdictComment` | Does nothing: the local queue reads the signed review itself |
| `login` | `this computer` |
| `issue.*` | Refused with a plain line. Nothing in the pack's lanes uses them |
| `mergedRequests`, `pipelinesFor` | From the home's history and `check` events |
| `protectionEvents` | None: the audit report says there is no second record to compare (section 7.7) |

The helper keeps its disposable mirror for a local project (section 5.3). `keyed` carries no key, and the push target comes from the adapter.

## 7. Git alone: how each part works

### 7.1 Where work waits

A **local change** replaces a pull request. It is a branch in the home, a number and a `change` event in the private record: `{ n, branch, base, title, body, state (open, merged, closed), head, mergeCommit }`. Numbers count up from 1 for each project, from a file beside the home. The helper also writes `refs/pull/<n>/head`, so the rest of the code reads a change as it reads a pull request.

The director sees no difference from a hosted project, since they already see the work on cards with pictures, never on a host's page: **Approve**, **Show me**, **Suggest a change…** and **Not now** work as today. The one word that changes: where a line would say "pull request", the glossary says "change". The text of a change, which a pull request would have on the host, stays in the private record.

### 7.2 Signed approvals and the permit

Unchanged. Reviews and approvals are already signed into the private record and checked against this computer's key (main design, section 24.3, item 1). The local queue calls the same `brokerDecision` with kind `merge`, so a git-alone merge passes exactly the same permit, including section 4.6's new condition.

### 7.3 The lock

No computer but this one can reach the home, so `lockHeld` is true when the home's mark names this computer's id, and no `wheelhouse-lock` branch exists. Moving the folder to another computer without Wheelhouse's restore (section 9) finds a home it can't read, and nothing runs.

### 7.4 The local queue

**A Wheelhouse piece stands in here, and this is the one place it does.** Archon's merge queue needs a forge (A6). `scripts/host/local/queue.js` takes its place for local projects. It is a script: no model, no tokens.

**Weighed and not used:**

- **A local forge plugin** (`archon-forge-wheelhouse`, A7), keeping Archon's queue. It is the seam Archon offers, and the first choice for that reason. But it needs a plugin answering seven operations, the sandbox opened for Archon's config and plugins in the queue's step (A9), the broker answering `gh` for the agent's side calls (A8), a project's environment carried through the shared wake process, and the merge path's evaluation done over on a route Wheelhouse has never run. All of that to run a model that has nothing to judge: with no threads, no outside authors and every fact exact, what the sweep decides becomes a table.
- **A stand-in `gh`** answering Archon's GraphQL reads. It would imitate GitHub for Archon to read, an anti-goal, and break on any change of query.

The local queue is also what the fallback engine needs (Archon design, section 6.5, where the gate comes back to Wheelhouse), and fix-main merges already go through the helper's own gate. If Archon ships a local forge, the queue can go. *Designer's call.*

**One sweep.** The dispatcher's `startMergeQueue` decides when, as today; for a local project the runner calls the local queue in place of `engine.start`. `dispatch()` itself doesn't change. In a project's lock (`withLocalLock`), for each open change that is ready, oldest first:

| Finding, in this order | Action |
|---|---|
| The main line's check is `red` | Merge nothing (section 7.6) |
| All stop, or an incident that this isn't the fix for | Merge nothing |
| The check at its head is pending, or none has started | Wait |
| The check at its head is red | Send back, reason `red` (section 4.7) |
| No signed CLEAN review of its head | Send back, as Archon's queue does a stale verdict |
| Its head no longer merges into the main line (`git merge-tree --write-tree`) | Send back, reason `clash` |
| Needs an approval it doesn't have | Raise it, as Archon's queue asks about an unclear change |
| The permit (`brokerDecision`) refuses | Wait, and say why on the Logbook |
| Otherwise | Merge |

**What counts as needing an approval** comes from the permit (shown first, level 4, guardrail) and from Archon's "unclear" list as a fixed rule: a change touching the project's critical areas, or any change under `.archon/`, needs the director's click. Without Archon's sweep this list is a table, in `scripts/host/local/queue.js`, and the card comes from the card router like any level-3 ask.

**The merge itself** is made in a temporary worktree of the home at the main version, as a squash by default to match Archon's queue, with the change's title as its message. It moves onto the main version by compare-and-swap, one at a time, then writes a `merge` event, refreshes the mirror, brings the folder up (section 5.4), starts the main-line check and writes the backup (section 8). A merge that loses the compare-and-swap is tried again on the next sweep. Commits are made as the folder's git identity, or as Wheelhouse when it has none.

### 7.5 All stop

Works as on any project (Archon design, section 12.3): runs are cancelled, the dispatcher starts nothing, and the local queue and `host.push` refuse. Running checks end with the other process trees. The broker stays on Archon's `PATH`. With no repository to name it refuses every call, saying "this project has no code host". The runbook's "cut the connection's access" step doesn't apply, and the runbook says so.

### 7.6 A red main line

The check after a merge is the main line's CI. A red result, after its second try, opens the same `red-main` incident, with its id made from the commit in place of an ask's, and the merged change as its suspect. There is no ask to answer, since Archon's queue isn't involved. The dispatcher then does as it does today: it starts `wheelhouse-fix-main`, holds other work, and merges the fix through the helper's route with `weakensChecks` standing. `fix-rerun.js` works through `gh`, which has nothing to find wherever checks run here, so on those projects, hosted or not, it asks a new helper route for the main line's result. The second try has already happened, so it never asks for another. `fixDecision` reads `green` from `ciState`, so it needs no change.

### 7.7 The reports

- **The Logbook and briefing** read the same records. Host words come through `hostWords` and the glossary: "on this computer", as ruling A6 says.
- **The pane** shows the safekeeping status (section 8.2).
- **The audit report** compares the computer's record with the host's second record. In git alone there is none, so it says plainly: "This project is kept on this computer, so there is no second record to compare with." It still compares merges with the home's history.
- **Provenance** is unchanged: it goes with the merge event.
- **Protection reads** go. In their place, the weekly job looks at the home's main version and its permissions, and runs `git fsck` on the home.

## 8. Backups and safekeeping

A host was a free second copy, and git alone has none. The director hears this once, at setup, and after that a calm status keeps it in view (ruling 1, section 12).

### 8.1 Backups

- **What a backup is.** One file, `<project>.wheelhouse-backup` (a `git bundle` of the home), in a folder the director picks: an external drive, or any folder a cloud service keeps. A bundle is one file, so a sync service can't corrupt it the way it can a live repository. It is written beside its old copy and renamed, `git bundle verify` passes before the old one goes, and one earlier copy is kept. *Designer's call.*
- **When.** After each merge, and once a day while there's anything new. It is `updateCopy`'s job with a bundle in place of a fetch. A drive that isn't plugged in is no fault: the next try is when it comes back.
- **What it holds.** The project's whole history, with the product documents. Not the private record: the director's cards and clicks stay on this computer, as they ruled (main design, section 24.7, answer 4). Time Machine covers those, and the words say so.
- **Time Machine.** `tmutil destinationinfo` says whether a destination exists. Where one does, it counts as a backup, since it covers the folder, the home and the private record. Where Wheelhouse can't read the date of the last one, the status says "Time Machine is on" and gives no date, rather than guess.
- **What doesn't count.** A folder inside the project, or one on the same disk as the project. The status says why.

**The warning at setup.** A project in git alone gets one card in setup, and it is the only card about this, ever: "This project is only on this computer. If the computer is lost or breaks, the project goes with it." **Choose a backup folder** (recommended), **Not now**. With Time Machine on, the card names it and offers a second copy off the computer. **Not now** closes it for good, and building goes on.

### 8.2 The safekeeping status

Every project has one, with or without a host. It answers one question: **if this computer were lost today, what would go with it?** It isn't an alarm and it isn't a to-do, and it raises no cards.

**How it is read.** `scripts/safekeeping/status.js` works it out on the dispatcher's tick, with no agent, no model and no tokens. Local git readings go through `safeGit`, and the host is read at most once an hour by the fetch the helper already makes. It writes nothing and pushes nothing. The desk's glance view carries it as `{ place, level, line, detail, actions, readAt }`, where `level` is `safe` or `watch`.

**What it counts.**

| Reading | On this computer | On GitHub or GitLab |
|---|---|---|
| The main version | Is the newest merge in the backup? | Is the main version the same here and on the host? |
| Work only here | Not counted: all of it is only here, and the backup covers what has merged | Commits on the folder's branches that the host doesn't have, and uncommitted changes in the folder |
| When last safe | When the last backup was written and verified | When the host was last reached |

Work in a running lane isn't counted, since Wheelhouse is about to send it up, and neither are branches a person deleted. The private record is never counted: the detail says once that it stays on this computer on every project.

**How it reads, and when it turns to watch.** These are the only states. The word "backup" is the one technical word the director meets here.

| State | Line | Level |
|---|---|---|
| Local, newest merge in the backup | "Backed up today, up to date" | safe |
| Local, backup a little behind | "Backed up 2 days ago, 1 change since" | safe |
| Local, Time Machine and no date | "Time Machine is on" | safe |
| Local, a change has gone unbacked-up for 7 days | "Last backup 9 days ago, 4 changes since" | watch |
| Local, no backup, or one on the same disk | "Only on this computer, no backup" | watch |
| Local, a backup that failed its check | "Your last backup couldn't be checked" | watch |
| Hosted, all the same | "On GitHub, up to date, synced 5 minutes ago" | safe |
| Hosted, the host is newer | "On GitHub, your folder is 2 changes behind" | safe |
| Hosted, work only here, under 3 days old | "On GitHub, 3 changes only on this computer" | safe |
| Hosted, work only here for 3 days or more | "3 changes only on this computer, for 4 days" | watch |
| Hosted, host not reached for a day or more | "Couldn't reach GitHub since Tuesday" | watch |

A project is safe the moment the reading clears. Seven days and three days are defaults, kept in the project's settings as `safekeeping.days` and `safekeeping.hereDays`. *Designer's call.*

A project with both a host and a Time Machine reads as hosted. A project on an old engine reads the same way, since the readings come through the host adapter, so GitLab projects have it too. Lean projects keep their own copy step and aren't part of this.

**Where it shows.**

- **The pane.** A plain row in the calm view, under health, on every project and always there: "Safekeeping" and the line. At watch it is also a health line of level `watch`, so it joins **To watch** by the existing path (`scripts/desk/mod-pane.js`), and "All well" gives way to it. The verdict still says nothing needs the director, since nothing does: watch asks for no answer, and it never blocks a merge or a run.
- **The briefing.** One sentence among the things to watch when the level turns to watch, and one when it turns back to safe. An unchanged watch comes back once a month, not every briefing. The date goes in `seen.json`, in the way the weekly lines do. *Designer's call.*
- **The Logbook.** The Health tab shows the full detail, and nothing else changes.
- **Cards.** None, on any project, after the one at setup.

**What the director can do from it.** Pressing the row opens the detail in place: what would be lost, in a sentence, and up to two buttons. They go through the desk's `act`, with the press as evidence. None of them can reach the main version.

| The state | Buttons |
|---|---|
| Local, no backup | **Choose a backup folder**, **Put it on GitHub** (section 9) |
| Local, behind, or a failed check | **Back up now**, **Choose another folder** |
| Hosted, work only here | **Keep a copy online**, which sends each branch to `keep/<branch>` by `doPush`, never to the default branch and with no merge. It names what goes up, since it puts code on the host |
| Hosted, uncommitted changes | **Ask the First Mate to save them**, which starts the usual conversation. Wheelhouse doesn't commit in the folder on its own |
| Hosted, folder behind | **Bring my folder up to date**, fast-forward only, refused with a plain line if the folder has changes of its own |
| Couldn't reach the host | **Try again** |

## 9. Moving to a host later

The director says "put this on GitHub", or picks it on the settings pane, and the First Mate raises one card naming what will happen and that the code goes online. A move starts only when no run is going, and the dispatcher holds new work for it.

1. **Setup's host steps run** for this project: the sign-in, the repository (private by default), tools, the connection and the broker's rules. They are the steps a git-alone setup skipped, so they exist already.
2. **The home is pushed** to the new repository, every branch. Each open local change becomes a pull request, with its body from the record.
3. **The project's files change by one pull request:** `.archon/sdlc/policy/maintainers.json` is added and `worktree.remote` goes. The helper merges it through its own route, as setup does for a project set up already (Archon design, section 14.3).
4. **The record moves:** `project.json` takes the host's values and keeps the project's folder name, so the private record stays with it. The folder gains `origin` and loses `wheelhouse`. Protection and the lock branch follow.
5. **The home stays for 30 days,** read-only, then a level-4 card offers to remove it, with **Keep it** recommended.

Checks stay here if the project still has no CI, reported as statuses from then on (section 4.1). `check` events already name their commits, so nothing is run twice.

## 10. Setup and uninstall

**Setup asks nothing it can work out.**

| The folder | What happens |
|---|---|
| Has a GitHub or GitLab remote | As today |
| A git repository with no remote, or with only other remotes | Git alone, no question. The one card's plan says: "Your project stays on this computer. Nothing goes online." **Customise** offers **Put it on GitHub** |
| Empty, or a folder with no git | Step 3's card gains one option and a new default: **Keep it on this computer** (recommended, since it needs no account and can move later in one click), **GitHub**, **GitLab**, **From a backup**, **From my other computer**. A folder with no git gets `git init` and a first commit on `main`, which the one card names. *Designer's call* |

**Which branch.** The only one, or else `main`, or else `master`. Otherwise one card with up to four branches.

**The steps** for a local project:

- **Skipped:** the host sign-in, the host tools, the own app, protection, the lock branch and the trial pull request.
- **Added:** the home; the `wheelhouse` remote; finding the test command and the first check (section 4.5); the one backup card (section 8.1).
- **Kept:** the engine, the sandbox and deny rules, the project files. Project files go straight into the folder's default branch and then into the home, as setup's own commit does on a host before protection is on. The `.archon/config.yaml` setup writes names the remote. No `maintainers.json` is needed, since Archon's queue isn't used.
- **Step 10's health check:** its trials use a local change in place of the trial pull request, and run `wheelhouse-hello` through the same engine.

The card's words never say "host" unless it has to: "Your project stays on this computer."

**Uninstall** brings the folder up to the home's main version first, then removes the `wheelhouse` remote, the engine's mirror and the check folder. Project files leave by a last local change merged into the folder. The home gets one level-4 card, **Keep it** recommended, as the private record does.

**The folder's `.git` is a full copy** after this, since the home was only ever a second one. Removing Wheelhouse loses no history.

## 11. Build parts

Local checks come first, and ship alone: part 3's end is a release in which a hosted project with no CI builds and merges. If the first project stays on the computer, parts 4 to 7 come before real use; parts 8 and 9 can follow, and until part 8 is in, a git-alone project has neither a backup nor the status that shows it. The status's hosted half depends on nothing else here, so it can be built at any time.

Each part is one fresh session, with the named test files. Counted evaluation runs once for the plan, at the end. The whole suite stays with CI.

| Part | What | Tests |
|---|---|---|
| **0. Early checks** | Three answer notes in `docs/checks/`. **82:** a real Mac app's tests under the sandbox: `xcodebuild test`, code signing, `prepare`, time taken with and without kept build output, a separate `HOME`, and every way out of the sandbox tried (section 4.4). Needs a real project, through the main session. **83:** a real quick lane on a folder with only a path remote: worktree, commit, artefacts, what Archon names the project, clean-up. **84:** the real `setStatus` path on a throwaway GitHub repository with no Actions, through the helper, on each connection kind, merged by Archon's queue | The notes themselves. If 83 fails, the home's mirror gets a made-up https address and an `insteadOf` rule, as hosted projects have |
| **1. The check runner** | `scripts/checks/`: queue, check folder, profile, run, second try, the signed `check` event and its view, `testEnv` moved out | `tests/scripts/checks/run.test.js`, `profile.test.js`, `folder.test.js` (a real run under `sandbox-exec` on the Mac, the profile as text on Linux). `tests/scripts/checks/signed.test.js`: a planted result refused |
| **2. Hosted reporting** | `setStatus` on the GitHub adapter, the App manifest's `statuses: write` and its card; `checks.where`; triggers from the push and the main line; the permit's new condition; `sentBack` wired up, its `red` reason and the tail in the order; `fix-rerun.js`'s route; the broken-CI card; protection naming `wheelhouse/checks`; `NO_CI`'s line | `tests/scripts/host/set-status.test.js`, `tests/scripts/engine/broker/rules.test.js` (a green status with no signed check refused), `tests/scripts/engine/dispatcher.test.js`, `tests/scripts/checks/where.test.js`, and the end-to-end `tests/e2e/local-checks.test.js`: a run on the fake engine from push to a merge the permit allows |
| **3. Finding the command** | The table in section 4.5, keeping the command in the record, the first check, its cards, the not-counting state, the Logbook's and pane's words, the protected-tests list. Release | `tests/scripts/checks/find-command.test.js`, `tests/scripts/setup/first-check.test.js`, `tests/scripts/checks/not-counting.test.js`, card-check tests for the new cards |
| **4. The home and the adapter** | `scripts/host/local/`: home, adapter, changes; `scripts/lib/local-git.js` lifted out of Lean; `project.json`'s `local`; `detectHost` | `tests/scripts/host/local/adapter.test.js` (the adapter contract's tests run against all of `makeAdapter`'s methods), `home.test.js`, `changes.test.js`; Lean's own tests unchanged and passing |
| **5. Builds on it** | `mirrorFor`, `doPush`, `refreshMirror` and the folder remote; the folder brought up to date; changes made by hand; the broker with no repository | `tests/scripts/host/local/push.test.js`, `folder.test.js` (dirty, other branch, ahead, parted), `tests/scripts/engine/broker/rules.test.js`, `tests/e2e/git-alone-build.test.js`: a quick run from work order to an open change, on the fake engine and a real git folder |
| **6. The local queue** | `queue.js`, the table in section 7.4, the merge, the red main line, undo, All stop, the audit's line | `tests/scripts/host/local/queue.test.js` (a row a case), `merge.test.js`, `tests/scripts/engine/fix-main.test.js`, `tests/e2e/git-alone-merge.test.js`: a merge, a clash, a red main line and its fix, All stop during a merge |
| **7. Setup and uninstall** | Section 10, the pane's and glossary's words, the runbook, `SECURITY.md`, the data note, and the README's line that a host is optional | `tests/scripts/setup/local.test.js`, `tests/scripts/setup/uninstall-local.test.js`, the setup skill's scenarios, the pane tests |
| **8. Backups and safekeeping** | Section 8: the bundle, the one card, the restore, the status and its readings, the pane's row and detail, the briefing's sentence, the Logbook's Health line, the buttons | `tests/scripts/host/local/backup.test.js` (a partial write never replaces a good copy; a backup on the same disk refused), `restore.test.js`, `tests/scripts/safekeeping/status.test.js` (a row a state, and a running lane not counted), `actions.test.js` (no button reaches the default branch), the pane and briefing tests (no card raised at watch; the once-a-month line) |
| **9. Moving to a host** | Section 9 | `tests/scripts/host/local/move.test.js`, `tests/e2e/move-to-host.test.js` on the stand-in host |
| **10. Evaluation** | New scenarios in the one counted evaluation, with real Archon: a hosted project with no CI, build to merge; a git-alone quick lane to merge; a planted passing check refused; a red check sent back; a red main line in git alone; an agent's commit to the folder's main branch raises the hand-made card and merges nothing | The scenarios, and the safety subset unchanged |

**The upkeep this adds.** The monthly upgrade reads Archon's `.shared/merge.ts` and `sweep.md` for changes to the gate's rules, since the local queue's table copies them. The list of rows sits beside the table.

**The Archon design's sections to change on approval:** section 2's non-goals; 4.5 (a third host adapter); 7.3 (the runner's branch); 12.4 (the permit's condition, and a broker with no repository); 14 (setup); 16 (risks); 18 (tests). The main design's A7 is marked done.

### Risks

| Risk | How it's handled |
|---|---|
| Xcode projects won't run under the profile | `xcodebuild test` can't, by design (section 4.5). The second try runs tests with no host. Tests that need their app get the card, and no check runs unsandboxed without the director's say |
| A macOS update, or a project's own test, needs a service the profile doesn't name | The check gives `could-not-run` or a red result, never a way out. The service is looked at and added by hand |
| A process a test leaves in a new session of its own outlives the check, and writes to `tree` during the next one | The process group's end misses it, and a main-line check shares `tree`. It holds no key and stays in the sandbox. Open: a main-line tree no head's profile can write would shut it |
| A long build on a laptop | One check at a time, build output kept, a time limit. The check's minutes are on the Logbook |
| A check on a sleeping computer | It pauses and carries on, as builds do. A hosted project's status stays `pending` meanwhile, which holds no other work |
| The local queue drifts from Archon's gate | The monthly reading above, and the same permit in both |
| `sandbox-exec` is marked as deprecated by Apple | It is what Claude Code's own sandbox uses on the Mac, so the two would move together. It fails closed if it goes |
| A disk fault in the home | The folder's `.git` is a full second copy on the same computer, the weekly `git fsck` finds it, and a backup covers both |

## 12. The director's rulings

Both given on 31 October 2026.

**1. Backups: warn once, then show it.** A project may build with no backup. There is one warning at setup and no stream of reminders after it. A calm, always-visible status shows whether the work is safe, on a local project and on a hosted one alike, and it is designed in section 8.2.

**2. No passing tests: changes still merge.** On a project with no tests, or tests that already fail, changes merge on the review and the work's own done checks. The Logbook says "Tests aren't counting yet", and the First Mate offers to add tests or repair them. The tests count for good once they pass on the main line (section 4.5).

## 13. The designer's calls

The director may override any of these.

1. Where checks run is worked out and shown, never asked (section 4.1).
2. Broken CI gets one card with a by-hand step to turn the host's checks off, and never mentions billing (section 4.1).
3. One check at a time on the computer (section 4.3).
4. Main-line checks start clean; heads keep build output (section 4.3).
5. A red result gets one second try (section 4.3).
6. The checks' sandbox is `sandbox-exec` with a deny-by-default profile, which starts nothing outside it (section 4.4); `xcodebuild test` therefore can't run, and has the second try of section 4.5.
7. Only `prepare` has the network; tests need `checks.network`, a guardrail change. A dependency's install script could send out the project's own code during `prepare`, a risk accepted (section 4.4).
8. A project whose tests fail at setup can carry on in the not-counting state, which ends the first time they pass (section 4.5).
9. A separate home, not Lean's store, with the folder left alone (section 5.1).
10. Everything enters the home through a local change, hand-made work included (section 5.4).
11. A script stands in for Archon's merge queue on local projects, rather than a forge plugin or a stand-in `gh` (section 7.4).
12. The bundle file as the backup, holding no private record (section 8.1).
13. **Keep it on this computer** is the recommended option for a new product (section 10).
14. The safekeeping status's 7-day and 3-day limits, and that watch asks for nothing and blocks nothing (section 8.2).
15. The briefing repeats an unchanged watch once a month (section 8.2).
16. **Keep a copy online** sends work to a `keep/` branch, with a press naming what goes up (section 8.2).

## 14. Left to the builder

- The exact table in section 4.5, from what check 82 finds.
- The layout under `<engine>/checks/` and the home's folder.
- How the check's `tail` reaches a lane's order.
- The words of each card and status line, within Calm's voice and the card rules.
- How the Logbook lays out checks' minutes.
