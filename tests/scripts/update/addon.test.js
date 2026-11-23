// tests/scripts/update/addon.test.js
// What setup and the update command offer about the Wheelhouse panel for VS Code: nothing for the same version, "Install the panel"
// where it is not there, "Update the panel" where it is older, and no offer where VS Code can't be found. The Update card names
// it once, and only the director's click on that card installs it, in the finish step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { addonOffer, findCode, runCode, versionOnDisk, panelVersionIn, panelOnCard, planNamedAddon, vscodeHere, ADDON_ID } from '../../../scripts/update/addon.js';
import { updateCard } from '../../../scripts/update/cards.js';
import { finish } from '../../../scripts/update/finish.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

// finish's own seams for a run that has nothing else to do: the hand-over is already done on a new helper.
function finishOptions() {
  const claudeHome = path.join(process.env.WHEELHOUSE_HOME, 'claude');
  const newRoot = path.join(claudeHome, 'plugins', 'cache', 'wheelhouse', 'wheelhouse', '0.3.1');
  fs.mkdirSync(newRoot, { recursive: true });
  let t = 0;
  return {
    project: 'proj', folder: '/nowhere/proj', claudeHome, newRoot, to: 'v0.3.1', from: 'v0.3.0', platform: 'darwin',
    client: { health: async () => ({ ok: true, version: '0.3.1', pid: 9 }), retire: async () => ({ ok: true, retired: true }) },
    refresh: { local: async () => null, locked: async () => null }, startHelper: () => {}, kill: () => {}, now: () => t, sleep: async (ms) => { t += ms; },
    user: 'someone', cacheRoot: '/cache', heldNow: () => true, shape: async () => 1, move: async () => null,
    old: { proveRecorded: async () => ({ why: 'no record' }), findByAddress: async () => null, reprove: async () => null },
    watcher: { stopWatcher: async () => ({ stopped: false }), startWatcher: () => ({ started: true }), watcherRunning: () => false },
  };
}

const runOf = (calls, { listing = `ms-python.python@2024.1.0\n${ADDON_ID}@0.3.0\n`, code = 0 } = {}) => async (file, args) => {
  calls.push([path.basename(file), ...args]);
  if (args[0] === '--list-extensions') return { code, stdout: listing };
  return { code, stdout: '' };
};
const env = () => {
  const bin = tempFolder('wh-code-');
  fs.writeFileSync(path.join(bin, 'code'), '#!/bin/sh\n');
  fs.chmodSync(path.join(bin, 'code'), 0o755);
  return { PATH: bin };
};
// `exists` says nothing of VS Code's own folders is there, so only the path's `code` counts, whatever this computer has.
const NOWHERE = () => false;
const offer = (opts) => addonOffer({ platform: 'darwin', env: env(), home: tempFolder('wh-home-'), exists: (f) => fs.existsSync(f) && f.startsWith(os.tmpdir()), present: () => false, ...opts });

test('the panel\'s version is read from VS Code\'s listing, case aside', () => {
  assert.equal(panelVersionIn(`a.b@1.0.0\nWheelhouse.Wheelhouse@0.3.0\r\n`), '0.3.0');
  assert.equal(panelVersionIn('a.b@1.0.0\n'), null);
  assert.equal(panelVersionIn(`${ADDON_ID}\n`), '');
});

test('the same version: nothing is offered; a newer one installed is left alone', async () => {
  const calls = [];
  assert.equal(await offer({ run: runOf(calls), pluginVersion: '0.3.0' }), null);
  assert.equal(await offer({ run: runOf([]), pluginVersion: 'v0.3.0' }), null, 'a leading v is no difference');
  assert.equal(await offer({ run: runOf([], { listing: `${ADDON_ID}@0.4.0\n` }), pluginVersion: '0.3.0' }), null);
  assert.deepEqual(calls[0].slice(1), ['--list-extensions', '--show-versions']);
});

