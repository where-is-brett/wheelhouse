// tests/scripts/hooks/card-check-shown.test.js
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { sessionRole } from '../../../scripts/lib/role.js';
import { seatFile, readSeat } from '../../../scripts/lib/first-mate-seat.js';
import assert from 'node:assert/strict';
import { decide, checkShown, DECISION_IN_CHAT } from '../../../scripts/hooks/card-check.js';
import { pendingDecisions } from '../../../scripts/decisions/pending.js';
import { decisionText } from '../../../scripts/decisions/message.js';
import { asQuestion } from '../../../scripts/cards/visit.js';
import { inHome as inHomeOff, turnOn, turnOff, P, raise } from '../../helpers/decisions-world.js';
// Typed replies are on by default (the director's decision of 8 November 2026); these tests still switch them on, and say so where they mean off.
const inHome = (fn) => inHomeOff(async (home) => { turnOn(); return fn(home); });


const stop = (message, extra = {}) => ({ cwd: '/x', session_id: 's-desk', hook_event_name: 'Stop', last_assistant_message: message, ...extra });
const deps = { projectOf: () => ({ project: P }), env: {} };

test('a Decision needed block equal to decision 1\'s text passes', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const [one] = pendingDecisions(P);
    const message = `Here is what I need from you.\n\n${decisionText(one)}\n`;
    assert.deepEqual(checkShown(message, [one]), { ok: true });
    assert.equal(await decide(stop(message), deps), undefined);
  });
});

test('a paraphrased block is sent back with "show decision 1 exactly as printed"', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const [one] = pendingDecisions(P);
    const paraphrase = decisionText(one).replace('Recommended because:', 'I suggest B because');
    const checked = checkShown(paraphrase, [one]);
    assert.equal(checked.ok, false);
    assert.match(checked.reason, /Show decision 1 exactly as printed/);
    const out = await decide(stop(paraphrase), deps);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Show decision 1 exactly as printed/);
  });
});

test('a Decision needed block with no waiting decision is sent back', async () => {
  await inHome(async () => {
    const made = decisionText({
      n: 1, question: 'Which colour?', work: null, why: 'It is yours.', options: [{ label: 'Red', says: 'Red.' }, { label: 'Blue', says: 'Blue.' }],
      recommend: 'Red', because: 'it is bold.', meanwhile: 'Nothing waits.',
    });
    const checked = checkShown(made, []);
    assert.equal(checked.ok, false);
    assert.match(checked.reason, /No decision is waiting/);
    const out = await decide(stop(made), deps);
    assert.equal(out.decision, 'block');
  });
});

test('a message with no decision block is never held, and a turn already sent back is let go', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    assert.equal(await decide(stop('Nothing to decide today.'), deps), undefined);
    const paraphrase = 'Decision needed (1): how often?   (holds up: nothing else)\nReply 1 A';
    assert.equal((await decide(stop(paraphrase), deps)).decision, 'block');
    assert.equal(await decide(stop(paraphrase, { stop_hook_active: true }), deps), undefined);
  });
});

test('the Stop check only watches a front-desk session that no script started', async () => {
  await inHome(async () => {
    const paraphrase = 'Decision needed (1): how often?   (holds up: nothing else)\nReply 1 A';
    const feature = { ...deps, role: () => 'feature' };
    assert.equal(await decide(stop(paraphrase), feature), undefined);
    assert.equal(await decide(stop(paraphrase), { ...deps, env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }), undefined);
  });
});

test('an error inside the Stop check lets the message go', async () => {
  await inHome(async () => {
    const paraphrase = 'Decision needed (1): how often?   (holds up: nothing else)\nReply 1 A';
    const broken = { ...deps, decisions: { get pending() { throw new Error('the record cannot be read'); } } };
    assert.equal(await decide(stop(paraphrase), broken), undefined);
    assert.equal(await decide(stop(paraphrase), { ...deps, projectOf: () => { throw new Error('no project'); } }), undefined);
  });
});

test('the last message is read from the transcript when the hook gives none', async () => {
  await inHome(async (home) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(home, 'transcript.jsonl');
    fs.mkdirSync(home, { recursive: true });
    const paraphrase = 'Decision needed (1): how often?   (holds up: nothing else)\nReply 1 A';
    fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: paraphrase }] } })}\n`);
    const out = await decide({ cwd: '/x', session_id: 's-desk', hook_event_name: 'Stop', transcript_path: file }, deps);
    assert.equal(out.decision, 'block');
  });
});

test('typed replies never set: the default is on, so the question picker is refused for a decision', async () => {
  await inHomeOff(async () => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const question = asQuestion({ data: card.data });
    const out = await decide({ cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [question] } }, { projectOf: () => ({ project: P }), env: {} });
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, DECISION_IN_CHAT);
  });
});

test('the question picker is refused for a decision, with the way to show it', async () => {
  await inHome(async () => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const question = asQuestion({ data: card.data });
    const out = await decide({ cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [question] } }, { projectOf: () => ({ project: P }), env: {} });
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, DECISION_IN_CHAT);
  });
});

test('a reworded decision card is refused for the picker, as the exact one is', async () => {
  await inHome(async () => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const stored = asQuestion({ data: card.data });
    const reworded = { ...stored, question: 'Other words entirely about the digest.' };
    const out = await decide({ cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [reworded] } }, { projectOf: () => ({ project: P }), env: {} });
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, DECISION_IN_CHAT);
  });
});

test('typed replies switched off: the question picker is allowed for a decision, as on main', async () => {
  await inHomeOff(async () => {
    turnOff();
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const question = asQuestion({ data: card.data });
    const input = { cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [question] } };
    const off = await decide(input, { projectOf: () => ({ project: P }), env: {} });
    assert.notEqual(off?.hookSpecificOutput?.permissionDecisionReason, DECISION_IN_CHAT);
    turnOn();
    const on = await decide(input, { projectOf: () => ({ project: P }), env: {} });
    assert.equal(on.hookSpecificOutput.permissionDecisionReason, DECISION_IN_CHAT);
  });
});

test('an aside session\'s Stop is not checked, and the holder\'s is', async () => {
  await inHome(async () => {
    const paraphrase = 'Decision needed (1): how often?   (holds up: nothing else)\nReply 1 A';
    const seat = (session) => ({ session, pid: null, pidStart: null, folder: '/x', since: '2026-11-08T01:00:00.000Z', seenAt: new Date().toISOString() });
    const take = (session) => {
      fs.mkdirSync(path.dirname(seatFile(P)), { recursive: true });
      fs.writeFileSync(seatFile(P), JSON.stringify(seat(session)));
    };
    const real = { projectOf: () => ({ project: P }), env: {}, role: (given) => sessionRole({ ...given, seat: readSeat(P) }) };
    take('other');
    assert.equal(await decide(stop(paraphrase), real), undefined);
    take('s-desk');
    assert.equal((await decide(stop(paraphrase), real)).decision, 'block');
  });
});

test('the holder\'s Stop refreshes the seat', async () => {
  await inHome(async () => {
    const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    fs.mkdirSync(path.dirname(seatFile(P)), { recursive: true });
    fs.writeFileSync(seatFile(P), JSON.stringify({ session: 's-desk', pid: null, pidStart: null, folder: '/x', since: old, seenAt: old }));
    await decide(stop('All done.'), { projectOf: () => ({ project: P }), env: {} });
    assert.ok(Date.parse(readSeat(P).seenAt) > Date.parse(old));
  });
});
