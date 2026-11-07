// tests/scripts/update/parked-and-addon.test.js
// The two things the update says about pieces parked in the core cut: a VS Code add-on left on this computer (a line on the
// Update card, removed only after the director's click on it) and a project whose configuration still names a parked agent
// (one card, asked once per project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addonInstalled, removeAddon, planNamedAddon, ADDON_ID, ADDON_ON_CARD } from '../../../scripts/update/addon.js';
import { raiseParked, parkedAsked, parkedCard, PARKED_AGENT_CARD } from '../../../scripts/update/parked.js';
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

test('the parked agent card names the agent, offers Claude Code and changes no configuration', () => {
  const card = parkedCard({ agent: 'copilot', name: 'tide-tables' });
  assert.equal(card.card.kind, 'question');
  assert.match(card.question.question, /tide-tables/);
  assert.match(card.question.question, /Copilot/);
  assert.equal(card.question.options[0].label, PARKED_AGENT_CARD.carryOn);
  assert.equal(card.question.options.length, 2);
});

test('a project naming a parked agent gets one card, and a second run of the update asks nothing', () => withHome(async () => {
  const writes = [];
  const client = { state: { write: async (body) => { writes.push(body); return { ok: true }; } } };
  const folder = tempFolder('wh-parked-');
  const config = path.join(folder, '.claude', 'wheelhouse.json');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const text = JSON.stringify({ agents: { c1: 'copilot' } });
  fs.writeFileSync(config, text);
  const given = { project: 'o__p', folder, client, parked: () => 'copilot', now: () => new Date('2026-11-07T09:00:00Z') };
  const first = await raiseParked({ ...given, progress: {}, save: () => {} });
  assert.equal(first.done, true);
  assert.equal(writes.filter((w) => w.kind === 'card').length, 1);
  assert.deepEqual(parkedAsked('o__p'), { copilot: '2026-11-07T09:00:00.000Z' });
  const second = await raiseParked({ ...given, progress: {}, save: () => {} });
  assert.equal(second.done, true);
  assert.equal(writes.length, 1, 'not asked again on a later update');
  assert.equal(fs.readFileSync(config, 'utf8'), text, 'the configuration is as it was');
}));

test('a project with no parked agent, or a card the state would not take, leaves nothing recorded', () => withHome(async () => {
  const folder = tempFolder('wh-parked-');
  const none = await raiseParked({ project: 'o__p', folder, client: { state: { write: async () => { throw new Error('no'); } } }, parked: () => null, progress: {}, save: () => {} });
  assert.equal(none.done, true);
  const refusing = { state: { write: async () => ({ ok: false, refused: 'busy' }) } };
  const got = await raiseParked({ project: 'o__p', folder, client: refusing, parked: () => 'copilot', progress: {}, save: () => {} });
  assert.equal(got.done, false);
  assert.deepEqual(parkedAsked('o__p'), {}, 'asked again at the next update');
}));

test('the plan names the add-on only when the card the director clicked did', () => withHome(async () => {
  const journal = openJournal('proj');
  assert.equal(planNamedAddon(journal), false, 'no plan, no removal');
  fs.mkdirSync(journal.folder, { recursive: true });
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1' } }));
  assert.equal(planNamedAddon(journal), false);
  fs.writeFileSync(path.join(journal.folder, 'plan.json'), JSON.stringify({ plan: { to: 'v0.3.1', addon: true } }));
  assert.equal(planNamedAddon(journal), true);
}));

test('finish: the last line carries what the add-on and the parked agent steps say, and both run after the hand-over', () => withHome(async () => {
  const journal = openJournal('proj');
  journal.mark('checks', 'done', { tag: 'v0.3.1' });
  journal.mark('finish', 'running');
  const seen = [];
  const got = await finish({
    ...finishOptions(),
    journal,
    addon: async () => { seen.push('addon'); return { done: true, lines: ['The VS Code add-on was removed.'] }; },
    parked: async () => { seen.push('parked'); return { done: true, lines: ['copilot is parked.'] }; },
  });
  assert.equal(got.ok, true, got.line);
  assert.deepEqual(seen, ['addon', 'parked']);
  assert.match(got.line, /add-on was removed/);
}));
