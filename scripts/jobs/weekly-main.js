// scripts/jobs/weekly-main.js
// The process a session start runs, detached, when the weekly jobs are due. It exits 0
// whatever happens: nobody is waiting for it.
import { pathToFileURL } from 'node:url';
import { helperClient } from '../host/helper-client.js';
import { runWeekly } from './weekly.js';

// A backup or a profile sync can take a while on a large project.
const HELPER_TIMEOUT_MS = 2 * 60 * 1000;

export async function main({ run = runWeekly, client = helperClient({ timeout: HELPER_TIMEOUT_MS }), fetch = globalThis.fetch, now = () => new Date() } = {}) {
  try {
    await run({ now: now(), fetch, client });
  } catch { /* the next session start tries again */ }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), () => process.exit(0));
}
