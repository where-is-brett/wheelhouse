// tests/eval/build-loop/50-clash-rerun.js
// Scenario 50 (Archon design, sections 7.7 and 18): the merge gate sends a pull request back because it clashes with
// what was added before it. Pass: the dispatcher starts it again on its own branch, carrying on, to bring it up to
// date; a second clash brings one card (level 3) instead, and Try again starts it once more. Played on the
// dispatcher's runner over the engine the run names, in its `with` variant alone: the merge gate's signal comes with
// the merge path's check (E3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchRun, TRY_AGAIN } from '../../../scripts/engine/dispatch-run.js';

export default {
  id: 50,
  title: 'A clash is run again to bring it up to date, and a second clash comes as a card',
  engine: {
    async play(world) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-s50-'));
      try {
        const views = {
          work: { 'card-50': { work: { id: 'w-50', at: '2026-10-29T08:00:00.000Z', data: { id: 'card-50', title: 'The sale banner', lane: 'quick', visible: false, dependsOn: [] } }, approved: false, since: '2026-10-29T08:00:00.000Z' } },
          runs: { 'card-50': [{ at: '2026-10-29T09:00:00.000Z', data: { work: 'card-50', runId: 'run-1', lane: 'quick', state: 'ended', outcome: 'completed', branch: 'wh/card-50', pr: 50 } }] },
          questions: {},
        };
        const starts = [];
        const written = [];
        const d = dispatchRun({
          engine: world.engine, project: 'p', folder: dir, file: path.join(dir, 'dispatch.json'), readViews: () => views,
          start: async (args) => { starts.push(args); return { ok: true, runId: `run-${starts.length + 1}` }; },
          write: async (kind, data) => { written.push({ kind, data }); },
          now: () => new Date('2026-10-29T10:00:00.000Z'),
        });
        d.sentBack('card-50');
        await d.tick();
        if (starts.length !== 1 || starts[0].carryOn !== true || starts[0].branch !== 'wh/card-50') return { pass: false, why: 'the first clash wasn\'t run again on its own branch, carrying on' };
        await d.tick();
        if (starts.length !== 1) return { pass: false, why: 'the clash was run again twice' };
        d.sentBack('card-50');
        await d.tick();
        const card = written.find((w) => w.kind === 'question');
        if (!card || card.data.level !== 3) return { pass: false, why: 'the second clash brought no level-3 card' };
        if (starts.length !== 1) return { pass: false, why: 'the second clash was run again without the director' };
        views.questions[card.data.id] = { question: { data: card.data }, answer: { label: TRY_AGAIN } };
        await d.tick();
        if (starts.length !== 2 || starts[1].carryOn !== true) return { pass: false, why: 'Try again didn\'t start it once more' };
        return { pass: true, why: 'run again on its branch after one clash; a card after the second; Try again started it' };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  variants: { with: {} },
};
