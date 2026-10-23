// tests/scripts/agents/copilot-translate.test.js
// Copilot's hook input translated for Wheelhouse's guards, and their answers translated back (checks 56, 58,
// 60, 63 and 66; Part 5 Task 1).
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import translate, { TOOL_MAP, KNOWN_TOOLS, UNKNOWN_TOOL, toGuardInput, fromGuardAnswer, harnessOf, exitCodeFor, patchPaths } from '../../../adapters/copilot/translate.js';
import copilot from '../../../adapters/copilot/index.js';
import tools from '../../../adapters/copilot/tools.js';
import { hookMain, answer, TRANSLATORS } from '../../../scripts/hooks/kit.js';
import { agentOfInput } from '../../../scripts/agents/of-input.js';
import { decide as toolGuard } from '../../../scripts/hooks/tool-guard.js';
import { decide as stopGuard, READ_TOOLS, HALT_TOOLS, NOTIFY_TOOLS, DENIED } from '../../../scripts/hooks/stop-guard.js';
import { decide as lineageHold, HELD } from '../../../scripts/hooks/lineage-hold.js';
import { holdFile } from '../../../scripts/lineage/check.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'copilot', 'hook-input');
const PROJECT = 'owner__name';
const COULD_NOT_RUN = 'Wheelhouse\'s check could not run';

// Stand-ins for gh, glab, copilot and curl come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

