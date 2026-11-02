// tests/scripts/addon/validate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAddon, readAddon } from '../../../scripts/addon/validate.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const PKG = {
  name: 'wheelhouse',
  extensionKind: ['workspace'],
  activationEvents: ['onStartupFinished'],
  contributes: { commands: [{ command: 'wheelhouse.openPane', title: 'Wheelhouse: Open the pane' }] },
};

// A source that opens the pane and takes the pane's messages, the way the add-on does.
const GOOD = `
const vscode = require('vscode');
async function onPaneMessage(msg, deps) {
  if (!deps.nonce.matches(msg?.nonce)) return { made: false };
  const { pressCard } = deps.press;
  return pressCard({ card: msg.card });
}
function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('wheelhouse.openPane', () => {}));
  view.webview.onDidReceiveMessage((msg) => onPaneMessage(msg, deps));
}
module.exports = { activate, onPaneMessage };
`;

const check = (over = {}) => checkAddon({ pkg: 'pkg' in over ? over.pkg : PKG, sources: { 'vscode/extension.cjs': over.source ?? GOOD, ...(over.more ?? {}) } });
const has = (problems, word) => problems.some((p) => p.includes(word));

test('the add-on as the tests describe it passes', () => {
  assert.deepEqual(check(), []);
});

test('a command other than wheelhouse.openPane in the manifest is a problem', () => {
  const pkg = { ...PKG, contributes: { commands: [...PKG.contributes.commands, { command: 'wheelhouse.approve', title: 'Approve' }] } };
  assert.ok(has(check({ pkg }), 'wheelhouse.approve'));
});

test('a keybinding for another command is a problem', () => {
  const pkg = { ...PKG, contributes: { ...PKG.contributes, keybindings: [{ command: 'wheelhouse.approve', key: 'ctrl+y' }] } };
  assert.ok(has(check({ pkg }), 'wheelhouse.approve'));
});

test('a URI activation event is a problem', () => {
  assert.ok(has(check({ pkg: { ...PKG, activationEvents: ['onUri'] } }), 'onUri'));
});

test('a URI handler in the source is a problem', () => {
  assert.ok(has(check({ source: `${GOOD}\nvscode.window.registerUriHandler({ handleUri() {} });` }), 'registerUriHandler'));
});

test('an activation on another command is a problem', () => {
  assert.ok(has(check({ pkg: { ...PKG, activationEvents: ['onCommand:wheelhouse.approve'] } }), 'onCommand'));
});

test('registering any other command id is a problem', () => {
  const source = `${GOOD}\nvscode.commands.registerCommand('wheelhouse.approve', () => {});`;
  assert.ok(has(check({ source }), 'registerCommand'));
});

test('a command id that is not a plain string is a problem', () => {
  const source = `${GOOD}\nvscode.commands.registerCommand(id, () => {});`;
  assert.ok(has(check({ source }), 'registerCommand'));
});

test('a text editor command is a problem', () => {
  const source = `${GOOD}\nvscode.commands.registerTextEditorCommand('wheelhouse.openPane', () => {});`;
  assert.ok(has(check({ source }), 'registerTextEditorCommand'));
});

test('a press called outside onPaneMessage is a problem, each of the four', () => {
  for (const name of ['pressCard', 'pressSetting', 'signedRecords', 'keepEarned']) {
    const source = `${GOOD}\nfunction later(deps) { return deps.press.${name}({}); }`;
    assert.ok(has(check({ source }), name), name);
  }
});

test('a chat tool whose handler reaches a press is a problem', () => {
  const source = `${GOOD}\nvscode.lm.registerTool('wheelhouse_press', { invoke: async (options) => pressCard(options.input) });`;
  assert.ok(has(check({ source }), 'pressCard'));
});

test('a chat participant whose handler reaches onPaneMessage is a problem', () => {
  const source = `${GOOD}\nvscode.chat.createChatParticipant('wheelhouse.chat', async (request) => onPaneMessage(request, deps));`;
  assert.ok(has(check({ source }), 'onPaneMessage'));
});

