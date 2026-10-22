// tests/scripts/mod/reply.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseReply, replyRecord } from '../../../scripts/mod/reply.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { makeEvent, eventPath } from '../../../scripts/state/events.js';
import { writeViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { approvalLine, confirmLine, LIFT_STOP, runbookLine, replyCode, replyCodeLine, approveWorkLine, answerLine, amendLine, liftIncidentLine, incidentFixLine, unattendedBuildsLine, setupLine } from '../../../scripts/state/card-lines.js';
import { computerId, profileDir, stateDir, stopFile } from '../../../scripts/lib/paths.js';
import { BUILD_QUESTION_OPTIONS, settingKey, UNATTENDED_CARD } from '../../../scripts/protection/windows-builds.js';

const P = 'owner__name';
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const NOW = new Date('2026-10-18T05:00:00.000Z');
const LATER = new Date('2026-10-18T06:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-reply-'));
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

function fake({ pr = { ok: true, result: { headSha: FULL, state: 'open' } }, refuse = false, takes = false } = {}) {
  const calls = { write: [], record: [], profileRecord: [], prState: [] };
  const no = { ok: false, refused: 'no' };
  return {
    calls,
    prState: async (b) => { calls.prState.push(b); return pr; },
    state: {
      write: async (b) => { calls.write.push(b); return refuse ? no : { ok: true }; },
      record: async (b) => {
        calls.record.push(b);
        // As the helper does: a record it takes is written into the state clone at once.
        if (takes && !refuse) keepEvent(b.event);
        return refuse ? no : { ok: true };
      },
    },
    profile: {
      record: async (b) => { calls.profileRecord.push(b); return refuse ? no : { ok: true }; },
    },
  };
}

const OPTIONS = ['Approve', 'Confirm', 'Lift STOP', 'Do it', 'Explain more', 'Not now'];
const card = (question, answer, options = OPTIONS) => ({
  cwd: '/x', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question, options: options.map((label) => ({ label })), multiSelect: false }], answers: { [question]: answer } },
  tool_response: { answers: { [question]: answer } },
});
const deps = (client, now = NOW) => ({ client, now: () => now, projectOf: () => ({ project: P }), liftStop: () => {} });

