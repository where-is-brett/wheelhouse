// tests/scripts/eval/archon-world.test.js
// The counted evaluation's world on real Archon (scripts/eval/archon-world.js), with a stand-in for Archon's command
// line, so no real Archon, Bun or Claude runs here: the world's engine folder passes the adapter's own health check as
// setup's install does, its health trial passes only when the guards held, the engine is built once, the real plays of
// 45, 46, 48 and 62 pass against it, a failed trial stops every real play, and the report says which played for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openArchonWorld, prepareEngine, runRealScenario, resetProof, cacheBuilt, sweepWorldInstalls, KITS } from '../../../scripts/eval/archon-world.js';
import { runEngineScenario } from '../../../scripts/eval/engine-world.js';
import { enginePaths, PATCH_MARK } from '../../../scripts/engine/archon/build.js';
import { summarise, summaryText } from '../../../scripts/eval/summary.js';

// A built engine as buildFromSource leaves it, as far as the world and the health check read it.
function fakeCache() {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-awc-'));
  const p = enginePaths(cache);
  for (const file of [p.bunBin, p.launcher, p.provider]) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(p.bunBin, '');
  fs.writeFileSync(p.launcher, '#!/bin/sh\n');
  fs.writeFileSync(p.provider, `// ${PATCH_MARK}\n`);
  return cache;
}

// Archon's command line as the adapter reads it: runs start running, a quick run's first step has spent `stepTokens`,
// cancel ends one, and the health trial's guarded step reports `refused`.
function standInArchon({ stepTokens = 25000, refused = true, trialFails = false } = {}) {
  const runs = new Map();
  const seen = [];
  let n = 0;
  const ok = (json) => ({ code: 0, json, stdout: `${JSON.stringify(json)}\n`, stderr: '' });
  const cli = async (args, options = {}) => {
    seen.push({ args, engine: options.engine, home: options.home });
    const [a, b, c] = args;
    if (a === 'version') return { code: 0, stdout: 'Archon CLI v0.13.0\n', stderr: '' };
    if (a === 'ai') return ok({ defaultAssistant: 'claude' });
    if (a === 'telemetry') return { code: 0, stdout: 'Telemetry: disabled\n', stderr: '' };
    if (a !== 'workflow') return { code: 1, stdout: '', stderr: 'not in the stand-in' };
    if (b === 'run') {
      const id = `run-${++n}`;
      const at = args.indexOf('--branch');
      const hello = c === 'wheelhouse-hello';
      runs.set(id, { status: hello ? (trialFails ? 'failed' : 'completed') : 'running', hello });
      return ok({ ok: true, runId: id, branch: at >= 0 ? args[at + 1] : `wh/${id}` });
    }
    if (b === 'get') {
      const run = runs.get(c);
      if (!run) return { code: 1, json: { ok: false }, stdout: '', stderr: 'no such run' };
      const spend = { tokens: { source: 'provider', value: { input: stepTokens, output: 10 } }, costUsd: { source: 'provider', value: 0.01 } };
      const nodes = run.hello ? [] : [{ nodeId: 'implement', execution: { binding: { provider: 'claude' }, spend } }];
      const events = !run.hello ? [] : trialFails ? [
        { event_type: 'provider_event', step_name: 'guarded', data: { event: { type: 'tool_call_update', status: 'failed', output: 'PreToolUse:StructuredOutput hook error: Wheelhouse is holding edits and commands' } } },
        { event_type: 'workflow_failed', data: { error: "DAG workflow 'wheelhouse-hello' completed with failures: 'guarded'\nmore" } },
      ] : [{ event_type: 'node_completed', step_name: 'guarded', data: { node_output: JSON.stringify({ refused, blocked: false, assumptions: [] }) } }];
      return ok({ status: run.status, metadata: {}, nodes, events });
    }
    if (b === 'status') return ok({ runs: [...runs].filter(([, r]) => !r.hello).map(([id, r]) => ({ id, status: r.status, working_path: null })) });
    if (b === 'cancel') {
      const run = runs.get(c);
      if (run?.status !== 'running') return { code: 1, json: { ok: false, error: `Cannot cancel run with status '${run?.status}'` }, stdout: '', stderr: '' };
      run.status = 'cancelled';
      return ok({ ok: true });
    }
    if (b === 'attention' && args.includes('--watch')) {
      await new Promise((resolve) => { if (options.signal?.aborted) resolve(); else options.signal?.addEventListener('abort', resolve); });
      return { code: 0, stdout: '', stderr: '' };
    }
    if (b === 'attention') return ok({ items: [] });
    return { code: 1, stdout: '', stderr: 'not in the stand-in' };
  };
  return { cli, runs, seen };
}

