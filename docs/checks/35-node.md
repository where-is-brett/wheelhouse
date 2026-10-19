<!-- docs/checks/35-node.md -->

# Check 35: Node.js and the hooks on a fresh account

**Answer:** Partly — the half about a session with no `node` is answered with the `claude` command line standing in for Desktop: every `Read` and `Bash` call is refused by the guards' `onFailure: block`, and a `node` put on PATH while the session runs lets the next call through without a restart. Whether Desktop on a fresh account finds an installed `node`, and the PATH it gives a hook, wait for the director's two sittings (Mac, Windows); the sitting is ready to run.

## Question

On a fresh account, whether Wheelhouse's hooks find `node` in Claude Desktop once the official Node.js installer has run, on macOS and Windows; and what a session with the plugin installed does when `node` isn't there at all, since its guards carry `onFailure: block`.

## Tested on

macOS 27.0.1, Claude Code 2.1.302 (headless sessions started from a terminal, `--plugin-dir` naming the Wheelhouse worktree; the Claude Code inside Desktop, 2.1.299, and Desktop itself were not used), 19 October 2026. No Windows run. Documentation read the same day: https://code.claude.com/docs/en/hooks and https://code.claude.com/docs/en/desktop (the hooks page was read through a summarising fetch, and only its first 100,000 of about 273,000 characters were covered, which included the `onFailure` section and the field table).

## Method

**What the documentation says.**

- `onFailure` on a command hook is `"continue"` or `"block"`, from Claude Code 2.1.295. A hook that "can't start", for example because the script or executable doesn't exist, counts as a failure, as do an exit code other than 0 or 2, a timeout and invalid output. With `"block"` the action that triggered the hook does not go ahead; otherwise it does, with a non-blocking notice. The field has no effect on `Stop`, `SubagentStop`, `TaskCompleted` and `TeammateIdle` hooks. The page says exit code 127 from the shell is how a missing executable shows.
- The `command` string runs in a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed. A hook inherits Claude Code's environment (less the `OTEL_*` exporter variables). The page doesn't name `PATH`. It adds that on Windows without Git Bash, a shell-form `PreToolUse` hook with `onFailure` unset can block the call.
- The Desktop page says that on macOS, an app started from the Dock or Finder "reads your shell profile" to give Claude Code `PATH`; on Windows it "inherits user and system environment variables" and does not read PowerShell profiles. It says nothing about hooks or Node.js.
- In `hooks/hooks.json`, three PreToolUse guards carry `onFailure: block`: `stop-guard.js` and `lineage-hold.js` on every tool (`*`), and `tool-guard.js` on the file, shell and connector tools. Every other hook (the session start, the prompt hooks, the report check, the status hooks) has none, so a failure of those lets things through. Notes 15 and 31 hold nothing on `node` or PATH (note 32 saw `$.process.run` fail to find `node` under the system's short PATH, and the design's section on guards says a failing guard stops the tool call).