function keepEvent(event) {
  const file = path.join(stateDir(P), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
}

// Puts a card in front of the director: the prompt record writes its shown record, which the
// helper would add to the state, and the views are rebuilt as a sync would.
async function show(question, { answer = 'Not now', options = OPTIONS } = {}) {
  const c = fake();
  await decide(card(question, answer, options), deps(c));
  for (const r of c.calls.record) keepEvent(r.event);
  await writeViews(P, { now: () => NOW });
  return c;
}

// STOP on since an hour before NOW, so the cards shown at NOW were shown after it.
const stopOn = (at = new Date(NOW.getTime() - 60 * 60 * 1000)) => fs.writeFileSync(stopFile(), JSON.stringify({ by: 'prompt', at: at.toISOString() }));

const cardOf = (line, before = 'What this is.') => `${before}\n${line}\n${replyCodeLine(replyCode(line))}`;
const signed = (c) => c.calls.record.filter((r) => r.event.kind !== 'shown').map((r) => ({ kind: r.event.kind, data: r.event.data }));

test('k7qd approve. counts as K7QD Approve', async () => {
  assert.deepEqual(parseReply('k7qd approve.'), { code: 'K7QD', label: 'approve' });
  assert.deepEqual(parseReply('  K7QD \t  Lift   STOP \n'), { code: 'K7QD', label: 'Lift STOP' });
  assert.deepEqual(parseReply('K7QD Approve'), { code: 'K7QD', label: 'Approve' });
  for (const text of ['yes', 'Yes.', 'K7QD', 'K7Q Approve', 'K7QO Approve', 'K7QD1 Approve', 'Reply K7QD Approve', 'K7QD\u0000Approve', 'K7QD Appr\u0007ove', '', 42, null]) {
    assert.equal(parseReply(text), null, String(text));
  }
  assert.equal(parseReply('K7QD Approve..')?.label, 'Approve.');

  await withHome(async () => {
    const line = approvalLine(12, FULL);
    const question = cardOf(line);
    await show(question);
    const code = replyCode(line).toLowerCase();
    const c = fake();
    const out = await replyRecord({ project: P, text: `${code} approve.`, client: c, now: () => LATER });
    assert.deepEqual(out, { made: true, says: 'Recorded: Approve pull request #12' });
    assert.deepEqual(signed(c), [{ kind: 'approval', data: { pr: 12, commit: FULL, words: 'Approve', question } }]);
    // A plain "yes" never counts.
    const yes = fake();
    assert.equal((await replyRecord({ project: P, text: 'yes', client: yes, now: () => LATER })).made, false);
    assert.equal(yes.calls.record.length + yes.calls.write.length + yes.calls.prState.length, 0);
  });
});

test('a spent, expired or shared code records nothing and says why', async () => {
  await withHome(async () => {
    // Spent: the card was clicked, and the click's approval spends its code.
    const line = approvalLine(12, FULL);
    await show(cardOf(line), { answer: 'Approve' });
    const spent = fake();
    assert.deepEqual(await replyRecord({ project: P, text: `${replyCode(line)} Approve`, client: spent, now: () => LATER }), { made: false, says: 'That code has been used' });

    // Expired: more than REPLY_CODE_DAYS after the card was shown.
    await show(cardOf(LIFT_STOP));
    const old = fake();
    const out = await replyRecord({ project: P, text: `${replyCode(LIFT_STOP)} Lift STOP`, client: old, now: () => new Date(NOW.getTime() + 8 * DAY) });
    assert.equal(out.made, false);
    assert.match(out.says, /run out/);

    // Shared: one code held by two cards with different questions.
    const step = runbookLine(1);
    await show(cardOf(step, 'First card.'));
    await show(cardOf(step, 'Second card.'));
    const shared = fake();
    const both = await replyRecord({ project: P, text: `${replyCode(step)} Do it`, client: shared, now: () => LATER });
    assert.equal(both.made, false);
    assert.match(both.says, /two cards/);

    // A code no card holds.
    const unknown = await replyRecord({ project: P, text: 'ZZZZ Approve', client: fake(), now: () => LATER });
    assert.deepEqual(unknown, { made: false, says: 'No card has that code' });

    for (const c of [spent, old, shared]) assert.equal(c.calls.record.length + c.calls.write.length + c.calls.prState.length, 0);
    const pending = path.join(stateDir(P), '..', 'pending');
    assert.deepEqual(fs.existsSync(pending) ? fs.readdirSync(pending).filter((n) => n.endsWith('.json')) : [], []);
  });
});

test('an option the card did not offer records nothing', async () => {
  await withHome(async () => {
    const line = approvalLine(12, FULL);
    await show(cardOf(line), { options: ['Approve', 'Explain more', 'Not now'] });
    const code = replyCode(line);
    const c = fake();
    assert.deepEqual(await replyRecord({ project: P, text: `${code} Confirm`, client: c, now: () => LATER }), { made: false, says: 'That card doesn\'t offer Confirm' });
    assert.deepEqual(await replyRecord({ project: P, text: `${code} explain MORE`, client: c, now: () => LATER }), { made: false, says: 'That option doesn\'t need a reply code' });
    assert.deepEqual(await replyRecord({ project: P, text: `${code} Not now.`, client: c, now: () => LATER }), { made: false, says: 'That option doesn\'t need a reply code' });
    assert.equal(c.calls.record.length + c.calls.write.length + c.calls.prState.length, 0);
  });
});

test('a reply earns exactly the record the click would have', async () => {
  await withHome(async () => {
    stopOn(); // a Lift STOP earns its record only while STOP is on
    const ruling = makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => NOW });
    keepEvent(ruling);
    const cases = [
      [approvalLine(12, FULL), 'Approve', 'Recorded: Approve pull request #12'],
      [confirmLine(ruling), 'Confirm', 'Recorded: Confirm the ruling'],
      [LIFT_STOP, 'Lift STOP', 'Recorded: Lift STOP'],
      [runbookLine(3, FULL), 'Do it', 'Recorded: Runbook step 3: Put the product back to an earlier release'],
    ];
    for (const [line, label, says] of cases) {
      const question = cardOf(line);
      await show(question);
      // The click the card would have taken, on a card no code was shown for.
      const click = fake();
      await decide(card(question, label), { ...deps(click), liftStop: () => {} });
      let lifted = 0;
      const reply = fake();
      const out = await replyRecord({ project: P, text: `${replyCode(line)} ${label.toLowerCase()}`, client: reply, now: () => LATER, liftStop: () => { lifted += 1; } });
      assert.deepEqual(out, { made: true, says });
      assert.deepEqual(signed(reply), signed(click), label);
      assert.equal(reply.calls.record.length, 1, label);
      assert.ok(reply.calls.record[0].event.sig);
      assert.equal(reply.calls.record[0].event.at, LATER.toISOString());
      // Nothing else but the plain answer the click writes too, in the card's own spelling of the
      // option: the typed text is written nowhere.
      assert.deepEqual(reply.calls.write, click.calls.write, label);
      assert.deepEqual(reply.calls.write, [{ project: P, kind: 'card-answer', data: { question, label } }], label);
      assert.equal(lifted, label === 'Lift STOP' ? 1 : 0);
    }

    // Kept pending first, as every signed record is, and left there when the helper doesn't take it.
    const line = runbookLine(2);
    await show(cardOf(line));
    const refused = fake({ refuse: true });
    const out = await replyRecord({ project: P, text: ` ${replyCode(line).toLowerCase()}   dO   iT. `, client: refused, now: () => LATER });
    assert.equal(out.made, true);
    assert.match(out.says, /^Recorded: Runbook step 2/);
    const folder = path.join(stateDir(P), '..', 'pending');
    const kept = fs.readdirSync(folder).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(folder, n), 'utf8')));
    // The signed record and the plain answer, each kept until the helper takes it.
    const record = kept.filter((k) => k.route === 'record');
    assert.deepEqual(record.map((k) => [k.body.event.data.action, k.body.event.data.step]), [['runbook', 2]]);
    assert.deepEqual(record[0].body.event.data, { action: 'runbook', step: 2, question: cardOf(line), label: 'Do it' });
    assert.deepEqual(kept.filter((k) => k.route === 'write').map((k) => k.body), [{ project: P, kind: 'card-answer', data: { question: cardOf(line), label: 'Do it' } }]);
    assert.equal(kept.length, 2);
  });
});

