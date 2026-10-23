// adapters/copilot/tool-sheet.js
// Copilot's tool sheet: tool-sheet.md without its path comment, as the text the session start hands to the
// agent. It is read once, when the module loads. The file lies beside this one, in the adapters folder that
// Locked copies, and this module imports nothing of Wheelhouse's, so a hook can read it without loading the
// adapter's other parts.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The file's first line is its path comment (an HTML comment); a session is not given it.
const PATH_COMMENT = /^<!--[^\n]*-->[ \t]*\n+/;

export function readSheet(file = fileURLToPath(new URL('./tool-sheet.md', import.meta.url))) {
  return fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n').replace(PATH_COMMENT, '').trim();
}

export default readSheet();
