// tests/scripts/decisions/log.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectCalls, callsFrom, readLog, appendCall, appendHelm } from '../../../scripts/decisions/log.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { makeFeatureFolder } from '../../helpers/made-feature.js';
import { tempFolder } from '../../helpers/homes.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { inHome, keep, P } from '../../helpers/decisions-world.js';

const data = (extra = {}) => ({
  work: 'w-tide-1', at: '2026-11-07T02:00:00.000Z', decided: 'Keep tide rows in one table', options: ['one table', 'a table per harbour'],
  why: 'Fewer joins to read them back.', kind: 'structure', ...extra,
});
const callEvent = (extra, at) => makeEvent({ kind: 'agent-call', data: data(extra), now: () => new Date(at) });

test('projectCalls reads the record\'s agent-call events, oldest first, from a time on', async () => {
  await inHome(() => {
    keep(callEvent({ decided: 'Second', at: '2026-11-07T05:00:00.000Z' }, '2026-11-07T05:00:01.000Z'));
    keep(callEvent({ decided: 'First', at: '2026-11-07T02:00:00.000Z', work: 'w-tide-2', kind: 'tooling' }, '2026-11-07T02:00:01.000Z'));
    keep(makeEvent({ kind: 'lesson', data: { work: 'w-tide-1', text: 'Not a call' }, now: () => new Date('2026-11-07T03:00:00.000Z') }));
    const all = projectCalls(P);
    assert.deepEqual(all.map((c) => c.decided), ['First', 'Second']);
    assert.deepEqual(all[0], {
      work: 'w-tide-2', at: '2026-11-07T02:00:00.000Z', decided: 'First', options: ['one table', 'a table per harbour'],
      why: 'Fewer joins to read them back.', kind: 'tooling',
    });
    assert.deepEqual(projectCalls(P, { since: new Date('2026-11-07T04:00:00.000Z') }).map((c) => c.decided), ['Second']);
    assert.deepEqual(projectCalls('owner__no-such-project'), []);
  });
});

test('callsFrom keeps each event\'s id, for pulling a call back', async () => {
  await inHome(() => {
    const event = callEvent({}, '2026-11-07T02:00:01.000Z');
    assert.equal(callsFrom([event])[0].id, event.id);
    assert.deepEqual(callsFrom(undefined), []);
  });
});

test('an agent-call event takes only an agent kind, two or more options and a time', async () => {
  await inHome(() => {
    const make = (extra) => makeEvent({ kind: 'agent-call', data: data(extra), now: () => new Date('2026-11-07T02:00:01.000Z') });
    assert.ok(make({}));
    assert.throws(() => make({ kind: 'algorithm' }), /agent-call event/);
    assert.throws(() => make({ kind: 'colour-scheme' }), /agent-call event/);
    assert.throws(() => make({ options: ['only one'] }), /options/);
    assert.throws(() => make({ at: 'yesterday' }), /at/);
    assert.throws(() => make({ work: 'Not A Slug' }), /work/);
    assert.throws(() => make({ extra: 1 }), /should not/);
  });
});

// A worktree with a feature folder, for the log's own file.
const tree = () => makeFeatureFolder(fs.realpathSync.native(tempFolder('wh-log-')), 'w-tide-1');
const failing = (message) => { throw new Error(message); };
const hhmm = (iso) => `${String(new Date(iso).getHours()).padStart(2, '0')}:${String(new Date(iso).getMinutes()).padStart(2, '0')}`;
const CALL = { decided: 'Keep the old login page for now', options: ['keep it', 'replace it'], why: 'The director said so at the helm', kind: 'behaviour' };

test('log: the helm line reads as a call', () => {
  const worktree = tree();
  const from = '2026-11-08T03:02:00.000Z';
  const to = '2026-11-08T03:31:00.000Z';
  const line = appendHelm({ worktree, from, to, now: () => new Date('2026-11-08T03:31:01.000Z') });
  assert.deepEqual(line, { v: 1, at: '2026-11-08T03:31:01.000Z', helm: { from, to } });
  assert.deepEqual(JSON.parse(fs.readFileSync(featurePaths(worktree).decisions, 'utf8')), line);
  const calls = readLog(worktree);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].decided, `The director steered this piece from ${hhmm(from)} to ${hhmm(to)}`);
  assert.match(calls[0].decided, /^The director steered this piece from \d\d:\d\d to \d\d:\d\d$/);
  assert.equal(calls[0].where, 'helm');
});

test('log: where helm allows a director\'s kind', () => {
  const worktree = tree();
  assert.throws(() => appendCall({ worktree, ...CALL, fail: failing }), /director's to decide/);
  const line = appendCall({ worktree, ...CALL, where: 'helm', fail: failing });
  assert.equal(line.where, 'helm');
  assert.equal(line.kind, 'behaviour');
  assert.deepEqual(readLog(worktree).map((c) => [c.decided, c.kind, c.where]), [[CALL.decided, 'behaviour', 'helm']]);
  // A call without where keeps its shape.
  const plain = appendCall({ worktree, ...CALL, kind: 'structure', fail: failing });
  assert.equal('where' in plain, false);
});

test('log: where must be helm', () => {
  const worktree = tree();
  assert.throws(() => appendCall({ worktree, ...CALL, kind: 'structure', where: 'desk', fail: failing }), /--where is helm or left out/);
  assert.equal(fs.existsSync(featurePaths(worktree).decisions), false);
});

test('log: a helm call reaches the record as an agent-call event', () => {
  const make = (extra) => makeEvent({ kind: 'agent-call', data: { work: 'w-tide-1', at: '2026-11-07T02:00:00.000Z', ...CALL, ...extra }, now: () => new Date('2026-11-07T02:00:01.000Z') });
  assert.ok(make({ where: 'helm' }));
  assert.throws(() => make({}), /agent-call event/);
  assert.throws(() => make({ where: 'desk', kind: 'structure' }), /where/);
});
