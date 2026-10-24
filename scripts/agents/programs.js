// scripts/agents/programs.js
// The coding agents' own programs, which the tool guard refuses to start from an agent's shell (ruling P8-9): each
// adapter's list, or null for an agent with none (Claude Code's). Kept apart from the registry (scripts/agents/
// index.js), as reviews.js is, so the hook loads only these short lists. A test holds each entry to its adapter's own.
import copilot from '../../adapters/copilot/programs.js';

export const PROGRAMS = Object.freeze({ 'claude-code': null, copilot });

const every = (field) => Object.freeze([...new Set(Object.values(PROGRAMS).flatMap((own) => own?.[field] ?? []))].map((n) => n.toLowerCase()));

// The program names the guard refuses as a command word, in lower case.
export const NESTED_REFUSED = every('programs');
// The npm packages the guard refuses behind a package runner, in lower case.
export const NESTED_PACKAGES = every('packages');