**The agent trial** (three headless sessions, `claude -p`). The scratch project (`probes/35-node/run.js setup`, under the temporary folder) had in its `.claude/settings.json` two logging hooks on `SessionStart` and on every tool call: a Node.js one that logs `process.env.PATH`, `process.execPath` and the Node.js version, and a shell one that logs `$PATH` and `command -v node`. It also held `hello.txt`. Every session was started with `--plugin-dir` naming the Wheelhouse worktree, `--setting-sources project`, `--allowedTools Read Bash`, `--no-session-persistence`, `--output-format stream-json --verbose --include-hook-events`, in an empty environment apart from `HOME`, `USER`, `TMPDIR`, `SHELL`, a chosen `PATH` and `WHEELHOUSE_HOME` set to a scratch folder (so nothing was written to the director's `~/.wheelhouse`). The request was to read `hello.txt` with `Read`, run `echo hi` with `Bash`, and quote any hook message.

- **A, `node` found:** `PATH` set to this shell's.
- **B, no `node`:** `PATH=/usr/bin:/bin:/usr/sbin:/sbin` (`command -v node` finds nothing there). `claude` was started by its full path.
- **C, `node` appears while the session runs:** one session with `--input-format stream-json`, `PATH=<empty scratch folder>:/usr/bin:/bin:/usr/sbin:/sbin`. The same request was sent; when its answer came back, a driver script made `node` in the scratch folder (a link to the real one), and the request was sent again to the same process.

The scratch folder, its marketplace copy and the folder the sessions made under `~/.claude/projects/` were removed afterwards. Nothing else on the computer was changed. Each session started by the command line took its PATH from the environment given to it, not from a Dock launch, so A's PATH says nothing about Desktop's.

**The sitting** is in `probes/35-node/run.md`: the throwaway macOS user made and removed with `sudo sysadminctl` (the director types the passwords), the trials above repeated in a Desktop session there, and Windows.

## Evidence

- **A, `node` found:** the plugin loaded (`wheelhouse@inline`). All hooks succeeded (exit 0). `Read` ran five PreToolUse hooks (the three guards and the two logging hooks), `Bash` the same; `hello.txt` was read and `echo hi` printed `hi`. The Node.js logging hook recorded `execPath` as the version manager's Node.js 22 under `~/.nvm/` and the PATH it was given: the user's local bin folder, the version manager's folder, the Python frameworks, `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, then the system folders. The shell hook's `command -v node` gave the same `node`.
- **B, `node` missing:** At the session start the plugin's session-start hook and the Node.js logging hook failed with exit 127 and `/bin/sh: node: command not found`, and the session went on (no `onFailure`, so non-blocking). The `UserPromptSubmit` hooks failed the same way and did not stop the prompt. `Read` and `Bash` were each refused. The tool result for each, which is what the session and its agent were shown, read:

  ```text
  PreToolUse:Read hook error: [node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/tool-guard.js"]: failed; blocking because onFailure is "block"
  /bin/sh: node: command not found
  ```

  and the same with `Bash` in the first words. Four of the five hooks on each call failed with exit 127 (the three guards and the Node.js logging hook); only the shell logging hook succeeded, and it logged `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and `node=none` for the session start and for both calls. The refusal quoted one of the failed guards, `tool-guard.js`, not each. The session's own reply said both calls were blocked and quoted the message. A `Stop` hook and the `SessionEnd` hook (`stop-guard.js`) also failed; the latter printed `SessionEnd hook [node "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/stop-guard.js"] failed: /bin/sh: node: command not found` on the command line's standard error.
- **C, `node` put on PATH mid-session:** the first request was refused exactly as in B. After the driver linked `node` into the folder on PATH, the same session's second request went through: all the guards exited 0, `hello.txt` was read. No restart was needed, since each hook is started through the shell, which looks `node` up on PATH when it runs. No `SessionStart` hook ran in the second turn, so whatever the session start does (starting the helper, the reload of context) did not happen for that session.
- **Not tried:** `AskUserQuestion` and the other tools. `stop-guard.js` and `lineage-hold.js` are on `*` with `onFailure: block`, so by the hooks file every tool is refused without `node`, including the card tool; this is read from `hooks/hooks.json`, not seen.
- **What the Mac has.** `/usr/local/bin/node` is Node.js 20.9.0 (installed 24 October 2023), `/usr/local/bin` is in `/etc/paths`, and the plugin's `package.json` asks for 22 or later. A new macOS user on this Mac would therefore find `node` from the start, at an old version, and not be a "no Node.js" account. Run with that `node` outside a Wheelhouse project, with a made-up input, the session start, stop guard, lineage hold, board context and tool guard each exited 0 and printed nothing; this does not show how they run inside a project under Node.js 20.
- **Desktop, not yet seen:** what PATH a Desktop session gives a hook; whether it finds a `node` installed by the official installer (`/usr/local/bin`, on both systems' usual PATH); what Desktop shows the director when a guard blocks a call, and at the session start when `node` is missing.

## What it means for the design

For Task 7 (the order of setup), Task 13 and the README's wording:

1. **Node.js comes before the plugin, as Task 7 already has it, but installing it late is survivable.** A session with the plugin and no `node` refuses every file, shell and connector tool call (and, by the hooks file, every other tool), including `Bash`, so the agent cannot install anything or even read a log. The director is left with a message that names a Wheelhouse script and `node: command not found`, not Node.js or what to do. The README's wording should say: "If a Wheelhouse session says `node: command not found`, install Node.js from nodejs.org (the LTS), then ask again in the same conversation; if it still refuses, start a new session." Both halves are measured only for a command-line session; Desktop's PATH is the open part.
2. **A `node` installed after the session began is found at once if it lands in a folder already on the session's PATH** (the official installer's `/usr/local/bin` is on the Mac's usual PATH), without a restart; the session start's work is not redone, so a new session is wanted after installing.
3. **Where Desktop looks for `node`** is the PATH the session has, which the Desktop documentation says comes on the Mac from the shell profile when launched from the Dock or Finder, and on Windows from the user and system variables. The logged PATH from the sitting settles it. If the sitting shows the hooks don't find an installed `node`, Task 13 records the full path of `node` in the project's local settings as the hooks' command, as the brief says; nothing needs changing before then.
4. **Version.** The `node` on a Mac may be older than 22 (here 20.9.0). Whether the hooks work on Node.js 20 inside a Wheelhouse project was not tried; setup (Task 7) should check the version it finds, not only that `node` exists.
5. **The session-start line for an old Claude Code** (section on guards) is unaffected: it needs `node` to run, so it cannot warn about a missing `node`. Only the README and the setup's own check can.

## Needs the director

Yes, two sittings, both written out in `probes/35-node/run.md` so no more preparation is needed:

- **Sitting 1, the Mac (about ten minutes of the director's time):** type one `sudo sysadminctl -addUser` line in Terminal (administrator password, then a chosen password for the throwaway user); log in to the throwaway user; open Claude Desktop there and sign in; later quit, log out, log back in to their own account and type the `sudo sysadminctl -deleteUser` line. The optional installer step needs the administrator password and replaces the computer's `node` 20.9.0 for every user, so it asks first. The agent does the rest, including the Desktop session with a short PATH.
- **Sitting 2, Windows:** the same trials in the director's own account with `node` taken off PATH for one start of Desktop (no new Windows user, which would need administrator rights).
