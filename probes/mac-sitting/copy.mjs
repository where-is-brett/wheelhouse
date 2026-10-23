// probes/mac-sitting/copy.mjs
// Copies this kit out of the repository into a scratch folder, so the sitting never writes in the
// repository, and records the checkout the plugin copy is taken from (source.json).
//
//   node probes/mac-sitting/copy.mjs <scratch-folder>
//
// The scratch folder must not exist yet. Every other script then runs from it with node.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
if (!target) {
  console.error('Usage: node probes/mac-sitting/copy.mjs <scratch-folder>');
  process.exit(2);
}
const dest = path.resolve(target);
if (fs.existsSync(dest)) {
  console.error(`${dest} already exists: run undo.mjs there first, or choose another folder`);
  process.exit(2);
}
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(here, dest, { recursive: true, filter: (src) => path.basename(src) !== 'copy.mjs' });
fs.writeFileSync(path.join(dest, 'source.json'), `${JSON.stringify({ worktree: path.resolve(here, '..', '..') }, null, 2)}\n`);
process.stdout.write(`kit copied to ${dest}\n`);
