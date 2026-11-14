// tests/scripts/update/addon.test.js
// What the update says about the VS Code add-on parked in the core cut: one left on this computer is a line on the
// Update card, and is removed only after the director's click on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addonInstalled, removeAddon, planNamedAddon, ADDON_ID, ADDON_ON_CARD } from '../../../scripts/update/addon.js';
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

const runOf = (calls, { listing = `ms-python.python\n${ADDON_ID}\n`, code = 0 } = {}) => async (file, args) => {
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

test('the add-on is found when VS Code lists it, and not found when it does not, or cannot be asked', async () => {
  const calls = [];
  assert.equal(await addonInstalled({ run: runOf(calls), platform: 'darwin', env: env() }), true);
  assert.equal(await addonInstalled({ run: runOf([], { listing: 'ms-python.python\n' }), platform: 'darwin', env: env() }), false);
  assert.equal(await addonInstalled({ run: runOf([], { code: 1 }), platform: 'darwin', env: env() }), null);
  assert.deepEqual(calls[0].slice(1), ['--list-extensions']);
});

test('the Update card carries one line about the add-on only when one is installed', () => {
  const base = { from: 'v0.3.0', to: 'v0.3.1', says: 'x', hash: 'a'.repeat(64) };
  assert.ok(!updateCard(base).question.includes(ADDON_ON_CARD));
  const withIt = updateCard({ ...base, addon: true });
  assert.equal(withIt.question.split(ADDON_ON_CARD).length, 2, 'named once');
  assert.deepEqual(withIt.options.map((o) => o.label), ['Update', 'Not now']);
});

test('the removal runs VS Code\'s own uninstall for the add-on, once, and keeps its record', async () => {
  const calls = [];
  const progress = {};
  const got = await removeAddon({ run: runOf(calls), platform: 'darwin', env: env(), progress, save: () => {}, now: () => new Date('2026-11-07T09:00:00Z') });
  assert.equal(got.done, true);
  assert.deepEqual(calls.map((c) => c.slice(1)), [['--list-extensions'], ['--uninstall-extension', ADDON_ID]]);
  assert.equal(progress.addon.removed, true);
  const again = await removeAddon({ run: runOf(calls), platform: 'darwin', env: env(), progress, save: () => {} });
  assert.equal(again.done, true);
  assert.equal(calls.length, 2, 'a second run asks and removes nothing');
});

test('an add-on already gone, or VS Code that cannot be asked, is no work', async () => {
  const calls = [];
  const progress = {};
  const got = await removeAddon({ run: runOf(calls, { listing: '' }), platform: 'darwin', env: env(), progress, save: () => {} });
  assert.equal(got.done, true);
  assert.deepEqual(calls.map((c) => c[1]), ['--list-extensions']);
  assert.equal(progress.addon.removed, false);
});

test('a refused removal says how to do it by hand and is not tried again', async () => {
  const calls = [];
  const progress = {};
  const run = async (file, args) => { calls.push(args[0]); return args[0] === '--list-extensions' ? { code: 0, stdout: `${ADDON_ID}\n` } : { code: 1, stdout: '' }; };
  const got = await removeAddon({ run, platform: 'darwin', env: env(), progress, save: () => {} });
  assert.equal(got.done, true);
  assert.match(got.lines.join(' '), /by hand/);
  await removeAddon({ run, platform: 'darwin', env: env(), progress, save: () => {} });
  assert.deepEqual(calls, ['--list-extensions', '--uninstall-extension']);
});

test('the plan names the add-on only when the card the director clicked did', () => withHome(async () => {
  const journal = openJournal('proj');
  assert.equal(planNamedAddon(journal), false, 'no plan, no removal');
  fs.mkdirSync(journal.folder, { recursive: true });
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1' } }));
  assert.equal(planNamedAddon(journal), false);
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1', addon: true } }));
  assert.equal(planNamedAddon(journal), true);
}));

test('finish: the last line carries what the add-on step says, and it runs after the hand-over', () => withHome(async () => {
  const journal = openJournal('proj');
  journal.mark('checks', 'done', { tag: 'v0.3.1' });
  journal.mark('finish', 'running');
  const seen = [];
  const got = await finish({
    ...finishOptions(),
    journal,
    addon: async () => { seen.push('addon'); return { done: true, lines: ['The VS Code add-on was removed.'] }; },
  });
  assert.equal(got.ok, true, got.line);
  assert.deepEqual(seen, ['addon']);
  assert.match(got.line, /add-on was removed/);
}));
