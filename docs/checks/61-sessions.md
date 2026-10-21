<!-- docs/checks/61-sessions.md -->

# Check 61: starting and resuming Copilot sessions from a script

**Answer:** Yes, with two gaps. A script can run a headless session with `-p` and JSON output, take the session id from the `result` event, and resume it by id or with `--continue`. It can pick a custom agent, switch asking off, and give allow and deny lists. A command no rule allows is refused straight away, not asked and not left waiting. Every chained form that the model actually submitted (`&&`, `$( )`, `sh -c`) was refused against `shell(echo:*)`. `COPILOT_ALLOW_ALL=true` is honoured when it is in the session's own environment, and ignored when the environment is built clean with the session's own `COPILOT_HOME`. A scratch `HOME` breaks the keychain sign-in, so the starter must keep the real `HOME`. The two gaps: whether a saved permission applies headless was not shown, and writes by Copilot's file tools were not tried, because the session had no `create` tool.

## Question

The exact flags for headless, resume by id (and where the id comes from), a custom agent, no asking, allow and deny lists, and JSON output. The shape of a refusal in the output. Whether a command no rule allows is refused at once rather than asked. Whether `--allow-tool 'shell(<runner>:*)'` refuses `<runner> x && rm y`, `<runner> $(rm y)` and `sh -c 'rm y'`. Whether a session with its own `COPILOT_HOME` and an environment of only `PATH`, `HOME`, `TMPDIR` and `LANG` ignores the person's saved permissions and an allow-everything variable. Whether Copilot's path rules hold its file tools to the worktree with the temporary folder shut off, including through a folder link in the worktree that points out of it.

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. One model was in use throughout. 22 real model runs: 16 by `probes/61-sessions/run.js` and 6 by `probes/61-sessions-chains/run.js`, all exit 0 except one (the scratch-`HOME` sign-in, below). The raw results are kept with the build's working papers, not in the repository.