test('an older panel is offered as an update, naming both versions', async () => {
  assert.deepEqual(await offer({ run: runOf([]), pluginVersion: '0.3.1' }), { kind: 'update', from: '0.3.0', to: '0.3.1' });
  assert.deepEqual(await offer({ run: runOf([], { listing: `${ADDON_ID}@0.3.1-rc.1\n` }), pluginVersion: '0.3.1' }), { kind: 'update', from: '0.3.1-rc.1', to: '0.3.1' });
});

test('a version that cannot be read gets no update offer', async () => {
  assert.equal(await offer({ run: runOf([], { listing: `${ADDON_ID}\n` }), pluginVersion: '0.3.1' }), null);
  assert.equal(await offer({ run: runOf([], { listing: `${ADDON_ID}@banana\n` }), pluginVersion: '0.3.1' }), null);
});

test('no panel in VS Code is offered as an install', async () => {
  assert.deepEqual(await offer({ run: runOf([], { listing: 'ms-python.python@2024.1.0\n' }), pluginVersion: '0.3.1' }), { kind: 'install', to: '0.3.1' });
});

test('with no code to ask anywhere, the version is read from VS Code\'s extensions folder, else the offer comes only where VS Code is here', async () => {
  const none = async () => { throw new Error('never run'); };
  const home = tempFolder('wh-home-');
  const bare = { run: none, env: {}, home, exists: NOWHERE, pluginVersion: '0.3.1' };
  assert.equal(await addonOffer({ ...bare, platform: 'darwin', present: () => false }), null);
  assert.deepEqual(await addonOffer({ ...bare, platform: 'darwin', present: () => true }), { kind: 'install', to: '0.3.1' });
  assert.equal(await addonOffer({ ...bare, platform: 'win32', env: { Path: 'C:\\nowhere' }, present: () => false }), null, 'Windows with no code.cmd');
  fs.mkdirSync(path.join(home, '.vscode', 'extensions', `${ADDON_ID}-0.3.0-darwin-arm64`), { recursive: true });
  assert.equal(versionOnDisk({ home }), '0.3.0');
  assert.deepEqual(await addonOffer({ ...bare, present: () => false }), { kind: 'update', from: '0.3.0', to: '0.3.1' });
  assert.equal(await addonOffer({ ...bare, pluginVersion: '0.3.0' }), null, 'the same version, found on disk');
  assert.equal(await offer({ run: runOf([]), pluginVersion: '' }), null, 'no release version, no offer');
});

