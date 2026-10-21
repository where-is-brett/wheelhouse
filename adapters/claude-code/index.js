// adapters/claude-code/index.js
// The Claude Code adapter: today's Claude Code code behind the adapter contract (scripts/agents/contract.js).
// At this point each part re-exports or wraps what the core already holds; later tasks move code behind it.
// It imports nothing that reaches the hook kit, so the kit can import it without a cycle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaude } from '../../scripts/lib/claude.js';
import { CLAUDE_CODE_FLOOR } from '../../scripts/lib/build-loop.js';
import { projectSettings, localSettings } from '../../scripts/protection/settings.js';
import { SETUP_FILES } from '../../scripts/setup/project-files.js';
import sessions from './sessions.js';
import tools from './tools.js';
import translate from './translate.js';
import { main as runEvals } from '../../scripts/eval/run.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS_FILE = 'hooks/hooks.json';

// Whether the `claude` command line can be found. Its version is not asked for here: that starts the program.
function find({ platform = process.platform, env = process.env } = {}) {
  try {
    resolveClaude({ platform, env });
    return { found: true, version: null };
  } catch {
    return { found: false, version: null };
  }
}

export default Object.freeze({
  identity: Object.freeze({ name: 'claude-code', label: 'Claude Code', floor: CLAUDE_CODE_FLOOR, find }),
  hooks: Object.freeze({
    registration: () => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, HOOKS_FILE), 'utf8')),
    file: () => HOOKS_FILE,
  }),
  // Claude Code's input and answers are the guards' own shape.
  translate,
  tools,
  settings: Object.freeze({ project: projectSettings, local: localSettings }),
  // How sessions start (adapters/claude-code/sessions.js): the waker and the foreman's start ask for these.
  sessions,
  cards: Object.freeze({ binding: Object.freeze(['signed-hook']) }),
  packaging: Object.freeze({ files: () => [...SETUP_FILES] }),
  // Task 5 adds the tool sheet.
  toolSheet: '',
  safetyLine: () => [],
  evalRunner: Object.freeze({ run: ({ argv = [], ...options } = {}) => runEvals(argv, options) }),
});
