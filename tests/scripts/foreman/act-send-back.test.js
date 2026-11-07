// tests/scripts/foreman/act-send-back.test.js
// `act question` records a decision that fits its shape, and sends one that doesn't back to the session that raised it, on that
// session's next wake: no question is written, so the director never sees it and no "stop this work" card is made (design
// section 6.2). The helper and the waker are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { main } from '../../../scripts/foreman/act.js';
import { featurePaths, questionTrail } from '../../../scripts/feature/files.js';
import { withHome } from '../../helpers/homes.js';
import {
  P, T0, HASH, emptyViews, fakeClient, featureView, project, workView, worktree,
} from '../../helpers/foreman.js';

const now = () => new Date(T0);
async function act(argv, deps) {
  const said = { out: '', err: '' };
  const code = await main(argv, { project: P, now, out: (t) => { said.out += t; }, err: (t) => { said.err += t; }, ...deps });
  return { code, ...said };
}

const WHOLE = {
  id: 'q-mine-1', kind: 'question', what: 'How often should the digest go out?', why: 'It decides what visitors get',
  options: [{ label: 'Daily', says: 'Every day', cost: 'A day', undo: 'Can be undone' }, { label: 'Weekly', says: 'Once a week', cost: 'A day', undo: 'Can be undone' }],
  recommendation: 'Weekly', level: 3, because: 'Visitors plan their week', meanwhile: 'I build the sending, which both need', holds: 'the digest',
};
// A line a session wrote by hand or before the shape was asked for: its options say nothing of cost or undo.
const NO_COST = { ...WHOLE, id: 'q-mine-2', options: WHOLE.options.map(({ label, says }) => ({ label, says })) };

async function scene(questions) {
  const checkout = await project();
  const views = emptyViews();
  views.work.mine = workView('mine', { lane: 'feature', visible: true, doc: { path: 'docs/specs/mine.md', hash: HASH } });
  const wt = worktree(checkout, 'mine', { questions });
  views.features.mine = featureView('mine', { step: 'building', worktree: wt });
  return { views, wt };
}

function wakes() {
  const woken = [];
  return { woken, wakerFor: () => ({ wakeFeature: async (work, file) => { woken.push({ work, wake: JSON.parse(fs.readFileSync(file, 'utf8')) }); } }) };
}

test('a decision with every part is recorded, with its cost, undo, reason, holds and meanwhile', async () => withHome(async () => {
  const { views } = await scene([WHOLE]);
  const fake = fakeClient({ views });
  const waker = wakes();
  const r = await act(['question', 'mine', 'q-mine-1'], { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(r.code, 0, r.err);
  assert.equal(fake.writes.length, 1);
  const { kind, ...asked } = WHOLE;
  assert.deepEqual(fake.writes[0].data, { ...asked, work: 'mine' });
  assert.deepEqual(waker.woken, []);
}));

test('act question returns the problems to the session instead of making a stop-this-work card', async () => withHome(async () => {
  const { views, wt } = await scene([NO_COST]);
  const fake = fakeClient({ views });
  const waker = wakes();
  const r = await act(['question', 'mine', 'q-mine-2'], { client: fake.client, wakerFor: waker.wakerFor });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /wasn't recorded: it fails its shape\. Sent back to mine's session/);
  // Nothing reaches the state: no question, no card of any kind.
  assert.deepEqual(fake.writes, []);
  // The session is woken with what is missing, and told to ask again.
  assert.equal(waker.woken.length, 1);
  const [event] = waker.woken[0].wake.events;
  assert.equal(waker.woken[0].work, 'mine');
  assert.equal(event.work, 'mine');
  assert.match(event.detail.next, /Your question q-mine-2 wasn't put to the director/);
  assert.match(event.detail.next, /Option "Daily" doesn't say what it costs/);
  assert.match(event.detail.next, /Option "Weekly" doesn't say whether it can be undone/);
  assert.match(event.detail.next, /Ask it again with the shape put right/);
  assert.doesNotMatch(event.detail.next, /stuck/);
  assert.equal(questionTrail(featurePaths(wt).questions).failures, 1);
}));

test('after three sent back in a row the wake says to send one plain stuck message', async () => withHome(async () => {
  const lines = [NO_COST, { ...NO_COST, id: 'q-mine-3' }, { ...NO_COST, id: 'q-mine-4' }];
  const { views, wt } = await scene(lines);
  const waker = wakes();
  for (const q of lines) {
    const fake = fakeClient({ views });
    assert.equal((await act(['question', 'mine', q.id], { client: fake.client, wakerFor: waker.wakerFor })).code, 0);
  }
  const [first, , third] = waker.woken.map((w) => w.wake.events[0].detail.next);
  assert.doesNotMatch(first, /stuck/);
  assert.match(third, /3 tries in a row that failed: stop trying and send one plain message with `stuck --why/);
  assert.equal(questionTrail(featurePaths(wt).questions).failures, 3);
}));

test('a session that cannot be woken is told so, and nothing is recorded', async () => withHome(async () => {
  const { views } = await scene([NO_COST]);
  const fake = fakeClient({ views });
  const r = await act(['question', 'mine', 'q-mine-2'], { client: fake.client, wakerFor: () => ({ wakeFeature: async () => { throw new Error('no session'); } }) });
  assert.equal(r.code, 1);
  assert.match(r.err, /fails its shape/);
  assert.match(r.err, /session wasn't woken/);
  assert.deepEqual(fake.writes, []);
}));
