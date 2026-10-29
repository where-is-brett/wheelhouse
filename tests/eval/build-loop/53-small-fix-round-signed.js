// tests/eval/build-loop/53-small-fix-round-signed.js
// Scenario 53 (Archon design, sections 7.2, 7.5 and 18): a small-lane run's first review round finds a HIGH, its fix
// round commits a fix and the lenses read again, clean. Archon names a loop's steps once a round, so the run's record
// holds both rounds. Pass: the helper signs each lens from the last round, at the head that round read and the pull
// request has, and posts the verdict once all are CLEAN; a record that stops after the first round is signed FINDINGS
// and posts nothing. Played on the engine's routes as the run's steps call them, in its `with` variant alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { readOutputs } from '../../../scripts/engine/archon/record.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';

const FIRST = '5353535a2b3c4d5e6f708192a3b4c5d6e7f80912';
const FIXED = '5353535b2b3c4d5e6f708192a3b4c5d6e7f80912';
const DIGEST = 'd'.repeat(64);
const review = (verdict, findings = []) => JSON.stringify({ verdict, findings, summary: 'Read it.', blocked: false, assumptions: [] });
const HIGH = [{ severity: 'HIGH', file: 'src/orders.js', line: 12, repro: 'r', fix: 'f' }];
const done = (step, output) => ({ event_type: 'node_completed', step_name: step, data: { node_output: output } });
const lenses = (head) => JSON.stringify({ security: false, design: false, head, clean: true });

const ROUND_ONE = [
  done('review.lenses', lenses(FIRST)),
  done('review.review-standards', review('CLEAN')),
  done('review.review-spec', review('FINDINGS', HIGH)),
  done('review.verdict', JSON.stringify({ holds: true, held: 'spec', done: false })),
];
const ROUND_TWO = [
  done('review.fix', JSON.stringify({ blocked: false, disagreements: [] })),
  done('review.lenses', lenses(FIXED)),
  done('review.review-standards', review('CLEAN')),
  done('review.review-spec', review('CLEAN')),
  done('review.verdict', JSON.stringify({ holds: false, held: 'none', done: true })),
];

// The routes over a run whose record is `events`, with its pull request opened at `head`.
async function signed(dir, runId, events, head) {
  const posted = [];
  const engine = {
    name: 'archon',
    artefactsOf: (id) => path.join(dir, 'art', id),
    start: async () => ({ ok: true, runId, branch: 'wh/card-53' }),
    inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
    outputs: async () => readOutputs({ events: [...events, done('open-pr', JSON.stringify({ branch: 'wh/card-53', pr: 53, head }))] }),
  };
  const made = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, runId, 'orders'),
    filesDir: () => path.join(dir, runId, 'engine'),
    write: async () => {},
    digests: { installed: () => DIGEST, captured: (root) => (root === path.join(dir, 'capture') ? DIGEST : null) },
    comment: async (project, c) => { posted.push(c); return { id: 1 }; },
  });
  const { routes } = ticketedRoutes(made, engine, undefined);
  await routes['/engine/start']({ project: 'p', order: workOrder({ work: { id: 'card-53', lane: 'small', goal: 'A goal', done: [{ test: 'x' }] } }) });
  const standards = await routes['/engine/review']({ runId, step: 'review-standards' });
  const spec = await routes['/engine/review']({ runId, step: 'review-spec' });
  return { verdicts: [standards?.verdict, spec?.verdict], refused: standards?.refused ?? spec?.refused, posted };
}

export default {
  id: 53,
  title: 'A small-lane run\'s fix round is signed from its last review round',
  safety: true,
  engine: {
    async play() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-s53-'));
      try {
        const fixed = await signed(dir, 'run-53', [...ROUND_ONE, ...ROUND_TWO], FIXED);
        if (fixed.refused) return { pass: false, why: `the fixed run's reviews weren't signed: ${fixed.refused}` };
        if (fixed.verdicts.join() !== 'CLEAN,CLEAN') return { pass: false, why: `the fixed run was signed ${fixed.verdicts.join(' and ')}, not from its last round` };
        if (fixed.posted.length !== 1 || !fixed.posted[0].body.includes(FIXED.slice(0, 7))) return { pass: false, why: 'the verdict wasn\'t posted once, for the fixed head' };
        const first = await signed(dir, 'run-53b', ROUND_ONE, FIRST);
        if (first.verdicts[1] !== 'FINDINGS') return { pass: false, why: `the first round's HIGH was signed ${first.verdicts[1] ?? first.refused}` };
        if (first.posted.length > 0) return { pass: false, why: 'a verdict was posted over a HIGH' };
        return { pass: true, why: 'signed CLEAN from the fix round at its head, posted once; the first round alone signed FINDINGS' };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  variants: { with: {} },
};
