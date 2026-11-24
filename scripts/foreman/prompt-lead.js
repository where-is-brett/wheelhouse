// scripts/foreman/prompt-lead.js
// How the first prompt of a session Wheelhouse starts begins: the foreman's and a builder's. It sits apart from the foreman's start so the session role can read it
// without loading that script's graph; scripts/foreman/start.js re-exports it.
export const FOREMAN_PROMPT_LEAD = 'Wheelhouse foreman:';
// A builder's first prompt (a feature session on either route) begins with this line, so the hooks know its role from the first tool call.
export const BUILDER_PROMPT_LEAD = 'Wheelhouse builder:';
