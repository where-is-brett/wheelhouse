// tests/probes/58-hook-input/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../helpers/homes.js';
import { respond } from '../../../probes/58-hook-input/mcp.js';
import {
  CAMEL_EVENTS, CHECK, PASCAL_EVENTS, allToolsPrompt, askUserPrompt, categoryOf, copilotArgs, countHooks, hookCommand, hookFiles, inputKeys,
  main, mcpConfig, modeFields, toolOutcomes, parseOptions, projectFiles, samples, seenKeys, stepsFor, summarise, toolEvents, toolsByTag,
} from '../../../probes/58-hook-input/run.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const dir = (name) => fileURLToPath(new URL(`../../../probes/58-hook-input/${name}`, import.meta.url));
const runGuard = (log, mode, input, seconds) => spawnSync(process.execPath, [dir('guard.js'), log, 'camel', 'preToolUse', mode, ...(seconds ? [seconds] : [])], { input: JSON.stringify(input), encoding: 'utf8' });
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('the stand-in MCP server answers initialise, lists one tool echo, and echoes', () => {
  assert.equal(respond({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const init = respond({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual(respond({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools.map((tool) => tool.name), ['echo']);
  assert.equal(respond({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } }).result.content[0].text, 'echo: hi');
  assert.equal(respond({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }).error.code, -32602);
  assert.equal(respond({ jsonrpc: '2.0', id: 5, method: 'what' }).error.code, -32601);
});

t('the MCP server works over stdio', () => {
  const input = [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', method: 'notifications/initialized' }].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [dir('mcp.js')], { input, encoding: 'utf8' });
  const replies = result.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].result.tools[0].name, 'echo');
});

t('the guard logs the raw input in every mode, and answers only as its mode says', () => {
  const log = path.join(tempFolder('wh-guard-'), 'g.jsonl');
  const view = { toolName: 'view', toolArgs: '{"path":"a"}' };
  let result = runGuard(log, 'log', view);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  result = runGuard(log, 'deny', view);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).permissionDecision, 'deny');
  assert.ok(JSON.parse(result.stdout).permissionDecisionReason);
  assert.equal(runGuard(log, 'deny', { toolName: 'bash' }).stdout, '');
  assert.equal(JSON.parse(runGuard(log, 'deny', { tool_name: 'Read' }).stdout).permissionDecision, 'deny');
  assert.equal(runGuard(log, 'exit1', view).status, 1);
  assert.equal(runGuard(log, 'exit2', view).status, 2);
  const slept = runGuard(log, 'sleep', view, '0');
  assert.equal(slept.status, 0);
  const entries = lines(log);
  assert.equal(entries[0].phase, 'start');
  assert.equal(entries[0].raw, JSON.stringify(view));
  assert.deepEqual(entries[0].input, view);
  assert.equal(entries[0].tag, 'camel');
  assert.equal(entries[0].event, 'preToolUse');
  assert.ok(entries.at(-1).phase === 'woke');
  // Input that is not JSON is kept as it is.
  const bad = spawnSync(process.execPath, [dir('guard.js'), log, 't', 'e'], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.deepEqual(lines(log).at(-1).input, { unparsed: 'not json' });
});

test('the hook files register the guard both ways and only the camelCase preToolUse hook acts', () => {
  const files = hookFiles({ guard: '/g.js', log: '/l.jsonl', mode: 'sleep', seconds: 10, timeoutSec: 5 });
  assert.deepEqual(Object.keys(files), ['probe-camel.json', 'probe-pascal.json', 'probe-pascal-nested.json']);
  const camel = files['probe-camel.json'];
  assert.deepEqual(Object.keys(camel.hooks), CAMEL_EVENTS);
  assert.deepEqual(Object.keys(files['probe-pascal.json'].hooks), PASCAL_EVENTS);
  assert.equal(camel.hooks.preToolUse[0].bash, 'node "/g.js" "/l.jsonl" camel preToolUse sleep 10');
  assert.equal(camel.hooks.preToolUse[0].timeoutSec, 5);
  assert.equal(camel.hooks.postToolUse[0].bash, 'node "/g.js" "/l.jsonl" camel postToolUse log');
  assert.equal(camel.hooks.postToolUse[0].timeoutSec, 30);
  assert.equal(files['probe-pascal.json'].hooks.PreToolUse[0].bash, 'node "/g.js" "/l.jsonl" pascal PreToolUse log');
  assert.equal(files['probe-pascal.json'].hooks.PreToolUse[0].timeoutSec, 30);
  const nested = files['probe-pascal-nested.json'].hooks.PreToolUse[0];
  assert.equal(nested.matcher, '*');
  assert.equal(nested.hooks[0].command, 'node "/g.js" "/l.jsonl" pascal-nested PreToolUse log');
  assert.equal(hookFiles({ log: '/l', mode: 'log' })['probe-camel.json'].hooks.preToolUse[0].timeoutSec, 30);
  assert.equal(hookCommand({ log: '/l', tag: 'x', event: 'e' }).endsWith(' x e log'), true);
});

test('the MCP config and the project files are what the prompts rely on', () => {
  const config = mcpConfig({ node: '/n', mcp: '/m.js' });
  assert.deepEqual(config.mcpServers.probe58, { type: 'local', command: '/n', args: ['/m.js'], tools: ['*'] });
  const files = projectFiles('secret-1');
  assert.match(files['README.md'], /secret-1/);
  assert.equal(files['edit-me.txt'], 'alpha\n');
  assert.ok(files[path.join('.github', 'agents', 'probe-agent.agent.md')].includes('name: probe-agent'));
});

test('the prompts name each tool once, PowerShell only when pwsh exists, and arguments allow all tools', () => {
  const without = allToolsPrompt({ url: 'http://127.0.0.1:9/probe58', pwsh: false });
  const withPwsh = allToolsPrompt({ url: 'http://127.0.0.1:9/probe58', pwsh: true });
  assert.ok(!/powershell/i.test(without));
  assert.match(withPwsh, /powershell tool/);
  assert.equal(stepsFor({ pwsh: false }).length, 9);
  assert.equal(stepsFor({ pwsh: true }).length, 10);
  assert.match(without, /http:\/\/127\.0\.0\.1:9\/probe58/);
  assert.ok(!without.includes('__URL__'));
  for (const word of ['shell tool', 'view tool', 'edit tool', 'create tool', 'grep tool', 'glob tool', 'web fetch tool', 'task tool', 'echo tool']) assert.ok(without.includes(word), word);
  assert.ok(!without.includes('ask_user'));
  assert.match(askUserPrompt(), /ask_user tool/);
  assert.match(allToolsPrompt({ url: 'u', pwsh: false, keys: ['grep'] }), /^Do these steps[^]*1\. Use the grep tool[^]*Then say done\.$/);
  assert.ok(!allToolsPrompt({ url: 'u', pwsh: false, keys: ['grep'] }).includes('2. '));
  const args = copilotArgs({ prompt: 'p', logDir: '/logs', url: 'http://127.0.0.1:9/x' });
  assert.ok(args.includes('--allow-all-tools'));
  assert.ok(args.includes('--no-ask-user'));
  assert.ok(!copilotArgs({ prompt: 'p', logDir: '/l', askUser: true }).includes('--no-ask-user'));
  assert.equal(args[args.indexOf('--allow-url') + 1], '127.0.0.1');
});

test('categoryOf recognises tool names under either registration', () => {
  for (const [name, key] of [['bash', 'shell'], ['Bash', 'shell'], ['powershell', 'powershell'], ['view', 'view'], ['Read', 'view'], ['edit', 'edit'], ['create', 'create'], ['Write', 'create'], ['grep', 'grep'], ['Glob', 'glob'], ['web_fetch', 'web_fetch'], ['WebFetch', 'web_fetch'], ['task', 'task'], ['Agent', 'task'], ['ask_user', 'ask_user'], ['AskUserQuestion', 'ask_user'], ['probe58-echo', 'echo']]) {
    assert.equal(categoryOf(name), key, name);
  }
  assert.equal(categoryOf('unknown'), null);
  assert.equal(categoryOf(undefined), null);
});

test('the analysis counts, lists tools, keys, mode fields and samples from the hook log', () => {
  const entries = [
    { tag: 'camel', event: 'sessionStart', phase: 'start', input: { sessionId: 's', cwd: '/c' } },
    { tag: 'camel', event: 'preToolUse', phase: 'start', input: { toolName: 'bash', toolArgs: '{}', permissionMode: 'x' } },
    { tag: 'camel', event: 'preToolUse', phase: 'woke', input: { toolName: 'bash' } },
    { tag: 'pascal', event: 'PreToolUse', phase: 'start', input: { tool_name: 'Bash', tool_input: {} }, env: { COPILOT_SANDBOX: '1', COPILOT_HOME: '/h' } },
    { tag: 'pascal', event: 'PreToolUse', phase: 'start', input: { tool_name: 'Read', tool_input: {} } },
  ];
  const counts = countHooks(entries);
  assert.equal(counts.camel.preToolUse, 1);
  assert.equal(counts.pascal.PreToolUse, 2);
  assert.equal(counts['pascal-nested'].PreToolUse, 0);
  assert.deepEqual(toolsByTag(entries), { camel: ['bash'], pascal: ['Bash', 'Read'] });
  assert.deepEqual([...seenKeys(entries)].sort(), ['shell', 'view']);
  assert.deepEqual(inputKeys(entries).pascal.PreToolUse.Bash, ['tool_input', 'tool_name']);
  assert.deepEqual(inputKeys(entries).camel.sessionStart['(no tool)'], ['cwd', 'sessionId']);
  assert.deepEqual(modeFields(entries), { inputKeys: ['permissionMode'], envNames: ['COPILOT_SANDBOX'] });
  assert.deepEqual(Object.keys(samples(entries)).sort(), ['camel/preToolUse/bash', 'camel/sessionStart/(none)', 'pascal/PreToolUse/Bash', 'pascal/PreToolUse/Read']);
  assert.deepEqual(toolEvents([{ type: 'session.mcp_server_status_changed' }, { type: 'session.tools_updated' }, { type: 'tool.execution_complete' }, { type: 'result' }]).map((e) => e.type), ['tool.execution_complete']);
});

test('toolOutcomes pairs starts with completions and reads the refusal', () => {
  const events = [
    { type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'view' } },
    { type: 'tool.execution_complete', data: { toolCallId: 'a', success: false, error: { message: 'Denied by preToolUse hook: x', code: 'denied' } } },
    { type: 'tool.execution_start', data: { toolCallId: 'b', toolName: 'bash' } },
    { type: 'tool.execution_complete', data: { toolCallId: 'b', success: true } },
    { type: 'tool.execution_complete', data: { toolName: 'create', success: true } },
  ];
  assert.deepEqual(toolOutcomes(events), [
    { tool: 'view', success: false, error: 'Denied by preToolUse hook: x', code: 'denied' },
    { tool: 'bash', success: true, error: null, code: null },
    { tool: 'create', success: true, error: null, code: null },
  ]);
});

t('the guard keeps no value of the caller\'s environment, only Copilot\'s own', () => {
  const log = path.join(tempFolder('wh-guard-env-'), 'g.jsonl');
  spawnSync(process.execPath, [dir('guard.js'), log, 't', 'e'], { input: '{}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '/secret/place', COPILOT_CLI_BINARY_VERSION: '9.9.9' } });
  const { env } = lines(log)[0];
  assert.equal(env.CLAUDE_PROJECT_DIR, '[set]');
  assert.equal(env.COPILOT_CLI_BINARY_VERSION, '9.9.9');
});

test('parseOptions takes the options and refuses what it does not know', () => {
  const options = parseOptions(['--dry-run', '--bin', '/b', '--timeout-ms', '5', '--timeout-sec', '2', '--results-dir', '/r']);
  assert.deepEqual({ ...options }, { dryRun: true, bin: '/b', timeoutMs: 5, timeoutSec: 2, sleepSec: 7, resultsDir: '/r' });
  assert.equal(parseOptions([]).timeoutSec, 5);
  assert.equal(parseOptions([]).sleepSec, 10);
  assert.equal(parseOptions(['--sleep-sec', '3']).sleepSec, 3);
  assert.throws(() => parseOptions(['--go']), /Unknown option/);
  assert.throws(() => parseOptions(['--timeout-sec', 'x']), /--timeout-sec/);
});

// What the stand-in does (fake-copilot.js): each tool in the prompt gets its hooks run; a non-zero exit or a deny stops it; a time-out lets it through.
function checkStandInNumbers(results) {
  assert.equal(results.error, null);
  assert.deepEqual(results.runs.map((run) => run.id), ['all-tools', 'ask-user', 'deny-view', 'exit-1', 'exit-2', 'sleep']);
  const byId = Object.fromEntries(results.runs.map((run) => [run.id, run]));
  assert.deepEqual(byId['all-tools'].toolsByTag.camel, ['bash', 'view', 'edit', 'create', 'grep', 'glob', 'web_fetch', 'task', 'probe58-echo']);
  assert.deepEqual(byId['all-tools'].toolsByTag.pascal, ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'WebFetch', 'Agent', 'probe58-echo']);
  assert.deepEqual(byId['all-tools'].toolsByTag['pascal-nested'], byId['all-tools'].toolsByTag.pascal);
  assert.equal(byId['all-tools'].hookCounts.camel.sessionStart, 1);
  assert.equal(byId['all-tools'].hookCounts.camel.postToolUse, 9);
  assert.equal(byId['all-tools'].checks.secretSeen, true);
  assert.deepEqual(byId['deny-view'].toolOutcomes.map((o) => `${o.tool}:${o.success}`), ['view:false', 'create:true']);
  assert.equal(byId['all-tools'].checks.outTxt, 'went-through');
  const sample = results.samples['camel/preToolUse/view'];
  assert.equal(sample.input.toolName, 'view');
  assert.ok(results.samples['pascal/PreToolUse/Read'].input.tool_name === 'Read');
  assert.deepEqual(results.missing, []);
  assert.equal(results.askUserSeen, true);
  assert.equal(results.pwsh, false);
  assert.equal(results.copilotVersion.includes('stand-in'), true);
  // The four answers: deny stops view only, exit 1 and exit 2 stop both, a hook past its time-out lets both through.
  assert.deepEqual([byId['deny-view'].checks.secretSeen, byId['deny-view'].checks.outTxt], [false, 'went-through']);
  for (const id of ['exit-1', 'exit-2']) assert.deepEqual([byId[id].checks.secretSeen, byId[id].checks.outTxt], [false, null], id);
  assert.deepEqual([byId.sleep.checks.secretSeen, byId.sleep.checks.outTxt], [true, 'went-through']);
  assert.ok(!byId.sleep.hookEntries.some((entry) => entry.phase === 'woke'));
  for (const run of results.runs) assert.ok(run.args.includes('--allow-all-tools'), run.id);
}

t('--dry-run runs the whole plan against the stand-in, writes the raw results, and undoes everything it made', async () => {
  const resultsDir = tempFolder('wh-results-');
  const printed = [];
  const { results, file } = await main(['--dry-run', '--timeout-sec', '1', '--sleep-sec', '2', '--results-dir', resultsDir], { out: (line) => printed.push(line) });
  assert.equal(file, path.join(resultsDir, `${CHECK}.dry-run.json`));
  checkStandInNumbers(results);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).runs.map((run) => run.id), results.runs.map((run) => run.id));
  assert.match(printed[0], /6 model run/);
  assert.equal(printed.at(-1), `Raw results: ${file}`);
  for (const run of results.runs) assert.ok(!fs.existsSync(run.cwd), run.cwd);
  assert.ok(!fs.existsSync(path.dirname(results.bin)));
  assert.equal(fs.readdirSync(resultsDir).length, 1);
});

t('with pwsh present the prompt adds PowerShell', async () => {
  const resultsDir = tempFolder('wh-results-');
  const { results } = await main(['--dry-run', '--timeout-sec', '1', '--sleep-sec', '2', '--results-dir', resultsDir], { out: () => {}, pwsh: true });
  assert.equal(results.pwsh, true);
  assert.match(results.runs[0].args[1], /powershell tool/);
  // The stand-in does use PowerShell, under the name powershell, so nothing is missing and there is no gap-fill.
  assert.equal(results.runs.some((run) => run.id === 'gap-fill'), false);
  assert.deepEqual(results.missing, []);
});

t('a Copilot that fails every run still gives results, and the folders are still undone', async () => {
  const resultsDir = tempFolder('wh-results-');
  process.env.WHEELHOUSE_FAKE_FAIL = '1';
  try {
    const { results } = await main(['--dry-run', '--timeout-sec', '1', '--sleep-sec', '1', '--results-dir', resultsDir], { out: () => {} });
    assert.equal(results.error, null);
    assert.equal(results.runs[0].id, 'all-tools');
    assert.equal(results.runs[1].id, 'gap-fill');
    assert.ok(results.missing.length > 0);
    for (const run of results.runs) {
      assert.equal(run.code, 1);
      assert.match(run.stderr, /Not signed in/);
      assert.ok(!fs.existsSync(run.cwd));
    }
  } finally {
    delete process.env.WHEELHOUSE_FAKE_FAIL;
  }
});

t('with no Copilot installed the probe stops before it makes anything, and says so in the results', async () => {
  const resultsDir = tempFolder('wh-results-');
  const { results, file } = await main(['--bin', path.join(resultsDir, 'no-such-copilot'), '--results-dir', resultsDir], { out: () => {} });
  assert.match(results.error, /There is no Copilot at/);
  assert.equal(results.runs.length, 0);
  assert.equal(path.basename(file), `${CHECK}.json`);
  assert.match(summarise(results), /STOPPED EARLY/);
});

t('run.js --dry-run works as a command and prints where the raw results are', () => {
  const resultsDir = tempFolder('wh-results-');
  const result = spawnSync(process.execPath, [dir('run.js'), '--dry-run', '--timeout-sec', '1', '--sleep-sec', '1', '--results-dir', resultsDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Raw results: .*58-hook-input\.dry-run\.json/);
});
