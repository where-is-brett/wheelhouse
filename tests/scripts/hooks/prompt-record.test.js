// tests/scripts/hooks/prompt-record.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, sendPending, SIGNED_LABELS } from '../../../scripts/hooks/prompt-record.js';
import { makeEvent, eventPath, dataHash, confirmationFor } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { approvalLine, confirmLine, LIFT_STOP, runbookLine, ciPushLine, RUNBOOK_TITLES, replyCode, replyCodeLine, approveWorkLine, answerLine, amendLine, liftIncidentLine, incidentFixLine, unattendedBuildsLine } from '../../../scripts/state/card-lines.js';
import { profileDir, stateDir, stopFile, computerId } from '../../../scripts/lib/paths.js';
import { settingKey, UNATTENDED_CARD } from '../../../scripts/protection/windows-builds.js';

const P = 'owner__name';
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const NOW = new Date('2026-10-18T05:00:00.000Z');

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-pr-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function fake({ pr = { ok: true, result: { headSha: FULL, state: 'open' } }, refuse = false } = {}) {
  const calls = { write: [], record: [], profileRecord: [], prState: [] };
  const no = { ok: false, refused: 'no' };
  return {
    calls,
    prState: async (b) => { calls.prState.push(b); return pr; },
    state: {
      write: async (b) => { calls.write.push(b); return refuse ? no : { ok: true }; },
      record: async (b) => { calls.record.push(b); return refuse ? no : { ok: true }; },
    },
    profile: {
      record: async (b) => { calls.profileRecord.push(b); return refuse ? no : { ok: true }; },
    },
  };
}

const BUTTONS = ['Approve', 'Confirm', 'Lift STOP', 'Do it', 'Push it', 'Change it', 'End it', 'Merge the fix', 'Explain more', 'Not now'].map((label) => ({ label }));
const input = (answers, { multi = false, response = true, options = BUTTONS } = {}) => ({
  cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: Object.keys(answers).map((question) => ({ question, options, multiSelect: multi })), answers },
  ...(response ? { tool_response: { answers } } : {}),
});
const deps = (client) => ({ client, now: () => NOW, projectOf: () => ({ project: P }) });
const kinds = (c) => c.calls.record.map((r) => r.event.kind);

function keepEvent(event, dir = stateDir(P)) {
  const file = path.join(dir, eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
}

test('Approve on a card naming the pull request and its current head records a signed approval of the full head', async () => {
  await withHome(async () => {
    const c = fake();
    const q = `${approvalLine(7, FULL)}? It changes the sign-in.`;
    await decide(input({ [q]: 'Approve' }), deps(c));
    assert.deepEqual(c.calls.write.map((w) => [w.kind, w.data]), [['card-answer', { question: q, label: 'Approve' }]]);
    assert.deepEqual(c.calls.prState, [{ project: P, number: 7 }]);
    const [rec] = c.calls.record;
    assert.equal(rec.event.kind, 'approval');
    assert.deepEqual(rec.event.data, { pr: 7, commit: FULL, words: 'Approve', question: q });
    assert.ok(rec.event.sig);
  });
});

test('Approve when the head has moved since the card records no approval', async () => {
  await withHome(async () => {
    const c = fake({ pr: { ok: true, result: { headSha: '1'.repeat(40), state: 'open' } } });
    await decide(input({ [approvalLine(7, FULL)]: 'Approve' }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.write.length, 1);
    const closed = fake({ pr: { ok: true, result: { headSha: FULL, state: 'closed' } } });
    await decide(input({ [approvalLine(7, FULL)]: 'Approve' }), deps(closed));
    assert.equal(closed.calls.record.length, 0);
  });
});

test('Approve on a card that does not name the pull request records only the answer', async () => {
  await withHome(async () => {
    const c = fake();
    await decide(input({ 'Shall I go ahead with pull request 7?': 'Approve', [approvalLine(7, FULL)]: 'Explain more' }), deps(c));
    assert.equal(c.calls.write.length, 2);
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.prState.length, 0);
  });
});

test('Confirm records a confirmation only when the card quotes the ruling\'s words exactly', async () => {
  await withHome(async () => {
    const ruling = makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => NOW });
    keepEvent(ruling);
    const note = makeEvent({ kind: 'note', data: { words: 'x' }, now: () => NOW });
    keepEvent(note);
    const c = fake();
    await decide(input({
      [`${confirmLine(ruling)}?`]: 'Confirm',
      [`Confirm ruling ${ruling.id}: "Money is shown in euros"?`]: 'Confirm',
      [confirmLine(note)]: 'Confirm',
    }), deps(c));
    assert.deepEqual(kinds(c), ['confirmation']);
    assert.equal(c.calls.record[0].event.data.confirms, ruling.id);
    assert.equal(c.calls.write.length, 3);
  });
});

