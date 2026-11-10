// adapters/copilot/index.js
// The Copilot adapter (design section 8, part 1). The sessions and evalRunner parts are not built yet: each is a stub
// that throws NOT_BUILT_YET (scripts/agents/contract.js) and is listed in `pending`. It imports nothing that reaches
// the hook kit, so the kit can import it without a cycle.
import { pendingPart } from '../../scripts/agents/contract.js';
import hooks from './hooks.js';
import identity from './identity.js';
import safetyLine from './safety-line.js';
import settings from './settings.js';
import tools from './tools.js';
import toolSheet from './tool-sheet.js';
import translate from './translate.js';

export const pendingSessions = pendingPart('sessions', ['checkForeman', 'checkFeature', 'foremanCall', 'featureStartCall', 'featureResumeCall', 'finalAnswer']);
const pendingEvalRunner = pendingPart('evalRunner', ['run']);

export default Object.freeze({
  identity,
  hooks,
  translate,
  tools,
  settings,
  sessions: pendingSessions,
  // On Copilot a chat click can't bind: no hook signs, and a hook runs beside the agent (design section 6.3). A click
  // binds only from a policy hook outside the agent, the helper's window or the code host's page.
  cards: Object.freeze({ binding: Object.freeze(['policy-hook', 'window', 'host']) }),
  // Nothing is committed to a project until setup comes back for Copilot (design section 8, part 11).
  packaging: Object.freeze({ files: () => [] }),
  toolSheet,
  safetyLine,
  evalRunner: pendingEvalRunner,
  pending: Object.freeze(['sessions', 'evalRunner']),
});