// The world runs the broker's sh launcher and links folders, as on the Mac the engine runs on; not on native Windows.
const skip = process.platform === 'win32';
const bunRun = async () => ({ code: 0, stdout: '1.4.3\n', stderr: '' });
// Claude Code's settings folder for a world in a test: no record of installs, so the sweep finds nothing to take back.
const noClaudeConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-awcc-'));
const open = (archon, cache) => openArchonWorld({ cache, cli: archon.cli, bunRun, claudeBin: '/usr/bin/true', claudeConfig: noClaudeConfig });
const scenario = async (name) => (await import(`../../eval/build-loop/${name}.js`)).default;
const quick = (fn) => (f, o = {}) => fn(f, { ...o, ms: Math.min(o.ms ?? 20000, 20000) });
const { until } = await import('../../../scripts/eval/engine-world.js');
const wait = quick((f, o) => until(f, { every: 50, ...o }));

test("the world's engine folder is setup's install to the adapter: it passes the health check, and every command names the world's folders", { skip }, async () => {
  const cache = fakeCache();
  const archon = standInArchon();
  const before = process.env.WHEELHOUSE_HOME;
  const world = await open(archon, cache);
  try {
    assert.equal(process.env.WHEELHOUSE_HOME, world.home);
    const health = await world.engine.health();
    assert.deepEqual(health, { ok: true, findings: [] });
    assert.ok(archon.seen.every((s) => s.engine === path.join(world.home, 'engine') && s.home === `${world.home}-engine`));
    // The pack is built from this checkout, and the broker's launcher is the only gh.
    assert.ok(fs.existsSync(path.join(world.home, 'engine', 'pack', '.archon', 'workflows')));
    assert.match(fs.readFileSync(path.join(world.home, 'engine', 'broker', 'bin', 'gh'), 'utf8'), /scripts\/engine\/broker\/gh\.js/);
    // The project: a repository whose remote names it o/p, with its worktrees kept inside it.
    assert.match(fs.readFileSync(path.join(world.folder, '.archon', 'config.yaml'), 'utf8'), /path: \.wheelhouse\/worktrees/);
    assert.ok(fs.existsSync(path.join(world.root, 'o', 'p', 'HEAD')));
  } finally {
    await world.close();
  }
  assert.equal(process.env.WHEELHOUSE_HOME, before);
  assert.equal(fs.existsSync(world.root), false);
  assert.equal(fs.existsSync(cache), true, 'the cache outlives the world');
});