test('Lift STOP lifts it and records who clicked', async () => {
  await withHome(async () => {
    fs.writeFileSync(stopFile(), '{}');
    const c = fake();
    await decide(input({ [`${LIFT_STOP}?`]: 'Lift STOP' }), deps(c));
    assert.equal(fs.existsSync(stopFile()), false);
    assert.equal(c.calls.record[0].event.kind, 'action');
    assert.equal(c.calls.record[0].event.data.action, 'lift-stop');
    assert.ok(c.calls.record[0].event.sig);
  });
});

test('Do it on a runbook card records a signed runbook action with its step and commit', async () => {
  await withHome(async () => {
    const c = fake();
    await decide(input({
      [runbookLine(3, FULL)]: 'Do it',
      [runbookLine(1)]: 'Do it',
      [runbookLine(2)]: 'Not now',
    }), deps(c));
    assert.deepEqual(c.calls.record.map((r) => [r.event.data.action, r.event.data.step, r.event.data.sha]), [['runbook', 3, FULL.slice(0, 12)], ['runbook', 1, undefined]]);
    assert.equal(RUNBOOK_TITLES[5], 'Contain live harm');
  });
});

test('Push it on a CI card records a signed ci-push for that branch and commit', async () => {
  await withHome(async (home) => {
    const pending = path.join(home, 'projects', P, 'ci-pending.json');
    fs.mkdirSync(path.dirname(pending), { recursive: true });
    fs.writeFileSync(pending, JSON.stringify({
      'ci-fix': { branch: 'ci-fix', sha: FULL, at: '2026-10-18T01:00:00.000Z' },
      old: { branch: 'old', sha: FULL, at: '2026-10-16T01:00:00.000Z' },
    }));
    const c = fake();
    const q = ciPushLine('ci-fix', FULL);
    await decide(input({ [q]: 'Push it', [ciPushLine('old', FULL)]: 'Push it', [ciPushLine('ci-fix', '9'.repeat(40))]: 'Push it', [ciPushLine('other', FULL)]: 'Push it' }), deps(c));
    assert.equal(c.calls.record.length, 1);
    const { data } = c.calls.record[0].event;
    assert.deepEqual(data, { action: 'ci-push', branch: 'ci-fix', sha: FULL, question: q, label: 'Push it' });
    assert.equal(c.calls.write.length, 4);
  });
});

test('Explain more and Not now record only the answer', async () => {
  await withHome(async () => {
    const c = fake();
    await decide(input({ [approvalLine(7, FULL)]: 'Explain more', [LIFT_STOP]: 'Not now' }), deps(c));
    assert.equal(c.calls.write.length, 2);
    assert.equal(c.calls.record.length, 0);
  });
});

test('Lift STOP while STOP is off records only the answer', async () => {
  await withHome(async () => {
    const c = fake();
    let lifted = 0;
    await decide(input({ [LIFT_STOP]: 'Lift STOP' }), { ...deps(c), liftStop: () => { lifted += 1; } });
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.write.length, 1);
    assert.equal(lifted, 0);
    // The STOP state is read through the injected reader when one is given.
    const on = fake();
    await decide(input({ [LIFT_STOP]: 'Lift STOP' }), { ...deps(on), liftStop: () => { lifted += 1; }, stopState: () => ({ on: true }) });
    assert.deepEqual(on.calls.record.map((r) => r.event.data.action), ['lift-stop']);
    assert.equal(lifted, 1);
  });
});

test('one failing question does not stop the rest', async () => {
  await withHome(async () => {
    fs.writeFileSync(stopFile(), '{}'); // a Lift STOP earns its record only while STOP is on
    const c = fake();
    c.prState = async () => { throw new Error('x'); };
    await decide(input({ [approvalLine(7, FULL)]: 'Approve', [`${LIFT_STOP}`]: 'Lift STOP' }), deps(c));
    assert.equal(c.calls.record.length, 1);
    assert.equal(c.calls.write.length, 2);
  });
});