test('a reply to an approval card checks the pull request\'s head as a click does', async () => {
  await withHome(async () => {
    const line = approvalLine(12, FULL);
    await show(cardOf(line));
    const moved = fake({ pr: { ok: true, result: { headSha: '1'.repeat(40), state: 'open' } } });
    const out = await replyRecord({ project: P, text: `${replyCode(line)} Approve`, client: moved, now: () => LATER });
    assert.equal(out.made, false);
    assert.equal(out.says, 'That card\'s answer can\'t be recorded now');
    assert.deepEqual(moved.calls.prState, [{ project: P, number: 12 }]);
    assert.equal(moved.calls.record.length, 0);
    const closed = fake({ pr: { ok: true, result: { headSha: FULL, state: 'closed' } } });
    assert.equal((await replyRecord({ project: P, text: `${replyCode(line)} Approve`, client: closed, now: () => LATER })).made, false);
    assert.equal(closed.calls.record.length, 0);
    // STOP is untouched by a reply that records nothing.
    fs.writeFileSync(stopFile(), '{}');
    await replyRecord({ project: P, text: `${replyCode(line)} Approve`, client: moved, now: () => LATER });
    assert.equal(fs.existsSync(stopFile()), true);
  });
});

test('a Lift STOP reply while STOP is off records nothing and leaves its code to be used', async () => {
  await withHome(async () => {
    await show(cardOf(LIFT_STOP));
    let lifted = 0;
    const off = fake();
    const out = await replyRecord({ project: P, text: `${replyCode(LIFT_STOP)} Lift STOP`, client: off, now: () => LATER, liftStop: () => { lifted += 1; } });
    assert.equal(out.made, false);
    assert.equal(off.calls.record.length + off.calls.write.length, 0);
    assert.equal(lifted, 0);
    // The card was let go, so once STOP is on its code works.
    stopOn();
    const on = fake();
    assert.deepEqual(await replyRecord({ project: P, text: `${replyCode(LIFT_STOP)} Lift STOP`, client: on, now: () => LATER, liftStop: () => { lifted += 1; } }), { made: true, says: 'Recorded: Lift STOP' });
    assert.equal(on.calls.record.length, 1);
    assert.equal(lifted, 1);
  });
});

