// tests/scripts/setup/local.test.js
// Setup for a project that stays on this computer (spec 10, the plan's part 7): what step 3 asks, lists and makes for a folder
// with no GitHub or GitLab remote. Git runs for real in temporary folders; any host tool is refused and noted.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hostStep, productOf, REAL_USERS, LEVELS } from '../../../scripts/setup/host.js';
import {
  KEEP_HERE, KEPT_LINE, PUT_ON_GITHUB, FIRST_CHECK_LINE, branchesOf, chooseBranch, chosenHost, localCard, localName, mirrorOf,
  othersLine, remotesOf, repoOfLocal,
} from '../../../scripts/setup/local.js';
import { FOLDER_REMOTE } from '../../../scripts/host/local/folder.js';
import { homeDir } from '../../../scripts/host/local/home.js';
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
const stepFor = (extra = {}) => hostStep({ run: guarded, findGit: async () => ({ ok: true, path: 'git' }), open: async () => {}, sleep: async () => {}, ...extra });
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
    assert.deepEqual(got.changes.map((c) => c.action), ['project', 'state', 'home', 'folder-remote', 'first-check', 'connection']);
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

test('the card says nothing goes online and never says host', async () => {
  const card = localCard({ changes: [{ action: 'git-init' }, { action: 'first-commit' }], branch: 'main', others: [] });
  assert.ok(card.what.includes(KEPT_LINE));
  assert.ok(card.what.toLowerCase().includes(FIRST_CHECK_LINE.replace(/\.$/, '').toLowerCase()));
  assert.equal(card.options[0].label, 'Go ahead');
  assert.doesNotMatch(`${card.what} ${card.why} ${card.meanwhile}`, /\bhost\b|\bremote\b|bare|forge/i);
});
