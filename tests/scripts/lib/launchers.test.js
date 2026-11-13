// tests/scripts/lib/launchers.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import os from 'node:os';
import { BIN_DIR, LAUNCHER_SESSION, LAUNCHERS, launcherOf, pathWithLaunchers } from '../../../scripts/lib/launchers.js';
import { launch, UNSAFE_ARGUMENT } from '../../../scripts/lib/launch.js';
import { scriptArguments } from '../../../scripts/hooks/stop-guard.js';

const ROOT = path.resolve(BIN_DIR, '..');

test('every launcher has an executable Node.js file and a .cmd beside it, and runs a script that exists', () => {
  for (const [name, script] of Object.entries(LAUNCHERS)) {
    const file = path.join(BIN_DIR, name);
    assert.ok(fs.statSync(file).mode & 0o111, `${name} is executable`);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`^#!/usr/bin/env node\\n// bin/${name}\\n`));
    assert.match(fs.readFileSync(`${file}.cmd`, 'utf8'), new RegExp(`^@REM bin/${name}\\.cmd\\n@node "%~dp0${name}" %\\*\\n$`));
    assert.ok(fs.statSync(path.join(ROOT, script)).isFile(), `${script} exists`);
    assert.equal(launcherOf(script), name);
  }
  assert.deepEqual(fs.readdirSync(BIN_DIR).filter((f) => !f.endsWith('.cmd')).sort(), Object.keys(LAUNCHERS).sort(), 'no file in bin/ is without an entry');
});

test('a launcher runs its script with its arguments and gives its exit status and output', () => {
  // The front desk's command prints its commands and exits 1 for a word it doesn't know, and the launcher gives both as they are.
  const env = { ...process.env, PATH: pathWithLaunchers(process.env.PATH) };
  const help = spawnSync(path.join(BIN_DIR, 'wh-frontdesk'), ['--help'], { encoding: 'utf8', env });
  assert.match(`${help.stdout}${help.stderr}`, /Commands: cards,/);
  assert.equal(help.status, spawnSync(process.execPath, [path.join(ROOT, 'scripts/frontdesk/cli.js'), '--help'], { encoding: 'utf8' }).status);
  const bad = spawnSync(path.join(BIN_DIR, 'wh-frontdesk'), ['no-such-command'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});

test('the launchers\' folder goes first on a PATH, once', () => {
  assert.equal(pathWithLaunchers('/bin:/usr/bin', { binDir: '/w/bin', delimiter: ':' }), '/w/bin:/bin:/usr/bin');
  assert.equal(pathWithLaunchers('/w/bin:/bin', { binDir: '/w/bin', delimiter: ':' }), '/w/bin:/bin');
  assert.equal(pathWithLaunchers(undefined, { binDir: '/w/bin', delimiter: ':' }), '/w/bin');
});

test('the stop guard reads a bare launcher name only in a Copilot session, and only when the PATH reaches this plugin\'s own bin/', () => {
  const roots = [ROOT];
  const front = 'scripts/frontdesk/cli.js';
  const env = { [LAUNCHER_SESSION]: '1', PATH: pathWithLaunchers('/usr/bin:/bin') };
  assert.deepEqual(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, env), ['cards']);
  assert.deepEqual(scriptArguments('wh-feature answer q1', roots, 'darwin', 'scripts/feature/cli.js', env), ['answer', 'q1']);
  assert.equal(scriptArguments('wh-feature report', roots, 'darwin', front, env), null, 'a launcher is its own script only');
  assert.equal(scriptArguments('wh-frontdesk cards; rm x', roots, 'darwin', front, env), null);
  assert.equal(scriptArguments('wh-frontdesk cards && wh-frontdesk cards', roots, 'darwin', front, env), null);
  assert.equal(scriptArguments('./wh-frontdesk cards', roots, 'darwin', front, env), null);
  // Not in a Copilot session: no marker, or a marker that isn't 1.
  assert.equal(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, { PATH: env.PATH }), null);
  assert.equal(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, { ...env, [LAUNCHER_SESSION]: '0' }), null);
  // A command of that name earlier on the PATH, or no launcher folder on it, or another plugin's folder: not the plugin's own.
  const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-planted-'));
  try {
    fs.writeFileSync(path.join(planted, 'wh-frontdesk'), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, { ...env, PATH: `${planted}:${env.PATH}` }), null);
    assert.deepEqual(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, { ...env, PATH: `${env.PATH}:${planted}` }), ['cards'], 'a later one is behind the plugin\'s own');
    assert.equal(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, { ...env, PATH: `${planted}` }), null);
    assert.equal(scriptArguments('wh-frontdesk cards', [planted], 'darwin', front, env), null);
  } finally {
    fs.rmSync(planted, { recursive: true, force: true });
  }
  assert.equal(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, { [LAUNCHER_SESSION]: '1', PATH: '/usr/bin' }), null, 'no launcher folder on the PATH');
});

