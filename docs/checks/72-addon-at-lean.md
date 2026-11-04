<!-- docs/checks/72-addon-at-lean.md -->

# Check 72: the add-on at Lean, and the panel, on the Mac

**Answer:** Partly, on the Mac. The add-on installed from a `.vsix` with its hash checked, its pane drew in light, dark and high-contrast themes, and `extensions.allowed` leaving Wheelhouse out switched it off after a restart. With the helper started for the project, the pane showed "Nothing needs you", STOP (with **Lift All stop**, which lifted it) and a waiting card. But Wheelhouse's hook doesn't run in VS Code's Copilot session target: that harness doesn't set `COPILOT_CLI_BINARY_VERSION`, so the hook says "Wheelhouse doesn't run in this kind of chat" and STOP typed in the chat isn't set. The hold and the answer on the next turn were not reached. `ADDON_LEAN_READY` stays false. The Windows half and the account with no admin rights are for the work laptop.

## Question

Whether the add-on gives a Lean project its pane, presses and helper in VS Code with nothing else added (Copilot design C19), and the panel's own steps: install from the `.vsix`, the pane in each theme and state, a card's hold and answer, `extensions.allowed`, and whether the helper in VS Code is the whole computer's helper and how far the inbox reaches.

## Tested on

4 November 2026, on macOS, VS Code 1.132.0 and then 1.144.1, in a scratch VS Code profile on the scratch project from checks 59 and 70, which Lean's setup had set up in check 70. Node.js is on this Mac. The agent made the clicks and restarts.

## Method

1. The agent built the `.vsix` from `main`, checked its hash against `vscode/vsix.sha256`, and installed it in the scratch profile.
2. Screenshots of the pane in the Dark Modern, Light Modern and Dark High Contrast themes.
3. The agent tried to start Wheelhouse's helper for the project, with a scratch `WHEELHOUSE_HOME`.
4. Later the same evening the director started the helper for the scratch project by hand (`start-helper.js install` on a work computer, so with no sign-in start, under a scratch `WHEELHOUSE_HOME`), since this session's safety checks refused it. The agent restarted VS Code with the same `WHEELHOUSE_HOME`, typed STOP in the chat through the scratch extension, fed the hook the logged input by hand, pressed **Lift All stop** in the pane, and took the project off the helper again with `uninstall` afterwards.
5. The agent set `extensions.allowed` in the scratch profile's settings to leave Wheelhouse out, restarted VS Code, took a screenshot, then put the setting back.

## Evidence

- **Install.** The hash matched and the add-on installed. The pane and its status-bar item came up.
- **Themes.** In each theme the pane drew its title, **All stop** and the line "Wheelhouse's helper isn't running, and nothing has been read yet." It was readable in all three. No other state was drawn.
- **The helper.** The project had no `lean.json` record: Lean's setup in check 70 doesn't write one, and `registerLean` runs only from `start-helper.js install`. Installing the helper under a scratch `WHEELHOUSE_HOME` was refused by this session's own safety checks as a lasting change to the computer, and was not tried another way. With Node.js present, the in-process helper is not started in any case (`node === null` is needed).
- **With the helper.** The pane showed "Nothing needs you. Nothing is broken." STOP typed in the chat came back "Stopped." from the chat, but the helper's STOP stayed off. The hook's environment in VS Code's Copilot session target has `COPILOT_CLI=1`, `COPILOT_HOME`, `COPILOT_HOOK_DIR` and `COPILOT_PROJECT_DIR`, and no `COPILOT_CLI_BINARY_VERSION`; the session's saved events hold "Wheelhouse doesn't run in this kind of chat. Switch the chat to Copilot in the chat's agent picker.", though the chat was already on Copilot. Fed the same input with `COPILOT_CLI_BINARY_VERSION` set, the hook set STOP, and the pane turned red: "All stop is on. Every agent is stopped, and nothing moves until you say." with **Lift All stop**. Pressing it lifted STOP ("All stop is off."), and the pane showed "One thing needs you" with the card "Question · 1 of 1".
- **A forged input.** That hand-fed run is also check 59's forged input: a command run with input the agent writes set STOP. STOP stopping too much is the safe way round; the same would not hold for a click.
- **`extensions.allowed`.** After the restart the add-on was disabled: its commands were gone from VS Code's list, and the pane and status-bar item did not show. Putting the setting back brought them back.

### What was not tested

- The pane in a hold and with a stale mark.
- A card asked in the chat and the panel, the hold, and the answer reaching the chat on the next turn: the hook doesn't run in this harness.
- The stale mark after `extensions.allowed`, and cards coming back to the chat.
- Whether the helper in VS Code is the whole computer's helper, and how far the inbox reaches.
- A computer with no Node.js, where the in-process helper would run.
- Windows, the company's usual limits, and an account with no admin rights.

## What it means for the design

- **`ADDON_LEAN_READY` stays false.** The in-process helper was not seen running.
- **The harness check misses VS Code's Copilot session target.** `harnessOf` reads only `COPILOT_CLI_BINARY_VERSION`, which this harness doesn't set (check 74 found the same for the Copilot SDK's runtime). Every Wheelhouse hook there takes the chat for one Wheelhouse doesn't run in: only reading passes, and the STOP word is not read. The check needs another sign this harness gives, such as `COPILOT_CLI` with `COPILOT_HOOK_DIR`, weighed against what VS Code's Local harness sets. Until then Lean in VS Code has no guards.
- **Lean's setup registers no Lean record,** so the add-on's `isLean` is false on a project Lean's chat setup made. Either the setup writes the record or the add-on finds Lean another way. This is a gap to settle before `ADDON_LEAN_READY` can pass.
- **`extensions.allowed` works as the panel design expects:** leaving Wheelhouse out disables the add-on at the next start.
- **The pane reads well in the three themes** in the one state seen.

## Re-test of the harness check, 5 November 2026

**Answer:** Yes. With the harness check now reading `COPILOT_CLI` with `COPILOT_HOOK_DIR` and camelCase input (`harnessOf`, pull request #318), Wheelhouse switches on in VS Code's Copilot chat.

- **Tested on.** The Mac, VS Code 1.144.1 with its built-in Copilot Chat, in the sitting's scratch profile (`~/.wheelhouse-probes/sit/u`, signed in), on a scratch Lean folder registered in a scratch Wheelhouse home. The project's hook file ran Wheelhouse's real hook entry through a wrapper that logged what it saw and printed. Prompts went in through the sitting's chat-driver extension (`workbench.action.chat.open`), model Auto (GPT-5.6 Luna).
- **What VS Code sets.** `COPILOT_CLI=1`, `COPILOT_HOOK_DIR` (the project's hook folder) and `COPILOT_PROJECT_DIR`; no `COPILOT_CLI_BINARY_VERSION`. The input is camelCase.
- **A new chat.** The session start gave Wheelhouse's Copilot tool names ("Your clickable-question tool is ask_user (askQuestions in VS Code)"), not "Wheelhouse doesn't run in this kind of chat". The same entry run by hand without the two variables gave the old line.
- **A guarded call.** Asked to read `.env`, the chat's `preToolUse` hook answered exit 2 with "Wheelhouse does not let an agent read a .env file: ask the helper to do it", and the chat told the person it was not allowed to.
- **Not tried.** The STOP word from the phone (check 65), and the add-on's own in-process helper in this window.

## Needs the director

- A decision on the Lean record gap above.
- The harness check change is done (pull request #318) and re-tested above.
- The rest of this check on the work laptop, which has no Node.js: the in-process helper, the card's hold and answer, the stale mark, and install with no admin rights.