test('two replies in a row, or a click then a reply, record once while the views on disk are old', async () => {
  await withHome(async (home) => {
    const replied = path.join(home, 'projects', P, 'replied');
    const reply = (line, client, label = 'Do it') => replyRecord({ project: P, text: `${replyCode(line)} ${label}`, client, now: () => LATER });

    // The helper took the first reply's record into the clone; no views were written since.
    const one = runbookLine(1);
    await show(cardOf(one));
    const first = fake({ takes: true });
    assert.equal((await reply(one, first)).made, true);
    fs.rmSync(replied, { recursive: true, force: true });
    const second = fake({ takes: true });
    assert.deepEqual(await reply(one, second), { made: false, says: 'That code has been used' });
    assert.equal(second.calls.record.length, 0);

    // The first reply's record is still kept in pending/, the helper not having taken it.
    const two = runbookLine(2);
    await show(cardOf(two));
    assert.equal((await reply(two, fake({ refuse: true }))).made, true);
    fs.rmSync(replied, { recursive: true, force: true });
    const after = fake();
    assert.deepEqual(await reply(two, after), { made: false, says: 'That code has been used' });
    assert.equal(after.calls.record.length, 0);

    // Two replies at once: the card's marker lets one through.
    const four = runbookLine(4);
    await show(cardOf(four));
    const both = fake();
    const results = await Promise.all([reply(four, both), reply(four, both)]);
    assert.deepEqual(results.map((r) => r.made).sort(), [false, true]);
    assert.equal(both.calls.record.length, 1);

    // A click on the card, taken by the helper, then a reply.
    const pr = approvalLine(12, FULL);
    await show(cardOf(pr));
    await decide(card(cardOf(pr), 'Approve'), deps(fake({ takes: true }), LATER));
    const late = fake();
    assert.deepEqual(await reply(pr, late, 'Approve'), { made: false, says: 'That code has been used' });
    assert.equal(late.calls.record.length + late.calls.prState.length, 0);

    // A reply that earns nothing lets the card go, so it can be answered again.
    const pr13 = approvalLine(13, FULL);
    await show(cardOf(pr13));
    const moved = fake({ pr: { ok: true, result: { headSha: '1'.repeat(40), state: 'open' } } });
    assert.equal((await reply(pr13, moved, 'Approve')).made, false);
    assert.equal((await reply(pr13, fake(), 'Approve')).made, true);
  });
});

test('a Lift STOP card shown before this STOP began can\'t lift it by reply; a click on it still can', async () => {
  await withHome(async () => {
    await show(cardOf(LIFT_STOP, 'STOP went on at four.'));
    // STOP went off and on again half an hour after the card was shown.
    stopOn(new Date(NOW.getTime() + 30 * 60 * 1000));
    let lifted = 0;
    const old = fake();
    const reply = (client, now = LATER) => replyRecord({ project: P, text: `${replyCode(LIFT_STOP)} Lift STOP`, client, now: () => now, liftStop: () => { lifted += 1; } });
    assert.deepEqual(await reply(old), { made: false, says: 'That card\'s answer can\'t be recorded now' });
    assert.equal(old.calls.record.length + old.calls.write.length, 0);
    assert.equal(lifted, 0);
    // With STOP's time unreadable, a reply can't show its card is the newer, so nothing either.
    fs.writeFileSync(stopFile(), '{}');
    assert.equal((await reply(fake())).made, false);

    // The same card shown again after STOP began gets a new shown record, and lifts it by reply.
    stopOn(new Date(NOW.getTime() + 30 * 60 * 1000));
    const newer = fake();
    await decide(card(cardOf(LIFT_STOP, 'STOP went on at four.'), 'Not now'), deps(newer, LATER));
    assert.equal(newer.calls.record.filter((r) => r.event.kind === 'shown').length, 1);
    for (const r of newer.calls.record) keepEvent(r.event);
    await writeViews(P, { now: () => LATER });
    assert.deepEqual(await reply(fake(), new Date(LATER.getTime() + 1000)), { made: true, says: 'Recorded: Lift STOP' });
    assert.equal(lifted, 1);

    // A click is the director at the card now, so it lifts whatever the card's age.
    stopOn(new Date(LATER.getTime() + 60 * 1000));
    const click = fake();
    let clicked = 0;
    await decide(card(cardOf(LIFT_STOP, 'STOP went on at four.'), 'Lift STOP'), { ...deps(click, new Date(LATER.getTime() + 120 * 1000)), liftStop: () => { clicked += 1; } });
    assert.equal(clicked, 1);
  });
});

