// tests/scripts/setup/local.test.js
// Setup for a project that stays on this computer (spec 10, the plan's part 7): what step 3 asks, lists and makes for a folder
// with no GitHub or GitLab remote. Git runs for real in temporary folders; any host tool is refused and noted.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hostStep, productOf, REAL_USERS, LEVELS, fromOtherComputer } from '../../../scripts/setup/host.js';
import {
  CHOOSE_BACKUP, KEEP_HERE, KEPT_LINE, NO_BACKUP, ONLY_HERE_LINE, PUT_ON_GITHUB, FIRST_CHECK_LINE, backupAsk, branchesOf, chooseBranch, chosenHost,
  localCard, localName, mirrorOf, othersLine, remotesOf, repoOfLocal,
} from '../../../scripts/setup/local.js';
import { redoCard } from '../../../scripts/setup/redo.js';
import { FOLDER_REMOTE } from '../../../scripts/host/local/folder.js';
import { homeBranch, homeDir, homeReadable, makeHome } from '../../../scripts/host/local/home.js';
import { backupFile, readBackup, SAME_DISK_LINE, writeBackup } from '../../../scripts/host/local/backup.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { readProject } from '../../../scripts/lib/projects.js';
import { startRun, addChanges } from '../../../scripts/setup/journal.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { g } from '../../helpers/git-fixture.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const NOW = new Date('2026-11-01T03:00:00.000Z');
const hostLog = [];
const guarded = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const said = (label) => ({ label, text: null, at: NOW.toISOString() });
const stepFor = (extra = {}) => hostStep({ run: guarded, findGit: async () => ({ ok: true, path: 'git' }), open: async () => {}, sleep: async () => {}, pick: async () => null, ...extra });
const ctxFor = (folder, extra = {}) => ({ folder, step: 3, now: () => NOW, platform: 'darwin', userHome: folder, answers: {}, ...extra });

const folderOf = (name = 'Shop') => {
  const folder = path.join(fs.realpathSync.native(tempFolder('wh-proj ')), name);
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'the director\'s own notes\n');
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), '{"enabledPlugins":{"wheelhouse@wheelhouse":true}}\n');
  return folder;
};
const committed = async (folder, branch = 'main') => {
  await g(folder, 'init', '-q', '-b', branch);
  await g(folder, 'add', 'notes.txt');
  await g(folder, 'commit', '-q', '-m', 'Begin');
  return folder;
};

// Plans the step, taking each question's recommendation, or `picks[id]`, until it lists its changes.
async function planned(step, ctx, picks = {}) {
  const answers = { ...(ctx.answers ?? {}), '3.real-users': said(REAL_USERS.no) };
  const asked = [];
  for (let i = 0; i < 8; i += 1) {
    const got = await step.plan({ ...ctx, answers });
    if (!got.ask) return { ...got, answers, asked };
    asked.push(got.ask);
    const key = Object.keys(picks).find((k) => got.ask.id === k || got.ask.id.startsWith(`${k}-`));
    answers[`3.${got.ask.id}`] = said(key === undefined ? got.ask.card.recommend : picks[key]);
  }
  throw new Error('the step kept asking');
}

async function applied(step, folder, list) {
  const run = startRun({ folder, now: () => NOW });
  const lines = [];
  await step.apply(ctxFor(folder, {
    runId: run.id,
    say: (line) => { lines.push(line); },
    record: (made) => addChanges(run.id, (Array.isArray(made) ? made : [made]).map((c) => ({ ...c, step: 3 }))),
    answers: list.answers,
  }), list.changes);
  return lines;
}

test('a folder with no remote asks no host question', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    assert.deepEqual(productOf(folder), { isNew: false, host: 'local', repo: null, name: 'Shop', others: [] });
    const got = await planned(stepFor(), ctxFor(folder));
    assert.equal(got.asked.find((a) => a.id === 'host'), undefined);
    assert.ok(got.asked.every((a) => !a.id.startsWith('connection-')), 'no way of connecting is asked');
    assert.equal(got.changes.find((c) => c.action === 'home').target, homeDir('Shop'));
  });
});