Help text read first, with no network: `copilot help permissions` (allow and deny kinds `shell(...)`, `write(...)`, `url(...)` and an MCP server's name; a deny beats every allow, even `--allow-all-tools`; file access is held to the working folder and its subfolders plus the system temporary folder; `--disallow-temp-dir` shuts off the second; `--allow-all` and `--yolo` are `--allow-all-tools`, `--allow-all-paths` and `--allow-all-urls` together), `copilot help environment` (`COPILOT_ALLOW_ALL`, `COPILOT_HOME`) and `copilot help config` (`defaultPermissionMode: "allow-all"` is "ignored on resumed sessions, outside interactive runs", and `trustedFolders`).

## Method

`node probes/61-sessions/run.js`, then `node probes/61-sessions-chains/run.js`. The probe makes a scratch project with a git worktree (the runs start in the worktree), a link `out` in the worktree to a scratch folder standing in for `~/Documents` (kept under `~/.wheelhouse-probes/`, outside the temporary folder, because the temporary folder is allowed by default; never the real `~/Documents`), another folder in the temporary folder with one file, and scratch Copilot homes. A "saved" home and a stand-in person's `~/.copilot` hold guessed saved-permission files (`settings.json` with `defaultPermissionMode: "allow-all"`, `permissions-config.json`); the format of a saved permission is not documented. Every run is a fresh headless Copilot (`-p`, `--output-format json`, `--no-auto-update`, `--disable-builtin-mcps`, `--log-dir`, `--log-level debug`), mostly with `--no-ask-user`. What happened is read from Copilot's own tool events (`tool.execution_complete` with `success` and `error.code`) and from whether the files exist, not from the reply's words.

1. `headless`, `resume-id`, `continue`, `agent`, `no-ask-user`: the session flags.
2. `lists` (`--allow-tool=shell(echo:*) --deny-tool=shell(touch:*)`, then `echo`, `touch` and `ls`), `deny-over-all` (`--allow-all-tools` with the same deny), `unruled` and `unruled-no-ask` (a `touch` no rule allows, with and without `--no-ask-user`).
3. `chains`, then six runs of their own in the chains-only probe, one command each, with the prompt saying it is a permission test on throwaway files: `echo x && touch y1`, `echo $(touch y2)`, `sh -c 'touch y3'`, and the same three with `rm` (`y1` to `y3` made or kept in the worktree). The first `chains` run was inconclusive: the model declined four commands itself and submitted only the control `echo`.
4. `saved-control` (a home holding the guessed saved permissions, no flags), `env-control` (`COPILOT_ALLOW_ALL=true` in the environment), `isolated` and `isolated-real-home` (the builder's way: own `COPILOT_HOME`, an environment of only `PATH`, `HOME`, `TMPDIR`, `LANG` and `COPILOT_HOME`, while the parent had `COPILOT_ALLOW_ALL=true` and `COPILOT_HOME` at the saved home; the first with `HOME` at a scratch folder holding the guessed saved files in `.copilot`, the second with the real `HOME`).
5. `paths` (`--allow-tool=write --disallow-temp-dir`) and `paths-control` (without `--disallow-temp-dir`): view the worktree's `README.md`, create a file inside, create and view through `out`, view and create in the stand-in folder by its own path, view a file in the other temporary folder.

Only environment names are recorded in the raw results, with values for `COPILOT_*` names alone.

**Undo.** The probe made only temporary folders (the work folder with the project, worktree, link, homes and the person's stand-in `HOME`) and the stand-in "Documents" folder under `~/.wheelhouse-probes/`, and removed them when it ended. It never read or wrote the real `~/.copilot` or `~/.wheelhouse`, and never linked to the real `~/Documents`. The one thing left is each probe's results file in `<temporary folder>/wheelhouse-probe-results/`, which can be deleted. Nothing needs undoing by hand.

## Evidence

### The flags

Fixtures: `tests/fixtures/copilot/sessions/` (`finished-run.json`, `resumed-run.json`, `refusal.json`, each the main events of one run with ids, paths, times and the model name scrubbed).

| To do | Flags | What was seen |
| --- | --- | --- |
| Run headless with JSON output | `-p "<prompt>" --output-format json --no-auto-update` | One JSON object per line. No allow flag was needed: `--allow-all-tools` is described as required for non-interactive mode, but runs without it work, and what no rule allows is refused (below). |
| Get the session id | none | The last line is `{"type":"result","sessionId":"<id>","exitCode":0,"usage":{...}}`. |
| Resume by id | `--resume=<id> -p "..."` | The same `sessionId` in the new `result` event, and the session remembered the earlier turn (the secret word it had viewed). The `=` form is needed: the value is optional. |
| Resume the latest | `--continue -p "..."` | The same session as the run before it in the same home, and the same recall. |
| A custom agent | `--agent probe-agent` | The agent file was in `<COPILOT_HOME>/agents/probe-agent.agent.md`; the reply was the made-up word its instructions gave. |
| No asking | `--no-ask-user` | The session had no `ask_user` call; asked for it, it said it had no such tool. Without the flag the same was true in check 58's headless run, so nothing here shows a difference. |
| Allow and deny lists | `--allow-tool=shell(echo:*) --deny-tool=shell(touch:*)` | The `=` form worked (the list takes several values, so the bare form could swallow the next argument). `echo` ran, `touch` was refused (`denied`), and the file was not made. |
| A deny beats allow-all | `--allow-all-tools --deny-tool=shell(touch:*)` | `echo` ran, `touch` was refused, no file. |
| Log for the record | `--log-dir <dir> --log-level debug` | Written; not needed for the answers. |

- **The exit code is 0 after a refusal.** A refused tool call does not fail the run: `exitCode` in the `result` event and the process exit were both 0. A script must read the tool events, not the exit code.
- **Read-only shell commands run without a rule.** In the `lists` run `ls` was in neither list and ran (`success: true`) with no `--allow-all-tools`. The `touch`, `rm` and `sh -c` forms that change things were refused.
- **Each run costs a premium request** (`usage.premiumRequests`), and a resume adds to the session's count.

### The shape of a refusal

A `tool.execution_start` for the call (`toolName: "bash"`, `arguments.command`), then a `tool.execution_complete` for the same `toolCallId`:

```json
{"type":"tool.execution_complete","data":{"success":false,"error":{"code":"denied","message":"Permission denied because no interactive user response was available. Retry in an interactive session so the user can approve it, or try an alternative that does not require this permission."}}}
```

The same code and message came for a command no rule allows, for a rule's refusal of a chained command, and for a path outside the allowed folders; a deny rule's refusal also had the code `denied`. The model then says so in its reply. The refusal is not distinguished by wording: whether a deny rule or the lack of an allow rule caused it is not in the event.

### A command no rule allows

Refused at once. With no flags, `touch unruled.txt` came back `denied` in the same turn, the run ended normally in about 10 seconds like the others, and the file was not made, with or without `--no-ask-user`. It was not asked and not left waiting: "no interactive user response was available" is the answer a headless run gives to the question it cannot put.

### Chained commands against `--allow-tool 'shell(echo:*)'`

The control `echo control-ok` ran. Of the six commands, four were submitted by the model, and each was `denied`, with its file unchanged:

| Command | Submitted | Outcome | File |
| --- | --- | --- | --- |
| `echo x && touch y1` | yes | denied | `y1` not made |
| `echo $(touch y2)` | no, the model declined | n/a | |
| `sh -c 'touch y3'` | yes | denied | `y3` not made |
| `echo x && rm y1` | yes | denied | `y1` kept |
| `echo $(rm y2)` | yes | denied | `y2` kept |
| `sh -c 'rm y3'` | no, the model declined | n/a | |

Each of the three forms (`&&`, `$( )`, `sh -c`) was refused at least once when it reached the permission system. The allowed first word did not carry the rest: `echo x && touch y1` is not matched by `shell(echo:*)`. Not shown: `echo $(touch y2)` and `sh -c 'rm y3'` themselves, which the model would not submit (it called the second not "explicitly scoped"), and any other trick (a pipe, `;`, a backtick, a here-document, an `env` or `xargs` prefix, a path to the runner).

### The environment, `COPILOT_ALLOW_ALL` and saved permissions

- **`COPILOT_ALLOW_ALL=true` in the session's own environment is honoured.** `env-control` (a scratch home, the variable in the environment, no flags) ran `touch env-control.txt` and made the file. Anything that starts a session must remove this variable from the environment it passes.
- **A clean environment ignores it.** `isolated-real-home` had exactly `COPILOT_HOME`, `HOME`, `LANG`, `PATH` and `TMPDIR` as names, and its only `COPILOT_*` value was its own `COPILOT_HOME`. `COPILOT_ALLOW_ALL` was not in it, though the parent had it set to `true`. `touch isolated.txt` was refused (`denied`) and no file was made.
- **A scratch `HOME` breaks the sign-in.** The first isolated run (`HOME` at a scratch folder) exited 1 with "No authentication information found", before any model call. The sign-in lives in the macOS keychain, and Copilot did not find it from a scratch `HOME`, even with the signed-in `config.json` in its own `COPILOT_HOME`. So the starter keeps the real `HOME` (the session still reads and writes only its `COPILOT_HOME`) or passes a token variable on purpose.
- **Saved permissions: not shown either way.** The name and format of a saved permission are not documented, and no run wrote one: the files Copilot added to a home were its own (`session-state`, a session database, `installed-plugins`, `plugin-data`, lock files), and the help says `defaultPermissionMode` is ignored outside interactive runs. The guessed files in the "saved" home (`saved-control`) did nothing in a headless run: `touch` was refused. That shows only that those guessed files are not read headless. The decoy files in a stand-in person's `~/.copilot` could not be tried, because the run that had them failed to sign in; the run that signed in used the real `HOME`, so a real saved permission in the real `~/.copilot` was not tested, only that `COPILOT_HOME` points the session elsewhere. A saved permission written by an interactive session was not made.

### Path rules

- **Inside the worktree** a `view` of `README.md` ran.
- **Through the `out` link** a `view` of `out/marker.txt` was `denied`, with and without `--disallow-temp-dir`: the link did not lead round the rule; the path was judged by where it leads.
- **The stand-in folder by its own path** was `denied` in both runs.
- **Another folder in the temporary folder** (`t.txt`) was `denied` with `--disallow-temp-dir` and ran without it. So the flag shuts off the temporary folder as the help says.
- **Writes: not shown.** In both path runs the session said its `create` tool was unavailable, so no file was created inside or outside the worktree. As in check 58, file changes go through `apply_patch`, which these runs did not ask for. The write half of the path rules is untried.
- The refusals read "no interactive user response was available": headless, a path outside the allowed folders is a permission asked and unanswerable. `--allow-all-paths`, `--allow-all` and `--yolo` would lift it.

### What was not tested

- Saved permissions written by an interactive session, and whether they reach a headless session; a real saved permission in the real `~/.copilot`.
- File writes (`apply_patch`) against path rules, with and without the link.
- Chained commands beyond the three forms, and the two the model would not submit.
- `write(path)` and `url(...)` rules; `--allow-all-paths`.
- Other models; Windows.

## What it means for the design

- **Part 7 Task 1 (Copilot sessions).** The starter's command line is `copilot -p <prompt> --output-format json --no-auto-update --disable-builtin-mcps --no-ask-user --log-dir <dir>` plus the level's `--allow-tool=...` and `--deny-tool=...` (the `=` form), run in the worktree, with `--agent <name>` for a custom agent. It reads the session id from the last `result` event, resumes with `--resume=<id>` (the `=` form) or `--continue`, and decides what happened from the tool events, never from the exit code, which is 0 after a refusal. It builds the environment itself: only `PATH`, `HOME` (the real one), `TMPDIR`, `LANG` and its own `COPILOT_HOME`, with `COPILOT_ALLOW_ALL` removed; `COPILOT_ALLOW_ALL=true` in a session's own environment lets everything through. The own home needs the signed-in `config.json`. It never passes `--allow-all`, `--yolo`, `--allow-all-tools` or `--allow-all-paths` except as a level's rules say.
- **Part 7 Task 2 (each level's permission rules).** The brief's "If the answer differs" paragraph does not apply as written: no chained command got past a shell rule. `&&`, `$( )` and `sh -c` were each refused at least once, because the rule does not match the whole command string. Guarded and Ask can therefore use `shell(<runner>:*)` rules, with the runner and the guard behind them, and no switch to an MCP-tool runner is needed. Two cautions to record: a read-only command (`ls`) runs with no rule, so a rule list is not a read barrier, and the evidence is for the forms listed, one model and `echo` as the runner, so the guard stays in place. The second paragraph (the person's saved permissions leaking into a session with its own home) is not triggered: nothing leaked in the runs, but the real case (a real saved permission in the real `~/.copilot`) was not tested, so the plan's ruling is to rely on `COPILOT_HOME` and the clean environment, and to have the first real use check that a command no rule allows is still refused.
- **Part 7 Task 3 (Guarded) and Task 4 (control files).** A refusal is a normal run: the watcher reads the tool events to see a refusal and does not treat exit 0 as success.
- **File rules.** Do not rely on the file tools' path rules to hold writes to the worktree until a write has been tried (an `apply_patch` through `out` and by the stand-in folder's own path). The read side held, including through the link.

## Needs the director

Nothing now.
