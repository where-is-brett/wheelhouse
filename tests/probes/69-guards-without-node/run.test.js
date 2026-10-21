// tests/probes/69-guards-without-node/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../../scripts/lib/run.js';
import { tempFolder } from '../../helpers/homes.js';
import {
  ANSWERS, CASES, CHECK, PROMPT, TOOLS, caseEnv, copilotArgs, countRequests, deadPort, findOnPath, guardCommand, hookFiles, main,
  makeToolPath, nativeBin, parseGuardLog, parseOptions, proveNodeAbsent, startAnswerServer, summarise, verdictOf, warningEvents,
} from '../../../probes/69-guards-without-node/run.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const guard = fileURLToPath(new URL('../../../probes/69-guards-without-node/guard.sh', import.meta.url));

// Runs guard.sh with a PATH that has no Node.js (asynchronously, because the answer server is in this process).
async function runGuard({ url, input = '{"toolName":"view","toolArgs":"{}"}', env = {} }) {
  const work = tempFolder('wh-guard69-');
  const bin = path.join(work, 'bin');
  const tools = makeToolPath(bin, process.execPath, ['sh', 'curl', 'cat', 'date', 'sed', 'tr', 'env']);
  fs.rmSync(path.join(bin, 'copilot'));
  assert.deepEqual(tools.missing, []);
  const log = path.join(work, 'g.log');
  const result = await run('/bin/sh', [guard, url, log], { input, baseEnv: {}, env: { PATH: bin, ...env }, timeoutMs: 30_000 });
  return { result, records: parseGuardLog(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}

t('guard.sh lets an allow answer through, refuses a deny answer, and logs that Node.js is not on its PATH', async () => {
  const answers = await startAnswerServer();
  try {
    const url = `http://127.0.0.1:${answers.port}/answer`;
    answers.state.answer = 'allow';
    let { result, records } = await runGuard({ url });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(records.length, 1);
    assert.equal(records[0].decision, 'allow');
    assert.equal(records[0].node, '');
    assert.equal(records[0].tool, 'view');
    assert.equal(records[0].curl_exit, '0');
    assert.ok(!/node/.test(records[0].path.replace(/wh-guard69-/, '')), records[0].path);
    // The server was given the hook input.
    assert.equal(answers.state.requests.length, 1);
    assert.equal(answers.state.requests[0].method, 'POST');
    assert.match(answers.state.requests[0].body, /"toolName":"view"/);

    answers.state.answer = 'deny';
    ({ result, records } = await runGuard({ url }));
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).permissionDecision, 'deny');
    assert.ok(JSON.parse(result.stdout).permissionDecisionReason);
    assert.equal(records[0].decision, 'deny');
  } finally {
    answers.server.close();
  }
});

t('guard.sh refuses when nothing answers, when the answer is an error, and when it is not one it knows', async () => {
  const port = await deadPort();
  let { result, records } = await runGuard({ url: `http://127.0.0.1:${port}/answer` });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).permissionDecision, 'deny');
  assert.match(JSON.parse(result.stdout).permissionDecisionReason, /No answer/);
  assert.equal(records[0].decision, 'deny');
  assert.notEqual(records[0].curl_exit, '0');

  const answers = await startAnswerServer();
  try {
    // /web-post answers {}: a 200 that is neither allow nor deny.
    ({ result, records } = await runGuard({ url: `http://127.0.0.1:${answers.port}/web-post` }));
    assert.equal(JSON.parse(result.stdout).permissionDecision, 'deny');
    assert.match(JSON.parse(result.stdout).permissionDecisionReason, /not one the guard understands/);
    // A URL the server does not answer sensibly at all (a bad address) also refuses.
    ({ result } = await runGuard({ url: 'not a url' }));
    assert.equal(JSON.parse(result.stdout).permissionDecision, 'deny');
  } finally {
    answers.server.close();
  }
});

t('guard.sh keeps only Copilot\'s own variables, and hides the ones that look like secrets', async () => {
  const port = await deadPort();
  const { records } = await runGuard({ url: `http://127.0.0.1:${port}/x`, env: { COPILOT_CLI_BINARY_VERSION: '9.9.9', COPILOT_API_TOKEN: 'sekret', OTHER_THING: 'nope' } });
  assert.match(records[0].copilot_env, /COPILOT_CLI_BINARY_VERSION=9\.9\.9/);
  assert.match(records[0].copilot_env, /COPILOT_API_TOKEN=\[set\]/);
  assert.ok(!/sekret|OTHER_THING|nope/.test(JSON.stringify(records)));
});