test('a record the helper cannot take is kept and sent later, oldest first', async () => {
  await withHome(async (home) => {
    fs.writeFileSync(stopFile(), '{}'); // a Lift STOP earns its record only while STOP is on
    const refusing = fake({ refuse: true });
    await decide(input({ [LIFT_STOP]: 'Lift STOP' }), deps(refusing));
    const folder = path.join(home, 'projects', P, 'pending');
    const files = fs.readdirSync(folder).sort();
    assert.equal(files.length, 2);
    const kept = files.map((f) => JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')));
    assert.deepEqual(kept.map((k) => k.route).sort(), ['record', 'write']);

    const failing = { state: { write: async () => ({ ok: false }), record: async () => { throw new Error('x'); } } };
    await sendPending(P, failing);
    assert.equal(fs.readdirSync(folder).length, 2);

    const order = [];
    const ok = { state: { write: async (b) => { order.push('w'); return { ok: true, b }; }, record: async (b) => { order.push('r'); return { ok: true, b }; } } };
    await sendPending(P, ok);
    assert.equal(fs.readdirSync(folder).length, 0);
    assert.equal(order.length, 2);
  });
});

test('sendPending sends oldest first and keeps what is refused', async () => {
  await withHome(async (home) => {
    const folder = path.join(home, 'projects', P, 'pending');
    fs.mkdirSync(folder, { recursive: true });
    const put = (name, body) => fs.writeFileSync(path.join(folder, name), JSON.stringify({ route: 'write', body }));
    put('2026-10-18T02-00-00.000Z-b.json', { n: 2 });
    put('2026-10-18T01-00-00.000Z-a.json', { n: 1 });
    put('2026-10-18T03-00-00.000Z-c.json', { n: 3 });
    const seen = [];
    const client = { state: { write: async (b) => { seen.push(b.n); return b.n === 2 ? { ok: false } : { ok: true }; }, record: async () => ({ ok: true }) } };
    await sendPending(P, client);
    assert.deepEqual(seen, [1, 2, 3]);
    assert.deepEqual(fs.readdirSync(folder), ['2026-10-18T02-00-00.000Z-b.json']);
  });
});

const one = (c) => c.calls.record.length;

test('a multi-select array is joined in the answer and never signed', async () => {
  await withHome(async () => {
    const c = fake();
    const q = approvalLine(7, FULL);
    await decide(input({ [q]: ['Approve', 'Not now'] }), deps(c));
    assert.equal(c.calls.write[0].data.label, 'Approve, Not now');
    await decide(input({ [q]: 'Approve' }, { multi: true }), deps(c));
    assert.equal(one(c), 0);
  });
});

test('typed "Other" text that reads Approve is not a click on a button', async () => {
  await withHome(async () => {
    const c = fake();
    const i = input({ [approvalLine(7, FULL)]: 'Approve' });
    i.tool_input.questions[0].options = [{ label: 'Explain more' }, { label: 'Not now' }];
    await decide(i, deps(c));
    assert.equal(one(c), 0);
    assert.equal(c.calls.write.length, 1);
  });
});

test('an answer that is not among the asked questions, or that the response contradicts, is not signed', async () => {
  await withHome(async () => {
    const c = fake();
    const q = approvalLine(7, FULL);
    const stray = input({ [q]: 'Approve' });
    stray.tool_input.questions = [];
    await decide(stray, deps(c));
    const split = input({ [q]: 'Approve' });
    split.tool_response = { answers: { [q]: 'Not now' } };
    await decide(split, deps(c));
    assert.equal(one(c), 0);
    const absent = input({ [q]: 'Approve' }, { response: false });
    await decide(absent, deps(c));
    assert.equal(one(c), 1);
  });
});

test('a card holding two approval lines, two CI lines or two runbook lines records nothing signed', async () => {
  await withHome(async (home) => {
    fs.mkdirSync(path.join(home, 'projects', P), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', P, 'ci-pending.json'), JSON.stringify({ a: { branch: 'a', sha: FULL, at: NOW.toISOString() } }));
    const c = fake();
    await decide(input({
      [`${approvalLine(7, FULL)} or ${approvalLine(8, FULL)}`]: 'Approve',
      [`${ciPushLine('a', FULL)} and ${ciPushLine('b', FULL)}`]: 'Push it',
      [`${runbookLine(1)} then ${runbookLine(2)}`]: 'Do it',
    }), deps(c));
    assert.equal(one(c), 0);
  });
});

test('an uppercase or over-long commit in the line does not count', async () => {
  await withHome(async () => {
    const c = fake();
    await decide(input({
      [`Approve pull request #7 at commit ${FULL.slice(0, 12).toUpperCase()}`]: 'Approve',
      [`Approve pull request #7 at commit ${FULL.slice(0, 13)}`]: 'Approve',
      [`Approve pull request #7 at commit ${FULL.slice(0, 7)}`]: 'Approve',
    }), deps(c));
    assert.equal(one(c), 0);
    assert.equal(c.calls.prState.length, 0);
  });
});

test('a runbook tail that does not parse, or step 3 without a commit, records nothing', async () => {
  await withHome(async () => {
    const c = fake();
    await decide(input({
      [`${runbookLine(3)}, to commit ${FULL.slice(0, 12).toUpperCase()}`]: 'Do it',
      [`${runbookLine(3)}, to commit ${FULL.slice(0, 7)}`]: 'Do it',
      [`${runbookLine(3)}`]: 'Do it',
      [`${runbookLine(4)}, to commit zzz`]: 'Do it',
    }), deps(c));
    assert.equal(one(c), 0);
  });
});

test('a resend of a record the state already holds counts as sent', async () => {
  await withHome(async (home) => {
    const refusing = fake({ refuse: true });
    await decide(input({ [LIFT_STOP]: 'Lift STOP' }), deps(refusing));
    const folder = path.join(home, 'projects', P, 'pending');
    const dup = { state: { write: async () => ({ ok: true }), record: async () => ({ ok: false, refused: 'the state already holds an event with that id' }) } };
    await sendPending(P, dup);
    assert.equal(fs.readdirSync(folder).length, 0);
  });
});

test('a pending file that will not parse is moved to bad/', async () => {
  await withHome(async (home) => {
    const folder = path.join(home, 'projects', P, 'pending');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '2026-10-18T01-00-00.000Z-a.json'), '{nope');
    await sendPending(P, fake());
    assert.deepEqual(fs.readdirSync(folder), ['bad']);
    assert.equal(fs.readdirSync(path.join(folder, 'bad')).length, 1);
  });
});