test('only other remotes are left alone and the plan says so', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    await g(folder, 'remote', 'add', 'origin', 'https://git.example.com/a-team/shop.git');
    await g(folder, 'remote', 'add', 'backup', 'https://backup.example.com/shop.git');
    assert.deepEqual(remotesOf(folder), ['https://git.example.com/a-team/shop.git', 'https://backup.example.com/shop.git']);
    const got = await planned(stepFor(), ctxFor(folder));
    assert.match(got.card.what, /also points at .*leaves as it is and sends nothing to/);
    await applied(stepFor(), folder, got);
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), 'https://git.example.com/a-team/shop.git');
    assert.equal(await g(folder, 'config', '--get', 'remote.backup.url'), 'https://backup.example.com/shop.git');
    assert.equal(othersLine([]), null);
  });
});

test('an empty folder offers Keep it on this computer first', async () => {
  await withHome(async () => {
    const folder = folderOf();
    fs.rmSync(path.join(folder, 'notes.txt'));
    const step = stepFor();
    const ask = (await step.plan(ctxFor(folder, { answers: { '3.real-users': said(REAL_USERS.no) } }))).ask;
    assert.equal(ask.id, 'join');
    assert.equal(ask.card.options[0].label, KEEP_HERE);
    assert.equal(ask.card.recommend, KEEP_HERE);
    assert.equal(chosenHost({ '3.join': said(KEEP_HERE) }), 'local');
    assert.equal(chosenHost({ '3.kept': said(PUT_ON_GITHUB) }), 'github');
  });
});

test('no git gets git init on main and the card names it', async () => {
  await withHome(async () => {
    const folder = folderOf();
    const got = await planned(stepFor(), ctxFor(folder));
    assert.ok(got.changes.some((c) => c.action === 'git-init' && c.branch === 'main'));
    assert.match(got.card.what, /git starts in this folder, on main/);
    assert.match(got.card.what, /a first commit on main/);
    await applied(stepFor(), folder, got);
    assert.equal(await g(folder, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(await g(folder, 'log', '-1', '--format=%s'), 'Start the project');
    assert.equal(fs.readFileSync(path.join(folder, 'notes.txt'), 'utf8'), 'the director\'s own notes\n');
    assert.match(await g(folder, 'status', '--porcelain'), /\?\? notes\.txt/, 'what the folder held stays as it was');
  });
});

test('a default branch not called main works', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf(), 'trunk');
    const got = await planned(stepFor(), ctxFor(folder));
    assert.equal(got.asked.some((a) => a.id.startsWith('branch-')), false, 'one branch needs no asking');
    await applied(stepFor(), folder, got);
    assert.equal(await g(homeDir('Shop'), 'symbolic-ref', '--short', 'HEAD'), 'trunk');
  });
  await withHome(async () => {
    const folder = await committed(folderOf(), 'trunk');
    await g(folder, 'branch', 'release');
    assert.deepEqual(branchesOf(folder), ['trunk', 'release']);
    assert.equal(chooseBranch(['trunk', 'release']), null);
    assert.equal(chooseBranch(['master', 'trunk']), 'master');
    const got = await planned(stepFor(), ctxFor(folder), { branch: 'release' });
    const ask = got.asked.find((a) => a.id.startsWith('branch-'));
    assert.deepEqual(ask.card.options.map((o) => o.label), ['trunk', 'release']);
    assert.equal(got.changes.find((c) => c.action === 'home').branch, 'release');
  });
});

test('submodules are no refusal', async () => {
  await withHome(async () => {
    const inner = await committed(folderOf('Inner'));
    const folder = await committed(folderOf());
    await g(folder, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'inner');
    await g(folder, 'commit', '-q', '-m', 'Add the inner project');
    await applied(stepFor(), folder, await planned(stepFor(), ctxFor(folder)));
    assert.equal(readProject('Shop').host, 'local');
  });
});

test('sign-in, tools, own app, protection, lock branch and trial pull request are skipped', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    const got = await planned(stepFor(), ctxFor(folder));
    assert.deepEqual(got.changes.map((c) => c.action), ['project', 'state', 'home', 'folder-remote', 'backup-folder', 'first-check', 'connection']);
    assert.deepEqual(hostLog, []);
    assert.equal(got.changes.find((c) => c.action === 'connection').mode, 'none');
    await applied(stepFor(), folder, got);
    assert.deepEqual(readProject('Shop').connection, { host: 'local', mode: 'none', project: repoOfLocal('Shop') });
  });
});

test('Locked is kept on the connection of a project kept here', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    const got = await planned(stepFor(), ctxFor(folder, { answers: {} }), { locked: LEVELS.locked });
    await applied(stepFor(), folder, got);
    assert.equal(readProject('Shop').connection.host, 'local');
  });
});

