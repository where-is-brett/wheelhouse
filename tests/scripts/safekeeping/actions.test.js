// tests/scripts/safekeeping/actions.test.js
// What the director can do from the Safekeeping row (spec 8.2): only what the status offers, nothing that reaches the main
// version, and a copy online that names what went up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chooseFolder, KEEP_PLACE, safekeepingAct } from '../../../scripts/safekeeping/actions.js';
import { tempFolder } from '../../helpers/homes.js';
import { git, commitIn, projectFolderWith, withKeyedHome } from '../../helpers/local-home.js';
import { homeDir, makeHome } from '../../../scripts/host/local/home.js';
import { bringFolderUp, FOLDER_REMOTE } from '../../../scripts/host/local/folder.js';

const offered = (...actions) => ({ actions: actions.map((action) => ({ action, label: action })) });
const onGitHub = (...branches) => ({ place: 'github', onlyHere: { branches, commits: branches.length, uncommitted: 0 } });

test('an action the status no longer offers does nothing', async () => {
  let sent = 0;
  const got = await safekeepingAct('keep-online', { status: offered('try-again'), readings: onGitHub('work'), keepCopy: async () => { sent += 1; return { ok: true }; } });
  assert.match(got.refused, /isn't offered/);
  assert.equal(sent, 0);
  assert.ok((await safekeepingAct('constructor', { status: offered('constructor') })).refused);
  assert.ok((await safekeepingAct('keep-online', {})).refused);
});

test('no action can reach the default branch', async () => {
  const sent = [];
  const keepCopy = async (copy) => { sent.push(copy); return { ok: true }; };
  await safekeepingAct('keep-online', { status: offered('keep-online'), readings: onGitHub('main', 'work'), defaultBranch: 'main', keepCopy });
  assert.deepEqual(sent.map((copy) => copy.place), [`${KEEP_PLACE}/main`, `${KEEP_PLACE}/work`]);
  sent.length = 0;
  const onKeep = await safekeepingAct('keep-online', { status: offered('keep-online'), readings: onGitHub('work'), defaultBranch: `${KEEP_PLACE}/work`, keepCopy });
  assert.match(onKeep.refused, /main version/);
  assert.deepEqual(sent, [], 'a project whose main line is keep/<branch> sends nothing');
});

test('Keep a copy online never merges and names what goes up', async () => {
  const sent = [];
  const got = await safekeepingAct('keep-online', {
    status: offered('keep-online'), readings: onGitHub('work', 'other'), defaultBranch: 'main',
    keepCopy: async (copy) => { sent.push(copy); return { ok: true }; },
  });
  assert.deepEqual(sent, [{ branch: 'work', place: 'keep/work' }, { branch: 'other', place: 'keep/other' }]);
  assert.equal(got.ok, true);
  assert.match(got.says, /keep\/work, keep\/other/);
  assert.match(got.says, /Nothing was merged/);
  const stopped = await safekeepingAct('keep-online', {
    status: offered('keep-online'), readings: onGitHub('work', 'other'), defaultBranch: 'main',
    keepCopy: async ({ branch }) => (branch === 'work' ? { ok: true } : { ok: false, refused: 'All stop is on' }),
  });
  assert.match(stopped.refused, /other couldn't be sent: All stop is on/);
});

test('Bring my folder up to date refuses a dirty folder', async () => {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith('trunk');
    await makeHome({ project: 'shop', folder });
    const copy = path.join(tempFolder('wh-copy-'), 'copy');
    await git(path.dirname(copy), ['clone', '-q', homeDir('shop'), copy]);
    await git(copy, ['config', 'user.name', 'T']);
    await git(copy, ['config', 'user.email', 't@example.com']);
    await commitIn(copy, 'new.txt');
    await git(homeDir('shop'), ['fetch', '-q', copy, '+refs/heads/trunk:refs/heads/trunk']);
    fs.writeFileSync(path.join(folder, 'a.txt'), 'left here\n');
    await git(folder, ['add', 'a.txt']);
    await git(folder, ['commit', '-qm', 'local', '--allow-empty']);
    await git(folder, ['reset', '-q', '--hard', 'HEAD~1']);
    const file = path.join(folder, 'new.txt');
    fs.writeFileSync(file, 'mine\n');
    const before = await git(folder, ['rev-parse', 'HEAD']);
    const got = await safekeepingAct('bring-up', {
      status: offered('bring-up'),
      bringUp: () => bringFolderUp({ project: 'shop', folder, branch: 'trunk' }),
    });
    assert.equal(typeof got.refused, 'string');
    assert.equal(await git(folder, ['rev-parse', 'HEAD']), before);
    assert.equal(fs.readFileSync(file, 'utf8'), 'mine\n');
  });
});