test('a chat tool that reaches no press is not a problem', () => {
  const source = `${GOOD}\nvscode.lm.registerTool('wheelhouse_read', { invoke: async () => ({}) });`;
  assert.deepEqual(check({ source }), []);
});

test('a second file may not call a press either', () => {
  const problems = check({ more: { 'vscode/other.cjs': 'module.exports = (deps) => deps.keepEarned({});' } });
  assert.ok(has(problems, 'keepEarned'));
  assert.ok(has(problems, 'vscode/other.cjs'));
});

test('a message handler that is not onPaneMessage is a problem', () => {
  const source = `${GOOD}\nother.webview.onDidReceiveMessage((msg) => doThings(msg));`;
  assert.ok(has(check({ source }), 'onDidReceiveMessage'));
});

test('an onPaneMessage that does not check the nonce first is a problem', () => {
  const source = GOOD.replace("if (!deps.nonce.matches(msg?.nonce)) return { made: false };\n", '');
  assert.ok(has(check({ source }), 'nonce'));
});

test('an onPaneMessage that presses before it checks the nonce is a problem', () => {
  const source = GOOD.replace('  if (!deps.nonce.matches(msg?.nonce)) return { made: false };\n  const { pressCard } = deps.press;\n  return pressCard({ card: msg.card });',
    '  const { pressCard } = deps.press;\n  pressCard({ card: msg.card });\n  if (!deps.nonce.matches(msg?.nonce)) return { made: false };');
  assert.ok(has(check({ source }), 'nonce'));
});

test('a press named only in a comment is not a problem', () => {
  assert.deepEqual(check({ source: `// pressCard and keepEarned are called in onPaneMessage alone\n/* signedRecords too */\n${GOOD}` }), []);
});

test('eval and a built function are problems', () => {
  assert.ok(has(check({ source: `${GOOD}\neval('1');` }), 'eval'));
  assert.ok(has(check({ source: `${GOOD}\nnew Function('return 1');` }), 'Function'));
});

test('another kind of extension, a dependency or a pack is a problem', () => {
  assert.ok(has(check({ pkg: { ...PKG, extensionKind: ['ui'] } }), 'extensionKind'));
  assert.ok(has(check({ pkg: { ...PKG, extensionKind: undefined } }), 'extensionKind'));
  assert.ok(has(check({ pkg: { ...PKG, extensionDependencies: ['github.copilot'] } }), 'extensionDependencies'));
  assert.ok(has(check({ pkg: { ...PKG, extensionPack: ['github.copilot'] } }), 'extensionPack'));
});

test('a manifest that is not an object is a problem, and a check never throws', () => {
  assert.ok(check({ pkg: null }).length > 0);
  assert.ok(checkAddon({}).length > 0);
});

test('the add-on in this repository passes', () => {
  const found = readAddon(ROOT);
  assert.ok(Object.keys(found.sources).length > 0);
  assert.deepEqual(checkAddon(found), []);
});

test('the add-on lists its one command in its manifest and in its source', () => {
  const found = readAddon(ROOT);
  assert.deepEqual(found.pkg.contributes.commands.map((c) => c.command), ['wheelhouse.openPane']);
  assert.ok(fs.existsSync(path.join(ROOT, 'vscode', found.pkg.contributes.viewsContainers.activitybar[0].icon)));
});

test('the add-on may take onPaneMessage in from its own file, by name alone', () => {
  const taken = 'const { onPaneMessage } = require(\'./press.cjs\');\nview.webview.onDidReceiveMessage((msg) => onPaneMessage(msg, deps));';
  assert.deepEqual(checkAddon({ pkg: PKG, sources: { 'vscode/extension.cjs': taken, 'vscode/press.cjs': GOOD } }), []);
  // Taking it in by name does not let a tool use it.
  const tool = `${taken}\nvscode.lm.registerTool('t', { invoke: async (o) => onPaneMessage(o, deps) });`;
  assert.ok(has(checkAddon({ pkg: PKG, sources: { 'vscode/extension.cjs': tool, 'vscode/press.cjs': GOOD } }), 'onPaneMessage'));
});
