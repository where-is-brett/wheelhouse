<!-- docs/checks/36-telemetry.md -->

# Check 36: switching telemetry on for Desktop sessions

**Answer:** Partly — the documentation and a command-line trial settle that the user settings' `env`, and the environment a program starts with, switch telemetry on, and that a project's own settings cannot (which explains check 7's Windows result). Whether Desktop's sessions take either one waits for the director's sittings, which are written out and ready. `route` is left open for Task 10.

## Question

Which per-computer route switches Claude Code's telemetry on for Desktop sessions, on macOS and Windows: the user settings' `env`, or the environment Desktop starts with; and that a project's settings can't (check 7).

## Tested on

macOS 27.0.1, Claude Code 2.1.302 (the `claude` command line, started from a terminal in scratch folders with a scratch `CLAUDE_CONFIG_DIR`), 19 October 2026. The command line stood in for Desktop: Claude Desktop, the Claude Code inside it (2.1.299 on the Windows computer of check 7) and Windows were not used.

Documentation read on 19 October 2026:

- https://code.claude.com/docs/en/monitoring-usage (quick start, administrator configuration, the repository-settings paragraph, the export interval, `service.name`, the variables not passed to subprocesses)
- https://code.claude.com/docs/en/settings (precedence, when edits take effect) and https://code.claude.com/docs/en/settings-reference (the `env` entry, "How `env` values interact with your shell", "When Claude Code applies `env` values", "Variables Claude Code ignores in `env`")
- https://code.claude.com/docs/en/env-vars ("Set variables in settings files", "Precedence")
- https://code.claude.com/docs/en/desktop ("Local sessions")

The first fetches were summarised by a small model and only the start of each long page was covered, so the raw page text of the four pages was fetched and the sections above were read in full from it. The rest of those pages was searched for `launch environment`, `launchctl`, `shell profile` and `login shell`, not read.

## Method

**Reading.** The sections above, for where the telemetry variables may be set, when they are read, and what Desktop does with them.

**The command-line trial** (`node probes/36-telemetry/run.js cli-trial`, run twice). In a fresh scratch folder per case, a capture server on a free port on 127.0.0.1 (from `probes/36-telemetry/run.js`; it keeps a summary of each request and not the account's email or IDs), then one `claude -p` with a one-line prompt, then three seconds' wait. The four settings were `telemetryEnv(port)` from `scripts/telemetry/env.js` plus `OTEL_METRIC_EXPORT_INTERVAL=1000`, which is only there so an export comes within a second. The environment given to `claude` held no `OTEL_*` variable and no `CLAUDE_CODE_ENABLE_TELEMETRY` unless the case put one there, and `CLAUDE_CONFIG_DIR` pointed at an empty scratch folder, so the director's own `~/.claude` was not read or written. Four cases:

- **user-settings:** the keys under `env` in the scratch config folder's `settings.json`, nothing else.
- **project-settings:** the same keys under `env` in the scratch project's `.claude/settings.json`, nothing else.
- **launch-env:** the same keys in the environment `claude` was started with.
- **none:** nothing set (the control).

A scratch config folder carries no sign-in (`claude auth status` in a scratch `CLAUDE_CONFIG_DIR`, and with a scratch `HOME`, both said `loggedIn: false`), so each `claude -p` printed "Not logged in" and exited at once. No model call was made and no allowance was used. Claude Code starts its telemetry before it checks the sign-in, as check 7 saw on Windows, so a request still goes out. This shows whether the keys switch telemetry on. It does not show token figures, which need a signed-in session answering a prompt.

**The sittings** (not done) are in `probes/36-telemetry/run.md`, built to slot into check 35's: on the Mac in check 35's throwaway account while it exists (steps M1 to M8, entered at step 10a of `probes/35-node/run.md`), on Windows after check 35's W6 (W7a to W12). `run.js` does the rest: the receiver (`receiver --detach`, summaries only), writing and removing the keys (`settings set|unset`, by key, with a copy of the file taken first and compared at the end), the launch environment (`launch-env set|unset`, which reads each variable before and puts it back), and the read-out (`read`). Seven unit tests (`tests/probes/36-telemetry/run.test.js`) cover the summary, the by-key add and remove, the folder guard, and a set-then-unset round trip on a named file. `launch-env` was not run, because it would change this computer's launch environment.

## Evidence

**What the documentation says** (19 October 2026):

- **A repository cannot switch telemetry on.** "Claude Code ignores the OpenTelemetry exporter variables in a repository's `.claude/settings.json` and `.claude/settings.local.json`". The monitoring page continues: set them "in managed settings, or have each developer set them in their shell or `~/.claude/settings.json`". The settings reference lists the ignored group: `CLAUDE_CODE_ENABLE_TELEMETRY`, the three `OTEL_*_EXPORTER` selectors, the `OTEL_LOG_*` content variables and every `OTEL_EXPORTER_OTLP_*` variable ending in `_ENDPOINT`, `_HEADERS`, `_PROTOCOL` and the like. Only values that turn something off (`none`, `0`) still apply from a project. "Ignoring this group in project and local settings requires Claude Code v2.1.282 or later." Check 7's Windows Desktop session ran Claude Code 2.1.299, so its silence is what this says to expect. The page adds that a `-p` run or an Agent SDK session shows no notice when a project's keys are dropped.
- **The user settings' `env` is allowed**, for these variables: `~/.claude/settings.json` (Windows `%USERPROFILE%\.claude\settings.json`, or `CLAUDE_CONFIG_DIR` when set). The settings reference says values from user settings are applied "at startup, and again in the running session when a saved change alters the merged `env`". The environment variables page then says a feature that reads its variables once at startup, "such as OpenTelemetry monitoring, keeps its startup values until you relaunch". So a session started before the edit does not send, and a new session is the expected minimum. Whether Desktop starts a fresh Claude Code process for each new session (so that a new session alone is enough) is not documented; the sitting settles it.
- **Desktop reads the same settings files.** The settings page says the desktop app reads the same files as the terminal. The Desktop page says of the `env` key in `~/.claude/settings.json` that the variables "reach Claude sessions only and not dev servers". The monitoring page says local sessions started from the Code tab report `service.name` `claude-code-desktop`.
- **The launch environment wins.** "When the Claude Desktop app ... starts the session, the launch environment it builds takes precedence instead: Claude Code ignores an `env` value from any settings file for a variable the launch environment already sets." So a variable in Desktop's launch environment beats the same key in the user settings, and a leftover from one trial would spoil the next. The debug log names each ignored variable.
- **What Desktop starts with.** The Desktop page: on macOS, launched from the Dock or Finder, it reads the shell profile to give Claude Code `PATH` and a set of Claude Code variables that the page does not list, and not other variables exported there. On Windows it "inherits user and system environment variables but does not read PowerShell profiles". The page does not say whether the telemetry variables are among the Mac's set, or whether `launchctl setenv` reaches a Dock launch. Nothing documents the Mac route; the Windows one rests on the one sentence.
- **Subprocesses.** "Claude Code doesn't pass `OTEL_*` environment variables to the subprocesses it spawns, including the Bash tool, hooks, MCP servers, and language servers." Printing the variables from inside a session therefore cannot show whether they arrived. Check 7's "undefined undefined" from a Windows Desktop session's own tools would read the same whether or not the session had the settings (if they were `OTEL_*` variables); what counts there is that its receiver saw nothing. The receiver's count is the test.
- **The default export interval is 60 seconds** (`OTEL_METRIC_EXPORT_INTERVAL`, default 60000). A real run needs a minute's wait or a shorter interval; the probe sets 1000.

**The command-line trial** (Claude Code 2.1.302, each case twice, 19 October 2026):

| Case | Requests received | `service.name` | Metrics |
| :- | :- | :- | :- |
| user-settings | 1 each run | `claude-code` | `claude_code.session.count`, `claude_code.active_time.total` |
| project-settings | 0 each run | none | none |
| launch-env | 1, then 2 | `claude-code` | the same two |
| none (control) | 0 each run | none | none |

- The user settings' `env` switched telemetry on for the command line with the four settings and nothing else, and a project's `env` with the same keys did not: the documented difference holds for Claude Code 2.1.302, in a `-p` run, with no sign-in.
- The launch environment switched it on too (the ordinary case, and the one check 7 used). The control sent nothing, so the requests came from the settings under test and not from the command line's own habits.
- Not shown: token figures (nothing was signed in), Desktop, and Windows.

## What it means for the design

For Task 10 (`scripts/setup/telemetry.js`) and the design's sections 9.1, 12.8 and 15 (card 6). `route` stays open until the sittings:

- **`route: 'user-settings'`** (what the documentation points to, and the cheaper of the two). Write `telemetryEnv(port)` (the four keys, no export interval) under `env` in `~/.claude/settings.json`, by key, on macOS and Windows alike (Windows `%USERPROFILE%\.claude\settings.json`; `CLAUDE_CONFIG_DIR/settings.json` where that variable is set). Uninstall removes those keys by key, only while they still hold Wheelhouse's values. If the director already has any of the four set to something else (their own collector), setup must not overwrite it: the card names it and asks. A new Desktop session is the expected minimum; whether a Desktop restart is needed is what the sittings record, and the card says so (a restart where the sitting shows one is needed). It is the same file `docs/checks/28-update-channel.md` writes its two update settings to, so one merge-by-key function can serve both.
- **`route: 'launch-env'`** (only if the user settings fail in Desktop). macOS: `launchctl setenv` for each of the four, which does not survive a restart of the Mac, so a login item (a LaunchAgent that runs the same `setenv` at log-in) is part of it, and Desktop is quit and reopened from the Dock. Windows: user environment variables (`[Environment]::SetEnvironmentVariable(name, value, 'User')`), Desktop quit and reopened, and a sign-out if it still does not see them. Uninstall: `launchctl unsetenv` and remove the login item; delete the four variables by name. This route is wider: every program the director starts inherits `OTEL_*` variables aimed at Wheelhouse's port, and the variables win over a settings file (so a later change in the settings file would be ignored by Desktop).
- **If neither works in Desktop,** there is no per-computer way to switch telemetry on there: the board's token measure (section 9.1) and the unusual-use alert would have nothing from Desktop sessions, only from terminal ones, and the mod would carry the weekly allowance and each session's cost alone (check 6). Section 9.1 and card 6 would then say so in plain words. Token figures from the session transcripts are a possible substitute and have not been looked at.
- **A project's settings never carry telemetry keys.** The documentation says they are dropped (Claude Code 2.1.282 or later) and a `-p` run says nothing when it drops them. Setup must not write them into a project, and no check should rely on a project file for this.
- **The receiver already suits a Desktop session.** `scripts/telemetry/receiver.js` reads only the metric names, values and the few allowed attributes; it never looks at `service.name`, so the `claude-code-desktop` value the documentation gives for local Desktop sessions needs no change. Read from the code, not run against a Desktop session.
- **Verifying that it took effect** is the receiver's first count (`claude_code.session.count` arrives at session start), not a variable printed from inside the session.
- **Port.** The settings hold the port (14318, or the one `usage/receiver.json` names). If that file changes the port, setup rewrites the keys.

## Needs the director

Yes, inside the two sittings of check 35, so no new sitting and no more preparation than is written in `probes/36-telemetry/run.md`:

- **Mac (about fifteen minutes in the throwaway account, steps M1 to M8; entered at step 10a of check 35's run.md):** one yes on an opening card, and the Desktop restarts: none for the first trial if a new session is enough (one if not), and one for the second. The agent does everything else, including the receiver, the settings, `launchctl setenv` and the undo, and starts the Desktop session with `start_session`. The director's own account is not touched. Check 35's step 1 makes the check 36 folder, so that step is where the preparation happens.
- **Windows (W7a to W12, after check 35's W6):** one yes on an opening card, and up to three Desktop restarts (after the settings, after the user variables, and once more to drop them). This uses the director's own user settings file and user environment variables for a few minutes; the script puts each back by name and checks the file against a copy.