test('Back up now says what came of the try, and Ask the First Mate hands on the prompt', async () => {
  const backUpNow = (answer) => ({ status: offered('back-up-now'), backUpNow: async () => answer });
  assert.equal((await safekeepingAct('back-up-now', backUpNow({ written: 'x' }))).ok, true);
  assert.match((await safekeepingAct('back-up-now', backUpNow({ skipped: 'away' }))).refused, /isn't here/);
  assert.equal((await safekeepingAct('back-up-now', backUpNow({ skipped: 'place', why: 'That folder is inside' }))).refused, 'That folder is inside');
  assert.equal((await safekeepingAct('back-up-now', backUpNow({ failed: 'Not checked' }))).refused, 'Not checked');
  assert.deepEqual(await safekeepingAct('ask-save', { status: offered('ask-save'), prompt: 'save them' }), { ok: true, submit: ['save them'] });
  const looks = [];
  await safekeepingAct('try-again', { status: offered('try-again'), look: async (how) => looks.push(how) });
  assert.deepEqual(looks, [{ force: true }]);
});

test('choosing a folder runs apart, and a folder that does not count is noted for the row', async () => {
  let soon = 0;
  const got = await safekeepingAct('choose-folder', { status: offered('choose-folder'), chooseSoon: () => { soon += 1; } });
  assert.equal(got.ok, true);
  assert.equal(soon, 1);
  const seen = [];
  const how = (folder, chosen) => ({
    pick: async () => folder, choose: (f) => { seen.push(['choose', f]); return chosen; }, noteRefused: (why) => seen.push(['refused', why]),
    backUpNow: async () => seen.push(['backup']), look: async () => seen.push(['look']),
  });
  await chooseFolder(how(null, { ok: true }));
  assert.deepEqual(seen, [], 'a closed window changes nothing');
  await chooseFolder(how('/d', { ok: true }));
  assert.deepEqual(seen.splice(0), [['choose', '/d'], ['backup'], ['look']]);
  await chooseFolder(how('/d', { ok: false, why: 'Same disk' }));
  assert.deepEqual(seen, [['choose', '/d'], ['refused', 'Same disk'], ['look']]);
});

test('the folder is brought up from the mirror under the host\'s own remote', async () => {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith('trunk');
    const mirror = path.join(tempFolder('wh-mirror-'), 'mirror.git');
    await git(path.dirname(mirror), ['clone', '-q', '--bare', folder, mirror]);
    const copy = path.join(tempFolder('wh-copy-'), 'copy');
    await git(path.dirname(copy), ['clone', '-q', mirror, copy]);
    await git(copy, ['config', 'user.name', 'T']);
    await git(copy, ['config', 'user.email', 't@example.com']);
    await commitIn(copy, 'new.txt');
    await git(mirror, ['fetch', '-q', copy, '+refs/heads/trunk:refs/heads/trunk']);
    const got = await bringFolderUp({ project: 'shop', folder, branch: 'trunk', from: { dir: mirror, remote: 'origin' } });
    assert.equal(got.line, undefined);
    assert.equal(await git(folder, ['rev-parse', 'HEAD']), await git(mirror, ['rev-parse', 'trunk']));
    assert.equal(await git(folder, ['rev-parse', 'refs/remotes/origin/trunk']), await git(mirror, ['rev-parse', 'trunk']));
    assert.notEqual(FOLDER_REMOTE, 'origin');
    assert.notEqual((await git(folder, ['for-each-ref', `refs/remotes/${FOLDER_REMOTE}`])).length > 0, true);
  });
});

test('Bring my folder up to date says so when the folder has work of its own', async () => {
  const bring = (answer) => safekeepingAct('bring-up', { status: offered('bring-up'), bringUp: async () => answer });
  assert.equal((await bring({ moved: true })).ok, true);
  assert.equal((await bring({ moved: false, state: 'same' })).ok, true);
  assert.match((await bring({ moved: false, state: 'parted' })).refused, /work of its own/);
});
