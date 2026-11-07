// tests/scripts/hooks/why-role.test.js
// A why session (a read-only copy that explains a decision) starts in the builder's own worktree, so the plugin's hooks run in it.
// They are run here as hooks.json registers them, with the why role set: none may write the builder's state or the project's
// record, and every tool but reading and searching is refused, whichever tool's matcher names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { featurePaths } from '../../../scripts/feature/files.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { startBackground } from '../../../scripts/lib/background.js';
import { decide as featureStatus } from '../../../scripts/hooks/feature-status.js';
import { decide as sessionStart } from '../../../scripts/hooks/session-start.js';
import { usageDir } from '../../../scripts/lib/paths.js';
import { tempFolder } from '../../helpers/homes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTERED = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const FLOOR = path.join(ROOT, 'scripts', 'hooks', 'node-floor.cjs');
const real = (dir) => fs.realpathSync.native(dir);
const BUILDER = '11111111-2222-3333-4444-555555555555';
const FORK = '66666666-7777-8888-9999-000000000001';
const WHY = { WHEELHOUSE_ROLE: 'why' };

// Every file under `dir` with its contents, to compare before and after.
function snapshot(dir) {
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(fs.readdirSync(dir, { recursive: true }).map(String).sort().map((f) => {
    const file = path.join(dir, f);
    return [f, fs.statSync(file).isDirectory() ? '<dir>' : fs.readFileSync(file, 'utf8')];
  }));
}

// A feature worktree made by hand on feature/login-page, in a project registered with its main folder, in a new home.
function world() {
  const home = real(tempFolder('wh-why-home-'));
  const tree = real(tempFolder('wh-why-tree-'));
  fs.mkdirSync(path.join(tree, '.git'));
  fs.writeFileSync(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/login-page\n');
  const brief = featurePaths(tree).brief;
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  const fields = { v: 1, work: 'login-page', lane: 'feature', version: 1, goal: 'Let people sign in', done: ['Sign in works'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };
  fs.writeFileSync(brief, `\`\`\`json\n${JSON.stringify(fields, null, 2)}\n\`\`\`\nThe brief.\n`);
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  writeProject('owner__name', { folder: tree, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
  const done = () => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  };
  return { home, tree, done };
}

// Runs the hook the way hooks.json does, with `env` added.
function runHook(script, input, { home, env = {} }) {
  const out = spawnSync(process.execPath, [FLOOR, path.join(ROOT, 'scripts', 'hooks', script)], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, WHEELHOUSE_HOME: home, CLAUDE_PLUGIN_ROOT: ROOT, ...env },
  });
  return { code: out.status, out: out.stdout, err: out.stderr };
}

const EVENTS = (tree) => [
  ['SessionStart', 'session-start.js', { hook_event_name: 'SessionStart', source: 'startup' }],
  ['UserPromptSubmit', 'stop-word.js', { hook_event_name: 'UserPromptSubmit', prompt: 'Why weekly?' }],
  ['UserPromptSubmit', 'context-gauge.js', { hook_event_name: 'UserPromptSubmit', prompt: 'Why weekly?' }],
  ['UserPromptSubmit', 'prompt-record.js', { hook_event_name: 'UserPromptSubmit', prompt: '1 B' }],
  ['UserPromptSubmit', 'board-context.js', { hook_event_name: 'UserPromptSubmit', prompt: 'Why weekly?' }],
  ['PostToolUse', 'feature-status.js', { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(tree, 'a.txt') }, tool_response: {} }],
  ['Stop', 'card-check.js', { hook_event_name: 'Stop', stop_hook_active: false }],
  ['Stop', 'feature-status.js', { hook_event_name: 'Stop', stop_hook_active: false }],
  ['SubagentStop', 'feature-status.js', { hook_event_name: 'SubagentStop' }],
  ['SessionEnd', 'stop-guard.js', { hook_event_name: 'SessionEnd' }],
];

