// tests/scripts/host/helper-engine-review.test.js
// Reviews signed from Archon's record (Archon design, section 7.5): the helper reads a review step's output from the
// engine, never from a file an agent could write, checks the run's pack is the installed one and the step is a review
// step, signs a review event for the pull request's head, and posts the merge queue's verdict comment only once every
// lens that ran is CLEAN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engineRoutes, verdictBody, REVIEW_STEPS } from '../../../scripts/engine/routes.js';
import { ticketedRoutes } from '../../helpers/engine-tickets.js';
import { workOrder } from '../../../scripts/engine/order.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = '1111111a2b3c4d5e6f708192a3b4c5d6e7f80912';
const DIGEST = 'd'.repeat(64);
const review = (verdict, findings = []) => JSON.stringify({ verdict, findings, summary: 'Read it.', blocked: false, assumptions: [] });
const finding = (severity) => ({ severity, file: 'src/a.js', line: 3, repro: 'r', fix: 'f' });

function setup({ outputs = {}, captured = DIGEST } = {}) {
  const dir = tempFolder('wh-rev-');
  const written = [];
  const comments = [];
  const engine = {
    name: 'archon',
    artefactsOf: (runId) => path.join(dir, 'art', runId),
    start: async () => ({ ok: true, runId: 'run-1', branch: 'wh/card-1' }),
    inspect: async () => ({ status: 'running', source: path.join(dir, 'capture') }),
    outputs: async () => ({ 'open-pr': JSON.stringify({ branch: 'wh/card-1', pr: 14, head: HEAD }), lenses: JSON.stringify({ security: false, design: false, head: HEAD, clean: true }), ...outputs }),
  };
  const { routes } = ticketedRoutes(engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }],
    engineFor: () => engine,
    ordersDir: () => path.join(dir, 'orders'),
    filesDir: () => path.join(dir, 'engine'),
    write: async (project, kind, data) => { written.push({ project, kind, data }); },
    digests: { installed: () => DIGEST, captured: (root) => (root === path.join(dir, 'capture') ? captured : null) },
    comment: async (project, args) => { comments.push(args); return { id: 900 + comments.length }; },
  }), engine, undefined);
  const order = workOrder({ work: { id: 'card-1', lane: 'quick', goal: 'A goal', done: [{ test: 'x' }] } });
  return { dir, routes, written, comments, engine, ready: () => routes['/engine/start']({ project: 'p', order }) };
}

test('a review is signed from the run\'s record', async () => {
  const { routes, written, ready } = setup({ outputs: { 'review-spec': review('CLEAN') } });
  await ready();
  const got = await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.equal(got.ok, true);
  assert.equal(got.verdict, 'CLEAN');
  const signed = written.find((w) => w.kind === 'review');
  assert.deepEqual(signed.data, { pr: 14, commit: HEAD, verdict: 'CLEAN', findings: 0, engine: 'archon', runId: 'run-1', step: 'review-spec', digest: DIGEST });
});

