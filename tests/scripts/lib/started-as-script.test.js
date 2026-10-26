// tests/scripts/lib/started-as-script.test.js
// Whether a module is the program node was started with, by real paths, so a script or hook
// started through a linked path acts rather than printing nothing and exiting 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startedAsScript } from '../../../scripts/lib/started-as-script.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { as, tempFolder } from '../../helpers/homes.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NO_LINKS = process.platform === 'win32' ? 'a link needs rights on Windows' : false;

test('the same file reached through a link is the program; another file is not', { skip: NO_LINKS }, () => {
  const dir = tempFolder('wh-started-');
  const file = path.join(dir, 'a.js');
  const other = path.join(dir, 'b.js');
  fs.writeFileSync(file, '');
  fs.writeFileSync(other, '');
  fs.symlinkSync(file, path.join(dir, 'link.js'));
  fs.symlinkSync(dir, path.join(dir, 'folder'));
  const url = pathToFileURL(fs.realpathSync(file)).href;
  assert.equal(startedAsScript(url, ['node', file]), true);
  assert.equal(startedAsScript(url, ['node', path.join(dir, 'link.js')]), true);
  assert.equal(startedAsScript(url, ['node', path.join(dir, 'folder', 'a.js')]), true);
  assert.equal(startedAsScript(url, ['node', other]), false);
});

test('with no script named, nothing is the program; a path that can\'t be resolved is compared as written', () => {
  const url = pathToFileURL(path.join(ROOT, 'no-such-folder', 'x.js')).href;
  assert.equal(startedAsScript(url, ['node']), false);
  assert.equal(startedAsScript(url, ['node', '']), false);
  assert.equal(startedAsScript(url, []), false);
  assert.equal(startedAsScript(url, ['node', path.join(ROOT, 'no-such-folder', 'x.js')]), true);
  assert.equal(startedAsScript(url, ['node', path.join(ROOT, 'no-such-folder', 'y.js')]), false);
});

test('a guard hook started through a linked plugin folder refuses what it refuses from the real one', { skip: NO_LINKS }, async () => {
  const base = tempFolder('wh-started-hook-');
  const plugin = path.join(base, 'plugin');
  fs.symlinkSync(ROOT, plugin, 'dir');
  const home = path.join(base, 'wh');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: main, stdio: 'pipe' });
  await as(home, () => writeProject('owner__name', {
    folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {},
  }));
  const input = JSON.stringify({ cwd: main, session_id: 's', hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'cat .env' } });
  const env = { ...process.env, WHEELHOUSE_HOME: home };
  for (const script of [path.join(ROOT, 'scripts', 'hooks', 'tool-guard.js'), path.join(plugin, 'scripts', 'hooks', 'tool-guard.js')]) {
    const done = spawnSync(process.execPath, [script], { input, env, encoding: 'utf8', timeout: 20000 });
    assert.equal(done.status, 0, script);
    assert.equal(JSON.parse(done.stdout).hookSpecificOutput.permissionDecision, 'deny', script);
  }
});

test('the front desk\'s command started through a linked plugin folder answers', { skip: NO_LINKS }, () => {
  const base = tempFolder('wh-started-cli-');
  const plugin = path.join(base, 'plugin');
  fs.symlinkSync(ROOT, plugin, 'dir');
  const done = spawnSync(process.execPath, [path.join(plugin, 'scripts', 'frontdesk', 'cli.js'), 'nonsense'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(done.status, 1);
  assert.equal(done.stderr, 'Commands: cards, card, again, why, suggest, record, similar, views, explain, review, preview, carry-on, archive, restore, confirm, premium-card, premium-check\n');
});

// Each asks scripts/lib/started-as-script.js, which takes the arguments whole.
test('no script or hook decides by itself whether it was started as the program', () => {
  const own = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js') && fs.readFileSync(file, 'utf8').includes('process.argv[1]')) own.push(path.relative(ROOT, file).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, 'scripts'));
  assert.deepEqual(own, []);
});
