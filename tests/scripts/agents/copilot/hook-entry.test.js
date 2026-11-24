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
import { LAUNCHER_SESSION } from '../../../../scripts/lib/launchers.js';
import { setStop } from '../../../../scripts/lib/stop.js';
import { makeSigningKey, enrol } from '../../../../scripts/state/signing.js';
import { withHome } from '../../../helpers/homes.js';

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
  assert.deepEqual(await order('postToolUse', call('ask_user', { message: 'Ship it?' }, { toolResult: {} })), ['featureStatus']);
  assert.deepEqual(await order('subagentStop', { sessionId: 's1', cwd: PROJECT, agentType: 'wheelhouse-builder', response: 'ok' }), ['reportCheck', 'featureStatus']);
  assert.deepEqual(await order('agentStop', { sessionId: 's1', cwd: PROJECT }), ['cardCheck', 'featureStatus', 'asideOverlap']);
  assert.deepEqual(await order('sessionEnd', { sessionId: 's1', cwd: PROJECT }), ['stopGuard', 'helmEnd']);
  assert.deepEqual(Object.values(EVENT_NAMES).sort(), ['PostToolUse', 'PreCompact', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit']);
});

test('the click record waits for check C6, and no longer runs the prompt-record step', async () => {
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
test('report-check is told a builder\'s report names no commit, since Wheelhouse commits its work after its run', async () => {
  const r = recording();
  await run('subagentStop', fixtureStop('wheelhouse-builder'), { steps: r.steps });
  assert.equal(r.calls.find((c) => c.name === 'reportCheck').deps.commitNamed, false);
  assert.equal(r.calls.find((c) => c.name === 'featureStatus').deps.commitNamed, undefined);
});
function fixtureStop(type) {
  return { ...fixture('camel-subagentStop-none.json'), agentType: type, agentName: type };
}

// The feature session dispatches the Lookout with `task` (T6): the call, and the Lookout's stop, as Copilot sends them.
const LAUNCHER_ENV = { ...ENV, [LAUNCHER_SESSION]: '1' };
const taskCall = () => fixture('camel-preToolUse-task.json');

test('a feature session\'s `task` call is let through by every guard that sees it, and refused only under STOP', () => withHome(async () => {
  // `task` is in the translation's `other` group: only the STOP guard and the lineage hold are on it, and neither refuses it.
  const r = recording();
  assert.deepEqual(await run('preToolUse', taskCall(), { steps: r.steps, env: LAUNCHER_ENV }), { text: '', code: 0 });
  assert.deepEqual(names(r.calls), ['stopGuard', 'lineageHold']);
  // With the real steps, as the entry runs them for a launcher session, nothing refuses it.
  assert.deepEqual(await run('preToolUse', taskCall(), { env: LAUNCHER_ENV }), { text: '', code: 0 });
  // Under STOP it is refused, as any tool that isn't reading is.
  setStop({ by: 'prompt' });
  const stopped = await run('preToolUse', taskCall(), { env: LAUNCHER_ENV });
  assert.equal(stopped.code, 2);
  assert.match(JSON.parse(stopped.text).permissionDecisionReason, /All stop is on/);
}));

test('the Lookout\'s stop, sent as Copilot sends it, reaches report-check by its colon name and is recorded as a review of the pull request\'s head', () => withHome(async () => {
  // The computer's signing key signs the review, as it does for Claude Code: report-check is the only signer.
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
  const HEAD = 'c'.repeat(40);
  const report = ['The branch is sound.', '', 'WHEELHOUSE REPORT', 'role: reviewer', 'pr: 7', `commit: ${HEAD}`, 'verdict: CLEAN', ''].join('\n');
  const recorded = [];
  const notes = [];
  const client = {
    ...up,
    prState: async () => ({ ok: true, result: { state: 'open', headSha: HEAD } }),
    state: { record: async (body) => { recorded.push(body); return { ok: true }; }, write: async (body) => { notes.push(body); return { ok: true }; } },
  };
  const { decide } = await import('../../../../scripts/hooks/report-check.js');
  const seen = [];
  const reportCheck = (input, deps) => {
    seen.push(input.agent_type);
    return decide(input, { ...deps, projectOf: () => ({ project: 'shop' }), now: () => new Date('2026-11-23T01:00:00Z') });
  };
  const stop = { ...fixture('camel-subagentStop-none.json'), agentType: 'wheelhouse-reviewer', agentName: 'wheelhouse-reviewer', response: report };
  const got = await run('subagentStop', stop, { client, steps: { reportCheck, featureStatus: async () => undefined }, env: LAUNCHER_ENV });
  assert.deepEqual(got, { text: '', code: 0 });
  assert.deepEqual(seen, ['wheelhouse:reviewer']);
  assert.deepEqual(notes, []);
  assert.equal(recorded.length, 1);
  const { data, kind } = recorded[0].event;
  assert.equal(kind, 'review');
  assert.deepEqual([data.pr, data.commit, data.verdict, data.findings], [7, HEAD, 'CLEAN', 0]);

  // A report on a head that has moved is not recorded, and says so.
  recorded.length = 0;
  const moved = { ...stop, response: report.replace(HEAD, 'd'.repeat(40)) };
  await run('subagentStop', moved, { client, steps: { reportCheck, featureStatus: async () => undefined }, env: LAUNCHER_ENV });
  assert.equal(recorded.length, 0);
  assert.match(notes[0].data.text, /was not recorded: the head has moved since the review/);
}));

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

// Check 96: a subagent's prompt and its own stop come through userPromptSubmitted and agentStop with an agentId.
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
  for (const [event, name, ran] of [['sessionEnd', 'camel-sessionEnd-none.json', ['stopGuard', 'helmEnd']], ['preCompact', 'camel-preCompact-none.json', []]]) {
    const r = recording();
    const got = await run(event, fixture(name), { steps: r.steps });
    assert.equal(got.code, 0, event);
    assert.deepEqual(names(r.calls), ran, event);
  }
  // A subagent's id on its own is not enough to skip a prompt.
  const r = recording();
  await run('userPromptSubmitted', { ...fixture('camel-userPromptSubmitted-none.json'), agentId: 'a1' }, { steps: r.steps });
  assert.equal(r.calls.length, 4);
});

