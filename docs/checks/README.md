<!-- docs/checks/README.md -->

# Design checks

The answers to the checks in section 20 of the design, and to checks 24 to 31 in section 16 of the build-loop design (`docs/specs/2026-10-18-build-loop-design.md`), and checks 54 to 72, which are the Copilot design's C1 to C19 (`docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md`, "Check numbers"), one note per check. Check 26 was not run and is no longer needed: Shape 1 was taken on check 27's Mac half, and Shape 2's wakes come from the mod's timer in the foreman's session, not a plugin monitor (build-loop design, section 11).

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
| 19 | Setup time | Deferred (held for the director's sitting) | [19-setup-time.md](19-setup-time.md) |
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
| 42 | Calm in Desktop | Deferred, held for the director's sitting at the Mac | [42-calm-desktop.md](42-calm-desktop.md) |
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
