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
import { approvalLine, confirmLine, LIFT_STOP, runbookLine, replyCode, replyCodeLine } from '../../../scripts/state/card-lines.js';
import { stateDir, stopFile } from '../../../scripts/lib/paths.js';

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
    assert.deepEqual(await replyRecord({ project: P, text: `${code} explain MORE`, client: c, now: () => LATER }), { made: false, says: 'Nothing to record for Explain more' });
    assert.deepEqual(await replyRecord({ project: P, text: `${code} Not now.`, client: c, now: () => LATER }), { made: false, says: 'Nothing to record for Not now' });
    assert.equal(c.calls.record.length + c.calls.write.length + c.calls.prState.length, 0);
  });
});

test('a reply earns exactly the record the click would have', async () => {
  await withHome(async () => {
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
      // Nothing else: no plain answer, and the typed text is written nowhere.
      assert.equal(reply.calls.write.length, 0);
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
    assert.deepEqual(kept.map((k) => [k.route, k.body.event.data.action, k.body.event.data.step]), [['record', 'runbook', 2]]);
    assert.ok(!JSON.stringify(kept).includes('dO'));
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
