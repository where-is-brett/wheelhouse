// tests/probes/61-sessions/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../helpers/homes.js';
import {
  CHECK, ID_ORDER, authFailed, callsMentioning, copilotArgs, describeEnv, isolatedEnv, listFiles, main, offeredTools, parseOptions, replyOf,
  savedPermissionFiles, selectRuns, sessionIdOf, stepsPrompt, shellStep, summarise, toolCalls, viewStep, createStep,
} from '../../../probes/61-sessions/run.js';
import { copilotEnv } from '../../../probes/lib/copilot.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const dir = (name) => fileURLToPath(new URL(`../../../probes/61-sessions/${name}`, import.meta.url));
const byId = (results, id) => results.runs.find((run) => run.id === id);

test('options: defaults do the full run, and bad options are refused', () => {
  const options = parseOptions([]);
  assert.equal(options.dryRun, false);
  assert.equal(options.only, null);
  assert.deepEqual(selectRuns(options.only), ID_ORDER);
  assert.equal(parseOptions(['--dry-run', '--timeout-ms', '5', '--only', 'lists,chains', '--results-dir', '/x']).timeoutMs, 5);
  assert.throws(() => parseOptions(['--nope']), /Unknown option/);
  assert.throws(() => parseOptions(['--timeout-ms', 'x']), /milliseconds/);
  assert.throws(() => parseOptions(['--only', 'made-up']), /no such run/);
});

test('a rerun of resume-id or continue brings headless along; the order stays', () => {
  assert.deepEqual(selectRuns(['continue']), ['headless', 'continue']);
  assert.deepEqual(selectRuns(['chains', 'resume-id']), ['headless', 'resume-id', 'chains']);
  assert.deepEqual(selectRuns(['paths']), ['paths']);
});

test('prompts name each step, and the arguments carry the flags every run shares', () => {
  const prompt = stepsPrompt([shellStep('echo x && rm y1'), viewStep('/a/b'), createStep('/a/c', 'w')]);
  assert.match(prompt, /1\. Use the shell tool to run exactly: `echo x && rm y1`/);
  assert.match(prompt, /2\. Use the view tool to view `\/a\/b`\./);
  assert.match(prompt, /3\. Use the create tool to create `\/a\/c` containing the word w\./);
  const args = copilotArgs({ prompt: 'p', logDir: '/l', extra: ['--allow-tool=write'], lead: ['--continue'] });
  assert.deepEqual(args.slice(0, 3), ['--continue', '-p', 'p']);
  for (const flag of ['--output-format', 'json', '--no-auto-update', '--no-ask-user', '--allow-tool=write', '--log-dir', '/l', '--log-level', 'debug']) assert.ok(args.includes(flag), flag);
  assert.equal(copilotArgs({ prompt: 'p', logDir: '/l', noAsk: false }).includes('--no-ask-user'), false);
});

test('an isolated session gets PATH, HOME, TMPDIR, LANG and its own COPILOT_HOME, and nothing the parent had', () => {
  const parent = { PATH: '/bin', HOME: '/real', TMPDIR: '/t', LANG: 'en_AU.UTF-8', COPILOT_ALLOW_ALL: 'true', COPILOT_HOME: '/saved', GH_TOKEN: 'x', FOO: 'bar' };
  const env = isolatedEnv({ parent, home: '/own', userHome: '/person' });
  const final = copilotEnv({ env, home: '/own', baseEnv: parent });
  assert.deepEqual(final, { PATH: '/bin', HOME: '/person', TMPDIR: '/t', LANG: 'en_AU.UTF-8', COPILOT_HOME: '/own' });
  // Missing TMPDIR and LANG in the parent still give a usable environment.
  const bare = copilotEnv({ env: isolatedEnv({ parent: { PATH: '/bin' }, home: '/own', userHome: '/p' }), home: '/own', baseEnv: { PATH: '/bin' } });
  assert.deepEqual(Object.keys(bare).sort(), ['COPILOT_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']);
});

