// tests/probes/50-switch-off/findings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NAMES, MARKERS, summarise, holds, agree, choose } from '../../../probes/50-switch-off/findings.js';
import { makeFixtures, parseOptions, findDesktopClaude, pluginNames, MODEL_PROMPT, runLive, live } from '../../../probes/50-switch-off/run.js';

const runJs = fileURLToPath(new URL('../../../probes/50-switch-off/run.js', import.meta.url));
const PLUGIN = `${NAMES.plugin}@wheelhouse-probe-switch`;

function init({ skills = [NAMES.skill, NAMES.untracked], agents = [NAMES.agent, `${NAMES.plugin}:${NAMES.agent}`], plugins = [PLUGIN], beforeModel = true } = {}) {
  return { skills, agents, slashCommands: [...skills, NAMES.command], plugins, beforeModel };
}

function trial(name, binary, fields) {
  return { name, binary, where: 'main', init: init(), hooksRan: [MARKERS.projectHook, MARKERS.pluginHook], turns: {}, git: null, ...fields };
}

const allOn = [MARKERS.skill, MARKERS.personal, MARKERS.command, MARKERS.projectAgentBare, MARKERS.pluginAgentScoped];

// What the documentation expects, for both copies of Claude Code.
function expected() {
  const out = [];
  for (const binary of ['terminal', 'desktop']) {
    out.push(trial('baseline', binary, {
      turns: { model: { markers: allOn }, 'typed-skill': { markers: [MARKERS.skill] }, 'typed-command': { markers: [MARKERS.command] } },
    }));
    out.push(trial('skill-overrides', binary, {
      init: { ...init({ skills: [NAMES.untracked] }), slashCommands: [NAMES.untracked] },
      turns: { model: { markers: [MARKERS.personal, MARKERS.projectAgentBare] }, 'typed-skill': { markers: [] }, 'typed-command': { markers: [] } },
    }));
    out.push(trial('skill-deny', binary, {
      turns: { model: { markers: [MARKERS.personal] }, 'typed-skill': { markers: [MARKERS.skill] }, 'typed-command': { markers: [MARKERS.command] } },
    }));
    out.push(trial('agent-deny', binary, { turns: { model: { markers: [MARKERS.skill, MARKERS.pluginAgentScoped] } } }));
    out.push(trial('hooks-off', binary, { hooksRan: [] }));
    out.push(trial('plugin-off', binary, { init: init({ plugins: [] }), hooksRan: [MARKERS.projectHook] }));
    out.push(trial('sandbox-project', binary, { turns: { sandbox: { wrote: false } } }));
    out.push(trial('sandbox-local-off', binary, { turns: { sandbox: { wrote: true } } }));
    out.push(trial('next-session-off', binary, { init: { ...init({ skills: [] }), slashCommands: [] } }));
    out.push(trial('next-session-on', binary, {}));
    out.push(trial('next-session-off-again', binary, { init: { ...init({ skills: [] }), slashCommands: [] } }));
  }
  return out;
}

test('holds and agree read both copies of Claude Code together', () => {
  assert.equal(holds({ terminal: true, desktop: true }), true);
  assert.equal(holds({ terminal: true, desktop: false }), false);
  assert.equal(holds({ terminal: true, desktop: null }), null);
  assert.equal(holds({}), null);
  assert.equal(agree({ terminal: 'project', desktop: 'project' }), 'project');
  assert.deepEqual(agree({ terminal: 'project', desktop: 'plugin' }), { differs: { terminal: 'project', desktop: 'plugin' } });
  assert.equal(agree({}), null);
});