test('a preToolUse input carrying agentId and parentAgentId is still guarded: a denying step exits 2', async () => {
  const r = recording({ answers: { toolGuard: () => deny('no') } });
  const got = await run('preToolUse', call('view', { path: `${PROJECT}/a` }, { agentId: 'a1', parentAgentId: 'p1', agentType: 'probe' }), { steps: r.steps });
  assert.equal(got.code, 2);
  assert.equal(JSON.parse(got.text).permissionDecision, 'deny');
});

test('arguments given as a JSON string are read as the object they hold', async () => {
  const r = recording();
  const got = await run('preToolUse', call('view', JSON.stringify({ path: `${PROJECT}/a` })), { steps: r.steps });
  assert.deepEqual(got, { text: '', code: 0 });
  assert.equal(r.calls.find((c) => c.name === 'toolGuard').input.tool_input.file_path, `${PROJECT}/a`);
  const shell = await run('preToolUse', call('powershell', JSON.stringify({ command: 'ls' })), { steps: r.steps });
  assert.equal(shell.code, 0);
  const bad = await run('preToolUse', call('view', 'not json'), { steps: recording().steps });
  assert.equal(bad.code, 2);
});

test('a batch of calls runs every step on each call, and one refusal refuses the batch', async () => {
  const batch = { sessionId: 's1', cwd: PROJECT, toolCalls: [{ id: 'call_1', name: 'view', args: { path: `${PROJECT}/a` } }, { id: 'call_2', name: 'powershell', args: { command: 'ls' } }] };
  const r = recording();
  assert.deepEqual(await run('preToolUse', batch, { steps: r.steps }), { text: '', code: 0 });
  // The STOP guard and the lineage hold see each call, not only the first.
  assert.deepEqual(names(r.calls), ['stopGuard', 'lineageHold', 'toolGuard', 'stopGuard', 'lineageHold', 'toolGuard', 'protectedTests', 'frontDeskWrites']);
  assert.deepEqual(r.calls.filter((c) => c.name === 'stopGuard').map((c) => c.input.tool_name), ['Read', 'PowerShell']);
  // One deny is the batch's answer, with exit 2.
  const picky = recording({ answers: { toolGuard: (input) => (input.tool_name === 'PowerShell' ? deny('no shell') : undefined) } });
  const got = await run('preToolUse', batch, { steps: picky.steps });
  assert.equal(got.code, 2);
  assert.deepEqual(JSON.parse(got.text), { permissionDecision: 'deny', permissionDecisionReason: 'no shell' });
  // A batch with a call that can't be read is refused.
  const unread = await run('preToolUse', { ...batch, toolCalls: [...batch.toolCalls, { id: 'call_3', args: {} }] }, { steps: recording().steps });
  assert.equal(unread.code, 2);
  // Outside the Copilot harness, a batch of reads goes through, and one that isn't all reads is refused.
  const reads = { ...batch, toolCalls: [batch.toolCalls[0], batch.toolCalls[0]] };
  assert.equal((await run('preToolUse', reads, { steps: recording().steps, env: {} })).code, 0);
  assert.equal((await run('preToolUse', batch, { steps: recording().steps, env: {} })).code, 2);
});

