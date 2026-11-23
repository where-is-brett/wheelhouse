// tests/vscode/activate.test.js
// What activating the add-on registers: one view, one command and a status bar item; nothing that could press.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeVscode, fakeContext, fakeDesk, fakeEvery, start, require } from './helpers.js';

const ext = require('../../vscode/extension.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../vscode/package.json'), 'utf8'));

test('it registers exactly one command, one view and a status bar item', async () => {
  const { vscode } = await start();
  assert.deepEqual([...vscode.seen.commands.keys()], ['wheelhouse.openPanel']);
  assert.deepEqual([...vscode.seen.providers.keys()], ['wheelhouse.panel']);
  assert.equal(vscode.seen.items.length, 1);
  assert.equal(vscode.seen.items[0].command, 'wheelhouse.openPanel');
  assert.equal(vscode.seen.providerOptions.get('wheelhouse.panel').webviewOptions.retainContextWhenHidden, false);
  await vscode.seen.commands.get('wheelhouse.openPanel')();
  assert.deepEqual(vscode.seen.executed, [['wheelhouse.panel.focus']]);
});

test('the package contributes one command and nothing that reaches an act', () => {
  assert.deepEqual(manifest.contributes.commands.map((c) => c.command), ['wheelhouse.openPanel']);
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, false);
  for (const name of ['uriHandler', 'api', 'languageModelTools', 'chatParticipants']) {
    assert.equal(name in manifest || name in manifest.contributes, false, name);
  }
  assert.deepEqual(manifest.contributes.views.wheelhouse.map((v) => v.id), ['wheelhouse.panel']);
});

test('activate returns nothing to other extensions', async () => {
  const vscode = fakeVscode();
  const got = await ext.activate(fakeContext(), { vscode, deps: { desk: fakeDesk(), project: () => 'p', every: fakeEvery() } });
  assert.equal(got, undefined);
});

test('the webview is given no local resources and runs scripts under the nonce', async () => {
  const { view } = await start();
  assert.deepEqual(view.webview.options, { enableScripts: true, localResourceRoots: [] });
});
