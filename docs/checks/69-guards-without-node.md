<!-- docs/checks/69-guards-without-node.md -->

# Check 69: Lean's guards without Node.js, on the Mac

**Answer:** Yes, with two results the documentation did not predict. On the Mac, a guard written as a `/bin/sh` script that asks a local answer with `curl` runs under Copilot with no Node.js on the PATH, lets a call through on an allow answer, and refuses it on a deny answer and when no answer comes. A Copilot web hook (`type: http`) on `preToolUse` was also called at `http://127.0.0.1`, and its deny was obeyed, though the documentation says `preToolUse` web hooks must use https. And with the server down, the web hook refused the call rather than letting it through, though the documentation says web hooks fail open. The Windows half (PowerShell 5.1) is the director's sitting and is not covered here.

## Question

Whether a `preToolUse` command hook in `/bin/sh`, with `curl` asking a stand-in local answer server, runs under Copilot on a machine with no Node.js, refuses on a deny answer, and refuses when it gets no answer; and whether a Copilot web hook can call `http://127.0.0.1` or needs https.

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. Five real model runs by `probes/69-guards-without-node/run.js`, one per case, all exit 0. One model was in use throughout. The raw results are kept with the build's working papers, not in the repository. Every conclusion below rests on one run of its case.

## Method

`node probes/69-guards-without-node/run.js`, run outside the sandbox.

- **No Node.js.** The session is started with a PATH that is one scratch folder of symlinks to only `sh`, `bash`, `curl`, `git`, `cat`, `date`, `sed`, `tr` and `env`, and to Copilot. The npm `copilot` launcher is a `#!/usr/bin/env node` script and cannot start without Node.js, so the symlink points at the native program inside the platform package (`node_modules/@github/copilot-darwin-arm64/copilot`), which is started directly. Before any model run the probe checked that `command -v node` and `command -v npm` found nothing through that PATH, `git --version` worked and `curl` was found. Each guard run also logged `command -v node` from inside the hook.
- **The guard.** `probes/69-guards-without-node/guard.sh` is registered in the scratch home's hooks folder as a camelCase `preToolUse` command hook (`bash` field, `/bin/sh`). It posts the hook's input with `curl -f` (3 second limit) to an answer server that the Node probe runs on `127.0.0.1`. An allow answer, meaning HTTP status 200 and a body that is exactly `{"permissionDecision":"allow"}` once leading and trailing whitespace is trimmed (whitespace inside the body is not removed): no output, exit 0. A deny answer, no answer, any other status (an error or a redirect), or any other body (including one that holds both a deny and an allow): `{"permissionDecision":"deny","permissionDecisionReason":...}` and exit 0. It logs only `COPILOT_*` environment variables, showing the value of seven named ones and `[set]` for any other.
- **The five runs**, each asking the session to view `README.md` (its secret word shows whether the view went through) and to stop if refused, with `--allow-all-tools`, `--trust-folder` and `--no-ask-user`: `guard-allow`, `guard-deny`, `guard-down` (nothing listening), `web-up` (`type: http` hooks for `preToolUse` and `postToolUse` at `http://127.0.0.1:<port>`, with `COPILOT_HOOK_ALLOW_LOCALHOST=1`, the `preToolUse` answer being deny) and `web-down` (the same web hooks, nothing listening). Whether a call went through is read from the session's own `tool.execution_complete` events (`success`, error code `denied`) and the secret word.