test('a launcher refuses an argument a Windows .cmd would read again as a command, on every system', () => {
  for (const bad of ['x" & calc & "', '50%', 'a^b', 'a&b', 'a|b', 'a<b', 'a>b', 'a\nb', 'a\rb']) {
    const codes = [];
    launch('wh-frontdesk', ['cards', bad], { exit: (code) => codes.push(code) });
    assert.deepEqual(codes, [2], JSON.stringify(bad));
    assert.match(UNSAFE_ARGUMENT.source, /%/);
  }
  const ran = spawnSync(path.join(BIN_DIR, 'wh-frontdesk'), ['x" & calc & "'], { encoding: 'utf8' });
  assert.equal(ran.status, 2);
  assert.match(ran.stderr, /takes no argument/);
});

test('the stop guard reads the bare form only when the command matches the launcher grammar', () => {
  const roots = [ROOT];
  const front = 'scripts/frontdesk/cli.js';
  const env = { [LAUNCHER_SESSION]: '1', PATH: pathWithLaunchers('/usr/bin:/bin') };
  assert.deepEqual(scriptArguments("wh-frontdesk similar 'a b'", roots, 'darwin', front, env), ['similar', 'a b']);
  for (const command of ['wh-frontdesk similar "a b"', 'wh-frontdesk cards $x', 'wh-frontdesk cards @(1)', "wh-frontdesk similar 'a $x'", 'wh-frontdesk cards (1)', 'wh-frontdesk cards {1}']) {
    assert.equal(scriptArguments(command, roots, 'darwin', front, env), null, command);
  }
});

test('the stop guard looks for a launcher in PATHEXT order, and skips a relative PATH entry', () => {
  const roots = [ROOT];
  const front = 'scripts/frontdesk/cli.js';
  const planted = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-planted-'));
  try {
    const win = { [LAUNCHER_SESSION]: '1' };
    for (const ext of ['.exe', '.bat', '.com']) {
      fs.writeFileSync(path.join(planted, `wh-frontdesk${ext}`), '');
      assert.equal(scriptArguments('wh-frontdesk cards', roots, 'win32', front, { ...win, PATH: `${planted};${BIN_DIR}` }), null, ext);
      fs.rmSync(path.join(planted, `wh-frontdesk${ext}`));
    }
    assert.deepEqual(scriptArguments('wh-frontdesk cards', roots, 'win32', front, { ...win, PATH: `${planted};${BIN_DIR}` }), ['cards']);
    const relative = path.relative(process.cwd(), planted);
    fs.writeFileSync(path.join(planted, 'wh-frontdesk'), '#!/bin/sh\n', { mode: 0o755 });
    assert.deepEqual(scriptArguments('wh-frontdesk cards', roots, 'darwin', front, { ...win, PATH: `${relative}:.:${BIN_DIR}` }), ['cards'], 'a relative entry is skipped');
  } finally {
    fs.rmSync(planted, { recursive: true, force: true });
  }
});

