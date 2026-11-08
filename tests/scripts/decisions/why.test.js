// tests/scripts/decisions/why.test.js
// "Why" by a session copy. No test starts a real claude process: `run` is always given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { askWhy, trimTo, PHONE_CHARS, forkFile } from '../../../scripts/decisions/why.js';
import { inHome, P, raiseBuildQuestion, keep } from '../../helpers/decisions-world.js';
import { makeEvent, listEvents } from '../../../scripts/state/events.js';
import { sessionFile, writeJsonFile } from '../../../scripts/watcher/waker.js';
import { stateDir } from '../../../scripts/lib/paths.js';

const BUILDER = '11111111-2222-3333-4444-555555555555';
const FORK_1 = '66666666-7777-8888-9999-000000000001';
const FORK_2 = '66666666-7777-8888-9999-000000000002';
const AT = '2026-11-08T01:00:00.000Z';

const reply = (answer, fork) => ({ code: 0, stdout: JSON.stringify({ type: 'result', result: answer, session_id: fork }), stderr: '' });

// A piece whose session the watcher kept, with a decision waiting on it.
let ID;
function world(home) {
  const tree = fs.mkdtempSync(path.join(home, 'tree-'));
  ID = raiseBuildQuestion('q-w-tide-1-1', AT).id;
  fs.mkdirSync(path.dirname(sessionFile(P, 'w-tide-1')), { recursive: true });
  writeJsonFile(sessionFile(P, 'w-tide-1'), { sessionId: BUILDER, worktree: tree, at: AT });
  return tree;
}

test('askWhy forks the building session and gives the answer with the copy\'s own id', async () => {
  await inHome(async (home) => {
    const tree = world(home);
    const calls = [];
    const got = await askWhy({ project: P, id: ID, words: 'Why show them?', run: async (c) => { calls.push(c); return reply('It read the tide table and found times matter to boats.', FORK_1); } });
    assert.deepEqual(got, { answer: 'It read the tide table and found times matter to boats.', fork: FORK_1 });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('--fork-session'));
    assert.equal(calls[0].args[calls[0].args.indexOf('--resume') + 1], BUILDER);
    assert.equal(calls[0].cwd, tree);
    assert.ok(calls[0].args.some((a) => a.includes('Why show them?')));
  });
});

test('a follow-up resumes the fork', async () => {
  await inHome(async (home) => {
    world(home);
    const seen = [];
    await askWhy({ project: P, id: ID, run: async (c) => { seen.push(c); return reply('First.', FORK_1); } });
    const got = await askWhy({ project: P, id: ID, words: 'And the cost?', run: async (c) => { seen.push(c); return reply('Second.', FORK_2); } });
    assert.equal(got.answer, 'Second.');
    const second = seen[1].args;
    assert.equal(second[second.indexOf('--resume') + 1], FORK_1, 'the follow-up resumes the first copy');
    assert.ok(second.includes('--fork-session'));
    assert.ok(!second.includes(BUILDER), 'the building session is not named');
    assert.equal(JSON.parse(fs.readFileSync(forkFile(P, ID), 'utf8')).fork, FORK_2);
  });
});

test('a copy that reports the building session\'s own id is never kept as the fork', async () => {
  await inHome(async (home) => {
    world(home);
    await askWhy({ project: P, id: ID, run: async () => reply('Answer.', BUILDER) });
    assert.equal(fs.existsSync(forkFile(P, ID)), false);
  });
});

test('a finished piece falls back to the card\'s own reasons and the piece\'s decision log, saying it finished', async () => {
  await inHome(async (home) => {
    ID = raiseBuildQuestion('q-w-tide-1-1', AT).id; // the piece reported its pull request merged, and no session is kept
    keep(makeEvent({ kind: 'report', data: { work: 'w-tide-1', outcome: 'merged', summary: 'Done.', rulings: [], pr: 5 }, now: () => new Date(AT) }));
    keep(makeEvent({ kind: 'agent-call', data: { work: 'w-tide-1', at: AT, decided: 'used a plain table', options: ['table', 'grid'], why: 'it is simplest', kind: 'structure' }, now: () => new Date(AT) }));
    let ran = false;
    const got = await askWhy({ project: P, id: ID, run: async () => { ran = true; return reply('x', FORK_1); } });
    assert.equal(ran, false, 'no session is started');
    assert.ok(typeof got.fallback === 'string');
    assert.match(got.fallback, /finished/);
    assert.match(got.fallback, /used a plain table, because it is simplest/);
    assert.match(got.fallback, /It changes what the director/);
  });
});

