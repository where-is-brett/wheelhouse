// tests/scripts/agents/copilot-eval-runner.test.js
// The Copilot adapter's evaluation runner (Part 8 Task 3; rulings P8-25 to P8-28): one session through `copilot -p`
// from a clean home of its own, its events translated into the stream-json the scenarios read, `raw` kept beside
// them, and the safety subset the version check runs. No real Copilot runs: every session here is the stand-in script
// tests/fixtures/copilot/eval/fake-copilot.js, stand-ins for gh, glab and copilot come first on the PATH, and the last
// test asserts none of them ran but the one call made on purpose to show the PATH's copilot is the stand-in.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalText, finishedOf, handledOf, runSession, sessionIdOf, toolCalls, usageOf } from '../../../scripts/eval/harness.js';
import { EVAL_PROJECT } from '../../../scripts/eval/standard-project.js';
import { adapterFor, checkAdapter } from '../../../scripts/agents/index.js';
import copilot from '../../../adapters/copilot/index.js';
import claudeCode from '../../../adapters/claude-code/index.js';
import {
  EVAL_TARGET, SIGN_IN_VARIABLE, rawEvents, rawText, run, signInSource, translateEvents, writeEvalHome,
} from '../../../adapters/copilot/eval-runner.js';
import { copilotHome, file as hookFile } from '../../../adapters/copilot/hooks.js';
import { SIGN_IN_KEYS, SUBSET, WIDE_FLAGS, safetySubset } from '../../../adapters/copilot/sessions.js';
import { tempFolder } from '../../helpers/homes.js';
import { standInTools } from '../../helpers/host-stand-ins.js';

const stand = standInTools();
after(() => stand.restore());

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'copilot');
const FAKE = path.join(FIXTURES, 'eval', 'fake-copilot.js');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const sessionEvents = (name) => {
  const value = fixture(path.join('sessions', name));
  return Array.isArray(value) ? value : value.events;
};

// A scratch sign-in source, so no test reads the person's Copilot home.
const signIn = tempFolder('wh-cer-sign-in-');
fs.writeFileSync(path.join(signIn, 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'someone' }], trustedFolders: ['/anywhere'], model: 'model-a' }));
const signInWas = process.env[SIGN_IN_VARIABLE];
process.env[SIGN_IN_VARIABLE] = signIn;
after(() => {
  if (signInWas === undefined) delete process.env[SIGN_IN_VARIABLE];
  else process.env[SIGN_IN_VARIABLE] = signInWas;
});

// A scratch project (a git repository) and a scratch Wheelhouse home, both in the temporary folder.
function scratch() {
  const dir = fs.realpathSync(tempFolder('wh-cer-project-'));
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  const home = fs.realpathSync(tempFolder('wh-cer-home-'));
  return { dir, home };
}

// A session through the stand-in, printing the fixture at `file`; resolves with the outcome and what the stand-in saw.
async function viaStandIn(file, { env = {}, ...options } = {}) {
  const { dir, home } = scratch();
  const log = path.join(tempFolder('wh-cer-log-'), 'started.json');
  const outcome = await run({ dir, prompt: 'Say hello.', env: { WHEELHOUSE_HOME: home, ...env }, command: process.execPath, commandArgs: [FAKE, file, log], ...options });
  return { outcome, saw: JSON.parse(fs.readFileSync(log, 'utf8')), dir, home };
}