test('VS Code\'s own copy of its command is used when none is on the path, on a Mac and on Windows', async () => {
  const calls = [];
  const mac = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  assert.deepEqual(findCode({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/p', exists: (f) => f === mac }), { kind: 'direct', file: mac });
  const own = '/Users/p/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  assert.equal(findCode({ platform: 'darwin', env: { PATH: '' }, home: '/Users/p', exists: (f) => f === own }).file, own);
  const local = 'C:\\Users\\p\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';
  assert.deepEqual(findCode({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local', Path: '' }, home: 'C:\\Users\\p', exists: (f) => f === local }), { kind: 'cmd', file: local });
  const files = findCode({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\L', Path: '' }, home: 'C:\\Users\\p', exists: (f) => f === 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd' });
  assert.equal(files.file, 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd');
  assert.equal(findCode({ platform: 'darwin', env: { PATH: '' }, home: '/Users/p', exists: NOWHERE }), null);
  // The path's own `code` comes first, and the found copy is what runs.
  const got = await addonOffer({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/p', exists: (f) => f === mac, run: async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: `${ADDON_ID}@0.3.0\n` }; }, pluginVersion: '0.3.1' });
  assert.deepEqual(got, { kind: 'update', from: '0.3.0', to: '0.3.1' });
  assert.equal(calls[0][0], mac);
  await assert.rejects(runCode({ platform: 'darwin', env: {}, home: '/Users/p', exists: NOWHERE, args: ['--version'], run: async () => ({ code: 0 }) }), { code: 'NO_CODE' });
});

test('VS Code is found where it installs by default', () => {
  assert.equal(vscodeHere({ platform: 'darwin', home: '/Users/p', exists: (f) => f === '/Applications/Visual Studio Code.app' }), true);
  assert.equal(vscodeHere({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' }, exists: (f) => f.endsWith('Microsoft VS Code') }), true);
  assert.equal(vscodeHere({ platform: 'darwin', home: '/Users/p', exists: () => false }), false);
  assert.equal(vscodeHere({ platform: 'darwin', exists: () => { throw new Error('x'); } }), false);
});

test('the Update card names the panel only for an update of one already installed, and a first install is never on it', () => {
  const base = { from: 'v0.3.0', to: 'v0.3.1', says: 'x', hash: 'a'.repeat(64) };
  assert.ok(!updateCard(base).question.includes('Wheelhouse panel'));
  const addon = { kind: 'update', from: '0.3.0', to: '0.3.1' };
  const card = updateCard({ ...base, addon });
  assert.equal(card.question.split(panelOnCard(addon)).length, 2, 'named once');
  assert.deepEqual(card.options.map((o) => o.label), ['Update', 'Not now']);
});

test('the Update card with every line at once still composes', () => {
  const card = updateCard({
    from: 'v0.3.0', to: 'v0.3.1', says: 'A short summary of the release.', approval: 'card', locked: true, others: ['alpha', 'beta'],
    account: { from: 'v0.2.9', to: 'v0.3.1' }, removes: ['superpowers'], addon: { kind: 'update', from: '0.3.0', to: '0.3.1' }, hash: 'a'.repeat(64),
  });
  assert.match(card.question, /Wheelhouse panel in VS Code goes from 0\.3\.0 to 0\.3\.1/);
  assert.match(card.question, /Locked on this computer/);
});

test('the plan names the panel only when the card the director clicked did', () => withHome(async () => {
  const journal = openJournal('proj');
  assert.equal(planNamedAddon(journal), null, 'no plan, no install');
  fs.mkdirSync(journal.folder, { recursive: true });
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1' } }));
  assert.equal(planNamedAddon(journal), null);
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1', addon: true } }));
  assert.equal(planNamedAddon(journal), null, 'the old removal flag names nothing');
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1', addon: { kind: 'install', to: '0.3.1' } } }));
  assert.equal(planNamedAddon(journal), null, 'a first install is never named by the update\'s plan');
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1', addon: { kind: 'update', from: '0.3.0', to: '0.3.1' } } }));
  assert.deepEqual(planNamedAddon(journal), { kind: 'update', from: '0.3.0', to: '0.3.1' });
}));

test('finish: the last line carries what the panel step says, and it runs after the hand-over', () => withHome(async () => {
  const journal = openJournal('proj');
  journal.mark('checks', 'done', { tag: 'v0.3.1' });
  journal.mark('finish', 'running');
  const seen = [];
  const got = await finish({
    ...finishOptions(),
    journal,
    addon: async (given) => { seen.push(['addon', given.newRoot]); return { done: true, lines: ['The Wheelhouse panel is installed in VS Code. Reload VS Code to start it.'] }; },
    agentHooks: () => { seen.push(['hooks']); return []; },
  });
  assert.equal(got.ok, true, got.line);
  assert.deepEqual(seen.map((s) => s[0]), ['addon', 'hooks']);
  assert.equal(seen[0][1], finishOptions().newRoot, 'the step is given the new release\'s folder');
  assert.match(got.line, /panel is installed/);
}));

test('finish: a plan that named the panel installs it from the new folder once; a release with no package for it says so and the update still finishes', () => withHome(async () => {
  const journal = openJournal('proj');
  journal.mark('checks', 'done', { tag: 'v0.3.1' });
  journal.mark('finish', 'running');
  fs.mkdirSync(journal.folder, { recursive: true });
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1', addon: { kind: 'update', from: '0.3.0', to: '0.3.1' } } }));
  // The new folder carries no plugin version, so there is nothing to pack, whether or not the packing files are in the tree.
  const got = await finish({ ...finishOptions(), journal, agentHooks: () => [] });
  assert.equal(got.ok, true, got.line);
  assert.match(got.line, /panel's package isn't in this release/);
  const progress = JSON.parse(fs.readFileSync(path.join(journal.folder, 'finish.json'), 'utf8'));
  assert.equal(progress.addon.ok, false);
}));
