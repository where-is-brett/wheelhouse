// scripts/lib/local-views.js
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';

// The views as the helper last wrote them on disk, when it cannot give them.
// While views are being replaced the old ones sit in `views.old` for a moment (or for good
// after a crash), so that folder is read when `views` is not there. `names` null reads
// every view there (the board's inputs).
export function localViews(project, names = ['rulebook', 'levels', 'waiting', 'unconfirmed', 'keptAsIs', 'damaged']) {
  const base = path.join(wheelhouseHome(), 'projects', project, 'views');
  const dir = fs.existsSync(base) ? base : `${base}.old`;
  const out = {};
  let wanted = names;
  try {
    wanted ??= fs.readdirSync(dir).filter((n) => /^[A-Za-z][A-Za-z0-9-]*\.json$/.test(n)).map((n) => n.slice(0, -'.json'.length));
  } catch {
    return null;
  }
  for (const name of wanted) {
    try {
      out[name] = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    } catch { /* missing */ }
  }
  return Object.keys(out).length > 0 ? out : null;
}