t('the tool folder holds only the listed tools and Copilot, and Node.js is not found through it', () => {
  const bin = path.join(tempFolder('wh-toolpath-'), 'bin');
  const tools = makeToolPath(bin, '/bin/echo');
  assert.deepEqual(tools.missing, []);
  assert.deepEqual(fs.readdirSync(bin).sort(), [...TOOLS, 'copilot'].sort());
  assert.equal(fs.realpathSync(path.join(bin, 'copilot')), fs.realpathSync('/bin/echo'));
  const proof = proveNodeAbsent(bin);
  assert.equal(proof.nodeAbsent, true);
  assert.equal(proof.node, '');
  assert.ok(proof.curl.endsWith('/curl'));
  assert.match(proof.git, /git version/);
  assert.equal(findOnPath('definitely-not-a-program-69'), null);
  assert.ok(findOnPath('sh'));
});

test('the native program is found inside the platform package, not through the npm launcher', () => {
  assert.equal(nativeBin('/p', { platform: 'darwin', arch: 'arm64' }), path.join('/p', 'node_modules', '@github', 'copilot-darwin-arm64', 'copilot'));
  assert.equal(nativeBin('/p', { platform: 'win32', arch: 'x64' }), path.join('/p', 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe'));
});

test('the hook files register the shell guard as a command hook and the web hooks as http hooks', () => {
  const guardFiles = hookFiles({ kind: 'guard', base: 'http://127.0.0.1:5', guard: '/g.sh', log: '/l.log' });
  assert.deepEqual(Object.keys(guardFiles), ['probe-guard.json']);
  const entry = guardFiles['probe-guard.json'].hooks.preToolUse[0];
  assert.equal(entry.type, 'command');
  assert.equal(entry.bash, '/bin/sh "/g.sh" "http://127.0.0.1:5/answer" "/l.log"');
  assert.equal(entry.bash, guardCommand({ guard: '/g.sh', url: 'http://127.0.0.1:5/answer', log: '/l.log' }));
  const web = hookFiles({ kind: 'web', base: 'http://127.0.0.1:5' })['probe-web.json'].hooks;
  assert.deepEqual(web.preToolUse[0], { type: 'http', url: 'http://127.0.0.1:5/web-pre', timeoutSec: 5 });
  assert.deepEqual(web.postToolUse[0], { type: 'http', url: 'http://127.0.0.1:5/web-post', timeoutSec: 5 });
  assert.throws(() => hookFiles({ kind: 'x' }), /Unknown hook kind/);
});

test('the cases, the arguments and the environment are what the plan says', () => {
  assert.deepEqual(CASES.map((c) => c.id), ['guard-allow', 'guard-deny', 'guard-down', 'web-up', 'web-down']);
  const args = copilotArgs({ logDir: '/logs' });
  for (const flag of ['--allow-all-tools', '--trust-folder', '--no-ask-user']) assert.ok(args.includes(flag), flag);
  assert.equal(args[1], PROMPT);
  assert.deepEqual(caseEnv({ kind: 'guard', binDir: '/b' }), { PATH: '/b' });
  assert.deepEqual(caseEnv({ kind: 'web', binDir: '/b' }), { PATH: '/b', COPILOT_HOOK_ALLOW_LOCALHOST: '1' });
  assert.deepEqual(parseOptions([]).dryRun, false);
  assert.deepEqual({ ...parseOptions(['--dry-run', '--bin', '/b', '--timeout-ms', '5', '--results-dir', '/r']) }, { dryRun: true, bin: '/b', timeoutMs: 5, resultsDir: '/r' });
  assert.throws(() => parseOptions(['--go']), /Unknown option/);
  assert.throws(() => parseOptions(['--timeout-ms', 'x']), /--timeout-ms/);
});

test('the analysis reads the guard log, the verdict, the request counts and the warnings', () => {
  assert.deepEqual(parseGuardLog('a=1\nb=two=2\n--\nc=3\n--\n'), [{ a: '1', b: 'two=2' }, { c: '3' }]);
  assert.deepEqual(parseGuardLog(''), []);
  assert.equal(verdictOf({ secretSeen: true, outcomes: [] }), 'went-through');
  assert.equal(verdictOf({ secretSeen: false, outcomes: [{ code: 'denied' }] }), 'refused');
  assert.equal(verdictOf({ secretSeen: false, outcomes: [] }), 'unclear');
  assert.deepEqual(countRequests([{ url: '/a' }, { url: '/a' }, { url: '/b' }]), { '/a': 2, '/b': 1 });
  assert.deepEqual(warningEvents([{ type: 'session.warning' }, { type: 'tool.execution_complete' }, { type: 'session.tools_updated' }, { type: 'result' }]).map((e) => e.type), ['session.warning']);
  assert.equal(JSON.parse(ANSWERS.deny).permissionDecision, 'deny');
  assert.ok(JSON.parse(ANSWERS.deny).permissionDecisionReason);
});

t('--dry-run runs the whole plan against the stand-in with no Node.js on the PATH, writes the raw results, and undoes everything', async () => {
  const resultsDir = tempFolder('wh-results-');
  const printed = [];
  const { results, file } = await main(['--dry-run', '--results-dir', resultsDir], { out: (line) => printed.push(line) });
  assert.equal(results.error, null);
  assert.equal(file, path.join(resultsDir, `${CHECK}.dry-run.json`));
  assert.equal(results.pathProof.nodeAbsent, true);
  assert.deepEqual(results.runs.map((run) => run.id), CASES.map((c) => c.id));
  const byId = Object.fromEntries(results.runs.map((run) => [run.id, run]));
  // The guard: allow goes through, deny and a down server are refused (fail closed); Node.js was never on the hook's PATH.
  assert.equal(byId['guard-allow'].verdict, 'went-through');
  assert.equal(byId['guard-deny'].verdict, 'refused');
  assert.equal(byId['guard-down'].verdict, 'refused');
  for (const id of ['guard-allow', 'guard-deny', 'guard-down']) {
    assert.equal(byId[id].guardRecords.length, 1, id);
    assert.equal(byId[id].guardRecords[0].node, '', id);
  }
  assert.equal(byId['guard-allow'].serverCounts['/answer'], 1);
  assert.equal(byId['guard-down'].guardRecords[0].decision, 'deny');
  assert.notEqual(byId['guard-down'].guardRecords[0].curl_exit, '0');
  // The web hooks, as the stand-in treats them (made-up rules): the preToolUse one is not called, the postToolUse one is.
  assert.equal(byId['web-up'].serverCounts['/web-pre'], undefined);
  assert.equal(byId['web-up'].serverCounts['/web-post'], 1);
  assert.equal(byId['web-up'].env.COPILOT_HOOK_ALLOW_LOCALHOST, '1');
  assert.equal(byId['web-down'].verdict, 'went-through');
  assert.deepEqual(byId['web-down'].serverCounts, {});
  for (const run of results.runs) {
    assert.ok(run.args.includes('--allow-all-tools'), run.id);
    assert.equal(run.env.PATH, '[the tool folder]');
    assert.ok(!fs.existsSync(run.args[run.args.indexOf('--log-dir') + 1]), run.id);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).runs.map((run) => run.id), results.runs.map((run) => run.id));
  assert.match(printed[0], /5 model run/);
  assert.match(printed[0], /node absent/);
  assert.equal(printed.at(-1), `Raw results: ${file}`);
  assert.ok(!fs.existsSync(path.dirname(results.bin)));
  assert.equal(fs.readdirSync(resultsDir).length, 1);
  assert.match(summarise(results), /guard-down/);
});

t('with no Copilot program the probe stops before it makes anything, and says so in the results', async () => {
  const resultsDir = tempFolder('wh-results-');
  const { results } = await main(['--bin', path.join(resultsDir, 'nope'), '--results-dir', resultsDir], { out: () => {} });
  assert.match(results.error, /There is no Copilot program/);
  assert.deepEqual(results.runs, []);
  assert.match(summarise(results), /STOPPED EARLY/);
});
