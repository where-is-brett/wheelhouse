// tests/eval/build-loop/123-finish-opens-pr.js
// Scenario 123, scenario 23 rewritten against the pack (Archon design, sections 7.2, 7.5, 12.4 and 18): a run finishes
// its branch. Pass: every lane that builds work ends on its pull-request step, which hands the branch to the helper,
// and no step of those lanes merges (fix-main's merge goes through the helper's own gate, scenarios 60 to 62); the step
// pushes the run's own branch and opens one pull request through the helper, which merges nothing and, once the
// reviews are signed CLEAN, hands it to the merge queue; and a run that finishes, not shown first, asks the director
// nothing. Played on the helper's engine routes as the pack's steps call them, and on the engine the run names, in its
// `with` variant alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { until } from '../../../scripts/eval/engine-world.js';
import { main as openPr } from '../../../scripts/engine/open-pr.js';
import { main as reviewSign } from '../../../scripts/engine/review-sign.js';
import { done, lensesAt, packRoutes, packWorkflows, review, said } from './pack-routes.js';
import { quickRun } from './engine-recordings.js';

const WORK = 'card-123';
const HEAD = '1231231a2b3c4d5e6f708192a3b4c5d6e7f80912';
const BUILDING = ['wheelhouse-quick', 'wheelhouse-small', 'wheelhouse-bug', 'wheelhouse-slice', 'wheelhouse-feature'];
// What in a step's command would merge: git's own, the code host's tool, or the helper's fix-main gate.
const MERGES = /\bgit\b[^|;&]*\bmerge\b(?!-base)|\bgh\b[^|;&]*\bpr\s+merge\b|merge-fix\.js/;

export default {
  id: 123,
  title: 'A finished run opens one pull request through the helper and merges nothing',
  engine: {
    recordings: { 'card-123q': quickRun('card-123q', { pr: 1231 }) },
    async play(world) {
      const flows = packWorkflows();
      for (const name of BUILDING) {
        const flow = flows.find((f) => f.name === name);
        if (!flow) return { pass: false, why: `the pack has no ${name}` };
        if (flow.workflow.returns !== 'open-pr') return { pass: false, why: `${name} doesn't end on its pull-request step` };
        const prSteps = flow.nodes.filter((n) => /scripts\/engine\/open-pr\.js/.test(n.node.bash ?? ''));
        if (prSteps.length !== 1) return { pass: false, why: `${name} has ${prSteps.length} pull-request steps` };
        const merging = flow.nodes.find((n) => MERGES.test(n.node.bash ?? ''));
        if (merging) return { pass: false, why: `${name}'s ${merging.node.id} merges` };
      }

      const pushes = [];
      const opens = [];
      const host = {
        push: async (project, { dir }) => { pushes.push(dir); return { ok: true, branch: `wh/${WORK}` }; },
        open: async (project, { branch }) => { opens.push(branch); return { pr: 123, head: HEAD }; },
        repo: () => 'o/p',
      };
      const events = [done('lenses', lensesAt(HEAD)), done('review-standards', review('CLEAN')), done('review-spec', review('CLEAN'))];
      const routes = packRoutes({ work: WORK, lane: 'quick', events: () => events, host });
      const art = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-s123-'));
      try {
        await routes.start();
        fs.writeFileSync(path.join(art, 'pr-title.txt'), 'Greet the customer by name\n');
        fs.writeFileSync(path.join(art, 'pr-body.md'), 'What changed and how it was checked.\n');
        const worktree = path.join(art, 'worktree');
        const got = await said(openPr, ['--run', routes.runId, '--base', 'main', '--dir', art], { client: routes.client, cwd: worktree });
        if (got.code !== 0 || got.got?.pr !== 123 || got.got.head !== HEAD) return { pass: false, why: `the pull-request step said ${got.lines.join(' ')}` };
        if (pushes.join() !== worktree || opens.join() !== `wh/${WORK}`) return { pass: false, why: `the helper pushed ${pushes.length} times and opened ${opens.length} pull requests, not the run's own branch once` };
        events.push(done('open-pr', got.got));
        const signed = await said(reviewSign, ['--run', routes.runId], { client: routes.client });
        if (signed.got?.clean !== true) return { pass: false, why: `the reviews weren't signed clean: ${signed.lines.join(' ')}` };
        const ready = await routes.client.engine.ready({ runId: routes.runId });
        if (!ready.ok || routes.handed.join() !== '123') return { pass: false, why: `the pull request didn't go to the merge queue: ${ready.refused}` };
        if (opens.length !== 1) return { pass: false, why: `${opens.length} pull requests were opened` };
      } finally {
        fs.rmSync(art, { recursive: true, force: true });
        routes.close();
      }

      world.put('work', { id: 'card-123q', title: 'Greet the customer by name', lane: 'quick', visible: false, dependsOn: [] });
      const asked = () => world.records('question').length > 0 || world.records('card').length > 0;
      const ended = () => world.views().runs?.['card-123q']?.find((r) => r.data.state === 'ended');
      await until(async () => { await world.tick(); return asked() || ended(); });
      for (let i = 0; i < 3; i += 1) await world.tick();
      if (!asked() && !ended()) return { pass: false, why: 'the run didn\'t end' };
      if (asked()) return { pass: false, why: 'a finished run that isn\'t shown first asked the director something' };
      return { pass: true, why: 'every building lane ends on its pull-request step and none merges; one push and one pull request through the helper, handed to the merge queue unmerged; no card' };
    },
  },
  variants: { with: {} },
};
