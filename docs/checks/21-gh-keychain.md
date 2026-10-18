<!-- docs/checks/21-gh-keychain.md -->

# Check 21: the quick connection on the Mac

**Answer:** Deferred — the sandboxed run could not be made: headless and interactive sessions both declined to run the trials, and a command the director types with `!` runs outside the sandbox, so only the run outside the sandbox is recorded; the keychain result for agents rests on check 11.

## Question

Whether a sandboxed agent can read `gh`'s or `glab`'s sign-in from the keychain. The answer goes into the quick connection's warning.

## Tested on

macOS 27.0.1, Claude Code 2.1.302 (headless sessions, then one interactive session the director started; no Claude Desktop), 18 October 2026. `gh` was installed and signed in, with its token in the keychain. `glab` was not installed, so its trial was not run. On Windows there is no sandbox (check 10).

## Method

`probes/21-gh-keychain/trials.js` first prints whether the sandbox is on (it tries to list `~/.ssh`: "sandbox: on" if refused, "sandbox: OFF — results prove nothing" if listed). A "read" result counts only when that line says on. It then tries four ways of reading the sign-in and prints, for each, only "refused", "read n characters" or a plain word ("not installed", "no output (not signed in?)", "item not found"), never the value: `gh auth token`; `security find-generic-password -s gh:github.com -w`; reading `~/.config/gh/hosts.yml`; and `glab auth status --show-token` (read from stderr as well as stdout, counting only the token on the "Token found:" line, or failing that a `glpat-` value). Command output stays in memory. A `gh` command that prints nothing cannot be told from a refusal by the command alone, so a blocked `gh auth token` shows as "no output (not signed in?)" and is read together with the keychain and file trials.

`probes/21-gh-keychain/setup.js` made a scratch project with the sandbox on, `allowUnsandboxedCommands: false` and `failIfUnavailable: true`, reads of `~/.config/gh`, `~/.config/glab-cli`, `~/.ssh`, `~/.npmrc` and `.env*` denied, and no network to github.com or gitlab.com. A headless session in that folder was asked to run the trials with Bash, three times: with the command alone, with a sentence saying it was the project owner's own check, and with the script copied into the folder for it to read first. The sandbox was left on throughout. The scratch project was removed afterwards.

Later the same day, in the director's sitting, `setup.js` made a fresh scratch project and the director opened an interactive Claude Code session in it, with the request to run the trials as its first message. The service's automatic safeguards paused that session before it ran anything. With the session moved to another model, the model declined in turn, for the same reason as the headless ones, and suggested the director run the command with `!` instead. The director did so.

The trials were also run from an ordinary shell, outside the sandbox, for comparison. (The first run, before the sandbox line was added to `trials.js`, printed four lines; the sandbox line was confirmed afterwards as "OFF" in that shell, as expected.)

## Evidence

| Trial | Outside the sandbox | In the sandbox |
|---|---|---|
| Sandbox line | — (run before the line was added; "OFF" when checked) | Not reached. The director's `!` run printed "sandbox: OFF" |
| `gh auth token` | Read 40 characters | Not run |
| Keychain item `gh:github.com` | Read 74 characters | Not run |
| `~/.config/gh/hosts.yml` | Read 96 characters (the file has no `oauth_token` key, checked by counting matches, so it holds no token: `gh` keeps it in the keychain) | Not run |
| `glab auth status --show-token` | `glab: not installed` | Not run |

- All three headless sessions declined to run the trials. The model in them judged a script that reaches for the director's GitHub sign-in to be a credential probe and would not run it, even with the script in front of it. This is the session's own choice, not a sandbox error, and there was no sign the sandbox was off (the second session reported that it could not read the script outside the scratch folder). The request was not reworded further after the third attempt, because that would be arguing the model out of a safeguard.
- In the interactive session, the director's `!` command printed "sandbox: OFF" and then the same four results as outside the sandbox (40, 74 and 96 characters; `glab` not installed). A command typed with `!` runs in the director's own shell, outside the sandbox, so it is not a route to the sandboxed measurement. The untested route in the earlier card is now tested, and it does not work.
- The sandbox was never turned off for the headless attempts, and nothing was printed or stored but character counts.
- Indirect evidence from check 11 (`docs/checks/11-host-helper.md`): a sandboxed session read a stored keychain item with `security find-generic-password -w`. `gh` keeps its token in the login keychain through the same `security` tool, under a different service name (`gh:github.com`, where check 11 read a made-up item, `wheelhouse-probe`). Check 11's finding, that a sandboxed command could read a keychain item, is the reason to expect `gh`'s item is readable, not proof of it. This is an inference, not a measurement of `gh`'s own item.
- The sign-in file `hosts.yml` is not the risk when `gh` uses the keychain: it holds no token. The sandbox's read denial on `~/.config/gh` covers the file, but not the keychain item.

## What it means for the design

- Section 11, the quick connection's warning: until this is measured, say the same on the Mac as on Windows: "Agents act with your full GitHub (or GitLab) access, across all your projects. Fine for personal projects. An agent could read it directly." Drop the sentence that the Mac's sandbox keeps agents from the sign-in, and the "whether it can" wording in the paragraph, which now reads as unknown rather than as a protection.
- Section 12.2: the sentence that the sandbox denies the credential files of logged-in tools stays true for files, but the keychain item of `gh` or `glab` should be treated as readable (check 11). The deny rules on calling `gh` and `glab` directly are then the only barrier on the Mac for the quick connection, and a Bash deny rule can be walked round (M1).
- Section 20, check 21: the answer is open until the sandboxed run is made.

## Needs the director

No. Every route tried either ran outside the sandbox or was declined by the session asked to run it. Measuring it needs a session that will run a credential probe in the sandbox, which is not available now. The design's warning is written as for Windows (above), which is the safe wording, and nothing else waits on this check.
