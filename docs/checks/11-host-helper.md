<!-- docs/checks/11-host-helper.md -->

# Check 11: the host helper

**Answer:** Partly — on the Mac, the sandbox keeps agents from the host, login files and `.env*`, while the helper started by a hook reaches the host for them; but a sandboxed agent can read the keychain, so the key can't be kept there.

## Question

That the sandbox can keep the keychain, logged-in tools' credential files and the host's network out of agents' reach, while the helper, started by a hook, reaches them; and that agents can't start their own copy of it outside the sandbox.

## Tested on

macOS, Claude Code 2.1.278 (headless sessions), 17 October 2026. On Windows there is no sandbox (check 10).

## Method

`probes/11-helper/setup.js` made a scratch project with the sandbox on, `allowUnsandboxedCommands: false`, reads of `~/.config/gh`, `~/.ssh`, `~/.npmrc` and `.env*` denied, network limited to the package registry plus the helper's socket file (`network.allowUnixSockets`), and a `SessionStart` hook that starts the helper. A headless session ran `trials.js` through Bash. Separately, with the director's consent, a made-up keychain item was stored and a sandboxed session tried to read it with `security find-generic-password -w`.

## Evidence

| Trial | Expected | Result |
|---|---|---|
| Read the GitHub login file | Refused | Refused (EPERM) |
| Read `.env.local` | Refused | Refused (EPERM) |
| Reach the host directly | Refused | Refused (name lookup blocked) |
| Start its own helper on a local port | Refused | Refused (EPERM on listening) |
| Ping the helper the hook started | Works | Works |
| Reach the host through that helper | Works | Works (HTTP 200) |
| Read a stored keychain item | Refused | **Read it** |

- The helper on a socket file needs no `allowLocalBinding`. That setting would open every local service to agents (sandboxing documentation, "A command fails to reach a server on localhost").

## What it means for the design

- Section 11 stands for the route: agents reach the host only through the helper, on a socket file the sandbox allows by name.
- Sections 11 and 12.6 change: the helper's keys (the host token and the signing key) are kept in a file under `~/.wheelhouse/`, not the keychain. The sandbox denies agents' commands that folder, and permission rules deny Claude's own file tools it, since those tools run outside the sandbox (check 10).
- Section 12.2: the sandbox settings must deny `~/.wheelhouse/` to reads as well as writes.

## Needs the director

No.
