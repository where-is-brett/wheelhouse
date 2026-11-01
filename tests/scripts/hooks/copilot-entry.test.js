// tests/scripts/hooks/copilot-entry.test.js
// The one Copilot hook entry: one Node.js start per event, in a Wheelhouse project only, with a deadline over
// the whole run (checks 58 and 60; Part 5 Task 2, rulings P5-7, P5-11, P5-12 and P5-14).
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { runEntry, DEADLINE, LOCAL_HARNESS, COULD_NOT_RUN } from '../../../scripts/agents/copilot/hook-entry.js';
import { UNKNOWN_TOOL } from '../../../adapters/copilot/translate.js';
import { DENIED } from '../../../scripts/hooks/stop-guard.js';
import { answer } from '../../../scripts/hooks/kit.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { GUARD_DEADLINE_MS } from '../../../scripts/lib/copilot-numbers.js';

const ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'agents', 'copilot', 'hook-entry.js');
const EVENTS = ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'preCompact'];
const COPILOT_ENV = { COPILOT_CLI_BINARY_VERSION: '1.0.101' };

// Stand-ins for gh, glab, copilot and curl come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

// A registered project whose main folder has a .git folder (the hooks read files only).
const MAIN = fs.realpathSync.native(tempFolder('wh-copilot-entry-'));
fs.mkdirSync(path.join(MAIN, '.git'));
fs.writeFileSync(path.join(MAIN, 'README.md'), 'readme');
writeProject('owner__entry', { folder: MAIN, remoteUrl: 'https://example.com/owner/entry.git', host: 'github', repo: 'owner/entry', connection: {} });
const MANAGED = path.join(MAIN, 'no-managed-copy');
// A folder in no Wheelhouse project.
const OUTSIDE = fs.realpathSync.native(tempFolder('wh-copilot-outside-'));

const call = (toolName, toolArgs, cwd = MAIN) => ({ sessionId: 's1', timestamp: 0, cwd, toolName, toolArgs });
const patch = (...files) => ['*** Begin Patch', ...files.map((f) => `*** Add File: ${f}\n+x`), '*** End Patch'].join('\n');
const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });

// The entry run in this process, with every step a stand-in unless `steps` gives one.
function run(event, raw, { env = COPILOT_ENV, steps = {}, ...deps } = {}) {
  const calls = [];
  const spy = (name, out) => async (input) => {
    calls.push({ name, input });
    return out;
  };
  const all = {
    stopGuard: spy('stopGuard'), lineageHold: spy('lineageHold'), toolGuard: spy('toolGuard'), areas: spy('areas'),
    stopWord: spy('stopWord'), boardContext: spy('boardContext'), sessionStart: spy('sessionStart'),
    ...Object.fromEntries(Object.entries(steps).map(([name, fn]) => [name, async (input, d) => {
      calls.push({ name, input });
      return fn(input, d);
    }])),
  };
  const stdin = Readable.from([typeof raw === 'string' ? raw : JSON.stringify(raw)]);
  return runEntry(event, { stdin, env, deps: { dir: MANAGED, steps: all, ...deps } }).then((result) => ({ ...result, calls }));
}
const body = (result) => (result.text === '' ? null : JSON.parse(result.text));

// A hash of every file under the Wheelhouse home: its names and contents.
function treeHash(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, entry.name);
      hash.update(path.relative(dir, full));
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(fs.readFileSync(full));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hash.digest('hex');
}