test('a lift that throws leaves no record behind', async () => {
  await withHome(async (home) => {
    fs.writeFileSync(stopFile(), '{}'); // a Lift STOP earns its record only while STOP is on
    const c = fake();
    await decide(input({ [LIFT_STOP]: 'Lift STOP' }), { ...deps(c), liftStop: () => { throw new Error('x'); } });
    assert.equal(one(c), 0);
    const folder = path.join(home, 'projects', P, 'pending');
    assert.deepEqual(fs.readdirSync(folder), []);
    assert.equal(c.calls.write.length, 1);
  });
});

test('a signed record is written down before it is sent and stays when the helper never answers', async () => {
  await withHome(async (home) => {
    fs.writeFileSync(stopFile(), '{}'); // a Lift STOP earns its record only while STOP is on
    const c = fake();
    c.state.record = () => new Promise(() => {});
    c.state.write = () => new Promise(() => {});
    const started = Date.now();
    await decide(input({ [LIFT_STOP]: 'Lift STOP' }), { ...deps(c), budget: 150 });
    assert.ok(Date.now() - started < 2000);
    const folder = path.join(home, 'projects', P, 'pending');
    const kept = fs.readdirSync(folder).map((f) => JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')));
    assert.deepEqual(kept.map((k) => k.route).sort(), ['record', 'write']);
    assert.equal(kept.find((k) => k.route === 'record').body.event.data.action, 'lift-stop');
  });
});

test('signed records go before the plain answers', async () => {
  await withHome(async () => {
    fs.writeFileSync(stopFile(), '{}'); // a Lift STOP earns its record only while STOP is on
    const c = fake();
    const order = [];
    c.state.record = async () => { order.push('record'); return { ok: true }; };
    c.state.write = async () => { order.push('write'); return { ok: true }; };
    await decide(input({ [LIFT_STOP]: 'Lift STOP' }), deps(c));
    assert.deepEqual(order, ['record', 'write']);
  });
});

test('sendPending stops between records once its deadline has passed and keeps the rest', async () => {
  await withHome(async (home) => {
    const folder = path.join(home, 'projects', P, 'pending');
    fs.mkdirSync(folder, { recursive: true });
    for (const n of [1, 2, 3]) fs.writeFileSync(path.join(folder, `2026-10-18T0${n}-00-00.000Z-a.json`), JSON.stringify({ route: 'write', body: { n } }));
    const seen = [];
    const client = { state: { write: async (b) => { seen.push(b.n); await new Promise((r) => setTimeout(r, 60)); return { ok: true }; }, record: async () => ({ ok: true }) } };
    const result = await sendPending(P, client, { until: Date.now() + 30 });
    assert.deepEqual(seen, [1]);
    assert.equal(result.sent, 1);
    assert.equal(fs.readdirSync(folder).length, 2);
  });
});

test('a Confirm line naming a profile setting records the confirmation through the profile', async () => {
  await withHome(async (home) => {
    const setting = makeEvent({ kind: 'setting', data: { key: 'briefing', value: 'short', words: 'Keep it short' }, now: () => NOW });
    keepEvent(setting, profileDir());
    const c = fake();
    await decide(input({ [`${confirmLine(setting)}?`]: 'Confirm' }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.profileRecord.length, 1);
    const [rec] = c.calls.profileRecord;
    assert.equal(rec.event.kind, 'confirmation');
    assert.equal(rec.event.data.confirms, setting.id);
    assert.ok(rec.event.sig);
    assert.equal(c.calls.write.length, 1, 'the answer itself goes to the project\'s state');

    // One the helper does not take is kept, and sent through the profile later.
    const refusing = fake({ refuse: true });
    await decide(input({ [confirmLine(setting)]: 'Confirm' }), deps(refusing));
    const folder = path.join(home, 'projects', P, 'pending');
    const kept = fs.readdirSync(folder).map((f) => JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')));
    assert.deepEqual(kept.map((k) => k.route).sort(), ['profile-record', 'write']);
    const later = fake();
    await sendPending(P, later);
    assert.equal(later.calls.profileRecord.length, 1);
    assert.equal(later.calls.record.length, 0);
    assert.deepEqual(fs.readdirSync(folder), []);
  });
});

test('a Confirm line that matches events in both the state and the profile records nothing', async () => {
  await withHome(async () => {
    // The same event in both.
    const setting = makeEvent({ kind: 'setting', data: { key: 'briefing', value: 'short' }, now: () => NOW });
    keepEvent(setting);
    keepEvent(setting, profileDir());
    // A card naming a state ruling and a profile setting at once.
    const ruling = makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => NOW });
    keepEvent(ruling);
    const other = makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build' }, now: () => NOW });
    keepEvent(other, profileDir());
    const c = fake();
    await decide(input({
      [confirmLine(setting)]: 'Confirm',
      [`${confirmLine(ruling)} and ${confirmLine(other)}`]: 'Confirm',
    }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.profileRecord.length, 0);
    assert.equal(c.calls.write.length, 2);
  });
});

// --- the Unattended card for build commands on Windows ---

const UNATTENDED = ['Keep asking', 'Turn on (dangerous)', 'Use Guarded'].map((label) => ({ label }));
const unattendedSetting = (computer, data = {}) => makeEvent({
  kind: 'setting', data: { key: settingKey(computer), value: 'unattended', words: 'Run build commands unattended', ...data }, now: () => NOW,
});

test('Turn on (dangerous) on the Unattended card records a confirmation carrying its line', async () => {
  await withHome(async () => {
    const me = computerId();
    const on = unattendedSetting(me);
    keepEvent(on);
    const line = unattendedBuildsLine(on.id, me);
    const c = fake();
    await decide(input({ [`${UNATTENDED_CARD().risk}\n${line}?`]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    assert.deepEqual(kinds(c), ['confirmation']);
    const [rec] = c.calls.record;
    assert.deepEqual(rec.event.data, { ...confirmationFor(on).data, line });
    assert.ok(rec.event.sig);
    assert.equal(c.calls.profileRecord.length, 0);
    assert.equal(c.calls.write.length, 1);
  });
});

test('Turn on (dangerous) records nothing without the line, for another computer\'s event, or for two events', async () => {
  await withHome(async () => {
    const me = computerId();
    const c = fake();
    // A question without the line.
    const on = unattendedSetting(me);
    keepEvent(on);
    await decide(input({ [`${confirmLine(on)}?`]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    // Another computer's event, under its own key or under this computer's.
    const theirs = { ...unattendedSetting('deadbeef'), computer: 'deadbeef' };
    keepEvent(theirs);
    await decide(input({ [unattendedBuildsLine(theirs.id, 'deadbeef')]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    const forged = { ...unattendedSetting(me), computer: 'deadbeef' };
    keepEvent(forged);
    await decide(input({ [unattendedBuildsLine(forged.id, me)]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    // A value other than unattended.
    const guarded = unattendedSetting(me, { value: 'guarded' });
    keepEvent(guarded);
    await decide(input({ [unattendedBuildsLine(guarded.id, me)]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    // A question naming two events.
    const second = unattendedSetting(me);
    keepEvent(second);
    await decide(input({ [`${unattendedBuildsLine(on.id, me)} and ${unattendedBuildsLine(second.id, me)}`]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    // The line clicked with another label.
    await decide(input({ [unattendedBuildsLine(on.id, me)]: 'Keep asking' }, { options: UNATTENDED }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.profileRecord.length, 0);
    assert.equal(c.calls.write.length, 6);
  });
});

test('Turn on (dangerous) records nothing from a card without the design\'s words on the risk', async () => {
  await withHome(async () => {
    const me = computerId();
    const on = unattendedSetting(me);
    keepEvent(on);
    const line = unattendedBuildsLine(on.id, me);
    const c = fake();
    await decide(input({ [`Let builders run their tests.\n${line}`]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    const cut = UNATTENDED_CARD().risk.slice(0, -40);
    await decide(input({ [`${cut}\n${line}`]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.write.length, 2);
    // With them, as the foreman's card writes them, it confirms.
    await decide(input({ [`What this is: ${UNATTENDED_CARD().what} ${UNATTENDED_CARD().risk}\n${line}`]: 'Turn on (dangerous)' }, { options: UNATTENDED }), deps(c));
    assert.deepEqual(c.calls.record.map((r) => r.event.kind), ['confirmation']);
  });
});

// --- the build loop's clicks ---

const DOC = 'fedcba9876543210'.repeat(4);
const NEW_DOC = '0123456789abcdef'.repeat(4);
const workEvent = (data = {}) => makeEvent({
  kind: 'work',
  data: { id: 'export-csv', title: 'Export', lane: 'feature', doc: { path: 'd.md', hash: DOC }, visible: true, dependsOn: [], ...data },
  now: () => NOW,
});
const recorded = (c) => c.calls.record.map((r) => r.event.data);

test('Approve on a card with approveWorkLine records approve-work with the lane, the full hash and shown-first', async () => {
  await withHome(async () => {
    keepEvent(workEvent());
    const c = fake();
    const plain = `${approveWorkLine('export-csv', 'feature', DOC)}? It adds an export.`;
    const first = `${approveWorkLine('export-csv', 'feature', DOC, { shownFirst: true })}?`;
    await decide(input({ [plain]: 'Approve', [first]: 'Approve' }), deps(c));
    assert.deepEqual(recorded(c), [
      { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: DOC, shownFirst: false, question: plain, label: 'Approve' },
      { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: DOC, shownFirst: true, question: first, label: 'Approve' },
    ]);
    assert.ok(c.calls.record.every((r) => r.event.kind === 'action' && r.event.sig));
    assert.equal(c.calls.prState.length, 0);
    assert.equal(c.calls.write.length, 2);
  });
});

const CODED = ['Approve', 'Lift STOP', 'Explain more', 'Not now'].map((label) => ({ label }));
const coded = (answers, { multi = false } = {}) => {
  const asked = input(answers, { multi });
  asked.tool_input.questions = asked.tool_input.questions.map((q) => ({ ...q, options: CODED }));
  return asked;
};

test('a card with a set line and its code becomes a signed shown record; one with a wrong code does not', async () => {
  await withHome(async (home) => {
    const line = approvalLine(12, FULL);
    const code = replyCode(line);
    const good = `Pull request 12 changes the sign-in.\n${line}\n${replyCodeLine(code)}`;
    const wrong = `${approvalLine(13, FULL)}\n${replyCodeLine(code)}`;
    const none = `${LIFT_STOP}`;
    const c = fake();
    await decide(coded({ [good]: 'Not now', [wrong]: 'Not now', [none]: 'Not now' }), deps(c));
    const shown = c.calls.record.filter((r) => r.event.kind === 'shown');
    assert.equal(shown.length, 1);
    assert.deepEqual(shown[0].event.data, { code, question: good, options: CODED.map((b) => b.label) });
    assert.equal(shown[0].project, P);
    assert.ok(shown[0].event.sig);
    assert.equal(c.calls.write.length, 3);

    // A click that earns a record sorts after the card's shown record, so it spends the code.
    const click = fake();
    await decide(coded({ [good]: 'Approve' }), deps(click));
    assert.deepEqual(kinds(click), ['shown', 'approval']);
    const [s, a] = click.calls.record.map((r) => r.event);
    assert.ok(s.at < a.at);

    // A multi-select card, or one already in the shown view with this question, writes no shown record.
    const multi = fake();
    await decide(coded({ [good]: ['Approve'] }, { multi: true }), deps(multi));
    assert.equal(multi.calls.record.length, 0);
    const views = path.join(home, 'projects', P, 'views');
    fs.mkdirSync(views, { recursive: true });
    fs.writeFileSync(path.join(views, 'shown.json'), JSON.stringify({ [code]: { id: 'x', at: NOW.toISOString(), question: good, options: ['Approve', 'Not now'], spent: false } }));
    const again = fake();
    await decide(coded({ [good]: 'Not now' }), deps(again));
    assert.equal(again.calls.record.length, 0);
    fs.writeFileSync(path.join(views, 'shown.json'), JSON.stringify({ [code]: { id: 'x', at: NOW.toISOString(), question: 'Another?', options: ['A', 'B'], spent: false } }));
    const other = fake();
    await decide(coded({ [good]: 'Not now' }), deps(other));
    assert.deepEqual(kinds(other), ['shown']);
    // A held record for this question that is spent, or out of date, gives way to a new one.
    fs.writeFileSync(path.join(views, 'shown.json'), JSON.stringify({ [code]: { id: 'x', at: NOW.toISOString(), question: good, options: ['Approve', 'Not now'], spent: true } }));
    const spent = fake();
    await decide(coded({ [good]: 'Not now' }), deps(spent));
    assert.deepEqual(kinds(spent), ['shown']);
    fs.writeFileSync(path.join(views, 'shown.json'), JSON.stringify({ [code]: { id: 'x', at: '2026-10-01T00:00:00.000Z', question: good, options: ['Approve', 'Not now'], spent: false } }));
    const old = fake();
    await decide(coded({ [good]: 'Not now' }), deps(old));
    assert.deepEqual(kinds(old), ['shown']);
  });
});

test('a shown record the helper cannot take is kept pending like every signed record', async () => {
  await withHome(async () => {
    const line = LIFT_STOP;
    const q = `${line}\n${replyCodeLine(replyCode(line))}`;
    const c = fake({ refuse: true });
    await decide(coded({ [q]: 'Not now' }), deps(c));
    const folder = path.join(stateDir(P), '..', 'pending');
    const kept = fs.readdirSync(folder).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(folder, n), 'utf8')));
    assert.deepEqual(kept.filter((k) => k.route === 'record').map((k) => k.body.event.kind), ['shown']);
  });
});

// The build loop's own labels earn records from a click only: their lines aren't set lines yet.
// Unattended for build commands on Windows is set only by a click on its own card.
const CLICK_ONLY = ['Change it', 'End it', 'Merge the fix', 'Turn on (dangerous)'];

test('every label the prompt record can sign for is in SIGNED_LABELS, or one the build loop answers by click only', () => {
  const source = fs.readFileSync(new URL('../../../scripts/hooks/prompt-record.js', import.meta.url), 'utf8');
  const handled = [...source.matchAll(/label === '([^']+)'/g)].map((m) => m[1]);
  assert.ok(handled.length >= 5);
  assert.deepEqual([...new Set(handled)].filter((l) => !CLICK_ONLY.includes(l)).sort(), [...SIGNED_LABELS].sort());
  assert.ok(CLICK_ONLY.every((l) => handled.includes(l)));
});

test('Approve on a work card records nothing when the work, its lane or its document is not what the card says', async () => {
  await withHome(async () => {
    keepEvent(workEvent());
    const c = fake();
    await decide(input({
      [approveWorkLine('other-work', 'feature', DOC)]: 'Approve',
      [approveWorkLine('export-csv', 'small', DOC)]: 'Approve',
      [approveWorkLine('export-csv', 'feature', NEW_DOC)]: 'Approve',
      [`${approveWorkLine('export-csv', 'feature', DOC)} or ${approveWorkLine('export-csv', 'feature', DOC, { shownFirst: true })}`]: 'Approve',
      [`${approveWorkLine('export-csv', 'feature', DOC)} and ${approvalLine(7, FULL)}`]: 'Approve',
      [`Approve export-csv (feature lane) as written, ${DOC.slice(0, 12).toUpperCase()}`]: 'Approve',
      [`Approve export-csv (feature lane) as written, ${DOC.slice(0, 7)}`]: 'Approve',
      [approveWorkLine('export-csv', 'feature', DOC)]: 'Explain more',
    }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.write.length, 8);
  });
});

test('Approve on a work card names the document in the latest work event, not an earlier one', async () => {
  await withHome(async () => {
    const older = workEvent();
    keepEvent(older);
    keepEvent(makeEvent({ kind: 'work', data: { ...older.data, doc: { path: 'd.md', hash: NEW_DOC } }, now: () => new Date(NOW.getTime() + 1000) }));
    const c = fake();
    await decide(input({ [approveWorkLine('export-csv', 'feature', DOC)]: 'Approve', [approveWorkLine('export-csv', 'feature', NEW_DOC)]: 'Approve' }), deps(c));
    assert.deepEqual(recorded(c).map((d) => d.hash), [NEW_DOC]);
  });
});

const QUESTION = { id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: 'It changes the file', options: [{ label: 'Comma', says: 'Commas' }, { label: 'Tab', says: 'Tabs' }], recommendation: 'Comma', level: 2 };
const OPTIONS = ['Comma', 'Tab', 'Explain more', 'Not now'].map((label) => ({ label }));

test('a click on an answer card records the label; Explain more and Not now record only the card answer', async () => {
  await withHome(async () => {
    keepEvent(makeEvent({ kind: 'question', data: QUESTION, now: () => NOW }));
    const c = fake();
    const q = `Which separator should the export use? ${answerLine('q-export-csv-1')}`;
    await decide(input({ [q]: 'Tab' }, { options: OPTIONS }), deps(c));
    assert.deepEqual(recorded(c), [{ action: 'answer', questionId: 'q-export-csv-1', questionHash: dataHash(QUESTION), question: q, label: 'Tab' }]);
    assert.equal(c.calls.record[0].event.kind, 'action');
    assert.ok(c.calls.record[0].event.sig);
    assert.deepEqual(c.calls.write.map((w) => w.data.label), ['Tab']);

    const other = fake();
    await decide(input({ [q]: 'Explain more', [`${q} again`]: 'Not now' }, { options: OPTIONS }), deps(other));
    assert.equal(other.calls.record.length, 0);
    assert.equal(other.calls.write.length, 2);
  });
});

test('an answer card records nothing for a question that is not in the state, an option it does not offer, or two question lines', async () => {
  await withHome(async () => {
    keepEvent(makeEvent({ kind: 'question', data: QUESTION, now: () => NOW }));
    const c = fake();
    await decide(input({
      [answerLine('q-export-csv-2')]: 'Tab',
      [answerLine('q-export-csv-1')]: 'Semicolon',
      [`${answerLine('q-export-csv-1')} then ${answerLine('q-export-csv-2')}`]: 'Tab',
      [`Answer question q-export-csv-1x`]: 'Tab',
    }, { options: [...OPTIONS, { label: 'Semicolon' }] }), deps(c));
    assert.equal(c.calls.record.length, 0);
    // Typed text is no button.
    await decide(input({ [answerLine('q-export-csv-1')]: 'Tab' }, { options: [{ label: 'Comma' }] }), deps(c));
    assert.equal(c.calls.record.length, 0);
  });
});

test('a card with an answer line is an answer card whatever else its text says', async () => {
  await withHome(async () => {
    keepEvent(makeEvent({ kind: 'question', data: { ...QUESTION, options: [{ label: 'Approve', says: 'Yes' }, { label: 'Lift STOP', says: 'No' }] }, now: () => NOW }));
    fs.writeFileSync(stopFile(), '{}');
    const c = fake();
    const q = `${answerLine('q-export-csv-1')}. ${approvalLine(7, FULL)}. ${LIFT_STOP}`;
    await decide(input({ [q]: 'Approve' }), deps(c));
    await decide(input({ [`${q}!`]: 'Lift STOP' }), deps(c));
    assert.deepEqual(recorded(c).map((d) => [d.action, d.label]), [['answer', 'Approve'], ['answer', 'Lift STOP']]);
    assert.equal(fs.existsSync(stopFile()), true);
    assert.equal(c.calls.prState.length, 0);
  });
});

test('Change it on a card with amendLine records amend with the full hash of a proposed change', async () => {
  await withHome(async () => {
    keepEvent(makeEvent({ kind: 'amendment', data: { work: 'export-csv', change: 'CSV, not Excel', hash: NEW_DOC }, now: () => NOW }));
    const c = fake();
    const q = `${amendLine('export-csv', NEW_DOC)}?`;
    await decide(input({
      [q]: 'Change it',
      [amendLine('export-csv', DOC)]: 'Change it',
      [amendLine('other', NEW_DOC)]: 'Change it',
      [amendLine('export-csv', NEW_DOC)]: 'Explain more',
      [`${amendLine('export-csv', NEW_DOC)} and ${amendLine('export-csv', DOC)}`]: 'Change it',
    }), deps(c));
    assert.deepEqual(recorded(c), [{ action: 'amend', work: 'export-csv', hash: NEW_DOC, question: q, label: 'Change it' }]);
  });
});

test('End it and Merge the fix record only for a declared incident, with the pull request the card names', async () => {
  await withHome(async () => {
    keepEvent(makeEvent({ kind: 'incident', data: { id: 'bad-total', what: 'Totals are wrong' }, now: () => NOW }));
    const c = fake();
    const lift = `${liftIncidentLine('bad-total')}?`;
    const fix = `${incidentFixLine('bad-total', 31)}?`;
    await decide(input({
      [lift]: 'End it',
      [fix]: 'Merge the fix',
      [liftIncidentLine('unknown')]: 'End it',
      [incidentFixLine('unknown', 31)]: 'Merge the fix',
      [liftIncidentLine('bad-total')]: 'Not now',
      [`${incidentFixLine('bad-total', 31)} or ${incidentFixLine('bad-total', 32)}`]: 'Merge the fix',
      [`${liftIncidentLine('bad-total')} and ${liftIncidentLine('other')}`]: 'End it',
      [`Merge pull request #031 as the fix for incident bad-total`]: 'Merge the fix',
      [`${incidentFixLine('bad-total', 31)}x`]: 'Merge the fix',
    }), deps(c));
    assert.deepEqual(recorded(c), [
      { action: 'lift-incident', incident: 'bad-total', question: lift, label: 'End it' },
      { action: 'incident-fix', incident: 'bad-total', pr: 31, question: fix, label: 'Merge the fix' },
    ]);
  });
});

test('the new clicks are signed only on a card whose button the card offered', async () => {
  await withHome(async () => {
    keepEvent(workEvent());
    keepEvent(makeEvent({ kind: 'incident', data: { id: 'bad-total', what: 'x' }, now: () => NOW }));
    const c = fake();
    const i = input({ [approveWorkLine('export-csv', 'feature', DOC)]: 'Approve', [liftIncidentLine('bad-total')]: 'End it' });
    i.tool_input.questions.forEach((q) => { q.options = [{ label: 'Explain more' }]; });
    await decide(i, deps(c));
    await decide(input({ [approveWorkLine('export-csv', 'feature', DOC)]: ['Approve'] }), deps(c));
    await decide(input({ [approveWorkLine('export-csv', 'feature', DOC)]: 'Approve' }, { multi: true }), deps(c));
    assert.equal(c.calls.record.length, 0);
  });
});

test('an answer names the question as it stands now, when the question was recorded twice', async () => {
  await withHome(async () => {
    keepEvent(makeEvent({ kind: 'question', data: QUESTION, now: () => NOW }));
    const rewritten = { ...QUESTION, options: [{ label: 'Tab', says: 'Tabs, always' }, { label: 'Semicolon', says: 'Semicolons' }] };
    keepEvent(makeEvent({ kind: 'question', data: rewritten, now: () => new Date(NOW.getTime() + 1000) }));
    const c = fake();
    await decide(input({ [answerLine('q-export-csv-1')]: 'Tab' }, { options: OPTIONS }), deps(c));
    assert.deepEqual(recorded(c).map((d) => d.questionHash), [dataHash(rewritten)]);
    // Comma is no longer an option of the question as it stands.
    await decide(input({ [answerLine('q-export-csv-1')]: 'Comma' }, { options: OPTIONS }), deps(c));
    assert.equal(c.calls.record.length, 1);
  });
});