test('a folder with a lower-case drive letter is placed as the capital one', async () => {
  const placed = [];
  const r = recording();
  await runEntry('userPromptSubmitted', {
    stdin: Readable.from([JSON.stringify({ sessionId: 's1', cwd: 'c:\\Users\\d\\shop', prompt: 'hi' })]),
    env: ENV,
    deps: { client: up, steps: r.steps, projectOf: (cwd) => { placed.push(cwd); return { project: 'shop' }; }, dir: '/nowhere' },
  });
  assert.ok(placed.length > 0);
  assert.ok(placed.every((cwd) => cwd === 'C:\\Users\\d\\shop'), JSON.stringify(placed));
  assert.equal(r.calls[0].input.cwd, 'C:\\Users\\d\\shop');
});

test('a chat with no launchers runs the front desk\'s node command through the real guards unrefused', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const { frontDeskCommand } = await import('../../../../scripts/protection/settings.js');
  for (const [tool, platform] of [['bash', 'darwin'], ['powershell', 'win32']]) {
    const command = `${frontDeskCommand(root, { platform })} cards`;
    const got = await runEntry('preToolUse', {
      stdin: Readable.from([JSON.stringify(call(tool, { command }))]),
      env: { COPILOT_CLI: '1' },
      deps: { client: up, stepDeps: { env: { COPILOT_CLI: '1' }, platform }, projectOf: () => ({ project: 'shop' }), dir: '/nowhere' },
    });
    assert.deepEqual(got, { text: '', code: 0 }, `${tool}: ${command}`);
  }
  // The same guards do refuse here: a launcher given text in double quotes.
  const refused = await runEntry('preToolUse', {
    stdin: Readable.from([JSON.stringify(call('bash', { command: 'wh-frontdesk card "a;b"' }))]),
    env: { COPILOT_CLI: '1' },
    deps: { client: up, stepDeps: { env: { COPILOT_CLI: '1' } }, projectOf: () => ({ project: 'shop' }), dir: '/nowhere' },
  });
  assert.equal(refused.code, 2);
});

test('the VS Code chat\'s environment, COPILOT_CLI alone, is the Copilot harness', async () => {
  const r = recording();
  const got = await run('preToolUse', call('powershell', { command: 'ls' }), { steps: r.steps, env: { COPILOT_CLI: '1' } });
  assert.deepEqual(got, { text: '', code: 0 });
  assert.ok(r.calls.length > 0);
});

