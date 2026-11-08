// tests/scripts/frontdesk/pull-back.test.js
// The front desk's pull-back command, against a fake helper that keeps its events in memory and answers the desk's reads
// over them, as tests/scripts/frontdesk/cli.test.js does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { main } from '../../../scripts/frontdesk/cli.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { deskCore } from '../../../scripts/desk/core.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { as, tempFolder } from '../../helpers/homes.js';

const NOW = new Date('2026-11-08T12:00:00.000Z');
const T = (n) => new Date(Date.UTC(2026, 10, 8, 0, 0, n));
const CWD = path.resolve('/projects/harbour-demo');

async function inHome(fn) {
  const home = path.join(tempFolder('wh-pull-back-'), 'home');
  return as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
    return fn();
  });
}

// The helper as the front desk sees it, over a list of events: writes become events, reads are the real desk's.
function fakeHelper(events = []) {
  const held = [...events];
  let tick = 100;
  const writes = [];
  const source = {
    project: 'owner__harbour-demo',
    events: () => held,
    enrolled: () => readEnrolled(),
    views: async (body = {}) => ({
      ok: true,
      views: buildViews(held, readEnrolled(), { now: () => NOW }),
      ...(body.cards === true ? { cards: held.filter((e) => e.kind === 'card') } : {}),
      ...(body.answers === true ? { answers: held.filter((e) => e.kind === 'card-answer') } : {}),
    }),
    profile: async () => ({ settings: {} }),
  };
  const client = {
    desk: { read: async (body) => deskCore({ source, recorder: {}, now: () => NOW }).read(body.view, body.args) },
    state: {
      write: async (body) => {
        writes.push(body);
        const made = makeEvent({ kind: body.kind, data: body.data, now: () => T((tick += 1)) });
        const event = body.id === undefined ? made : { ...made, id: body.id };
        held.push(event);
        return { ok: true, id: event.id, pushed: true };
      },
    },
  };
  return { client, held, writes };
}

async function say(helper, argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { cwd: CWD, client: helper.client, env: {}, now: () => NOW, out: (t) => { out += t; }, err: (t) => { err += t; } });
  let json;
  try { json = JSON.parse(out); } catch { json = undefined; }
  return { code, out, err, json };
}

const call = (n, extra = {}) => makeEvent({
  kind: 'agent-call',
  data: { work: 'w-tide-1', at: `2026-11-07T0${n}:00:00.000Z`, decided: 'Rank the tide list by nearest harbour', options: ['nearest harbour', 'alphabetical'], why: 'It reads better on a phone.', kind: 'structure', ...extra },
  now: () => T(n),
});

test('pull-back writes a ruling naming the call', async () => {
  await inHome(async () => {
    const first = call(1);
    const helper = fakeHelper([first, call(2, { decided: 'Cache the tide table for an hour', kind: 'performance' })]);
    const out = await say(helper, ['pull-back', first.id]);
    assert.equal(out.code, 0, out.err);
    const ruling = helper.held.find((e) => e.kind === 'ruling');
    assert.ok(ruling, 'a ruling was written');
    assert.equal(out.json.ruling, ruling.id);
    assert.equal(out.json.call, first.id);
    assert.ok(ruling.data.words.includes(`[call ${first.id.slice(0, 8)}]`), 'the ruling names the call');
    assert.ok(ruling.data.words.includes('Rank the tide list by nearest harbour'));
    assert.equal(/\n/.test(ruling.data.words), false);
    // Its confirm card waits, as for any ruling, and no request was made.
    assert.equal(helper.held.filter((e) => e.kind === 'card').length, 1);
    assert.equal(helper.held.some((e) => e.kind === 'request'), false);
    assert.equal(out.json.request, undefined);
    assert.match(out.json.say, /Pulled back/);
  });
});

test('a call is found by the start of its id, and a wrong or doubtful id is refused', async () => {
  await inHome(async () => {
    const first = call(1);
    const helper = fakeHelper([first, call(2)]);
    assert.equal((await say(helper, ['pull-back', first.id.slice(0, 8)])).code, 0);
    const none = await say(helper, ['pull-back', 'deadbeef']);
    assert.equal(none.code, 1);
    assert.match(none.err, /recent calls/);
    for (const bad of [[], ['abc'], ['not an id'], ['aaaaaaaa', '--other']]) assert.equal((await say(helper, ['pull-back', ...bad])).code, 1, JSON.stringify(bad));
    assert.equal(helper.held.filter((e) => e.kind === 'ruling').length, 1, 'only the one pull-back wrote');
  });
});

