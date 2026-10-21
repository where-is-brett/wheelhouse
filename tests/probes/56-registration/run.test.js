// tests/probes/56-registration/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../helpers/homes.js';
import {
  CHECK, EVENTS, FOLDERS, OFF_FILE, TAGS, claudeSettingsFile, copilotArgs, countHooks, describeCounts, firstSeen, flatHooksFile, hookCommand,
  hookLogLines, main, materialisePlugin, parseOptions, plan, summarise, twice,
} from '../../../probes/56-registration/run.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const runJs = fileURLToPath(new URL('../../../probes/56-registration/run.js', import.meta.url));
const pluginSource = fileURLToPath(new URL('../../../probes/56-registration/plugin/', import.meta.url));

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf8'));

test('the plugin fixture has both manifests with different names, and a hook file for each layout, each with its own tag', () => {
  const root = readJson(pluginSource, 'plugin.json');
  const claude = readJson(pluginSource, '.claude-plugin', 'plugin.json');
  assert.match(root.$schema, /^https:\/\/agent-plugins\.org\/schemas\/1\.0\.0\//);
  assert.notEqual(root.name, claude.name);
  const legacy = readJson(pluginSource, 'hooks', 'hooks.json');
  const agent = readJson(pluginSource, 'com.github.copilot', 'hooks', 'hooks.json');
  for (const [file, tag] of [[legacy, 'plugin-legacy'], [agent, 'plugin-agent']]) {
    assert.deepEqual(Object.keys(file.hooks).sort(), [...EVENTS].sort());
    for (const event of EVENTS) {
      const [hook] = file.hooks[event];
      assert.equal(hook.type, 'command');
      assert.equal(hook.bash, `node "__LOGGER__" "__LOG__" ${tag} ${event}`);
      assert.equal(hook.powershell, hook.bash);
    }
  }
});

test('materialisePlugin fills in the logger and log paths, keeps JSON valid for any path, and leaves the fixture alone', () => {
  const dest = path.join(tempFolder('wh-plugin-'), 'copy');
  const log = 'C:\\Users\\a "b"\\hooks.jsonl';
  const logger = '/x y/logger.js';
  const before = fs.readFileSync(path.join(pluginSource, 'hooks', 'hooks.json'), 'utf8');
  materialisePlugin({ dest, log, logger });
  const hooks = readJson(dest, 'hooks', 'hooks.json');
  assert.equal(hooks.hooks.preToolUse[0].bash, `node "${logger}" "${log}" plugin-legacy preToolUse`);
  assert.equal(readJson(dest, 'com.github.copilot', 'hooks', 'hooks.json').hooks.sessionStart[0].bash, `node "${logger}" "${log}" plugin-agent sessionStart`);
  for (const file of ['plugin.json', path.join('.claude-plugin', 'plugin.json')]) assert.ok(fs.existsSync(path.join(dest, file)));
  const all = fs.readdirSync(dest, { recursive: true }).filter((name) => name.endsWith('.json')).map((name) => fs.readFileSync(path.join(dest, name), 'utf8')).join('');
  assert.ok(!all.includes('__LOG'));
  assert.equal(fs.readFileSync(path.join(pluginSource, 'hooks', 'hooks.json'), 'utf8'), before);
});

test('the project and home hook files register the logger on both events, in their own format', () => {
  const spec = { logger: '/l.js', log: '/log.jsonl' };
  assert.equal(hookCommand({ ...spec, tag: 'github-hooks', event: 'preToolUse' }), 'node "/l.js" "/log.jsonl" github-hooks preToolUse');
  const flat = flatHooksFile({ ...spec, tag: 'home-hooks' });
  assert.equal(flat.version, 1);
  assert.deepEqual(Object.keys(flat.hooks), ['sessionStart', 'preToolUse']);
  assert.equal(flat.hooks.sessionStart[0].bash, 'node "/l.js" "/log.jsonl" home-hooks sessionStart');
  const claude = claudeSettingsFile({ ...spec, tag: 'claude-settings' });
  assert.deepEqual(Object.keys(claude.hooks), ['SessionStart', 'PreToolUse']);
  assert.equal(claude.hooks.PreToolUse[0].matcher, '*');
  assert.equal(claude.hooks.PreToolUse[0].hooks[0].command, 'node "/l.js" "/log.jsonl" claude-settings preToolUse');
  assert.equal(claude.hooks.SessionStart[0].matcher, undefined);
  assert.deepEqual(OFF_FILE, { version: 1, disableAllHooks: true, hooks: {} });
});

test('plan runs each folder as it is and then with the off file, for each trust setting, and the arguments follow the brief', () => {
  const all = plan();
  assert.equal(all.length, 12);
  assert.equal(new Set(all.map((run) => run.id)).size, 12);
  assert.deepEqual(all.slice(0, 6).map((run) => `${run.folder}:${run.off}`), ['main:false', 'worktree:false', 'plain:false', 'main:true', 'worktree:true', 'plain:true']);
  assert.ok(all.slice(0, 6).every((run) => run.trusted === false));
  assert.ok(all.slice(6).every((run) => run.trusted === true));
  assert.deepEqual([...new Set(all.map((run) => run.folder))], FOLDERS);
  assert.equal(plan({ trust: 'yes' }).length, 6);
  assert.ok(plan({ trust: 'yes' }).every((run) => run.trusted));
  assert.ok(plan({ trust: 'no' }).every((run) => !run.trusted));
  const args = copilotArgs({ trusted: false, logDir: '/logs' });
  assert.deepEqual(args.slice(0, 2), ['-p', 'Read README.md and say done']);
  assert.ok(args.join(' ').includes('--allow-tool view'));
  assert.ok(!args.includes('--trust-folder'));
  assert.ok(copilotArgs({ trusted: true, logDir: '/logs' }).includes('--trust-folder'));
});

test('parseOptions takes the options and refuses what it does not know', () => {
  const options = parseOptions(['--dry-run', '--trust', 'yes', '--bin', '/b', '--timeout-ms', '5', '--results-dir', '/r']);
  assert.deepEqual({ ...options }, { dryRun: true, trust: 'yes', bin: '/b', timeoutMs: 5, resultsDir: '/r' });
  assert.equal(parseOptions([]).dryRun, false);
  assert.equal(parseOptions([]).trust, 'both');
  assert.throws(() => parseOptions(['--go']), /Unknown option/);
  assert.throws(() => parseOptions(['--trust', 'maybe']), /--trust/);
  assert.throws(() => parseOptions(['--timeout-ms', 'soon']), /--timeout-ms/);
});

test('countHooks counts each tag per event with zeros, firstSeen keeps the first sample, twice finds repeats', () => {
  const entries = [
    { tag: 'home-hooks', event: 'sessionStart', input: { n: 1 } },
    { tag: 'home-hooks', event: 'sessionStart', input: { n: 2 } },
    { tag: 'plugin-agent', event: 'preToolUse', input: {} },
    { tag: 'surprise', event: 'agentStop', input: {} },
    { unparsed: 'x' },
  ];
  const counts = countHooks(entries);
  assert.deepEqual(counts['home-hooks'], { sessionStart: 2, preToolUse: 0 });
  assert.deepEqual(counts['claude-settings'], { sessionStart: 0, preToolUse: 0 });
  assert.deepEqual(counts.surprise, { agentStop: 1 });
  assert.deepEqual(Object.keys(counts).slice(0, TAGS.length), TAGS);
  assert.deepEqual(twice(counts), ['home-hooks:sessionStartx2']);
  assert.match(describeCounts(counts), /home-hooks\[start=2 tool=0\]/);
  const seen = firstSeen([{ id: 'a', hookEntries: entries.slice(0, 1) }, { id: 'b', hookEntries: entries.slice(0, 2) }]);
  assert.equal(seen['home-hooks'].sessionStart.run, 'a');
  assert.equal(seen['home-hooks'].sessionStart.entry.input.n, 1);
});

test('hookLogLines keeps only lines about hooks and plugins, hides tokens and tolerates a missing folder', () => {
  const dir = tempFolder('wh-logs-');
  fs.writeFileSync(path.join(dir, 'a.log'), ['starting', 'Loaded hooks from /x', `plugin ghp_${'a'.repeat(20)} ok`, 'unrelated'].join('\n'));
  const lines = hookLogLines(dir);
  assert.deepEqual(lines, ['Loaded hooks from /x', 'plugin [redacted] ok']);
  assert.deepEqual(hookLogLines(path.join(dir, 'nope')), []);
  assert.equal(hookLogLines(dir, { max: 1 }).length, 1);
});

// What the stand-in does, so the plumbing can be checked against known numbers (fake-copilot.js: the repository's hooks load only when trusted,
// the off file turns off the home's and the project's, the plugin's always load).
function checkStandInNumbers(results) {
  assert.equal(results.error, null);
  assert.deepEqual(results.pluginList, ['wheelhouse-probe-56-root']);
  assert.equal(results.runs.length, 12);
  for (const run of results.runs) {
    assert.equal(run.code, 0, run.id);
    const one = (tag) => run.hookCounts[tag];
    assert.deepEqual(one('plugin-agent'), { sessionStart: 1, preToolUse: 1 }, run.id);
    assert.deepEqual(one('plugin-legacy'), { sessionStart: 1, preToolUse: 1 }, run.id);
    const project = run.trusted && !run.off ? 1 : 0;
    const home = run.off && run.trusted ? 0 : 1;
    for (const tag of ['claude-settings', 'github-hooks']) assert.deepEqual(one(tag), { sessionStart: project, preToolUse: project }, `${run.id} ${tag}`);
    assert.deepEqual(one('home-hooks'), { sessionStart: home, preToolUse: home }, `${run.id} home-hooks`);
    assert.ok(run.hookEntries.every((entry) => entry.cwd), run.id);
    assert.ok(run.hookEntries.every((entry) => entry.input.sessionId === 'stand-in'));
    assert.ok(run.copilotLogLines.length > 0, run.id);
    assert.ok(Array.isArray(run.args) && run.args.includes('-p'));
  }
  const folders = new Set(results.runs.map((run) => run.cwd));
  assert.equal(folders.size, 3);
  assert.equal(results.firstSeen['home-hooks'].sessionStart.run, 'main-untrusted-on');
  assert.equal(results.firstSeen['github-hooks'].preToolUse.run, 'main-trusted-on');
}

t('--dry-run runs the whole plan against the stand-in, writes the raw results, and undoes everything it made', async () => {
  const resultsDir = tempFolder('wh-results-');
  const lines = [];
  const { results, file } = await main(['--dry-run', '--results-dir', resultsDir], { out: (line) => lines.push(line) });
  assert.equal(file, path.join(resultsDir, `${CHECK}.dry-run.json`));
  checkStandInNumbers(results);
  assert.deepEqual(readJson(file).runs.map((run) => run.id), results.runs.map((run) => run.id));
  // The summary says how many model runs there were, the numbers, and where the raw results are.
  assert.match(lines[0], /12 model run/);
  assert.ok(lines.some((line) => line.includes('plugin-agent[start=1 tool=1]')));
  assert.equal(lines.at(-1), `Raw results: ${file}`);
  // Everything it made is gone: the project, the worktree, the copy, the home and the work folder.
  for (const run of results.runs) assert.ok(!fs.existsSync(run.cwd), run.cwd);
  assert.ok(!fs.existsSync(path.dirname(results.bin)));
  assert.equal(fs.readdirSync(resultsDir).length, 1);
});

t('a Copilot that fails every run still gives results with zero counts, and the folders are still undone', async () => {
  const resultsDir = tempFolder('wh-results-');
  process.env.WHEELHOUSE_FAKE_FAIL = '1';
  try {
    const { results } = await main(['--dry-run', '--trust', 'yes', '--results-dir', resultsDir], { out: () => {} });
    assert.equal(results.error, null);
    assert.equal(results.runs.length, 6);
    for (const run of results.runs) {
      assert.equal(run.code, 1);
      assert.match(run.stderr, /Not signed in/);
      assert.deepEqual(twice(run.hookCounts), []);
      assert.ok(Object.values(run.hookCounts).every((byEvent) => Object.values(byEvent).every((n) => n === 0)));
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
  const result = spawnSync(process.execPath, [runJs, '--dry-run', '--trust', 'no', '--results-dir', resultsDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /6 model run/);
  assert.match(result.stdout, /Raw results: .*56-registration\.dry-run\.json/);
  const bad = spawnSync(process.execPath, [runJs, '--dry-run', '--nope'], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});
