// adapters/claude-code/packaging.js
// The files Claude Code's setup commits to a project, and only these (ruling R42). This computer's
// local settings never go in. The setup step (scripts/setup/project-files.js) takes its list from here.
// This module imports nothing, so a hook and the setup step can both reach it without a cycle.
export const SETUP_FILES = Object.freeze(['.claude/settings.json', '.claude/wheelhouse.json', 'CLAUDE.md']);

export default Object.freeze({ files: () => [...SETUP_FILES] });
