// tests/vscode/chat-tools.test.js
// The chat's way in: two tools that write nothing binding, the inbox where a company switches the tools off, the record of
// the chat's terminal commands, and the proof that no tool reaches a press. VS Code, the helper and the desk are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fakeVscode, model, card, require } from './helpers.js';
import { checkAddon, readAddon, ALLOWED_TOOLS } from '../../scripts/addon/validate.js';

const tools = require('../../vscode/chat-tools.cjs');
const { activate } = require('../../vscode/extension.cjs');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chat-tools-'));

// A VS Code that also holds the language-model tools and terminal events the add-on uses.
function chatVscode() {
  const vscode = fakeVscode();
  const registered = new Map();
  const terminal = [];
  vscode.lm = { registerTool: (name, tool) => { registered.set(name, tool); return { dispose() {} }; } };
  vscode.LanguageModelTextPart = class { constructor(value) { this.value = value; } };
  vscode.LanguageModelToolResult = class { constructor(content) { this.content = content; } };
  vscode.window.onDidStartTerminalShellExecution = (fn) => { terminal.push(fn); return { dispose() {} }; };
  return { vscode, registered, terminal };
}
const textOf = (result) => result.content.map((p) => p.value).join('');

// A client that records every call to it, and signs nothing.
function recorder() {
  const calls = [];
  const client = { cards: { chatClick: async (args) => { calls.push(args); return { ok: true, id: 'e1' }; } } };
  return { calls, client };
}

test('a chat tool\'s write is never binding', async () => {
  const { vscode, registered } = chatVscode();
  const { calls, client } = recorder();
  const folder = tmp();
  const desk = { read: async () => ({ ok: true, data: { pane: model({ cards: [card()] }) } }) };
  tools.registerChatTools({ vscode, client, desk, project: 'owner__name', folder, subscriptions: [] });
  assert.deepEqual([...registered.keys()].sort(), [...ALLOWED_TOOLS].sort());
  // Whatever the model asks for, the proof is chat-click and nothing else; no signature comes from here.
  const out = await registered.get('wheelhouse_record').invoke({ input: { card: 'c1', hash: 'abc123def456', label: 'Approve', proof: 'add-on', form: 'signed' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].proof, 'chat-click');
  assert.equal(calls[0].project, 'owner__name');
  assert.ok(!('records' in calls[0]) && !('signature' in calls[0]));
  assert.match(textOf(out), /chat/i);
  // The board tool reads only.
  const board = await registered.get('wheelhouse_board').invoke({ input: {} });
  assert.match(textOf(board), /c1/);
  assert.equal(calls.length, 1);
  // Without a project or a card, nothing is recorded.
  await registered.get('wheelhouse_record').invoke({ input: { label: 'Approve' } });
  assert.equal(calls.length, 1);
});

test('an inbox file is read once and removed', async () => {
  const folder = tmp();
  const inbox = path.join(folder, '.wheelhouse', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, 'a.json'), JSON.stringify({ card: 'c1', hash: 'h1', label: 'Not now' }));
  const { calls, client } = recorder();
  const first = await tools.drainInbox({ folder, client, project: 'owner__name' });
  const second = await tools.drainInbox({ folder, client, project: 'owner__name' });
  assert.equal(first.read, 1);
  assert.equal(second.read, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(fs.readdirSync(inbox), []);
  // A file that isn't readable as a click is removed too and records nothing.
  fs.writeFileSync(path.join(inbox, 'b.json'), 'not json');
  await tools.drainInbox({ folder, client, project: 'owner__name' });
  assert.equal(calls.length, 1);
  assert.deepEqual(fs.readdirSync(inbox), []);
});

test('an inbox file can\'t approve', async () => {
  const folder = tmp();
  const inbox = path.join(folder, '.wheelhouse', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, 'a.json'), JSON.stringify({ card: 'c1', hash: 'h1', label: 'Approve', proof: 'add-on', signed: true, records: [{}] }));
  const { calls, client } = recorder();
  await tools.drainInbox({ folder, client, project: 'owner__name' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].proof, 'chat-click');
  assert.ok(!('records' in calls[0]) && !('signed' in calls[0]));
});

test('a terminal command is recorded', async () => {
  const { vscode, terminal } = chatVscode();
  const seen = [];
  const watching = tools.watchTerminal({ vscode, record: (line) => seen.push(line), now: () => new Date('2026-11-02T05:00:00.000Z') });
  assert.ok(watching);
  assert.equal(terminal.length, 1);
  terminal[0]({ execution: { commandLine: { value: 'npm test' } } });
  terminal[0]({ execution: {} });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].command, 'npm test');
  assert.equal(seen[0].at, '2026-11-02T05:00:00.000Z');
});

test('the add-on registers the tools and the terminal record when it starts', async () => {
  const { vscode, registered, terminal } = chatVscode();
  const { client } = recorder();
  await activate({ subscriptions: [], extensionPath: tmp() }, { vscode, deps: { desk: null, ask: async () => true, node: '/x/node', startHelper: async () => {}, loop: false, client, project: 'owner__name' } });
  assert.deepEqual([...registered.keys()].sort(), [...ALLOWED_TOOLS].sort());
  assert.equal(terminal.length, 1);
});

test('the package names the two tools and nothing more', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.contributes.languageModelTools.map((t) => t.name).sort(), [...ALLOWED_TOOLS].sort());
  assert.deepEqual(checkAddon(readAddon(ROOT)), []);
});

test('the proof still refuses a tool that reaches a press', () => {
  const { pkg, sources } = readAddon(ROOT);
  for (const name of ['pressCard', 'pressSetting', 'signedRecords', 'keepEarned']) {
    const bad = { ...sources, 'vscode/chat-tools.cjs': `${sources['vscode/chat-tools.cjs']}\nvscode.lm.registerTool('wheelhouse_record', { invoke: async (o) => deps.press.${name}(o.input) });` };
    assert.ok(checkAddon({ pkg, sources: bad }).some((p) => p.includes(name)), name);
  }
  const act = { ...sources, 'vscode/chat-tools.cjs': `${sources['vscode/chat-tools.cjs']}\nvscode.lm.registerTool('wheelhouse_board', { invoke: async () => desk.act('x', {}) });` };
  assert.ok(checkAddon({ pkg, sources: act }).some((p) => p.includes('act')));
  const extra = { ...pkg, contributes: { ...pkg.contributes, languageModelTools: [...pkg.contributes.languageModelTools, { name: 'wheelhouse_press' }] } };
  assert.ok(checkAddon({ pkg: extra, sources }).some((p) => p.includes('wheelhouse_press')));
});
