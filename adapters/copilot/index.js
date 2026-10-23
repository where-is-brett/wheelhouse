// adapters/copilot/index.js
// The Copilot adapter (design section 8.1). Every part is here; the parts not built yet are
// stubs that throw NOT_BUILT_YET (scripts/agents/contract.js), and `pending` lists them, so checkAdapter
// accepts them and nothing else. It imports nothing that reaches the hook kit, so the kit can import it
// without a cycle.
import { pendingPart } from '../../scripts/agents/contract.js';
import { LEAN_RECORD_DIR } from '../../scripts/lib/copilot-numbers.js';
import hooks from './hooks.js';
import identity from './identity.js';
import safetyLine from './safety-line.js';
import sessions from './sessions.js';
import tools from './tools.js';
import toolSheet from './tool-sheet.js';
import translate from './translate.js';

export default Object.freeze({
  identity,
  // The person's hook file, written once per computer by setup (Part 5).
  hooks,
  translate,
  tools,
  // The parts not built yet, by the plan's part: the settings writer (Part 9, ruling P7-21), the session starts
  // below (Part 8) and the evaluation runner (Part 9).
  settings: pendingPart('settings', ['project', 'local']),
  // The session starts are built in sessions.js and exported there by name (Part 7 Task 1), but this part stays the
  // not-built-yet stub, and on the pending list, until Part 8 Task 1 switches it on in the same commit that makes the
  // waker keep a session's output and read its id and refusals from it (ruling P7-1).
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
  pending: Object.freeze(['settings', 'sessions', 'evalRunner']),
});
