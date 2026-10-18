<!-- docs/checks/27-sessions.md -->

# Check 27: starting and waking sessions from a script

**Answer:** Deferred — the Mac half is complete (the shell trials and the sitting's run both passed, and sessions started this way did not show in Desktop's session list when it was read after the run); the Windows trials remain, as one run.

## Question

Starting and waking sessions from a script: whether a background Node.js process can start a fresh foreman session per batch of events, and start or wake a feature session, in Desktop on macOS and Windows, building on check 1. The answer picks the watcher's shape (section 11).

## Tested on

18 October 2026, on macOS with Claude Code 2.1.302, from the shell, with a small fast model named on the command line (the model is never written into the repository). Documentation read the same day:

- https://code.claude.com/docs/en/headless (`claude -p`, `--continue`, `--resume`, `--permission-mode`, `--permission-prompts`, structured output)
- https://code.claude.com/docs/en/cli-reference (every command and flag below)
- https://code.claude.com/docs/en/sessions (resume, `--session-id`, `--fork-session`, running background sessions, which sessions the picker lists)
- https://code.claude.com/docs/en/agent-view (`--bg`, `claude agents --json`, `attach`, `logs`, `stop`, `rm`, `respawn`, `--resume <id> --bg`, the supervisor)
- https://code.claude.com/docs/en/cross-session-messaging (the inbox socket)
- https://code.claude.com/docs/en/channels (events pushed into a running session)
- https://code.claude.com/docs/en/desktop (coming from the CLI, `claude --desktop`, flag equivalents)
- https://code.claude.com/docs/en/permissions (workspace trust)
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode (streaming input)

The Mac sitting was run later the same day by the agent on the director's click (below). Windows was not tried yet.

## Method

**The routes the documentation gives a script**, with what was done about each:

| Route | Start | Wake an existing session | Tried |
|---|---|---|---|
| `print` | `claude -p "<prompt>"` with `--permission-mode`, `--model`, `--output-format stream-json` | `claude -p --resume <session id> "<message>"` (a new process, the same session) | Yes |
| `stream` | `claude -p --input-format stream-json --output-format stream-json`, held open by the script | write one JSON line to its input | Yes |
| `bg` | `claude --bg --name <name> "<prompt>"` with the same flags | `claude stop <id>`, then `claude --resume <session id> --bg "<message>"` with no other flags | Yes |
| Desktop | `claude --desktop --resume <session id>` opens an existing session in Desktop | none documented; Desktop is "interactive only" for `--print` | In the Mac sitting |
| Inbox socket | none | the documentation covers a hook or shell command posting into its own session's socket, with an auth line; the message framing is not documented | No |
| Channels | none | an allowlisted channel plugin (Bun scripts; research preview) pushes events into a running session | No |
| Agent SDK packages | the TypeScript and Python packages | streaming input | No (same engine as `stream`; adds a dependency) |
| `--cloud` | cloud sessions | `claude --cloud <session id> -p` queues a message to a cloud session | No (not a local session) |

No `claude send` or `claude message` command exists in the documentation or in `claude --help`.

**The trials,** `probes/27-sessions/trials.js`, a plain Node.js script outside any session, run for each of the first three routes in a throwaway project under the temporary folder:

1. Start a session with "write pong-1 to pong.txt", mode `acceptEdits` and the named model; time until `pong.txt` holds `pong-1`.
2. Start a second in a separate git worktree of that project, the same way.
3. Send the second a one-line message asking for `pong-2`; time until the worktree's file holds it, and check the project's own file still holds `pong-1`.
4. Start a third fresh session in the project and read its transcript file: its own id on every entry, one prompt, and none of the first two sessions' ids or prompts. (It may read files the others left on disk; that is not conversation.)

The script starts its sessions with the host session's own variables left out of the environment, as a terminal would; `--inherit-env` keeps them. It logs times, token counts and session ids (no transcript text) outside the repository.

