// tests/scripts/hooks/card-check-shown.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, checkShown, DECISION_IN_CHAT } from '../../../scripts/hooks/card-check.js';
import { pendingDecisions } from '../../../scripts/decisions/pending.js';
import { decisionText } from '../../../scripts/decisions/message.js';
import { asQuestion } from '../../../scripts/cards/visit.js';
import { inHome as inHomeOff, turnOn, P, raise } from '../../helpers/decisions-world.js';
// Typed replies are off until the director rules; these tests are of the behaviour with them on, and say so where they mean off.
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

test('the question picker is refused for a decision, with the way to show it', async () => {
  await inHome(async () => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const question = asQuestion({ data: card.data });
    const out = await decide({ cwd: '/x', session_id: 's-desk', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [question] } }, { projectOf: () => ({ project: P }), env: {} });
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, DECISION_IN_CHAT);
  });
});

test('typed replies off, the default: the question picker is allowed for a decision, as on main', async () => {
  await inHomeOff(async () => {
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