function fixtureFile(value) {
  const file = path.join(tempFolder('wh-cer-fixture-'), 'fixture.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test('the translation gives the harness\'s readers what the run did: its calls, its last words, its id, that it finished, and its tokens (P8-25)', () => {
  const finished = translateEvents(sessionEvents('finished-run.json'), { dir: '/project' });
  assert.deepEqual(toolCalls(finished), [{ name: 'Read', input: { file_path: '<WORKTREE>/README.md' } }]);
  assert.match(finalText(finished), /\S/);
  assert.equal(finalText(finished), sessionEvents('finished-run.json').findLast((e) => e.type === 'assistant.message' && e.data.content !== '').data.content);
  assert.equal(sessionIdOf(finished), '<ID>');
  assert.equal(finishedOf({ events: finished, exitCode: 0 }), true);
  assert.deepEqual(usageOf(finished), { input: 0, output: 0 });
  assert.equal(handledOf({ events: finished, exitCode: 0 }), true);
  // The tool's result reaches the harness's reader of results.
  const result = finished.find((e) => e.type === 'user').message.content[0];
  assert.equal(result.is_error, false);
  assert.match(result.content, /secret word/);

  const refused = translateEvents(sessionEvents('refusal.json'));
  assert.deepEqual(toolCalls(refused), [{ name: 'Bash', input: { command: 'touch unruled.txt', description: 'Create unruled.txt' } }]);
  const refusal = refused.find((e) => e.type === 'user').message.content[0];
  assert.equal(refusal.is_error, true);
  assert.match(refusal.content, /no interactive user response was available/);
  assert.equal(finishedOf({ events: refused, exitCode: 0 }), true);

  // A run with no result event did not finish; tokens come from sessionUsage's counts.
  assert.equal(finishedOf({ events: translateEvents(sessionEvents('finished-run.json').filter((e) => e.type !== 'result')), exitCode: 0 }), false);
  const counted = translateEvents([{ type: 'result', sessionId: 's1', exitCode: 0 }], { usage: { tokens: { input: 10, output: 4, cache_read: 3, cache_write: 2 } } });
  assert.deepEqual(usageOf(counted), { input: 15, output: 4 });
  assert.equal(translateEvents([{ type: 'result', sessionId: 's1', exitCode: 1 }]).at(-1).is_error, true);
});

test('a tool the translation doesn\'t know keeps its own name, an MCP tool gets its MCP name, an apply_patch is one Edit naming every path, and a sub-agent\'s call names its parent', () => {
  const events = translateEvents([
    { type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'multi_tool_use.parallel', arguments: { tool_uses: [] } } },
    { type: 'tool.execution_start', data: { toolCallId: 'b', toolName: 'probe58-echo', arguments: { text: 'hi' } } },
    { type: 'tool.execution_start', data: { toolCallId: 'c', toolName: 'apply_patch', arguments: '*** Begin Patch\n*** Add File: a.txt\n+a\n*** Update File: b.txt\n+b\n*** End Patch\n' } },
    { type: 'tool.execution_start', data: { toolCallId: 'd', toolName: 'view', arguments: { path: 'x' }, parentToolCallId: 'p1' } },
    { type: 'tool.execution_start', data: { toolCallId: 'e', toolName: 'brand_new_tool', arguments: 'plain' } },
  ], { dir: '/project' });
  const calls = toolCalls(events);
  assert.deepEqual(calls.map((c) => c.name), ['multi_tool_use.parallel', 'mcp__probe58__echo', 'Edit', 'Read', 'brand_new_tool']);
  assert.deepEqual(calls[2].input.file_paths, ['a.txt', 'b.txt']);
  assert.deepEqual(calls[4].input, { arguments: 'plain' });
  assert.equal(events[3].parent_tool_use_id, 'p1');
  assert.equal(events[0].parent_tool_use_id, null);
  // A line that isn't JSON is kept, so it shows; rawText gives the readers the events alone.
  const raw = rawEvents('{"type":"result","sessionId":"s"}\nnot json\n');
  assert.deepEqual(raw, [{ type: 'result', sessionId: 's' }, { type: 'unparsed', line: 'not json' }]);
  assert.equal(rawText(raw), '{"type":"result","sessionId":"s"}');
});

test('a session runs `copilot -p` from a clean home of its own in the scratch Wheelhouse home, with Ask\'s rules, --no-ask-user and no allow-everything flag, and answers runSession\'s outcome with `raw` kept (P8-25)', async () => {
  const events = sessionEvents('finished-run.json');
  const { outcome, saw, dir, home } = await viaStandIn(fixtureFile({ events, usage: { tokenDetails: { input: { tokenCount: 7 }, output: { tokenCount: 3 } } } }), { model: 'model-a', env: { GH_TOKEN: 'never-passed', COPILOT_ALLOW_ALL: '1' } });
  assert.deepEqual(Object.keys(outcome).sort(), ['events', 'exitCode', 'handled', 'raw', 'totalUsage', 'usage']);
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.handled, true);
  assert.deepEqual(outcome.raw, events);
  assert.deepEqual(outcome.usage, { input: 7, output: 3 });
  assert.equal(finishedOf(outcome), true);

  const { args } = saw;
  assert.equal(args[args.indexOf('-p') + 1], 'Say hello.');
  for (const flag of ['--no-ask-user', '--disallow-temp-dir', '--disable-builtin-mcps', '--no-auto-update']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--output-format') + 1], 'json');
  assert.equal(args[args.indexOf('--model') + 1], 'model-a');
  assert.ok(args.includes('--allow-tool=write'));
  assert.ok(!args.some((a) => a === '--allow-tool=shell'), 'Ask never allows the whole shell');
  assert.ok(args.includes('--deny-tool=shell(copilot:*)'));
  assert.ok(args.some((a) => a === `--deny-tool=write(${home.split(path.sep).join('/')}/**)`), 'the scratch Wheelhouse home is shut to writes');
  assert.ok(!args.some((a) => WIDE_FLAGS.some((w) => a === w || a.startsWith(`${w}=`))));
  assert.ok(!args.some((a) => a.startsWith('--resume')));
  assert.equal(fs.realpathSync(saw.cwd), dir);

  // The environment: COPILOT_HOME is the session's home, in the scratch Wheelhouse home; no token, no allow-all.
  const own = path.join(home, 'projects', EVAL_PROJECT, 'copilot-home', EVAL_TARGET);
  assert.equal(saw.env.COPILOT_HOME, own);
  assert.equal(saw.env.WHEELHOUSE_HOME, home);
  assert.equal(saw.env.GH_TOKEN, undefined);
  assert.equal(saw.env.COPILOT_ALLOW_ALL, undefined);
  // The home holds Wheelhouse's hooks, the kit's agents and the sign-in keys alone.
  assert.ok(fs.statSync(hookFile({ home: own })).isFile());
  const config = JSON.parse(fs.readFileSync(path.join(own, 'config.json'), 'utf8'));
  assert.deepEqual(Object.keys(config), ['loggedInUsers']);
  assert.ok(Object.keys(config).every((key) => SIGN_IN_KEYS.includes(key)));
  assert.ok(fs.readdirSync(path.join(own, 'agents')).length > 0);
});

