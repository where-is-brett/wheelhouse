// adapters/claude-code/index.js
// The Claude Code adapter: today's Claude Code code behind the adapter contract (scripts/agents/contract.js).
// At this point each part re-exports or wraps what the core already holds; later tasks move code behind it.
// It imports nothing that reaches the hook kit, so the kit can import it without a cycle; the foreman's
// call is loaded when asked for.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaude, invocation } from '../../scripts/lib/claude.js';
import { CLAUDE_CODE_FLOOR } from '../../scripts/lib/build-loop.js';
import { projectSettings, localSettings } from '../../scripts/protection/settings.js';
import { SETUP_FILES } from '../../scripts/setup/project-files.js';
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

// The words after `--resume`/`--session-id` are the feature session's own; the prompt goes with them.
function featureCall({ lead, args = [], prompt, claude = null, platform = process.platform, env = process.env }) {
  return invocation(claude ?? resolveClaude({ platform, env }), [], [...lead, ...args], prompt);
}

// The text of the last `result` event in a stream-json run, or null.
function finalAnswer(stdout) {
  let last = null;
  for (const line of String(stdout ?? '').split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    try {
      const event = JSON.parse(text);
      if (event?.type === 'result' && typeof event.result === 'string') last = event.result;
    } catch {
      // Not an event line.
    }
  }
  return last;
}

export default Object.freeze({
  identity: Object.freeze({ name: 'claude-code', label: 'Claude Code', floor: CLAUDE_CODE_FLOOR, find }),
  hooks: Object.freeze({
    registration: () => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, HOOKS_FILE), 'utf8')),
    file: () => HOOKS_FILE,
  }),
  // Claude Code's input and answers are the guards' own shape.
  translate: Object.freeze({
    toGuardInput: (raw) => raw,
    fromGuardAnswer: (out) => out,
  }),
  tools: Object.freeze({
    read: Object.freeze(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'TodoWrite', 'ToolSearch']),
    halt: Object.freeze(['TaskStop', 'KillShell']),
    notify: Object.freeze(['PushNotification']),
    ask: 'AskUserQuestion',
    shell: Object.freeze(['Bash', 'PowerShell']),
  }),
  settings: Object.freeze({ project: projectSettings, local: localSettings }),
  sessions: Object.freeze({
    foremanCall: async (opts) => (await import('../../scripts/foreman/start.js')).foremanSession(opts),
    featureStartCall: ({ sessionId, ...rest }) => featureCall({ ...rest, lead: ['--session-id', sessionId] }),
    featureResumeCall: ({ sessionId, ...rest }) => featureCall({ ...rest, lead: ['--resume', sessionId] }),
    finalAnswer,
  }),
  cards: Object.freeze({ binding: Object.freeze(['signed-hook']) }),
  packaging: Object.freeze({ files: () => [...SETUP_FILES] }),
  // Task 5 adds the tool sheet.
  toolSheet: '',
  safetyLine: () => [],
  evalRunner: Object.freeze({ run: ({ argv = [], ...options } = {}) => runEvals(argv, options) }),
});
