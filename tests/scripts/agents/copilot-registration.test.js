// tests/scripts/agents/copilot-registration.test.js
// Wheelhouse's Copilot hooks, registered once per computer in the person's own hook folder (checks 56, 58 and 60;
// Part 5 Task 2, rulings P5-12, P5-13, P5-15 and P5-45).
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { checkAdapter } from '../../../scripts/agents/contract.js';
import { GUARD_TIMEOUT_SEC, HOOK_FILE } from '../../../scripts/lib/copilot-numbers.js';
import copilot from '../../../adapters/copilot/index.js';
import hooks, { EVENTS, ENTRY, registration, file, writeRegistration, copilotHome } from '../../../adapters/copilot/hooks.js';

// Stand-ins for gh, glab, copilot and curl come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

const entriesOf = (reg) => Object.values(reg.hooks).flat();

// Every file under `dir`, relative to it, in order.
function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

test('registration quotes a home folder with a space and an apostrophe', () => {
  // macOS: double quotes, inside which an apostrophe stays literal.
  const mac = registration({ node: '/Users/Ann O\'Neil/.nvm/bin/node', root: '/Users/Ann O\'Neil/wheelhouse', platform: 'darwin' });
  const macEntry = mac.hooks.preToolUse[0];
  const macLine = '"/Users/Ann O\'Neil/.nvm/bin/node" "/Users/Ann O\'Neil/wheelhouse/scripts/agents/copilot/hook-entry.js" preToolUse';
  assert.equal(macEntry.command, macLine);
  assert.equal(macEntry.bash, macLine);
  assert.equal(macEntry.powershell, undefined);

  // Windows: quoteForCmd for `command`, and PowerShell's literal form (an apostrophe doubled) for `powershell`.
  const win = registration({ node: 'C:\\Program Files\\nodejs\\node.exe', root: 'C:\\Users\\Ann O\'Neil\\wheelhouse', platform: 'win32' });
  const winEntry = win.hooks.preToolUse[0];
  assert.equal(winEntry.command, '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Ann O\'Neil\\wheelhouse\\scripts\\agents\\copilot\\hook-entry.js" preToolUse');
  assert.equal(winEntry.powershell, '& \'C:\\Program Files\\nodejs\\node.exe\' \'C:\\Users\\Ann O\'\'Neil\\wheelhouse\\scripts\\agents\\copilot\\hook-entry.js\' preToolUse');
  assert.equal(winEntry.bash, undefined);

  // A path no quoting keeps one word is refused, never written.
  for (const bad of ['/Users/a"b', '/Users/$HOME', '/Users/a`b`', '/Users/a\\b', '/Users/a\nb']) {
    assert.throws(() => registration({ node: '/usr/bin/node', root: bad, platform: 'darwin' }), /can't be written safely/, bad);
  }
  for (const bad of ['C:\\Users\\a"b', 'C:\\Users\\100%']) {
    assert.throws(() => registration({ node: 'C:\\node.exe', root: bad, platform: 'win32' }), /can't be written safely/, bad);
  }
  // Only full paths.
  assert.throws(() => registration({ node: 'node', root: '/wheelhouse', platform: 'darwin' }), /full path/);
  assert.throws(() => registration({ node: '/usr/bin/node', root: 'wheelhouse', platform: 'darwin' }), /full path/);

  // The macOS line, run by the real shell from a folder named Ann O'Neil, starts the right file with the event.
  if (process.platform !== 'win32') {
    const home = path.join(tempFolder('wh-copilot-reg-'), 'Ann O\'Neil');
    const root = path.join(home, 'wheelhouse');
    const script = path.join(root, ...ENTRY.split('/'));
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    const node = path.join(home, 'node');
    fs.symlinkSync(process.execPath, node);
    const line = registration({ node, root, platform: process.platform }).hooks.sessionStart[0].bash;
    assert.deepEqual(JSON.parse(execFileSync('/bin/sh', ['-c', line], { encoding: 'utf8' })), ['sessionStart']);
  }
});

test('registration sets timeoutSec to GUARD_TIMEOUT_SEC on every entry', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const root = platform === 'win32' ? 'C:\\wheelhouse' : '/opt/wheelhouse';
    const node = platform === 'win32' ? 'C:\\nodejs\\node.exe' : '/usr/local/bin/node';
    const reg = registration({ node, root, platform });
    const entries = entriesOf(reg);
    assert.equal(entries.length, EVENTS.length, platform);
    for (const entry of entries) {
      assert.equal(entry.type, 'command');
      assert.equal(entry.timeoutSec, GUARD_TIMEOUT_SEC, platform);
    }
  }
  assert.equal(GUARD_TIMEOUT_SEC, 120);
});

