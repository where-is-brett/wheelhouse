<!-- docs/checks/72-addon-at-lean.md -->

# Check 72: the add-on at Lean, and the panel, on the Mac

**Answer:** Partly, on the Mac. The add-on installed from a `.vsix` with its hash checked, its pane drew in light, dark and high-contrast themes, and `extensions.allowed` leaving Wheelhouse out switched it off after a restart. The in-process helper did not run, so every theme was seen only in the "helper isn't running" state, and the hold, the answer on the next turn and the stale mark were not reached. `ADDON_LEAN_READY` stays false. The Windows half and the account with no admin rights are for the work laptop.

## Question

Whether the add-on gives a Lean project its pane, presses and helper in VS Code with nothing else added (Copilot design C19), and the panel's own steps: install from the `.vsix`, the pane in each theme and state, a card's hold and answer, `extensions.allowed`, and whether the helper in VS Code is the whole computer's helper and how far the inbox reaches.

## Tested on

4 November 2026, on macOS, VS Code 1.132.0 and then 1.144.1, in a scratch VS Code profile on the scratch project from checks 59 and 70, which Lean's setup had set up in check 70. Node.js is on this Mac. The agent made the clicks and restarts.

## Method

1. The agent built the `.vsix` from `main`, checked its hash against `vscode/vsix.sha256`, and installed it in the scratch profile.
2. Screenshots of the pane in the Dark Modern, Light Modern and Dark High Contrast themes.
3. The agent tried to start Wheelhouse's helper for the project, with a scratch `WHEELHOUSE_HOME`.
4. The agent set `extensions.allowed` in the scratch profile's settings to leave Wheelhouse out, restarted VS Code, took a screenshot, then put the setting back.

## Evidence

- **Install.** The hash matched and the add-on installed. The pane and its status-bar item came up.
- **Themes.** In each theme the pane drew its title, **All stop** and the line "Wheelhouse's helper isn't running, and nothing has been read yet." It was readable in all three. No other state was drawn.
- **The helper.** The project had no `lean.json` record: Lean's setup in check 70 doesn't write one, and `registerLean` runs only from `start-helper.js install`. Installing the helper under a scratch `WHEELHOUSE_HOME` was refused by this session's own safety checks as a lasting change to the computer, and was not tried another way. With Node.js present, the in-process helper is not started in any case (`node === null` is needed).
- **`extensions.allowed`.** After the restart the add-on was disabled: its commands were gone from VS Code's list, and the pane and status-bar item did not show. Putting the setting back brought them back.

### What was not tested

- The pane in its other states (cards waiting, a hold, a stale mark).
- A card asked in the chat and the panel, the hold, and the answer reaching the chat on the next turn.
- The stale mark after `extensions.allowed`, and cards coming back to the chat.
- Whether the helper in VS Code is the whole computer's helper, and how far the inbox reaches.
- A computer with no Node.js, where the in-process helper would run.
- Windows, the company's usual limits, and an account with no admin rights.

## What it means for the design

- **`ADDON_LEAN_READY` stays false.** The in-process helper was not seen running.
- **Lean's setup registers no Lean record,** so the add-on's `isLean` is false on a project Lean's chat setup made. Either the setup writes the record or the add-on finds Lean another way. This is a gap to settle before `ADDON_LEAN_READY` can pass.
- **`extensions.allowed` works as the panel design expects:** leaving Wheelhouse out disables the add-on at the next start.
- **The pane reads well in the three themes** in the one state seen.

## Needs the director

- A decision on the Lean record gap above.
- The rest of this check on the work laptop, which has no Node.js: the in-process helper, the card's hold and answer, the stale mark, and install with no admin rights.