**Undo.** The probe made only temporary folders (a Copilot home, a scratch project, a tool folder) and removed them when it ended. The results file in `<temporary folder>/wheelhouse-probe-results/` can be deleted. Copilot also unpacks its native program into its own cache (`Library/Caches/copilot/pkg/` under the user's home), outside the probe's folders; it is shared with the earlier checks and left in place. Nothing needs undoing by hand.

## Evidence

| Run | Hook | Answer | Did the view run? | What Copilot said | Server saw |
| --- | --- | --- | --- | --- | --- |
| `guard-allow` | `guard.sh` | allow | Yes, secret word returned | `view` succeeded | one `POST /answer` carrying the hook input (`sessionId`, `timestamp`, `cwd`, `toolName`, `toolArgs`) |
| `guard-deny` | `guard.sh` | deny | No | `Denied by preToolUse hook: The answer server said deny.` (code `denied`) | one `POST /answer` |
| `guard-down` | `guard.sh` | no server | No | `Denied by preToolUse hook: No answer from the answer server (curl exit 7), so the guard refuses.` | nothing |
| `web-up` | `type: http` | deny | No | `Denied by preToolUse hook: <the server's reason>` | one `POST /web-pre` (JSON, with the hook input) |
| `web-down` | `type: http` | no server | No | `Denied by preToolUse hook from "<hooks file>" (hook errored)` | nothing |

- **Node.js was absent from the hook.** In all three guard runs the hook logged an empty result for `command -v node`, and its PATH was only the tool folder. Copilot itself (the native program) ran with that PATH and needed no Node.js.
- **The guard ran and failed closed.** `curl` reached the server in the allow and deny runs (exit 0) and failed in the down run (exit 7, connection refused); the guard turned the failure into a deny, and Copilot refused the call. Copilot's debug log shows it read the hook's stdout.
- **The web hook was called over plain http.** The documentation says a `preToolUse` web hook must use https and that `http://127.*` is allowed only with `COPILOT_HOOK_ALLOW_LOCALHOST=1`, and not for `preToolUse` even then. In this run, with that variable set, Copilot called the `http://127.0.0.1` address on `preToolUse`, sent the hook input as JSON, and obeyed the deny. No warning or error was logged. The probe set the variable in this run and did not run the case without it, so whether the variable is needed is not known.
- **The web hook failed closed, not open.** With the server down, Copilot's log has `Error in preToolUse hook ... (fail-closed): Error: HTTP hook fetch failed: POST http://127.0.0.1:<port>/web-pre (code=ECONNREFUSED)`, and the call was refused. The documentation and the research notes say web hooks fail open on network errors. The cause here was a refused connection. A web hook that times out was not tried (the command-hook time-out in check 58 let the call through).
- **The `postToolUse` web hook was never reached.** Both web runs had the view refused, so the `postToolUse` hook did not fire. Nothing was learned about it.
- **Time.** Each hook added well under a second; the runs took about 10 seconds each, mostly the model.

**The guard was tightened after the real run.** The run used a first version of `guard.sh` that allowed when the allow answer appeared anywhere in the body, so a body holding both a deny and an allow would have been let through. The stand-in server only ever sent clean answers, so none of the five runs touched that case and the results stand. The committed guard allows only status 200 with an exact allow body, and its tests cover the mixed answer, a 500 status, a 302 carrying the allow body, an empty 200, whitespace inside the strings, and whitespace around a valid answer. One gap is known: the shell drops NUL bytes when it captures the answer, so a body with a NUL inside it can read as allow; this was not closed. The tightened guard was tested against the stand-in server, not rerun against real Copilot.

### What was not tested

- Windows, PowerShell 5.1, and `powershell` hook entries (the director's sitting).
- The web hook without `COPILOT_HOOK_ALLOW_LOCALHOST=1`, with a non-local `http://` address, with https, and with a time-out.
- The `postToolUse` web hook.
- A web hook that answers allow: only deny was seen obeyed.
- An answer server that is slow. The 3 second limit on `curl` is what keeps a slow server on the deny side: without it, Copilot's own time-out would decide, and Copilot lets a timed-out hook through (check 58).
- A real answer server at Lean: the stand-in is on this machine and plain http. A guard that asks a remote address needs `curl` to trust the certificate, which was not tried.
- How Lean installs Copilot, and so whether it gets the native program or only the npm launcher.
- Other models, and other Copilot versions: the web-hook results contradict the documentation and may change.

## What it means for the design

- **Can the guards run without Node.js? Yes on the Mac, as shell scripts.** A `/bin/sh` guard using `curl` works as a `preToolUse` command hook, with Copilot started from its native program. This is the route for Lean's guards on the Mac. Wheelhouse's guards that are Node.js scripts cannot run on a machine without Node.js, so the Lean route needs a shell version of each guard that Lean relies on, or a thin shell hook that asks a local answer, as in this probe.
- **Fail closed must be written into the guard.** The shell guard refused when there was no answer only because `guard.sh` is written to deny on any failure. Any Lean guard in shell must do the same: deny on a curl failure, any status other than 200 and any answer that is not exactly the allow answer. It must also answer before Copilot's time-out, because Copilot lets a hook that times out through (check 58): `curl`'s own limit plus start-up must stay well under the hook's `timeoutSec` (here 3 seconds against 20).
- **Do not build on Copilot's web hooks yet.** A deny from them was obeyed against `127.0.0.1` here (an allow answer was not tried) and they refuse when the server is down, which would be the safe behaviour, but both results contradict the documentation, rest on one run, and were found with an environment variable set that the documentation ties to a different rule. A guard that depends on them could change behaviour in a later Copilot version. If a web hook is used at all, it should be an addition to a shell guard, never the only guard, and a version change should rerun this check.
- **The plan's parts.** The plan's "If the answer differs (check 69)" branch at Part 4 Task 3 is now triggered on the Mac: a guard without Node.js works, so Part 4 Task 3 gets a "Guards without Node.js" section naming the hook file Lean's setup writes, and Part 5 gets a task for it. Where a plan step assumed web hooks needed https or failed open, it should say instead that this was seen to differ on 1.0.101 on the Mac. If the Windows sitting finds no PowerShell 5.1 guard route, Lean on Windows has no Wheelhouse guards, as the design already says; the brief's "if the answer differs" case (no route at all) does not apply on the Mac.
- **Tool names still matter.** The guard here allowed or refused everything; a real guard must decide on what is being done, not on a tool name alone (check 58).

## Needs the director

The Windows half: a guard in PowerShell 5.1 (no Node.js), a `powershell` hook entry, and the same two cases (answer deny, no answer), at the Windows sitting.
