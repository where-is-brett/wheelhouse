// adapters/copilot/index.js
// The Copilot adapter (design section 8, parts 1, 7 and 10). Every part is built. The sessions part is switched off
// (BACKGROUND_SESSIONS_READY). It imports nothing that reaches the hook kit, so the kit can import it without a cycle.
import hooks from './hooks.js';
import identity from './identity.js';
import sessions from './sessions.js';
import safetyLine from './safety-line.js';
import settings from './settings.js';
import tools from './tools.js';
import toolSheet from './tool-sheet.js';
import translate from './translate.js';

export default Object.freeze({
  identity,
  hooks,
  translate,
  tools,
  settings,
  sessions,
  // On Copilot a chat click can't bind: no hook signs, and a hook runs beside the agent (design section 6.3). A click
  // binds only from a policy hook outside the agent, the helper's window or the code host's page.
  cards: Object.freeze({ binding: Object.freeze(['policy-hook', 'window', 'host']) }),
  // Nothing is committed to a project until setup comes back for Copilot (design section 8, part 11).
  packaging: Object.freeze({ files: () => [] }),
  toolSheet,
  safetyLine,
  // One evaluation session through `copilot -p` (eval-runner.js), for `npm run eval -- --agent copilot`. Loaded only when
  // a session is asked for, so nothing that loads the adapter loads the evaluation runner.
  evalRunner: Object.freeze({ run: async (options) => (await import('./eval-runner.js')).run(options) }),
  pending: Object.freeze([]),
});
