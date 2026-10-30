// tests/eval/build-loop/120-fix-rounds.js
// Scenario 120, scenario 20 rewritten against the pack (Archon design, sections 7.2, 7.5 and 18): a review finds a HIGH
// every round, however often it is fixed. Pass: the review loop's own count, read from Archon's record, closes the loop
// on its fourth review, after three fix rounds, with the finding still open, so no fourth fix round runs (in every lane
// with a review loop, the loop's cap is that count); the helper signs that review FINDINGS from the record and posts
// no verdict; and the held run comes to the director as one card that names the open finding, which nothing answers
// but their click. Played on the engine the run names, in its `with` variant alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { until } from '../../../scripts/eval/engine-world.js';
import { main as reviewRound } from '../../../scripts/engine/review-round.js';
import { main as reviewSign } from '../../../scripts/engine/review-sign.js';
import { done, lensesAt, opened, packRoutes, packWorkflows, review, said } from './pack-routes.js';
import { smallHeld, smallWork } from './engine-recordings.js';

const WORK = 'card-120';
const ROUNDS = 4;
const headOf = (round) => `120${round}`.padEnd(40, 'a');
// A real weakness each time, as the old scenario's exacting reviewer gave: the latest fix leaves one input open.
const HIGH = (round) => ({ severity: 'HIGH', file: 'src/chunk.js', line: 4 + round, repro: `chunk(items, ${-round}) loops for ever, and the nightly import loses its batch without a trace.`, fix: 'Refuse a size below 1.' });
const CLEAN = JSON.stringify(review('CLEAN'));
const fixed = JSON.stringify({ summary: 'Fixed.', blocked: false, disagreements: [], assumptions: [] });
const checked = JSON.stringify({ clean: true, findings: '' });
const controls = JSON.stringify({ clean: true, paths: '' });
// The card's run, filled in as the play learns what the sign step asks.
const run = [];

// The review loop's last step, round by round, as the pack runs it: the round before's count from its own output.
async function loop(artefacts) {
  const rounds = [];
  let before = { round: '', ran: '' };
  for (let round = 1; round <= ROUNDS + 1; round += 1) {
    const spec = JSON.stringify(review('FINDINGS', [HIGH(round)]));
    const argv = ['--artefacts', artefacts, '--most', String(ROUNDS), '--round-before', String(before.round), '--ran-before', before.ran,
      '--standards', CLEAN, '--spec', spec, '--security', '', '--design', '', '--fix', round > 1 ? fixed : '', '--tests', round > 1 ? checked : '', '--controls', round > 1 ? controls : ''];
    const { got } = await said(reviewRound, argv);
    rounds.push(got);
    if (got?.done) break;
    before = got;
  }
  return rounds;
}

// Archon's record of the run: each round's lenses at that round's head, a fix before every round but the first.
function record() {
  const events = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    if (round > 1) events.push(done('review.fix', fixed));
    events.push(done('review.lenses', lensesAt(headOf(round))), done('review.review-standards', CLEAN), done('review.review-spec', review('FINDINGS', [HIGH(round)])));
  }
  return [...events, opened(120, headOf(ROUNDS), `wh/${WORK}`)];
}

export default {
  id: 120,
  title: 'A review that still finds a HIGH after three fix rounds comes to the director as one card, with no fourth round',
  engine: {
    recordings: { [WORK]: run },
    async play(world) {
      run.length = 0;
      // Every lane with a review loop closes it on the count it gives its last step.
      const reviewLoops = packWorkflows().filter(({ nodes }) => nodes.some((n) => n.node.loop_group?.nodes.some((m) => m.id === 'verdict')));
      if (reviewLoops.length === 0) return { pass: false, why: 'no workflow has a review loop' };
      for (const { name, nodes } of reviewLoops) {
        const loops = nodes.filter((n) => n.node.loop_group?.nodes.some((m) => m.id === 'verdict'));
        for (const { node } of loops) {
          const verdict = node.loop_group.nodes.find((n) => n.id === 'verdict');
          const most = /--most (\d+)/.exec(verdict?.bash ?? '')?.[1];
          if (Number(most) !== ROUNDS || node.loop_group.max_iterations !== ROUNDS) return { pass: false, why: `${name}'s ${node.id} loop runs ${node.loop_group.max_iterations} rounds and counts ${most}, not ${ROUNDS}` };
        }
      }
      const artefacts = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-s120-'));
      let question;
      try {
        const rounds = await loop(artefacts);
        if (rounds.length !== ROUNDS) return { pass: false, why: `the loop closed after ${rounds.length} reviews, not ${ROUNDS}` };
        if (rounds.slice(0, -1).some((r) => r.done)) return { pass: false, why: 'the loop closed before its last round' };
        const last = rounds.at(-1);
        if (!last.last || !last.holds || last.held !== 'spec' || last.blocked) return { pass: false, why: `the last round closed as ${JSON.stringify(last)}` };

        const routes = packRoutes({ work: WORK, events: record });
        try {
          await routes.start();
          const signed = await said(reviewSign, ['--run', routes.runId], { client: routes.client });
          if (signed.code !== 0) return { pass: false, why: `the sign step failed: ${signed.lines.join(' ')}` };
          if (signed.got?.clean !== false) return { pass: false, why: 'the review that still holds was signed clean' };
          const spec = routes.written.find((w) => w.kind === 'review' && w.data.step === 'review-spec');
          if (spec?.data.verdict !== 'FINDINGS' || spec.data.commit !== headOf(ROUNDS)) return { pass: false, why: `the last round's review was signed ${JSON.stringify(spec?.data)}` };
          if (routes.posted.length > 0) return { pass: false, why: 'a verdict was posted over a HIGH' };
          question = signed.got.question;
        } finally {
          routes.close();
        }
      } finally {
        fs.rmSync(artefacts, { recursive: true, force: true });
      }
      if (!question?.includes(HIGH(ROUNDS).repro)) return { pass: false, why: `the held card wouldn't name the open finding: ${question}` };

      run.push(...smallHeld(WORK, { rounds: ROUNDS, question, pr: 120, head: headOf(ROUNDS) }));
      smallWork(world, { id: WORK, title: 'The nightly import\'s batches' });
      const card = await until(async () => { await world.tick(); return world.records('question')[0]; });
      if (!card) return { pass: false, why: 'no card came for the held review' };
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (world.records('question').length !== 1) return { pass: false, why: `${world.records('question').length} cards came for one held review` };
      if (!card.data.what.includes(HIGH(ROUNDS).repro)) return { pass: false, why: `the card doesn't name the open finding: ${card.data.what}` };
      if (card.data.level !== 3) return { pass: false, why: `the card is level ${card.data.level}` };
      if (world.acts().some((c) => c.action?.answer) || world.starts().length !== 1) return { pass: false, why: 'the held review was answered, or the work run again, before the director chose' };
      world.answer(card.data, card.data.recommendation);
      if (!await until(async () => { await world.tick(); return world.acts().find((c) => c.action?.answer); })) return { pass: false, why: 'the director\'s answer didn\'t reach the engine' };
      return { pass: true, why: 'the loop closed on its fourth review after three fixes, signed FINDINGS with nothing posted, and one card named the open finding until the director chose' };
    },
  },
  variants: { with: {} },
};