**Run on the Mac** from a shell inside a Claude Code session. `print` ran four times: one run timed out (below), one failed only the fresh-session check as first written (below), and two passed in full, one of them with the inherited environment. `stream` ran twice and passed both times (once with the inherited environment). `bg` ran three times: one blocked by trust (below) and two passed. The ranges in the table are over every run that reached a result, including the print run whose fresh-session check was wrong.

- `claude --bg` refuses to start in a folder Claude Code does not trust, and the throwaway folders under the temporary folder are not trusted. So the `bg` trials ran with `--worktrees-of <this checkout>`, which makes each throwaway project a detached worktree of a repository that is already trusted (trust is keyed on the main checkout; documentation). That loads the checkout's `CLAUDE.md`, so the `bg` token counts are higher than the others. Before the script was finished, the same background steps were also tried by hand in such a worktree. The script's `--wait-for-trust` option, which pauses so the director can accept the trust question in a scratch folder and then retries, was never exercised: it is untried.
- **The sitting.** `node probes/27-sessions/trials.js --model <name> --worktrees-of . --pause-at-end`, run by the agent on the director's click. Standard input was a pipe, so the end pause did not hold and each route was cleaned up as it ended. Desktop's own session list was read through the app after the run. While the trials were running, the list was not looked at. `claude --desktop --resume` was not tried, because nobody was watching the window. No trust question appeared (the projects were worktrees of the trusted checkout).
- The first `print` run timed out in all four trials at the script's 4-minute limit with no output (the app hosting the shell session was quit around then); it was discarded and run again. The first fresh-session check also failed, because the third session read `pong.txt` in the shared folder; the check was changed to look at the conversation, not at files on disk.

## Evidence

All trials passed on the Mac in the final runs (`print` 4 of 4, `stream` 4 of 4, `bg` 4 of 4 plus one information step). Times are seconds from starting the command to the file holding the expected text, as the lowest and highest over the runs that reached a result.

| Route | 1. start | 2. second, in a worktree | 3. wake (one line) | 4. fresh third |
|---|---|---|---|---|
| `print` (3 runs) | 3.2 to 4.0 s | 2.7 to 5.5 s | 3.5 to 9.9 s (a new process each time) | 2.3 to 5.7 s |
| `stream` (2 runs) | 3.3 to 3.5 s | 2.4 to 3.7 s | 1.3 to 1.5 s (a line to the open process) | 2.1 to 2.8 s |
| `bg` (2 runs) | 4.6 to 4.8 s; the `claude --bg` command itself returned in 0.7 to 1.1 s | 4.1 to 4.2 s | 3.0 to 3.3 s (stop, then resume; the same session id answered) | 3.4 to 6.1 s |

Tokens read by a fresh session: about 38,000 to 74,000 for `print` and `stream` (the higher figures with the inherited environment, which loads more), and 73,000 to 129,000 for `bg` (its projects were worktrees of this checkout, which loads its `CLAUDE.md`); a few hundred written. Token figures for the wakes are left out: the `bg` wake's was counted once and as the transcript's growth, and the `stream` figure is a result event's own number and may be a running total.

