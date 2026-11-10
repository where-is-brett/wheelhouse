// tests/scripts/agents/copilot/hook-entry.test.js
// The Copilot hook entry (design section 3.1): the step list for each event, the same input to the guards as Claude
// Code's for the same action (the kept hook-input fixtures), writes through the helper, a refusal with no helper,
// and its own deadline inside the registered limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { runEntry, EVENT_NAMES, DEADLINE, COULD_NOT_RUN, APP_TOOL, NO_TEXT } from '../../../../scripts/agents/copilot/hook-entry.js';
import { GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC } from '../../../../scripts/agents/copilot/numbers.js';
import { toGuardInput, patchChanges, patchPaths } from '../../../../adapters/copilot/translate.js';
import { NO_HELPER_STOP } from '../../../../scripts/lib/stop.js';
import { hookMain } from '../../../../scripts/hooks/kit.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'copilot', 'hook-input');
const PROJECT = '/work/shop';
const ENV = { COPILOT_CLI_BINARY_VERSION: '1.0.101' };
const STEPS = ['sessionStart', 'stopWord', 'contextGauge', 'promptRecord', 'boardContext', 'stopGuard', 'lineageHold', 'toolGuard', 'protectedTests', 'frontDeskWrites', 'cardCheck', 'featureStatus', 'reportCheck', 'asideOverlap', 'helmEnd'];

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8').replaceAll('<PROJECT>', PROJECT).replaceAll('<PORT>', '1'));
const up = { health: async () => ({ ok: true }), session: { mark: async () => ({ ok: true }) } };

// Every step recorded: what each was given, in order.
function recording({ answers = {} } = {}) {
  const calls = [];
  const steps = Object.fromEntries(STEPS.map((name) => [name, async (input, deps) => { calls.push({ name, input, deps }); return answers[name]?.(input); }]));
  return { calls, steps };
}
const run = (event, raw, { client = up, steps, stepDeps, deadlineMs, c6, env = ENV } = {}) => runEntry(event, {
  stdin: Readable.from([JSON.stringify(raw)]),
  env,
  deps: { client, steps, stepDeps, deadlineMs, c6, projectOf: () => ({ project: 'shop' }), dir: '/nowhere' },
});
const deny = (reason) => answer(reason);
const answer = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const call = (toolName, toolArgs, extra = {}) => ({ sessionId: 's1', timestamp: 0, cwd: PROJECT, toolName, toolArgs, ...extra });
const names = (calls) => calls.map((c) => c.name);