test('the health trial passes only when the engine is sound and its step was refused the .env', { skip }, async () => {
  const cache = fakeCache();
  for (const [refused, pass] of [[true, true], [false, false]]) {
    const world = await open(standInArchon({ refused }), cache);
    try {
      const got = await world.prove({ ms: 2000, every: 20 });
      assert.equal(got.ok, pass, got.why);
      if (!pass) assert.match(got.why, /guards didn't hold/);
    } finally {
      await world.close();
    }
  }
  // A trial that fails says why, from Archon's record: its error and the last refusal its step was given.
  const failing = await open(standInArchon({ trialFails: true }), cache);
  try {
    const got = await failing.prove({ ms: 2000, every: 20 });
    assert.equal(got.ok, false);
    assert.equal(got.why, "the health trial ended failed: DAG workflow 'wheelhouse-hello' completed with failures: 'guarded'; the step was told: PreToolUse:StructuredOutput hook error: Wheelhouse is holding edits and commands");
  } finally {
    await failing.close();
  }
  // An unpatched source is refused before anything runs.
  fs.writeFileSync(enginePaths(cache).provider, '// upstream\n');
  const archon = standInArchon();
  const world = await open(archon, cache);
  try {
    const got = await world.prove({ ms: 2000 });
    assert.equal(got.ok, false);
    assert.match(got.why, /patched build/);
    assert.ok(!archon.seen.some((s) => s.args[1] === 'run'));
  } finally {
    await world.close();
  }
});

test("the pinned skill kits are installed for the world's project before its first commit, and taken back when it closes", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-awk-'));
  const log = path.join(dir, 'calls');
  const claudeBin = path.join(dir, 'claude');
  fs.writeFileSync(claudeBin, `#!/bin/sh\necho "$PWD $*" >> '${log}'\n`, { mode: 0o755 });
  const archon = standInArchon();
  const world = await openArchonWorld({ cache: fakeCache(), cli: archon.cli, bunRun, claudeBin, claudeConfig: noClaudeConfig });
  const folder = world.folder;
  await world.close();
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(calls, [
    `${folder} plugin install superpowers@wheelhouse --scope project`,
    `${folder} plugin install mattpocock-skills@wheelhouse --scope project`,
    `${folder} plugin uninstall superpowers@wheelhouse --scope project`,
    `${folder} plugin uninstall mattpocock-skills@wheelhouse --scope project`,
  ]);
});

test("the sweep takes back only the kits a world left installed: a world gone or whose opener ended", async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-aws-')));
  const config = path.join(tmp, 'claude-config');
  const at = (name) => path.join(tmp, name, 'project');
  const [kit, other] = KITS;
  for (const name of ['wh-aw-left', 'wh-aw-open']) fs.mkdirSync(at(name), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'wh-aw-left', '.world-owner'), '424242\n');
  fs.writeFileSync(path.join(tmp, 'wh-aw-open', '.world-owner'), `${process.pid}\n`);
  const entries = {
    [kit]: [
      { scope: 'project', projectPath: at('wh-aw-gone') },
      { scope: 'project', projectPath: at('wh-aw-left') },
      { scope: 'project', projectPath: at('wh-aw-open') },
      { scope: 'project', projectPath: path.join(tmp, 'someone-else', 'project') },
      { scope: 'user' },
    ],
    [other]: [{ scope: 'project', projectPath: at('wh-aw-gone') }],
    'another-plugin@somewhere': [{ scope: 'project', projectPath: at('wh-aw-gone') }],
  };
  fs.mkdirSync(path.join(config, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: entries }));
  const calls = [];
  const run = async (bin, args, { cwd }) => { calls.push({ bin, args, cwd, there: fs.existsSync(cwd) }); return { code: 0, stdout: '', stderr: '' }; };
  const taken = await sweepWorldInstalls({ claudeBin: '/c/claude', configDir: config, tmp, runClaude: run, isAlive: (pid) => pid === process.pid });
  assert.deepEqual(calls.map((c) => [c.args.join(' '), c.cwd, c.there]), [
    [`plugin uninstall ${kit} --scope project`, at('wh-aw-gone'), true],
    [`plugin uninstall ${kit} --scope project`, at('wh-aw-left'), true],
    [`plugin uninstall ${other} --scope project`, at('wh-aw-gone'), true],
  ]);
  assert.ok(calls.every((c) => c.bin === '/c/claude'));
  assert.equal(taken.length, 3);
  // The folder made for a world that was gone goes again; a left-behind world's folder is left as it was found.
  assert.equal(fs.existsSync(path.join(tmp, 'wh-aw-gone')), false);
  assert.equal(fs.existsSync(at('wh-aw-left')), true);
  assert.deepEqual(await sweepWorldInstalls({ claudeBin: '/c/claude', configDir: path.join(tmp, 'none'), tmp, runClaude: run }), []);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the engine is built once into its cache, and a build cut short is moved aside, not removed', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-awp-'));
  const cache = path.join(parent, 'engine');
  const built = [];
  const build = async ({ engine }) => {
    built.push(engine);
    const p = enginePaths(engine);
    for (const file of [p.bunBin, p.launcher, p.provider]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); }
  };
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache, 'half'), '');
  assert.equal(await prepareEngine({ cache, build }), cache);
  assert.equal(await prepareEngine({ cache, build }), cache);
  assert.deepEqual(built, [cache]);
  assert.ok(cacheBuilt(cache));
  assert.equal(fs.readdirSync(parent).filter((n) => n.startsWith('engine.unfinished-')).length, 1);
});

