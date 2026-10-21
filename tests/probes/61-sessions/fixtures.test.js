// tests/probes/61-sessions/fixtures.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { replyOf, sessionIdOf, toolCalls } from '../../../probes/61-sessions/run.js';

const read = (name) => {
  const file = fileURLToPath(new URL(`../../fixtures/copilot/sessions/${name}`, import.meta.url));
  const text = fs.readFileSync(file, 'utf8');
  return { text, events: JSON.parse(text) };
};

test('the finished run has its tool call, its reply and a result event carrying the session id', () => {
  const { events } = read('finished-run.json');
  assert.equal(sessionIdOf(events), '<ID>');
  assert.equal(events.at(-1).exitCode, 0);
  assert.deepEqual(toolCalls(events).map((call) => [call.tool, call.success]), [['view', true]]);
  assert.match(replyOf(events), /secret word/);
});

test('the resumed run asked no tool and recalled the earlier turn', () => {
  const { events } = read('resumed-run.json');
  assert.equal(toolCalls(events).length, 0);
  assert.equal(replyOf(events), '<SECRET>');
  assert.equal(sessionIdOf(events), '<ID>');
});

test('the refusal is a failed tool call with the code denied, in a run that still exits 0', () => {
  const { events } = read('refusal.json');
  const [call] = toolCalls(events);
  assert.deepEqual([call.tool, call.success, call.code], ['bash', false, 'denied']);
  assert.match(call.error, /no interactive user response was available/);
  assert.equal(events.at(-1).exitCode, 0);
});

test('the fixtures hold no home path, temporary path, id, model name or secret word', () => {
  for (const name of ['finished-run.json', 'resumed-run.json', 'refusal.json']) {
    const { text } = read(name);
    assert.doesNotMatch(text, /\/Users\/|\/var\/folders|\/tmp\//, name);
    assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, name);
    assert.doesNotMatch(text, /call_[A-Za-z0-9]/, name);
    assert.doesNotMatch(text, /gpt|claude|sonnet|opus|encrypted/i, name);
    assert.doesNotMatch(text, /secret-[0-9a-f]{8}/, name);
  }
});
