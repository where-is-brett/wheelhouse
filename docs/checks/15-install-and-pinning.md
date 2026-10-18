<!-- docs/checks/15-install-and-pinning.md -->

# Check 15: installing at a pinned release

**Answer:** Yes, with a change — installing for one project at a pinned tag works from the shell, auto-update stays off, and Desktop installs through its plugin browser; one pasted line works only in a session, and the tag should be backed by a pinned commit.

## Question

What the one pasted line can do in Desktop (adding the source, installing, reloading); that a plugin can be installed at a tag or commit; that auto-update can be kept off for it; and whether a plugin can declare its pinned dependencies.

## Tested on

Documentation read on 17 October 2026: https://code.claude.com/docs/en/plugins/marketplace-reference, https://code.claude.com/docs/en/plugins/install, https://code.claude.com/docs/en/plugins/dependencies. A shell trial on macOS with Claude Code 2.1.278, the same day.

## Method

Read the pages above. Pushed a probe tag, `v0.0.0-probe`, at the first plugin commit. In a scratch project, added this repository as a plugin source at that tag for the project only, installed Wheelhouse for the project, and checked what was installed. Then uninstalled, removed the source, and deleted the tag here and on the host.

## Evidence

- A marketplace entry may set `ref` (a branch or tag) and `sha`, "a full 40-character lowercase commit SHA. When you set both … Claude Code checks out `sha`".
- Auto-update is set per marketplace, and is off by default for third-party marketplaces.
- Dependencies go in `plugin.json`'s `dependencies` list, with version ranges resolved against git tags.
- Project-scope install: `claude plugin install <name>@<marketplace> --scope project`.
- **The trial:** `claude plugin marketplace add "<owner>/wheelhouse#v0.0.0-probe" --scope project`, then `claude plugin install wheelhouse@wheelhouse --scope project`. The project's settings recorded the source with `"ref": "v0.0.0-probe"` and the plugin enabled. The cached copy was at the tag's commit, `472fdb7`, although the branch had moved on.
- The one-command form, `claude plugin install <name> --marketplace <source>`, needs Claude Code 2.1.292 or later from the shell, and 2.1.275 in a session as `/plugin install … --marketplace …`. The command line here was 2.1.278 and refused it.
- In Desktop, the documented way is the plugin browser: the **+** button, **Plugins**, **Add plugin**.
- A tag can be moved after the fact. The marketplace entry's `sha` field pins the exact commit.

## What it means for the design

- Section 12.4 stands: Wheelhouse installs for one project at a tag, with auto-update off. Its marketplace entry should also carry the release's `sha`, so a moved tag changes nothing.
- Section 15, step 1: the pasted line is `/plugin install wheelhouse --marketplace <owner>/wheelhouse#<tag>`, typed in a Desktop session (2.1.275 or later). It asks to confirm the source, then the scope; the director picks "this project". The setup plan tries it in Desktop, and falls back to the plugin browser's clicks if the line doesn't work there.
- Section 12.4: Wheelhouse can declare Superpowers and Matt Pocock's skills as dependencies, if they are published as plugins with tags; otherwise setup pins them in the project's settings.

## Needs the director

No. The setup plan tries the pasted line in Desktop.