for (const name of ['45-cap-blocked-card', '46-all-stop-cancels-runs', '48-unsigned-merge-refused', '62-non-fix-refused-while-red']) {
  test(`scenario ${name.split('-')[0]}'s real play passes on the world`, { skip }, async () => {
    const world = await open(standInArchon(), fakeCache());
    try {
      const got = await (await scenario(name)).engine.real(world, { until: wait });
      assert.equal(got.pass, true, got.why);
      assert.deepEqual(world.hostCalls, []);
    } finally {
      await world.close();
    }
  });
}

test("scenario 48's real play fails when the broker lets the unsigned merge through", { skip }, async () => {
  const world = await open(standInArchon(), fakeCache());
  try {
    // A signed approval where the play writes an unsigned one: the merge goes through, and the play says so.
    const put = world.put.bind(world);
    world.put = (kind, data, options = {}) => put(kind, data, kind === 'approval' ? {} : options);
    const got = await (await scenario('48-unsigned-merge-refused')).engine.real(world, { until: wait });
    assert.equal(got.pass, false);
    assert.match(got.why, /went through with an unsigned approval/);
  } finally {
    await world.close();
  }
});

test('on archon, a scenario with no real play plays its recording and says so; a failed health trial stops every real play', async () => {
  const got = await runEngineScenario({ scenario: await scenario('42-ask-answered-without-card'), engine: 'archon' });
  assert.equal(got.pass, true, got.why);
  assert.equal(got.played, 'recorded');

  resetProof();
  const opened = [];
  const failing = async () => {
    const world = { prove: async () => ({ ok: false, why: 'the engine isn\'t sound: no Bun' }), close: async () => {} };
    opened.push(world);
    return world;
  };
  const real = await scenario('48-unsigned-merge-refused');
  for (let i = 0; i < 2; i += 1) {
    const result = await runRealScenario({ scenario: real, open: failing, prepare: async () => '/cache', log: () => {} });
    assert.deepEqual(result, { pass: false, why: 'not played: the engine isn\'t sound: no Bun' });
  }
  assert.equal(opened.length, 1, 'the trial runs once a run');
  resetProof();
});

test('the report of a run on real Archon says which scenarios played for real and which were recorded', () => {
  const run = (id, played) => ({ id, suite: 'build-loop', title: `Scenario ${id}`, safety: false, variant: 'with', trial: 1, round: 'first', pass: true, handled: true, why: 'ok', usage: { input: 0, output: 0 }, file: null, played });
  const record = { v: 1, at: '2026-10-30T09:00:00.000Z', date: '2026-10-30', how: 'suite', engine: 'archon', version: '0.2.0', commit: 'abc', runs: [run(42, 'recorded'), run(46, 'real'), run(48, 'real')], finished: '2026-10-30T09:30:00.000Z' };
  const summary = summarise(record);
  assert.deepEqual(summary.rows.map((r) => [r.id, r.played]), [[42, 'recorded'], [46, 'real'], [48, 'real']]);
  assert.equal(summary.passed, true);
  const text = summaryText(summary);
  assert.match(text, /\*\*Played for real:\*\* 46, 48\. \*\*Recorded\*\*[^:]*: 42\./);
  assert.match(text, /on real Archon; no session runs/);
  assert.match(text, /\| 46 \| Scenario 46 \| build-loop \| pass \(real\) \|/);
});
