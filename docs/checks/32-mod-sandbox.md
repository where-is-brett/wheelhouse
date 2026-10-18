<!-- docs/checks/32-mod-sandbox.md -->

# Check 32: the mod's commands and the sandbox

**Answer:** Yes — a command the mod runs with `$.process.run`, and a file it writes with `$.fs.write`, run outside the session's sandbox, while an agent's run of the same file is refused; one `hooks/hooks.json` holds both command hooks and a mod; and a UserPromptSubmit hook sees a plugin command's typed line and answers it with context. `node` is found only where it is on the session's PATH.

## Question

Whether a command a mod runs with `$.process.run`, and a file it writes with `$.fs.write`, are held by the session's sandbox, so the mod's bridge can read the signing key while an agent's command can't; whether the Wheelhouse plugin can carry its mod beside its command hooks; and whether a UserPromptSubmit hook can answer a plugin command with context.

## Tested on

macOS 27.0.1, Claude Code 2.1.302 (headless `claude -p`, started from a terminal shell; Claude Desktop not used), 18 October 2026. No Windows run: the sandbox doesn't run on native Windows.

## Method

**What the documentation says (read on 18 October 2026).**

- The mod reference that ships with Claude Code (the `plugin-authoring` skill's `reference.md` and `types/claude-code.d.ts`; the copy on disk was the one Claude Code 2.1.299 unpacked) says a hooks module is named under `modules` in `hooks/hooks.json`, and `$.process.run` "runs a host command by argv" with no shell, resolving `{ exitCode, stdout, stderr }` (30-second default limit, ten minutes at most). The `process` noun is "Commands on the host, run as the user the session runs as", and `$.fs` is "The file system as the engine's own process reaches it". `$.plugin.root` is the plugin's folder, absolute. Neither says anything about the sandbox.
- The sandboxing page (https://code.claude.com/docs/en/sandboxing) says the sandbox applies to "Bash, PowerShell, and Monitor commands and the processes they start", and that "Claude's file tools, MCP servers, and hooks run outside it": command hooks, local MCP servers, plugin monitors and helper commands "run with your full access". It doesn't mention mods.

**The probe** (`probes/32-mod-sandbox/`). The probe mod's `session.start` runs `$.process.run(['node', <root>/child.js, 'mod', <folder>])`, then tries `$.fs.write` and `$.fs.read` in a denied folder, and logs the results and the exit code. `child.js` tries to read a key file in that folder and to write a file there, and prints one JSON line saying what happened (never what it read). `run.js` makes a folder `~/.wheelhouse-probes/32-mod-sandbox/denied/` holding a dummy key, and a scratch project whose `.claude/settings.json` has the shape Wheelhouse writes (`scripts/protection/settings.js`): `sandbox.enabled`, `allowUnsandboxedCommands: false`, `failIfUnavailable: true`, `filesystem.denyRead` and `denyWrite` naming the folder, and `Read` and `Edit` deny rules for it. Then it runs:

1. `claude -p "Say hello."` with `--plugin-dir` naming the probe.
2. `claude -p` asking the agent to run `node <probe>/child.js agent <folder>` with the Bash tool and show its output.
3. Run 1 again with `PATH` set to the system's short one (`/usr/bin:/bin:/usr/sbin:/sbin`), as a Mac app started from the Dock gets it.
4. `claude plugin validate` (text and `--json`) on a scratch copy of the Wheelhouse plugin (`.claude-plugin`, `hooks`, `commands`, `scripts`) with `"modules": ["./register.ts"]` added to `hooks/hooks.json` beside `"hooks"`.
5. `claude -p "/probe32:show"` with a scratch plugin `probe32`: a command `show` ("Show what Wheelhouse added to this turn, as it is."), a UserPromptSubmit hook that logs the prompt it receives and adds a known line as context, and the probe mod named under `modules` in the same `hooks.json`.

Every run used `--setting-sources project` and a clean environment (none of the calling session's variables). The scratch projects, plugin copies and denied folder were removed afterwards, with the three empty folders the sessions made under `~/.claude/projects/`. Nothing else on the computer was changed.

## Evidence

- **Run 1, the mod:** `$.process.run` exited 0, and the child printed `"read":"ok","write":"ok"`. `$.fs.write` and `$.fs.read` in the denied folder both succeeded. Afterwards the folder held `written-by-mod.txt` and `written-by-mod-fs.txt`. The debug log has `hooks module wheelhouse-probe-32@inline loaded (worker, environment 1, tier user); events: session.start`, `$.process.run (wheelhouse-probe-32): node with 3 args` and `node exited 0 in 41ms`.
- **Run 2, the agent:** the same `child.js`, run through the Bash tool in the same project, printed `"read":"EPERM","write":"EPERM"`, and nothing was written. No permission was asked or denied: the command ran sandboxed.
- **Run 3, the short PATH:** `$.process.run` rejected with `HooksError: wheelhouse-probe-32: $.process.run(node) failed to start: ENOENT: Executable not found in $PATH: "node"`. `$.fs` still worked. In runs 1 and 2 `node` was the one the shell's PATH found (installed by a version manager); with the short PATH it isn't found, though the Mac has another `node` in `/usr/local/bin`. Command hooks run `node "…"` with the same PATH.
- **Run 4, validation:** `claude plugin validate` passed (exit 0) with only the usual warnings (no author, no marketplace description). Under `hooks/hooks.json` it listed the module: `./register.ts hooks: session.start` and `calls: $.env.get, $.fs.read, $.fs.write, $.process.run`. It raised no error for `hooks` and `modules` side by side; the JSON report's `errors` was empty.
- **Run 5, the command:** the hook received `prompt: "/probe32:show"`, the line as typed, not the command's text. The reply was "Wheelhouse added this line to the turn through a UserPromptSubmit hook:" followed by the known line exactly. In the same session, from the same `hooks.json`, the mod loaded (`hooks module probe32@inline loaded … events: session.start`) and its `session.start` ran. Its `$.process.run` exited 1 only because that scratch plugin had no `child.js`.

## What it means for the design

For Tasks 15, 17 and 18, and section 17.1:

1. **`$.process.run` runs outside the sandbox.** The mod's child read and wrote the folder the sandbox denies, while the agent's run of the same file got `EPERM`. Task 17's bridge (`node <plugin root>/scripts/mod/bridge.js` through `$.process.run`) can read the signing key and sign. No fall-back: the `~/.wheelhouse/mod-inbox/` route isn't needed.
2. **`$.fs.write` isn't held by the sandbox** (nor by the `Read` and `Edit` deny rules, which are for Claude's tools). No fall-back: Card 2's reply codes and `/go` don't wait for the rest of the mod, and the director doesn't get the one card. Because `$.fs` reaches everything the director's account can, the mod writes only under `wheelhouseHome()` and its own paths.
3. **`node` is found from `$.process.run` only where it is on the session's PATH**, the same lookup the command hooks use. With the system's short PATH it fails to start, with a rejection naming `ENOENT`. The brief has no fall-back for this. Task 17's bridge call treats a failed start as the bridge being missing (an informing line, never a failed session). Task 15's setup checks that `node` is on the PATH a Desktop session has, as it must for the command hooks anyway.
4. **One `hooks/hooks.json` may hold both `hooks` and `modules`.** The validator accepts it, and a session loads both from one file. No fall-back: no second plugin, `wheelhouse-mod`, is needed.
5. **A UserPromptSubmit hook sees a plugin command's typed line**, in the form `/wheelhouse:board`, as `prompt`, and the context it adds reaches that turn. The command's reply showed the line. No fall-back: the helper's `/show` route and `scripts/board/ask.js` aren't needed. Task 18's commands are answered by the one UserPromptSubmit hook.

On Windows the sandbox doesn't run, so an agent's command there reaches what the mod's does: the known gap of design section 11 stands.

## Needs the director

No. Whether a Desktop session's PATH holds `node` is seen at the pilot's first session start, where the command hooks need it too.
