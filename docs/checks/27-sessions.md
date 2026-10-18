<!-- docs/checks/27-sessions.md -->

# Check 27: starting and waking sessions from a script

**Answer:** Deferred — the shell trials on the Mac are recorded, the Desktop and Windows trials come in the director's sittings.

## Question

Whether a background Node.js process can start a fresh foreman session per batch of events, and start or wake a feature session, in Desktop on macOS and Windows, building on check 1. The answer picks the watcher's shape (build-loop design, section 11): Shape 1, a background process outside any session; or Shape 2, one long-lived foreman session hosting the watcher as a plugin monitor.

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

Desktop and Windows were not tried yet.

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

**Run on the Mac** from a shell inside a Claude Code session, three times for `print` and `stream` (once with the inherited environment) and twice for `bg`.

- `claude --bg` refuses to start in a folder Claude Code does not trust, and the throwaway folders under the temporary folder are not trusted. So the `bg` trials ran with `--worktrees-of <this checkout>`, which makes each throwaway project a detached worktree of a repository that is already trusted (trust is keyed on the main checkout; documentation). That loads the checkout's `CLAUDE.md`, so the `bg` token counts are higher than the others. Before the script was finished, the same background steps were also tried by hand in such a worktree.
- The first `print` run timed out in all four trials at the script's 4-minute limit with no output (the app hosting the shell session was quit around then); it was discarded and run again. The first fresh-session check also failed, because the third session read `pong.txt` in the shared folder; the check was changed to look at the conversation, not at files on disk.

## Evidence

All trials passed on the Mac in the final runs: `print` 4 of 4, `stream` 4 of 4 (also 4 of 4 with the inherited environment), `bg` 4 of 4 plus one information step. Times are to the file, in seconds; tokens are what the session read and wrote.

| Route | 1. start | 2. second, in a worktree | 3. wake (one line) | 4. fresh third |
|---|---|---|---|---|
| `print` | 3.2 to 4.0 s (about 48,000 in, 285 out) | 4.3 s | 3.5 to 9.9 s over three runs (a new process each time; 9.9 s was the slowest) | 2.3 s, fresh |
| `stream` | 3.3 to 3.5 s | 2.4 to 3.7 s | 1.3 to 1.5 s (a line to the open process; about 50,000 in, 194 out) | 2.1 s, fresh |
| `bg` | 4.8 s; the `claude --bg` command itself returned in 0.7 to 1.1 s (about 73,000 in, 550 out) | 4.1 s | 3.0 s (stop, then resume; the same session id answered; 86,000 in, 191 out) | 6.1 s, fresh |

- **`print` wake:** `claude -p --resume <id>` resumed the same session. The permission mode and model had to be given again.
- **`stream` wake** is the fastest: the process stays alive, so a line written to it starts the next turn in about a second and a half. The script holds the process, so the foreman could not be fresh per batch this way, and the watcher dying would end the session.
- **`bg` wake in place needs the session stopped first.** `claude --resume <id> --bg "<message>"` while the background process was alive (idle) always started a copy under a new id ("session ... is already running in the background, so this started a copy"). After `claude stop <id>`, the same command with no other flags woke the same session "with its saved options" (name, permission mode, setting sources, model). With flags added, it started a copy even after the stop ("keeps its own saved options"). Found by hand and again by the script (step 3b: a copy, 3.6 s).
- **`claude -p --resume <id>` on a background session that is alive is refused** when flags such as `--output-format` or `--permission-mode` are given: exit 1, "That session is running in the background ... `claude stop` it first".
- **`claude agents --json --all`** lists each background session with `id` (the short id the start prints), `sessionId`, `name`, `cwd`, `state` (`working`, `done`, ...) and `status`, which is enough for a watcher to find a session and see when it is idle.
- **Trust.** A `claude --bg` in an untrusted folder exits at once with "Workspace not trusted. Run `claude` in <folder> once and accept the trust prompt, then retry." Documentation names a way to trust a folder by hand: set `hasTrustDialogAccepted` for the repository root in the user's `~/.claude.json`.
- **Environment.** The host session's variables (a host-supplied gateway address, bare mode) were left out of the new sessions, and they signed in from the Mac's own login. With them kept, they signed in too.
- Documentation says sessions made by `claude -p` are left out of the session picker and `claude --continue`, and that Desktop and the command line each keep their own session list. Whether script-started sessions show in Desktop is for the sitting.

## What it means for the design

- On the Mac, section 11's Shape 1 is workable: a Node.js process outside any session can start a session in a named folder with an explicit mode and model (`claude -p` or `claude --bg`), and wake one by id in about 3 to 10 seconds (`print` resume, or `bg` stop then resume). A fresh foreman per batch is a plain new `claude -p` or `claude --bg` each time (about 3 to 5 seconds to first action).
- The route for a feature session that must keep its own conversation is `claude --bg`, then `claude stop <id>` and `claude --resume <session id> --bg "<one line>"` with no other flags. The watcher must not add flags to the resume (the session keeps the mode and model it started with) and must not skip the stop (it would fork a copy). Keeping the session id from `claude agents --json` is the watcher's job.
- `claude --bg` only works in folders the director has trusted. The project's own folder will be (the director works there); each new project folder, and each feature worktree of a trusted repository, is covered by the repository's trust. A throwaway folder is not, which is why trials need `--worktrees-of` or one manual trust.
- Not settled, and needed before the answer: whether the sessions a script starts appear in Desktop and can be opened there; whether everything above works on Windows, where check 1 found the command line's own sign-in failing; and whether `claude --bg` and its background service work on Windows. The Shape 1 rule in the plan (every trial passes on both systems) is not met until then. If Windows fails, Shape 2 and Task 6 follow.
- Section 8's explicit-mode rule held: every session here was started with `--permission-mode acceptEdits` and a named model, and the resume of a background session keeps those.

## Needs the director

The two sittings in `probes/27-sessions/run.md`: the Mac with Desktop open (about 5 minutes, one trust question to accept), then Windows (about 10 minutes).
