// tests/scripts/agents/copilot/hook-timing.test.js
// The Copilot hook entry's phase timings: nothing is written without the marker file, one well-formed line is written with
// it (no input content in it), and the answer and exit code are the same either way. Each test starts the entry as Copilot does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PHASES, MARKER, LOG_FILE, LOG_CAP_BYTES, startTiming } from '../../../../scripts/agents/copilot/hook-timing.js';
import { tempFolder } from '../../../helpers/homes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ENTRY = path.join(ROOT, 'scripts', 'agents', 'copilot', 'hook-entry.js');

function world() {
  const base = fs.realpathSync(tempFolder('wh-timing-'));
  const home = path.join(base, 'home');
  const outside = path.join(base, 'elsewhere');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { home, outside, log: path.join(home, 'logs', LOG_FILE), marker: path.join(home, MARKER) };
}

const run = (w, event, input) => {
  const ran = spawnSync(process.execPath, [ENTRY, event], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: w.home } });
  return { stdout: ran.stdout, code: ran.status };
};
const lines = (w) => (fs.existsSync(w.log) ? fs.readFileSync(w.log, 'utf8').split('\n').filter(Boolean) : []);
const SECRET = 'sk-secret-token-4711';

test('with no marker, nothing is written', () => {
  const w = world();
  run(w, 'preToolUse', { sessionId: 's1', cwd: w.outside, toolName: 'view', toolArgs: { path: SECRET } });
  assert.equal(fs.existsSync(path.join(w.home, 'logs')), false);
});

test('with the marker, one well-formed line is written with the phases in order and none of the input', () => {
  const w = world();
  fs.writeFileSync(w.marker, '');
  const input = { sessionId: 's1', cwd: w.outside, toolName: 'view', toolArgs: { path: SECRET } };
  run(w, 'preToolUse', input);
  const written = lines(w);
  assert.equal(written.length, 1);
  assert.equal(written[0].includes(SECRET), false);
  assert.equal(written[0].includes(w.outside), false);
  const line = JSON.parse(written[0]);
  assert.equal(line.event, 'preToolUse');
  assert.equal(line.tool, 'view');
  assert.equal(typeof line.pid, 'number');
  assert.equal(typeof line.startedAgoMs, 'number');
  assert.equal(typeof line.uptimeMs, 'number');
  assert.equal(line.stdinBytes, Buffer.byteLength(JSON.stringify(input)));
  assert.equal(line.stdinTty, false);
  const seen = Object.keys(line.phases);
  for (const phase of ['modulesLoaded', 'stdinBegun', 'stdinEnded', 'projectRead', 'answerWritten', 'exit']) assert.ok(seen.includes(phase), phase);
  assert.deepEqual(seen, PHASES.filter((phase) => seen.includes(phase)));
  const values = Object.values(line.phases);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
});

test('the tool name is left out of an event that is not about a tool', () => {
  const w = world();
  fs.writeFileSync(w.marker, '');
  run(w, 'sessionStart', { sessionId: 's1', cwd: w.outside, toolName: 'view' });
  assert.equal('tool' in JSON.parse(lines(w)[0]), false);
});

test('the answer and the exit code are the same with timing on and off', () => {
  for (const input of [{ sessionId: 's1', cwd: w0().outside, toolName: 'view' }, { sessionId: 's1', toolName: 'view' }, 'not an object']) {
    const w = world();
    const off = run(w, 'preToolUse', input);
    fs.writeFileSync(w.marker, '');
    const on = run(w, 'preToolUse', input);
    assert.deepEqual(on, off);
    assert.equal(lines(w).length, 1);
  }
  function w0() { return { outside: path.join(fs.realpathSync(tempFolder('wh-timing-')), 'x') }; }
  const refused = run(world(), 'preToolUse', { sessionId: 's1', toolName: 'view' });
  assert.equal(refused.code, 2);
});

test('a log past the cap starts over, and a home that cannot be written to is swallowed', () => {
  const w = world();
  fs.writeFileSync(w.marker, '');
  fs.mkdirSync(path.dirname(w.log), { recursive: true });
  fs.writeFileSync(w.log, 'x'.repeat(LOG_CAP_BYTES + 1));
  const timing = startTiming('preToolUse', { home: w.home });
  timing.mark('exit');
  timing.flush();
  assert.equal(lines(w).length, 1);
  const blocked = world();
  fs.writeFileSync(blocked.marker, '');
  fs.writeFileSync(path.join(blocked.home, 'logs'), 'a file, not a folder');
  const broken = startTiming('preToolUse', { home: blocked.home });
  assert.doesNotThrow(() => { broken.mark('exit'); broken.flush(); });
});