// The real entry, started as Copilot starts it: one Node.js, the event as its argument, the input on stdin.
function spawnEntry(event, raw, env = COPILOT_ENV) {
  const result = spawnSync(process.execPath, [ENTRY, event], {
    input: JSON.stringify(raw), encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, ...env, ...(env.COPILOT_CLI_BINARY_VERSION === undefined ? { COPILOT_CLI_BINARY_VERSION: '' } : {}) },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('outside a Wheelhouse project the entry writes nothing and exits 0', async () => {
  const inputs = {
    sessionStart: { sessionId: 's1', timestamp: 0, cwd: OUTSIDE, source: 'new', initialPrompt: 'hi' },
    userPromptSubmitted: { sessionId: 's1', timestamp: 0, cwd: OUTSIDE, prompt: 'stop' },
    preToolUse: call('apply_patch', patch(path.join(OUTSIDE, 'a.txt')), OUTSIDE),
    preCompact: { sessionId: 's1', timestamp: 0, cwd: OUTSIDE, trigger: 'manual', customInstructions: '' },
  };
  // In process: no step runs at all, in either harness.
  for (const event of EVENTS) {
    for (const env of [COPILOT_ENV, {}]) {
      const result = await run(event, inputs[event], { env });
      assert.equal(result.text, '', event);
      assert.equal(result.code, 0, event);
      assert.deepEqual(result.calls, [], event);
    }
  }
  // And as Copilot starts it, with STOP on, which would refuse the patch in a project.
  setStop({ by: 'helper' });
  try {
    const stopped = treeHash(wheelhouseHome());
    for (const event of EVENTS) {
      const out = spawnEntry(event, inputs[event]);
      assert.equal(out.code, 0, `${event}: ${out.stderr}`);
      assert.equal(out.stdout, '', event);
    }
    assert.equal(treeHash(wheelhouseHome()), stopped);
  } finally {
    liftStop();
  }
});

test('a guard that hangs is refused at GUARD_DEADLINE_MS with DEADLINE', async () => {
  assert.equal(GUARD_DEADLINE_MS, 30000);
  const hang = () => new Promise(() => {});
  const started = Date.now();
  const guard = await run('preToolUse', call('view', { path: path.join(MAIN, 'README.md') }), { steps: { stopGuard: hang }, deadlineMs: 50 });
  assert.ok(Date.now() - started < 5000);
  assert.deepEqual(body(guard), deny(DEADLINE));
  assert.equal(guard.code, 2);
  assert.equal(DEADLINE, 'A Wheelhouse check took too long, so this was refused; try again');
  // A hang before any guard (reading the input) is under the same deadline.
  const never = new Readable({ read() {} });
  const unread = await runEntry('preToolUse', { stdin: never, env: COPILOT_ENV, deps: { dir: MANAGED, deadlineMs: 50 } });
  assert.deepEqual(JSON.parse(unread.text), deny(DEADLINE));
  assert.equal(unread.code, 2);
  // An informing event that runs out of time writes nothing and lets the session go on.
  const informs = await run('userPromptSubmitted', { sessionId: 's1', timestamp: 0, cwd: MAIN, prompt: 'hello' }, { steps: { boardContext: hang }, deadlineMs: 50 });
  assert.equal(informs.text, '');
  assert.equal(informs.code, 0);
  const starts = await run('sessionStart', { sessionId: 's1', timestamp: 0, cwd: MAIN, source: 'new' }, { steps: { sessionStart: hang }, deadlineMs: 50 });
  assert.equal(starts.text, '');
  assert.equal(starts.code, 0);
  // The default deadline is GUARD_DEADLINE_MS: a guard that answers well inside it is answered.
  const quick = await run('preToolUse', call('view', { path: path.join(MAIN, 'README.md') }), { steps: { stopGuard: () => new Promise((r) => setTimeout(r, 20)) } });
  assert.equal(quick.text, '');
  assert.equal(quick.code, 0);
});

test('the first refusal wins and later guards do not run', async () => {
  // Order (ruling P5-14): STOP guard, lineage hold, the tool guard once per path, then the areas guard once per path.
  const all = await run('preToolUse', call('apply_patch', patch(path.join(MAIN, 'a.txt'), path.join(MAIN, 'b.txt'))));
  assert.deepEqual(all.calls.map((c) => c.name), ['stopGuard', 'lineageHold', 'toolGuard', 'toolGuard', 'areas', 'areas']);
  assert.deepEqual(all.calls.slice(2, 4).map((c) => c.input.tool_input.file_path), [path.join(MAIN, 'a.txt'), path.join(MAIN, 'b.txt')]);
  assert.deepEqual(all.calls.slice(4).map((c) => c.input.tool_input.file_path), [path.join(MAIN, 'a.txt'), path.join(MAIN, 'b.txt')]);
  assert.equal(all.text, '');
  assert.equal(all.code, 0);

  const stopped = await run('preToolUse', call('bash', { command: 'ls' }), { steps: { stopGuard: () => answer.deny('stop says no') } });
  assert.deepEqual(stopped.calls.map((c) => c.name), ['stopGuard']);
  assert.deepEqual(body(stopped), deny('stop says no'));
  assert.equal(stopped.code, 2);

  const held = await run('preToolUse', call('bash', { command: 'ls' }), { steps: { lineageHold: () => answer.deny('held') } });
  assert.deepEqual(held.calls.map((c) => c.name), ['stopGuard', 'lineageHold']);
  assert.deepEqual(body(held), deny('held'));

  // The first path refused: the second is not checked.
  const first = await run('preToolUse', call('apply_patch', patch(path.join(MAIN, 'a.txt'), path.join(MAIN, 'b.txt'))), { steps: { toolGuard: () => answer.deny('not a.txt') } });
  assert.deepEqual(first.calls.map((c) => c.name), ['stopGuard', 'lineageHold', 'toolGuard']);
  assert.deepEqual(body(first), deny('not a.txt'));
  assert.equal(first.code, 2);

  // A tool Wheelhouse doesn't know is refused before any guard runs (ruling P5-10).
  const unknown = await run('preToolUse', call('apply_patch_v2', { patch: 'x' }));
  assert.deepEqual(unknown.calls, []);
  assert.deepEqual(body(unknown), deny(UNKNOWN_TOOL('apply_patch_v2')));
  assert.equal(unknown.code, 2);

  // A patch with no path the entry can read is refused, and so is input that isn't JSON.
  for (const raw of [call('apply_patch', '*** Begin Patch\n*** End Patch'), call('apply_patch', { not: 'a string' }), 'not json', { sessionId: 's1', toolName: 'view', toolArgs: {} }]) {
    const refused = await run('preToolUse', raw);
    assert.deepEqual(refused.calls, [], JSON.stringify(raw));
    assert.deepEqual(body(refused), deny(COULD_NOT_RUN), JSON.stringify(raw));
    assert.equal(refused.code, 2);
  }

  // A guard that throws refuses (check 58: a crash would block every call with no word to the model).
  const thrown = await run('preToolUse', call('bash', { command: 'ls' }), { steps: { lineageHold: () => { throw new Error('boom'); } } });
  assert.deepEqual(body(thrown), deny(COULD_NOT_RUN));
  assert.equal(thrown.code, 2);
  // An informing step that throws writes nothing.
  const quiet = await run('userPromptSubmitted', { sessionId: 's1', timestamp: 0, cwd: MAIN, prompt: 'hi' }, { steps: { stopWord: () => { throw new Error('boom'); } } });
  assert.equal(quiet.text, '');
  assert.equal(quiet.code, 0);

  // At the prompt, the STOP word then the board context; both lines reach the agent.
  const both = await run('userPromptSubmitted', { sessionId: 's1', timestamp: 0, cwd: MAIN, prompt: 'stop' }, {
    steps: { stopWord: () => answer.context('UserPromptSubmit', 'one'), boardContext: () => answer.context('UserPromptSubmit', 'two') },
  });
  assert.deepEqual(both.calls.map((c) => c.name), ['stopWord', 'boardContext']);
  assert.equal(both.calls[0].input.prompt, 'stop');
  assert.deepEqual(body(both), { additionalContext: 'one\n\ntwo' });
  assert.equal(both.code, 0);

  // The session start's line, in Copilot's shape.
  const start = await run('sessionStart', { sessionId: 's1', timestamp: 0, cwd: MAIN, source: 'new' }, { steps: { sessionStart: () => answer.context('SessionStart', 'hello') } });
  assert.deepEqual(body(start), { additionalContext: 'hello' });
  assert.equal(start.calls[0].input.hook_event_name, 'SessionStart');
});

test('the real guards run from the entry, as Copilot starts it', async () => {
  // STOP off: reading and a plain patch in the project are let through.
  assert.deepEqual(spawnEntry('preToolUse', call('view', { path: path.join(MAIN, 'README.md') })), { code: 0, stdout: '', stderr: '' });
  // STOP on: the patch is refused in STOP's words with exit 2, and reading carries on.
  setStop({ by: 'helper' });
  try {
    const refused = spawnEntry('preToolUse', call('apply_patch', patch(path.join(MAIN, 'a.txt'))));
    assert.equal(refused.code, 2, refused.stderr);
    assert.deepEqual(JSON.parse(refused.stdout), deny(DENIED));
    const read = spawnEntry('preToolUse', call('view', { path: path.join(MAIN, 'README.md') }));
    assert.equal(read.code, 0, read.stderr);
    assert.equal(read.stdout, '');
  } finally {
    liftStop();
  }
  // The tool guard: a patch to a credential file is refused even with STOP off.
  const env = spawnEntry('preToolUse', call('apply_patch', patch(path.join(MAIN, '.env'))));
  assert.equal(env.code, 2, env.stderr);
  assert.equal(JSON.parse(env.stdout).permissionDecision, 'deny');
  // An event the registration doesn't name is answered with nothing.
  assert.deepEqual(spawnEntry('postToolUse', call('view', { path: path.join(MAIN, 'README.md') })), { code: 0, stdout: '', stderr: '' });
});

test('the precompact hook answers without blocking', async () => {
  const input = { sessionId: 's1', timestamp: 0, cwd: MAIN, trigger: 'auto', customInstructions: '' };
  const recorded = [];
  const result = await run('preCompact', input, { recordCompaction: async (one) => recorded.push(one) });
  assert.equal(result.text, '');
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls, []);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].trigger, 'auto');
  // A record that fails or hangs still never blocks the compaction.
  const failed = await run('preCompact', input, { recordCompaction: () => { throw new Error('boom'); } });
  assert.deepEqual([failed.text, failed.code], ['', 0]);
  const slow = await run('preCompact', input, { recordCompaction: () => new Promise(() => {}), deadlineMs: 50 });
  assert.deepEqual([slow.text, slow.code], ['', 0]);
  // As Copilot starts it.
  for (const trigger of ['auto', 'manual']) {
    const out = spawnEntry('preCompact', { ...input, trigger });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(out.stdout, '');
  }
});

