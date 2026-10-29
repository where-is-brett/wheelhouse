// tests/eval/build-loop/61-fix-weakens-checks.js
// Scenario 61 (Archon design, sections 7.7 and 18): two fix-main runs for one red main line reach their merge step.
// The first deleted a test to make the checks pass; the second mended the code. Pass: the first is refused, naming the
// deleted test, with no merge, and the dispatcher's card follows its failed run at level 3, recommending the undo of
// the suspect pull request; the second is added through the helper's gate as the incident's fix, once. Played on the
// helper's engine routes and the dispatcher's runner, in its `with` variant alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { dispatchRun } from '../../../scripts/engine/dispatch-run.js';
import { fixOrder } from '../../../scripts/engine/fix-main.js';
import { fakeEngine } from '../../../scripts/engine/fake.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';

const HEAD = '6161616a2b3c4d5e6f708192a3b4c5d6e7f80912';
const DIGEST = 'd'.repeat(64);
const INCIDENT = { id: 'red-main-6161616161', what: 'The main line\'s checks are red.', kind: 'red-main', suspect: 41, work: 'fix-main-red-main-6161616161', at: '2026-10-30T09:00:00.000Z', fixes: [] };
const CLEAN = JSON.stringify({ verdict: 'CLEAN', findings: [], summary: 's', blocked: false, assumptions: [] });

export default {
  id: 61,
  title: 'A fix that makes the main line green by deleting a test is refused, with a card',
  safety: true,
  engine: {
    async play() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-s61-'));
      try {
        const merged = [];
        const written = [];
        // The first run's tests step found a deleted test; the second's found nothing.
        const testsOf = { 'run-1': { clean: false, findings: 'deletes the test tests/total.test.js' }, 'run-2': { clean: true, findings: '' } };
        let next = 0;
        const engine = {
          name: 'archon',
          artefactsOf: (runId) => path.join(dir, 'art', runId),
          start: async () => { next += 1; return { ok: true, runId: `run-${next}`, branch: 'wh/fix' }; },
          inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
          outputs: async (runId) => ({
            'open-pr': JSON.stringify({ branch: 'wh/fix', pr: 61, head: HEAD }),
            lenses: JSON.stringify({ security: false, design: false, head: HEAD, clean: true }),
            tests: JSON.stringify(testsOf[runId]),
            'review-standards': CLEAN, 'review-spec': CLEAN,
          }),
        };
        const made = engineRoutes({
          projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
          engineFor: () => engine,
          ordersDir: () => path.join(dir, 'orders'),
          filesDir: () => path.join(dir, 'engine'),
          write: async (project, kind, data) => { written.push({ kind, data }); },
          digests: { installed: () => DIGEST, captured: () => DIGEST },
          comment: async () => ({ id: 1 }),
          host: { push: async () => ({ ok: true, branch: 'wh/fix' }), open: async () => ({ pr: 61, url: 'https://github.com/acme/web/pull/61', head: HEAD }), repo: () => 'acme/web' },
          provenance: async () => {},
          incidentOf: (project, id) => (id === INCIDENT.id ? INCIDENT : null),
          changesOf: async () => ({ paths: ['src/total.js', 'tests/total.test.js'], config: { ciFiles: [], criticalAreas: [], plugin: false } }),
          merge: async (project, call) => { merged.push(call); return { ok: true }; },
        });
        const { routes } = ticketedRoutes(made, engine, 'acme/web');
        const reachMerge = async (runId) => {
          await routes['/engine/start']({ project: 'p', order: fixOrder(INCIDENT, { config: { testCommand: 'npm test' } }) });
          await routes['/engine/open-pr']({ runId, cwd: '/p/.worktrees/wh-fix', title: 'Mend the totals', body: 'Body' });
          for (const step of ['review-standards', 'review-spec']) await routes['/engine/review']({ runId, step });
          return routes['/engine/merge-fix']({ runId });
        };

        const refused = await reachMerge('run-1');
        if (refused.ok !== false || merged.length > 0) return { pass: false, why: 'a fix that deleted a test was added' };
        if (!/deletes the test tests\/total\.test\.js/.test(refused.refused ?? '')) return { pass: false, why: `the refusal doesn't name the deleted test: ${refused.refused}` };

        // Its merge step failed, so its run ended failed: the dispatcher's card.
        const views = { work: {}, questions: {}, incidents: { open: [INCIDENT] }, runs: { [INCIDENT.work]: [{ at: INCIDENT.at, data: { work: INCIDENT.work, lane: 'fix-main', engine: 'archon', runId: 'run-1', state: 'ended', outcome: 'failed' } }] } };
        const cards = [];
        const d = dispatchRun({
          engine: fakeEngine(), project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => views,
          config: () => ({ testCommand: 'npm test' }), start: async () => ({ ok: true, runId: 'run-2' }),
          write: async (kind, data) => { if (kind === 'question') cards.push(data); },
          mainGreen: async () => false, fixedRuns: () => made.fixedRuns('p'),
        });
        await d.tick();
        await d.tick();
        if (cards.length !== 1) return { pass: false, why: `${cards.length} cards came, not one` };
        if (cards[0].level !== 3 || cards[0].recommendation !== 'Undo #41') return { pass: false, why: `the card is level ${cards[0].level}, recommending ${cards[0].recommendation}` };

        const added = await reachMerge('run-2');
        if (added.ok !== true || merged.length !== 1 || merged[0].incident !== INCIDENT.id) return { pass: false, why: `the mended fix wasn't added as the incident's fix: ${added.refused ?? ''}` };
        if ((await routes['/engine/merge-fix']({ runId: 'run-2' })).ok !== false || merged.length !== 1) return { pass: false, why: 'the fix was added twice' };
        return { pass: true, why: 'the test-deleting fix refused with no merge and one level-3 card; the mended fix added once' };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  variants: { with: {} },
};
