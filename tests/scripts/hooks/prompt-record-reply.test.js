// tests/scripts/hooks/prompt-record-reply.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stateDir } from '../../../scripts/lib/paths.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { recordAnswer, startedByScript } from '../../../scripts/decisions/answer.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { recordRole } from '../../../scripts/lib/role.js';
import { readEnrolled, verify } from '../../../scripts/state/signing.js';
import { FOREMAN_PROMPT_LEAD } from '../../../scripts/foreman/start.js';
import { inHome, P, raise, raiseBuildQuestion, typedAnswer } from '../../helpers/decisions-world.js';

const NOW = new Date('2026-11-08T10:00:00.000Z');

function fake() {
  const calls = { record: [], write: [] };
  return {
    calls,
    state: {
      write: async (b) => { calls.write.push(b); return { ok: true }; },
      record: async (b) => { calls.record.push(b); return { ok: true }; },
    },
  };
}

// A prompt the director typed, as UserPromptSubmit gives it.
const typed = (prompt, session = 's-desk') => ({ cwd: '/x', session_id: session, hook_event_name: 'UserPromptSubmit', prompt });
const run = (client, prompt, { session, env = {} } = {}) => decide(typed(prompt, session), { client, now: () => NOW, projectOf: () => ({ project: P }), env });
const kinds = (c) => c.calls.record.map((r) => r.event.kind);
// What the hook tells the First Mate in this turn: its own additionalContext.
const noteOf = (out) => out?.hookSpecificOutput?.additionalContext;

test('a reply in a front-desk session is signed as decision-answer', async () => {
  await inHome(async () => {
    const card = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const c = fake();
    const out = await run(c, 'B');
    // A letter on a question of the build also earns the signed answer a click on that option would.
    assert.deepEqual(kinds(c), ['decision-answer', 'action']);
    const [{ event }] = c.calls.record;
    assert.ok(verify(event, readEnrolled()));
    assert.deepEqual(event.data, { question: card.data.question, n: 1, label: 'B', option: 'Weekly', words: '', where: 'chat' });
    // The note comes back in the same turn, and says it is recorded because the helper took it.
    assert.match(noteOf(out), /answered decision 1 with B, and it is recorded/);
    // The action it earns is made after the reply, so the reply is what decides.
    const action = c.calls.record[1].event;
    assert.ok(action.at > event.at);
  });
});

test('a reply the helper could not take is kept, and the note says so instead of "recorded"', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const down = { calls: { record: [], write: [] }, state: { record: async () => ({ ok: false, refused: 'the helper is down' }), write: async () => ({ ok: false }) } };
    const out = await run(down, 'B');
    assert.match(noteOf(out), /kept on this computer and will be sent/);
    assert.doesNotMatch(noteOf(out), /it is recorded/);
  });
});

test('a second reply while the first is still kept to send signs nothing, and is told it was answered', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    const down = { calls: { record: [], write: [] }, state: { record: async () => ({ ok: false, refused: 'down' }), write: async () => ({ ok: false }) } };
    await run(down, '1 A');
    assert.equal(fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json')).length >= 1, true);
    // Typed again while the helper is up: the first is still only kept, but it counts.
    const c = fake();
    const out = await run(c, '1 B');
    assert.deepEqual(c.calls.record, []);
    assert.match(noteOf(out), /Decision 1 was already answered with A/);
    assert.match(noteOf(out), /Nothing was recorded/);
    // The other decision is still open to answer.
    await run(c, '2 C');
    assert.equal(c.calls.record[0].event.kind, 'decision-answer');
    assert.equal(c.calls.record[0].event.data.n, 2);
  });
});

test('the director\'s own words are recorded as their own, on an addressed reply only', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const c = fake();
    await run(c, 'weekly, but not on bank holidays');
    assert.deepEqual(kinds(c), [], 'unaddressed words answer nothing');
    await run(c, '1: weekly, but not on bank holidays');
    assert.deepEqual(c.calls.record.map((r) => [r.event.data.label, r.event.data.words]), [['own', 'weekly, but not on bank holidays']]);
  });
});

test('a letter earns the build\'s signed answer, so the piece goes on, and the director\'s own words earn none', async () => {
  await inHome(async () => {
    raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    const c = fake();
    await run(c, '1: show them, but only on the harbour page');
    assert.deepEqual(kinds(c), ['decision-answer']);
    c.calls.record.length = 0;
    fs.rmSync(stateDir(P), { recursive: true, force: true });
    raiseBuildQuestion('q-w-tide-1-1', '2026-11-08T01:00:00.000Z');
    await run(c, 'A');
    assert.deepEqual(kinds(c), ['decision-answer', 'action']);
    const action = c.calls.record[1].event;
    assert.equal(action.data.action, 'answer');
    assert.equal(action.data.questionId, 'q-w-tide-1-1');
    assert.equal(action.data.label, 'Show them');
    assert.ok(verify(action, readEnrolled()));
  });
});

