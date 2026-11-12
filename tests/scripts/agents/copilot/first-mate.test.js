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

test('the instructions give the tool sheet and say a chat click is not proven', () => {
  const text = built.get(INSTRUCTIONS);
  assert.match(text, /^---\napplyTo: "\*\*"\n---\n<!-- /);
  assert.ok(text.includes(copilot.toolSheet.trim()), 'the adapter\'s tool sheet, whole');
  assert.match(text, /chat-click/);
  assert.match(text, /not proven/);
  assert.match(text, /lift-stop|Lift STOP/);
  assert.match(text, /helper's own window/);
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
