// adapters/claude-code/identity.js
// Who Claude Code is to the core: its name, its label, the oldest version Wheelhouse supports, and
// how to tell whether it is installed.
import { resolveClaude } from '../../scripts/lib/claude.js';
import { CLAUDE_CODE_FLOOR } from '../../scripts/lib/build-loop.js';

// Whether the `claude` command line can be found. Its version is not asked for here: that starts the program.
function find({ platform = process.platform, env = process.env } = {}) {
  try {
    resolveClaude({ platform, env });
    return { found: true, version: null };
  } catch {
    return { found: false, version: null };
  }
}

export default Object.freeze({ name: 'claude-code', label: 'Claude Code', floor: CLAUDE_CODE_FLOOR, find });