test('a line that repeats gets a working code on each new card, and two waiting cards sharing it are refused', async () => {
  await withHome(async () => {
    stopOn(); // a Lift STOP earns its record only while STOP is on
    const reply = (client, now = LATER) => replyRecord({ project: P, text: `${replyCode(LIFT_STOP)} Lift STOP`, client, now: () => now, liftStop: () => {} });
    // The first lift-STOP card is used.
    await show(cardOf(LIFT_STOP, 'STOP went on at noon.'));
    assert.equal((await reply(fake({ takes: true }))).made, true);
    await writeViews(P, { now: () => LATER });
    // A later card with the same line and other words answers to the same code.
    const second = new Date(LATER.getTime() + DAY);
    const c = fake();
    await decide(card(cardOf(LIFT_STOP, 'STOP went on again at six.'), 'Not now'), deps(c, second));
    for (const r of c.calls.record) keepEvent(r.event);
    assert.equal(c.calls.record.filter((r) => r.event.kind === 'shown').length, 1);
    const out = await reply(fake({ takes: true }), new Date(second.getTime() + 1000));
    assert.deepEqual(out, { made: true, says: 'Recorded: Lift STOP' });

    // The same card again, after its record was used, gets a new shown record that works.
    await writeViews(P, { now: () => second });
    const again = fake();
    await decide(card(cardOf(LIFT_STOP, 'STOP went on again at six.'), 'Not now'), deps(again, new Date(second.getTime() + 2000)));
    assert.equal(again.calls.record.filter((r) => r.event.kind === 'shown').length, 1);
    for (const r of again.calls.record) keepEvent(r.event);
    assert.equal((await reply(fake({ takes: true }), new Date(second.getTime() + 3000))).made, true);

    // Two waiting cards with one line and different words are refused.
    const step = runbookLine(5);
    await show(cardOf(step, 'Harm is live.'));
    await show(cardOf(step, 'Harm is live again.'));
    const two = await replyRecord({ project: P, text: `${replyCode(step)} Do it`, client: fake(), now: () => LATER });
    assert.match(two.says, /two cards/);
  });
});

// --- the build loop's cards ---

const DOC = 'fedcba9876543210'.repeat(4);
const NEW_DOC = '0123456789abcdef'.repeat(4);
const QUESTION = { id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: 'It changes the file', options: [{ label: 'Comma', says: 'Commas' }, { label: 'Tab', says: 'Tabs' }, { label: 'Show me', says: 'A sample' }], recommendation: 'Comma', level: 2 };
// The options each card offers (a card holds two to four).
const WORK_OPTIONS = ['Approve', 'Show me', 'Explain more', 'Not now'];
const ASK_OPTIONS = ['Comma', 'Tab', 'Semicolon', 'Show me', 'Explain more'];

