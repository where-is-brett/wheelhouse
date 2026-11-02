// adapters/copilot/index.js
// The Copilot adapter (design section 8.1). Every part is here; a part not built would be a stub that throws
// NOT_BUILT_YET (scripts/agents/contract.js) and be listed in `pending`, which is empty now. It imports nothing that reaches
// the hook kit, so the kit can import it without a cycle.
import { sandboxNow } from '../../scripts/agents/copilot/sandbox-test.js';
import { LEAN_RECORD_DIR } from '../../scripts/lib/copilot-numbers.js';
import hooks from './hooks.js';
import identity from './identity.js';
import { sandboxLine } from './sandbox.js';
import safetyLine from './safety-line.js';
import settings from './settings.js';
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
  // The sandbox settings (settings.js); the clean home writes them once the sandbox test has passed (sandbox.js).
  settings,
  // The session starts (sessions.js): built, and the waker keeps a session's output and reads its outcome, id and
  // refusals from it (ruling P8-2), but their checks refuse while BACKGROUND_SESSIONS_READY is false (ruling P8-1).
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
  // The board's line for the sandbox on this computer, { level, text }, from the kept test (sandbox.js); not a contract part (the board reads it through scripts/agents/sandbox-line.js).
  sandboxLine: () => sandboxLine(sandboxNow().state),
  // One evaluation session through `copilot -p` (eval-runner.js, ruling P8-25), for `npm run eval -- --agent copilot`.
  // Loaded only when a session is asked for, so nothing that loads the adapter loads the evaluation runner.
  evalRunner: Object.freeze({ run: async (options) => (await import('./eval-runner.js')).run(options) }),
  pending: Object.freeze([]),
});
