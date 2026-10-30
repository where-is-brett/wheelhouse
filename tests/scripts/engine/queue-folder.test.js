// tests/scripts/engine/queue-folder.test.js
// The merge queue's own folder (check 81): a checkout of the project's fetch mirror under the engine folder, whose
// settings are the project's own with only the helper's socket opened, made afresh when it isn't this project's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareQueueFolder, queueFolderOf, queueProjectOf, queueSettings, QUEUE_MARK, QUEUE_LIFTED } from '../../../scripts/engine/queue-folder.js';
import { archonEnv } from '../../../scripts/engine/archon/env.js';
import { projectSettings } from '../../../scripts/protection/settings.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { tempFolder } from '../../helpers/homes.js';

const git = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.excludesFile=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim();
const REMOTE = 'https://github.com/o/p.git';

// A project's fetch mirror, as the helper keeps it: bare, its HEAD naming main, holding Standard's shared settings.
function mirrorWith(settings) {
  const work = tempFolder('wh-qf-work-');
  git(['init', '-q'], work);
  fs.mkdirSync(path.join(work, '.claude'));
  fs.writeFileSync(path.join(work, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(work, 'README.md'), 'p\n');
  git(['add', '-A'], work);
  git(['commit', '-q', '-m', 'Start'], work);
  const mirror = path.join(tempFolder('wh-qf-mirror-'), 'o__p.git');
  git(['clone', '-q', '--bare', work, mirror], tempFolder('wh-qf-'));
  return { mirror, work };
}

test("the project's sandbox opens no local socket and denies gh, and the queue's folder opens the helper's socket and lifts that one deny alone", () => {
  const shared = projectSettings(readConfig(null));
  const socket = '/h/.wheelhouse/helper.sock';
  // Under the project's own settings the sweep's call to the broker can't reach the helper, nor can it run gh (seen in
  // check 81); the project keeps both.
  assert.equal(shared.sandbox?.network?.allowUnixSockets, undefined);
  assert.ok(shared.permissions.deny.includes(QUEUE_LIFTED));
  const queue = queueSettings(shared, socket);
  assert.deepEqual(queue.sandbox.network.allowUnixSockets, [socket]);
  assert.equal(queue.permissions.deny.includes(QUEUE_LIFTED), false);
  assert.deepEqual(queue.sandbox.credentials.envVars.filter((v) => v.name === 'GH_CONFIG_DIR'), [{ name: 'GH_CONFIG_DIR', mode: 'deny' }]);
  // Nothing else is widened: take those out and the project's own settings are left.
  const back = structuredClone(queue);
  delete back.sandbox.network.allowUnixSockets;
  back.sandbox.credentials.envVars = back.sandbox.credentials.envVars.filter((v) => v.name !== 'GH_CONFIG_DIR');
  back.permissions.deny = shared.permissions.deny;
  assert.deepEqual(back, shared);
  assert.deepEqual(queue.permissions.deny, shared.permissions.deny.filter((rule) => rule !== QUEUE_LIFTED));
});

test("in a queue folder's run a bare gh is the broker's, and any other gh on its PATH finds no token, config folder or sign-in it may read", { skip: process.platform === 'win32' }, () => {
  // A Homebrew folder holding a real gh beside the Node, a caller with tokens and a config folder of its own.
  const root = fs.realpathSync(tempFolder('wh-qf-reach-'));
  const brew = path.join(root, 'brew', 'bin');
  const system = path.join(root, 'usr', 'bin');
  const engine = path.join(root, 'engine');
  const config = path.join(root, 'config', 'gh');
  for (const dir of [brew, system, config, path.join(engine, 'broker', 'bin')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(config, 'hosts.yml'), 'github.com:\n  user: someone\n  oauth_token: secret\n');
  // A gh that says what sign-in it finds: the token variables, and the hosts file in the config folder it is pointed at.
  const real = '#!/bin/sh\necho "token=${GH_TOKEN}${GITHUB_TOKEN}${GH_ENTERPRISE_TOKEN}${GITHUB_ENTERPRISE_TOKEN}"\n[ -n "$GH_CONFIG_DIR" ] && cat "$GH_CONFIG_DIR/hosts.yml" 2>/dev/null\nexit 0\n';
  for (const [file, text] of [[path.join(brew, 'gh'), real], [path.join(system, 'gh'), real], [path.join(brew, 'node'), '#!/bin/sh\n'], [path.join(engine, 'broker', 'bin', 'gh'), '#!/bin/sh\necho broker\n']]) {
    fs.writeFileSync(file, text);
    fs.chmodSync(file, 0o755);
  }
  const caller = { PATH: `${brew}:/usr/bin:/bin`, HOME: root, GH_TOKEN: 't', GITHUB_TOKEN: 't', GH_ENTERPRISE_TOKEN: 't', GITHUB_ENTERPRISE_TOKEN: 't', GH_CONFIG_DIR: config };
  const env = archonEnv({ engine, home: path.join(root, 'engine-home'), nodeDir: brew, baseEnv: caller });
  // (a) The first gh on the run's PATH is the broker's, so a bare gh is always the broker. The caller's folders are gone.
  const dirs = env.PATH.split(path.delimiter);
  assert.equal(dirs.find((d) => fs.existsSync(path.join(d, 'gh'))), path.join(engine, 'broker', 'bin'));
  assert.equal(dirs.includes(brew), false);
  assert.equal(execFileSync('/bin/sh', ['-c', 'gh'], { env, encoding: 'utf8' }).trim(), 'broker');
  // (b) A real gh further along it, as a system folder may hold one (here a stand-in for /usr/bin), finds no token and
  // no config folder of the caller's.
  const later = { ...env, PATH: `${env.PATH}${path.delimiter}${system}` };
  assert.equal(execFileSync(path.join(system, 'gh'), [], { env: later, encoding: 'utf8' }).trim(), 'token=');
  assert.notEqual(env.GH_CONFIG_DIR, config);
  assert.equal(fs.existsSync(env.GH_CONFIG_DIR), false);
  // And the queue's sandbox keeps from it the tokens and a config folder named in the step, should a command set them,
  // and the default config folder and the keychain, as the project's does: on the Mac a sandboxed step in the queue
  // folder found Homebrew's signed-in gh not signed in (check 81). The tool guard refuses gh by a path there.
  const queue = queueSettings(projectSettings(readConfig(null)), '/h/helper.sock');
  const denied = queue.sandbox.credentials.envVars.filter((v) => v.mode === 'deny').map((v) => v.name);
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR']) assert.ok(denied.includes(name), name);
  assert.ok(queue.sandbox.filesystem.denyRead.includes('~/.config/gh'));
  assert.ok(queue.permissions.deny.includes('Read(~/.config/gh)'));
  if (process.platform === 'darwin') assert.ok(queue.sandbox.credentials.files.some((f) => f.path === '~/Library/Keychains' && f.mode === 'deny'));
});

test('a socket under a linked folder is opened by its real path too', () => {
  const root = fs.realpathSync(tempFolder('wh-qf-link-'));
  fs.mkdirSync(path.join(root, 'real'));
  fs.symlinkSync(path.join(root, 'real'), path.join(root, 'home'), 'dir');
  const { sandbox } = queueSettings({}, path.join(root, 'home', 'helper.sock'));
  assert.deepEqual(sandbox.network.allowUnixSockets, [path.join(root, 'home', 'helper.sock'), path.join(root, 'real', 'helper.sock')]);
});

test("the queue's folder is a checkout of the mirror's default branch under the engine folder, naming the project's remote, with the socket opened and kept out of git", async () => {
  const shared = projectSettings(readConfig(null));
  const { mirror, work } = mirrorWith(shared);
  const engine = tempFolder('wh-qf-engine-');
  const socket = path.join(fs.realpathSync(tempFolder('wh-qf-home-')), 'helper.sock');
  const got = await prepareQueueFolder({ project: 'o__p', remoteUrl: REMOTE, mirror, socket, engine });
  assert.deepEqual(got, { ok: true, folder: queueFolderOf('o__p', engine) });
  assert.equal(got.folder, path.join(engine, 'queues', 'o__p'));
  assert.equal(git(['remote', 'get-url', 'origin'], got.folder), REMOTE);
  assert.equal(git(['symbolic-ref', '--short', 'HEAD'], got.folder), 'main');
  const written = JSON.parse(fs.readFileSync(path.join(got.folder, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(written, queueSettings(shared, socket));
  assert.match(git(['ls-files', '-v', '.claude/settings.json'], got.folder), /^S /);
  assert.equal(git(['status', '--porcelain'], got.folder), '');
  // The project's own settings are as they were.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, '.claude', 'settings.json'), 'utf8')), shared);
  // Run again after the default branch moved on: the folder follows it and its settings are written again.
  fs.writeFileSync(path.join(work, 'NEXT.md'), 'next\n');
  git(['add', '-A'], work);
  git(['commit', '-q', '-m', 'Next'], work);
  git(['push', '-q', mirror, 'HEAD:main'], work);
  assert.equal((await prepareQueueFolder({ project: 'o__p', remoteUrl: REMOTE, mirror, socket, engine })).ok, true);
  assert.ok(fs.existsSync(path.join(got.folder, 'NEXT.md')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(got.folder, '.claude', 'settings.json'), 'utf8')), queueSettings(shared, socket));
});

test("a queue's folder that isn't this project's, or is a link, is never reused: it is made afresh", async () => {
  const { mirror } = mirrorWith({});
  const engine = tempFolder('wh-qf-engine-');
  const socket = '/h/helper.sock';
  const folder = queueFolderOf('o__p', engine);
  // Marked for another project.
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, QUEUE_MARK), JSON.stringify({ project: 'x__y', remoteUrl: 'https://github.com/x/y.git', mirror: '/elsewhere' }));
  fs.writeFileSync(path.join(folder, 'left-over'), 'from x/y');
  assert.equal((await prepareQueueFolder({ project: 'o__p', remoteUrl: REMOTE, mirror, socket, engine })).ok, true);
  assert.equal(fs.existsSync(path.join(folder, 'left-over')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, QUEUE_MARK), 'utf8')).project, 'o__p');
  assert.equal(git(['remote', 'get-url', 'origin'], folder), REMOTE);
  // A link where the folder should be: taken away, and what it pointed at left alone.
  const elsewhere = tempFolder('wh-qf-elsewhere-');
  fs.writeFileSync(path.join(elsewhere, 'theirs'), 'keep');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.symlinkSync(elsewhere, folder, 'dir');
  assert.equal((await prepareQueueFolder({ project: 'o__p', remoteUrl: REMOTE, mirror, socket, engine })).ok, true);
  assert.equal(fs.lstatSync(folder).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(elsewhere, 'theirs'), 'utf8'), 'keep');
  // A missing part: refused, and nothing made.
  assert.equal((await prepareQueueFolder({ project: 'o__q', remoteUrl: REMOTE, socket, engine })).ok, false);
  assert.equal(fs.existsSync(queueFolderOf('o__q', engine)), false);
});

test("the broker places a call from a project's queue folder as that project's, and from nowhere else under the engine", () => {
  const engine = fs.realpathSync(tempFolder('wh-qf-engine-'));
  for (const p of ['o__p', 'o__q']) fs.mkdirSync(path.join(queueFolderOf(p, engine), 'src'), { recursive: true });
  fs.mkdirSync(path.join(engine, 'mirrors', 'o__p.git'), { recursive: true });
  assert.equal(queueProjectOf(queueFolderOf('o__p', engine), ['o__p', 'o__q'], engine), 'o__p');
  assert.equal(queueProjectOf(path.join(queueFolderOf('o__q', engine), 'src'), ['o__p', 'o__q'], engine), 'o__q');
  // A queue folder of a project no longer registered, the mirror, the engine folder itself, or a relative path: none.
  assert.equal(queueProjectOf(queueFolderOf('o__q', engine), ['o__p'], engine), null);
  assert.equal(queueProjectOf(path.join(engine, 'mirrors', 'o__p.git'), ['o__p'], engine), null);
  assert.equal(queueProjectOf(engine, ['o__p'], engine), null);
  assert.equal(queueProjectOf('queues/o__p', ['o__p'], engine), null);
});