function buildState() {
  keepEvent(makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export', lane: 'feature', doc: { path: 'd.md', hash: DOC }, visible: true, dependsOn: [] }, now: () => NOW }));
  keepEvent(makeEvent({ kind: 'amendment', data: { work: 'export-csv', change: 'CSV, not Excel', hash: NEW_DOC }, now: () => NOW }));
  keepEvent(makeEvent({ kind: 'incident', data: { id: 'bad-total', what: 'Totals are wrong' }, now: () => NOW }));
  keepEvent(makeEvent({ kind: 'question', data: QUESTION, now: () => NOW }));
}

test('a reply earns the record the click would have on each of the build loop\'s cards', async () => {
  await withHome(async () => {
    buildState();
    const cases = [
      [approveWorkLine('export-csv', 'feature', DOC), 'Approve', 'Recorded: Approve export-csv', WORK_OPTIONS],
      [approveWorkLine('export-csv', 'feature', DOC, { shownFirst: true }), 'Approve', 'Recorded: Approve export-csv', WORK_OPTIONS],
      [amendLine('export-csv', NEW_DOC), 'Change it', 'Recorded: Change export-csv', ['Change it', 'Explain more', 'Not now']],
      [liftIncidentLine('bad-total'), 'End it', 'Recorded: End incident bad-total', ['End it', 'Explain more', 'Not now']],
      [incidentFixLine('bad-total', 31), 'Merge the fix', 'Recorded: Merge pull request #31 as the fix', ['Merge the fix', 'Explain more', 'Not now']],
      [answerLine('q-export-csv-1'), 'Tab', 'Recorded: Answer: Tab', ASK_OPTIONS],
    ];
    for (const [line, label, says, options] of cases) {
      const question = cardOf(line);
      await show(question, { options });
      const click = fake();
      await decide(card(question, label, options), deps(click));
      const reply = fake();
      const out = await replyRecord({ project: P, text: `${replyCode(line).toLowerCase()} ${label.toLowerCase()}`, client: reply, now: () => LATER });
      assert.deepEqual(out, { made: true, says });
      assert.equal(signed(click).length, 1, label);
      assert.deepEqual(signed(reply), signed(click), label);
      assert.ok(reply.calls.record[0].event.sig);
      assert.deepEqual(reply.calls.write, click.calls.write, label);
      assert.equal(reply.calls.prState.length, 0);
      // A code is good once.
      const again = fake();
      const second = await replyRecord({ project: P, text: `${replyCode(line)} ${label}`, client: again, now: () => LATER });
      assert.deepEqual(second, { made: false, says: 'That code has been used' }, label);
      assert.equal(again.calls.record.length, 0, label);
    }
  });
});

test('a reply on an approve-work card earns the work approval with its full hash and lane', async () => {
  await withHome(async () => {
    buildState();
    const line = approveWorkLine('export-csv', 'feature', DOC, { shownFirst: true });
    const question = cardOf(line);
    await show(question, { options: WORK_OPTIONS });
    const c = fake();
    await replyRecord({ project: P, text: `${replyCode(line)} Approve`, client: c, now: () => LATER });
    assert.deepEqual(signed(c), [{ kind: 'action', data: { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: DOC, shownFirst: true, question, label: 'Approve' } }]);
  });
});

test('a reply on an answer card counts for the question\'s own options, never Explain more, Show me, Why?, Suggest a change… or one it lacks', async () => {
  await withHome(async () => {
    buildState();
    const line = answerLine('q-export-csv-1');
    const question = cardOf(line);
    await show(question, { options: ['Comma', 'Semicolon', 'Show me', 'Explain more', 'Why?', 'Suggest a change…'] });
    // Semicolon is on the card but not in the question's options.
    for (const label of ['Explain more', 'Show me', 'Why?', 'Suggest a change…', 'Semicolon']) {
      const c = fake();
      const out = await replyRecord({ project: P, text: `${replyCode(line)} ${label}`, client: c, now: () => LATER });
      assert.equal(out.made, false, label);
      assert.equal(c.calls.record.length + c.calls.write.length, 0, label);
    }
    // The card stays good after those. A code is good once.
    const c = fake();
    const out = await replyRecord({ project: P, text: `${replyCode(line)} comma`, client: c, now: () => LATER });
    assert.deepEqual(out, { made: true, says: 'Recorded: Answer: Comma' });
    assert.deepEqual(signed(c).map((r) => [r.data.action, r.data.questionId, r.data.label]), [['answer', 'q-export-csv-1', 'Comma']]);
    const again = fake();
    assert.equal((await replyRecord({ project: P, text: `${replyCode(line)} Tab`, client: again, now: () => LATER })).made, false);
  });
});

test('a reply on a build loop card whose record can\'t be earned records nothing and lets the card go', async () => {
  await withHome(async () => {
    // No incident was declared, and the work has moved on to another document.
    keepEvent(makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export', lane: 'feature', doc: { path: 'd.md', hash: NEW_DOC }, visible: true, dependsOn: [] }, now: () => NOW }));
    for (const [line, label] of [[liftIncidentLine('bad-total'), 'End it'], [approveWorkLine('export-csv', 'feature', DOC), 'Approve']]) {
      await show(cardOf(line), { options: WORK_OPTIONS });
      const c = fake();
      const out = await replyRecord({ project: P, text: `${replyCode(line)} ${label}`, client: c, now: () => LATER });
      assert.equal(out.made, false, label);
      assert.equal(c.calls.record.length, 0, label);
    }
  });
});

test('no reply turns on Unattended or confirms a Windows build-commands setting: only a click on its own card does', async () => {
  await withHome(async () => {
    const me = computerId();
    const setting = (value) => makeEvent({ kind: 'setting', data: { key: settingKey(me), value, words: `Run build commands: ${value}` }, now: () => NOW });
    const on = setting('unattended');
    const guarded = setting('guarded');
    keepEvent(on);
    keepEvent(guarded);
    const tried = [];
    const reply = async (text) => {
      const c = fake();
      const out = await replyRecord({ project: P, text, client: c, now: () => LATER });
      tried.push(c);
      return out;
    };
    // The Unattended card's line is no set line, so the card has no reply code at all.
    const line = unattendedBuildsLine(on.id, me);
    await show(`${UNATTENDED_CARD().risk}\n${line}\n${replyCodeLine(replyCode(line))}`, { options: ['Keep asking', 'Turn on (dangerous)', 'Use Guarded'] });
    assert.deepEqual(await reply(`${replyCode(line)} Turn on (dangerous)`), { made: false, says: 'No card has that code' });
    // A card that carries the Unattended line beside the setting's confirm line: neither its
    // Turn on (dangerous) nor its Confirm can be answered by a reply.
    const both = cardOf(confirmLine(on), `${UNATTENDED_CARD().risk}\n${line}`);
    await show(both, { options: ['Turn on (dangerous)', 'Confirm', 'Not now'] });
    assert.deepEqual(await reply(`${replyCode(confirmLine(on))} Turn on (dangerous)`), { made: false, says: 'That option doesn\'t need a reply code' });
    assert.deepEqual(await reply(`${replyCode(confirmLine(on))} Confirm`), { made: false, says: 'That setting is changed only by a click on its own card' });
    // The Unattended card offering Use Guarded carries Guarded's confirm line and its code, and
    // Use Guarded, which confirms that event, is a click only too.
    const proposed = setting('guarded');
    keepEvent(proposed);
    const offered = `What this is: ${UNATTENDED_CARD({ guardedReady: true }).what} ${UNATTENDED_CARD().risk}\n${line}\n${confirmLine(proposed)}\n${replyCodeLine(replyCode(confirmLine(proposed)))}`;
    await show(offered, { options: ['Keep asking', 'Turn on (dangerous)', 'Use Guarded'] });
    assert.deepEqual(await reply(`${replyCode(confirmLine(proposed))} Use Guarded`), { made: false, says: 'That setting is changed only by a click on its own card' });
    assert.deepEqual(await reply(`${replyCode(confirmLine(proposed))} Turn on (dangerous)`), { made: false, says: 'That option doesn\'t need a reply code' });
    // Guarded's card confirms through the setting's confirm line, by a click only.
    await show(cardOf(confirmLine(guarded)), { options: ['Confirm', 'Not now'] });
    assert.deepEqual(await reply(`${replyCode(confirmLine(guarded))} Confirm`), { made: false, says: 'That setting is changed only by a click on its own card' });
    // Nor from the director's profile.
    const profiled = { ...setting('guarded') };
    fs.mkdirSync(path.join(profileDir(), path.dirname(eventPath(profiled))), { recursive: true });
    fs.writeFileSync(path.join(profileDir(), eventPath(profiled)), JSON.stringify(profiled));
    await show(cardOf(confirmLine(profiled)), { options: ['Confirm', 'Not now'] });
    assert.deepEqual(await reply(`${replyCode(confirmLine(profiled))} Confirm`), { made: false, says: 'That setting is changed only by a click on its own card' });
    for (const c of tried) assert.equal(c.calls.record.length + c.calls.profileRecord.length + c.calls.write.length, 0);
    // Another setting's confirm card still takes a reply.
    const tab = makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build', words: 'Open the board on its build tab' }, now: () => NOW });
    keepEvent(tab);
    await show(cardOf(confirmLine(tab)), { options: ['Confirm', 'Not now'] });
    assert.equal((await reply(`${replyCode(confirmLine(tab))} Confirm`)).made, true);
  });
});

test('a reply allows a build-command question\'s commands only on the computer that recorded the question', async () => {
  await withHome(async () => {
    const asked = (n) => ({
      id: `q-export-csv-${n}`, work: 'export-csv', what: 'Let this feature\'s builder run: npm test.', why: 'The tests need running',
      options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })), recommendation: 'Allow this time', level: 3, commands: ['npm test'],
    });
    const options = [...BUILD_QUESTION_OPTIONS.map((o) => o.label), 'Explain more'];
    const here = makeEvent({ kind: 'question', data: asked(1), now: () => NOW });
    const elsewhere = { ...makeEvent({ kind: 'question', data: asked(2), now: () => NOW }), computer: 'deadbeef' };
    const unknown = { ...makeEvent({ kind: 'question', data: asked(3), now: () => NOW }), computer: undefined };
    for (const e of [here, elsewhere, unknown]) keepEvent(e);
    const reply = async (id, label) => {
      const c = fake();
      const out = await replyRecord({ project: P, text: `${replyCode(answerLine(id))} ${label}`, client: c, now: () => LATER });
      return { out, signed: signed(c) };
    };
    const ELSEWHERE = { made: false, says: 'Build commands are allowed only on the Windows computer that asked: answer the card there' };
    for (const id of ['q-export-csv-2', 'q-export-csv-3']) {
      await show(cardOf(answerLine(id)), { options });
      for (const label of ['Allow this time', 'Allow for this feature']) assert.deepEqual(await reply(id, label), { out: ELSEWHERE, signed: [] }, `${id} ${label}`);
      // Not now by reply stays as it is: it needs no reply code.
      assert.deepEqual((await reply(id, 'Not now')).out, { made: false, says: 'That option doesn\'t need a reply code' });
    }
    // On the computer that recorded the question, the reply answers it as a click would.
    await show(cardOf(answerLine('q-export-csv-1')), { options });
    const { out, signed: made } = await reply('q-export-csv-1', 'Allow for this feature');
    assert.deepEqual(out, { made: true, says: 'Recorded: Answer: Allow for this feature' });
    assert.deepEqual(made.map((r) => [r.data.action, r.data.questionId, r.data.label]), [['answer', 'q-export-csv-1', 'Allow for this feature']]);
  });
});

