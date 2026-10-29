// scripts/engine/review-round.js
// The small lane's review loop's last step each round (Archon design, section 7.2): which lenses held and whether any
// did, so the loop closes only when no BLOCKER or HIGH is left, and the next round fixes those and reruns standards,
// spec, the lenses that held and any lens that applies and hasn't run yet. A lens holds on a BLOCKER or HIGH finding,
// on a verdict other than CLEAN (the helper signs only CLEAN), or when its output can't be read as a review. Standards
// and spec run every round, so an empty one holds too, while an empty security or design lens didn't run. A step's
// blocked exit, the fix step's first, ends the loop with its question. A fix round whose change deletes, skips or
// loosens a test or changes a file that steers agents ends it with that question, before any other (`--tests` and
// `--controls`: the protected-tests and control checks after the fix). Archon fails a loop that runs out of rounds,
// so this step counts them, from the round before's own output in Archon's record (`--round-before`, `--ran-before`),
// never from a file an agent could write, and closes the loop on the last (`--most`), leaving a review that still
// holds to the signing, which raises the card. A feature's own run adds the whole-feature lens (`--feature`). It leaves the round's findings from the lenses that held in review-findings.json, for the fix step.
// It prints { holds, held, ran, blocked, question, options, recommend, level, topic, round, last, done }; `held` is
// the lenses that held, comma-joined, or `none`; `ran` every lens that has run in any round; `done` closes the loop.
//   node scripts/engine/review-round.js --artefacts <folder> --most <n> --round-before <n> --ran-before <lens,lens>
//     --standards <output> --spec <output> --security <output> --design <output> [--feature <output>] --fix <output>
//     --tests <output> --controls <output>
import fs from 'node:fs';
import path from 'node:path';
import { startedAsScript } from '../lib/started-as-script.js';

export const FINDINGS_FILE = 'review-findings.json';

const LENSES = ['standards', 'spec', 'security', 'design', 'feature'];
const ALWAYS = new Set(['standards', 'spec']);
const HOLDS = new Set(['BLOCKER', 'HIGH']);

// The question a fix round's change to the tests or the agents' files stops on, as the lane's `held` wait asks it.
const CHECKS_HELD = {
  question: 'The fix deletes, skips or loosens a test, or changes a file that steers agents, so it stops here.',
  options: [{ id: 'stop', label: 'Stop this work' }, { id: 'rework', label: 'Send it back for a fresh run' }],
  recommend: 'stop',
  level: '3',
  topic: 'tests-or-agent-files',
};
const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };
const isReview = (output) => output && ['CLEAN', 'FINDINGS'].includes(output.verdict) && Array.isArray(output.findings);

// Whether a lens's output holds the work back.
function holds(name, text) {
  if (!text) return ALWAYS.has(name);
  const output = parsed(text);
  if (!isReview(output)) return true;
  return output.verdict !== 'CLEAN' || output.findings.some((f) => HOLDS.has(f?.severity));
}

// Whether one review's output holds the work back: a BLOCKER or HIGH, a verdict other than CLEAN, or no review at all.
export const reviewHolds = (text) => holds('standards', text);

// The value after a flag, an empty one included (done-check's runArg reads an empty value as missing).
const valueOf = (argv, name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && typeof argv[at + 1] === 'string' ? argv[at + 1] : '';
};

export async function main(argv = process.argv.slice(2), { out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const artefacts = valueOf(argv, 'artefacts');
  const most = Number(valueOf(argv, 'most'));
  if (!argv.includes('--standards') || !argv.includes('--spec') || !path.isAbsolute(artefacts) || !(Number.isInteger(most) && most >= 1)) {
    out('usage: node scripts/engine/review-round.js --artefacts <folder> --most <n> --round-before <n> --ran-before <lens,lens> --standards <output> --spec <output> --security <output> --design <output> --fix <output> --tests <output> --controls <output>');
    return 2;
  }
  const held = LENSES.filter((name) => holds(name, valueOf(argv, name)));
  const before = Number(valueOf(argv, 'round-before'));
  const round = Number.isInteger(before) && before >= 1 && valueOf(argv, 'round-before') !== '' ? before + 1 : 1;
  const ranBefore = valueOf(argv, 'ran-before').split(',').map((name) => name.trim());
  const ran = LENSES.filter((name) => ranBefore.includes(name) || valueOf(argv, name) !== '');
  // After a fix (any round but the first), its change is checked again; an output that can't be read stops it too.
  const checked = (name) => parsed(valueOf(argv, name))?.clean === true;
  const fixHeld = round > 1 && (!checked('tests') || !checked('controls'));
  const asking = fixHeld ? CHECKS_HELD : ['fix', ...LENSES].map((name) => parsed(valueOf(argv, name))).find((output) => output?.blocked === true) ?? null;
  const { question = '', options = [], recommend = '', level = '3', topic = '' } = asking ?? {};
  const findings = Object.fromEntries(held.map((name) => [name, parsed(valueOf(argv, name))?.findings ?? []]));
  fs.writeFileSync(path.join(artefacts, FINDINGS_FILE), `${JSON.stringify({ round, held, findings }, null, 2)}\n`);
  const last = round >= most;
  out(JSON.stringify({
    holds: held.length > 0, held: held.length > 0 ? held.join(',') : 'none', ran: ran.join(','), blocked: Boolean(asking), question, options, recommend, level, topic,
    round, last, done: held.length === 0 || Boolean(asking) || last,
  }));
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
