// tests/skills/tool-names.test.js
// The playbooks speak of tools in general words ("your clickable-question tool"); each agent's tool
// sheet maps the words back to its own tools, and the session start hands the sheet over before
// the briefing (design section 8.3, Part 3 Task 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, MAX_CHARS, toolSheetLines } from '../../scripts/hooks/session-start.js';
import { frontDeskCommand } from '../../scripts/protection/settings.js';
import claudeCode from '../../adapters/claude-code/index.js';
import claudeCodeTools from '../../adapters/claude-code/tools.js';
import claudeCodeSheet from '../../adapters/claude-code/tool-sheet.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = ['front-desk', 'intake', 'foreman', 'setup'];
const NAMES = ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT'];
const PLUGIN_ROOT = '/plugin/root';

// The playbook after its front matter. The foreman's front matter holds the allow rule Claude Code
// reads (`allowed-tools`), which is Claude Code's own packaging, not the playbook's words.
function playbookOf(skill) {
  const raw = fs.readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8').replaceAll('\r\n', '\n');
  const m = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(raw);
  assert.ok(m, `${skill} starts with front matter`);
  return m[1];
}

test('no skill names AskUserQuestion, PushNotification, ToolSearch, SendMessage or CLAUDE_PLUGIN_ROOT', () => {
  for (const skill of SKILLS) {
    const body = playbookOf(skill);
    for (const name of NAMES) assert.ok(!body.includes(name), `skills/${skill}/SKILL.md names ${name}`);
  }
});

test('the playbooks use the general words the tool sheet answers', () => {
  const all = SKILLS.map(playbookOf).join('\n');
  for (const phrase of ['your clickable-question tool', 'your notification tool', 'your tool-search tool, if you have one', 'the Wheelhouse command the session start named']) {
    assert.ok(all.includes(phrase), phrase);
  }
});

test('the Claude Code tool sheet names every one of them', () => {
  const sheet = claudeCodeSheet;
  assert.equal(claudeCode.toolSheet, sheet, 'the adapter holds the sheet');
  assert.match(sheet, /Your clickable-question tool is AskUserQuestion\b/);
  assert.match(sheet, /Your notification tool is PushNotification\b/);
  assert.match(sheet, /Your tool-search tool is ToolSearch\b/);
  assert.match(sheet, /Your message tool is SendMessage\b/);
  // The same tools the adapter's `tools` part names.
  assert.equal(claudeCodeTools.ask, 'AskUserQuestion');
  assert.ok(claudeCodeTools.notify.includes('PushNotification'));
  assert.ok(claudeCodeTools.read.includes('ToolSearch'));
  // The path comment is for the file; it is not handed to a session.
  assert.ok(fs.readFileSync(path.join(ROOT, 'adapters', 'claude-code', 'tool-sheet.md'), 'utf8').startsWith('<!-- adapters/claude-code/tool-sheet.md -->'));
  assert.doesNotMatch(sheet, /<!--|-->/);
  assert.ok(!sheet.startsWith('\n') && !sheet.endsWith('\n'));
});

test('the tool sheet lines are the sheet, then the Wheelhouse command', () => {
  const lines = toolSheetLines('claude-code', { pluginRoot: PLUGIN_ROOT, platform: 'darwin' });
  assert.deepEqual(lines, [...claudeCodeSheet.split('\n'), `The Wheelhouse command is ${frontDeskCommand(PLUGIN_ROOT, { platform: 'darwin' })}`]);
  assert.equal(lines.at(-1), 'The Wheelhouse command is node "/plugin/root/scripts/frontdesk/cli.js"');
  // A plugin folder that can't be typed as a command gives the sheet alone.
  assert.deepEqual(toolSheetLines('claude-code', { pluginRoot: '/plugin/$root', platform: 'darwin' }), claudeCodeSheet.split('\n'));
});

// ---- The session start ----

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-tool-sheet-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  return Promise.resolve(fn(home)).finally(() => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  });
}

const BASE = { rulebook: [], levels: {}, waiting: [], unconfirmed: [], damaged: [] };
const client = (views) => ({
  health: async () => ({ ok: true }),
  state: { sync: async () => ({ ok: true }), views: async () => ({ ok: true, views }), write: async () => ({ ok: true }), record: async () => ({ ok: true }) },
});
const start = (views, { event = 'SessionStart' } = {}) => decide(
  { cwd: '/x', session_id: 's1', ...(event === null ? {} : { hook_event_name: event }) },
  {
    pluginRoot: PLUGIN_ROOT, client: client(views), spawn: () => ({ unref() {}, on() {} }), platform: 'darwin', projectOf: () => ({ project: 'owner__name' }),
    stopState: () => ({ on: false }), pause: async () => {}, startWaitMs: 200, background: async () => ({ receiver: 'running', weekly: 'not-due' }),
    lineage: () => ({ ok: true, mismatches: [], manifest: true, upstreams: {}, kept: true }), guardedSelfTest: async () => null, startLowNodeCopy: () => true,
  },
);
const textOf = (out) => out?.hookSpecificOutput?.additionalContext ?? '';
const SHEET = () => toolSheetLines('claude-code', { pluginRoot: PLUGIN_ROOT, platform: 'darwin' }).join('\n');

test('the session start gives the tool sheet and the command line before the briefing', async () => {
  await withHome(async () => {
    const t = textOf(await start({ ...BASE, waiting: [{ id: 'c1', data: { title: 'A card' } }], levels: { deploy: { key: 'deploy', value: 'ask' } } }));
    assert.ok(t.includes(SHEET()), t);
    assert.ok(t.indexOf(SHEET()) < t.indexOf('Waiting on the director:'), 'the sheet comes before the lists');
    assert.ok(t.indexOf(SHEET()) < t.indexOf('Levels:'));
    assert.ok(t.includes('The Wheelhouse command is node "/plugin/root/scripts/frontdesk/cli.js"'));
  });
});

test('the agent comes from the hook input, and Claude Code is the default', async () => {
  await withHome(async () => {
    const claude = textOf(await start(BASE));
    const none = textOf(await start(BASE, { event: null }));
    assert.ok(claude.includes(SHEET()) && none.includes(SHEET()));
  });
});

test('a session start at MAX_CHARS keeps the whole tool sheet', async () => {
  await withHome(async () => {
    const long = (c, i) => `${c}${i} ${'w'.repeat(300)}`;
    const mk = (c) => Array.from({ length: 20 }, (_, i) => ({ id: `${c}${i}`, kind: 'ruling', status: 'accepted', words: long(c, i), data: { title: long(c, i), words: long(c, i) } }));
    const t = textOf(await start({ ...BASE, damaged: mk('d').map((x) => x.words), waiting: mk('w'), unconfirmed: mk('u'), rulebook: mk('r') }));
    assert.equal(t.length, MAX_CHARS, 'the briefing was cut');
    assert.ok(t.includes(SHEET()), 'the sheet and the command line are whole');
  });
});
