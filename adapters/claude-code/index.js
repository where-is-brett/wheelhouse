// adapters/claude-code/index.js
// The Claude Code adapter: today's Claude Code code behind the adapter contract (scripts/agents/contract.js).
// At this point each part re-exports or wraps what the core already holds; later tasks move code behind it.
// It imports nothing that reaches the hook kit, so the kit can import it without a cycle.
import identity from './identity.js';
import hooks from './hooks.js';
import packaging from './packaging.js';
import safetyLine from './safety-line.js';
import settings from './settings.js';
import sessions from './sessions.js';
import tools from './tools.js';
import toolSheet from './tool-sheet.js';
import translate from './translate.js';
import { runSession } from '../../scripts/eval/harness.js';

export default Object.freeze({
  identity,
  hooks,
  // Claude Code's input and answers are the guards' own shape.
  translate,
  tools,
  settings,
  // How sessions start (adapters/claude-code/sessions.js): the waker and the foreman's start ask for these.
  sessions,
  cards: Object.freeze({ binding: Object.freeze(['signed-hook']) }),
  packaging,
  // The playbooks' general words, mapped to Claude Code's tools (tool-sheet.md); the session start hands it over.
  toolSheet,
  safetyLine,
  // One evaluation session through `claude -p` (scripts/eval/harness.js), the runner `npm run eval` has always used.
  evalRunner: Object.freeze({ run: runSession }),
});
