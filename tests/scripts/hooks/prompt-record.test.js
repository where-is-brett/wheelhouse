// tests/scripts/hooks/prompt-record.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, sendPending, SIGNED_LABELS } from '../../../scripts/hooks/prompt-record.js';
import { makeEvent, eventPath, dataHash, confirmationFor, eventHash, listEvents } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { approvalLine, confirmLine, LIFT_STOP, runbookLine, ciPushLine, RUNBOOK_TITLES, replyCode, replyCodeLine, approveWorkLine, answerLine, amendLine, liftIncidentLine, incidentFixLine, unattendedBuildsLine, setupLine, setLineOf, uninstallLine } from '../../../scripts/state/card-lines.js';
import { profileDir, stateDir, stopFile, computerId } from '../../../scripts/lib/paths.js';
import { settingKey, UNATTENDED_CARD } from '../../../scripts/protection/windows-builds.js';
import { startRun, markStep, addChanges, newId } from '../../../scripts/setup/journal.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { clicksDir, noteShown, noteAsked, noteUninstallShown, uninstallShownFor, freshUninstallClicks, useClick } from '../../../scripts/setup/clicks.js';
import { CLICK_FRESH_MS } from '../../../scripts/lib/setup-numbers.js';
import { decide as sessionStart } from '../../../scripts/hooks/session-start.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { listHash } from '../../../scripts/lib/setup-writes.js';
import { rulesInput } from '../../helpers/rules-card.js';
import { beforeTimer } from '../../helpers/until.js';
import { nudgeCard } from '../../../scripts/routing/nudge.js';
import { buildViews } from '../../../scripts/state/views.js';

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