test('a session start from another window\'s seat carries the id line and the window card through the entry', async () => {
  await withHome(async () => {
    const { seatFile } = await import('../../../../scripts/lib/first-mate-seat.js');
    const file = seatFile('shop');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const since = '2026-11-24T00:00:00.000Z';
    fs.writeFileSync(file, JSON.stringify({ session: 'a', pid: process.pid, pidStart: null, folder: PROJECT, since, seenAt: new Date().toISOString() }));
    const client = { ...up, state: { views: async () => ({ ok: true, views: {} }) }, session: { mark: async () => ({ ok: true }), seat: async () => ({ ok: true, holds: false }) } };
    const start = await run('sessionStart', { sessionId: 'chat-9', cwd: PROJECT }, { client, stepDeps: { sessionStart: { env: {}, projectOf: () => ({ project: 'shop' }) } } });
    assert.equal(start.code, 0);
    const said = JSON.parse(start.text);
    const context = said.hookSpecificOutput?.additionalContext ?? said.additionalContext ?? start.text;
    assert.match(context, /Your session id is chat-9: give it as --session chat-9/);
    assert.match(context, /isn't the First Mate: it is in another window/);
    assert.match(context, new RegExp(`Take over the First Mate from window session a, since ${since}`));
    assert.match(context, /confirm seat-take-over --session/);
    assert.doesNotMatch(context, /AskUserQuestion/);
  });
});

test('through the entry, a front-desk command that records is refused without the chat\'s own --session, and passes with it', async () => {
  const { frontDeskWrites, ...others } = recording().steps;
  const stepDeps = { frontDeskWrites: { env: {}, find: () => ({ project: 'shop', record: { folder: PROJECT } }), setUp: () => null, role: () => 'front-desk' } };
  const go = (command, extra = {}) => run('preToolUse', call('bash', { command }, { sessionId: 'chat-9', ...extra }), { steps: others, stepDeps });
  const bare = await go('wh-frontdesk cards');
  assert.equal(bare.code, 2);
  assert.match(bare.text, /--session chat-9/);
  assert.equal((await go('wh-frontdesk cards --session other')).code, 2);
  assert.equal((await go('wh-frontdesk confirm seat-take-over')).code, 2);
  assert.equal((await go('wh-frontdesk cards --session chat-9')).code, 0);
  assert.equal((await go('wh-frontdesk confirm seat-take-over --session chat-9')).code, 0);
  assert.equal((await go('wh-frontdesk views waiting')).code, 0, 'a read needs no id');
});

test('a why session never skips the STOP guard on a read tool, whichever environment the run or the step is given', async () => {
  const read = call('list_agents', {});
  const why = { WHEELHOUSE_ROLE: 'why' };
  assert.deepEqual(await run('preToolUse', read, { env: ENV }), { text: '', code: 0 });
  assert.equal((await run('preToolUse', read, { env: ENV, stepDeps: { stopGuard: { env: why } } })).code, 2);
});

test('the prompt deadline starts after the stop-word step, which keeps the guards\' time', async () => {
  const slowWord = async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'STOP is on' } };
  };
  const r = recording();
  const give = (extra) => runEntry('userPromptSubmitted', {
    stdin: Readable.from([JSON.stringify({ sessionId: 's1', cwd: PROJECT, prompt: 'STOP' })]),
    env: ENV,
    deps: { client: up, steps: { ...r.steps, stopWord: slowWord }, projectOf: () => ({ project: 'shop' }), dir: '/nowhere', deadlineMs: 2000, ...extra },
  });
  assert.match((await give({ promptDeadlineMs: 80 })).text, /STOP is on/);
  // The later steps are still held to the prompt deadline.
  const hung = await give({ promptDeadlineMs: 80, steps: { ...r.steps, stopWord: slowWord, boardContext: () => new Promise(() => {}) } });
  assert.deepEqual(hung, { text: '', code: 0 });
});

test('the card check is told whether an ask_user call takes typed answers, whatever the flag is spelt, and nothing when the call says nothing', async () => {
  const freeOf = async (args) => {
    const r = recording();
    await run('preToolUse', call('ask_user', { message: 'Ship it?', choices: ['Approve', 'Not now'], ...args }), { steps: r.steps, c6: true });
    const [question] = r.calls.find((c) => c.name === 'cardCheck').input.tool_input.questions;
    return question.allowFreeformInput;
  };
  assert.equal(await freeOf({}), undefined, 'nothing said: the card check takes it as allowing typed answers on a card that decides');
  for (const flag of ['allowFreeformInput', 'allow_freeform_input', 'allowFreeform', 'freeform', 'allowFreeText', 'free_text']) {
    assert.equal(await freeOf({ [flag]: true }), true, `${flag} true`);
    assert.equal(await freeOf({ [flag]: 'yes' }), true, `${flag} anything but false`);
    assert.equal(await freeOf({ [flag]: false }), false, `${flag} false`);
  }
  assert.equal(await freeOf({ allowFreeformInput: false, free_text: true }), true, 'one flag on is enough');
  assert.equal(await freeOf({ allowFreeformInput: false, requestedSchema: { properties: { note: { type: 'string' } } } }), true, 'a field of words');
});
