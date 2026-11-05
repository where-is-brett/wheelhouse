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

## Needs the director

- A decision on the Lean record gap above.
- A go for the harness check change (a code change with its own tests).
- The rest of this check on the work laptop, which has no Node.js: the in-process helper, the card's hold and answer, the stale mark, and install with no admin rights.

## The hold, the next turn and the panel, on the Mac, 5 November 2026

**Answer:** Yes, once a Lean project's hold was fixed. A live panel holds the chat's cards, a press in the panel reaches the chat on its next turn, and the chat does not ask that card again. Before the fix the hold never applied to a Lean project. The Windows half and the account with no admin rights stay for the work laptop.

- **Tested on.** The Mac, VS Code 1.144.1 with its built-in Copilot Chat, in a copy of the sitting's signed-in scratch profile, with its own extensions folder, a scratch `WHEELHOUSE_HOME` and a scratch `COPILOT_HOME`, on a scratch Lean project that `start-helper.js install` registered (the helper ran from this branch). The add-on was the v0.2.8 release `.vsix`, downloaded; its hash matched the release's own `.sha256` file (`bd6e3adf3f9d`). VS Code was started with no `CLAUDE_*` variables in its environment; with them, a card command takes the chat for a Claude Code session and never asks about the panel. The agent clicked the panel's buttons through the page, and sent prompts through the sitting's chat driver (model Auto, GPT-5.6 Luna). 2.8 of the 200 premium requests were used.
- **Two gaps for a Lean project.** Lean's folder has no `.claude/wheelhouse.json`, so `agentOfProject` always said Claude Code, and the desk's `vscode` read found the folder through `readProject`, which doesn't know a Lean project. So a card command (`cards`) handed the card to the chat with the panel live, and the chat asked it. Both are fixed in this pull request (`scripts/agents/vscode-held.js` reads the Lean record's `agent`; `scripts/desk/file-source.js` finds the folder through `readLean`), with `tests/scripts/lean/vscode-held.test.js`.
- **The hold.** With the fix, `cards` returned the panel line in place of the questions ("1 card waits in the panel; I can ask it here instead" was what the chat said). Left alone, the model also raised its own question in the chat once, from the earlier session's words; that is the model, not a Wheelhouse card.
- **Approve in the panel only.** Pressing **Blue** on the first card dropped the count from 12 to 11 and VS Code showed "Recorded: Blue on card 1".
- **The next turn.** A new chat told to run `views waiting --since <time>` said it saw the card answered in the panel and what was chosen. The command printed "Since your last turn, the director answered: …" and the answered card was no longer in the waiting list. The prompt named the command; whether the front desk's own skill reads it unprompted at the start of a turn was not tried (Lean's kit was not in this scratch project).
- **`wheelhouse_board` is not used by the chat.** Asked for `#wheelhouseBoard`, the chat searched for it with a tool Wheelhouse refuses (`tool_search_tool`) and ran the front desk command through the terminal instead. The add-on's board tool did not run.
- **The panel's header** shows the project name ("Wheelhouse proj").
- **A waiting build question** (the move question) shows as "Question · 12 of 12" with pressable **Move it**, **Leave it**, **Suggest a change…** and **Why?**. It came to the panel once `cards` had composed it into a card. Not pressed.
- **Themes.** The panel, with that question, drawn in Default Light Modern, Default High Contrast and Default Dark Modern: readable, buttons clear, all stop visible. In the default layout the chat's section takes most of the height, so the card shows only after the chat section is collapsed.
- **`extensions.allowed`** leaving Wheelhouse out (with the release `.vsix` installed): after a restart the panel and the status-bar item were gone, and the extensions icon showed a warning. Setting it back is a settings change.
- **Cards come back to the chat.** With the add-on off and the mark more than 45 seconds old, `cards` handed a new card to the chat.

### Needs the director

Nothing for this half. The panel's hold on the Mac needs no person. Still for Windows: the no-admin install and the managed hook (check 59).