test('Keep as is on a proposal\'s confirm card records only the answer, and signs nothing', async () => {
  await withHome(async () => {
    const setting = makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build', words: 'Board opens on: build', because: 'you asked for it' }, now: () => NOW });
    keepEvent(setting, profileDir());
    const c = fake();
    const options = ['Confirm', 'Not now', 'Explain more', 'Keep as is'].map((label) => ({ label }));
    await decide(input({ [confirmLine(setting)]: 'Keep as is' }, { options }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.profileRecord.length, 0);
    assert.deepEqual(c.calls.write.map((w) => w.data), [{ question: confirmLine(setting), label: 'Keep as is' }]);
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
    const decided = await beforeTimer(() => decide(input({ [LIFT_STOP]: 'Lift STOP' }), { ...deps(c), budget: 150 }), 2000);
    assert.equal(decided.inTime, true, 'the budget cut the waiting short');
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
    // The deadline leaves a wide margin for the first send to start under load, and the helper
    // answers only once the deadline has passed, so the check before the second record always
    // finds it past.
    const until = Date.now() + 1000;
    const seen = [];
    const pastDeadline = async () => {
      while (Date.now() <= until) await new Promise((r) => setTimeout(r, until - Date.now() + 5));
    };
    const client = { state: { write: async (b) => { seen.push(b.n); await pastDeadline(); return { ok: true }; }, record: async () => ({ ok: true }) } };
    const result = await sendPending(P, client, { until });
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

test('Use Guarded on the Unattended card records an ordinary confirmation of its Guarded setting event', async () => {
  await withHome(async () => {
    const me = computerId();
    const on = unattendedSetting(me);
    const guarded = makeEvent({ kind: 'setting', data: { key: settingKey(me), value: 'guarded' }, now: () => NOW });
    keepEvent(on);
    keepEvent(guarded);
    const card = `What this is: ${UNATTENDED_CARD({ guardedReady: true }).what}\n${unattendedBuildsLine(on.id, me)}\n${confirmLine(guarded)}`;
    const c = fake();
    await decide(input({ [card]: 'Use Guarded' }, { options: UNATTENDED }), deps(c));
    assert.deepEqual(kinds(c), ['confirmation']);
    const [rec] = c.calls.record;
    assert.deepEqual(rec.event.data, confirmationFor(guarded).data, 'no line: Guarded counts from an ordinary confirmation');
    assert.ok(rec.event.sig);
  });
});

test('Use Guarded records nothing without exactly one confirm line for this computer\'s own Guarded event', async () => {
  await withHome(async () => {
    const me = computerId();
    const c = fake();
    const guarded = makeEvent({ kind: 'setting', data: { key: settingKey(me), value: 'guarded' }, now: () => NOW });
    keepEvent(guarded);
    const unattended = unattendedSetting(me);
    keepEvent(unattended);
    const theirs = { ...makeEvent({ kind: 'setting', data: { key: settingKey('deadbeef'), value: 'guarded' }, now: () => NOW }), computer: 'deadbeef' };
    keepEvent(theirs);
    const forged = { ...makeEvent({ kind: 'setting', data: { key: settingKey(me), value: 'guarded' }, now: () => NOW }), computer: 'deadbeef' };
    keepEvent(forged);
    const other = makeEvent({ kind: 'setting', data: { key: 'compactPrepare', value: 150000 }, now: () => NOW });
    keepEvent(other);
    for (const question of [
      'Use Guarded for build commands?', // no line
      confirmLine(unattended), // a setting event for Unattended
      confirmLine(theirs), // another computer's
      confirmLine(forged), // this computer's key, written elsewhere
      confirmLine(other), // another setting
      `${confirmLine(guarded)}\n${confirmLine(other)}`, // two lines
      `Confirm setting ${guarded.id}: "something else"`, // the event's id with other words
    ]) {
      await decide(input({ [question]: 'Use Guarded' }, { options: UNATTENDED }), deps(c));
    }
    // The line clicked with another label confirms nothing either.
    await decide(input({ [confirmLine(guarded)]: 'Keep asking' }, { options: UNATTENDED }), deps(c));
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.write.length, 8);
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

// Unattended for build commands on Windows is set only by a click on its own card.
const CLICK_ONLY = ['Turn on (dangerous)'];

test('every label the prompt record can sign for is in SIGNED_LABELS, or one answered by click only', () => {
  const source = fs.readFileSync(new URL('../../../scripts/hooks/prompt-record.js', import.meta.url), 'utf8');
  const handled = [...source.matchAll(/label === '([^']+)'/g)].map((m) => m[1]);
  assert.ok(handled.length >= 5);
  assert.deepEqual([...new Set(handled)].filter((l) => !CLICK_ONLY.includes(l)).sort(), [...SIGNED_LABELS].sort());
  assert.ok(CLICK_ONLY.every((l) => handled.includes(l) && !SIGNED_LABELS.includes(l)));
  assert.ok(['Change it', 'End it', 'Merge the fix'].every((l) => SIGNED_LABELS.includes(l)));
  // Deciding labels only: never one that asks for more or puts a card off.
  assert.ok(['Explain more', 'Not now', 'Show me', 'Why?', 'Suggest a change…'].every((l) => !SIGNED_LABELS.includes(l)));
});

test('a card with one of the build loop\'s lines and its code becomes a signed shown record', async () => {
  await withHome(async () => {
    const lines = [
      approveWorkLine('export-csv', 'feature', DOC),
      approveWorkLine('export-csv', 'feature', DOC, { shownFirst: true }),
      answerLine('q-export-csv-1'),
      amendLine('export-csv', NEW_DOC),
      liftIncidentLine('bad-total'),
      incidentFixLine('bad-total', 31),
    ];
    const questions = lines.map((line) => `What this is.\n${line}\n${replyCodeLine(replyCode(line))}`);
    const c = fake();
    await decide(coded(Object.fromEntries(questions.map((q) => [q, 'Not now']))), deps(c));
    const shown = c.calls.record.filter((r) => r.event.kind === 'shown');
    assert.deepEqual(shown.map((r) => r.event.data), questions.map((question, i) => ({ code: replyCode(lines[i]), question, options: CODED.map((b) => b.label) })));
    assert.ok(shown.every((r) => r.event.sig));
    // A near miss earns none: a short hash, an unknown lane, two lines.
    const near = [
      `${approveWorkLine('export-csv', 'feature', DOC).replace(DOC.slice(0, 12), DOC.slice(0, 7))}\nReply code: AAAA`,
      `${approveWorkLine('export-csv', 'huge', DOC)}\nReply code: ${replyCode(approveWorkLine('export-csv', 'huge', DOC))}`,
      `${liftIncidentLine('a')}\n${incidentFixLine('a', 3)}\n${replyCodeLine(replyCode(liftIncidentLine('a')))}`,
    ];
    const none = fake();
    await decide(coded(Object.fromEntries(near.map((q) => [q, 'Not now']))), deps(none));
    assert.equal(none.calls.record.length, 0);
  });
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

    // Show me puts a card off too, even when the question holds an option of that name.
    keepEvent(makeEvent({ kind: 'question', data: { ...QUESTION, options: [...QUESTION.options, { label: 'Show me', says: 'A sample' }] }, now: () => new Date(NOW.getTime() + 1000) }));
    const sample = fake();
    await decide(input({ [q]: 'Show me' }, { options: [...OPTIONS, { label: 'Show me' }] }), deps(sample));
    assert.equal(sample.calls.record.length, 0);
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

// --- Setup clicks: kept in <wheelhouseHome()>/setup/clicks/, signed, naming the list's full hash.

const H = 'ab'.repeat(32);
const setupCard = (step, hash) => `What this is: Setup step ${step}.\n${setupLine(step, hash)}\n${replyCodeLine(replyCode(setupLine(step, hash)))}`;
const SETUP_BUTTONS = [...BUTTONS, { label: 'Go ahead' }];
const clicks = () => {
  try {
    return fs.readdirSync(clicksDir()).map((name) => JSON.parse(fs.readFileSync(path.join(clicksDir(), name), 'utf8')));
  } catch {
    return [];
  }
};

test('in a folder being set up, the helper starts and a setup click is recorded; no other click is', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup zoë ')));
    try {
      const run = startRun({ folder, now: () => NOW });
      noteShown({ runId: run.id, folder, step: 3, hash: H, card: { question: setupCard(3, H), options: SETUP_BUTTONS }, now: () => NOW });
      noteShown({ runId: run.id, folder, step: 4, hash: H, card: { question: setupCard(4, H), options: SETUP_BUTTONS }, now: () => NOW });
      // The session start starts the helper there, as in a project.
      const spawned = [];
      await sessionStart({ cwd: folder, session_id: 's1' }, {
        client: { health: async () => ({ ok: spawned.length > 0 }) },
        spawn: (...args) => { spawned.push(args); return { unref() {}, on() {} }; },
        projectOf: () => null, pause: async () => {}, startWaitMs: 200, pluginRoot: '/plugin/root', stopState: () => ({ on: false }),
      });
      assert.equal(spawned.length, 1);

      fs.writeFileSync(stopFile(), '{}');
      const c = fake();
      const here = (answers, options = SETUP_BUTTONS) => ({ ...input(answers, { options }), cwd: folder });
      await decide(here({
        [setupCard(3, H)]: 'Go ahead', [approvalLine(7, FULL)]: 'Approve', [`${LIFT_STOP}?`]: 'Lift STOP', [runbookLine(1)]: 'Do it',
      }), { client: c, now: () => NOW, projectOf: () => null });
      // Exactly one record: the setup click, signed by this computer, naming the step and the full hash.
      const [only, ...rest] = clicks();
      assert.deepEqual(rest, []);
      assert.equal(only.kind, 'action');
      assert.deepEqual(only.data, { action: 'setup', runId: run.id, step: 3, hash: H, question: setupCard(3, H), label: 'Go ahead' });
      assert.equal(only.at, NOW.toISOString());
      assert.equal(verify(only, readEnrolled()), true);
      // Nothing else is recorded there: no answer, no signed record, no question to the host, and STOP stays on.
      assert.deepEqual(c.calls, { write: [], record: [], profileRecord: [], prState: [] });
      assert.equal(fs.existsSync(stopFile()), true);

      // A put-off, a list this folder was never shown, a step not shown, a card reworded around the
      // right set line (its text, an option's description, or a header added), a card with two set
      // lines, and a button the card did not offer record nothing.
      await decide(here({ [setupCard(3, H)]: 'Not now' }), { client: c, now: () => NOW, projectOf: () => null });
      await decide(here({ [setupCard(3, 'cd'.repeat(32))]: 'Go ahead' }), { client: c, now: () => NOW, projectOf: () => null });
      await decide(here({ [setupCard(6, H)]: 'Go ahead' }), { client: c, now: () => NOW, projectOf: () => null });
      await decide(here({ [setupCard(4, H).replace('Setup step 4.', 'Setup step 4: nothing changes.')]: 'Go ahead' }), { client: c, now: () => NOW, projectOf: () => null });
      const reworded = SETUP_BUTTONS.map((o) => (o.label === 'Go ahead' ? { ...o, description: 'Setup changes nothing on this computer.' } : o));
      await decide(here({ [setupCard(4, H)]: 'Go ahead' }, reworded), { client: c, now: () => NOW, projectOf: () => null });
      const headed = here({ [setupCard(4, H)]: 'Go ahead' });
      headed.tool_input.questions[0].header = 'Nothing';
      await decide(headed, { client: c, now: () => NOW, projectOf: () => null });
      await decide(here({ [`${setupCard(3, H)}\n${approvalLine(7, FULL)}`]: 'Go ahead' }), { client: c, now: () => NOW, projectOf: () => null });
      await decide(here({ [setupCard(3, H)]: 'Go ahead' }, BUTTONS), { client: c, now: () => NOW, projectOf: () => null });
      assert.equal(clicks().length, 1);
      assert.deepEqual(c.calls, { write: [], record: [], profileRecord: [], prState: [] });
      // Step 4's card exactly as shown is recorded.
      await decide(here({ [setupCard(4, H)]: 'Go ahead' }), { client: c, now: () => NOW, projectOf: () => null });
      assert.deepEqual(clicks().map((e) => e.data.step).sort(), [3, 4]);

      // From a session in another folder being set up, the card shown for this one records nothing.
      const other = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-other-')));
      startRun({ folder: other, now: () => NOW });
      await decide({ ...input({ [setupCard(3, H)]: 'Go ahead' }, { options: SETUP_BUTTONS }), cwd: other }, { client: c, now: () => NOW, projectOf: () => null });
      assert.equal(clicks().length, 2);
      fs.rmSync(other, { recursive: true, force: true });
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('in a registered project a setup click is kept in setup/clicks, and the answer goes to the state as usual', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup-p-')));
    try {
      const run = startRun({ folder, now: () => NOW });
      noteShown({ runId: run.id, folder, step: 5, hash: H, card: { question: setupCard(5, H), options: SETUP_BUTTONS }, now: () => NOW });
      const c = fake();
      await decide({ ...input({ [setupCard(5, H)]: 'Go ahead' }, { options: SETUP_BUTTONS }), cwd: folder }, deps(c));
      assert.deepEqual(clicks().map((e) => [e.data.step, e.data.hash]), [[5, H]]);
      assert.equal(c.calls.record.filter((r) => r.event.kind === 'action').length, 0, 'the setup click is not sent to the state');
      assert.deepEqual(c.calls.write.map((w) => w.data.label), ['Go ahead']);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('in a registered folder setup is still finishing, a setup click is kept, with or without its first commit', async () => {
  await withHome(async () => {
    const made = [];
    try {
      for (const git of [false, true]) {
        const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `wh-registered${git ? '-git' : ''} zoë `)));
        made.push(folder);
        if (git) fs.mkdirSync(path.join(folder, '.git'));
        writeProject(git ? 'o__git' : 'o__new', { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
        const run = startRun({ folder, now: () => NOW });
        for (const n of [1, 2, 3]) markStep(run.id, n, 'doneAt', { now: () => NOW });
        noteShown({ runId: run.id, folder, step: 4, hash: H, card: { question: setupCard(4, H), options: SETUP_BUTTONS }, now: () => NOW });
        const before = clicks().length;
        // The hook as it runs: the folder is placed by itself, not by a stand-in.
        await decide({ ...input({ [setupCard(4, H)]: 'Go ahead' }, { options: SETUP_BUTTONS }), cwd: folder }, { client: fake(), now: () => NOW });
        const kept = clicks();
        assert.equal(kept.length, before + 1, git ? 'with .git' : 'without .git');
        assert.equal(kept.find((e) => e.data.runId === run.id)?.data.step, 4);
      }
      // Once every step is done, a folder with no .git yet is left alone again.
      const done = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-done-')));
      made.push(done);
      writeProject('o__done', { folder: done, remoteUrl: 'https://example.com/o/d.git', host: 'github', repo: 'o/d', connection: {} });
      const run = startRun({ folder: done, now: () => NOW });
      for (let n = 1; n <= 10; n += 1) markStep(run.id, n, 'doneAt', { now: () => NOW });
      // Step 10 is done once its board has been green (ruling R67).
      addChanges(run.id, [{ id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: NOW.toISOString() } }]);
      noteShown({ runId: run.id, folder: done, step: 4, hash: H, card: { question: setupCard(4, H), options: SETUP_BUTTONS }, now: () => NOW });
      const before = clicks().length;
      await decide({ ...input({ [setupCard(4, H)]: 'Go ahead' }, { options: SETUP_BUTTONS }), cwd: done }, { client: fake(), now: () => NOW });
      assert.equal(clicks().length, before);
    } finally {
      for (const folder of made) fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('a click on the Unattended card records nothing in a folder with no project record, and counts as usual in a registered folder being set up', async () => {
  await withHome(async (home) => {
    const me = computerId();
    const made = [];
    try {
      // No project record: only setup clicks are kept, so the build-command click earns nothing,
      // even with a matching setting event in a project's state.
      const fresh = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-fresh-builds-')));
      made.push(fresh);
      startRun({ folder: fresh, now: () => NOW });
      const on = unattendedSetting(me);
      keepEvent(on);
      const card = `${UNATTENDED_CARD().risk}\n${unattendedBuildsLine(on.id, me)}?`;
      const c = fake();
      await decide({ ...input({ [card]: 'Turn on (dangerous)' }, { options: UNATTENDED }), cwd: fresh }, { client: c, now: () => NOW, projectOf: () => null });
      assert.deepEqual(c.calls, { write: [], record: [], profileRecord: [], prState: [] });
      assert.equal(fs.existsSync(path.join(home, 'projects', P, 'pending')), false);
      assert.deepEqual(clicks(), []);

      // Registered, setup still finishing: the project's clicks count as in any project.
      const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-registered-builds-')));
      made.push(folder);
      fs.mkdirSync(path.join(folder, '.git'));
      writeProject('o__builds', { folder, remoteUrl: 'https://example.com/o/b.git', host: 'github', repo: 'o/b', connection: {} });
      const run = startRun({ folder, now: () => NOW });
      for (const n of [1, 2, 3]) markStep(run.id, n, 'doneAt', { now: () => NOW });
      const there = unattendedSetting(me);
      keepEvent(there, stateDir('o__builds'));
      const d = fake();
      await decide({ ...input({ [`${UNATTENDED_CARD().risk}\n${unattendedBuildsLine(there.id, me)}?`]: 'Turn on (dangerous)' }, { options: UNATTENDED }), cwd: folder }, { client: d, now: () => NOW });
      assert.deepEqual(kinds(d), ['confirmation']);
      assert.equal(d.calls.record[0].event.data.confirms, there.id);
      assert.deepEqual(clicks(), []);
    } finally {
      for (const folder of made) fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('setup cards carry no reply-code line', async () => {
  // Ruling R36: a setup card is approved only by the director's click on it, never by a reply
  // code, so the composer gives it none, the card check asks for none, and the prompt record keeps
  // no shown record for it, which nothing would ever spend.
  const { question, card } = composeCard({
    kind: 'setup', level: 3, what: 'Setup step 4, Three questions: nothing changes on this computer.', why: 'Setup asks first.',
    options: [{ label: 'Go ahead', says: 'Setup records it.' }], recommend: 'Go ahead', because: 'nothing changes', meanwhile: 'Setup waits.', target: { step: 4, hash: H },
  });
  assert.equal(question.question.split('\n').at(-1), setupLine(4, H));
  assert.ok(!question.question.includes('Reply code:'), question.question);
  assert.equal(card.code, null);
  assert.deepEqual(cardProblems(question.question), []);
  assert.match(cardProblems(`${question.question}\n${replyCodeLine(replyCode(setupLine(4, H)))}`).join(' '), /reply code/);
  await withHome(async () => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup-code-')));
    try {
      const run = startRun({ folder, now: () => NOW });
      noteShown({ runId: run.id, folder, step: 4, hash: H, card: question, now: () => NOW });
      // The card as composed, and one by hand with a code line: neither gets a shown record.
      for (const shown of [question, { ...question, question: setupCard(4, H) }]) {
        const c = fake();
        const answers = { [shown.question]: 'Go ahead' };
        await decide({ ...input(answers), tool_input: { questions: [shown], answers }, cwd: folder }, deps(c));
        assert.deepEqual(kinds(c), [], shown.question);
      }
      assert.deepEqual(clicks().map((e) => e.data.step), [4]);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('in a registered project an answer on a setup-asked card goes only to setup/answers, and a refused typed answer nowhere', async () => {
  // Ruling R53: it is not also sent to the state as a card-answer, nor kept pending.
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup-asked-')));
    try {
      const run = startRun({ folder, now: () => NOW });
      const card = {
        question: 'What this is: Setup step 4 asks what the product is called.', header: 'Question', multiSelect: false,
        options: [{ label: 'Keep it', description: 'Recommended: Setup keeps the folder\'s name.' }, { label: 'Explain more', description: 'I explain it again.' }],
      };
      noteAsked({ runId: run.id, folder, step: 4, id: 'name', card, typed: true, now: () => NOW });
      const answer = async (label) => {
        const c = fake();
        const answers = { [card.question]: label };
        await decide({ ...input(answers), tool_input: { questions: [card], answers }, cwd: folder }, deps(c));
        return c;
      };
      const answersDir = path.join(home, 'setup', 'answers');
      const kept = () => (fs.existsSync(answersDir) ? fs.readdirSync(answersDir) : []).map((n) => JSON.parse(fs.readFileSync(path.join(answersDir, n), 'utf8')).data);
      const none = { write: [], record: [], profileRecord: [], prState: [] };
      assert.deepEqual((await answer('Café Menu')).calls, none);
      assert.deepEqual(kept().map((d) => [d.label, d.text]), [[null, 'Café Menu']]);
      assert.deepEqual((await answer('Keep it')).calls, none);
      assert.equal(kept().length, 2);
      // A typed answer holding a key is kept nowhere: not as an answer, a card-answer or pending.
      const token = `ghp_${'a'.repeat(36)}`;
      const c = fake({ refuse: true });
      const answers = { [card.question]: token };
      await decide({ ...input(answers), tool_input: { questions: [card], answers }, cwd: folder }, deps(c));
      assert.deepEqual(c.calls, none);
      assert.equal(kept().length, 2);
      const holding = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isDirectory()
        ? holding(path.join(dir, e.name)) : fs.readFileSync(path.join(dir, e.name), 'utf8').includes(token)));
      assert.equal(holding(home), false);
      // Explain more on it goes nowhere either.
      assert.deepEqual((await answer('Explain more')).calls, none);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

// --- What an answer on a setup card records in the project's state (rulings R35, R59).

const RULES = [
  { words: 'Never push straight to main.', source: { file: 'CLAUDE.md', line: 3 }, original: false },
  { words: 'Keep commits small.', source: { file: 'CLAUDE.md', line: 4 }, original: true },
];

// A card a setup step asked in `folder`, recorded as asked, and the director's click on it there.
function askedCard(folder, { id, step, card, typed = false, rules, writes }) {
  const run = startRun({ folder, now: () => NOW });
  noteAsked({ runId: run.id, folder, step, id, card, typed, rules, writes, now: () => NOW });
  return run;
}
const clickOn = (folder, card, label, c) => {
  const answers = { [card.question]: label };
  return decide({ ...input(answers), tool_input: { questions: [card], answers }, cwd: folder }, deps(c));
};
const pendingOf = (home) => {
  const dir = path.join(home, 'projects', P, 'pending');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))) : [];
};
const answersKept = (home) => {
  const dir = path.join(home, 'setup', 'answers');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')).data) : [];
};

test('an answer that records something has its records kept pending first, and sent later when the helper is away', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup-writes-')));
    try {
      const { question: card } = composeCard({ ...rulesInput('Cafe', RULES), target: { count: 2, hash: listHash(RULES) } });
      askedCard(folder, { id: 'rules-1', step: 5, card, rules: RULES });
      // The helper is away: every record stays pending, and the answer is kept, since they are.
      const away = fake({ refuse: true });
      await clickOn(folder, card, 'Confirm all', away);
      const kept = pendingOf(home);
      assert.equal(kept.length, 3);
      assert.deepEqual(kept.map((k) => k.route), ['record', 'record', 'record']);
      const withTarget = kept.filter((k) => k.body.target);
      assert.deepEqual(withTarget.map((k) => k.body.target.data).sort((a, b) => a.source.line - b.source.line), RULES);
      for (const k of withTarget) assert.equal(k.body.event.data.confirmsHash, eventHash(k.body.target));
      assert.deepEqual(answersKept(home).map((d) => [d.step, d.questionId, d.label]), [[5, 'rules-1', 'Confirm all']]);
      assert.deepEqual(away.calls.write, [], 'no card-answer for a setup-asked card');
      // The next session start sends them, each with what it confirms.
      const back = fake();
      await sendPending(P, back);
      assert.equal(back.calls.record.length, 3);
      assert.equal(back.calls.record.filter((b) => b.target).length, 2);
      assert.deepEqual(pendingOf(home), []);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('an asked card that asks for a record setup never writes earns nothing, not even its answer', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup-bad-writes-')));
    try {
      const card = {
        question: 'What this is: Setup step 4 asks something.', header: 'Question', multiSelect: false,
        options: [{ label: 'Yes', description: 'Recommended: yes.' }, { label: 'Explain more', description: 'Again.' }],
      };
      const bad = [
        { kind: 'setting', data: { key: settingKey(computerId()), value: 'unattended' } },
        { kind: 'setting', data: { key: 'phase', value: 'gone' } },
        { kind: 'level', data: { topic: 'x', level: 1 } },
        { kind: 'ruling', data: { words: 'No source' } },
        { kind: 'glossary', data: { term: 'x', plain: `a key ${'ghp_'}${'d'.repeat(36)}` } },
      ];
      for (const [i, write] of bad.entries()) {
        askedCard(folder, { id: `q-${i}`, step: 4, card: { ...card, question: `${card.question} ${i}` }, writes: { labels: { Yes: [write] } } });
        const c = fake();
        await clickOn(folder, { ...card, question: `${card.question} ${i}` }, 'Yes', c);
        assert.deepEqual(c.calls, { write: [], record: [], profileRecord: [], prState: [] }, JSON.stringify(write));
      }
      assert.deepEqual(pendingOf(home), []);
      assert.deepEqual(answersKept(home), []);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('setup\'s card of the rules found gets no shown record, even with a reply code written on by hand', async () => {
  await withHome(async () => {
    const { question } = composeCard({ ...rulesInput('Cafe', RULES), target: { count: 2, hash: listHash(RULES) } });
    const line = setLineOf(question.question);
    for (const shown of [question, { ...question, question: `${question.question}\n${replyCodeLine(replyCode(line))}` }]) {
      const c = fake();
      const answers = { [shown.question]: 'Explain more' };
      await decide({ ...input(answers), tool_input: { questions: [shown], answers } }, deps(c));
      assert.deepEqual(kinds(c), [], shown.question);
    }
  });
});

test('the same Confirm all clicked twice, in two sessions, records the rulings once', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup-twice-')));
    try {
      const { question: card } = composeCard({ ...rulesInput('Cafe', RULES), target: { count: 2, hash: listHash(RULES) } });
      askedCard(folder, { id: 'rules-1', step: 5, card, rules: RULES });
      const one = fake();
      await clickOn(folder, card, 'Confirm all', one);
      const two = fake();
      await clickOn(folder, card, 'Confirm all', two);
      assert.equal(one.calls.record.length, 3);
      assert.deepEqual(two.calls, { write: [], record: [], profileRecord: [], prState: [] });
      assert.equal(answersKept(home).length, 1);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

test('records are kept only together with their answer: an answer that can\'t be kept leaves none pending or sent', async () => {
  await withHome(async (home) => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-setup-noanswer-')));
    try {
      const { question: card } = composeCard({ ...rulesInput('Cafe', RULES), target: { count: 2, hash: listHash(RULES) } });
      askedCard(folder, { id: 'rules-1', step: 5, card, rules: RULES });
      // The answers folder can't be made: a file stands in its place.
      fs.mkdirSync(path.join(home, 'setup'), { recursive: true });
      fs.writeFileSync(path.join(home, 'setup', 'answers'), 'not a folder');
      const c = fake();
      await clickOn(folder, card, 'Confirm all', c);
      assert.deepEqual(c.calls, { write: [], record: [], profileRecord: [], prState: [] });
      assert.deepEqual(pendingOf(home), []);
      // Once it can be kept, the same click records them.
      fs.rmSync(path.join(home, 'setup', 'answers'));
      const d = fake();
      await clickOn(folder, card, 'Confirm all', d);
      assert.equal(d.calls.record.length, 3);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});


// --- Uninstall's click (ruling R90): kept in setup/clicks/, signed, naming the project and the list's full hash.

const UNINSTALL_HASH = 'ef'.repeat(32);
const uninstallCard = (project, hash, what = `Remove Wheelhouse from ${project}: stop its jobs, put back 3 changes on this computer.`) => composeCard({
  kind: 'uninstall', level: 4, what, why: 'You asked for it, and it takes away the checks that guard this project.',
  options: [{ label: 'Remove it', says: 'Setup\'s changes are put back, as listed.' }, { label: 'Not now', says: 'Nothing changes.' }],
  recommend: 'Remove it', because: 'you asked', meanwhile: 'Nothing changes until you click; if STOP is on, lift it first.',
  checks: 'The checks no longer guard this project.', target: { project, hash },
}).question;
const uninstallClicks = () => clicks().filter((e) => e.data?.action === 'uninstall');
const removeClick = (card, label, cwd) => ({
  cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [card], answers: { [card.question]: label } }, tool_response: { answers: { [card.question]: label } },
});

test('Remove it on uninstall\'s card, exactly as the helper showed it for this folder, is signed and kept in setup/clicks', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-uninstall zoë ')));
    const other = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-uninstall-other ')));
    try {
      const card = uninstallCard(P, UNINSTALL_HASH);
      assert.deepEqual(cardProblems(card.question), []);
      noteUninstallShown({ project: P, folder, hash: UNINSTALL_HASH, card, now: () => NOW });
      assert.equal(uninstallShownFor(folder).hash, UNINSTALL_HASH);
      const c = fake();
      // In a registered project: the click is kept, and the plain answer goes to the state as any card's does.
      await decide(removeClick(card, 'Remove it', folder), { client: c, now: () => NOW, projectOf: () => ({ project: P }) });
      const [only, ...rest] = uninstallClicks();
      assert.deepEqual(rest, []);
      assert.equal(only.kind, 'action');
      assert.deepEqual(only.data, { action: 'uninstall', project: P, hash: UNINSTALL_HASH, question: uninstallLine(P, UNINSTALL_HASH), label: 'Remove it' });
      assert.equal(verify(only, readEnrolled()), true);
      assert.equal(c.calls.record.length, 0, 'no click, shown record or reply code goes to the state');
      assert.deepEqual(c.calls.write.map((w) => w.data.label), ['Remove it']);

      // Nothing else counts: a put-off; a card for another project, or another list, never shown; a
      // card reworded around the right line; the right card from a folder it wasn't shown for; a card
      // with a second set line; and a button the card didn't offer.
      const nothing = async (input, find = () => null) => decide(input, { client: fake(), now: () => NOW, projectOf: find });
      await nothing(removeClick(card, 'Not now', folder));
      await nothing(removeClick(card, 'Explain more', folder));
      await nothing(removeClick(uninstallCard('owner__other', UNINSTALL_HASH), 'Remove it', folder));
      await nothing(removeClick(uninstallCard(P, 'ab'.repeat(32)), 'Remove it', folder));
      await nothing(removeClick(uninstallCard(P, UNINSTALL_HASH, `Remove Wheelhouse from ${P}: nothing at all changes.`), 'Remove it', folder));
      await nothing(removeClick({ ...card, options: card.options.map((o) => (o.label === 'Remove it' ? { ...o, description: 'Nothing changes.' } : o)) }, 'Remove it', folder));
      await nothing(removeClick(card, 'Remove it', other));
      await nothing(removeClick({ ...card, question: `${card.question}\n${approvalLine(7, FULL)}` }, 'Remove it', folder));
      await nothing(removeClick({ ...card, options: card.options.filter((o) => o.label !== 'Remove it') }, 'Remove it', folder));
      assert.equal(uninstallClicks().length, 1);

      // In a folder with no project record (here one inside it, where no setup runs either), the card
      // shown for the folder holding it counts the same way.
      fs.mkdirSync(path.join(folder, 'web'));
      await nothing(removeClick(card, 'Remove it', path.join(folder, 'web')));
      assert.equal(uninstallClicks().length, 2);

      // Shown again for a new list, only the card as last shown counts.
      const newer = uninstallCard(P, 'cd'.repeat(32));
      noteUninstallShown({ project: P, folder, hash: 'cd'.repeat(32), card: newer, now: () => NOW });
      await nothing(removeClick(card, 'Remove it', folder));
      assert.equal(uninstallClicks().length, 2);
      await nothing(removeClick(newer, 'Remove it', folder));
      assert.deepEqual(uninstallClicks().map((e) => e.data.hash).sort(), ['cd'.repeat(32), UNINSTALL_HASH, UNINSTALL_HASH].sort());

      // The helper's reader: fresh for CLICK_FRESH_MS, this project and this hash only, until used.
      const at = (ms) => () => new Date(NOW.getTime() + ms);
      assert.equal(freshUninstallClicks({ project: P, hash: UNINSTALL_HASH, now: at(60000) }).length, 2);
      assert.deepEqual(freshUninstallClicks({ project: P, hash: UNINSTALL_HASH, now: at(CLICK_FRESH_MS + 1) }), [], 'a stale click counts for nothing');
      assert.deepEqual(freshUninstallClicks({ project: 'owner__other', hash: UNINSTALL_HASH, now: at(60000) }), []);
      assert.deepEqual(freshUninstallClicks({ project: P, hash: 'ab'.repeat(32), now: at(60000) }), []);
      for (const e of freshUninstallClicks({ project: P, hash: UNINSTALL_HASH, now: at(60000) })) assert.equal(useClick(e), true);
      assert.deepEqual(freshUninstallClicks({ project: P, hash: UNINSTALL_HASH, now: at(60000) }), [], 'a used click counts once');
      assert.equal(freshUninstallClicks({ project: P, hash: 'cd'.repeat(32), now: at(60000) }).length, 1);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});

test('a forged uninstall click, signed by no key this computer trusts, or made elsewhere, is not fresh', async () => {
  await withHome(async () => {
    fs.mkdirSync(clicksDir(), { recursive: true });
    const real = makeEvent({ kind: 'action', data: { action: 'uninstall', project: P, hash: UNINSTALL_HASH, question: uninstallLine(P, UNINSTALL_HASH), label: 'Remove it' }, now: () => NOW });
    const write = (event, name) => fs.writeFileSync(path.join(clicksDir(), `${name}.json`), JSON.stringify(event));
    write({ ...real, id: 'forged-1', data: { ...real.data } }, 'forged');
    write({ ...real, id: 'elsewhere-1', computer: 'ffffffff' }, 'elsewhere');
    assert.deepEqual(freshUninstallClicks({ project: P, hash: UNINSTALL_HASH, now: () => NOW }), []);
    write(real, 'real');
    assert.deepEqual(freshUninstallClicks({ project: P, hash: UNINSTALL_HASH, now: () => NOW }).map((e) => e.id), [real.id]);
  });
});

// --- usage cards (design section 14.6): the switch option is the director's confirmation itself ---

const USAGE_AT = NOW.toISOString();
const USAGE_RESET = '2026-10-19T09:00:00.000Z';
// An up card, offered at NOW: under 40% used with the reset under two days off.
const upCard = () => nudgeCard({ allowance: { used: 20, resetsAt: USAGE_RESET, at: USAGE_AT }, level: 'balanced', mark: 75, now: NOW, timeZone: 'UTC' });
const usageQuestion = (got) => composeCard(got.input).question;
const usageClick = (q, label, opts = {}) => input({ [q.question]: label }, { options: q.options, ...opts });
const usageDeps = (client, more = {}) => ({ ...deps(client), ready: () => [], ...more });
const keepOffer = (record) => keepEvent(makeEvent({ kind: 'usage-card', data: record, now: () => new Date(Date.parse(record.at)) }));

test('the switch option on a usage card records the setting with its signed confirmation, and no second card', async () => {
  await withHome(async () => {
    const got = upCard();
    assert.equal(got.card, 'up');
    keepOffer(got.record);
    const q = usageQuestion(got);
    assert.equal(cardProblems(q).length, 0);
    assert.doesNotMatch(q.question, /Reply code:/, 'only the click on the card counts: no reply code');
    const c = fake();
    await decide(usageClick(q, got.switchLabel), { ...usageDeps(c), now: () => new Date(NOW.getTime() + 60000) });
    assert.equal(c.calls.record.length, 1);
    const [{ project, event, target }] = c.calls.record;
    assert.equal(project, P);
    assert.equal(target.kind, 'setting');
    assert.equal(target.computer, computerId());
    assert.deepEqual(target.data, { key: 'efficiency', value: 'thorough', usageCard: got.record.at, words: 'Thoroughness: Thorough' });
    assert.equal(event.kind, 'confirmation');
    assert.deepEqual(event.data, confirmationFor(target).data);
    assert.deepEqual(event.data, { confirms: target.id, confirmsHash: eventHash(target) });
    assert.ok(verify(event, readEnrolled()), 'signed by this computer\'s own key');
    assert.deepEqual(c.calls.write.map((w) => [w.kind, w.data]), [['card-answer', { question: q.question, label: got.switchLabel }]]);

    // In force at once, carrying the offer's time, so the return card after the reset is for this switch.
    keepEvent(target);
    keepEvent(event);
    const views = buildViews(listEvents(stateDir(P)), readEnrolled());
    assert.equal(views.settings.efficiency.value, 'thorough');
    assert.equal(views.settings.efficiency.usageCard, got.record.at);
    assert.deepEqual(views.unconfirmed, []);
    const after = nudgeCard({
      allowance: { used: 1, resetsAt: '2026-10-26T09:00:00.000Z', at: '2026-10-19T10:00:00.000Z' }, level: 'thorough', mark: 75,
      offers: views.usageCards, switched: views.settings.efficiency, now: new Date('2026-10-19T10:05:00.000Z'), timeZone: 'UTC',
    });
    assert.equal(after.card, 'return');
    assert.equal(after.switchTo, 'balanced');

    // The return card's own pick switches back the same way, in one card.
    keepOffer(after.record);
    const back = fake();
    const at = new Date('2026-10-19T10:06:00.000Z');
    await decide(usageClick(usageQuestion(after), after.switchLabel), { ...usageDeps(back), now: () => at });
    assert.equal(back.calls.record.length, 1);
    assert.deepEqual(back.calls.record[0].target.data, { key: 'efficiency', value: 'balanced', usageCard: after.record.at, words: 'Thoroughness: Balanced' });
  });
});

test('the stay option on a usage card changes nothing and is kept as the card\'s answer', async () => {
  await withHome(async () => {
    const got = upCard();
    keepOffer(got.record);
    const q = usageQuestion(got);
    const c = fake();
    await decide(usageClick(q, 'Stay on Balanced'), usageDeps(c));
    assert.deepEqual(c.calls.record, []);
    assert.deepEqual(c.calls.write.map((w) => [w.kind, w.data]), [['card-answer', { question: q.question, label: 'Stay on Balanced' }]]);
  });
});

test('a usage card\'s switch counts only as the director\'s own click on the card the session start offered', async () => {
  await withHome(async () => {
    const got = upCard();
    const q = usageQuestion(got);
    const nothing = async (inputs, more = {}) => {
      const c = fake();
      await decide(inputs, usageDeps(c, more));
      assert.deepEqual(c.calls.record, []);
    };
    // No offer in the state: a card an agent wrote itself confirms nothing.
    await nothing(usageClick(q, got.switchLabel));
    keepOffer(got.record);
    // Typed text that reads as the switch, a multiple choice, and an answer the tool didn't give back are not clicks.
    await nothing(usageClick(q, got.switchLabel, { options: [{ label: 'Stay on Balanced' }] }));
    await nothing(usageClick(q, got.switchLabel, { multi: true }));
    await nothing({ ...usageClick(q, got.switchLabel), tool_response: { answers: { [q.question]: 'Stay on Balanced' } } });
    // Confirm, or another card's switch, on this card is not its switch.
    await nothing(usageClick(q, 'Confirm', { options: [...q.options, { label: 'Confirm' }] }));
    await nothing(usageClick(q, 'Switch to Lean until it resets', { options: [...q.options, { label: 'Switch to Lean until it resets' }] }));
    // A line naming another level or another offer's time names no offer the state holds.
    const other = (from, to) => ({ ...q, question: q.question.replace(from, to) });
    await nothing(usageClick(other('to thorough,', 'to lightest,'), got.switchLabel));
    await nothing(usageClick(other(USAGE_AT, '2026-10-18T04:00:00.000Z'), got.switchLabel));
    // Two set lines are none.
    await nothing(usageClick({ ...q, question: `${q.question}\n${confirmLine({ kind: 'setting', id: 's1', data: { words: 'x' } })}` }, got.switchLabel));
    // After the reset the offer's week is over.
    await nothing(usageClick(q, got.switchLabel), { now: () => new Date('2026-10-19T09:00:00.000Z') });
    // A level that isn't ready is never set by a card.
    const lean = nudgeCard({ allowance: { used: 80, resetsAt: '2026-10-21T09:00:00.000Z', at: USAGE_AT }, level: 'balanced', mark: 75, ready: ['lean'], now: NOW, timeZone: 'UTC' });
    keepOffer(lean.record);
    await nothing(usageClick(usageQuestion(lean), lean.switchLabel), { ready: () => [] });
    const c = fake();
    await decide(usageClick(usageQuestion(lean), lean.switchLabel), usageDeps(c, { ready: () => ['lean'] }));
    assert.equal(c.calls.record[0].target.data.value, 'lean');
  });
});

test('a usage card\'s switch is taken once: a second pick of the same card records nothing', async () => {
  await withHome(async () => {
    const got = upCard();
    keepOffer(got.record);
    const q = usageQuestion(got);
    const c = fake();
    await decide(usageClick(q, got.switchLabel), usageDeps(c));
    const [{ event, target }] = c.calls.record;
    keepEvent(target);
    keepEvent(event);
    const again = fake();
    await decide(usageClick(q, got.switchLabel), usageDeps(again));
    assert.deepEqual(again.calls.record, []);
  });
});

test('a usage card carrying a reply code line gets no shown record, so no reply can stand for its switch', async () => {
  await withHome(async () => {
    const got = upCard();
    keepOffer(got.record);
    const q = usageQuestion(got);
    const line = setLineOf(q.question);
    const coded = { ...q, question: `${q.question}\n${replyCodeLine(replyCode(line))}` };
    const c = fake();
    await decide(usageClick(coded, 'Stay on Balanced'), usageDeps(c));
    assert.deepEqual(c.calls.record.filter((r) => r.event.kind === 'shown'), []);
  });
});
