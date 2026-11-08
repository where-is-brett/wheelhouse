// tests/scripts/crew/runs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  configDir, findTranscript, findSubagents, readTail, stepOf, stepsOf, mask, plain,
  roleOf, subagentLine, runSteps,
} from '../../../scripts/crew/runs.js';
import { glossaryOf } from '../../../scripts/frontdesk/glossary.js';

function fakeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-runs-'));
  return { dir, env: { CLAUDE_CONFIG_DIR: dir } };
}

test('finds a transcript under any project folder', () => {
  const { dir, env } = fakeConfig();
  fs.mkdirSync(path.join(dir, 'projects', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'a', 'x.jsonl'), '{}\n');
  const found = findTranscript({ sessionId: 'x', env });
  assert.ok(found.endsWith(path.join('projects', 'a', 'x.jsonl')));
});

test('honours CLAUDE_CONFIG_DIR', () => {
  const { dir, env } = fakeConfig();
  assert.equal(configDir(env), dir);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'a'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'a', 'x.jsonl'), '{}\n');
  const saved = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    assert.equal(findTranscript({ sessionId: 'x', env }), null);
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    if (savedProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedProfile;
  }
});

test('returns null for an unknown session', () => {
  const { env } = fakeConfig();
  assert.equal(findTranscript({ sessionId: 'nope', env }), null);
});

test('refuses a link', () => {
  const { dir, env } = fakeConfig();
  fs.mkdirSync(path.join(dir, 'projects', 'a'), { recursive: true });
  const real = path.join(dir, 'real.jsonl');
  fs.writeFileSync(real, '{}\n');
  fs.symlinkSync(real, path.join(dir, 'projects', 'a', 'x.jsonl'));
  assert.equal(findTranscript({ sessionId: 'x', env }), null);
});

test('lists subagents oldest first', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(path.join(proj, 'x', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const newer = path.join(proj, 'x', 'subagents', 'agent-aaa.jsonl');
  const older = path.join(proj, 'x', 'subagents', 'agent-zzz.jsonl');
  fs.writeFileSync(newer, '{}\n');
  fs.writeFileSync(older, '{}\n');
  fs.utimesSync(older, new Date(1000 * 1000), new Date(1000 * 1000));
  fs.utimesSync(newer, new Date(2000 * 1000), new Date(2000 * 1000));
  const file = findTranscript({ sessionId: 'x', env });
  const subs = findSubagents(file);
  assert.deepEqual(subs.map((s) => s.agentId), ['zzz', 'aaa']);
  assert.equal(subs[0].file, older);
});

test('subagents: none when the folder is missing, links left out', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const file = findTranscript({ sessionId: 'x', env });
  assert.deepEqual(findSubagents(file), []);
  fs.mkdirSync(path.join(proj, 'x', 'subagents'), { recursive: true });
  const real = path.join(dir, 'real.jsonl');
  fs.writeFileSync(real, '{}\n');
  fs.symlinkSync(real, path.join(proj, 'x', 'subagents', 'agent-l.jsonl'));
  assert.deepEqual(findSubagents(file), []);
});

test('rejects a session id with a path separator or ..', () => {
  const { dir, env } = fakeConfig();
  fs.mkdirSync(path.join(dir, 'projects', 'a'), { recursive: true });
  // Where traversal from projects/a/ would land: projects/x.jsonl, and projects/a/x.jsonl for a/x.
  fs.writeFileSync(path.join(dir, 'projects', 'x.jsonl'), '{}\n');
  fs.mkdirSync(path.join(dir, 'projects', 'a', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'a', 'a', 'x.jsonl'), '{}\n');
  assert.equal(findTranscript({ sessionId: '../x', env }), null);
  assert.equal(findTranscript({ sessionId: 'a/x', env }), null);
  assert.equal(findTranscript({ sessionId: 'a\\x', env }), null);
  assert.equal(findTranscript({ sessionId: '', env }), null);
  assert.equal(findTranscript({ sessionId: '..', env }), null);
  assert.equal(findTranscript({ sessionId: '.', env }), null);
});

function ev(n) {
  return JSON.stringify({ type: 'assistant', n });
}