test('a resumed turn passes --resume=<id>, a scenario\'s commands are one shell rule each, and a home the set-up wrote is used as it is', async () => {
  const { home } = scratch();
  const own = writeEvalHome(home);
  fs.writeFileSync(path.join(own, 'marker'), 'the set-up\'s own');
  const { saw } = await (async () => {
    const { dir } = scratch();
    const log = path.join(tempFolder('wh-cer-log-'), 'started.json');
    await run({ dir, prompt: 'Go on.', resume: 'c0ffee00-1', commands: ['node /x/cli.js'], env: { WHEELHOUSE_HOME: home, COPILOT_HOME: own }, command: process.execPath, commandArgs: [FAKE, fixtureFile({ events: [] }), log] });
    return { saw: JSON.parse(fs.readFileSync(log, 'utf8')) };
  })();
  assert.equal(saw.args[0], '--resume=c0ffee00-1');
  assert.ok(saw.args.includes('--allow-tool=shell(node /x/cli.js:*)'));
  assert.equal(saw.env.COPILOT_HOME, own);
  assert.ok(fs.existsSync(path.join(own, 'marker')), 'the set-up\'s home was not written again');
});

test('a session refuses to start without a scratch Wheelhouse home, outside the temporary folder, from a home outside it, or with what a rule or the command line can\'t hold', async () => {
  const { dir, home } = scratch();
  const call = (options) => run({ dir, prompt: 'Say hello.', env: { WHEELHOUSE_HOME: home }, command: process.execPath, commandArgs: [FAKE, fixtureFile({ events: [] }), path.join(home, 'log.json')], ...options });
  await assert.rejects(call({ env: {} }), /scratch Wheelhouse home/);
  await assert.rejects(call({ env: { WHEELHOUSE_HOME: path.join(os.homedir(), '.wheelhouse') } }), /outside the temporary folder|real Wheelhouse home/);
  await assert.rejects(call({ env: { WHEELHOUSE_HOME: home, COPILOT_HOME: tempFolder('wh-cer-elsewhere-') } }), /must lie in its scratch Wheelhouse home/);
  const bare = path.join(home, 'projects', EVAL_PROJECT, 'copilot-home', 'feature-bare');
  fs.mkdirSync(bare, { recursive: true });
  await assert.rejects(call({ env: { WHEELHOUSE_HOME: home, COPILOT_HOME: bare } }), /no Wheelhouse hook file/);
  await assert.rejects(call({ prompt: '--yolo' }), /can't start with a dash/);
  await assert.rejects(call({ model: 'model a; rm' }), /model/);
  await assert.rejects(call({ resume: '../x' }), /resumed/);
  for (const bad of ['node *', 'a,b', 'x(y)', 'line\nbreak', '']) await assert.rejects(call({ commands: [bad] }), /plain command line/);
  await assert.rejects(run({ dir: os.homedir(), prompt: 'x', env: { WHEELHOUSE_HOME: home } }), /outside the temporary folder/);
});

test('the sign-in comes from the evaluation\'s own source when one is named, never one that is the person\'s own Copilot home under another name', () => {
  assert.equal(signInSource({ env: { [SIGN_IN_VARIABLE]: signIn } }), signIn);
  assert.equal(signInSource({ env: {} }), copilotHome());
  assert.throws(() => signInSource({ env: { [SIGN_IN_VARIABLE]: copilotHome() } }), /your own Copilot home/);
  assert.throws(() => signInSource({ env: { [SIGN_IN_VARIABLE]: path.join(os.homedir(), '.copilot') } }), /your own Copilot home/);
  assert.throws(() => signInSource({ env: { [SIGN_IN_VARIABLE]: 'relative/home' } }), /whole path/);
});

test('with no command given, the session starts the copilot the PATH finds first: here the stand-in, which notes the call and refuses, so no real Copilot runs', async () => {
  stand.reset();
  const { dir, home } = scratch();
  const outcome = await run({ dir, prompt: 'Say hello.', env: { WHEELHOUSE_HOME: home } });
  assert.equal(outcome.exitCode, 1);
  assert.equal(outcome.handled, false);
  assert.match(outcome.stderr, /copilot is not run in this test/);
  const calls = stand.calls();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^copilot -p Say hello\. --output-format json /);
  stand.reset();
});

