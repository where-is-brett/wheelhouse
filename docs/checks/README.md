<!-- docs/checks/README.md -->

# Design checks

The answers to the checks in section 20 of the design, and to checks 24 to 31 in section 16 of the build-loop design (`docs/specs/2026-10-18-build-loop-design.md`), and checks 54 to 72, which are the Copilot design's C1 to C19 (`docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md`, "Check numbers"), and check 73, which is the security-gaps plan's (72 belongs to the Copilot plan), and checks 74 to 79, which are the Archon design's early checks E1 to E6 (`docs/superpowers/plans/2026-10-29-archon-part-2-early-checks.md`), and check 80, part 4.1's real small-lane run, and check 81, part 4.4's real two-slice feature run, and checks 82 to 84, which are the local-checks design's early checks, and checks 85 to 90, which are the delegated-decisions design's D1 to D5 and the goals draft's U3, and checks 92 and 93, which are the unattended goals design's U2 and U4, one note per check. Check 26 was not run and is no longer needed: Shape 1 was taken on check 27's Mac half, and Shape 2's wakes come from the mod's timer in the foreman's session, not a plugin monitor (build-loop design, section 11).

| # | Check | Answer | Note |
|---|---|---|---|
| 7 | Telemetry receiver on both systems | Partly | [07-telemetry.md](07-telemetry.md) |
| 2 | Clickable questions in Desktop | Yes | [02-clickable-questions.md](02-clickable-questions.md) |
| 5 | `glab` covers the adapter | Partly | [05-glab.md](05-glab.md) |
| 10 | The sandbox on Windows | No | [10-sandbox-windows.md](10-sandbox-windows.md) |
| 12 | Locked's computer-wide settings | Partly | [12-locked.md](12-locked.md) |
| 13 | Server-side protection on the free plans | Partly | [13-server-protection.md](13-server-protection.md) |
| 15 | Installing at a pinned release | Yes | [15-install-and-pinning.md](15-install-and-pinning.md) |
| 17 | Keyless signing of releases | Deferred | [17-keyless-signing.md](17-keyless-signing.md) |
| 18 | Connectors and the deny rule | Yes | [18-connectors.md](18-connectors.md) |
| 19 | Setup time | Deferred (the director put the timed run off on 23 October 2026; it needs a tag on the host) | [19-setup-time.md](19-setup-time.md) |
| 8 | The prompt-record hook | Yes | [08-prompt-record.md](08-prompt-record.md) |
| 11 | The host helper | Partly | [11-host-helper.md](11-host-helper.md) |
| 16 | The password-style box | Yes | [16-secret-box.md](16-secret-box.md) |
| 3 | A blocked compaction is tried again | Yes | [03-precompact-retry.md](03-precompact-retry.md) |
| 6 | The weekly usage figure in Desktop | Partly | [06-usage-in-desktop.md](06-usage-in-desktop.md) |
| 9 | A mod's button, and what a mod can see | Partly | [09-mod.md](09-mod.md) |
| 14 | The agents' token | Deferred | [14-token.md](14-token.md) |
| 1 | A background foreman session | Partly | [01-foreman.md](01-foreman.md) |
| 4 | Phone notifications and STOP by message | Yes | [04-remote-control.md](04-remote-control.md) |
| 20 | The Wheelhouse GitHub App | Yes, with a change | [20-github-app.md](20-github-app.md) |
| 21 | The quick connection on the Mac | Deferred | [21-gh-keychain.md](21-gh-keychain.md) |
| 22 | GitLab project keys | Yes, with a change | [22-gitlab-keys.md](22-gitlab-keys.md) |
| 23 | GitLab's protection of `main` | Partly | [23-gitlab-protection.md](23-gitlab-protection.md) |
| 24 | Pinning through Wheelhouse's marketplace | Yes | [24-pinning.md](24-pinning.md) |
| 27 | Starting and waking sessions from a script | Deferred | [27-sessions.md](27-sessions.md) |
| 25 | The override wins | Yes, for Superpowers' hand-offs | [25-override.md](25-override.md) |
| 26 | Plugin monitors | Not needed: Shape 1 was taken, and Shape 2's wakes come from the mod's timer | None |
| 28 | Claude Code's update settings in Desktop | Deferred | [28-update-channel.md](28-update-channel.md) |
| 29 | The hold | Partly | [29-hold.md](29-hold.md) |
| 30 | The undo | Partly | [30-undo.md](30-undo.md) |
| 31 | The safety checks tried live | Yes, with three changes | [31-safety-live.md](31-safety-live.md) |
| 32 | The mod's commands and the sandbox | Yes | [32-mod-sandbox.md](32-mod-sandbox.md) |
| 35 | Node.js and the hooks on a fresh account | Partly | [35-node.md](35-node.md) |
| 36 | Switching telemetry on for Desktop sessions | Partly | [36-telemetry.md](36-telemetry.md) |
| 37 | The pasted install line in Desktop | Partly | [37-install-line.md](37-install-line.md) |
| 38 | `gh` and `glab` without an installer | Partly | [38-host-tools.md](38-host-tools.md) |
| 34 | Screenshots from a hidden browser | Partly | [34-screens.md](34-screens.md) |
| 39 | What the transcripts show about a message and a turn | Yes, with two gaps | [39-transcripts.md](39-transcripts.md) |
| 40 | The mod without a screen | Yes, with five changes | [40-mod-headless.md](40-mod-headless.md) |
| 33 | The mod's first piece in Desktop | Partly | [41-mod-desktop.md](41-mod-desktop.md) |
| 41 | The mod in Desktop | Partly | [41-mod-desktop.md](41-mod-desktop.md) |
| 42 | Calm in Desktop | Partly (Mac): good enough for real use once three faults are put right | [42-calm-desktop.md](42-calm-desktop.md) |
| 50 | Switching a project's own parts off and on | Deferred | [50-switch-off.md](50-switch-off.md) |
| 52 | The low-integrity runner on Windows | Deferred | [52-low-integrity.md](52-low-integrity.md) |
| 53 | Granting build commands to a feature session on Windows | Deferred | [53-windows-grants.md](53-windows-grants.md) |
| 54 | VS Code's Claude harness | Not run yet | None yet |
| 55 | What an add-on's contributions reach | Not run yet | None yet |
| 56 | Registration: what Copilot loads, and twice | Yes | [56-registration.md](56-registration.md) |
| 57 | Copilot's sandbox | Not run yet | None yet |
| 58 | The guards' input | Partly | [58-hook-input.md](58-hook-input.md) |
| 59 | Clickable questions: whose answer | Not run yet | None yet |
| 60 | The other hooks | Partly | [60-other-hooks.md](60-other-hooks.md) |
| 61 | Sessions from a script | Yes, with two gaps | [61-sessions.md](61-sessions.md) |
| 62 | Setup's tools on Windows, and the timed run | Not run yet | None yet |
| 63 | Superpowers and Matt Pocock's skills on Copilot | Yes, with two gaps | [63-kits.md](63-kits.md) |
| 64 | Usage figures | Deferred | [64-usage.md](64-usage.md) |
| 65 | The phone | Not run yet | None yet |
| 66 | A clean reviewer session | Yes, on a clean copy of the change only; an untrusted checkout and a trusted folder leak | [66-clean-review.md](66-clean-review.md) |
| 67 | The pane's place | Not run yet | None yet |
| 68 | An approval on the host | GitLab routes Deferred, held for the director (H3); GitHub half held for its sitting (S4) | None yet |
| 69 | Lean's guards without Node.js | Yes, on the Mac, with two surprises | [69-guards-without-node.md](69-guards-without-node.md) |
| 70 | Lean in VS Code with nothing added | Not run yet | None yet |
| 71 | GitLab on the company's own servers | Partly, at Free: a commit status posted with the project key can stand in for a pipeline that never ran; Premium's half Deferred, held for the director (H3) | [71-gitlab-self-managed.md](71-gitlab-self-managed.md) |
| 72 | The add-on at Lean | Not run yet | None yet |
| 73 | The keychain: does denying the keychain files stop a sandboxed `security` | Yes on the Mac (the denial holds); Windows waits for check 52 | [73-keychain.md](73-keychain.md) |
| 74 | E1: Copilot through Archon's compiled binary | Deferred: the account has no included Copilot model, and Copilot spend waits for the director's go in the checking session | [74-archon-copilot.md](74-archon-copilot.md) |
| 75 | E2: Wheelhouse's guards inside an Archon Claude step | No: the hooks and deny rules hold, but bypass mode turns the sandbox off; the one-line patch is the route | [75-archon-guards.md](75-archon-guards.md) |
| 76 | E3: the merge path through a broker | Yes, every leg; `--config` cannot carry the maintainers policy | [76-archon-merge.md](76-archon-merge.md) |
| 77 | E4: skills inside Archon's steps | Partly: nine of eleven; item 7 showed no helpers, item 11 (Copilot) Deferred | [77-archon-skills.md](77-archon-skills.md) |
| 78 | E5: Archon's run control | Partly: no ask lost or doubled over 50 trials; a cancelled run can't be resumed, and a detached process survived a cancel; sleep not yet run | [78-archon-run-control.md](78-archon-run-control.md) |
| 79 | E6: counting spend under Archon | Deferred: the Claude half reads; the Copilot half waits for the director's go | [79-archon-spend.md](79-archon-spend.md) |
| 80 | One real small-lane run (part 4.1) | Yes: work order to a ready pull request on real Archon for $0.72, once six defects were fixed; main's own skills and hooks untested inside the steps | [80-small-lane.md](80-small-lane.md) |
| 81 | One real two-slice feature run (part 4.4) | Yes: two slices merged in order by the merge queue, then the switch-on, for about $6.30, once seven defects were fixed; the director is asked twice about the switch-on pull request | [81-feature-lane.md](81-feature-lane.md) |
| 82 | A real Mac app's tests under the check sandbox | Partly: a real project's tests pass by the Swift package row under a tightened, still allow-by-default profile; the draft profile leaks, and hosted Xcode tests can't run sandboxed | [82-check-sandbox.md](82-check-sandbox.md) |
| 83 | A lane on a folder with only a path remote | Yes: worktree, commit, push and clean-up all work with no fallback; the project is named from the path, not `_local`, and clean-up needs a fetch after the merge | [83-path-remote.md](83-path-remote.md) |
| 84 | The real status path on GitHub | Partly: on quick, `pending` then green, merged by Archon's queue with no Actions, and `hasCi` turns true once a status is posted; narrow and a missing `statuses: write` not measured | [84-set-status.md](84-set-status.md) |
| 85 | D1: many paused runs | Yes: no database lock over an hour at 6 paused and over 20 minutes at 6, 8 and 10; all answers sent in one tick were accepted, none lost or doubled; an answered run needs the waker running; a timed-out worktree start can't be told by branch or path | [85-many-paused.md](85-many-paused.md) |
| 86 | No way out of a run (D2) | Yes: a step has no question tool and a tool search can't find one, and a plain-chat question reaches no one; but none of the pack's 56 AI steps denies the tool, so part 1b should | [86-no-way-out.md](86-no-way-out.md) |
| 87 | The reader's view (D3) | Yes, with the fence: comments come out of `.js`, `.py`, `.swift` and `.yaml` diffs, a read-only list alone doesn't fence files, and on the real engine a read outside the reader's folder is refused. A reader told the paths reached no marker | [87-reader-view.md](87-reader-view.md) |
| 88 | A question card with no recommended option | Yes: chat, pane and phone each showed the card and took the click; the card check refuses it on one line today; the pane and phone option order was not confirmed by eye | [88-blind-card.md](88-blind-card.md) |
| 89 | The off path (D5) | Partly: a reused name, a changed off path a test sees, an edited test and a switch in words are caught; a change no test sees isn't (the known limit) | [89-off-path.md](89-off-path.md) |
| 90 | U3: leaving one pull request alone | Yes: `park` was offered on all four asks, and after it a sweep merged a clear pull request and left the parked one alone; readied at the same head with its record kept it waits with no new question, but handed over afresh it asks again and `merge` merges it; `handOver` must name the repository in full | [90-leave-pull-request.md](90-leave-pull-request.md) |
| 92 | U2: a lost owner | Yes: with the extended patch `workflow cancel` takes a run whose owner is gone, killed or after a restart's stand-in, keeps the worktree and its uncommitted files, and a fresh run on the branch finishes; a live owner behaves as released, and one whose endpoint alone is gone is refused. A step outlives its owner, and the cancel can't stop it, so R5 stops it by folder first | [92-lost-owner.md](92-lost-owner.md) |
| 93 | U4: a limit and a dropped connection | Yes: a cut connection is `transient`, a limit with no reset is `fatal` and only the record tells it from a sign-in failure; a failed run resumes under its id, worktree and artefacts, skipping finished steps, and the totals add both legs; paid usage is off on this account, and Archon can't see it where it is on | [93-limit-and-connection.md](93-limit-and-connection.md) |
