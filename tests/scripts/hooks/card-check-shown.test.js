// tests/scripts/hooks/card-check-shown.test.js
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { sessionRole } from '../../../scripts/lib/role.js';
import { seatFile, readSeat } from '../../../scripts/lib/first-mate-seat.js';
import assert from 'node:assert/strict';
import { decide, checkShown, plainQuestion, DECISION_IN_CHAT, DECISION_IN_WINDOW, NO_TYPED_ANSWER } from '../../../scripts/hooks/card-check.js';
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

test('a question asked in plain text is sent back to be a card, once', async () => {
  await inHome(async () => {
    const asked = "I've treated this as a feature. Before I design anything: what do you want to do with it that you can't now?\n\nOr if you'd rather I just dive in, say so.";
    assert.equal(plainQuestion(asked), "I've treated this as a feature. Before I design anything: what do you want to do with it that you can't now?");
    const out = await decide(stop(asked), deps);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /Every question is a card/);
    assert.match(out.reason, /`card`/);
    assert.equal(await decide(stop(asked, { stop_hook_active: true }), deps), undefined);
    assert.equal(await decide(stop(asked), { ...deps, role: () => 'feature' }), undefined);
  });
});

test('a quoted, fenced or printed-card question is not a plain question', () => {
  assert.equal(plainQuestion('You asked:\n> Can it make shopping lists?\nIt can, and that is on the plan.'), null);
  assert.equal(plainQuestion('```\nwhy?\n```\nDone.'), null);
  assert.equal(plainQuestion('Which colour should the button be?\nRed\nBlue\nReply code: 4f2a'), null);
  assert.equal(plainQuestion('Shaping the design with you first.'), null);
  assert.equal(plainQuestion('Is it **ready?**'), 'Is it **ready?**');
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

test('on an agent whose hooks only read, the picker is refused for a decision whatever the switch, and it is answered in the window', async () => {
  await inHomeOff(async () => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const question = { ...asQuestion({ data: card.data }), allowFreeformInput: false };
    const input = { cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [question] } };
    for (const turn of [turnOff, turnOn]) {
      turn();
      const out = await decide(input, { projectOf: () => ({ project: P }), env: {}, writeVia: 'helper' });
      assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
      assert.equal(out.hookSpecificOutput.permissionDecisionReason, DECISION_IN_WINDOW);
      assert.match(DECISION_IN_WINDOW, /`decision confirm <n>`/);
      // An agent whose hooks sign keeps the picker it had: allowed while typed replies are off, refused for the chat while on.
      const own = await decide(input, { projectOf: () => ({ project: P }), env: {}, writeVia: 'self' });
      assert.notEqual(own?.hookSpecificOutput?.permissionDecisionReason, DECISION_IN_WINDOW);
    }
  });
});

test('the decision as printed for the window passes the Stop check, as the typed form does', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const [one] = pendingDecisions(P);
    const windowed = decisionText(one, { window: true });
    assert.notEqual(windowed, decisionText(one));
    assert.match(windowed.split('\n').at(-1), /^Reply in Wheelhouse's own window, which opens for decision 1/);
    assert.equal(await decide(stop(`Decision 1:\n\n${windowed}\n`), deps), undefined);
    assert.equal(await decide(stop(decisionText(one)), deps), undefined);
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

test('a card raised at a feature\'s stage is refused once the feature has moved past that stage', async () => {
  const os = await import('node:os');
  const { keep } = await import('../../helpers/decisions-world.js');
  const { makeEvent } = await import('../../../scripts/state/events.js');
  const { composeCard, answerInput } = await import('../../../scripts/cards/compose.js');
  const { featurePaths, writeStatus } = await import('../../../scripts/feature/files.js');
  await inHomeOff(async () => {
    turnOff();
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-tree-'));
    fs.mkdirSync(path.join(tree, '.wheelhouse', 'feature'), { recursive: true });
    const status = (phase) => writeStatus(featurePaths(tree).status, { v: 1, work: 'w-tide-1', lane: 'quick', phase, task: null, fixRound: null, waitingOn: null, head: null, pr: null, slice: null, tokens: null, updatedAt: '2026-11-08T01:00:00.000Z' });
    const data = {
      id: 'q-w-tide-1-901', work: 'w-tide-1', stage: 'ready-to-build', what: 'Add a greeting line has not moved for 20 minutes. What should happen?',
      why: 'Nothing has moved it on.', options: [{ label: 'Restart the builder', says: 'act restart w-tide-1' }, { label: 'Wait', says: 'Nothing to do now' }],
      recommendation: 'Restart the builder', level: 2,
    };
    keep(makeEvent({ kind: 'question', data, now: () => new Date('2026-11-08T01:00:00.000Z') }));
    keep(makeEvent({ kind: 'feature', data: { work: 'w-tide-1', step: 'building', worktree: tree }, now: () => new Date('2026-11-08T01:00:01.000Z') }));
    const { card } = composeCard(answerInput(data, data.work));
    keep(makeEvent({ kind: 'card', data: card, now: () => new Date('2026-11-08T01:00:02.000Z') }));
    const input = { cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [asQuestion({ data: card })] } };
    const ask = () => decide(input, { projectOf: () => ({ project: P }), env: {}, writeVia: 'self' });
    status('ready-to-build');
    assert.equal((await ask())?.hookSpecificOutput?.permissionDecision, undefined, 'still at its stage: asked');
    status('pr-open');
    const out = await ask();
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /ready-to-build.*pr-open now/);
    fs.rmSync(tree, { recursive: true, force: true });
    keep(makeEvent({ kind: 'feature', data: { work: 'w-tide-1', step: 'closed', worktree: tree }, now: () => new Date('2026-11-08T01:00:03.000Z') }));
    const closed = await ask();
    assert.equal(closed.hookSpecificOutput.permissionDecision, 'deny', 'a closed feature with its worktree gone: refused');
    assert.match(closed.hookSpecificOutput.permissionDecisionReason, /has closed/);
  });
});