test('the home, remote and first check are added', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    const got = await planned(stepFor(), ctxFor(folder));
    assert.ok(got.changes.some((c) => c.kind === 'check' && c.action === 'first-check'));
    const lines = await applied(stepFor(), folder, got);
    assert.ok(lines.includes(KEPT_LINE));
    assert.equal(readProject('Shop').remoteUrl, null);
    assert.equal(readProject('Shop').repo, 'local/Shop');
    assert.equal(await g(folder, 'config', '--get', `remote.${FOLDER_REMOTE}.url`), mirrorOf('Shop'));
    assert.equal(await g(homeDir('Shop'), 'rev-parse', 'refs/heads/main'), await g(folder, 'rev-parse', 'HEAD'));
    // A retry finds the same project, and each change is safe to repeat.
    assert.equal(localName(folder, 'Shop'), 'Shop');
    await applied(stepFor(), folder, await planned(stepFor(), ctxFor(folder)));
    assert.equal(readProject('Shop').folder, folder);
  });
});

test('another project of the name gets its own home', async () => {
  await withHome(async () => {
    const first = await committed(folderOf());
    await applied(stepFor(), first, await planned(stepFor(), ctxFor(first)));
    const second = await committed(folderOf());
    await applied(stepFor(), second, await planned(stepFor(), ctxFor(second)));
    assert.equal(readProject('Shop-2').folder, second);
    assert.equal(readProject('Shop').folder, first);
  });
});

test('changing where a project is kept, once it is set up here, says so without naming a host', () => {
  const { card } = redoCard({ key: '3.join', answers: { '3.join': said(KEEP_HERE) }, name: 'Shop', record: { host: 'local' }, described: null, count: 1 });
  assert.match(card.what, /^Shop is already set up on this computer/);
  assert.doesNotMatch(`${card.what} ${card.why}`, /\bhost\b|repository|connection/i);
});

test('the card says nothing goes online and never says host', async () => {
  const card = localCard({ changes: [{ action: 'git-init' }, { action: 'first-commit' }], branch: 'main', others: [] });
  assert.ok(card.what.includes(KEPT_LINE));
  assert.ok(card.what.toLowerCase().includes(FIRST_CHECK_LINE.replace(/\.$/, '').toLowerCase()));
  assert.equal(card.options[0].label, 'Go ahead');
  assert.doesNotMatch(`${card.what} ${card.why} ${card.meanwhile}`, /\bhost\b|\bremote\b|bare|forge/i);
});

const destination = async (file, args, options) => {
  if (file === 'tmutil') return { code: args[0] === 'destinationinfo' ? 0 : 1, stdout: 'Name : Spare\nID : 1\n', stderr: '' };
  return guarded(file, args, options);
};

test('a project kept here gets one card about backups, and the plan carries its warning', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    const got = await planned(stepFor(), ctxFor(folder));
    const cards = got.asked.filter((a) => a.id.startsWith('backup'));
    assert.equal(cards.length, 1);
    assert.equal(cards[0].line, ONLY_HERE_LINE);
    assert.ok(cards[0].card.what.includes(ONLY_HERE_LINE));
    assert.deepEqual(cards[0].card.options.map((o) => o.label), [CHOOSE_BACKUP, NO_BACKUP]);
    assert.equal(cards[0].card.recommend, CHOOSE_BACKUP);
  });
});

test('Not now closes the card for good and building goes on', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    const got = await planned(stepFor(), ctxFor(folder), { backup: NO_BACKUP });
    assert.equal(got.changes.some((c) => c.action === 'backup-folder'), false);
    assert.equal(got.card.what.includes('backup'), false);
    assert.equal((await stepFor().plan({ ...ctxFor(folder), answers: got.answers })).ask, undefined);
    await applied(stepFor({ pick: async () => assert.fail('no window opens') }), folder, got);
    assert.equal(readBackup('Shop').folder, null);
  });
});

test('with Time Machine on, the card names it and offers a second copy off the computer', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    const got = await planned(stepFor({ run: destination }), ctxFor(folder));
    const { card, line } = got.asked.find((a) => a.id === 'backup');
    assert.match(card.what, /^Time Machine backs Shop up\. Do you want a second copy off the computer too\?/);
    assert.match(line, /Time Machine/);
    assert.deepEqual(card.options.map((o) => o.label), [CHOOSE_BACKUP, NO_BACKUP]);
    assert.equal(backupAsk('Shop').card.what.includes('Time Machine'), false);
  });
});