test('readTail reads only the tail', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  const lines = [];
  let size = 0;
  for (let n = 0; size < 1024 * 1024; n++) {
    const line = ev(n);
    lines.push(line);
    size += line.length + 1;
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const events = readTail(file, { max: 1024 });
  assert.ok(events.length > 0);
  // The oldest event that may appear starts within the last 1024 bytes.
  let tailBytes = 0;
  let firstAllowed = lines.length;
  while (firstAllowed > 0 && tailBytes + lines[firstAllowed - 1].length + 1 <= 1024) {
    firstAllowed--;
    tailBytes += lines[firstAllowed].length + 1;
  }
  for (const e of events) assert.ok(e.n >= firstAllowed, `event ${e.n} is older than the tail`);
  assert.equal(events[events.length - 1].n, lines.length - 1);
  assert.ok(events.length < 100);
});

test('readTail skips a half-written last line', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\n${ev(2)}\n{"type":"assist`);
  assert.deepEqual(readTail(file).map((e) => e.n), [1, 2]);
});

test('readTail skips a line that is not JSON', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\nnot json at all\n${ev(2)}\n`);
  assert.deepEqual(readTail(file).map((e) => e.n), [1, 2]);
});

test('readTail gives [] for a missing file', () => {
  const { dir } = fakeConfig();
  assert.deepEqual(readTail(path.join(dir, 'nope.jsonl')), []);
});

test('readTail gives [] for a link', () => {
  const { dir } = fakeConfig();
  const real = path.join(dir, 'real.jsonl');
  fs.writeFileSync(real, `${ev(1)}\n`);
  const link = path.join(dir, 'link.jsonl');
  fs.symlinkSync(real, link);
  assert.deepEqual(readTail(link), []);
});

test('readTail does not change the file', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\n${ev(2)}\n`);
  fs.utimesSync(file, new Date(1000 * 1000), new Date(1000 * 1000));
  const before = fs.statSync(file);
  readTail(file);
  const after = fs.statSync(file);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('subagents: a linked subagents directory is refused', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(path.join(proj, 'x'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const elsewhere = path.join(dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.writeFileSync(path.join(elsewhere, 'agent-q.jsonl'), '{}\n');
  fs.symlinkSync(elsewhere, path.join(proj, 'x', 'subagents'));
  const file = findTranscript({ sessionId: 'x', env });
  assert.deepEqual(findSubagents(file), []);
});

test('subagents: a linked session directory is refused', () => {
  const { dir, env } = fakeConfig();
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'x.jsonl'), '{}\n');
  const elsewhere = path.join(dir, 'elsewhere');
  fs.mkdirSync(path.join(elsewhere, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(elsewhere, 'subagents', 'agent-q.jsonl'), '{}\n');
  fs.symlinkSync(elsewhere, path.join(proj, 'x'));
  const file = findTranscript({ sessionId: 'x', env });
  assert.deepEqual(findSubagents(file), []);
});

test('readTail skips parsed lines that are not plain objects', () => {
  const { dir } = fakeConfig();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${ev(1)}\n1\nnull\n"s"\n[]\n${ev(2)}\n`);
  assert.deepEqual(readTail(file).map((e) => e.n), [1, 2]);
});

// Step lines

const GLOSSARY = glossaryOf({ PR: { data: { term: 'PR', plain: 'change', phrase: 'change' } } });
const asst = (...content) => ({ type: 'assistant', timestamp: '2026-11-08T01:00:00Z', cwd: '/w/tree', message: { content } });
const tool = (name, input) => asst({ type: 'tool_use', name, input });
const text = (t) => asst({ type: 'text', text: t });

test('turns a Read into a reading step', () => {
  const step = stepOf(tool('Read', { file_path: '/w/tree/src/login.ts' }));
  assert.equal(step.text, 'Reading `src/login.ts`');
  assert.equal(step.at, '2026-11-08T01:00:00Z');
});

test('names the other tools', () => {
  assert.equal(stepOf(tool('Edit', { file_path: '/w/tree/a.js' })).text, 'Changing `a.js`');
  assert.equal(stepOf(tool('Write', { file_path: '/w/tree/b.js' })).text, 'Changing `b.js`');
  assert.equal(stepOf(tool('Grep', { pattern: 'x' })).text, 'Searching the code');
  assert.equal(stepOf(tool('Glob', { pattern: 'x' })).text, 'Searching the code');
  assert.equal(stepOf(tool('WebFetch', {})).text, 'Looking something up');
  assert.equal(stepOf(tool('WebSearch', {})).text, 'Looking something up');
  assert.equal(stepOf(tool('Bash', { command: 'ls' })).text, 'Running a command');
  assert.equal(stepOf(tool('NotebookEdit', {})).text, 'Using NotebookEdit');
});

test('names a test run', () => {
  for (const command of ['npm test', 'npx jest', 'vitest run', 'pytest -q', 'node --test tests/a.test.js']) {
    assert.equal(stepOf(tool('Bash', { command })).text, 'Running the tests', command);
  }
  assert.equal(stepOf(tool('Bash', { command: 'git add tests/a.js' })).text, 'Running a command');
});

test('records a decision without its question', () => {
  const step = stepOf(tool('Bash', { command: 'node scripts/frontdesk/cli.js record decision --question "Which login?"' }));
  assert.equal(step.text, 'Recording a decision');
});

test('keeps the first sentence of assistant text', () => {
  assert.equal(stepOf(text('Done. Next I will tidy up.')).text, 'Done.');
  const long = 'a'.repeat(300);
  assert.equal(stepOf(text(long)).text.length, 120);
});

test('skips an event it does not know', () => {
  assert.equal(stepOf({ type: 'summary' }), null);
  assert.equal(stepOf(null), null);
  assert.equal(stepOf({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }), null);
  assert.equal(stepOf(text('   ')), null);
  assert.deepEqual(stepsOf([{ type: 'summary' }], { glossary: {} }), []);
});

test('masks a key', () => {
  const key = `sk-${'a1'.repeat(15)}`;
  const step = stepOf(text(`The key is ${key} ok`));
  assert.equal(step.text, '[hidden: looked like a key]');
  assert.equal(mask(`x ${key}`), '[hidden: looked like a key]');
  for (const bad of [`ghp_${'A'.repeat(25)}`, `glpat-${'b'.repeat(22)}`, 'AKIAABCDEFGHIJKLMNOP',
    `xoxb-${'1'.repeat(12)}`, '-----BEGIN RSA PRIVATE KEY-----', 'API_KEY=abcdefgh12', 'Password: hunter2hunter2']) {
    assert.equal(mask(bad), '[hidden: looked like a key]', bad);
  }
  assert.equal(mask('nothing secret here'), 'nothing secret here');
  const steps = stepsOf([text(key)], { glossary: {} });
  assert.ok(!steps[0].text.includes('sk-'));
  const read = stepsOf([tool('Read', { file_path: `/w/tree/${key}` })], { glossary: {} });
  assert.ok(!read[0].text.includes('sk-'));
});

test('strips escape codes', () => {
  assert.equal(plain('\u001b[31mred\u001b[0m'), 'red');
  assert.equal(plain('a\u0007b\u0000c\u001b]0;title\u0007d'), 'abcd');
  assert.equal(stepOf(text('\u001b[31mred')).text, 'red');
});

test('shows a waiting decision by number only', () => {
  const events = [text('Working.'), tool('Bash', { command: 'node scripts/frontdesk/cli.js record decision --question "Secret question?"' })];
  const steps = stepsOf(events, { glossary: {}, waiting: 2 });
  assert.equal(steps[steps.length - 1].text, 'Waiting for your answer to decision 2');
  assert.ok(!JSON.stringify(steps).includes('Secret question'));
  assert.equal(stepsOf(events, { glossary: {} }).length, 2);
});

test('passes wording through the glossary', () => {
  const steps = stepsOf([text('Opening the PR now.')], { glossary: GLOSSARY });
  assert.ok(steps[0].text.includes('change'), steps[0].text);
  assert.ok(!steps[0].text.includes('PR'));
  assert.ok(!steps[0].text.includes('Terms:'));
});

test('masks a key that would straddle the 120 character cut', () => {
  const key = `sk-${'a1'.repeat(15)}`;
  const long = `${'x'.repeat(100)}${key}`;
  assert.equal(stepOf(text(long)).text, '[hidden: looked like a key]');
  const tok = `${'y'.repeat(112)} token: abcdefghij`;
  assert.equal(stepOf(text(tok)).text, '[hidden: looked like a key]');
  assert.equal(stepsOf([text(long)], { glossary: {} })[0].text, '[hidden: looked like a key]');
});

test('shows an in-tree file whose name starts with two dots', () => {
  assert.equal(stepOf(tool('Read', { file_path: '/w/tree/..foo' })).text, 'Reading `..foo`');
  assert.equal(stepOf(tool('Read', { file_path: '/w/other/a.js' })).text, 'Reading `/w/other/a.js`');
});

// Subagents and the Bosun

const writeRun = (dir, id, events) => {
  const proj = path.join(dir, 'projects', 'a');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, `${id}.jsonl`), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return proj;
};
const agentCall = (id, subagent_type, description) => asst({ type: 'tool_use', id, name: 'Agent', input: { subagent_type, description } });
const agentResult = (toolUseId, agentId) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: `done\nagentId: ${agentId}` }] } });

test('names roles', () => {
  assert.equal(roleOf('builder'), 'A Crew member');
  assert.equal(roleOf('wheelhouse:reviewer'), 'A Lookout');
  assert.equal(roleOf('tester'), 'The tester');
  assert.equal(roleOf('whatever'), 'A Crew member');
  assert.equal(roleOf(undefined), 'A Crew member');
});

test('names a reviewer subagent a Lookout', () => {
  assert.equal(subagentLine({ agentType: 'wheelhouse:reviewer', description: 'task 2' }), 'A Lookout is reviewing task 2');
  assert.equal(stepOf(agentCall('t1', 'wheelhouse:reviewer', 'task 2')).text, 'A Lookout is reviewing task 2');
  assert.equal(subagentLine({ agentType: 'builder', description: 'task 3' }), 'A Crew member is building task 3');
  assert.equal(subagentLine({ agentType: 'tester', description: 'the login' }), 'The tester is trying the login');
});

test('cuts a description to 80 characters and strips escape codes', () => {
  const line = subagentLine({ agentType: 'builder', description: 'x'.repeat(200) });
  assert.equal(line, `A Crew member is building ${'x'.repeat(80)}`);
  assert.equal(subagentLine({ agentType: 'builder', description: '\u001b[31mred' }), 'A Crew member is building red');
});

test('falls back to a Crew member', () => {
  assert.ok(stepOf(agentCall('t1', 'mystery', 'task 9')).text.startsWith('A Crew member'));
});

test('reads subagent transcripts beside the run', () => {
  const { dir, env } = fakeConfig();
  const proj = writeRun(dir, 's1', [agentCall('t1', 'wheelhouse:reviewer', 'task 2'), agentResult('t1', 'abc123')]);
  fs.mkdirSync(path.join(proj, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, 's1', 'subagents', 'agent-abc123.jsonl'), JSON.stringify(tool('Read', { file_path: '/w/tree/a.js' })) + '\n');
  const { steps, crew } = runSteps({ sessionId: 's1', env });
  assert.deepEqual(crew, ['A Lookout is reading `a.js`']);
  assert.equal(steps[0].text, 'A Lookout is independently checking task 2'); // through the glossary
});

test('an unmatched subagent is a Crew member', () => {
  const { dir, env } = fakeConfig();
  const proj = writeRun(dir, 's1', [text('Hello.')]);
  fs.mkdirSync(path.join(proj, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(proj, 's1', 'subagents', 'agent-zzz.jsonl'), JSON.stringify(text('Looking around. More.')) + '\n');
  assert.deepEqual(runSteps({ sessionId: 's1', env }).crew, ['A Crew member is thinking: Looking around.']);
});

test('speaks of the Bosun in the third person', () => {
  const { dir, env } = fakeConfig();
  writeRun(dir, 's1', [
    tool('Read', { file_path: '/w/tree/a.js' }),
    tool('Bash', { command: 'npm test' }),
    text('All good. Moving on.'),
    tool('Bash', { command: 'node scripts/frontdesk/cli.js record decision <<< \'{"work":"login-page","question":"Secret?"}\'' }),
    tool('Bash', { command: 'node scripts/frontdesk/cli.js record decision --question "Secret?"' }),
    text('my key is sk-abcdefghijklmnopqrstuvwxyz'),
  ]);
  const { steps } = runSteps({ sessionId: 's1', env, foreman: true, waiting: 2 });
  assert.ok(steps.every((s) => s.text.startsWith('The Bosun is')), JSON.stringify(steps));
  assert.deepEqual(steps.map((s) => s.text), [
    'The Bosun is reading `a.js`',
    'The Bosun is running the tests',
    'The Bosun is thinking: All good.',
    'The Bosun is deciding what to do about login-page',
    'The Bosun is deciding what to do',
    'The Bosun is thinking: [hidden: looked like a key]',
    'The Bosun is waiting for your answer to decision 2',
  ]);
  assert.ok(!JSON.stringify(steps).includes('Secret'));
});

test('gives empty lists for a missing run', () => {
  const { env } = fakeConfig();
  assert.deepEqual(runSteps({ sessionId: 'nope', env }), { steps: [], crew: [] });
  assert.deepEqual(runSteps({ env }), { steps: [], crew: [] });
});
