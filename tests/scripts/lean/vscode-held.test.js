// tests/scripts/lean/vscode-held.test.js
// A Lean project has no configuration in its folder, only its Lean record, so a live VS Code panel holds its cards by what
// that record says the project's agent is (scripts/agents/vscode-held.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, shortHome } from '../../helpers/homes.js';
import { registerLean, updateLean } from '../../../scripts/lean/project.js';
import { markVscodePane } from '../../../scripts/lib/vscode-pane.js';
import { heldForVscode, vscodeAsk } from '../../../scripts/agents/vscode-held.js';

const NOW = Date.parse('2026-11-05T01:00:00.000Z');

async function leanComputer(agent) {
  const home = shortHome();
  const folder = path.join(home, 'work', 'shop');
  fs.mkdirSync(folder, { recursive: true });
  await as(home, () => {
    registerLean({ project: 'shop', folder, now: () => new Date(NOW) });
    if (agent !== undefined) updateLean('shop', { agent });
    markVscodePane('shop', { at: NOW, visible: NOW, window: 'w1' });
  });
  return { home, folder, as: (fn) => as(home, fn) };
}

test('a live panel holds the cards of a Lean project that runs Copilot', async () => {
  const c = await leanComputer('copilot');
  try {
    assert.equal(await c.as(() => heldForVscode({ project: 'shop', folder: c.folder }, NOW + 1000)), true);
    assert.deepEqual(await c.as(() => vscodeAsk({ project: 'shop', folder: c.folder, now: NOW + 1000 }, {})), { applies: true, held: true });
  } finally {
    fs.rmSync(c.home, { recursive: true, force: true });
  }
});

test('a Lean project that runs no VS Code agent is never held', async () => {
  const c = await leanComputer('claude-code');
  try {
    assert.equal(await c.as(() => heldForVscode({ project: 'shop', folder: c.folder }, NOW + 1000)), false);
  } finally {
    fs.rmSync(c.home, { recursive: true, force: true });
  }
});

test('a Lean project whose panel has gone quiet is not held', async () => {
  const c = await leanComputer('copilot');
  try {
    assert.equal(await c.as(() => heldForVscode({ project: 'shop', folder: c.folder }, NOW + 120000)), false);
  } finally {
    fs.rmSync(c.home, { recursive: true, force: true });
  }
});
