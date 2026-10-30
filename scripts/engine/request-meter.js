// scripts/engine/request-meter.js
// The month's counted requests for one account (Archon design, section 10.1). A plan's allowance belongs to the account,
// not to a project, so the meter keeps one file for the account and adds up every project that counts requests on it:
// two projects on one account share one count against each project's cap.
import fs from 'node:fs';
import path from 'node:path';
import { countedRequests, runCost } from './spend.js';

// What `projects` ([{ costs(), going() }]) have counted in `month` ('YYYY-MM'): each cost record of the month, and each
// run that hasn't ended, from `inspect(runId)`, the engine's record of it, since it has no cost record yet. A run that
// can't be read counts as an unknown one, never as nothing.
export async function requestsThisMonth({ projects = [], month, inspect }) {
  let total = 0;
  for (const project of projects) {
    for (const cost of project.costs()) if (String(cost?.at).startsWith(month)) total += countedRequests(cost.data);
    for (const runId of project.going()) {
      let record = null;
      try { record = await inspect(runId); } catch { /* counted as unknown below */ }
      total += countedRequests(runCost(record ?? { status: 'unknown' }));
    }
  }
  return total;
}

// One account's meter, kept in `file`. `look({ kept, estimate })` is the engine's own check (its checkRequests) and
// `note(words)` a Logbook line. used() gives the month's count; looks run one at a time, so two projects' ticks read
// the provider's figure once and say a difference once. A look that fails gives the estimate.
export function requestMeter({ file, look, estimate, note = async () => {} }) {
  let queue = Promise.resolve();
  async function once() {
    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* the first check */ }
    try {
      const got = await look({ kept, estimate });
      if (JSON.stringify(got.kept) !== JSON.stringify(kept)) {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(got.kept, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temporary, file);
        if (got.line) await Promise.resolve(note(got.line)).catch(() => {});
      }
      return got.used;
    } catch {
      return estimate();
    }
  }
  return {
    used() {
      const next = queue.then(once, once);
      queue = next.catch(() => {});
      return next;
    },
  };
}