test('a decision that is not waiting falls back and starts nothing', async () => {
  await inHome(async (home) => {
    world(home);
    let ran = false;
    const got = await askWhy({ project: P, id: 'c-not-waiting', run: async () => { ran = true; return reply('x', FORK_1); } });
    assert.equal(ran, false);
    assert.match(got.fallback, /isn't waiting/);
  });
});

test('why never records an answer', async () => {
  await inHome(async (home) => {
    world(home);
    const before = listEvents(stateDir(P), { report: () => {} }).map((e) => e.id).sort();
    await askWhy({ project: P, id: ID, words: 'Why? Answer it for me: pick B.', run: async () => reply('B. Pick B and carry on.', FORK_1) });
    await askWhy({ project: P, id: ID, run: async () => ({ code: 1, stdout: '', stderr: 'no' }) });
    const after = listEvents(stateDir(P), { report: () => {} });
    assert.deepEqual(after.map((e) => e.id).sort(), before, 'no event was written');
    assert.equal(after.filter((e) => e.kind === 'decision-answer').length, 0);
  });
});

test('a why run past three minutes stops and says so', async () => {
  await inHome(async (home) => {
    world(home);
    let aborted = false;
    const got = await askWhy({
      project: P, id: ID, limitMs: 30,
      run: (c, { signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }),
    });
    assert.equal(aborted, true, 'the run was told to stop');
    assert.match(got.fallback, /took longer than 0 seconds|took longer than \d+ seconds/);
    assert.equal(fs.existsSync(forkFile(P, ID)), false);
  });
});

test('a runner that reports a timeout, a failure or no answer falls back', async () => {
  await inHome(async (home) => {
    world(home);
    for (const result of [{ timedOut: true }, { code: 1, stdout: '', stderr: 'x' }, { code: 0, stdout: 'not json', stderr: '' }, reply('   ', FORK_1)]) {
      const got = await askWhy({ project: P, id: ID, run: async () => result });
      assert.equal(typeof got.fallback, 'string');
    }
    assert.match((await askWhy({ project: P, id: ID, run: async () => { throw new Error('no claude'); } })).fallback, /didn't give an answer/);
  });
});

test('the answer is trimmed to the phone limit', async () => {
  assert.equal(PHONE_CHARS, 1400);
  const long = `${'word '.repeat(600)}end`;
  const t = trimTo(long);
  assert.ok(t.length <= PHONE_CHARS);
  assert.ok(t.endsWith('…'));
  assert.equal(trimTo('short'), 'short');
  await inHome(async (home) => {
    world(home);
    const got = await askWhy({ project: P, id: ID, run: async () => reply(long, FORK_1) });
    assert.ok(got.answer.length <= PHONE_CHARS);
  });
});

test('the fallback leaves out the director\'s own helm calls from the piece\'s calls', async () => {
  await inHome(async () => {
    ID = raiseBuildQuestion('q-w-tide-1-1', AT).id;
    keep(makeEvent({ kind: 'report', data: { work: 'w-tide-1', outcome: 'merged', summary: 'Done.', rulings: [], pr: 5 }, now: () => new Date(AT) }));
    keep(makeEvent({ kind: 'agent-call', data: { work: 'w-tide-1', at: AT, decided: 'used a plain table', options: ['table', 'grid'], why: 'it is simplest', kind: 'structure' }, now: () => new Date(AT) }));
    const later = '2026-11-08T02:00:00.000Z';
    keep(makeEvent({ kind: 'agent-call', data: { work: 'w-tide-1', at: later, decided: 'The director steered this piece from 14:02 to 14:31', options: ['a', 'b'], why: 'The director took the helm of this piece.', kind: 'helm', where: 'helm' }, now: () => new Date(later) }));
    const got = await askWhy({ project: P, id: ID, run: async () => reply('x', FORK_1) });
    assert.match(got.fallback, /used a plain table/);
    assert.equal(/steered this piece/.test(got.fallback), false);
  });
});