// A registered project whose main folder has a .git folder (the hooks read files only).
const MAIN = fs.realpathSync.native(tempFolder('wh-copilot-translate-'));
fs.mkdirSync(path.join(MAIN, '.git'));
fs.writeFileSync(path.join(MAIN, 'README.md'), 'readme');
writeProject(PROJECT, { folder: MAIN, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
const MANAGED = path.join(MAIN, 'no-managed-copy');
const guardDeps = { dir: MANAGED, platform: 'linux', home: '/home/model-a', pluginRoot: '/plugin/root', env: {} };

// A fixture with the project's folder in place of <PROJECT>.
function fixture(name) {
  const text = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  return JSON.parse(text.replaceAll('<PROJECT>', MAIN));
}
const files = fs.readdirSync(FIXTURES).sort();
const camelFiles = files.filter((f) => f.startsWith('camel-'));
const pascalFiles = files.filter((f) => f.startsWith('pascal-'));
const eventOf = (file) => file.split('-')[1];

function harness(input, extra = {}) {
  const out = [];
  return { out, io: { stdin: Readable.from([JSON.stringify(input)]), write: (t) => out.push(t), self: '/plugin/scripts/hooks/kit.js', dir: MANAGED, ...extra } };
}
const written = (h) => h.out.map((line) => JSON.parse(line));
const copilotDeny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const call = (toolName, toolArgs) => ({ sessionId: 's1', timestamp: 0, cwd: MAIN, toolName, toolArgs });

// Every top-level key the recorded camelCase inputs carry, and the Claude Code key the guards read it under.
const KEYS = {
  sessionId: 'session_id', timestamp: 'timestamp', cwd: 'cwd', toolResult: 'tool_response', error: 'error', source: 'source',
  initialPrompt: 'initial_prompt', transcriptPath: 'transcript_path', agentId: 'agent_id', agentType: 'agent_type',
  agentName: 'agent_name', agentDisplayName: 'agent_display_name', agentDescription: 'agent_description',
  response: 'last_assistant_message', stopReason: 'stop_reason', stop_hook_active: 'stop_hook_active', parentAgentId: 'parent_agent_id',
};
const EVENT_NAMES = { preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', postToolUseFailure: 'PostToolUseFailure', sessionStart: 'SessionStart', subagentStart: 'SubagentStart', subagentStop: 'SubagentStop' };

// Each recorded tool's Claude Code name and the arguments the guards read (check 58's table; ruling P5-4).
function expectedTool(raw) {
  const a = raw.toolArgs;
  switch (raw.toolName) {
    case 'bash': return { tool_name: 'Bash', tool_input: a };
    case 'view': return { tool_name: 'Read', tool_input: { file_path: a.path } };
    case 'rg': return { tool_name: 'Grep', tool_input: { pattern: a.pattern, path: a.paths, output_mode: a.output_mode, head_limit: a.head_limit } };
    case 'glob': return { tool_name: 'Glob', tool_input: { pattern: a.pattern, path: a.paths } };
    case 'web_fetch': return { tool_name: 'WebFetch', tool_input: a };
    case 'task': return { tool_name: 'Agent', tool_input: a };
    case 'probe58-echo': return { tool_name: 'mcp__probe58__echo', tool_input: a };
    default: throw new Error(`No expectation for ${raw.toolName}`);
  }
}

test('each recorded Copilot input translates to the Claude Code input the guards read', async () => {
  assert.equal(camelFiles.length, 19);
  for (const file of camelFiles) {
    const raw = fixture(file);
    const event = eventOf(file);
    const common = { hook_event_name: EVENT_NAMES[event] };
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'toolName' || key === 'toolArgs') continue;
      assert.ok(Object.hasOwn(KEYS, key), `${file} has a key the test doesn't know: ${key}`);
      common[KEYS[key]] = value;
    }
    let expected;
    if (raw.toolName === undefined) expected = common;
    else if (raw.toolName === 'apply_patch') expected = [{ ...common, tool_name: 'Edit', tool_input: { file_path: path.join(MAIN, 'out.txt'), patch: raw.toolArgs } }];
    else expected = { ...common, ...expectedTool(raw) };
    assert.deepEqual(toGuardInput(raw, event), expected, file);
    // The entry may name the event in Claude Code's spelling too.
    assert.deepEqual(toGuardInput(raw, EVENT_NAMES[event]), expected, `${file}, Claude Code's event name`);
  }
  // The guards read every recorded tool call: the tool guard places each one and answers it without a throw.
  for (const file of camelFiles.filter((f) => eventOf(f) === 'preToolUse')) {
    const inputs = [toGuardInput(fixture(file), 'preToolUse')].flat();
    for (const input of inputs) {
      const out = await toolGuard(input, guardDeps);
      if (input.tool_name.startsWith('mcp__')) assert.match(out.hookSpecificOutput.permissionDecisionReason, /has not listed that connector/, file);
      else assert.equal(out, undefined, file);
    }
  }
  // A guard reads the path, not the name alone (check 58: a deny on view was walked round with cat).
  const secret = await toolGuard(toGuardInput(call('view', { path: path.join(MAIN, '.env') }), 'preToolUse'), guardDeps);
  assert.equal(secret.hookSpecificOutput.permissionDecision, 'deny');
  const shell = await toolGuard(toGuardInput(call('bash', { command: 'cat .env' }), 'preToolUse'), guardDeps);
  assert.equal(shell.hookSpecificOutput.permissionDecision, 'deny');
});

test('an argument the map does not know is passed on under its own name, and two that disagree refuse', () => {
  assert.deepEqual(toGuardInput(call('view', { path: '/a', view_range: [1, 2] }), 'preToolUse').tool_input, { file_path: '/a', view_range: [1, 2] });
  assert.deepEqual(toGuardInput(call('view', { path: '/a', file_path: '/a' }), 'preToolUse').tool_input, { file_path: '/a' });
  assert.equal(toGuardInput(call('view', { path: '/a', file_path: '/b' }), 'preToolUse'), null);
  assert.equal(toGuardInput(call('view', 'not an object'), 'preToolUse'), null);
  assert.deepEqual(toGuardInput(call('create', { path: '/a', file_text: 'x' }), 'preToolUse'), { ...toGuardInput(call('create', {}), 'preToolUse'), tool_name: 'Write', tool_input: { file_path: '/a', file_text: 'x' } });
  assert.equal(toGuardInput(call('powershell', { command: 'dir' }), 'preToolUse').tool_name, 'PowerShell');
  assert.equal(toGuardInput(call('edit', { path: '/a' }), 'preToolUse').tool_name, 'Edit');
  assert.equal(toGuardInput(call('stop_bash', {}), 'preToolUse').tool_name, 'KillShell');
  // Input with no folder cannot be placed, so it is not translated.
  assert.equal(toGuardInput({ toolName: 'bash', sessionId: 's' }, 'preToolUse'), null);
  for (const raw of [null, undefined, 'x', [], { cwd: '' }]) assert.equal(toGuardInput(raw, 'preToolUse'), null);
});

test('an unknown tool such as apply_patch_v2 is refused with UNKNOWN_TOOL', async () => {
  assert.equal(UNKNOWN_TOOL('apply_patch_v2'), 'Copilot has a tool Wheelhouse doesn\'t know yet, `apply_patch_v2`; it is refused until Wheelhouse is updated');
  for (const name of ['apply_patch_v2', 'foo', 'foo-', '-foo', 'Bash', 'Read']) {
    assert.deepEqual(toGuardInput(call(name, {}), 'preToolUse'), { unknownTool: name }, name);
  }
  // An MCP tool is `<server>-<tool>`, split at the first hyphen (ruling P5-5).
  assert.equal(toGuardInput(call('probe58-echo', {}), 'preToolUse').tool_name, 'mcp__probe58__echo');
  assert.equal(toGuardInput(call('my-server-do-it', {}), 'preToolUse').tool_name, 'mcp__my__server-do-it');
  // Through the kit the call is refused in those words, before any guard runs, and the entry exits 2.
  let called = false;
  const h = harness(call('apply_patch_v2', 'x'));
  await hookMain(() => { called = true; }, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.equal(called, false);
  assert.deepEqual(written(h), [copilotDeny(UNKNOWN_TOOL('apply_patch_v2'))]);
  assert.equal(exitCodeFor(written(h)[0]), 2);
  // A hook that only informs says nothing.
  const quiet = harness(call('apply_patch_v2', 'x'));
  await hookMain(() => { called = true; }, { failClosed: false, event: 'PreToolUse' }, quiet.io);
  assert.equal(called, false);
  assert.deepEqual(quiet.out, []);
});

test('a read-only tool not in TOOL_MAP is let through only when tools.read names it', async () => {
  const readOnly = tools.read.filter((name) => !Object.hasOwn(TOOL_MAP, name));
  assert.ok(readOnly.includes('read_agent') && readOnly.includes('ask_user'));
  // The lists the Copilot entry hands the guards: Claude Code's, and Copilot's under their own names (ruling P5-3).
  const lists = { readTools: [...READ_TOOLS, ...tools.read], haltTools: [...HALT_TOOLS, ...tools.halt], notifyTools: [...NOTIFY_TOOLS, ...tools.notify] };
  const writers = ['sql', 'skill', 'write_agent', 'store_memory'];
  const input = (name) => {
    const one = toGuardInput(call(name, {}), 'preToolUse');
    assert.equal(one.tool_name, name, `${name} keeps its own name`);
    return one;
  };
  setStop({ by: 'prompt' });
  try {
    for (const name of readOnly) {
      assert.equal((await stopGuard(input(name), guardDeps)).hookSpecificOutput.permissionDecisionReason, DENIED, `${name} with Claude Code's lists`);
      assert.equal(await stopGuard(input(name), { ...guardDeps, ...lists }), undefined, name);
    }
    for (const name of writers) assert.equal((await stopGuard(input(name), { ...guardDeps, ...lists })).hookSpecificOutput.permissionDecisionReason, DENIED, name);
    // A mapped read tool needs no list of Copilot's: it reaches the guard under Claude Code's name.
    assert.equal(await stopGuard(toGuardInput(call('view', { path: path.join(MAIN, 'README.md') }), 'preToolUse'), guardDeps), undefined);
    assert.equal((await stopGuard(toGuardInput(call('task', { prompt: 'x' }), 'preToolUse'), { ...guardDeps, ...lists })).hookSpecificOutput.permissionDecisionReason, DENIED);
  } finally {
    liftStop();
  }
  fs.mkdirSync(path.dirname(holdFile(PROJECT)), { recursive: true });
  fs.writeFileSync(holdFile(PROJECT), JSON.stringify({ at: '2026-10-23T00:00:00.000Z', mismatches: [] }));
  try {
    for (const name of readOnly) {
      assert.equal((await lineageHold(input(name), guardDeps)).hookSpecificOutput.permissionDecisionReason, HELD, `${name} with Claude Code's lists`);
      assert.equal(await lineageHold(input(name), { ...guardDeps, ...lists }), undefined, name);
    }
    for (const name of writers) assert.equal((await lineageHold(input(name), { ...guardDeps, ...lists })).hookSpecificOutput.permissionDecisionReason, HELD, name);
    assert.equal(await lineageHold(toGuardInput(call('stop_bash', {}), 'preToolUse'), guardDeps), undefined);
  } finally {
    fs.rmSync(holdFile(PROJECT), { force: true });
  }
});

test('skill, read_agent and sql, which checks 63 and 66 saw, are known tools', async () => {
  for (const name of ['skill', 'read_agent', 'sql']) {
    const input = toGuardInput(call(name, name === 'skill' ? { skill: 'model-a-skill' } : {}), 'preToolUse');
    assert.equal(input.tool_name, name);
    assert.equal(input.unknownTool, undefined);
    // The tool guard lets a tool that touches no file, shell or connector by untouched (ruling P5-10).
    assert.equal(await toolGuard(input, guardDeps), undefined, name);
  }
  assert.ok(tools.read.includes('read_agent'));
  assert.ok(tools.other.includes('skill') && tools.other.includes('sql'));
  // Every known name but the parallel wrapper translates.
  for (const name of KNOWN_TOOLS.filter((n) => n !== 'multi_tool_use.parallel' && n !== 'apply_patch')) {
    assert.equal(toGuardInput(call(name, {}), 'preToolUse').unknownTool, undefined, name);
  }
  assert.deepEqual([...KNOWN_TOOLS].sort(), [...new Set([...tools.read, ...tools.halt, ...tools.notify, tools.ask, ...tools.shell, ...tools.edit, ...tools.other])].sort());
});

test('apply_patch\'s paths are read from its patch, and one refused path refuses the call', async () => {
  const patch = [
    '*** Begin Patch',
    `*** Add File: ${MAIN}/new.txt`,
    '+hello',
    '+*** Add File: /not/a/header',
    `*** Update File: ${MAIN}/README.md`,
    `*** Move to: ${MAIN}/moved.md`,
    '@@',
    '-readme',
    '+read me',
    '*** End of File',
    `*** Delete File: ${MAIN}/old.txt`,
    '*** End Patch',
    '',
  ].join('\n');
  assert.deepEqual(patchPaths(patch), [`${MAIN}/new.txt`, `${MAIN}/README.md`, `${MAIN}/moved.md`, `${MAIN}/old.txt`]);
  const inputs = toGuardInput(call('apply_patch', patch), 'preToolUse');
  assert.deepEqual(inputs.map((i) => [i.tool_name, i.tool_input.file_path]), patchPaths(patch).map((p) => ['Edit', p]));
  // Windows line ends are read the same.
  assert.deepEqual(patchPaths(patch.replaceAll('\n', '\r\n')), patchPaths(patch));
  // A patch Wheelhouse cannot read the paths of is not translated, so it is refused.
  for (const bad of ['', '*** Begin Patch\n*** End Patch\n', '*** Begin Patch\n*** Rename File: /a\n*** End Patch\n', '*** Begin Patch\n*** Add File: \n*** End Patch\n', { patch: 'x' }, undefined]) {
    assert.equal(toGuardInput(call('apply_patch', bad), 'preToolUse'), null, JSON.stringify(bad));
  }
  // Through the kit with the tool guard: every path is decided, and one refused path refuses the call.
  const run = async (text) => {
    const h = harness(call('apply_patch', text));
    await hookMain(toolGuard, { failClosed: true, event: 'PreToolUse' }, { ...h.io, deps: guardDeps });
    return written(h);
  };
  assert.deepEqual(await run(patch), []);
  const refused = await run(patch.replace(`*** Delete File: ${MAIN}/old.txt`, `*** Delete File: ${MAIN}/.env`));
  assert.equal(refused.length, 1);
  assert.equal(refused[0].permissionDecision, 'deny');
  assert.match(refused[0].permissionDecisionReason, /\.env/);
  assert.deepEqual(await run('*** Begin Patch\n*** End Patch\n'), [copilotDeny(COULD_NOT_RUN)]);
  // The first refusal is the answer, and no path after it is decided.
  const seen = [];
  const h = harness(call('apply_patch', patch));
  await hookMain((input) => { seen.push(input.tool_input.file_path); return seen.length === 2 ? answer.deny('second') : undefined; }, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.deepEqual(seen, [`${MAIN}/new.txt`, `${MAIN}/README.md`]);
  assert.deepEqual(written(h), [copilotDeny('second')]);
});

test('multi_tool_use.parallel is refused until the open question is settled', async () => {
  assert.ok(tools.other.includes('multi_tool_use.parallel'));
  assert.deepEqual(toGuardInput(call('multi_tool_use.parallel', { tool_uses: [] }), 'preToolUse'), { unknownTool: 'multi_tool_use.parallel' });
  const h = harness(call('multi_tool_use.parallel', { tool_uses: [] }));
  await hookMain(() => undefined, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.deepEqual(written(h), [copilotDeny(UNKNOWN_TOOL('multi_tool_use.parallel'))]);
});

test('a guard that throws answers with a deliberate deny and does not exit 1', async () => {
  const h = harness(fixture('camel-preToolUse-bash.json'));
  // hookMain picks the Copilot translator from the input and resolves; the throw never leaves it.
  await hookMain(() => { throw new Error('model-a broke'); }, { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.deepEqual(written(h), [copilotDeny(COULD_NOT_RUN)]);
  assert.equal(exitCodeFor(written(h)[0]), 2);
  assert.equal(TRANSLATORS.copilot.translate, translate);
  assert.equal(copilot.translate, translate);
  assert.ok(!copilot.pending.includes('translate'));
});

test('a deny answer becomes Copilot\'s deny with its reason, and exit code 2', async () => {
  assert.deepEqual(fromGuardAnswer(answer.deny('no'), 'PreToolUse'), copilotDeny('no'));
  assert.equal(exitCodeFor(fromGuardAnswer(answer.deny('no'), 'PreToolUse')), 2);
  assert.deepEqual(fromGuardAnswer(answer.context('SessionStart', 'hello'), 'SessionStart'), { additionalContext: 'hello' });
  assert.equal(exitCodeFor({ additionalContext: 'hello' }), 0);
  assert.deepEqual(fromGuardAnswer(answer.block('wait'), 'PreCompact'), { decision: 'block', reason: 'wait' });
  assert.equal(fromGuardAnswer(undefined, 'PreToolUse'), undefined);
  assert.equal(exitCodeFor(undefined), 0);
  assert.equal(exitCodeFor({ permissionDecision: 'allow' }), 0);
  // A guard's deny through the kit is written in Copilot's shape.
  const h = harness(fixture('camel-preToolUse-view.json'));
  await hookMain(() => answer.deny('not this one'), { failClosed: true, event: 'PreToolUse' }, h.io);
  assert.deepEqual(written(h), [copilotDeny('not this one')]);
});

test('Local harness input is told apart from the Copilot harness\'s', () => {
  for (const file of camelFiles) {
    const raw = fixture(file);
    assert.equal(harnessOf(raw, { COPILOT_CLI: '1', COPILOT_CLI_BINARY_VERSION: '1.0.101' }), 'copilot', file);
    // No input field names the harness (check 58), so without the CLI's variable the harness is not known,
    // and it is refused as Local is; nothing is read as Local yet.
    assert.equal(harnessOf(raw, { COPILOT_CLI: '1' }), 'unknown', file);
    assert.equal(harnessOf(raw, { COPILOT_CLI_BINARY_VERSION: '' }), 'unknown', file);
    assert.equal(harnessOf(raw, {}), 'unknown', file);
  }
});

test('a PascalCase payload is Claude Code\'s, and the guards refuse its patch-string Edit', async () => {
  assert.equal(pascalFiles.length, 19);
  for (const file of pascalFiles) {
    const raw = fixture(file);
    if (Object.hasOwn(raw, 'hook_event_name')) {
      assert.equal(agentOfInput(raw), 'claude-code', file);
      assert.equal(TRANSLATORS['claude-code'].translate.toGuardInput(raw, raw.hook_event_name), raw, file);
    } else {
      // Check 58: SubagentStart kept the camelCase keys under the PascalCase name; that payload is Copilot's.
      assert.equal(file, 'pascal-SubagentStart-none.json');
      assert.equal(agentOfInput(raw), 'copilot');
    }
  }
  // The patch-string Edit gives the tool guard no file_path, so its check cannot run, and the call is refused.
  const h = harness(fixture('pascal-PreToolUse-Edit.json'));
  await hookMain(toolGuard, { failClosed: true, event: 'PreToolUse' }, { ...h.io, deps: guardDeps });
  assert.deepEqual(written(h), [answer.deny(COULD_NOT_RUN)]);
});

test('no real copilot, gh, glab or curl ran', () => {
  assert.deepEqual(stand.calls(), []);
});
