// tests/scripts/crew/copilot-events.test.js
// The reader for Copilot's events (~/.copilot/session-state/<id>/events.jsonl, check 96): finding a session's file and
// turning its events into the steps and crew lines the crew view shows, in the shape runSteps gives for Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import { copilotHome, findCopilotEvents, copilotStepOf, copilotRunSteps } from '../../../scripts/crew/copilot-events.js';

const T = '2026-11-12T01:00:00.000Z';
const ev = (type, data = {}, timestamp = T) => ({ type, data, id: `${type}-${Math.random()}`, parentId: null, timestamp });
const start = (toolName, args = {}, toolCallId = 'c1') => ev('tool.execution_start', { toolCallId, toolName, arguments: args });

function session(events, { id = 'sess-1' } = {}) {
  const home = tempFolder('wh-copilot-events-');
  const dir = path.join(home, 'session-state', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return { home, env: { COPILOT_HOME: home }, dir };
}

test('the home is COPILOT_HOME, else .copilot under the person\'s home', () => {
  assert.equal(copilotHome({ COPILOT_HOME: '/x/y' }), '/x/y');
  assert.ok(copilotHome({}).endsWith(`${path.sep}.copilot`));
});

test('it finds a session\'s events file, and nothing for an unsafe id, a missing session or a link', () => {
  const { env, dir, home } = session([ev('session.start')]);
  assert.equal(findCopilotEvents({ sessionId: 'sess-1', env }), path.join(dir, 'events.jsonl'));
  for (const sessionId of ['', '.', '..', '../sess-1', 'a/b', 'a\\b', undefined, 7, 'missing']) assert.equal(findCopilotEvents({ sessionId, env }), null, String(sessionId));
  const other = path.join(home, 'elsewhere.jsonl');
  fs.writeFileSync(other, '{}\n');
  fs.mkdirSync(path.join(home, 'session-state', 'linked'));
  fs.symlinkSync(other, path.join(home, 'session-state', 'linked', 'events.jsonl'));
  assert.equal(findCopilotEvents({ sessionId: 'linked', env }), null, 'a link is not followed');
});

test('a step says what the run did, in plain words, never what a command printed', () => {
  assert.deepEqual(copilotStepOf(start('view', { path: '/p/src/a.js' })), { at: T, text: 'Reading `/p/src/a.js`', kind: 'did' });
  assert.equal(copilotStepOf(start('view', {})).text, 'Reading a file');
  for (const name of ['apply_patch', 'edit', 'create']) assert.equal(copilotStepOf(start(name, { path: 'a.js' })).text, 'Changing `a.js`', name);
  assert.equal(copilotStepOf(start('apply_patch', { input: '*** Begin Patch' })).text, 'Changing a file');
  for (const name of ['rg', 'glob']) assert.equal(copilotStepOf(start(name)).text, 'Searching the code');
  assert.equal(copilotStepOf(start('web_fetch')).text, 'Looking something up');
  assert.equal(copilotStepOf(start('bash', { command: 'ls' })).text, 'Running a command');
  assert.equal(copilotStepOf(start('powershell', { command: 'dir' })).text, 'Running a command');
  assert.equal(copilotStepOf(start('bash', { command: 'cd x && npm test' })).text, 'Running the tests');
  assert.equal(copilotStepOf(start('bash', { command: 'node scripts/frontdesk/cli.js record decision x.json' })).text, 'Recording a decision');
  assert.equal(copilotStepOf(start('something_new')).text, 'Using something_new');
  assert.equal(copilotStepOf(ev('tool.execution_complete', { toolCallId: 'c1', result: { content: 'secret output' } })), null);
});

test('what the model said is its first sentence, and a key-looking text is hidden', () => {
  assert.deepEqual(copilotStepOf(ev('assistant.message', { content: 'I fixed the login. Then I ran it.' })), { at: T, text: 'I fixed the login.', kind: 'said' });
  assert.equal(copilotStepOf(ev('assistant.message', { content: 'The token: ghp_abcdefghijklmnopqrstuvwxyz0123456789 works.' })).text, '[hidden: looked like a key]');
  assert.equal(copilotStepOf(ev('assistant.message', { content: '' })), null, 'a message of only tool requests says nothing');
  assert.equal(copilotStepOf(ev('assistant.message', { content: '', toolRequests: [{}] })), null);
  for (const type of ['session.start', 'hook.start', 'user.message', 'session.usage_record', 'assistant.turn_end']) assert.equal(copilotStepOf(ev(type, { content: 'hello' })), null, type);
  assert.equal(copilotStepOf(null), null);
  assert.equal(copilotStepOf('x'), null);
});

test('a step with a command that holds a key never carries it', () => {
  const step = copilotStepOf(start('view', { path: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }));
  assert.equal(step.text, '[hidden: looked like a key]');
});

test('runSteps gives the steps oldest first, and the sub-agents still working as crew', () => {
  const { env } = session([
    ev('session.start'),
    start('view', { path: 'a.js' }, 'c1'),
    ev('tool.execution_complete', { toolCallId: 'c1' }),
    start('task', { name: 'one', agent_type: 'wheelhouse-builder', description: 'build the form', prompt: 'x', mode: 'background' }, 'c2'),
    start('task', { name: 'two', agent_type: 'wheelhouse-reviewer', description: 'review it', prompt: 'x', mode: 'sync' }, 'c3'),
    ev('tool.execution_complete', { toolCallId: 'c3' }),
    ev('assistant.message', { content: 'Working on it.' }),
  ]);
  const got = copilotRunSteps({ sessionId: 'sess-1', env });
  assert.deepEqual(got.steps.map((s) => s.kind), ['did', 'sent', 'sent', 'said']);
  assert.equal(got.crew.length, 1, 'only the call with no result is still working');
  assert.match(got.crew[0], /^A Crew member is /);
  assert.deepEqual(got.crewDid, got.crew);
});

test('runSteps names a waiting decision by its number, and a session never found gives nothing', () => {
  const { env } = session([start('view', { path: 'a.js' })]);
  assert.equal(copilotRunSteps({ sessionId: 'sess-1', env, waiting: 7 }).steps.at(-1).text, 'Waiting for your answer to decision 7');
  assert.deepEqual(copilotRunSteps({ sessionId: 'nope', env }), { steps: [], crew: [], crewDid: [] });
});

test('runSteps speaks of the Bosun in the third person for the foreman\'s session', () => {
  const { env } = session([start('bash', { command: 'ls' })]);
  assert.equal(copilotRunSteps({ sessionId: 'sess-1', env, foreman: true }).steps[0].text, 'The Bosun is running a command');
});

test('it reads only the tail of a long file and skips a half-written last line', () => {
  const lines = Array.from({ length: 4000 }, (_, i) => JSON.stringify(start('view', { path: `f${i}.js` }, `c${i}`)));
  const { env, dir } = session([]);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.join('\n')}\n{"type":"tool.exec`);
  const got = copilotRunSteps({ sessionId: 'sess-1', env });
  assert.ok(got.steps.length > 0 && got.steps.length < 4000);
  assert.match(got.steps.at(-1).text, /f3999\.js/);
});