test('a run with another digest is refused', async () => {
  const { routes, written, ready } = setup({ outputs: { 'review-spec': review('CLEAN') }, captured: 'e'.repeat(64) });
  await ready();
  const got = await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.equal(got.ok, false);
  assert.match(got.refused, /isn't the installed pack/);
  assert.equal(written.filter((w) => w.kind === 'review').length, 0);
});

test('a step that isn\'t a review step is refused, and so is a run the helper didn\'t start', async () => {
  const { routes, ready } = setup({ outputs: { lesson: review('CLEAN') } });
  await ready();
  assert.match((await routes['/engine/review']({ runId: 'run-1', step: 'lesson' })).refused, /isn't one of the pack's review steps/);
  assert.match((await routes['/engine/review']({ runId: 'run-9', step: 'review-spec' })).refused, /no work order/);
});

test('a review planted in the artefacts is not read', async () => {
  const { dir, routes, ready } = setup({ outputs: { 'review-spec': review('FINDINGS', [finding('HIGH')]) } });
  await ready();
  fs.mkdirSync(path.join(dir, 'artefacts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'artefacts', 'review-spec.json'), review('CLEAN'));
  assert.equal((await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' })).verdict, 'FINDINGS');
});

test('the verdict comment is posted only when every lens that ran is CLEAN, and edited in place after', async () => {
  const { routes, comments, ready, engine } = setup({ outputs: { 'review-standards': review('CLEAN'), 'review-spec': review('CLEAN', [finding('LOW')]) } });
  await ready();
  const first = await routes['/engine/review']({ runId: 'run-1', step: 'review-standards' });
  assert.equal(first.posted, false, 'the spec lens ran and isn\'t signed yet');
  assert.equal(comments.length, 0);
  const second = await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.equal(second.posted, true);
  assert.deepEqual(comments, [{ number: 14, id: undefined, body: verdictBody({ head: HEAD, steps: ['review-standards', 'review-spec'] }) }]);
  assert.match(comments[0].body, /^<!-- archon-review-report -->\nReviewed commit: `1111111a2b3c4d5e6f708192a3b4c5d6e7f80912`\nVerdict: ready\nContract: complete\n\n/);
  // A lens that didn't run is said so, and signs nothing.
  assert.deepEqual(await routes['/engine/review']({ runId: 'run-1', step: 'review-security' }), { ok: true, ran: false });
  // A new head edits the kept comment.
  const newHead = '2222222a2b3c4d5e6f708192a3b4c5d6e7f80912';
  const older = await engine.outputs();
  engine.outputs = async () => ({ ...older, 'open-pr': JSON.stringify({ branch: 'wh/card-1', pr: 14, head: newHead }), lenses: JSON.stringify({ security: false, design: false, head: newHead, clean: true }) });
  await routes['/engine/review']({ runId: 'run-1', step: 'review-standards' });
  await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.equal(comments.length, 2);
  assert.equal(comments[1].id, 901);
  assert.match(comments[1].body, new RegExp(newHead));
});

test('a HIGH finding blocks the verdict', async () => {
  const { routes, comments, written, ready } = setup({ outputs: { 'review-standards': review('CLEAN'), 'review-spec': review('CLEAN', [finding('HIGH')]) } });
  await ready();
  await routes['/engine/review']({ runId: 'run-1', step: 'review-standards' });
  const got = await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.equal(got.verdict, 'FINDINGS', 'a lens that says CLEAN with a HIGH finding is not clean');
  assert.equal(got.posted, false);
  assert.equal(comments.length, 0);
  assert.deepEqual(written.filter((w) => w.kind === 'review').map((w) => w.data.verdict), ['CLEAN', 'FINDINGS']);
  assert.deepEqual(REVIEW_STEPS, ['review-standards', 'review-spec', 'review-security', 'review-design', 'review-feature']);
});

test('the pack\'s sign step asks for each lens and says clean only once the verdict is posted', async () => {
  const { main } = await import('../../../scripts/engine/review-sign.js');
  const asked = [];
  const answers = { 'review-standards': { ok: true, ran: true, verdict: 'CLEAN', posted: false }, 'review-spec': { ok: true, ran: true, verdict: 'CLEAN', posted: true } };
  const client = { engine: { review: async ({ step }) => { asked.push(step); return answers[step] ?? { ok: true, ran: false }; } } };
  const lines = [];
  assert.equal(await main(['--run', 'run-1'], { client, out: (l) => lines.push(l) }), 0);
  assert.deepEqual(asked, REVIEW_STEPS);
  assert.deepEqual(JSON.parse(lines[0]), { clean: true });
  answers['review-spec'] = { ok: true, ran: true, verdict: 'FINDINGS', posted: false };
  lines.length = 0;
  await main(['--run', 'run-1'], { client, out: (l) => lines.push(l) });
  assert.deepEqual(JSON.parse(lines[0]), { clean: false, question: 'A review found a BLOCKER or HIGH problem in this change, so it is not marked ready.' });
  const refusing = { engine: { review: async () => ({ ok: false, refused: 'the run\'s pack isn\'t the installed pack' }) } };
  assert.equal(await main(['--run', 'run-1'], { client: refusing, out: () => {} }), 1);
});

test('a review is signed only for the commit the reviews read', async () => {
  const before = '2222222a2b3c4d5e6f708192a3b4c5d6e7f80912';
  for (const [name, lenses, why] of [
    ['a commit made after the reviews', { security: false, design: false, head: before, clean: true }, /read 2222222, not the pull request's head 1111111/],
    ['a worktree with changes beside its commit', { security: false, design: false, head: HEAD, clean: false }, /didn't record the commit/],
    ['no record of the commit', undefined, /didn't record the commit/],
  ]) {
    const outputs = { 'review-spec': review('CLEAN'), lenses: lenses === undefined ? undefined : JSON.stringify(lenses) };
    if (lenses === undefined) delete outputs.lenses;
    const { routes, written, comments, ready, engine } = setup({ outputs });
    if (lenses === undefined) {
      const plain = engine.outputs;
      engine.outputs = async () => { const all = await plain(); delete all.lenses; return all; };
    }
    await ready();
    const got = await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
    assert.equal(got.ok, false, name);
    assert.match(got.refused, why, name);
    assert.equal(written.filter((w) => w.kind === 'review').length, 0, name);
    assert.equal(comments.length, 0, name);
  }
});

test('the whole-feature lens is signed like the others, and its HIGH finding blocks the verdict', async () => {
  const { routes, comments, ready } = setup({ outputs: { 'review-standards': review('CLEAN'), 'review-spec': review('CLEAN'), 'review-feature': review('FINDINGS', [finding('HIGH')]) } });
  await ready();
  await routes['/engine/review']({ runId: 'run-1', step: 'review-standards' });
  await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  const got = await routes['/engine/review']({ runId: 'run-1', step: 'review-feature' });
  assert.equal(got.verdict, 'FINDINGS');
  assert.equal(got.posted, false);
  assert.equal(comments.length, 0);
});

test('a review held by its findings gives them, and the sign step\'s question names them', async () => {
  const high = { severity: 'HIGH', file: 'src/import.js', line: 7, repro: 'A batch of 0 loops for ever.', fix: 'f' };
  const { routes, ready } = setup({ outputs: { 'review-spec': review('FINDINGS', [high, finding('LOW')]) } });
  await ready();
  const got = await routes['/engine/review']({ runId: 'run-1', step: 'review-spec' });
  assert.deepEqual(got.held, [{ severity: 'HIGH', file: 'src/import.js', line: 7, repro: 'A batch of 0 loops for ever.' }], 'only what holds the work, with no fix');
  const { main } = await import('../../../scripts/engine/review-sign.js');
  const client = { engine: { review: async ({ step }) => (step === 'review-spec' ? got : { ok: true, ran: false }) } };
  const lines = [];
  assert.equal(await main(['--run', 'run-1'], { client, out: (l) => lines.push(l) }), 0);
  const said = JSON.parse(lines[0]);
  assert.equal(said.clean, false);
  assert.equal(said.question, 'A review found a BLOCKER or HIGH problem in this change, so it is not marked ready. The spec review found: HIGH in src/import.js, line 7: A batch of 0 loops for ever.');
});

test('the sign step names at most three findings, and says how many more', async () => {
  const { main } = await import('../../../scripts/engine/review-sign.js');
  const held = [1, 2, 3, 4, 5].map((line) => ({ severity: 'BLOCKER', file: 'a.js', line, repro: `Problem ${line}.` }));
  const client = { engine: { review: async ({ step }) => (step === 'review-standards' ? { ok: true, ran: true, verdict: 'FINDINGS', posted: false, held } : { ok: true, ran: false }) } };
  const lines = [];
  await main(['--run', 'run-1'], { client, out: (l) => lines.push(l) });
  const { question } = JSON.parse(lines[0]);
  assert.match(question, /The standards review found: BLOCKER in a\.js, line 1: Problem 1\.; BLOCKER in a\.js, line 2: Problem 2\.; BLOCKER in a\.js, line 3: Problem 3\. And 2 more\.$/);
});

test('the sign step\'s question gives each lens its own sentence', async () => {
  const { main } = await import('../../../scripts/engine/review-sign.js');
  const held = { 'review-standards': [{ severity: 'HIGH', file: 'a.js', line: 1, repro: 'One.' }], 'review-spec': [{ severity: 'HIGH', file: 'b.js', line: 2, repro: 'Two' }] };
  const client = { engine: { review: async ({ step }) => (held[step] ? { ok: true, ran: true, verdict: 'FINDINGS', posted: false, held: held[step] } : { ok: true, ran: false }) } };
  const lines = [];
  await main(['--run', 'run-1'], { client, out: (l) => lines.push(l) });
  assert.match(JSON.parse(lines[0]).question, /ready\. The standards review found: HIGH in a\.js, line 1: One\. The spec review found: HIGH in b\.js, line 2: Two\.$/);
});
