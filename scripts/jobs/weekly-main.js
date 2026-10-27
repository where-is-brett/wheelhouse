// scripts/jobs/weekly-main.js
// The process a session start runs, detached, when the weekly job is due. It exits 0
// whatever happens: nobody is waiting for it.
import { runWeekly } from './weekly.js';
import { startedAsScript } from '../lib/started-as-script.js';

export async function main({ run = runWeekly, fetch = globalThis.fetch, now = () => new Date() } = {}) {
  try {
    await run({ now: now(), fetch });
  } catch { /* the next session start tries again */ }
  return 0;
}

if (startedAsScript(import.meta.url)) {
  main().then((code) => process.exit(code), () => process.exit(0));
}