test('the safety subset runs `npm run eval`\'s command on 6 and 38 to 41, with variant, through Copilot\'s runner, as a program of its own, and passes only when it exits 0 (P8-20)', async () => {
  assert.deepEqual(SUBSET, [6, 38, 39, 40, 41]);
  const asked = [];
  const runWith = (answer) => async (file, args, options) => { asked.push({ file, args, options }); if (answer instanceof Error) throw answer; return answer; };
  const passed = await safetySubset({ versions: { cli: '7.0.1' }, run: runWith({ code: 0, stdout: '', stderr: '' }) });
  assert.deepEqual(passed, { ok: true, versions: { cli: '7.0.1' }, code: 0 });
  assert.equal(asked[0].file, process.execPath);
  assert.deepEqual(asked[0].args, [path.join(ROOT, 'scripts', 'eval', 'run.js'), '6', '38', '39', '40', '41', '--variant', 'with', '--agent', 'copilot']);
  assert.equal(asked[0].options.cwd, ROOT);
  assert.equal((await safetySubset({ run: runWith({ code: 1, stdout: '', stderr: '' }) })).ok, false);
  assert.equal((await safetySubset({ run: runWith({ code: 0, timedOut: true, stdout: '', stderr: '' }) })).ok, false);
  assert.equal((await safetySubset({ run: runWith(new Error('no node')) })).ok, false);
  // The command it starts reads those arguments as the director's own run would.
  const { parseArgs } = await import('../../../scripts/eval/harness.js');
  assert.deepEqual(parseArgs(asked[0].args.slice(1)), { ids: SUBSET, variants: ['with'], trials: 1, agent: 'copilot' });
  // The part as shipped hands the version check this subset.
  assert.match(fs.readFileSync(path.join(ROOT, 'adapters', 'copilot', 'sessions.js'), 'utf8'), /^export default sessionsPart\(\{ versions: \{ runSubset: safetySubset \} \}\);$/m);
});

test('each adapter\'s evaluation runner is one session: Claude Code\'s is runSession, Copilot\'s is this runner, and neither part is pending', () => {
  assert.equal(claudeCode.evalRunner.run, runSession);
  assert.equal(typeof copilot.evalRunner.run, 'function');
  assert.deepEqual(copilot.pending, ['settings']);
  assert.deepEqual(checkAdapter(copilot), []);
  assert.deepEqual(checkAdapter(claudeCode), []);
  assert.equal(adapterFor('copilot').evalRunner, copilot.evalRunner);
});

test('no production module imports the evaluation runner but the adapter\'s index, only when a session is asked for, and run.js reaches it only through adapterFor', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter((f) => /\.(c|m)?js$/.test(f));
  const production = tracked.filter((f) => !/^(tests|probes|docs|\.superpowers|\.claude)\//.test(f));
  const importers = production.filter((f) => f !== 'adapters/copilot/eval-runner.js' && /eval-runner/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(importers, ['adapters/copilot/index.js']);
  const index = fs.readFileSync(path.join(ROOT, 'adapters', 'copilot', 'index.js'), 'utf8');
  assert.doesNotMatch(index, /^import[^\n]*eval-runner/m);
  assert.match(index, /await import\('\.\/eval-runner\.js'\)/);
  const runJs = fs.readFileSync(path.join(ROOT, 'scripts', 'eval', 'run.js'), 'utf8');
  assert.match(runJs, /adapterFor\(agent\)\.evalRunner\.run/);
  assert.doesNotMatch(runJs, /copilot/i);
  // Nothing the watcher, the foreman, setup, the helper or the hooks run imports the evaluation's code.
  const paths = production.filter((f) => /^(scripts\/(watcher|foreman|setup|host|hooks)\/|adapters\/copilot\/sessions\.js$)/.test(f));
  for (const file of paths) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /(?:from|import\()\s*'(?:\.\.\/)+(?:scripts\/)?eval\//, `${file} imports the evaluation's code`);
});

test('no real gh, glab or copilot ran in this file (P7-23)', () => {
  assert.deepEqual(stand.calls(), []);
});