test('with the documented behaviour, each kind gets its local-settings route', () => {
  const found = summarise(expected());
  assert.deepEqual(found.route.skill, { route: 'setting', file: '.claude/settings.local.json', key: 'skillOverrides.<name>', value: 'off', typedRefused: true });
  assert.deepEqual(found.route.command, { route: 'setting', file: '.claude/settings.local.json', key: 'skillOverrides.<name>', value: 'off', typedRefused: true });
  assert.deepEqual(found.route.agent, {
    route: 'setting', file: '.claude/settings.local.json', key: 'permissions.deny', add: 'Agent(<name>)', typedRefused: null, blocksSameNamedPluginAgent: false,
  });
  assert.equal(found.route.hook.route, 'none', 'disableAllHooks stops the plugin\'s hooks too, so it is no route');
  assert.equal(found.candidates.hook[0].pluginHooksStopToo, true);
  assert.deepEqual(found.typedRefused, { skill: true, command: true });
  assert.equal(found.pluginOff, true);
  assert.equal(found.sandboxOff, true);
  assert.equal(found.sameName, 'project');
  assert.equal(found.untrackedLoads, true);
  assert.equal(found.nextSession, true);
  assert.equal(found.initBeforeModel, true);
  assert.equal(found.candidates.agent[0].scopedPluginAgentStillRuns, true);
});

test('a skill deny that leaves the typed /<name> running is used only when nothing better holds', () => {
  const trials = expected().filter((one) => one.name !== 'skill-overrides');
  const found = summarise(trials);
  assert.deepEqual(found.route.skill, { route: 'setting', file: '.claude/settings.local.json', key: 'permissions.deny', add: 'Skill(<name>)', typedRefused: false });
  assert.deepEqual(found.route.command, { route: 'setting', file: '.claude/settings.local.json', key: 'permissions.deny', add: 'Skill(<name>)', typedRefused: false });
  assert.deepEqual(found.typedRefused, { skill: false, command: false });
});

test('a command is judged on Claude using it as well as on the typed /<name>', () => {
  // skillOverrides refuses the typed command, but Claude still ran it: that candidate fails.
  const trials = expected().map((one) => (one.name === 'skill-overrides'
    ? { ...one, turns: { ...one.turns, model: { markers: [...one.turns.model.markers, MARKERS.command] } } }
    : one));
  const found = summarise(trials);
  assert.equal(found.candidates.command[0].holds, false);
  assert.equal(found.candidates.command[0].keptFromClaude, false);
  assert.equal(found.candidates.command[0].typedRefused, true);
  assert.equal(found.route.command.add, 'Skill(<name>)');
  // The skill's own route is not changed by it.
  assert.equal(found.route.skill.key, 'skillOverrides.<name>');
});

test('Claude is asked to use the command too, in its own step', () => {
  assert.match(MODEL_PROMPT, new RegExp(`Skill tool with the skill "${NAMES.command}"`));
  assert.match(MODEL_PROMPT, /five steps/);
  // The agent steps keep the prompts their markers are named for.
  assert.match(MODEL_PROMPT, /"step3"/);
  assert.match(MODEL_PROMPT, /"step4"/);
});

test('when nothing holds, a skill, agent or command route is the move', () => {
  const trials = expected().map((one) => (one.name === 'agent-deny'
    ? { ...one, turns: { model: { markers: [MARKERS.projectAgentBare] } } }
    : one));
  const found = summarise(trials);
  assert.deepEqual(found.route.agent, { route: 'move' });
  assert.equal(found.route.hook.route, 'none');
  assert.equal(typeof found.route.hook.instead, 'string');
});

test('an agent deny that also stops the plugin\'s agent of the same name says so', () => {
  const blocks = expected().map((one) => (one.name === 'agent-deny' ? { ...one, turns: { model: { markers: [MARKERS.skill] } } } : one));
  const found = summarise(blocks);
  assert.equal(found.route.agent.route, 'setting');
  assert.equal(found.route.agent.blocksSameNamedPluginAgent, true);
  // One copy blocking it is enough to say it does.
  const oneCopy = expected().map((one) => (one.name === 'agent-deny' && one.binary === 'desktop' ? { ...one, turns: { model: { markers: [MARKERS.skill] } } } : one));
  assert.equal(summarise(oneCopy).route.agent.blocksSameNamedPluginAgent, true);
  // Untried when the plugin's agent never ran by its scoped name in the baseline.
  const neverRan = expected().map((one) => (one.name === 'baseline'
    ? { ...one, turns: { ...one.turns, model: { markers: allOn.filter((m) => m !== MARKERS.pluginAgentScoped) } } }
    : one));
  assert.equal(summarise(neverRan).route.agent.blocksSameNamedPluginAgent, null);
});

