// scripts/engine/order-copy.js
// Every lane's first step (Archon design, section 7.4): asks the helper for the run's work order and writes it to the
// run's artefacts as order.json, for the steps to read. It prints none of the order, since a step's output goes into
// Archon's database and the director's words never do. The copy is for reading only: nothing that guards reads it.
// With --flags it prints only { visible, showFirst }, two yes-or-no answers the pack branches on. With --feature-flags,
// for a feature's slices and its own run, it adds { demo, flagFile, topic, words }: whether this slice is the midpoint
// demo, whether the switch is kept in a file, and the topic and words of the approval the run ends on.
//   node scripts/engine/order-copy.js --run <run id> --out <artefacts folder> [--flags | --feature-flags]
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { withTicket } from './ticket.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { runArg } from './done-check.js';

// The approval a run ends on: the switch-on of a feature, the midpoint demo of a slice, or work shown first.
export const APPROVAL_WORDS = Object.freeze({
  'switch-on': 'Every slice of this feature is added, behind its switch. Approve it to switch it on for everyone, or reject it to leave it off.',
  'midpoint-demo': 'This slice is half way through the feature. Approve it to carry on with the next slices, or reject it to stop and change course.',
  'shown-first': 'This change is shown to you first. Approve it to send it to the merge queue, or reject it.',
});
export function approvalOf(order) {
  if (order.lane === 'feature') return 'switch-on';
  return order.demo === true ? 'midpoint-demo' : 'shown-first';
}

export async function main(argv = process.argv.slice(2), { client: given = helperClient({ timeout: 30000 }), out = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const client = withTicket(given, argv);
  const runId = runArg(argv);
  const dir = runArg(argv, '--out');
  if (!runId || !dir || !path.isAbsolute(dir)) {
    out('usage: node scripts/engine/order-copy.js --run <run id> --out <artefacts folder>');
    return 2;
  }
  const answer = await client.engine.order({ runId });
  if (answer?.ok !== true || !answer.order) {
    out(`The helper gave no work order for this run: ${answer?.refused ?? 'no answer'}`);
    return 1;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'order.json'), `${JSON.stringify(answer.order, null, 2)}\n`);
  const { order } = answer;
  if (argv.includes('--feature-flags')) {
    const topic = approvalOf(order);
    out(JSON.stringify({ visible: order.preview !== null, showFirst: order.showFirst === true, demo: order.demo === true, flagFile: typeof order.flag?.file === 'string', topic, words: APPROVAL_WORDS[topic] }));
  } else if (argv.includes('--flags')) out(JSON.stringify({ visible: order.preview !== null, showFirst: order.showFirst === true }));
  else out(`The work order is in order.json, with ${answer.order.done.length} done checks.`);
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
