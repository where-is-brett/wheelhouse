// adapters/claude-code/translate.js
// Claude Code's input and answers are the guards' own shape, so both pass through unchanged.
// It imports nothing, so the hook kit can read it without pulling in the rest of the adapter.
export default Object.freeze({
  toGuardInput: (raw) => raw,
  fromGuardAnswer: (out) => out,
});
