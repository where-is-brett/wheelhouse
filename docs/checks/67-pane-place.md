<!-- docs/checks/67-pane-place.md -->

# Check 67: the pane's place, on the Mac

**Answer:** Yes. An extension can move its own view beside the chat: `vscode.moveViews` with `{ viewIds: ['wheelhouse.pane'], destinationId: 'workbench.panel.chat' }` put the Wheelhouse pane in the secondary side bar, above the chat, and VS Code kept it there after a restart and after an update to 1.144.1. `PANE_MOVES` turns true, so the first-run offer becomes a button (#315).

## Question

Whether a command lets the add-on move the pane to the secondary side bar for the person, and whether VS Code keeps it there (Copilot design C14).

## Tested on

4 November 2026, on macOS, VS Code 1.132.0 and then 1.144.1 (it updated itself during the sitting), in a scratch VS Code profile with the add-on built from `main` installed. The agent made the move and the restarts; nobody dragged anything.

## Method

1. A scratch extension listed the commands VS Code offers for moving views, then ran `vscode.moveViews` with the arguments above.
2. The agent read the profile's `state.vscdb` (`views.customizations`), and took screenshots before and after.
3. The agent quit VS Code (`workbench.action.quit`) and started it again, twice, and read the state and the window again.

## Evidence

- **The commands.** VS Code 1.132 offers `vscode.moveViews`, `workbench.action.moveView`, `views.moveViewLeft` and the like, and `wheelhouse.pane.resetViewLocation`.
- **The move.** `vscode.moveViews` returned with no error. The pane left the activity bar and showed in the secondary side bar, as its own section above the chat.
- **Kept.** `views.customizations` holds `"viewLocations":{"wheelhouse.pane":"workbench.panel.chat"}`. After each restart the pane opened in the same place, including after the update to 1.144.1.
- **The first-run message** still told the person to drag the wheel after the pane had moved. #315 changes it to the same button as the pane.

### What was not tested

- Windows, and a person's own VS Code with other views in the secondary side bar.
- What happens when the person moves the pane back. VS Code's own **Reset Location** command is there for it.

## What it means for the design

- **`PANE_MOVES` turns true** (#315): the first-run offer is a **Put Wheelhouse on the right** button, in the pane and in the first-run message, and the picture of the drag goes.
- **The panel design's section 9 limit stands for contributing,** not for moving: an extension still can't contribute a view straight to the secondary side bar, but can move it there with the person's click.

## Needs the director

- Nothing on the Mac. The Windows half is for the work laptop.