test('on an agent whose hooks only read but whose picker click is recorded, a decision is asked in the picker whatever the typed-replies switch says', async () => {
  await inHomeOff(async () => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const question = { ...asQuestion({ data: card.data }), allowFreeformInput: false };
    const input = { cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [question] } };
    for (const turn of [turnOff, turnOn]) {
      turn();
      const out = await decide(input, { projectOf: () => ({ project: P }), env: {}, writeVia: 'helper', picker: true });
      const reason = out?.hookSpecificOutput?.permissionDecisionReason;
      assert.notEqual(reason, DECISION_IN_WINDOW);
      assert.notEqual(reason, DECISION_IN_CHAT);
    }
    // Where the picker click is not recorded, the window path stands.
    const window = await decide(input, { projectOf: () => ({ project: P }), env: {}, writeVia: 'helper', picker: false });
    assert.equal(window.hookSpecificOutput.permissionDecisionReason, DECISION_IN_WINDOW);
  });
});

test('a card that allows a typed answer is refused where the picker click is recorded, since a typed label looks like a click', async () => {
  await inHomeOff(async () => {
    turnOff();
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const typed = { ...asQuestion({ data: card.data }), allowFreeformInput: true };
    const input = (q) => ({ cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q] } });
    const refused = await decide(input(typed), { projectOf: () => ({ project: P }), env: {}, writeVia: 'helper', picker: true });
    assert.equal(refused.hookSpecificOutput.permissionDecisionReason, NO_TYPED_ANSWER);
    const clean = await decide(input({ ...asQuestion({ data: card.data }), allowFreeformInput: false }), { projectOf: () => ({ project: P }), env: {}, writeVia: 'helper', picker: true });
    assert.notEqual(clean?.hookSpecificOutput?.permissionDecisionReason, NO_TYPED_ANSWER);
  });
});

test('where the picker click is recorded, a card that decides is refused unless the call turns typed answers off; an ordinary card is not', async () => {
  await inHomeOff(async () => {
    turnOff();
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const input = (q) => ({ cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [q] } });
    const reasonOf = async (q, picker = true) => (await decide(input(q), { projectOf: () => ({ project: P }), env: {}, writeVia: 'helper', picker }))?.hookSpecificOutput?.permissionDecisionReason;
    // A decision, and a card with an option that signs, asked with nothing said about typed answers: refused.
    assert.equal(await reasonOf(asQuestion({ data: card.data })), NO_TYPED_ANSWER);
    const approval = { question: 'Pull request #4 waits for your approval.', header: 'Approve', options: [{ label: 'Approve', description: 'It merges.' }, { label: 'Not now', description: 'It waits.' }] };
    assert.equal(await reasonOf(approval), NO_TYPED_ANSWER);
    assert.notEqual(await reasonOf({ ...approval, allowFreeformInput: false }), NO_TYPED_ANSWER);
    // An ordinary card with nothing said is asked.
    const ordinary = { question: 'Which colour should the button be?', header: 'Colour', options: [{ label: 'Blue', description: 'Blue.' }, { label: 'Green', description: 'Green.' }] };
    assert.notEqual(await reasonOf(ordinary), NO_TYPED_ANSWER);
    // Where the picker click is not recorded, none of this applies.
    assert.notEqual(await reasonOf(approval, false), NO_TYPED_ANSWER);
  });
});
