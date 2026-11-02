// tests/vscode/activate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../helpers/homes.js';
import { require, model, card, fakeVscode, fakeView, memory } from './helpers.js';

const { activate } = require('../../vscode/extension.cjs');
const { startHelperIfNeeded } = require('../../vscode/desk.cjs');

const two = model({ cards: [card(), card({ id: 'c2', n: 2 })] });

// An add-on started on stand-ins, with the desk answering `answers` in turn (the last one repeating).
async function started({ answers = [two], moves = true, state = memory(), more = {}, setup } = {}) {
  const vscode = fakeVscode();
  setup?.(vscode);
  const context = { subscriptions: [], globalState: state, extensionPath: '/ext' };
  let reads = 0;
  const desk = {
    read: async () => { const a = answers[Math.min(reads, answers.length - 1)]; reads += 1; return a === null ? { ok: false, refused: 'the host helper could not be reached', away: true } : { ok: true, data: { pane: a } }; },
    watch: async () => ({ ok: true, cursor: 'k1', changes: [] }),
    act: async () => ({ ok: true }),
  };
  const add = await activate(context, { vscode, deps: { desk, ask: async () => true, node: '/usr/bin/node', loop: false, startHelper: async () => {}, versions: async () => {}, nonceBytes: 32, ...more } });
  return { vscode, context, add, desk, state };
}

test('the status bar counts needs-you items', async () => {
  const { vscode, add } = await started();
  await add.refresh();
  const item = vscode.seen.items[0];
  assert.equal(item.text, 'Wheelhouse · 2 need you');
  assert.equal(item.command, 'wheelhouse.openPane');
  assert.equal(item.shown, true);
});

test('the add-on registers its one command and its pane', async () => {
  const { vscode } = await started();
  assert.deepEqual([...vscode.seen.commands.keys()], ['wheelhouse.openPane']);
  assert.ok(vscode.seen.providers.has('wheelhouse.pane'));
});

test('the first-run offer shows once', async () => {
  const state = memory();
  const first = await started({ state });
  assert.equal(first.vscode.seen.info.length, 1);
  assert.ok(String(first.vscode.seen.info[0][0]).includes('Put Wheelhouse on the right'));
  const second = await started({ state });
  assert.equal(second.vscode.seen.info.length, 0);
});

test('the helper is started when it doesn\'t answer', async () => {
  const spawned = [];
  await startHelperIfNeeded({ ask: async () => false, node: '/usr/bin/node', root: '/ext/wheelhouse', spawn: (...args) => { spawned.push(args); return { unref() {} }; } });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], '/usr/bin/node');
  assert.deepEqual(spawned[0][1].slice(1), ['start']);
  assert.match(spawned[0][1][0], /scripts[\\/]agents[\\/]copilot[\\/]start-helper\.js$/);
});

test('the helper is left alone when it answers, and when no Node.js runs', async () => {
  const spawned = [];
  const spawn = (...args) => { spawned.push(args); return { unref() {} }; };
  await startHelperIfNeeded({ ask: async () => true, node: '/usr/bin/node', root: '/r', spawn });
  await startHelperIfNeeded({ ask: async () => false, node: null, root: '/r', spawn });
  assert.equal(spawned.length, 0);
});

test('the pane says so when nothing answers, and shows the last view it read', async () => {
  const { vscode, add } = await started({ answers: [model({ cards: [card({ text: 'The last card.', parts: null })] }), null] });
  const view = fakeView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  await add.refresh();
  assert.ok(view.html.includes('The last card.'));
  await add.refresh();
  assert.ok(view.html.includes('helper isn&#39;t running'));
  assert.ok(view.html.includes('The last card.'));
});

test('the pane says so when nothing has ever answered', async () => {
  const { vscode, add } = await started({ answers: [null] });
  const view = fakeView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  await add.refresh();
  assert.ok(view.html.includes('helper isn&#39;t running'));
});

test('opening the pane focuses it', async () => {
  const { vscode } = await started();
  await vscode.seen.commands.get('wheelhouse.openPane')();
  assert.ok(vscode.seen.executed.some(([id]) => id === 'wheelhouse.pane.focus'));
});

test('the add-on records VS Code\'s versions at start, and again when its add-ons change', async () => {
  const dir = tempFolder('wh-activate-');
  const file = path.join(dir, 'agents', 'copilot-versions.json');
  let changed;
  const { vscode } = await started({
    more: { versions: undefined, versionsFile: file },
    setup: (v) => { v.extensions = { getExtension: () => ({ packageJSON: { version: '0.31.2' } }), onDidChange: (fn) => { changed = fn; return { dispose() {} }; } }; },
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { vscode: '1.105.0', runtime: '0.31.2' });
  vscode.extensions.getExtension = () => ({ packageJSON: { version: '0.32.0' } });
  await changed();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).runtime, '0.32.0');
});
