// tests/vscode/activate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../helpers/homes.js';
import { PANE_LABELS } from '../../scripts/desk/pane-labels.js';
import { require, model, card, fakeVscode, fakeView, memory } from './helpers.js';

const { activate } = require('../../vscode/extension.cjs');
const { startHelperIfNeeded } = require('../../vscode/desk.cjs');
require('../../vscode/pane/render.js').setLabels(PANE_LABELS);

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
  const add = await activate(context, { vscode, deps: { desk, ask: async () => true, node: '/usr/bin/node', loop: false, expose: true, startHelper: async () => {}, versions: async () => {}, nonceBytes: 32, ...more } });
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

test('where no Node.js runs the Lean helper is asked for once, and stopped when the add-on is', async () => {
  const asked = [];
  const stopped = [];
  const startLean = async (o) => { asked.push(o); return { mode: 'helper', stop: async () => { stopped.push(1); } }; };
  const { context } = await started({ more: { node: null, startLean, isLean: true, address: '/x/helper.sock' } });
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].address, asked[0].isLean, asked[0].node], ['/x/helper.sock', true, null]);
  for (const s of context.subscriptions) s.dispose?.();
  assert.deepEqual(stopped, [1]);
  // With a Node.js on the computer the usual start serves, and this is not asked.
  const withNode = await started({ more: { node: '/usr/bin/node', startLean } });
  assert.equal(asked.length, 1);
  assert.equal(withNode.context.subscriptions.length > 0, true);
});

// The panel mark and the trust guards (spec section 6).
const vscodePane = await import('../../scripts/lib/vscode-pane.js');
const nonceOf = (html) => /data-nonce="([0-9a-f]+)"/.exec(html)?.[1];

// A view whose visibility a test can change.
function visibleView() {
  const view = fakeView();
  const listeners = [];
  view.onDidChangeVisibility = (fn) => { listeners.push(fn); return { dispose() {} }; };
  view.setVisible = (value) => { view.visible = value; for (const fn of listeners) fn(); };
  return view;
}

// A press function that records its calls.
const pressing = (calls) => ({ pressCard: async (a) => { calls.push(a); return { made: true, says: 'Recorded.' }; } });
const pressMessage = (nonce) => ({ nonce, type: 'press', card: 'c1', hash: 'abc123def456', choice: 'Approve' });

test('the webview loads no files, and no context is retained', async () => {
  const registered = [];
  const { vscode } = await started({
    setup: (v) => {
      const register = v.window.registerWebviewViewProvider;
      v.window.registerWebviewViewProvider = (id, provider, options) => { registered.push(options); return register(id, provider, options); };
    },
  });
  assert.equal(registered.length, 1);
  assert.equal(registered[0]?.webviewOptions?.retainContextWhenHidden, undefined);
  const view = fakeView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  assert.deepEqual(view.webview.options, { enableScripts: true, localResourceRoots: [] });
});

test('a page drawn before the pane hid counts for nothing', async () => {
  const calls = [];
  const { vscode, add } = await started({ more: { project: 'p1', press: pressing(calls), stop: {}, vscodePane } });
  const view = visibleView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  await add.refresh();
  const old = nonceOf(view.html);
  assert.match(old, /^[0-9a-f]{64}$/);
  view.setVisible(false);
  view.setVisible(true);
  const fresh = nonceOf(view.html);
  assert.match(fresh, /^[0-9a-f]{64}$/);
  assert.notEqual(fresh, old);
  await view.send(pressMessage(old));
  assert.equal(calls.length, 0);
  await view.send(pressMessage(fresh));
  assert.equal(calls.length, 1);
});

test('no message counts while the pane is hidden', async () => {
  const calls = [];
  const { vscode, add } = await started({ more: { project: 'p1', press: pressing(calls), stop: {}, vscodePane } });
  const view = visibleView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  await add.refresh();
  const current = nonceOf(view.html);
  view.setVisible(false);
  await view.send(pressMessage(current));
  assert.equal(calls.length, 0);
});

test('the mark follows visibility', async () => {
  const { vscode, add } = await started({ more: { project: 'p1', vscodePane } });
  const view = visibleView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  await add.refresh();
  assert.equal(vscodePane.vscodePaneLive('p1', Date.now() + 1000), true);
  view.setVisible(false);
  await add.refresh();
  const mark = JSON.parse(fs.readFileSync(path.join(process.env.WHEELHOUSE_HOME, 'panes', 'vscode-p1.mark.json'), 'utf8'));
  assert.equal(mark.surface, 'vscode');
  assert.match(mark.window, /^[0-9a-f]{32}$/);
  // Hidden: the tick goes on but the sighting does not, so 46 seconds later it is not live.
  assert.equal(vscodePane.vscodePaneLive('p1', Date.now() + 46000), false);
  view.setVisible(true);
  assert.equal(vscodePane.vscodePaneLive('p1', Date.now() + 1000), true);
});

test('an unsafe project id writes no mark and does not throw', async () => {
  const { vscode, add } = await started({ more: { project: '../x', vscodePane } });
  const view = visibleView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  await add.refresh();
  assert.equal(vscodePane.vscodePaneLive('../x', Date.now()), false);
});

test('an untrusted folder draws no cards', async () => {
  const { vscode, add } = await started({ setup: (v) => { v.workspace.isTrusted = false; } });
  const view = fakeView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  await add.refresh();
  assert.ok(view.html.includes('Wheelhouse runs only in a folder you trust, since it signs your clicks with this computer&#39;s key.'));
  assert.deepEqual([...view.html.matchAll(/<button[^>]*>([^<]*)</g)].map((m) => m[1]), [PANE_LABELS.stop]);
});

test('a quiet visible pane stays live for a minute without a refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 5_000_000 });
  const { vscode, context } = await started({ more: { project: 'p1', vscodePane, loop: true } });
  const view = visibleView();
  await vscode.seen.providers.get('wheelhouse.pane').resolveWebviewView(view);
  t.mock.timers.tick(60_000);
  assert.equal(vscodePane.vscodePaneLive('p1', Date.now() + 1000), true);
  for (const s of context.subscriptions) s.dispose?.();
});
