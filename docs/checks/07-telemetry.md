<!-- docs/checks/07-telemetry.md -->

# Check 7: the telemetry receiver on both systems

**Answer:** Partly — confirmed on the Mac, with no install. On Windows Claude Code posted to the Node-only receiver with no install too, but no token figures were captured: the command line couldn't sign in, and a Desktop session didn't take the telemetry settings from its project.

## Question

That the telemetry receiver runs on macOS and Windows without extra installs.

## Tested on

macOS, Claude Code 2.1.278, Node.js 22.22.1, 17 October 2026.

Windows 11, the command line (Claude Code 2.1.302) and Claude Desktop (Claude Code 2.1.299), Node.js 24.21.0, 17 October 2026.

## Method

`probes/07-telemetry/run.js` starts a capture server on 127.0.0.1, runs one headless Claude Code session with telemetry pointed at it, and saves each request body to `~/.wheelhouse-probes/07-telemetry/`. The kept receiver, `scripts/telemetry/receiver.js`, uses only Node's built-in `http` module and is unit-tested against a sample built from the captured request.

On Windows, `run.js` first, then `capture.js`: the same capture server, with a scratch project whose `.claude/settings.json` sets the four telemetry settings under `env`, and a Desktop session started in that project to answer the same prompt.

## Evidence

- With the four settings from `scripts/telemetry/env.js`, Claude Code posted to `/v1/metrics` on the local port as JSON, with no collector or other install.
- A full run, once the command-line Claude was signed in, sent three requests in a short session, with an export every second. `parseOtlpMetrics` read four token records from them: input, output, cache read and cache creation, for one session and one model.
- A first version of the probe started Claude in a way that blocked its own capture server, and every export after the first timed out, as Claude's debug log showed ("Export took longer than … milliseconds and timed out"). Whatever runs the receiver must never block while Claude runs.
- The resource and data-point attributes match the documentation: `session.id`, `model`, `type`, and the account attributes `user.id`, `user.email`, `user.account_uuid`, `user.account_id`, `organization.id`. These account attributes arrive with every data point.
- The test sample (`tests/fixtures/otlp-metrics.json`) keeps the real envelope with the account details replaced by placeholders, and a token-usage metric in the same shape as the real one. The real data points also carry `query_source`, which the receiver doesn't need. The real ones aren't committed, because they name the model.

- **Windows, `run.js`:** the command-line Claude wasn't signed in ("Not logged in"; `claude auth login` failed with status 403), so it exited at once. Before exiting it still posted one request to `/v1/metrics` as JSON, with `claude_code.session.count` and `claude_code.active_time.total`: the Node-only server received it with no install. It held no token usage, so `parseOtlpMetrics` found no records.
- **Windows, quoting:** Claude is started through the shell there (it may be a `.cmd` shim), which joins arguments unquoted. The prompt is now quoted on Windows.
- **Windows, a Desktop session:** it answered the prompt, but the server received nothing. Asked to print the two settings from its own tools, it got "undefined undefined": the project's `env` settings didn't reach that session. Whether its folder counted as trusted wasn't checked.

## What it means for the design

- Section 9.1 stands: the receiver needs nothing beyond Node.js.
- Section 12.8: telemetry carries the director's email and account IDs with every data point. The receiver should keep only session, model, type, count and time, which `parseOtlpMetrics` already does. The data note should say that nothing else is stored.

## Needs the director

Yes, on a Windows computer where `claude auth login` works: `run.js` again (about 3 minutes), for the token figures. Separately, the design must say how Desktop sessions get the telemetry settings, since a project's `env` didn't do it on Windows: the user settings' `env`, or the environment Desktop starts with, are the next things to try, on both systems.
