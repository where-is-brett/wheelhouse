<!-- docs/checks/12-locked.md -->

# Check 12: Locked's computer-wide settings

**Answer:** Partly — confirmed on the Mac: the password prompt installs the file, its hook acts only in Locked projects, and a project's own hook can't override it. On Windows the same hook, run from user settings, behaves the same way; installing the computer-wide file there, and a live mod trial, are still to come.

## Question

That the system's own password prompt can write the computer-wide settings file on macOS and Windows; that its hooks can limit themselves to Locked projects; and whether a mod or another hook can override a refusal by a managed hook.

## Tested on

Documentation read on 17 October 2026: https://code.claude.com/docs/en/managed-settings, https://code.claude.com/docs/en/settings-reference, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/permissions, https://code.claude.com/docs/en/sandboxing. Trials on macOS with Claude Code 2.1.278, with the director's consent and password, 17 October 2026. Trials on Windows 11 with Claude Desktop (Claude Code 2.1.299) and Node.js 24.21.0, from user settings with the director's consent and no admin rights, 17 October 2026.

## Method

Read the pages above for the file's location, what it may hold, how hook decisions combine and what a mod may do. Wrote the probe's hook, which acts only in a folder marked as a Locked probe project, and install and remove scripts that use the operating system's own administrator prompt and never overwrite an existing file.

## Evidence

- **Where:** `/Library/Application Support/ClaudeCode/managed-settings.json` on macOS, and `C:\Program Files\ClaudeCode\managed-settings.json` on Windows. The file takes the same keys as any settings file, so hooks and permissions on both.
- **Hooks that disagree:** "precedence is `deny` > `defer` > `ask` > `allow`". A project hook that answers allow can't undo a managed deny.
- **Mods:** a mod's check runs after rules and hooks and can approve a call, "unless the hook is in managed settings".
- **`allowManagedHooksOnly`** switches off user, project and plugin hooks and mods, unless a plugin is force-enabled in the managed `enabledPlugins`. It isn't needed for the guarantee above.
- **`strictKnownMarketplaces`** is an allowlist of plugin sources. It isn't needed either.
- **The sandbox under managed settings:** booleans set there can't be changed lower down. Lists such as `allowedDomains` can be added to by a project unless the sandbox is "admin-required" (`allowUnsandboxedCommands: false` or `allowManagedDomainsOnly: true` in the managed file). Delivering sandbox settings this way is documented for macOS and Linux only.
- **The probe's hook** stays silent outside a marked folder and refuses only the probe command inside one (three unit tests).
- **The install:** `install.js` raised macOS's own administrator prompt; the director typed their password; the file and hook landed in `/Library/Application Support/ClaudeCode/`, owned by `root`, so agents can't change them.
- **Trials, in headless sessions:**
  1. in a marked scratch project, `echo locked-probe hello` was refused: "probe: refused by the managed hook";
  2. in an unmarked one, it ran, so other projects are untouched;
  3. in a marked one whose own settings add a hook answering allow, it was still refused.
- **The removal:** `remove.js` raised the prompt again and removed both files. It left the folder `/Library/Application Support/ClaudeCode/` behind, empty, which Claude Code ignores.
- **Windows, before anything:** no file at `C:\Program Files\ClaudeCode\managed-settings.json`. Only its presence was checked.
- **Windows, from user settings:** `user-install.js` added the same hook to `~/.claude/settings.json` (keeping a copy of the file before), and the running Desktop session picked it up without a restart. Trials in that session:
  1. in a marked folder, `echo locked-probe hello` was refused: "probe: refused by the managed hook";
  2. in the same folder, an ordinary `echo` ran;
  3. with the mark removed, `echo locked-probe hello` ran;
  4. marked again, with the project's own `settings.local.json` adding a hook answering allow, it was still refused. The allow hook's own log showed it had run.
- **Windows, the removal:** `user-remove.js` took the hook out; the settings file was left with the same keys as before.

## What it means for the design

- Section 12.1: a managed hook's refusal holds against project hooks and mods. So Locked needn't limit plugin sources, and the card about doing so isn't needed. Locked also doesn't need `allowManagedHooksOnly`, as the design already says.
- Section 12.1: Locked's file should set `allowUnsandboxedCommands: false` and `allowManagedDomainsOnly: true`, making the sandbox admin-required. A project's settings then can't widen it. On Windows the file holds hooks and permissions, but no sandbox (check 10).
- Section 12.1: a Locked hook can limit itself to Locked projects by checking the session's working folder, as the probe's does. This holds on Windows too, with the hook's command quoting Node.js's path, which has a space in it (`C:\Program Files\nodejs\node.exe`).
- Section 12.1: on Windows a hook added to settings takes effect in a running Desktop session at once. A computer-wide file may behave the same, which the admin trial can confirm.

## Needs the director

Yes, on a Windows computer where the director has admin rights: their password twice (install and remove), about 5 minutes. The user-settings trial shows how the hook behaves on Windows but isn't Locked itself, since agents can edit user settings. The live mod trial can use the probe mod (checks 6 and 9); the documentation already says a mod can't override a managed hook.