test('a folder that isn\'t chosen holds setup up in nothing, and the row offers it again', async () => {
  await withHome(async () => {
    const folder = await committed(folderOf());
    const got = await planned(stepFor(), ctxFor(folder));
    const lines = await applied(stepFor(), folder, got);
    assert.ok(lines.some((l) => /Safekeeping row/.test(l)));
    assert.equal(readBackup('Shop').folder, null);
    assert.equal(homeReadable('Shop'), true);
  });
});

test('the picked folder is kept, and a typed one on the same disk is asked again', async () => {
  await withHome(async () => {
    const before = process.env.HOME;
    const person = fs.realpathSync.native(tempFolder('wh-person-'));
    const cloud = path.join(person, 'Dropbox', 'Backups');
    fs.mkdirSync(cloud, { recursive: true });
    process.env.HOME = person;
    try {
      const folder = await committed(folderOf());
      const step = stepFor({ pick: async () => cloud });
      const got = await planned(step, ctxFor(folder));
      await applied(step, folder, got);
      if (process.platform !== 'win32') assert.equal(readBackup('Shop').folder, cloud);

      const other = await committed(folderOf('Mill'));
      const elsewhere = tempFolder('wh-same-disk-');
      const typed = { '3.real-users': said(REAL_USERS.no), '3.kept': said(KEEP_HERE), '3.backup': { label: null, text: elsewhere, at: NOW.toISOString() } };
      const again = await step.plan({ ...ctxFor(other), answers: typed });
      assert.equal(again.ask.id, 'backup-1');
      assert.ok(again.ask.card.what.startsWith(SAME_DISK_LINE));
    } finally {
      process.env.HOME = before;
    }
  });
});

test('a backup path typed on the join card brings the project back through setup', async () => {
  await withHome(async () => {
    const source = await committed(folderOf());
    await makeHome({ project: 'Shop', folder: source });
    writeProject('Shop', { folder: source, remoteUrl: null, host: 'local', repo: 'local/Shop', connection: { host: 'local', mode: 'none' } });
    const drive = fs.realpathSync.native(tempFolder('wh-drive-'));
    await writeBackup({ project: 'Shop', folder: drive, stat: (p) => ({ dev: String(p).startsWith(drive) ? 2 : 1 }) });
    fs.renameSync(backupFile(drive, 'Shop'), path.join(drive, 'Mill.wheelhouse-backup'));
    const file = path.join(drive, 'Mill.wheelhouse-backup');

    const folder = path.join(fs.realpathSync.native(tempFolder('wh-proj ')), 'Mill');
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), '{}\n');
    const answers = { '3.join': { label: null, text: `  ${file} `, at: NOW.toISOString() } };
    assert.equal(chosenHost(answers), 'local');
    const got = await planned(stepFor(), ctxFor(folder, { answers }), { backup: NO_BACKUP });
    assert.equal(got.asked.some((a) => a.id === 'kept'), false);
    assert.equal(got.changes.find((c) => c.action === 'home').restore, file);
    assert.deepEqual(got.changes.filter((c) => ['git-init', 'first-commit'].includes(c.action)), []);
    assert.match(got.card.what, /brought back from your backup/);
    await applied(stepFor(), folder, got);
    assert.equal(homeReadable('Mill'), true);
    assert.equal(homeBranch('Mill'), 'main');
    assert.equal(readProject('Mill').host, 'local');
    assert.equal(await g(folder, 'rev-parse', 'main'), await g(source, 'rev-parse', 'main'));
    assert.equal(fs.existsSync(path.join(folder, 'notes.txt')), true);
    assert.equal(await g(folder, 'config', '--get', `remote.${FOLDER_REMOTE}.url`), mirrorOf('Mill'));
  });
});

test('a backup path that can\'t be found asks again', async () => {
  await withHome(async () => {
    const folder = path.join(fs.realpathSync.native(tempFolder('wh-proj ')), 'Mill');
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    const first = await stepFor().plan(ctxFor(folder));
    assert.equal(first.ask.id, 'join');
    assert.match(first.ask.card.what, /backup file/);
    assert.equal(first.ask.card.options.length, 4);
    assert.equal(first.ask.card.options[3].label, fromOtherComputer('Mill'));
    const got = await stepFor().plan(ctxFor(folder, { answers: { '3.join': { label: null, text: '/Volumes/Spare/Mill.wheelhouse-backup', at: NOW.toISOString() } } }));
    assert.match(got.ask.id, /^join-/);
    assert.match(got.ask.card.what, /can't be found/);
  });
});
