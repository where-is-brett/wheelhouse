<!-- docs/checks/10-sandbox-windows.md -->

# Check 10: the sandbox on Windows

**Answer:** No — on native Windows, Claude Code runs commands without a sandbox; only WSL2 has one.

## Question

Whether Claude Code's sandbox runs on Windows outside WSL. If it doesn't, the options come to the director as a card, because it decides how well their own Windows computer is protected.

## Tested on

The sandboxing documentation, https://code.claude.com/docs/en/sandboxing, read on 17 October 2026 (Claude Code 2.1.278 on the Mac). A trial on the director's Windows computer would only confirm it.

## Method

Read the documentation's platform section, and its sections on what runs outside the sandbox and on managed settings.

## Evidence

- "The sandbox runs on macOS, Linux, and WSL2. On native Windows, Claude Code runs commands unsandboxed. To use the sandbox on a Windows machine, run Claude Code inside a WSL2 distribution."
- For organisations, it advises delivering sandbox settings "as a managed settings file on macOS and Linux machines only", and moving Windows users "into a supported environment": WSL2 or a container.
- On every system, the sandbox covers shell commands only. Claude's own file tools follow permission rules instead: "A `denyRead` entry doesn't stop the Read tool". Hooks, MCP servers and the status line run with the user's full access.

## What it means for the design

- Section 12.1: on Windows, both levels lack the sandbox. Locked there still holds the hooks and deny rules in the computer-wide file, but not a sandbox.
- Section 12.2: deny rules must cover Claude's file tools as well as the sandbox, everywhere, since the sandbox never covers them.
- Section 11: on Windows, nothing stops an agent's command from reaching the host or reading a login file directly. The helper still carries the gate's checks, but it can't be the only route there.
- Section 15: a Windows setup that wants the sandbox needs WSL2, which takes an administrator step and a restart, well past 15 minutes.

## Needs the director

Decided by the director on 17 October 2026: accept it, and show it. Builders run on Windows too, with the deny rules, the gate and the helper, and the board says plainly that Windows has no sandbox. To be revisited when Claude Code adds a Windows sandbox.
