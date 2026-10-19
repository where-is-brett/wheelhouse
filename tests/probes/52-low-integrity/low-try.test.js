// tests/probes/52-low-integrity/low-try.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTry } from '../../../probes/lib/windows.js';
import { ICACLS_LOCK_FORMS, LOCK_ROUTES, main, parseOptions } from '../../../probes/52-low-integrity/run.js';

const helper = fileURLToPath(new URL('../../../probes/52-low-integrity/low-try.js', import.meta.url));

function tryOp(...args) {
  const result = spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' });
  return parseTry(result.stdout);
}

test('the helper appends, reads and lists, and says what failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-test-low-try-'));
  try {
    const file = path.join(dir, 'a.txt');
    assert.deepEqual(tryOp('append', file, 'hello'), { ok: true });
    assert.equal(tryOp('read', file).text, 'hello');
    assert.deepEqual(tryOp('list', dir).names, ['a.txt']);
    const missing = tryOp('read', path.join(dir, 'none.txt'));
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'ENOENT');
    assert.equal(tryOp('nonsense').code, 'USAGE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the helper renames and removes a file or a folder, and says what failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-test-low-try-'));
  try {
    const folder = path.join(dir, '.claude');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'settings.json'), '{}');
    assert.deepEqual(tryOp('rename', folder, `${folder}.moved`), { ok: true });
    assert.ok(fs.existsSync(path.join(`${folder}.moved`, 'settings.json')));
    assert.deepEqual(tryOp('remove', `${folder}.moved`), { ok: true });
    assert.equal(fs.existsSync(`${folder}.moved`), false);
    const file = path.join(dir, '.mcp.json');
    fs.writeFileSync(file, '{}');
    assert.deepEqual(tryOp('remove', file), { ok: true });
    assert.equal(tryOp('remove', file).code, 'ENOENT');
    assert.equal(tryOp('rename', file, `${file}.x`).code, 'ENOENT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the helper runs a program, with input, and a shell command', () => {
  const echo = tryOp('exec', process.execPath, '-e', 'console.log(21*2)');
  assert.equal(echo.ok, true);
  assert.equal(echo.stdout.trim(), '42');
  const piped = tryOp('exec-stdin', 'one\\ntwo\\n', process.execPath, '-e', "process.stdin.on('data',d=>process.stdout.write(String(d.length)))");
  assert.equal(piped.stdout, '8');
  const shell = tryOp('shell', `"${process.execPath}"`, '-e', '"process.exit(3)"');
  assert.equal(shell.ok, false);
  assert.equal(shell.status, 3);
  assert.equal(typeof shell.ms, 'number');
});

test('the probe refuses to run off Windows without being told to', async () => {
  if (process.platform === 'win32') return;
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    assert.equal(await main([]), 2);
  } finally {
    console.error = original;
  }
  assert.match(errors.join('\n'), /Windows only/);
  assert.deepEqual(parseOptions([]), { offWindows: false, persistence: false });
  assert.deepEqual(parseOptions(['--allow-off-windows']), { offWindows: true, persistence: false });
  assert.deepEqual(parseOptions(['--persistence-trials']), { offWindows: false, persistence: true });
  assert.throws(() => parseOptions(['--nope']), /Unknown option/);
});

test('the routes the probe tries are the three the check names', () => {
  assert.deepEqual(LOCK_ROUTES, ['icacls', 'powershell', 'ffi']);
  assert.ok(ICACLS_LOCK_FORMS.every((form) => form.startsWith('(OI)(CI)M:')));
});
