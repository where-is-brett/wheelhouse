<!-- docs/checks/06-usage-in-desktop.md -->

# Check 6: the weekly usage figure in Desktop

**Answer:** Partly — a mod in Desktop receives the weekly figure; a status line is never called in Desktop.

## Question

That the weekly usage figure reaches the status line and a mod in Desktop, not only the terminal. The documentation confirms it only for the terminal.

## Tested on

macOS, Claude Desktop, Claude Code 2.1.278 to 2.1.299, 17 October 2026, with the director's consent for both changes.

## Method

- **Status line:** `probes/06-usage/statusline.js` was set as the status line in the director's personal settings (backed up first), for about 15 minutes of this session's turns.
- **Mod:** the probe mod (`probes/09-mod/`) logged `$.session.usage()` at start and every `session.measure` event.

Both were removed afterwards. The settings file was restored byte for byte, and checked.

## Evidence

- The status line command was never called by Desktop. Its log held only the probe's own test line.
- The mod received both windows at start and again on `session.measure` when they moved: `five_hour` at 8% and `seven_day` at 97%, each with its reset time.

## What it means for the design

- Section 5.2's "at a glance" and section 9.1's weekly figure come from the mod in Desktop. A status line serves the terminal only.
- Until the mod is built, the briefing's usage line in Desktop needs another source. Telemetry (check 7) gives tokens, but not the share of the weekly allowance.

## Needs the director

No.