test('a hook switch that leaves plugin hooks running is a route', () => {
  const trials = expected().map((one) => (one.name === 'hooks-off' ? { ...one, hooksRan: [MARKERS.pluginHook] } : one));
  const found = summarise(trials);
  assert.deepEqual(found.route.hook, { route: 'setting', file: '.claude/settings.local.json', key: 'disableAllHooks', value: true, typedRefused: null });
});

test('the copies disagreeing is reported, not averaged', () => {
  const trials = expected().map((one) => (one.name === 'baseline' && one.binary === 'desktop'
    ? { ...one, turns: { ...one.turns, model: { markers: [MARKERS.skill, MARKERS.pluginAgentBare] } } }
    : one));
  assert.deepEqual(summarise(trials).sameName, { differs: { terminal: 'project', desktop: 'plugin' } });
});

test('an init event that needed a prompt means initBeforeModel is false', () => {
  const trials = expected();
  trials[0] = { ...trials[0], init: { ...trials[0].init, beforeModel: false } };
  assert.equal(summarise(trials).initBeforeModel, false);
});

test('no trials: every answer is null or untried', () => {
  const found = summarise([]);
  assert.equal(found.pluginOff, null);
  assert.equal(found.sandboxOff, null);
  assert.equal(found.sameName, null);
  assert.equal(found.initBeforeModel, null);
  assert.deepEqual(choose([], { route: 'none', instead: 'x' }), { route: 'none', instead: 'x', untried: true });
  assert.deepEqual(choose([], { route: 'move' }), { route: 'move', untried: true });
  assert.deepEqual(found.route, { skill: null, agent: null, command: null, hook: null });
  assert.equal(found.personal, null);
  assert.deepEqual(found.typedRefused, { skill: null, command: null });
});

test('when the baseline shows nothing running, no kind gets a route: every answer is untried', () => {
  const trials = expected().map((one) => (one.name === 'baseline'
    ? { ...one, hooksRan: [], turns: { model: { markers: [] }, 'typed-skill': { markers: [] }, 'typed-command': { markers: [] } } }
    : one));
  const trialsWithFallbacks = [
    ...trials,
    ...['terminal', 'desktop'].map((binary) => trial('hook-skip-worktree', binary, { hooksRan: [], git: { statusClean: true, nothingStaged: true } })),
    ...['terminal', 'desktop'].map((binary) => trial('personal-overrides', binary, { turns: { model: { markers: [] }, 'typed-personal': { markers: [] } } })),
  ];
  const found = summarise(trialsWithFallbacks);
  assert.deepEqual(found.route, { skill: null, agent: null, command: null, hook: null });
  assert.equal(found.personal, null);
  assert.deepEqual(found.typedRefused, { skill: null, command: null });
  assert.equal(found.controls.skillRuns, false);
  assert.equal(found.controls.projectHookRuns, false);
});

test('each kind is gated on its own control', () => {
  // The typed command never ran in the baseline; the skill did.
  const trials = expected().map((one) => (one.name === 'baseline'
    ? { ...one, turns: { ...one.turns, 'typed-command': { markers: [] } } }
    : one));
  const found = summarise(trials);
  assert.equal(found.route.command, null);
  assert.equal(found.route.skill.key, 'skillOverrides.<name>');
  // Claude never used the command in the baseline: no command route either.
  const commandUnused = expected().map((one) => (one.name === 'baseline'
    ? { ...one, turns: { ...one.turns, model: { markers: allOn.filter((m) => m !== MARKERS.command) } } }
    : one));
  assert.equal(summarise(commandUnused).route.command, null);
  // The bare name reached the plugin's agent in the baseline: the agent deny shows nothing.
  const pluginWins = expected().map((one) => (one.name === 'baseline'
    ? { ...one, turns: { ...one.turns, model: { markers: [MARKERS.skill, MARKERS.personal, MARKERS.command, MARKERS.pluginAgentBare] } } }
    : one));
  assert.equal(summarise(pluginWins).route.agent, null);
});

test('init entries without a name are tolerated', () => {
  assert.deepEqual(pluginNames([{ name: PLUGIN, path: '/x' }, { path: '/y' }, 'other@m', null, 3]), [PLUGIN, 'other@m']);
  assert.equal(pluginNames(undefined), null);
  const trials = expected().map((one) => (one.name === 'baseline' ? { ...one, init: { ...one.init, plugins: [undefined, PLUGIN] } } : one));
  assert.equal(summarise(trials).controls.pluginLoads, true);
});

