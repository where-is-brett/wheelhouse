// adapters/copilot/index.js
// The Copilot adapter (design section 8.1). Every part is here; the parts not built yet are
// stubs that throw NOT_BUILT_YET (scripts/agents/contract.js), and `pending` lists them, so checkAdapter
// accepts them and nothing else. It imports nothing that reaches the hook kit, so the kit can import it
// without a cycle.
import { pendingPart } from '../../scripts/agents/contract.js';
import { LEAN_RECORD_DIR } from '../../scripts/lib/copilot-numbers.js';
import identity from './identity.js';
import safetyLine from './safety-line.js';
import sessions from './sessions.js';
import tools from './tools.js';
import toolSheet from './tool-sheet.js';

export default Object.freeze({
  identity,
  // The parts not built yet, by the plan's part: the hook registration and the guards' translation (Part 5),
  // the settings writer (Part 7), the session starts above and the evaluation runner (Part 9).
  hooks: pendingPart('hooks', ['registration', 'file']),
  translate: pendingPart('translate', ['toGuardInput', 'fromGuardAnswer']),
  tools,
  settings: pendingPart('settings', ['project', 'local']),
  sessions,
  // On Copilot a chat click can't bind: no hook signs, and a hook runs beside the agent (design section 6.3).
  // A click binds only from a policy hook outside the agent, the helper's window, the add-on's button, or the
  // person's approval on the code host's page.
  cards: Object.freeze({ binding: Object.freeze(['policy-hook', 'window', 'add-on', 'host']) }),
  // What Lean's setup commits in a project (design section 6.4), as its first commit: the ignore lines, VS Code's
  // settings and the record folder's placeholder, so git tracks the folder. The board is not here: git ignores it.
  packaging: Object.freeze({ files: () => ['.gitignore', '.vscode/settings.json', `${LEAN_RECORD_DIR}/.gitkeep`] }),
  toolSheet,
  safetyLine,
  evalRunner: pendingPart('evalRunner', ['run']),
  pending: Object.freeze(['hooks', 'translate', 'settings', 'sessions', 'evalRunner']),
});