test('a call pulled back is not pulled back again', async () => {
  await inHome(async () => {
    const first = call(1);
    const helper = fakeHelper([first]);
    assert.equal((await say(helper, ['pull-back', first.id])).code, 0);
    // The ruling shows in the rulebook once its confirm card is answered; until then the ruling's own words still mark it.
    const again = await say(helper, ['pull-back', first.id]);
    assert.equal(again.code, 1);
    assert.match(again.err, /already/);
    assert.equal(helper.held.filter((e) => e.kind === 'ruling').length, 1);
  });
});

test('pull-back --change after a ruling exists files only the request, once', async () => {
  await inHome(async () => {
    const first = call(1);
    const helper = fakeHelper([first]);
    assert.equal((await say(helper, ['pull-back', first.id])).code, 0);
    const out = await say(helper, ['pull-back', first.id, '--change']);
    assert.equal(out.code, 0, out.err);
    assert.equal(helper.held.filter((e) => e.kind === 'ruling').length, 1, 'no second ruling');
    assert.equal(helper.held.filter((e) => e.kind === 'request').length, 1);
    assert.equal(out.json.ruling, undefined);
    const again = await say(helper, ['pull-back', first.id, '--change']);
    assert.equal(again.code, 1);
    assert.match(again.err, /already/);
    assert.equal(helper.held.filter((e) => e.kind === 'request').length, 1);
  });
});

test('a call that is not among the recent calls is said so, not said never to have been logged', async () => {
  await inHome(async () => {
    const helper = fakeHelper([call(1)]);
    const out = await say(helper, ['pull-back', 'deadbeef']);
    assert.equal(out.code, 1);
    assert.match(out.err, /recent calls/);
    assert.equal(/never|was not logged/.test(out.err), false);
  });
});

test('pull-back --change also files an intake request in the director\'s words', async () => {
  await inHome(async () => {
    const first = call(1);
    const helper = fakeHelper([first]);
    const out = await say(helper, ['pull-back', first.id, '--change']);
    assert.equal(out.code, 0, out.err);
    const request = helper.held.find((e) => e.kind === 'request');
    assert.ok(request, 'a request was filed');
    assert.equal(out.json.request, request.id);
    assert.equal(request.data.via, 'chat');
    assert.ok(request.data.words.includes('Rank the tide list by nearest harbour'));
    assert.ok(request.data.words.includes('w-tide-1'));
    assert.ok(helper.held.some((e) => e.kind === 'ruling'), 'the ruling is written too');
  });
});

test('the calls offered for pull-back leave out the director\'s own helm calls', async () => {
  await inHome(async () => {
    const mine = call(1, { where: 'helm', kind: 'helm', decided: 'The director steered this piece from 14:02 to 14:31' });
    const theirs = call(2);
    const helper = fakeHelper([mine, theirs]);
    const got = await helper.client.desk.read({ view: 'waiting', args: { calls: true } });
    assert.deepEqual(got.data.calls.map((c) => c.id), [theirs.id]);
    const out = await say(helper, ['pull-back', mine.id]);
    assert.equal(out.code, 1);
    assert.equal(helper.held.some((e) => e.kind === 'ruling'), false);
  });
});

test('pull-back refuses a call made at the helm, saying it was the director\'s own', async () => {
  await inHome(async () => {
    const helper = fakeHelper([]);
    const mine = { id: 'abcdef12-0000-4000-8000-000000000000', work: 'w-tide-1', decided: 'Steered', kind: 'helm', where: 'helm' };
    helper.client.desk.read = async () => ({ ok: true, data: { calls: [mine] } });
    const out = await say(helper, ['pull-back', mine.id]);
    assert.equal(out.code, 1);
    assert.match(out.err, /your own|director's own/u);
    assert.equal(helper.held.some((e) => e.kind === 'ruling'), false);
  });
});