test('each event runs the step list of adapters/claude-code/hooks.js, in order', async () => {
  const order = async (event, raw) => {
    const r = recording();
    await run(event, raw, { steps: r.steps, c6: true });
    return names(r.calls);
  };
  assert.deepEqual(await order('sessionStart', { sessionId: 's1', cwd: PROJECT, source: 'new' }), ['sessionStart']);
  assert.deepEqual(await order('userPromptSubmitted', { sessionId: 's1', cwd: PROJECT, prompt: 'hi' }), ['stopWord', 'contextGauge', 'promptRecord', 'boardContext']);
  assert.deepEqual(await order('preToolUse', call('bash', { command: 'ls' })), ['stopGuard', 'lineageHold', 'toolGuard', 'protectedTests', 'frontDeskWrites']);
  assert.deepEqual(await order('preToolUse', call('view', { path: `${PROJECT}/a` })), ['stopGuard', 'lineageHold', 'toolGuard']);
  assert.deepEqual(await order('preToolUse', call('task', { prompt: 'x' })), ['stopGuard', 'lineageHold']);
  assert.deepEqual(await order('preToolUse', call('ask_user', { message: 'Ship it?' })), ['stopGuard', 'lineageHold', 'cardCheck']);
  assert.deepEqual(await order('postToolUse', call('bash', { command: 'ls' }, { toolResult: {} })), ['featureStatus']);
  assert.deepEqual(await order('postToolUse', call('ask_user', { message: 'Ship it?' }, { toolResult: {} })), ['promptRecord', 'featureStatus']);
  assert.deepEqual(await order('subagentStop', { sessionId: 's1', cwd: PROJECT, agentType: 'wheelhouse-builder', response: 'ok' }), ['reportCheck', 'featureStatus']);
  assert.deepEqual(await order('agentStop', { sessionId: 's1', cwd: PROJECT }), ['cardCheck', 'featureStatus', 'asideOverlap']);
  assert.deepEqual(await order('sessionEnd', { sessionId: 's1', cwd: PROJECT }), ['stopGuard', 'helmEnd']);
  assert.deepEqual(Object.values(EVENT_NAMES).sort(), ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit']);
});

test('the chat-click record waits for check C6', async () => {
  const r = recording();
  await run('postToolUse', call('ask_user', { message: 'Ship it?' }, { toolResult: { answers: { a: 'Yes' } } }), { steps: r.steps, c6: false });
  assert.deepEqual(names(r.calls), ['featureStatus']);
});

// What the guards are given, for each kept fixture, against Claude Code's input for the same action (the step's
// own answer is then the same).
const CLAUDE = {
  'camel-preToolUse-bash.json': { tool_name: 'Bash', tool_input: { command: 'echo probe58-shell' } },
  'camel-preToolUse-view.json': { tool_name: 'Read', tool_input: { file_path: `${PROJECT}/README.md` } },
  'camel-preToolUse-rg.json': { tool_name: 'Grep', tool_input: { pattern: 'secret', path: PROJECT } },
  'camel-preToolUse-glob.json': { tool_name: 'Glob', tool_input: { pattern: '*.md', path: PROJECT } },
  'camel-preToolUse-web_fetch.json': { tool_name: 'WebFetch', tool_input: { url: 'http://127.0.0.1:1/probe58' } },
  'camel-preToolUse-probe58-echo.json': { tool_name: 'mcp__probe58__echo', tool_input: { text: 'probe58' } },
  'camel-preToolUse-apply_patch.json': { tool_name: 'Write', tool_input: { file_path: `${PROJECT}/out.txt`, content: 'went-through' } },
  'camel-preToolUse-task.json': { tool_name: 'Agent', tool_input: { prompt: 'Reply ok' } },
};
const pick = (input) => ({ tool_name: input.tool_name, tool_input: Object.fromEntries(Object.entries(input.tool_input).filter(([key]) => ['command', 'file_path', 'path', 'pattern', 'url', 'text', 'content', 'prompt'].includes(key))) });
// A guard that refuses a read of "secret", a write to out.txt and a command that says "probe", whichever agent asks.
const picky = async (input) => {
  const text = JSON.stringify(input.tool_input);
  return /secret|out\.txt|probe58-shell/.test(text) ? deny('no') : undefined;
};

for (const [file, claude] of Object.entries(CLAUDE)) {
  test(`${file}: the guards are given what Claude Code gives them for the same action`, async () => {
    // Claude Code's side: the same hook kit and a guard that answers as `picky` does, on its own input.
    const seen = [];
    const claudeOut = [];
    await hookMain(async (input) => { seen.push(input); return picky(input); }, { failClosed: true, event: 'PreToolUse' }, {
      stdin: Readable.from([JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: PROJECT, ...claude })]),
      write: (text) => claudeOut.push(text),
      dir: '/nowhere',
      projectOf: () => ({ project: 'shop' }),
    });
    // Copilot's side, with every guard let through, to see what each is given.
    const open = recording();
    await run('preToolUse', fixture(file), { steps: open.steps });
    // The tool guard is registered on file, shell and MCP tools; the write guards on edits and the shell.
    const toolGuard = open.calls.find((c) => c.name === 'toolGuard');
    const patched = file === 'camel-preToolUse-apply_patch.json';
    const guarded = !['Agent'].includes(claude.tool_name);
    assert.equal(toolGuard !== undefined, guarded, file);
    // The tool guard reads a file's path, so an apply_patch's Edit (with its patch) and Claude Code's Write give it the same input.
    if (guarded) assert.deepEqual(patched ? { path: toolGuard.input.tool_input.file_path } : pick(toolGuard.input), patched ? { path: claude.tool_input.file_path } : pick(seen[0]), file);
    const writing = open.calls.find((c) => c.name === 'frontDeskWrites');
    assert.equal(writing !== undefined, ['Bash', 'Write'].includes(claude.tool_name), file);
    if (writing !== undefined) assert.deepEqual(pick(writing.input), pick(seen[0]), file);
    // The same answer: a guard that refuses one refuses the other.
    const refusing = recording({ answers: { toolGuard: picky, protectedTests: picky, frontDeskWrites: picky } });
    const got = await run('preToolUse', fixture(file), { steps: refusing.steps });
    const wouldRefuse = claudeOut.some((text) => text.includes('"deny"'));
    assert.equal(got.code === 2, wouldRefuse, file);
  });
}