- **`print` wake:** `claude -p --resume <id>` resumed the same session. The permission mode and model had to be given again.
- **`stream` wake** is the fastest: the process stays alive, so a line written to it starts the next turn in about a second and a half. The script holds the process, so the foreman could not be fresh per batch this way, and the watcher dying would end the session.
- **`bg` wake in place needs the session stopped first.** `claude --resume <id> --bg "<message>"` while the background process was alive (idle) always started a copy under a new id ("session ... is already running in the background, so this started a copy"). After `claude stop <id>`, the same command with no other flags woke the same session "with its saved options" (name, permission mode, setting sources, model). With flags added, it started a copy even after the stop ("keeps its own saved options"). Found by hand and again by the script (step 3b: a copy, 3.6 s).
- **`claude -p --resume <id>` on a background session that is alive is refused** when flags such as `--output-format` or `--permission-mode` are given: exit 1, "That session is running in the background ... `claude stop` it first".
- **`claude agents --json --all`** lists each background session with `id` (the short id the start prints), `sessionId`, `name`, `cwd`, `state` (`working`, `done`, ...) and `status`, which is enough for a watcher to find a session and see when it is idle.
- **Trust.** A `claude --bg` in an untrusted folder exits at once with "Workspace not trusted. Run `claude` in <folder> once and accept the trust prompt, then retry." Documentation names a way to trust a folder by hand: set `hasTrustDialogAccepted` for the repository root in the user's `~/.claude.json`.
- **Environment.** The host session's variables (a host-supplied gateway address, bare mode) were left out of the new sessions, and they signed in from the Mac's own login. With them kept, they signed in too.
- **The Mac sitting's run passed 13 of 13** (`print` 4, `stream` 4, `bg` 4 plus the information step; log kept outside the repository). To the file, in seconds: `print` 3.9, 3.0, 2.4 for the wake, 3.4; `stream` 3.1, 3.4, 1.6 for the wake, 4.1; `bg` 4.4, 3.8, 2.6 for the wake (the same session), 3.3, with the `claude --bg` command returning in 0.7 to 1.1 s. The wake without stopping first again started a copy under another id (3.5 s). These sit inside or beside the ranges in the table.
- **Desktop's session list.** Read through the app after the run, it showed none of the probe's sessions. By then the trials had stopped and removed them, so this does not show whether they appear while running, which was not observed. Documentation says `claude -p` sessions are left out of the session picker, and that Desktop and the command line each keep their own session list.

## What it means for the design

- The two shapes (build-loop design, section 11): Shape 1, a background Node.js process outside any session that starts a fresh foreman per batch and starts or wakes feature sessions; Shape 2, the fallback, one long-lived foreman session hosting the watcher as a plugin monitor.
- On the Mac, Shape 1 is workable: a Node.js process outside any session can start a session in a named folder with an explicit mode and model (`claude -p` or `claude --bg`), and wake one by id in about 3 to 10 seconds (`print` resume, or `bg` stop then resume). A fresh foreman per batch is a plain new `claude -p` or `claude --bg` each time (2.3 to 6.1 s to the first file across all runs).
- The route for a feature session that must keep its own conversation is `claude --bg`, then `claude stop <id>` and `claude --resume <session id> --bg "<one line>"` with no other flags. The watcher must not add flags to the resume (the session keeps the mode and model it started with) and must not skip the stop (it would fork a copy). Keeping the session id from `claude agents --json` is the watcher's job.
- `claude --bg` only works in folders the director has trusted (the wait-and-retry for a scratch folder is untried; the fallback is `--worktrees-of`, as run.md says). The project's own folder will be (the director works there); each new project folder, and each feature worktree of a trusted repository, is covered by the repository's trust. A throwaway folder is not, which is why trials need `--worktrees-of` or one manual trust.
- Sessions the script starts did not show in Desktop's list (read after the run only), so the director should not expect to watch them there. The documented way to open one in Desktop is `claude --desktop --resume <session id>` for a session that is not running; it is untried. Whether script-started sessions appear in Desktop while they run is not observed.
- Not settled, and needed before the answer: whether everything above works on Windows, where check 1 found the command line's own sign-in failing, and whether `claude --bg` and its background service work on Windows. The Shape 1 rule in the plan (every trial passes on both systems) is not met until then. If Windows fails, Shape 2 and Task 6 follow.
- Section 8's explicit-mode rule held for starts: every session here was started with `--permission-mode acceptEdits` and a named model. For a background wake, the claim that the resumed session keeps that mode and model rests on the command line's own message ("woke session ... with its saved options"); the trials did not check the mode or model of the resumed session.

## Needs the director

The Mac part was done by the agent on the director's click. Windows remains, as one run (about 10 minutes): Sitting 2 in `probes/27-sessions/run.md`. To get an answer other than Deferred, Windows must pass every trial; otherwise the answer is Shape 2.
