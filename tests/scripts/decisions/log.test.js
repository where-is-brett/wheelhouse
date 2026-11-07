// tests/scripts/decisions/log.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectCalls, callsFrom } from '../../../scripts/decisions/log.js';
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
