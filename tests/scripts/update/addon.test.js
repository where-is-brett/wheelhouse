// tests/scripts/update/addon.test.js
// What setup and the update command offer about the Wheelhouse panel for VS Code: nothing for the same version, "Install the panel"
// where it is not there, "Update the panel" where it is older, and no offer where VS Code can't be found. The Update card names
// it once, and only the director's click on that card installs it, in the finish step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addonOffer, panelVersionIn, panelOnCard, planNamedAddon, vscodeHere, ADDON_ID } from '../../../scripts/update/addon.js';
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
const offer = (opts) => addonOffer({ platform: 'darwin', env: env(), present: () => false, ...opts });

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

test('no panel in VS Code is offered as an install', async () => {
  assert.deepEqual(await offer({ run: runOf([], { listing: 'ms-python.python@2024.1.0\n' }), pluginVersion: '0.3.1' }), { kind: 'install', to: '0.3.1' });
});

test('with no code to ask, the offer comes only where VS Code is on this computer', async () => {
  const none = async () => { throw new Error('spawn code ENOENT'); };
  assert.equal(await offer({ run: none, pluginVersion: '0.3.1', present: () => false }), null);
  assert.deepEqual(await offer({ run: none, pluginVersion: '0.3.1', present: () => true }), { kind: 'install', to: '0.3.1' });
  assert.deepEqual(await offer({ run: runOf([], { code: 1 }), pluginVersion: '0.3.1', present: () => true }), { kind: 'install', to: '0.3.1' });
  assert.equal(await addonOffer({ run: none, platform: 'win32', env: { Path: 'C:\\nowhere' }, pluginVersion: '0.3.1', present: () => false }), null, 'Windows with no code.cmd');
  assert.equal(await offer({ run: runOf([]), pluginVersion: '' }), null, 'no release version, no offer');
});

test('VS Code is found where it installs by default', () => {
  assert.equal(vscodeHere({ platform: 'darwin', home: '/Users/p', exists: (f) => f === '/Applications/Visual Studio Code.app' }), true);
  assert.equal(vscodeHere({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' }, exists: (f) => f.endsWith('Microsoft VS Code') }), true);
  assert.equal(vscodeHere({ platform: 'darwin', home: '/Users/p', exists: () => false }), false);
  assert.equal(vscodeHere({ platform: 'darwin', exists: () => { throw new Error('x'); } }), false);
});

test('the Update card carries one line about the panel only when one is offered', () => {
  const base = { from: 'v0.3.0', to: 'v0.3.1', says: 'x', hash: 'a'.repeat(64) };
  assert.ok(!updateCard(base).question.includes('Wheelhouse panel'));
  for (const addon of [{ kind: 'install', to: '0.3.1' }, { kind: 'update', from: '0.3.0', to: '0.3.1' }]) {
    const card = updateCard({ ...base, addon });
    assert.equal(card.question.split(panelOnCard(addon)).length, 2, 'named once');
    assert.deepEqual(card.options.map((o) => o.label), ['Update', 'Not now']);
  }
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
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1', addon: { kind: 'install', to: '0.3.1' } } }));
  // The new folder carries no plugin version, so there is nothing to pack, whether or not the packing files are in the tree.
  const got = await finish({ ...finishOptions(), journal, agentHooks: () => [] });
  assert.equal(got.ok, true, got.line);
  assert.match(got.line, /panel's package isn't in this release/);
  const progress = JSON.parse(fs.readFileSync(path.join(journal.folder, 'finish.json'), 'utf8'));
  assert.equal(progress.addon.ok, false);
}));