test('the registration writes only wheelhouse.json in the hook folder, with camelCase event names', () => {
  // Ruling P5-12: these four, each camelCase, once each; no second spelling (checks 56, 58 and 60).
  assert.deepEqual(EVENTS, ['sessionStart', 'userPromptSubmitted', 'preToolUse', 'preCompact']);
  const node = '/usr/local/bin/node';
  const root = '/opt/wheelhouse';
  const reg = registration({ node, root, platform: 'darwin' });
  assert.equal(reg.version, 1);
  assert.deepEqual(Object.keys(reg.hooks), EVENTS);
  for (const event of EVENTS) {
    assert.equal(reg.hooks[event].length, 1, event);
    assert.ok(reg.hooks[event][0].command.endsWith(` ${event}`), event);
    assert.ok(reg.hooks[event][0].command.includes(`${root}/${ENTRY}`), event);
  }
  assert.ok(!/postToolUse|subagentStop|UserPromptSubmit|PreToolUse|SessionStart|PreCompact/.test(JSON.stringify(reg)));

  // The hook file is <home>/hooks/wheelhouse.json, the home being COPILOT_HOME or ~/.copilot.
  const home = path.join(tempFolder('wh-copilot-home-'), 'copilot');
  assert.equal(HOOK_FILE, 'wheelhouse.json');
  assert.equal(file({ home }), path.join(home, 'hooks', HOOK_FILE));
  assert.equal(copilotHome({ env: { COPILOT_HOME: home }, homedir: '/nowhere' }), home);
  assert.equal(copilotHome({ env: {}, homedir: '/Users/model-a' }), path.join('/Users/model-a', '.copilot'));
  assert.equal(copilotHome({ env: { COPILOT_HOME: '' }, homedir: '/Users/model-a' }), path.join('/Users/model-a', '.copilot'));

  // A project folder the person works in: nothing is written there (ruling P5-45; check 56).
  const project = tempFolder('wh-copilot-project-');
  fs.mkdirSync(path.join(project, '.git'));
  const projectBefore = filesUnder(project);

  // A shell-guard file already there under the same name is replaced (ruling P5-15).
  fs.mkdirSync(path.join(home, 'hooks'), { recursive: true });
  fs.writeFileSync(file({ home }), JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: 'command', bash: '/bin/sh guard.sh', timeoutSec: 120 }] } }));
  const written = writeRegistration({ home, node, root, platform: 'darwin' });
  assert.equal(written, file({ home }));
  assert.deepEqual(filesUnder(home), ['hooks/wheelhouse.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(written, 'utf8')), reg);
  assert.equal(JSON.parse(fs.readFileSync(written, 'utf8')).hooks.preToolUse.length, 1);
  assert.deepEqual(filesUnder(project), projectBefore);
  for (const place of ['.github/hooks', '.github/copilot/settings.json', '.claude/settings.json']) assert.ok(!fs.existsSync(path.join(project, place)), place);

  // Written into a home with no hooks folder yet, it makes the folder and nothing else.
  const fresh = path.join(tempFolder('wh-copilot-fresh-'), 'home');
  writeRegistration({ home: fresh, node, root, platform: 'darwin' });
  assert.deepEqual(filesUnder(fresh), ['hooks/wheelhouse.json']);
  // The real ~/.copilot is never the default under test: the home is always given.
  assert.ok(!written.startsWith(path.join(os.homedir(), '.copilot')));
});

test('the Copilot adapter\'s hooks part is built and off the pending list', () => {
  assert.equal(copilot.hooks, hooks);
  assert.ok(!copilot.pending.includes('hooks'));
  assert.deepEqual(checkAdapter(copilot), []);
  assert.equal(typeof copilot.hooks.registration, 'function');
  assert.equal(typeof copilot.hooks.file, 'function');
  // Each call gives a fresh object.
  const one = copilot.hooks.registration({ node: '/n', root: '/r', platform: 'darwin' });
  one.hooks.preToolUse.length = 0;
  assert.equal(copilot.hooks.registration({ node: '/n', root: '/r', platform: 'darwin' }).hooks.preToolUse.length, 1);
});

test('no real copilot, gh, glab or curl ran', () => {
  assert.deepEqual(stand.calls(), []);
});
