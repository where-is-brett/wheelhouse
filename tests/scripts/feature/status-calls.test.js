// tests/scripts/feature/status-calls.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { featurePaths } from '../../../scripts/feature/files.js';
import { captureCalls } from '../../../scripts/feature/status.js';
import { decide } from '../../../scripts/hooks/feature-status.js';
import { tempFolder } from '../../helpers/homes.js';

const NOW = new Date('2026-11-08T05:00:00.000Z');
const WORK = 'w-tide-1';

const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

// A feature worktree of harbour-demo made by hand: the brief, and a .git folder on the piece's branch.
function worktree() {
  const tree = fs.realpathSync.native(tempFolder('wh-calls-'));
  fs.mkdirSync(path.join(tree, '.git'), { recursive: true });
  fs.writeFileSync(path.join(tree, '.git', 'HEAD'), `ref: refs/heads/feature/${WORK}\n`);
  const p = featurePaths(tree);
  fs.mkdirSync(p.dir, { recursive: true });
  const brief = { v: 1, work: WORK, lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };
  fs.writeFileSync(p.brief, `${fence(brief)}\nThe brief.\n`);
  return tree;
}

const call = (decided, extra = {}) => ({
  v: 1, at: '2026-11-08T04:00:00.000Z', decided, options: ['a table', 'a list'], why: 'It is the simplest.', kind: 'structure', ...extra,
});
const keepCalls = (tree, calls) => fs.writeFileSync(featurePaths(tree).decisions, `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`);

test('calls reach the record once, not again on the next status pass', async () => {
  const tree = worktree();
  keepCalls(tree, [call('Keep tide rows in one table'), call('Name the helper tideRow', { kind: 'structure' })]);
  const sent = [];
  const write = async (data) => { sent.push(data); return true; };

  const first = await captureCalls({ worktree: tree, work: WORK, write });
  assert.equal(first.length, 2);
  assert.deepEqual(sent.map((d) => d.decided), ['Keep tide rows in one table', 'Name the helper tideRow']);
  assert.equal(sent[0].work, WORK);
  assert.equal('v' in sent[0], false, 'the event carries no version of the log line');

  assert.deepEqual(await captureCalls({ worktree: tree, work: WORK, write }), []);
  assert.equal(sent.length, 2);

  // A call logged after the first pass is sent on its own.
  fs.appendFileSync(featurePaths(tree).decisions, `${JSON.stringify(call('Cache the tide table'))}\n`);
  assert.equal((await captureCalls({ worktree: tree, work: WORK, write })).length, 1);
  assert.equal(sent.length, 3);
});

test('a call the record did not take is sent again at the next pass, and none is skipped', async () => {
  const tree = worktree();
  keepCalls(tree, [call('First'), call('Second'), call('Third')]);
  const sent = [];
  let up = false;
  const write = async (data) => {
    if (!up) return false;
    sent.push(data.decided);
    return data.decided !== 'Second' || sent.filter((d) => d === 'Second').length > 1;
  };
  assert.deepEqual(await captureCalls({ worktree: tree, work: WORK, write }), []);
  up = true;
  assert.equal((await captureCalls({ worktree: tree, work: WORK, write })).length, 1, 'the pass ends at the first call not taken');
  assert.equal((await captureCalls({ worktree: tree, work: WORK, write })).length, 2);
  assert.deepEqual(sent, ['First', 'Second', 'Second', 'Third']);
  assert.deepEqual(await captureCalls({ worktree: tree, work: WORK, write }), []);
});

test('a write that throws is passed over', async () => {
  const tree = worktree();
  keepCalls(tree, [call('First')]);
  assert.deepEqual(await captureCalls({ worktree: tree, work: WORK, write: async () => { throw new Error('no helper'); } }), []);
  assert.equal((await captureCalls({ worktree: tree, work: WORK, write: async () => true })).length, 1);
});

test('lines that are not calls are not sent, and a folder with no log sends nothing', async () => {
  const tree = worktree();
  assert.deepEqual(await captureCalls({ worktree: tree, work: WORK, write: async () => { throw new Error('asked'); } }), []);
  fs.writeFileSync(featurePaths(tree).decisions, `not json\n${JSON.stringify(call('Rewrite the engine', { kind: 'rewrite' }))}\n${JSON.stringify(call('Fine'))}\n`);
  const sent = [];
  await captureCalls({ worktree: tree, work: WORK, write: async (d) => { sent.push(d.decided); return true; } });
  assert.deepEqual(sent, ['Fine'], 'a director kind in the log is never sent as an agent\'s call');
});

test('the status hook sends the calls at a Stop and not again at the next one', async () => {
  const tree = worktree();
  keepCalls(tree, [call('Keep tide rows in one table')]);
  const sent = [];
  const writeCall = async (data) => { sent.push(data); return true; };
  const options = { now: () => NOW, answered: () => new Set(), slice: () => null, writeCall };
  await decide({ cwd: tree, hook_event_name: 'Stop', session_id: 'sess-1' }, options);
  await decide({ cwd: tree, hook_event_name: 'Stop', session_id: 'sess-1' }, options);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].decided, 'Keep tide rows in one table');
});
