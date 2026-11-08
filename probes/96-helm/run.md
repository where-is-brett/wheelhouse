<!-- probes/96-helm/run.md -->
# Check 96: the helm's interactive forms

The helm opens a feature session for the director in their terminal (`featureHelmCall`, `adapters/claude-code/sessions.js`). This check asks whether the two interactive forms keep what the session was started with.

## What it checks

In a scratch project with the plugin's own hooks (`hooks/hooks.json`, with `${CLAUDE_PLUGIN_ROOT}` set to this repository) and a hook (`hook.js`) that logs every event, one granted tool (`Bash(node:*)`), mode `acceptEdits` and the cheapest model (`haiku`), it:

1. starts a session with `-p` under a known id (`featureStartCall`);
2. opens it in tmux with `featureHelmCall` resuming (`start: false`), sends one prompt that uses the granted tool, and `/exit`;
3. opens a second session with `featureHelmCall` starting (`start: true`, the prompt positional), which uses the granted tool, and `/exit`.

Four answers, each true only when both forms agree:

- `grantHeld`: the granted tool ran with no permission question on screen, and a negative control (a second prompt that runs an ungranted Bash command, `python3`) did bring up a permission question, so the grant is what let the first one run and not a broader allow rule in the director's own settings. The control's question is answered with Escape.
- `modeHeld`: every hook input carried `acceptEdits`.
- `entrypointCli`: the hooks saw `CLAUDE_CODE_ENTRYPOINT === 'cli'`.
- `sessionEndOnExit`: `/exit` ended the process and `SessionEnd` ran with reason `prompt_input_exit`.

It also records, without judging it, whether the hooks saw `WHEELHOUSE_ROLE` in the helm terminal.

The probe logs with its own `hook.js` and not `probes/lib/hook-logger.js`: it needs the session's environment (`CLAUDE_CODE_ENTRYPOINT`, `WHEELHOUSE_ROLE`) and `permission_mode`, which the shared logger does not record. It runs first for each event, ahead of the plugin's hooks. The helm is started through `env -i`, so it sees exactly the environment `featureHelmCall` gives it, as the real helm does.

A failure keeps what was learned: the report holds the forms already finished, the pane of the form that failed, and the error. A session that ends early (limit, sign-in, a bad flag) fails at once with its pane captured.

## How to run it

```
node probes/96-helm/run.js
```

It needs tmux and a signed-in `claude` on the path, and spends a few model calls. The report goes to `probes/96-helm/reports/<date>.json`; the exit code is 0 when all four answers are true, 1 otherwise. If a grant or the mode is lost, stop before part 6 and report.
