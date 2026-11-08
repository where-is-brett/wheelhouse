// probes/haiku-trial/score/total.js
// The whole score, and the bar a run has to clear.
import { runHeldBack } from '../held-back/held-back.js';
import { runAcceptance } from '../acceptance.js';
import { reconcile } from './reconcile.js';
import { ownTests } from './own-tests.js';
import { a11y } from './a11y.js';
import { health } from './health.js';

export function passBar({ total, parts, heldBackShare, critical }) {
  const why = [];
  if (total < 80) why.push(`the total is ${total}, below 80`);
  if (parts.reconcile !== 15) why.push('the held-back statement does not reconcile to the cent');
  if (heldBackShare < 0.9) why.push(`the held-back checks passed ${Math.round(heldBackShare * 100)}%, below 90%`);
  if (critical) why.push('the accessibility check found a critical problem');
  return { pass: why.length === 0, why };
}

export async function scoreAll({ dir, baseSha, gh, browse, smoke = false, run, steps = {} }) {
  const impl = { reconcile, ownTests, runHeldBack, runAcceptance, a11y, health, ...steps };
  const parts = { heldBack: null, reconcile: null, acceptance: null, ownTests: null, a11y: null, health: null };
  const detail = {};

  detail.reconcile = await impl.reconcile({ dir });
  parts.reconcile = detail.reconcile.points;
  detail.ownTests = await impl.ownTests({ dir, baseSha, gh, ...(run ? { run } : {}) });
  parts.ownTests = detail.ownTests.points;

  if (smoke) {
    return { total: parts.reconcile + parts.ownTests, parts, pass: null, why: [], detail };
  }

  detail.heldBack = await impl.runHeldBack({ dir });
  parts.heldBack = Math.round(detail.heldBack.share * 40);
  detail.acceptance = await impl.runAcceptance({ dir });
  parts.acceptance = detail.acceptance.passed;
  detail.a11y = await impl.a11y({ dir, browse });
  parts.a11y = detail.a11y.points;
  detail.health = await impl.health({ dir, ...(run ? { run } : {}) });
  parts.health = detail.health.points;

  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const critical = Object.values(detail.a11y.pages ?? {}).some((p) => p.critical > 0);
  const bar = passBar({ total, parts, heldBackShare: detail.heldBack.share, critical });
  return { total, parts, pass: bar.pass, why: bar.why, detail };
}