test('the recorded environment keeps values only for COPILOT_* names', () => {
  const baseEnv = { PATH: '/bin', SECRET_THING: 'hunter2', COPILOT_ALLOW_ALL: 'true', COPILOT_MODEL: 'm' };
  const described = describeEnv({ env: { COPILOT_ALLOW_ALL: undefined }, home: '/own', baseEnv });
  assert.deepEqual(described.names, ['COPILOT_HOME', 'COPILOT_MODEL', 'PATH', 'SECRET_THING']);
  assert.deepEqual(described.copilotValues, { COPILOT_HOME: '/own', COPILOT_MODEL: 'm' });
  assert.ok(!JSON.stringify(described).includes('hunter2'));
});

test('saved-permission candidates name the folders given', () => {
  const files = savedPermissionFiles({ folders: ['/w', '/p'] });
  assert.equal(files['settings.json'].defaultPermissionMode, 'allow-all');
  assert.deepEqual(Object.keys(files['permissions-config.json'].locations), ['/w', '/p']);
});

test('Copilot own events give the session id, the reply, each call and what became of it', () => {
  const events = [
    { type: 'session.tools_updated', data: { tools: [{ name: 'view' }, { name: 'bash' }] } },
    { type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'bash', arguments: { command: 'echo x && rm y1' } } },
    { type: 'tool.execution_complete', data: { toolCallId: 'a', success: false, error: { code: 'denied', message: 'no' } } },
    { type: 'tool.execution_start', data: { toolCallId: 'b', toolName: 'view', arguments: { path: '/p' } } },
    { type: 'tool.execution_complete', data: { toolCallId: 'b', success: true } },
    { type: 'assistant.message', data: { content: 'one' } },
    { type: 'assistant.message', data: { content: 'two' } },
    { type: 'result', sessionId: 'sid', exitCode: 0 },
  ];
  assert.equal(sessionIdOf(events), 'sid');
  assert.equal(replyOf(events), 'one\ntwo');
  assert.deepEqual(offeredTools(events), ['bash', 'view']);
  const calls = toolCalls(events);
  assert.deepEqual(calls.map((c) => [c.tool, c.success, c.code]), [['bash', false, 'denied'], ['view', true, null]]);
  assert.equal(callsMentioning(calls, 'rm y1').length, 1);
  assert.equal(sessionIdOf([]), null);
  // A completion with no start is still counted.
  assert.equal(toolCalls([{ type: 'tool.execution_complete', data: { toolCallId: 'z', toolName: 'glob', success: true } }])[0].tool, 'glob');
});

test('a run that failed before any reply counts as a sign-in failure', () => {
  assert.equal(authFailed({ code: 1, reply: '' }), true);
  assert.equal(authFailed({ code: 1, reply: 'hi' }), false);
  assert.equal(authFailed({ code: 0, reply: '' }), false);
});

test('listFiles lists a home with sizes, folders first-level marked, and survives a missing folder', () => {
  const home = tempFolder('wh-home-');
  fs.mkdirSync(path.join(home, 'a'));
  fs.writeFileSync(path.join(home, 'a', 'b.json'), '{}');
  assert.deepEqual(listFiles(home), ['a/', path.join('a', 'b.json') + ' (2 bytes)']);
  assert.deepEqual(listFiles(path.join(home, 'none')), []);
});