test('with no helper the entry refuses all but reading, and the STOP guard says why', async () => {
  const away = { health: async () => { throw new Error('no helper'); }, session: { mark: async () => { throw new Error('no helper'); } } };
  const stopGuard = (await import('../../../../scripts/hooks/stop-guard.js')).decide;
  const guarded = { stopGuard: (input, deps) => stopGuard(input, { ...deps, projectOf: () => ({ project: 'shop' }), dir: '/nowhere', env: {} }) };
  const r = recording();
  const refused = await run('preToolUse', call('bash', { command: 'ls' }), { client: away, steps: { ...r.steps, ...guarded } });
  assert.equal(refused.code, 2);
  assert.match(refused.text, new RegExp(NO_HELPER_STOP.slice(0, 20)));
  const read = await run('preToolUse', call('view', { path: `${PROJECT}/a` }), { client: away, steps: { ...r.steps, ...guarded } });
  assert.deepEqual(read, { text: '', code: 0 });
});

test('every step is told to write through the helper, and is given the helper\'s client and whether it answered', async () => {
  const r = recording();
  await run('preToolUse', call('bash', { command: 'ls' }), { steps: r.steps });
  for (const c of r.calls) {
    assert.equal(c.deps.writeVia, 'helper', c.name);
    assert.equal(c.deps.helperUp, true, c.name);
    assert.equal(c.deps.client.health, up.health, c.name);
  }
  assert.equal(r.calls.find((c) => c.name === 'stopGuard').deps.bypass, false);
});

test('a run past its own deadline is refused, and the deadline is inside the registered limit', async () => {
  assert.ok(GUARD_DEADLINE_MS < GUARD_TIMEOUT_SEC * 1000);
  const marks = [];
  const slow = { ...up, session: { mark: async (body) => marks.push(body.mark) } };
  const r = recording({ answers: { toolGuard: () => new Promise(() => {}) } });
  const got = await run('preToolUse', call('bash', { command: 'ls' }), { client: slow, steps: r.steps, deadlineMs: 60 });
  assert.equal(got.code, 2);
  assert.match(got.text, new RegExp(DEADLINE));
  assert.deepEqual(marks, ['deadline']);
  const informing = await run('userPromptSubmitted', { sessionId: 's1', cwd: PROJECT, prompt: 'x' }, { steps: { ...r.steps, stopWord: () => new Promise(() => {}) }, deadlineMs: 60 });
  assert.deepEqual(informing, { text: '', code: 0 });
});

test('a step that throws refuses a tool call', async () => {
  const r = recording({ answers: { toolGuard: () => { throw new Error('x'); } } });
  const got = await run('preToolUse', call('bash', { command: 'ls' }), { steps: r.steps });
  assert.equal(got.code, 2);
  assert.match(got.text, new RegExp(COULD_NOT_RUN));
});

test('rg and glob given a list of paths are checked for each path, and a list that cannot be read is refused', async () => {
  const r = recording();
  await run('preToolUse', call('rg', { pattern: 'x', paths: ['/work/shop/a', '/work/shop/b'] }), { steps: r.steps });
  assert.deepEqual(r.calls.filter((c) => c.name === 'toolGuard').map((c) => c.input.tool_input.path), ['/work/shop/a', '/work/shop/b']);
  for (const paths of [[], [1], ['/a', ''], 7, { a: 1 }]) {
    const none = recording();
    const got = await run('preToolUse', call('glob', { pattern: '*', paths }), { steps: none.steps });
    assert.equal(got.code, 2, JSON.stringify(paths));
    assert.deepEqual(none.calls, [], JSON.stringify(paths));
  }
  assert.equal(toGuardInput(call('rg', { pattern: 'x', paths: '/work/shop' }), 'preToolUse').tool_input.path, '/work/shop');
});

test('a Copilot MCP tool that lands on the Claude app\'s own tools is refused before any guard', async () => {
  for (const name of ['ccd_turn-wrap_up', 'ccd_turn-update_plan', 'ccd_view-show_pane']) {
    const r = recording();
    const got = await run('preToolUse', call(name, {}), { steps: r.steps });
    assert.equal(got.code, 2, name);
    assert.match(got.text, new RegExp(APP_TOOL.slice(0, 30)), name);
    assert.deepEqual(r.calls, [], name);
  }
});

