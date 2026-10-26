// tests/scripts/hooks/node-floor.test.js
// The check every hook is started through (scripts/hooks/node-floor.cjs): it hands over to the
// hook at Wheelhouse's Node.js floor, says plainly what to install below it, and keeps its words
// and floor in step with setup's and the mod's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { NODE_FLOOR } from '../../../scripts/lib/setup-numbers.js';
import hooks from '../../../adapters/claude-code/hooks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FLOOR = path.join(ROOT, 'scripts', 'hooks', 'node-floor.cjs');
const floor = createRequire(import.meta.url)(FLOOR);

test('the floor is setup\'s', () => {
  assert.equal(floor.FLOOR_MAJOR, NODE_FLOOR[0]);
  assert.equal(floor.atFloor(`${NODE_FLOOR[0]}.0.0`), true);
  assert.equal(floor.atFloor('24.1.0'), true);
  assert.equal(floor.atFloor('20.9.0'), false);
  assert.equal(floor.atFloor('v18.19.1'), false);
  assert.equal(floor.atFloor('not a version'), false);
});

test('every hook is started through the check, naming one script under scripts/hooks', () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const commands = Object.values(onDisk.hooks).flat().flatMap((group) => group.hooks.map((hook) => hook.command));
  assert.ok(commands.length > 10);
  for (const command of commands) {
    const named = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/hooks\/node-floor\.cjs" "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/hooks\/([\w-]+)\.js"$/.exec(command);
    assert.ok(named, command);
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'hooks', `${named[1]}.js`)), named[1]);
  }
  assert.deepEqual(hooks.registration(), onDisk);
});

test('below the floor a tool call is refused with the plain words, and nothing names a script', () => {
  const out = floor.refusal('PreToolUse', '20.9.0');
  assert.equal(out.code, 2);
  assert.equal(out.stdout, '');
  assert.match(out.stderr, /Node\.js, version 22 or later, and this computer has version 20\.9\.0/);
  assert.match(out.stderr, /https:\/\/nodejs\.org/);
  assert.match(out.stderr, /start a new conversation/);
  assert.doesNotMatch(out.stderr, /[\w-]+\.js\b(?<!Node\.js)|scripts\/|command not found/);
});

test('below the floor the session start tells the director and the session', () => {
  const out = floor.refusal('SessionStart', '18.19.1');
  assert.equal(out.code, 0);
  const said = JSON.parse(out.stdout);
  assert.equal(said.systemMessage, floor.message('18.19.1'));
  assert.equal(said.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(said.hookSpecificOutput.additionalContext.includes(floor.message('18.19.1')));
  assert.match(said.hookSpecificOutput.additionalContext, /Tell the director/);
});

test('below the floor every other event passes quietly, so no prompt or stop is held', () => {
  for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop', 'SubagentStop', 'PreCompact', 'SessionEnd', null]) {
    assert.deepEqual(floor.refusal(event, '20.9.0'), { stdout: '', stderr: '', code: 0 }, String(event));
  }
});

test('the event is read from the hook\'s input', () => {
  assert.equal(floor.eventOf(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read' })), 'PreToolUse');
  assert.equal(floor.eventOf('not json'), null);
  assert.equal(floor.eventOf('null'), null);
});

test('the mod\'s words for no Node.js at all are the check\'s', () => {
  const numbers = fs.readFileSync(path.join(ROOT, 'hooks', 'mod', 'numbers.ts'), 'utf8');
  const held = /export const NODE_MISSING = '((?:[^'\\]|\\.)*)'/.exec(numbers)?.[1].replaceAll("\\'", "'");
  assert.equal(held, floor.missingMessage());
  assert.match(held, /doesn't have it/);
});

test('at the floor the hook runs as though started directly, with its input and exit code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-floor-'));
  try {
    const script = path.join(dir, 'hook.mjs');
    fs.writeFileSync(script, [
      "import fs from 'node:fs';",
      "import { fileURLToPath } from 'node:url';",
      'const input = fs.readFileSync(0, "utf8");',
      'process.stdout.write(JSON.stringify({ argv1: process.argv[1], self: fileURLToPath(import.meta.url), input }));',
      'process.exitCode = 3;',
    ].join('\n'));
    const ran = spawnSync(process.execPath, [FLOOR, script], { input: '{"hook_event_name":"PreToolUse"}', encoding: 'utf8' });
    assert.equal(ran.status, 3, ran.stderr);
    const seen = JSON.parse(ran.stdout);
    assert.equal(seen.argv1, script);
    assert.equal(fs.realpathSync(seen.self), fs.realpathSync(script));
    assert.equal(seen.input, '{"hook_event_name":"PreToolUse"}');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a real guard started through the check still decides', () => {
  const ran = spawnSync(process.execPath, [FLOOR, path.join(ROOT, 'scripts', 'hooks', 'stop-word.js')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: os.tmpdir(), prompt: 'hello' }),
    encoding: 'utf8',
  });
  assert.equal(ran.status, 0, ran.stderr);
});

test('a hook that fails to load fails as it would started directly', () => {
  const ran = spawnSync(process.execPath, [FLOOR, path.join(os.tmpdir(), 'no-such-hook-here.js')], { input: '{}', encoding: 'utf8' });
  assert.notEqual(ran.status, 0);
  assert.notEqual(ran.status, 2);
  const none = spawnSync(process.execPath, [FLOOR], { input: '{}', encoding: 'utf8' });
  assert.equal(none.status, 1);
});
