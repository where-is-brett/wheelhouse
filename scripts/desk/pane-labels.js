// scripts/desk/pane-labels.js
// The six words the pane's own controls carry, held once. The VS Code add-on draws its buttons with these (vscode/pane/render.js,
// which gets them through its copy of the scripts), and the mod holds the same words in its own code (hooks/mod/), which can't
// import scripts: tests/mod/pane.test.ts holds the two equal. All stop is the name the director sees, the same word as the card
// that lifts it (LIFT_LABEL in scripts/state/card-lines.js).

export const PANE_LABELS = Object.freeze({
  stop: 'All stop',
  lift: 'Lift All stop',
  board: 'Board',
  settings: 'Settings',
  briefing: 'Briefing',
  done: 'Done',
});
