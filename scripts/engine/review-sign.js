// scripts/engine/review-sign.js
// The pack's step after its pull request is open (Archon design, section 7.5): asks the helper to sign each review
// step from Archon's own record. The helper posts the merge queue's verdict once every lens that ran is CLEAN; no step
// posts one. It prints { clean } and exits 0, for the pack to branch on; a refusal (another pack, a run the helper
// didn't start) prints the reason and exits 1, so the run fails rather than carries on. Not clean, it also prints
// `question`, which the pack's `review-held` card asks: what the reviews found that holds the work, as the helper signed it.
//   node scripts/engine/review-sign.js --run <run id>
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';
import { REVIEW_STEPS } from './routes.js';

export const HELD = 'A review found a BLOCKER or HIGH problem in this change, so it is not marked ready.';
const MOST_NAMED = 3;
const REPRO_CHARS = 200;

// The held card's question: the plain line, then up to three of the findings that hold the work, lens by lens.
function heldQuestion(found) {
  const all = found.flatMap(({ lens, held }) => held.map((f) => ({ lens, ...f })));
  if (all.length === 0) return HELD;
  const named = all.slice(0, MOST_NAMED);
  const said = [...new Set(named.map((f) => f.lens))].map((lens) => {
    const items = named.filter((f) => f.lens === lens).map((f) => {
      const where = [f.file, Number.isInteger(f.line) ? `line ${f.line}` : null].filter(Boolean).join(', ');
      const repro = typeof f.repro === 'string' ? f.repro.trim().slice(0, REPRO_CHARS) : '';
      return `${f.severity}${where ? ` in ${where}` : ''}${repro ? `: ${repro}` : ''}`;
    });
    const sentence = `The ${lens} review found: ${items.join('; ')}`;
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
  });
  const more = all.length - named.length;
  return [HELD, ...said, ...(more > 0 ? [`And ${more} more.`] : [])].join(' ');
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 60000 }), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  if (!runId) {
    out('usage: node scripts/engine/review-sign.js --run <run id>');
    return 2;
  }
  let clean = true;
  let posted = false;
  let ran = 0;
  const found = [];
  for (const step of REVIEW_STEPS) {
    const got = await client.engine.review({ runId, step });
    if (got?.ok !== true) {
      out(`The helper didn't sign ${step}: ${got?.refused ?? 'no answer'}`);
      return 1;
    }
    if (!got.ran) continue;
    ran += 1;
    if (got.verdict !== 'CLEAN') clean = false;
    posted = got.posted === true;
    if (Array.isArray(got.held) && got.held.length > 0) found.push({ lens: step.replace(/^review-/, ''), held: got.held });
  }
  const ready = clean && ran > 0 && posted;
  out(JSON.stringify(ready ? { clean: true } : { clean: false, question: heldQuestion(found) }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
