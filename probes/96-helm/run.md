<!-- probes/96-helm/run.md -->
# Check 96: the helm's interactive forms

The helm opens a feature session for the director in their terminal (`featureHelmCall`, `adapters/claude-code/sessions.js`). This check asks whether the two interactive forms keep what the session was started with.

## What it checks

In a scratch project with a hook (`hook.js`) that logs every event, one granted tool (`Bash(node:*)`), mode `acceptEdits` and the cheapest model (`haiku`), it:

1. starts a session with `-p` under a known id (`featureStartCall`);
2. opens it in tmux with `featureHelmCall` resuming (`start: false`), sends one prompt that uses the granted tool, and `/exit`;
3. opens a second session with `featureHelmCall` starting (`start: true`, the prompt positional), which uses the granted tool, and `/exit`.

Four answers, each true only when both forms agree:

- `grantHeld`: the granted tool ran with no permission question on screen.
- `modeHeld`: every hook input carried `acceptEdits`.
- `entrypointCli`: the hooks saw `CLAUDE_CODE_ENTRYPOINT === 'cli'`.
- `sessionEndOnExit`: `SessionEnd` ran after `/exit`.

It also records, without judging them, the `reason` on the `SessionEnd` input, and whether the hooks saw `WHEELHOUSE_ROLE` in the helm terminal.

## How to run it

```
node probes/96-helm/run.js
```

It needs tmux and a signed-in `claude` on the path, and spends a few model calls. The report goes to `probes/96-helm/reports/<date>.json`; the exit code is 0 when all four answers are true, 1 otherwise. If a grant or the mode is lost, stop before part 6 and report.
