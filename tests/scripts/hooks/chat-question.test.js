// tests/scripts/hooks/chat-question.test.js
// A First Mate turn that ends on a question with no card adds one count, and none of the words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { decide, endsOnQuestion } from '../../../scripts/hooks/chat-question.js';
import { hookMain } from '../../../scripts/hooks/kit.js';
import { makeEvent } from '../../../scripts/state/events.js';

const NOW = new Date('2026-11-01T02:00:00.000Z');
const user = (content) => ({ type: 'user', message: { role: 'user', content } });
const says = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const tool = (name) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input: {} }] } });
const result = user([{ type: 'tool_result', tool_use_id: 't', content: 'done' }]);

function setUp(entries, over = {}) {
  const writes = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-chat-'));
  const transcript = path.join(dir, 'chat.jsonl');
  fs.writeFileSync(transcript, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const input = { hook_event_name: 'Stop', session_id: 's', cwd: dir, transcript_path: transcript, ...over.input };
  const deps = {
    projectOf: () => ({ project: 'owner__name' }), env: {}, now: () => NOW,
    client: { state: { write: async (body) => { writes.push(body); return { ok: true }; } } },
    ...over.deps,
  };
  return { writes, input, deps };
}

test('a turn ends on a question when its last line does', () => {
  assert.equal(endsOnQuestion('Done.\n\nWhich colour shall I use?'), true);
  assert.equal(endsOnQuestion('Which colour shall I use?  \n'), true);
  assert.equal(endsOnQuestion('**Which colour shall I use?**'), true);
  assert.equal(endsOnQuestion('どちらにしますか？'), true);
  assert.equal(endsOnQuestion('أي واحد؟'), true);
});

test('an agent\'s reply that only quotes a question counts nothing', () => {
  assert.equal(endsOnQuestion('They asked "why?" and it was answered.'), false);
  assert.equal(endsOnQuestion('They asked "why?"'), false);
  assert.equal(endsOnQuestion('They asked ‘why?’'), false);
  assert.equal(endsOnQuestion('> Which colour shall I use?'), false);
  assert.equal(endsOnQuestion('```\nwhich?\n```'), false);
  assert.equal(endsOnQuestion('All done.'), false);
  assert.equal(endsOnQuestion(''), false);
  assert.equal(endsOnQuestion(undefined), false);
});

test('a question with no card adds one count, with none of the words', async () => {
  const { writes, input, deps } = setUp([user('Hello'), says('Which colour shall I use?')]);
  assert.equal(await decide(input, deps), undefined);
  assert.deepEqual(writes, [{ project: 'owner__name', kind: 'chat-question', data: { at: NOW.toISOString() } }]);
  assert.doesNotMatch(JSON.stringify(writes), /colour/);
});

test('the words come from the hook\'s input where it gives them', async () => {
  const { writes, input, deps } = setUp([user('Hello'), says('All done.')], { input: { last_assistant_message: 'Which colour?' } });
  await decide(input, deps);
  assert.equal(writes.length, 1);
  const none = setUp([user('Hello'), says('Which colour?')], { input: { last_assistant_message: 'All done.' } });
  await decide(none.input, none.deps);
  assert.equal(none.writes.length, 0);
});

test('a chat-question record holds its time and nothing else', () => {
  assert.equal(makeEvent({ kind: 'chat-question', data: { at: NOW.toISOString() } }).kind, 'chat-question');
  assert.throws(() => makeEvent({ kind: 'chat-question', data: { at: NOW.toISOString(), words: 'Which?' } }), /chat-question/);
});

test('a turn that asked a card counts nothing', async () => {
  const { writes, input, deps } = setUp([user('Hello'), tool('AskUserQuestion'), result, says('And which colour?')]);
  await decide(input, deps);
  assert.deepEqual(writes, []);
});

test('a card asked in an earlier turn doesn\'t cover this one', async () => {
  const { writes, input, deps } = setUp([user('Hello'), tool('AskUserQuestion'), result, says('Noted.'), user('Next'), tool('Read'), result, says('Which colour?')]);
  await decide(input, deps);
  assert.equal(writes.length, 1);
});

test('a stop that follows a stop hook\'s own block counts nothing', async () => {
  const { writes, input, deps } = setUp([user('Hello'), says('Which?')], { input: { stop_hook_active: true } });
  await decide(input, deps);
  assert.deepEqual(writes, []);
});

test('outside the front desk, and in a failure of its own, it says nothing and blocks nothing', async () => {
  const entries = [user('Hello'), says('Which?')];
  for (const over of [
    { deps: { projectOf: () => null } },
    { deps: { env: { WHEELHOUSE_ROLE: 'foreman' } } },
    { input: { transcript_path: '/nowhere/at/all.jsonl' } },
    { deps: { projectOf: () => { throw new Error('no'); } } },
  ]) {
    const { writes, input, deps } = setUp(entries, over);
    assert.equal(await decide(input, deps), undefined);
    assert.deepEqual(writes, []);
  }
  const refused = setUp(entries, { deps: { client: { state: { write: async () => { throw new Error('down'); } } } } });
  assert.equal(await decide(refused.input, refused.deps), undefined);
});

test('in a feature worktree it counts nothing', async () => {
  const { writes, input, deps } = setUp([user('Hello'), says('Which?')]);
  await decide(input, { ...deps, slugOf: () => 'some-work' });
  assert.deepEqual(writes, []);
});

test('run as a hook it prints nothing', async () => {
  const { input, deps } = setUp([user('Hello'), says('Which?')]);
  let printed = '';
  await hookMain(decide, { failClosed: false, event: 'Stop' }, { stdin: Readable.from([JSON.stringify(input)]), write: (text) => { printed += text; }, deps });
  assert.equal(printed, '');
});

test('the hook is registered on Stop', () => {
  const stop = JSON.parse(fs.readFileSync(new URL('../../../hooks/hooks.json', import.meta.url), 'utf8')).hooks.Stop.flatMap((h) => h.hooks.map((one) => one.command));
  assert.ok(stop.some((command) => command.includes('scripts/hooks/chat-question.js')));
});