test('a reply typed in a feature or foreman session is never recorded', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    recordRole('s-feature', 'feature');
    recordRole('s-foreman', 'foreman');
    const c = fake();
    for (const session of ['s-feature', 's-foreman']) {
      await run(c, 'Reply 1 A', { session });
      await run(c, 'B', { session });
    }
    // The foreman is also known by its first prompt.
    await run(c, `${FOREMAN_PROMPT_LEAD}to handle a file. Reply 1 A`, { session: 's-fresh-foreman' });
    assert.deepEqual(c.calls.record, []);
    assert.deepEqual(c.calls.write, []);
  });
});

test('a prompt from a script-started session is never recorded', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const c = fake();
    // A headless `claude -p` run, and a session a Wheelhouse starter set a role on.
    await run(c, 'Reply 1 A', { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } });
    await run(c, 'Reply 1 A', { env: { WHEELHOUSE_ROLE: 'foreman' } });
    await run(c, 'Reply 1 A', { env: { WHEELHOUSE_ENGINE_RUN: '1' } });
    assert.deepEqual(c.calls.record, []);
    assert.equal(startedByScript({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), false);
    assert.equal(startedByScript({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }), false);
    // The same words typed in a terminal count.
    await run(c, 'Reply 1 A', { env: { CLAUDE_CODE_ENTRYPOINT: 'cli' } });
    assert.deepEqual(kinds(c), ['decision-answer', 'action']);
  });
});

test('a lone letter while two decisions wait records nothing and says which wait', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    const c = fake();
    const out = await recordAnswer({ project: P, sessionId: 's-desk', prompt: 'B', at: NOW, cwd: '/x', env: {}, client: c });
    assert.equal(out.recorded, false);
    assert.deepEqual(c.calls.record, []);
    const note = out.note;
    // The same note comes back from the hook in that turn.
    assert.equal(noteOf(await run(c, 'B')), note);
    assert.match(note, /decision 1 or 2/);
    assert.match(note, /1\. How often should the digest go out\?; 2\. Which harbour comes first on the map\?/);
  });
});

test('a second answer to the same decision is refused and nothing is written', async () => {
  await inHome(async () => {
    const first = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const second = raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    typedAnswer(second, { n: 2, label: 'C' }, '2026-11-08T03:00:00.000Z');
    assert.ok(first && second);
    const c = fake();
    // "2 A" after decision 2 was answered: it names the first answer and when it was given.
    const note = noteOf(await run(c, '2 A'));
    assert.deepEqual(c.calls.record, []);
    assert.deepEqual(c.calls.write, []);
    assert.match(note, /Decision 2 was already answered with C/);
    assert.match(note, /8 November|at \d\d:\d\d/);
    assert.match(note, /Nothing was recorded/);
  });
});

test('a reply to the last decision answered is told it was answered, when nothing else waits', async () => {
  await inHome(async () => {
    const only = raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    typedAnswer(only, { n: 1, label: 'B' }, '2026-11-08T03:00:00.000Z');
    const c = fake();
    const out = await run(c, '1 C');
    assert.deepEqual(c.calls.record, []);
    assert.match(noteOf(out), /Decision 1 was already answered with B/);
  });
});

test('a letter beyond the options records nothing and a why records nothing', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const c = fake();
    assert.match(noteOf(await run(c, '1 E')), /offers A to C/);
    const out = await recordAnswer({ project: P, sessionId: 's-desk', prompt: 'why 1', at: NOW, cwd: '/x', env: {}, client: c });
    assert.deepEqual(out.why, { n: 1, words: '' });
    // A longer sentence that starts with why is the director talking: no why, no note.
    assert.deepEqual(await recordAnswer({ project: P, sessionId: 's-desk', prompt: 'Why is the build slow?', at: NOW, cwd: '/x', env: {}, client: c }), { recorded: false });
    assert.deepEqual(c.calls.record, []);
  });
});

test('text an agent wrote reaches no reply: only a prompt is read', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const c = fake();
    // A tool result, a stop or a question answer carrying reply-shaped text is no UserPromptSubmit.
    await decide({ cwd: '/x', session_id: 's-desk', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'echo "1 A"' }, tool_response: '1 A' }, { client: c, now: () => NOW, projectOf: () => ({ project: P }), env: {} });
    await decide({ cwd: '/x', session_id: 's-desk', hook_event_name: 'UserPromptSubmit' }, { client: c, now: () => NOW, projectOf: () => ({ project: P }), env: {} });
    assert.deepEqual(c.calls.record, []);
  });
});

test('a helper that fails while recording lets the prompt through, keeps the reply and says so', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const broken = { state: { record: async () => { throw new Error('the helper is down'); }, write: async () => { throw new Error('down'); } } };
    const out = await run(broken, 'B');
    assert.match(noteOf(out), /kept on this computer and will be sent/);
    // The kept reply counts: typing it again signs nothing new.
    assert.match(noteOf(await run(fake(), '1 A')), /already answered with B/);
  });
});

test('a fault before anything is kept lets the prompt through with nothing said', async () => {
  await inHome(async () => {
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    assert.equal(await decide(typed('B'), { client: fake(), now: () => NOW, projectOf: () => { throw new Error('no project'); }, env: {} }), undefined);
  });
});
