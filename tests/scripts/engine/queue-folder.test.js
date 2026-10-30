// tests/scripts/engine/queue-folder.test.js
// The merge queue's own folder (check 81): a checkout of the project's fetch mirror under the engine folder, whose
// settings are the project's own with only the helper's socket opened, made afresh when it isn't this project's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareQueueFolder, queueFolderOf, queueSettings, QUEUE_MARK } from '../../../scripts/engine/queue-folder.js';
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

test("the project's sandbox opens no local socket, so the queue's broker call is refused there, and the queue's folder opens the helper's alone", () => {
  const shared = projectSettings(readConfig(null));
  const socket = '/h/.wheelhouse/helper.sock';
  // Under the project's own settings the sweep's call to the broker can't reach the helper (seen in check 81).
  assert.equal(shared.sandbox?.network?.allowUnixSockets, undefined);
  const queue = queueSettings(shared, socket);
  assert.deepEqual(queue.sandbox.network.allowUnixSockets, [socket]);
  // Nothing else is widened: take the socket out and the project's own settings are left.
  const back = structuredClone(queue);
  delete back.sandbox.network.allowUnixSockets;
  assert.deepEqual(back, shared);
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
