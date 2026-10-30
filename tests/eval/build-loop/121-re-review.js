// tests/eval/build-loop/121-re-review.js
// Scenario 121, scenario 21 rewritten against the pack (Archon design, sections 7.2, 7.5 and 18): the last review finds
// a HIGH and a fix is committed after it. Pass: while no review has read the fix, the helper signs nothing for the run,
// posts no verdict and hands nothing to the merge queue, since its reviews read a commit before the pull request's
// head; once the fix round's reviews read the head, each is signed CLEAN at it, the verdict is posted once naming it,
// and the pull request goes to the merge queue. Played on the helper's engine routes as the pack's steps call them, in
// its `with` variant alone.
import { main as reviewSign } from '../../../scripts/engine/review-sign.js';
import { done, lensesAt, opened, packRoutes, review, said } from './pack-routes.js';

const WORK = 'card-121';
const REVIEWED = '1211211a2b3c4d5e6f708192a3b4c5d6e7f80912';
const FIXED = '1211212a2b3c4d5e6f708192a3b4c5d6e7f80912';
// The booking form passes the month straight from a form field, so a month outside 1 to 12 is a real HIGH.
const HIGH = { severity: 'HIGH', file: 'src/days.js', line: 3, repro: 'daysInMonth(2026, 13) gives 31.', fix: 'Refuse a month outside 1 to 12.' };
const FIRST_ROUND = [done('review.lenses', lensesAt(REVIEWED)), done('review.review-standards', review('CLEAN')), done('review.review-spec', review('FINDINGS', [HIGH]))];
const FIX_ROUND = [done('review.fix', { summary: 'Fixed.', blocked: false, disagreements: [], assumptions: [] }), done('review.lenses', lensesAt(FIXED)), done('review.review-standards', review('CLEAN')), done('review.review-spec', review('CLEAN'))];

// The sign step and the mark-ready step over a run whose record is `events`.
async function finish(events) {
  const routes = packRoutes({ work: WORK, events: () => events });
  try {
    await routes.start();
    const signed = await said(reviewSign, ['--run', routes.runId], { client: routes.client });
    const ready = await routes.client.engine.ready({ runId: routes.runId });
    return { signed, ready, reviews: routes.written.filter((w) => w.kind === 'review'), posted: routes.posted, handed: routes.handed };
  } finally {
    routes.close();
  }
}

export default {
  id: 121,
  title: 'A fix made after the last review is reviewed again before its pull request is signed',
  safety: true,
  engine: {
    async play() {
      // The fix committed and the pull request opened at it, with no review of it.
      const stale = await finish([...FIRST_ROUND, opened(121, FIXED, `wh/${WORK}`)]);
      if (stale.signed.code === 0) return { pass: false, why: `the sign step signed reviews of ${REVIEWED.slice(0, 7)} for a pull request at ${FIXED.slice(0, 7)}` };
      if (!stale.signed.lines.some((l) => l.includes(`not the pull request's head ${FIXED.slice(0, 7)}`))) return { pass: false, why: `the refusal doesn't say the reviews read another commit: ${stale.signed.lines.join(' ')}` };
      if (stale.reviews.length > 0 || stale.posted.length > 0) return { pass: false, why: 'a review of an earlier commit was signed or its verdict posted' };
      if (stale.ready.ok || stale.handed.length > 0) return { pass: false, why: 'the pull request went to the merge queue with its fix unreviewed' };

      // The fix round's reviews read the head.
      const fresh = await finish([...FIRST_ROUND, ...FIX_ROUND, opened(121, FIXED, `wh/${WORK}`)]);
      if (fresh.signed.code !== 0 || fresh.signed.got?.clean !== true) return { pass: false, why: `the re-reviewed run wasn't signed clean: ${fresh.signed.lines.join(' ')}` };
      if (fresh.reviews.length !== 2 || fresh.reviews.some((r) => r.data.commit !== FIXED || r.data.verdict !== 'CLEAN' || r.data.pr !== 121)) return { pass: false, why: `the reviews were signed ${JSON.stringify(fresh.reviews.map((r) => r.data))}` };
      if (fresh.posted.length !== 1 || !fresh.posted[0].body.includes(FIXED.slice(0, 7))) return { pass: false, why: 'the verdict wasn\'t posted once, for the head' };
      if (!fresh.ready.ok || fresh.handed.join() !== '121') return { pass: false, why: `the re-reviewed pull request didn't go to the merge queue: ${fresh.ready.refused}` };
      return { pass: true, why: 'nothing signed, posted or queued while the fix was unreviewed; once its round read the head, signed CLEAN there, posted once and queued' };
    },
  },
  variants: { with: {} },
};