test('in the Local harness only reading is let through', async () => {
  const local = {};
  for (const [toolName, toolArgs] of [['view', { path: path.join(MAIN, 'README.md') }], ['rg', { pattern: 'x', paths: MAIN }], ['glob', { pattern: '*' }]]) {
    const read = await run('preToolUse', call(toolName, toolArgs), { env: local });
    assert.equal(read.text, '', toolName);
    assert.equal(read.code, 0, toolName);
    assert.deepEqual(read.calls, [], toolName);
  }
  for (const [toolName, toolArgs] of [['bash', { command: 'ls' }], ['apply_patch', patch(path.join(MAIN, 'a.txt'))], ['task', { prompt: 'x' }], ['apply_patch_v2', 'x']]) {
    const refused = await run('preToolUse', call(toolName, toolArgs), { env: local });
    assert.deepEqual(body(refused), deny(LOCAL_HARNESS), toolName);
    assert.equal(refused.code, 2, toolName);
    assert.deepEqual(refused.calls, [], toolName);
  }
  // The session start says so, and nothing else runs.
  const start = await run('sessionStart', { sessionId: 's1', timestamp: 0, cwd: MAIN, source: 'new' }, { env: local });
  assert.deepEqual(body(start), { additionalContext: LOCAL_HARNESS });
  assert.deepEqual(start.calls, []);
  assert.equal(LOCAL_HARNESS, 'Wheelhouse doesn\'t run in this kind of chat. Switch the chat to Copilot in the chat\'s agent picker.');
  const prompt = await run('userPromptSubmitted', { sessionId: 's1', timestamp: 0, cwd: MAIN, prompt: 'stop' }, { env: local });
  assert.deepEqual([prompt.text, prompt.code, prompt.calls], ['', 0, []]);
  // As Copilot starts it, with no harness named in the environment.
  const out = spawnEntry('preToolUse', call('bash', { command: 'ls' }), {});
  assert.equal(out.code, 2, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), deny(LOCAL_HARNESS));
});

test('no real copilot, gh, glab or curl ran', () => {
  assert.deepEqual(stand.calls(), []);
});