test('a reply-code Confirm on a profile setting\'s card closes the card in the project\'s waiting view', async () => {
  await withHome(async () => {
    // The setting is in the director's profile; its confirm card is in the project's state.
    const setting = makeEvent({ kind: 'setting', data: { key: 'boardTab', value: 'build', words: 'Board opens on: build' }, now: () => NOW });
    const inProfile = path.join(profileDir(), eventPath(setting));
    fs.mkdirSync(path.dirname(inProfile), { recursive: true });
    fs.writeFileSync(inProfile, JSON.stringify(setting));
    const line = confirmLine(setting);
    const question = cardOf(line);
    const options = ['Confirm', 'Not now', 'Explain more', 'Show me'];
    const cardEvent = makeEvent({ kind: 'card', data: { question, header: 'Confirm', options, kind: 'confirm', level: 3, line }, now: () => NOW });
    keepEvent(cardEvent);
    await show(question, { options });
    assert.deepEqual((await writeViews(P, { now: () => NOW })).waiting.map((w) => w.id), [cardEvent.id]);

    // The helper, as it would: the confirmation goes into the profile, the plain answer into the state clone.
    const c = fake();
    c.profile.record = async (b) => { c.calls.profileRecord.push(b); return { ok: true }; };
    c.state.write = async (b) => {
      c.calls.write.push(b);
      keepEvent(makeEvent({ kind: b.kind, data: b.data, now: () => LATER }));
      return { ok: true };
    };
    const out = await replyRecord({ project: P, text: `${replyCode(line)} confirm`, client: c, now: () => LATER });
    assert.deepEqual(out, { made: true, says: 'Recorded: Confirm the setting' });
    assert.deepEqual(c.calls.profileRecord.map((r) => r.event.data.confirms), [setting.id]);
    assert.deepEqual(c.calls.write, [{ project: P, kind: 'card-answer', data: { question, label: 'Confirm' } }]);
    assert.deepEqual((await writeViews(P, { now: () => LATER })).waiting, []);
  });
});

test('no reply lets a setup step go ahead: only the director\'s click on the card setup showed does', async () => {
  await withHome(async () => {
    const line = setupLine(1, 'fedcba9876543210'.repeat(4));
    await show(cardOf(line, 'Setup step 1, checking this computer, changes nothing on it.'), { options: ['Go ahead', 'Not now', 'Explain more'] });
    // A setup card gets no shown record (ruling R36), so its code, even on a card written by hand,
    // names no card.
    for (const label of ['Go ahead', 'Not now']) {
      const c = fake();
      assert.deepEqual(await replyRecord({ project: P, text: `${replyCode(line)} ${label}`, client: c, now: () => LATER }), { made: false, says: 'No card has that code' }, label);
      assert.equal(c.calls.record.length + c.calls.profileRecord.length + c.calls.write.length, 0, label);
    }
  });
});
