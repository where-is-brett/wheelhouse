// adapters/claude-code/safety-line.js
// What Claude Code can't enforce, for the board's health line: nothing beyond what the board's own protection
// lines already say, so it adds none. It imports nothing, so the board can read it without loading the adapter.
export default () => [];
