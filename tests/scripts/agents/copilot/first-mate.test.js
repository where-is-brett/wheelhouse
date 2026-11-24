// tests/scripts/agents/copilot/first-mate.test.js
// The First Mate's agent and instructions for the person's Copilot folder (scripts/agents/copilot/first-mate.js): built from
// skills/front-desk and the tool sheet, kept apart from the session home so no background session is given them.
import '../../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tools from '../../../../adapters/copilot/tools.js';
import copilot from '../../../../adapters/copilot/index.js';
import { buildFirstMate, checkFirstMate, FIRST_MATE_DIR, writeFirstMate } from '../../../../scripts/agents/copilot/first-mate.js';
import { buildHome } from '../../../../scripts/agents/copilot/home.js';
import { SIGNED_LABELS } from '../../../../scripts/hooks/prompt-record.js';
import { C6_PASSED } from '../../../../scripts/agents/copilot/numbers.js';
import { tempFolder } from '../../../helpers/homes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const built = buildFirstMate({ root: ROOT });
const AGENT = 'agents/wheelhouse-first-mate.agent.md';
const INSTRUCTIONS = 'instructions/wheelhouse-first-mate.instructions.md';
const lf = (text) => text.replaceAll('\r\n', '\n');

test('it holds the agent and the instructions, and the session home gains neither', () => {
  assert.deepEqual([...built.keys()], [AGENT, INSTRUCTIONS]);
  assert.ok(![...buildHome({ root: ROOT }).keys()].some((f) => f.includes('first-mate')), 'a session home never carries the First Mate');
});

test('the agent carries the front desk playbook, with Copilot\'s names', () => {
  const text = built.get(AGENT);
  assert.match(text, /^---\nname: "wheelhouse-first-mate"\ndescription: "Use when the session start says \\"This is the First Mate\\"/);
  assert.match(text, new RegExp(`^<!-- ${FIRST_MATE_DIR}/${AGENT.replace('.', '\\.')} \\(built from skills/front-desk/SKILL\\.md by npm run copilot-first-mate\\) -->$`, 'm'));
  const source = lf(fs.readFileSync(path.join(ROOT, 'skills', 'front-desk', 'SKILL.md'), 'utf8'));
  assert.ok(text.includes('# The First Mate'));
  assert.ok(text.includes(source.slice(source.indexOf('## The command'), source.indexOf('## The command') + 200).replaceAll('wheelhouse:', 'wheelhouse-')), 'the playbook\'s text');
  assert.match(text, /wheelhouse-intake/);
  assert.doesNotMatch(text, /wheelhouse:[a-z]/);
  assert.doesNotMatch(text, /Write tool/);
});

test('the agent\'s tools are Copilot\'s: it asks with ask_user and runs the Wheelhouse command, and never grants a wide switch', () => {
  const front = /^tools: (\[.*\])$/m.exec(built.get(AGENT));
  const granted = JSON.parse(front[1]);
  for (const tool of ['view', 'glob', 'rg', 'ask_user', ...tools.shell]) assert.ok(granted.includes(tool), tool);
  const known = new Set(Object.values(tools).flatMap((v) => (Array.isArray(v) ? v : [v])));
  for (const tool of granted) assert.ok(known.has(tool), tool);
  assert.equal(new Set(granted).size, granted.length);
  assert.doesNotMatch(built.get(AGENT), /--allow-all|--yolo/);
});

test('the instructions give the tool sheet and send every card with a signing option to the helper\'s window', () => {
  const text = built.get(INSTRUCTIONS);
  assert.match(text, /^---\napplyTo: "\*\*"\n---\n<!-- /);
  assert.ok(text.includes(copilot.toolSheet.trim()), 'the adapter\'s tool sheet, whole');
  assert.match(text, /that click is not recorded/);
  assert.match(text, /run `confirm <card id>` instead/);
  for (const label of SIGNED_LABELS) assert.ok(text.includes(label), label);
  assert.doesNotMatch(text, /chat-click/, 'no route records a chat click on Copilot');
});

test('the agent never says a click in the chat records itself', () => {
  const text = built.get(AGENT);
  assert.doesNotMatch(text, /a click or a typed reply records itself|the click records itself|Its click records itself/);
  assert.match(text, /goes to Wheelhouse's own window with `confirm`/);
});

test('no file names a Claude Code tool, a model, a personal path or an attribution line', () => {
  for (const [file, text] of built) {
    for (const name of ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE.md']) assert.ok(!text.includes(name), `${file} names ${name}`);
    assert.doesNotMatch(text, /Co-Authored-By|Generated with/i, file);
    assert.doesNotMatch(text, /\b(opus|sonnet|haiku|fable)\b/i, file);
    assert.doesNotMatch(text, /\/Users\/|C:\\Users/, file);
  }
});

test('the committed copy is what the build gives, and --write replaces a stale one', () => {
  assert.deepEqual(checkFirstMate({ root: ROOT }), []);
  const root = tempFolder('wh-first-mate-');
  for (const rel of ['skills/front-desk/SKILL.md', 'adapters/copilot/tool-sheet.md']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  }
  assert.equal(checkFirstMate({ root }).length, 2, 'both missing');
  writeFirstMate({ root });
  assert.deepEqual(checkFirstMate({ root }), []);
  fs.writeFileSync(path.join(root, FIRST_MATE_DIR, AGENT), 'old\n');
  assert.deepEqual(checkFirstMate({ root }), [`${FIRST_MATE_DIR}/${AGENT}`]);
});

test('the build throws when a source can\'t be read', () => {
  assert.throws(() => buildFirstMate({ root: tempFolder('wh-first-mate-empty-') }), /front-desk/);
});

test('where every card is asked in the picker, the instructions and the agent ask decisions and signing cards with ask_user and keep the window for an undo only', () => {
  const picked = buildFirstMate({ picker: true });
  const text = picked.get(INSTRUCTIONS);
  assert.match(text, /Ask every card with ask_user, a decision, a sign-off and a merge approval among them/);
  assert.match(text, /no free-text input/);
  assert.doesNotMatch(text, /decision confirm|confirm seat-take-over|never go to ask_user|that click is not recorded/);
  assert.match(text, /undo on a project kept on this computer/);
  const agent = picked.get(AGENT);
  assert.match(agent, /\*\*Decisions are cards\.\*\*/);
  assert.doesNotMatch(agent, /Decisions are chat messages|plain chat message|their own typed reply to a decision/);
  assert.doesNotMatch(agent, /Wheelhouse's own window with `confirm`/);
  assert.ok(text.includes('Every card goes to ask_user'), 'the tool sheet line');
});

test('the committed copies and the tool sheet follow C6_PASSED, the one switch', () => {
  assert.deepEqual(checkFirstMate(), [], 'run npm run copilot-first-mate');
  const sheet = fs.readFileSync(new URL('../../../../adapters/copilot/tool-sheet.md', import.meta.url), 'utf8');
  assert.equal(sheet.includes('Signing options and decisions never go to ask_user'), !C6_PASSED, 'tool-sheet.md line 4 changes with C6_PASSED');
});