test('an apply_patch gives the write guards the files and hunks it changes, so a skipped or deleted test is seen', async () => {
  const patch = [
    '*** Begin Patch',
    `*** Update File: ${PROJECT}/tests/a.test.js`,
    '@@',
    " test('x', () => {",
    "-test('y', () => {})",
    "+test.skip('y', () => {})",
    `*** Delete File: ${PROJECT}/tests/b.test.js`,
    `*** Add File: ${PROJECT}/new.txt`,
    '+one',
    '+two',
    '*** End Patch',
    '',
  ].join('\n');
  const r = recording();
  await run('preToolUse', call('apply_patch', patch), { steps: r.steps });
  const seen = r.calls.filter((c) => c.name === 'protectedTests').map((c) => [c.input.tool_name, c.input.tool_input]);
  assert.deepEqual(seen, [
    ['Edit', { file_path: `${PROJECT}/tests/a.test.js`, old_string: "test('x', () => {\ntest('y', () => {})", new_string: "test('x', () => {\ntest.skip('y', () => {})" }],
    ['Write', { file_path: `${PROJECT}/tests/b.test.js`, content: '' }],
    ['Write', { file_path: `${PROJECT}/new.txt`, content: 'one\ntwo' }],
  ]);
  assert.deepEqual(r.calls.filter((c) => c.name === 'frontDeskWrites').length, 3);
  assert.equal(patchChanges('*** Begin Patch\n*** End Patch\n'), null);
  // A move is a delete of the old path and an edit of the new.
  const moved = patchChanges(`*** Begin Patch\n*** Update File: /a\n*** Move to: /b\n@@\n-x\n+y\n*** End Patch\n`);
  assert.deepEqual(moved.map((c) => [c.tool_name, c.tool_input.file_path]), [['Write', '/a'], ['Edit', '/b']]);
});

test('an edit or create whose text the write guards cannot read is refused; Copilot\'s own names for the text are read', async () => {
  const bare = recording();
  const refused = await run('preToolUse', call('edit', { path: `${PROJECT}/a.test.js` }), { steps: bare.steps });
  assert.equal(refused.code, 2);
  assert.match(refused.text, new RegExp(NO_TEXT.slice(0, 30)));
  assert.deepEqual(bare.calls, []);
  const made = recording();
  assert.equal((await run('preToolUse', call('create', { path: `${PROJECT}/a.txt` }), { steps: made.steps })).code, 2);
  const ok = recording();
  await run('preToolUse', call('edit', { path: `${PROJECT}/a.test.js`, old_str: 'a', new_str: 'b' }), { steps: ok.steps });
  assert.deepEqual(ok.calls.find((c) => c.name === 'protectedTests').input.tool_input, { file_path: `${PROJECT}/a.test.js`, old_str: 'a', new_str: 'b', old_string: 'a', new_string: 'b' });
  // Two names for the same text that differ: which one the tool writes is not known, so the call is refused.
  const split = recording();
  const conflict = await run('preToolUse', call('edit', { path: 'tests/a.test.js', old_str: 'it(', new_str: 'it.skip(', old_string: 'a', new_string: 'a' }), { steps: split.steps });
  assert.equal(conflict.code, 2);
  assert.match(conflict.text, new RegExp(NO_TEXT.slice(0, 30)));
  assert.deepEqual(split.calls, []);
  const same = recording();
  assert.equal((await run('preToolUse', call('edit', { path: 'a.txt', old_str: 'a', new_str: 'b', old_string: 'a', new_string: 'b' }), { steps: same.steps })).code, 0);
  const twice = recording();
  assert.equal((await run('preToolUse', call('create', { path: 'a.txt', file_text: 'x', content: 'y' }), { steps: twice.steps })).code, 2);
  const file = recording();
  await run('preToolUse', call('create', { path: `${PROJECT}/a.txt`, file_text: 'hello' }), { steps: file.steps });
  assert.equal(file.calls.find((c) => c.name === 'protectedTests').input.tool_input.content, 'hello');
});

test('a tool Wheelhouse does not know is refused and marked; outside a Wheelhouse project nothing runs', async () => {
  const marks = [];
  const r = recording();
  const got = await run('preToolUse', call('brand_new_tool', {}), { client: { ...up, session: { mark: async (body) => marks.push([body.mark, body.data]) } }, steps: r.steps });
  assert.equal(got.code, 2);
  assert.deepEqual(marks, [['unknown-tool', { name: 'brand_new_tool' }]]);
  const outside = await runEntry('preToolUse', { stdin: Readable.from([JSON.stringify(call('bash', { command: 'ls' }))]), env: ENV, deps: { client: up, steps: r.steps, projectOf: () => null, dir: '/nowhere' } });
  assert.deepEqual(outside, { text: '', code: 0 });
});

