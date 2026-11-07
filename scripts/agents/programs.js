// scripts/agents/programs.js
// The coding agents' own programs, which the tool guard refuses to start from an agent's shell (ruling P8-9). Claude
// Code has none. Another coding agent's program is still refused as a nested agent, parked or not: starting it from
// a shell would run an agent that Wheelhouse's guards don't wrap. Kept apart from the registry (scripts/agents/
// index.js) so the hook loads only these short lists.
const NESTED = Object.freeze({
  programs: Object.freeze(['copilot']),
  packages: Object.freeze(['@github/copilot']),
});

export const PROGRAMS = Object.freeze({ 'claude-code': null, nested: NESTED });

const every = (field) => Object.freeze([...new Set(Object.values(PROGRAMS).flatMap((own) => own?.[field] ?? []))].map((n) => n.toLowerCase()));

// The program names the guard refuses as a command word, in lower case.
export const NESTED_REFUSED = every('programs');
// The npm packages the guard refuses behind a package runner, in lower case.
export const NESTED_PACKAGES = every('packages');
