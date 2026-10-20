// scripts/lib/started-as-script.js
// Whether a module is the program node was started with: the script named in the arguments and
// the module are the same file by their real paths. Node gives import.meta.url as the module's
// real path and the script as it was written, so through a link (on macOS /tmp and /var are
// links, and a plugin folder may be reached through one) the two differ as written, and a script
// that compared them so would run nothing and exit 0, which for a guard hook lets the tool call
// through. A path that can't be resolved is compared as written, and nothing named is never it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function startedAsScript(moduleUrl, argv = process.argv) {
  const started = argv[1];
  if (typeof started !== 'string' || started === '') return false;
  const self = fileURLToPath(moduleUrl);
  try {
    return fs.realpathSync(started) === fs.realpathSync(self);
  } catch {
    return path.resolve(started) === path.resolve(self);
  }
}