test('a harness that is not Copilot\'s gets the session-start notice and only reading', async () => {
  const r = recording();
  const start = await run('sessionStart', { sessionId: 's1', cwd: PROJECT }, { steps: r.steps, env: {} });
  assert.match(start.text, /doesn't run in this kind of chat/);
  assert.equal((await run('preToolUse', call('bash', { command: 'ls' }), { steps: r.steps, env: {} })).code, 2);
  assert.equal((await run('preToolUse', call('view', { path: '/a' }), { steps: r.steps, env: {} })).code, 0);
  assert.deepEqual(r.calls, []);
});

test('a compaction is marked and answered with nothing', async () => {
  const marks = [];
  const got = await run('preCompact', { sessionId: 's1', cwd: PROJECT, trigger: 'auto' }, { client: { ...up, session: { mark: async (body) => marks.push([body.mark, body.data]) } } });
  assert.deepEqual(got, { text: '', code: 0 });
  assert.deepEqual(marks, [['compaction', { trigger: 'auto' }]]);
});

test('a subagent named for Wheelhouse\'s builder and reviewer reaches report-check by Claude Code\'s name', async () => {
  const r = recording();
  await run('subagentStop', fixtureStop('wheelhouse-reviewer'), { steps: r.steps });
  assert.equal(r.calls.find((c) => c.name === 'reportCheck').input.agent_type, 'wheelhouse:reviewer');
  const other = recording();
  await run('subagentStop', fixtureStop('probe-agent'), { steps: other.steps });
  assert.equal(other.calls.find((c) => c.name === 'reportCheck').input.agent_type, 'probe-agent');
});
function fixtureStop(type) {
  return { ...fixture('camel-subagentStop-none.json'), agentType: type, agentName: type };
}

test('a context line that reads as a header once trimmed refuses the whole patch', async () => {
  const hidden = [
    '*** Begin Patch',
    '*** Update File: tests/a.test.js',
    '@@',
    ' /*',
    ' *** Update File: docs/notes.md',
    ' */',
    '-it("x", () => {});',
    '+it.skip("x", () => {});',
    '*** End Patch',
    '',
  ].join('\n');
  assert.equal(patchPaths(hidden), null);
  assert.equal(patchChanges(hidden), null);
  for (const indent of [' ', '\t', '  ']) assert.equal(patchPaths(hidden.replace(' *** Update', `${indent}*** Update`)), null);
  const r = recording();
  const got = await run('preToolUse', call('apply_patch', hidden), { steps: r.steps });
  assert.equal(got.code, 2);
  assert.deepEqual(r.calls, []);
  // Header lines with nothing before them, and file text that starts with + or -, are read as they were.
  const plain = '*** Begin Patch\n*** Update File: a.txt\n@@\n-*** Update File: b\n+*** Update File: c\n*** End Patch\n';
  assert.deepEqual(patchPaths(plain), ['a.txt']);
});

// Check 80: a subagent's prompt and its own stop come through userPromptSubmitted and agentStop with an agentId.
test('a subagent\'s own prompt and agentStop run no step, and its subagentStop still does', async () => {
  for (const [event, name] of [['userPromptSubmitted', 'camel-userPromptSubmitted-subagent.json'], ['agentStop', 'camel-agentStop-subagent.json']]) {
    const r = recording();
    const got = await run(event, fixture(name), { steps: r.steps });
    assert.deepEqual(r.calls, [], event);
    assert.deepEqual(got, { text: '', code: 0 }, event);
  }
  for (const [event, name, expected] of [['userPromptSubmitted', 'camel-userPromptSubmitted-none.json', 4], ['agentStop', 'camel-agentStop-none.json', 3]]) {
    const r = recording();
    await run(event, fixture(name), { steps: r.steps });
    assert.equal(r.calls.length, expected, event);
  }
});

test('a block at the end of a turn is written as Copilot acts on it: the body, with exit 0', async () => {
  const r = recording({ answers: { cardCheck: () => ({ decision: 'block', reason: 'Finish the card first.' }) } });
  const got = await run('agentStop', fixture('camel-agentStop-none.json'), { steps: r.steps });
  assert.deepEqual(JSON.parse(got.text), { decision: 'block', reason: 'Finish the card first.' });
  assert.equal(got.code, 0);
  const sub = await run('subagentStop', fixtureStop('wheelhouse-builder'), { steps: recording({ answers: { reportCheck: () => ({ decision: 'block', reason: 'Report the parts.' }) } }).steps });
  assert.deepEqual(JSON.parse(sub.text), { decision: 'block', reason: 'Report the parts.' });
  assert.equal(sub.code, 0);
});

test('the kept fixtures for the other events read as the entry takes them', async () => {
  for (const [event, name] of [['sessionEnd', 'camel-sessionEnd-none.json'], ['preCompact', 'camel-preCompact-none.json']]) {
    const got = await run(event, fixture(name), { steps: recording().steps });
    assert.equal(got.code, 0, event);
  }
});
