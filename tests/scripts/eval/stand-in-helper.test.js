// tests/scripts/eval/stand-in-helper.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStandInHelper } from '../../../scripts/eval/stand-in-helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { g } from '../../helpers/git-fixture.js';
import { shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

async function repo() {
  const dir = tempFolder('stand-in-repo-');
  await g(dir, 'init', '--quiet', '--initial-branch=main');
  await g(dir, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  await g(dir, 'checkout', '--quiet', '-b', 'feature/x');
  await g(dir, 'commit', '--quiet', '--allow-empty', '-m', 'second');
  return { dir, head: await g(dir, 'rev-parse', 'HEAD') };
}

test('the stand-in helper answers a feature session\'s commands and records each one', async () => {
  const { dir, head } = await repo();
  const helper = await startStandInHelper({ address: testAddress(shortHome()), answers: { 'q-x-2': 'yes' } });
  try {
    const client = helperClient({ address: helper.address });
    assert.deepEqual(await client.push({ cwd: dir, dir, refspec: 'feature/x' }), { ok: true, pushed: 'feature/x' });
    assert.equal((await client.push({ cwd: dir, dir, refspec: 'main' })).ok, false, 'the default branch is never pushed');
    assert.deepEqual(await client.pull({ cwd: dir, dir, branch: 'feature/x' }), { ok: true, already: true });
    const opened = await client.openPr({ cwd: dir, head: 'feature/x', title: 'T', body: 'B' });
    assert.deepEqual(opened.result.number, 1);
    assert.equal((await client.openPr({ cwd: dir, head: 'feature/x', title: 'T2', body: 'B' })).result.number, 2);
    assert.deepEqual(await client.state.answer({ cwd: dir, questionId: 'q-x-1' }), { ok: true, answer: null });
    assert.deepEqual(await client.state.answer({ cwd: dir, questionId: 'q-x-2' }), { ok: true, answer: 'yes' });
    assert.deepEqual(await client.lineage.provenance({ cwd: dir }), { ok: true, block: null, stop: false });
    assert.equal((await client.merge({ project: 'p', number: 1 })).ok, false, 'anything else is refused');

    const records = helper.records();
    assert.deepEqual(records.map((r) => r.route), ['push', 'push', 'pull', 'pr/open', 'pr/open', 'state/answer', 'state/answer', 'lineage/provenance', 'POST /merge']);
    assert.equal(records[0].sha, head);
    assert.equal(records[1].refused, true);
    assert.equal(records[2].branch, 'feature/x');
    assert.equal(records[3].sha, head);
    assert.equal(records[3].body, 'B');
    assert.equal(records[8].unanswered, true);
  } finally {
    await helper.close();
  }
});

test('the stand-in helper keeps a caller\'s id on a plain event, and gives the card events with the views when asked', async () => {
  const helper = await startStandInHelper({ address: testAddress(shortHome()) });
  try {
    const client = helperClient({ address: helper.address });
    const id = '0b7f3c1e-5d2a-4c8b-9e6f-1a2b3c4d5e6f';
    assert.deepEqual(await client.state.write({ cwd: '/p', kind: 'card', data: { question: 'Q' }, id }), { ok: true, id, pushed: true });
    assert.equal((await client.state.write({ cwd: '/p', kind: 'card', data: { question: 'Q' }, id })).ok, false, 'an id the state holds is refused');
    assert.equal((await client.state.write({ cwd: '/p', kind: 'card', data: { question: 'Q' }, id: 'card-1' })).ok, false, 'an id that is not a random UUID is refused');
    const made = await client.state.write({ cwd: '/p', kind: 'asked', data: { cards: [id] } });
    assert.notEqual(made.id, id);

    const plain = await client.state.views({ cwd: '/p' });
    assert.equal(plain.cards, undefined);
    assert.equal(plain.stop, undefined, 'STOP is off');
    const withCards = await client.state.views({ cwd: '/p', cards: true });
    assert.deepEqual(withCards.cards.map((e) => [e.id, e.kind]), [[id, 'card']]);
    assert.deepEqual(helper.events().map((e) => e.kind), ['card', 'asked']);
  } finally {
    await helper.close();
  }
});