t('--dry-run makes every run, writes the raw results, and undoes everything it made', async () => {
  const resultsDir = tempFolder('wh-results-');
  const printed = [];
  const { results, file } = await main(['--dry-run', '--results-dir', resultsDir], { out: (line) => printed.push(line) });
  assert.equal(results.error, null);
  assert.equal(file, path.join(resultsDir, `${CHECK}.dry-run.json`));
  assert.deepEqual(results.runs.map((run) => run.id), ID_ORDER.flatMap((id) => (id === 'isolated' ? [id, 'isolated-real-home'] : [id])));
  assert.match(printed[0], /16 model run/);
  assert.equal(printed.at(-1), `Raw results: ${file}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).runs.map((run) => run.id), results.runs.map((run) => run.id));
  assert.equal(fs.readdirSync(resultsDir).length, 1);
  for (const run of results.runs) assert.ok(!fs.existsSync(run.cwd), run.cwd);
  assert.ok(!fs.existsSync(path.dirname(results.bin)));
  assert.match(summarise(results), /isolated-real-home/);
});

t('the stand-in answers the way the run reads it: resume, lists, chains, isolation and paths', async () => {
  const { results } = await main(['--dry-run', '--results-dir', tempFolder('wh-results-')], { out: () => {} });
  const headless = byId(results, 'headless');
  assert.ok(headless.sessionId);
  assert.ok(headless.args.includes('--output-format'));
  assert.equal(headless.args.includes('--no-ask-user'), false);
  assert.ok(byId(results, 'resume-id').args.includes(`--resume=${headless.sessionId}`));
  assert.deepEqual([byId(results, 'resume-id').checks.sameSessionId, byId(results, 'resume-id').checks.secretRecalled], [true, true]);
  assert.deepEqual([byId(results, 'continue').checks.sameSessionId, byId(results, 'continue').checks.secretRecalled], [true, true]);
  assert.equal(byId(results, 'agent').checks.agentWordInReply, true);
  assert.deepEqual(byId(results, 'lists').toolCalls.map((c) => c.code), [null, 'denied', 'denied']);
  assert.equal(byId(results, 'deny-over-all').checks['denied-by-deny.txtExists'], false);
  assert.equal(byId(results, 'unruled').toolCalls[0].code, 'denied');
  // A strict rule lets the chained commands and sh -c through to nothing: y1..y4 all still exist.
  const chains = byId(results, 'chains');
  assert.deepEqual([chains.checks.controlRan, chains.checks.y1Exists, chains.checks.y2Exists, chains.checks.y3Exists, chains.checks.y4Exists], [true, true, true, true, true]);
  assert.deepEqual(chains.checks.attempted, [true, true, true, true]);
  // The allow-everything variable acts in a plain run, and an isolated session does not carry it.
  assert.equal(byId(results, 'env-control').checks['env-control.txtExists'], true);
  const isolated = byId(results, 'isolated');
  assert.deepEqual(isolated.env.names, ['COPILOT_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']);
  assert.deepEqual(Object.keys(isolated.env.copilotValues), ['COPILOT_HOME']);
  assert.equal(isolated.code, 1);
  assert.equal(byId(results, 'isolated-real-home').checks['isolated.txtExists'], false);
  // Paths: held to the worktree with the temporary folder shut off, open to it without the flag.
  const held = byId(results, 'paths').checks;
  assert.deepEqual([held.insideCreated, held.viaLinkCreatedOutside, held.directCreatedOutside, held.markerSeen, held.otherTempSeen], [true, false, false, false, false]);
  const open = byId(results, 'paths-control').checks;
  assert.deepEqual([open.viaLinkCreatedOutside, open.otherTempSeen], [true, true]);
  // No sign-in or other secret is in what is recorded about the environment.
  for (const run of results.runs) for (const name of Object.keys(run.env.copilotValues)) assert.match(name, /^COPILOT_/);
});

t('a shell rule that matches on the first word alone lets a chained command through, and the run sees it', async () => {
  process.env.WHEELHOUSE_FAKE_NAIVE = '1';
  try {
    const { results } = await main(['--dry-run', '--only', 'chains', '--results-dir', tempFolder('wh-results-')], { out: () => {} });
    const chains = byId(results, 'chains');
    assert.deepEqual([chains.checks.y1Exists, chains.checks.y2Exists], [false, false]);
    assert.equal(chains.checks.y3Exists, true);
    assert.equal(chains.checks.y4Exists, true);
  } finally {
    delete process.env.WHEELHOUSE_FAKE_NAIVE;
  }
});

t('a Copilot that fails every run still gives results, and the folders are still undone', async () => {
  process.env.WHEELHOUSE_FAKE_FAIL = '1';
  try {
    const { results } = await main(['--dry-run', '--only', 'headless,lists', '--results-dir', tempFolder('wh-results-')], { out: () => {} });
    assert.equal(results.error, null);
    assert.deepEqual(results.runs.map((run) => run.id), ['headless', 'lists']);
    for (const run of results.runs) { assert.equal(run.code, 1); assert.match(run.stderr, /Not signed in/); assert.ok(!fs.existsSync(run.cwd)); }
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
  const result = spawnSync(process.execPath, [dir('run.js'), '--dry-run', '--results-dir', resultsDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Raw results: .*61-sessions\.dry-run\.json/);
});
