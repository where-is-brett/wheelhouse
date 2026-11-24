// scripts/foreman/prompt-lead.js
// How the foreman's first prompt begins. It sits apart from the foreman's start so the session role can read it
// without loading that script's graph; scripts/foreman/start.js re-exports it.
export const FOREMAN_PROMPT_LEAD = 'Wheelhouse foreman:';
