// tests/scripts/addon/validate.test.js
// The add-on's guard: the package contributes one command and nothing that reaches an act, and only the panel's
// message handler, through vscode/press.cjs, calls the desk's act.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkAddon, readAddon, codeOf } from '../../../scripts/addon/validate.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const built = () => readAddon(root);
const withPkg = (change) => { const add = built(); change(add.pkg); return checkAddon(add); };
const withSource = (file, change) => { const add = built(); add.sources[file] = change(add.sources[file]); return checkAddon(add); };

test('the built add-on passes', () => {
  assert.deepEqual(checkAddon(built()), []);
});

test('a package with a second command fails', () => {
  const problems = withPkg((pkg) => pkg.contributes.commands.push({ command: 'wheelhouse.approve', title: 'Approve' }));
  assert.match(problems.join('\n'), /wheelhouse\.approve/);
});

test('a keybinding or menu to another command fails', () => {
  assert.match(withPkg((pkg) => { pkg.contributes.keybindings = [{ command: 'wheelhouse.x', key: 'ctrl+k' }]; }).join('\n'), /keybindings/);
  assert.match(withPkg((pkg) => { pkg.contributes.menus = { 'view/title': [{ command: 'wheelhouse.x' }] }; }).join('\n'), /menus/);
});

test('a package that registers a language-model tool, chat participant or URI activation fails', () => {
  assert.match(withPkg((pkg) => { pkg.contributes.languageModelTools = [{ name: 'wheelhouse_record' }]; }).join('\n'), /languageModelTools/);
  assert.match(withPkg((pkg) => { pkg.contributes.chatParticipants = [{ id: 'wh' }]; }).join('\n'), /chatParticipants/);
  assert.match(withPkg((pkg) => { pkg.activationEvents = ['onUri']; }).join('\n'), /onUri/);
  assert.match(withPkg((pkg) => { pkg.activationEvents = ['onCommand:wheelhouse.approve']; }).join('\n'), /onCommand/);
});

test('a package that runs in an untrusted folder, or in the UI side, fails', () => {
  assert.match(withPkg((pkg) => { pkg.capabilities.untrustedWorkspaces.supported = true; }).join('\n'), /untrustedWorkspaces/);
  assert.match(withPkg((pkg) => { pkg.extensionKind = ['ui']; }).join('\n'), /extensionKind/);
});

test('code that registers a language-model tool or a chat participant fails', () => {
  const add = (line) => withSource('vscode/extension.cjs', (s) => `${s}\n${line}\n`).join('\n');
  assert.match(add('vscode.lm.registerTool("x", {});'), /registerTool/);
  assert.match(add('vscode.chat.createChatParticipant("x", () => {});'), /createChatParticipant/);
  assert.match(add('vscode.window.registerUriHandler({});'), /registerUriHandler/);
  assert.match(add('vscode.commands.registerCommand("wheelhouse.approve", () => {});'), /registerCommand/);
  assert.match(add('vscode.commands.executeCommand("workbench.action.chat.open");'), /executeCommand/);
});

test('a call to act outside press.cjs fails', () => {
  assert.match(withSource('vscode/extension.cjs', (s) => `${s}\ndesk.act('all-stop', {});\n`).join('\n'), /extension\.cjs: a call to the desk's act/);
  assert.match(withSource('vscode/extension.cjs', (s) => `${s}\ndesk.answer('c', 'o', 'h');\n`).join('\n'), /answer/);
  assert.match(withSource('vscode/extension.cjs', (s) => `${s}\ndesk['act']('all-stop');\n`).join('\n'), /computed/);
  const add = built();
  add.sources['vscode/other.cjs'] = 'module.exports = (d) => d.act("x", {});';
  assert.match(checkAddon(add).join('\n'), /other\.cjs: a call to the desk's act/);
});

test('a comment that mentions act does not fail', () => {
  assert.deepEqual(withSource('vscode/extension.cjs', (s) => `${s}\n// desk.act('x') is only in press.cjs\n`), []);
  assert.equal(codeOf('a // b\nc').includes('b'), false);
});

test('press that does not check the nonce first fails', () => {
  const problems = withSource('vscode/press.cjs', (s) => s.replace('if (!sameNonce(own(message, \'nonce\'), latestNonce)) return dropped();', ''));
  assert.match(problems.join('\n'), /must check the nonce/);
  const late = withSource('vscode/press.cjs', (s) => s.replace('async function press(message, { latestNonce, client, waiting, app } = {}) {', 'async function press(message, { latestNonce, client, waiting, app } = {}) {\n  void client;'));
  assert.match(late.join('\n'), /before it checks the nonce/);
});

test('a message handler that does not go to press fails', () => {
  const problems = withSource('vscode/extension.cjs', (s) => s.replace('view.webview.onDidReceiveMessage?.((message) => onPaneMessage(message));', 'view.webview.onDidReceiveMessage?.((message) => console.log(message));'));
  assert.match(problems.join('\n'), /onDidReceiveMessage must hand every message/);
  const bypass = withSource('vscode/extension.cjs', (s) => s.replace('const out = await press(message,', 'const out = await press(null,'));
  assert.match(bypass.join('\n'), /hand its message to press/);
});

test('press called outside the message handler fails', () => {
  assert.match(withSource('vscode/extension.cjs', (s) => `${s}\npress({}, {});\n`).join('\n'), /press is called outside onPaneMessage/);
});

test('activate returning something other extensions could read fails', () => {
  const problems = withSource('vscode/extension.cjs', (s) => s.replace(/return deps\.expose \? \{[^}]*\} : undefined;/, 'return { model, press };'));
  assert.match(problems.join('\n'), /activate must end/);
});

test('a package that is not an object, or sources that are missing, fail without throwing', () => {
  assert.equal(checkAddon().length, 1);
  assert.equal(checkAddon({ pkg: {} }).length > 0, true);
});
