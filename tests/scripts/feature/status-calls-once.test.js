// tests/scripts/feature/status-calls-once.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { featurePaths } from '../../../scripts/feature/files.js';
import { captureCalls } from '../../../scripts/feature/status.js';
import { callsFrom } from '../../../scripts/decisions/calls.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { inHome } from '../../helpers/decisions-world.js';
import { tempFolder } from '../../helpers/homes.js';

const WORK = 'w-tide-1';
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

function worktree() {
  const tree = fs.realpathSync.native(tempFolder('wh-calls-once-'));
  fs.mkdirSync(path.join(tree, '.git'), { recursive: true });
  fs.writeFileSync(path.join(tree, '.git', 'HEAD'), `ref: refs/heads/feature/${WORK}\n`);
  const p = featurePaths(tree);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.brief, `${fence({ v: 1, work: WORK, lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true })}\nThe brief.\n`);
  return tree;
}
const call = (decided) => ({ v: 1, at: '2026-11-08T04:00:00.000Z', decided, options: ['a table', 'a list'], why: 'It is the simplest.', kind: 'structure' });
const keep = (tree, calls) => fs.writeFileSync(featurePaths(tree).decisions, `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`);
const collector = () => {
  const sent = [];
  return { sent, write: async (d) => { sent.push(d); return true; } };
};

test('each call carries a stable key, the same on every pass', async () => {
  const tree = worktree();
  keep(tree, [call('One'), call('Two')]);
  const a = collector();
  await captureCalls({ worktree: tree, work: WORK, write: a.write });
  assert.ok(a.sent.every((d) => /^[0-9a-f]{24}$/.test(d.key)));
  assert.notEqual(a.sent[0].key, a.sent[1].key);
  fs.rmSync(path.join(featurePaths(tree).dir, 'decisions.sent'));
  const b = collector();
  await captureCalls({ worktree: tree, work: WORK, write: b.write });
  assert.deepEqual(b.sent.map((d) => d.key), a.sent.map((d) => d.key));
});

test('a deleted or edited line does not make later calls skip or repeat', async () => {
  const tree = worktree();
  keep(tree, [call('One'), call('Two'), call('Three')]);
  const first = collector();
  await captureCalls({ worktree: tree, work: WORK, write: first.write });
  assert.equal(first.sent.length, 3);
  // The first line is deleted, the second edited, and a fourth added: only the edited and the new one are new.
  keep(tree, [call('Two, reworded'), call('Three'), call('Four')]);
  const next = collector();
  await captureCalls({ worktree: tree, work: WORK, write: next.write });
  assert.deepEqual(next.sent.map((d) => d.decided), ['Two, reworded', 'Four']);
});

test('the same line twice in the log is sent once', async () => {
  const tree = worktree();
  keep(tree, [call('One'), call('One')]);
  const c = collector();
  await captureCalls({ worktree: tree, work: WORK, write: c.write });
  assert.equal(c.sent.length, 1);
});

test('callsFrom drops a repeat by its key, keeping the first event, so ids stay stable', async () => {
  await inHome(() => {
    const data = { work: WORK, at: '2026-11-08T04:00:00.000Z', decided: 'One', options: ['a', 'b'], why: 'Because.', kind: 'structure', key: 'a'.repeat(24) };
    const first = makeEvent({ kind: 'agent-call', data, now: () => new Date('2026-11-08T04:00:01.000Z') });
    const second = makeEvent({ kind: 'agent-call', data, now: () => new Date('2026-11-08T04:00:09.000Z') });
    const other = makeEvent({ kind: 'agent-call', data: { ...data, key: 'b'.repeat(24), decided: 'Two', at: '2026-11-08T04:30:00.000Z' }, now: () => new Date('2026-11-08T04:00:05.000Z') });
    const found = callsFrom([second, other, first]);
    assert.deepEqual(found.map((c) => c.decided), ['One', 'Two']);
    assert.equal(found[0].id, first.id);
    // An event with no key (an older one) is never taken for a repeat.
    const plain = { ...data };
    delete plain.key;
    const a = makeEvent({ kind: 'agent-call', data: plain, now: () => new Date('2026-11-08T05:00:01.000Z') });
    const b = makeEvent({ kind: 'agent-call', data: plain, now: () => new Date('2026-11-08T05:00:02.000Z') });
    assert.equal(callsFrom([a, b]).length, 2);
  });
});
