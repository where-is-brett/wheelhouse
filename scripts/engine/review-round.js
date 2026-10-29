// scripts/engine/review-round.js
// The small lane's review loop's last step each round (Archon design, section 7.2): which lenses held and whether any
// did, so the loop closes only when no BLOCKER or HIGH is left, and the next round fixes those and reruns standards,
// spec and the lenses that held. A lens holds on a BLOCKER or HIGH finding, on a verdict other than CLEAN (the helper
// signs only CLEAN), or when its output can't be read as a review. Standards and spec run every round, so an empty
// one holds too, while an empty security or design lens didn't run. A step's blocked exit, the fix step's first,
// ends the loop with its question.
// It prints { holds, held, blocked, question, options, recommend, level, topic }; `held` is the lenses that held,
// comma-joined, or `none`.
//   node scripts/engine/review-round.js --standards <output> --spec <output> --security <output> --design <output> --fix <output>
import { startedAsScript } from '../lib/started-as-script.js';

const LENSES = ['standards', 'spec', 'security', 'design'];
const ALWAYS = new Set(['standards', 'spec']);
const HOLDS = new Set(['BLOCKER', 'HIGH']);

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };
const isReview = (output) => output && ['CLEAN', 'FINDINGS'].includes(output.verdict) && Array.isArray(output.findings);

// Whether a lens's output holds the work back.
function holds(name, text) {
  if (!text) return ALWAYS.has(name);
  const output = parsed(text);
  if (!isReview(output)) return true;
  return output.verdict !== 'CLEAN' || output.findings.some((f) => HOLDS.has(f?.severity));
}

// The value after a flag, an empty one included (done-check's runArg reads an empty value as missing).
const valueOf = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && typeof argv[at + 1] === 'string' ? argv[at + 1] : '';
};

export async function main(argv = process.argv.slice(2), { out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  if (!argv.includes('--standards') || !argv.includes('--spec')) {
    out('usage: node scripts/engine/review-round.js --standards <output> --spec <output> --security <output> --design <output> --fix <output>');
    return 2;
  }
  const held = LENSES.filter((name) => holds(name, valueOf(argv, name)));
  const asking = ['fix', ...LENSES].map((name) => parsed(valueOf(argv, name))).find((output) => output?.blocked === true);
  const { question = '', options = [], recommend = '', level = '3', topic = '' } = asking ?? {};
  out(JSON.stringify({ holds: held.length > 0, held: held.length > 0 ? held.join(',') : 'none', blocked: Boolean(asking), question, options, recommend, level, topic }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
