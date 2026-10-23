// adapters/claude-code/safety-line.js
// What Claude Code can't enforce, for the board's health line: nothing beyond what the board's own protection
// lines already say, so it adds none. It imports nothing, so the board can read it without loading the adapter.
export default () => [];

// The board's line while Claude Code has a tool Wheelhouse doesn't know: such a tool is refused until Wheelhouse
// is updated.
export function updateWaiting(name) {
  return `Claude Code has a tool Wheelhouse doesn't know yet, \`${name}\`: it is refused until Wheelhouse is updated`;
}