test('with the why role, no hook writes the builder\'s state or the project\'s record', () => {
  const w = world();
  try {
    for (const [event, script, extra] of EVENTS(w.tree)) {
      const input = { session_id: FORK, cwd: w.tree, transcript_path: path.join(w.tree, 't.jsonl'), permission_mode: 'plan', ...extra };
      const before = { tree: snapshot(w.tree), home: snapshot(w.home) };
      const got = runHook(script, input, { home: w.home, env: WHY });
      assert.equal(got.code, 0, `${event} ${script}: ${got.err}`);
      assert.equal(got.out.trim(), '', `${event} ${script} says nothing to a why session`);
      assert.deepEqual(snapshot(w.tree), before.tree, `${event} ${script} leaves the worktree as it was`);
      assert.deepEqual(snapshot(w.home), before.home, `${event} ${script} leaves the home and the record as they were`);
    }
    assert.equal(fs.existsSync(featurePaths(w.tree).session), false, "the builder's session.json is never written");
  } finally {
    w.done();
  }
});

test('without the why role the same hook does keep the session, so the test above would notice', () => {
  const w = world();
  try {
    const input = { session_id: BUILDER, cwd: w.tree, hook_event_name: 'Stop', stop_hook_active: false };
    runHook('feature-status.js', input, { home: w.home });
    assert.deepEqual(JSON.parse(fs.readFileSync(featurePaths(w.tree).session, 'utf8')), { sessionId: BUILDER });
  } finally {
    w.done();
  }
});

test('feature-status, session-start and the background start do nothing for a why session, called directly', async () => {
  const w = world();
  try {
    const before = { tree: snapshot(w.tree), home: snapshot(w.home) };
    assert.equal(await featureStatus({ session_id: FORK, cwd: w.tree, hook_event_name: 'Stop' }, { env: WHY }), undefined);
    assert.equal(await sessionStart({ session_id: FORK, cwd: w.tree, hook_event_name: 'SessionStart', source: 'startup' }, { env: WHY }), undefined);
    await startBackground({ pluginRoot: ROOT, session: FORK, cwd: w.tree, project: 'owner__name', env: { ...WHY }, spawn: () => { throw new Error('nothing is started'); }, health: async () => true, weeklyDue: () => false });
    assert.deepEqual(snapshot(w.tree), before.tree);
    assert.deepEqual(snapshot(w.home), before.home);
    assert.equal(fs.existsSync(path.join(usageDir(), 'sessions', `${FORK}.json`)), false, 'no usage record of the fork as a feature session');
  } finally {
    w.done();
  }
});

// The commands hooks.json registers for PreToolUse that run for `tool`, as the matchers choose them.
const registeredFor = (tool) => REGISTERED.PreToolUse
  .filter((entry) => entry.matcher === undefined || entry.matcher === '*' || new RegExp(`^(?:${entry.matcher})$`).test(tool))
  .flatMap((entry) => entry.hooks.map((h) => /scripts\/hooks\/([a-z-]+\.js)"/.exec(h.command)?.[1]));

const refused = (script, tool, home, cwd) => {
  const got = runHook(script, { session_id: FORK, cwd, hook_event_name: 'PreToolUse', permission_mode: 'plan', tool_name: tool, tool_input: { command: 'ls', file_path: path.join(cwd, 'a.txt'), pattern: 'x', prompt: 'x' } }, { home, env: WHY });
  try {
    return JSON.parse(got.out)?.hookSpecificOutput?.permissionDecision === 'deny';
  } catch {
    return false;
  }
};

test('every tool but Read, Grep and Glob is refused through the hooks as registered, whichever matcher names it', () => {
  const w = world();
  try {
    const tools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'Task', 'Agent', 'WebSearch', 'WebFetch', 'Skill', 'TodoWrite',
      'CronCreate', 'CronDelete', 'TaskOutput', 'TaskStop', 'ToolSearch', 'AskUserQuestion', 'mcp__some__tool', 'ListMcpResourcesTool', 'EnterPlanMode', 'SendMessage'];
    for (const tool of tools) {
      const scripts = [...new Set(registeredFor(tool))];
      assert.ok(scripts.length > 0, `${tool} reaches at least one registered hook`);
      assert.ok(scripts.some((s) => refused(s, tool, w.home, w.tree)), `${tool} is refused by one of ${scripts.join(', ')}`);
    }
    for (const tool of ['Read', 'Grep', 'Glob']) {
      for (const s of new Set(registeredFor(tool))) assert.equal(refused(s, tool, w.home, w.tree), false, `${tool} passes ${s}`);
    }
  } finally {
    w.done();
  }
});