test('options: --go is needed for the trial, and unknown options are refused', () => {
  assert.equal(parseOptions([]).go, false);
  assert.equal(parseOptions(['--go']).go, true);
  assert.equal(parseOptions(['--model', 'model-a'], {}).model, 'model-a');
  assert.equal(parseOptions([], { WHEELHOUSE_PROBE_MODEL: 'model-b' }).model, 'model-b');
  assert.throws(() => parseOptions(['--yes']), /Unknown option/);
});

test('the Desktop app\'s copy is the newest version folder with a program in it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'check50-home-'));
  try {
    const root = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
    for (const version of ['2.1.9', '2.1.10']) {
      const file = path.join(root, version, 'abc', 'claude.app', 'Contents', 'MacOS', 'claude');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
    }
    assert.equal(findDesktopClaude({ platform: 'darwin', home }).version, '2.1.10');
    const appData = path.join(home, 'AppData');
    const exe = path.join(appData, 'Claude', 'claude-code', '2.1.3', 'claude.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    assert.equal(findDesktopClaude({ platform: 'win32', home, env: { APPDATA: appData } }).file, exe);
    assert.equal(findDesktopClaude({ platform: 'darwin', home: path.join(home, 'none') }), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the fixtures: committed parts, an untracked skill git does not list, and a plugin pinned by sha', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check50-fixtures-'));
  try {
    const fixtures = makeFixtures(root);
    const git = (args) => spawnSync('git', args, { cwd: fixtures.project, encoding: 'utf8' }).stdout.trim();
    const tracked = git(['ls-files']).split('\n');
    for (const part of [`.claude/skills/${NAMES.skill}/SKILL.md`, `.claude/agents/${NAMES.agent}.md`, `.claude/commands/${NAMES.command}.md`, '.claude/settings.json']) {
      assert.ok(tracked.includes(part), `${part} is committed`);
    }
    assert.ok(fs.existsSync(path.join(fixtures.project, '.claude', 'skills', NAMES.untracked, 'SKILL.md')));
    assert.equal(git(['status', '--porcelain']), '', 'the untracked skill is excluded, so git status is clean');
    const settings = JSON.parse(fs.readFileSync(path.join(fixtures.project, '.claude', 'settings.json'), 'utf8'));
    assert.match(settings.hooks.SessionStart[0].hooks[0].command, /hook-project$/);
    const marketplace = JSON.parse(fs.readFileSync(path.join(fixtures.marketplace, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(marketplace.plugins[0].source.sha, fixtures.sha);
    assert.match(marketplace.plugins[0].source.url, /^file:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the hook script records that it ran in the session\'s folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check50-hook-'));
  try {
    const fixtures = makeFixtures(root);
    const result = spawnSync(process.execPath, [path.join(fixtures.project, '.claude', 'hooks', 'mark.mjs'), 'hook-project'], {
      input: JSON.stringify({ cwd: fixtures.project }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(fixtures.project, 'ran', 'hook-project.txt')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('without --go it prints the plan, changes nothing and exits 0', () => {
  const result = spawnSync(process.execPath, [runJs, '--terminal-only'], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nothing below has been done/);
  assert.match(result.stdout, /Nothing was changed/);
});

test('a session that times out is stopped, then killed, and stays listed until it has exited', async () => {
  // Ignores SIGTERM, so only the kill after the grace ends it.
  const stubborn = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
  const result = await runLive(process.execPath, ['-e', stubborn], { timeoutMs: 400, graceMs: 400 });
  assert.equal(result.timedOut, true);
  if (process.platform !== 'win32') assert.equal(live.size, 1, 'still listed while it runs');
  const until = Date.now() + 10_000;
  while (live.size > 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(live.size, 0, 'killed after the grace');
});

test('a session with no timeout given gets the default one, not none', async () => {
  const result = await runLive(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], {});
  assert.equal(result.timedOut, undefined);
  assert.equal(result.code, 0);
  await assert.rejects(runLive(process.execPath, ['-e', ''], { timeoutMs: Number.NaN }), /timeoutMs/);
});
