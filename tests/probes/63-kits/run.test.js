// tests/probes/63-kits/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../helpers/homes.js';
import {
  BRIEF, CHECK, ID_ORDER, eventTypeCounts, handoffEvents, installKits, logExcerpt, main, overrideText, parseOptions, pinnedKits,
  selectRuns, skillsLoaded, stageFiles, stagePrompt, stageSkill, subagentCalls, summarise, toolTally,
} from '../../../probes/63-kits/run.js';
import { readManifest } from '../../../scripts/lineage/manifest.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const dir = (name) => fileURLToPath(new URL(`../../../probes/63-kits/${name}`, import.meta.url));
const byId = (results, id) => results.runs.find((run) => run.id === id);

test('options: defaults do the full run, and bad options are refused', () => {
  const options = parseOptions([]);
  assert.equal(options.dryRun, false);
  assert.equal(options.only, null);
  assert.deepEqual(selectRuns(options.only), ID_ORDER);
  assert.equal(ID_ORDER.length, 6);
  assert.deepEqual(selectRuns(['tdd-matt', 'writing-plans']), ['writing-plans', 'tdd-matt']);
  assert.throws(() => parseOptions(['--nope']), /Unknown option/);
  assert.throws(() => parseOptions(['--timeout-ms', 'x']), /milliseconds/);
  assert.throws(() => parseOptions(['--only', 'made-up']), /no such run/);
});

test('every prompt starts with the override, then the brief, and names its skill; the override has no path comment', () => {
  const override = overrideText();
  assert.match(override, /^# The Wheelhouse override/);
  assert.ok(!override.includes('<!--'));
  for (const id of ID_ORDER) {
    const prompt = stagePrompt(id);
    assert.ok(prompt.startsWith(override), id);
    assert.ok(prompt.includes(BRIEF), id);
    assert.match(prompt.split('---').slice(-1)[0], new RegExp(`the ${stageSkill(id)} skill`), id);
    assert.match(Object.keys(stageFiles(id)).join(' '), /greet\.js/);
  }
  assert.ok('docs/superpowers/plans/version-flag.md' in stageFiles('subagent-driven'));
  assert.ok('docs/superpowers/specs/version-flag.md' in stageFiles('writing-plans'));
  assert.throws(() => stagePrompt('made-up'), /No such run/);
});

test('the pins come from the manifest, and every skill the manifest lists is one the probe installs', () => {
  const kits = pinnedKits();
  const manifest = readManifest();
  assert.deepEqual(kits.map((k) => [k.name, k.sha]), manifest.upstreams.map((u) => [u.name, u.sha]));
  const names = kits.flatMap((k) => k.folders.map((f) => path.basename(f.path)));
  for (const skill of ['brainstorming', 'writing-plans', 'subagent-driven-development', 'executing-plans', 'test-driven-development', 'tdd']) assert.ok(names.includes(skill), skill);
  assert.equal(new Set(names).size, names.length);
});

test('kits are copied by skill name, and a copy that differs from the manifest is reported', async () => {
  const work = tempFolder('wh-kits-work-');
  const skillsDir = path.join(work, 'skills');
  fs.mkdirSync(skillsDir);
  const kits = [{ name: 'k', repo: 'r', ref: 'v1', sha: 'abc', folders: [{ path: 'skills/a/one', hash: 'nope' }, { path: 'skills/two', hash: 'nope' }] }];
  const fetchTo = async (upstream, into) => {
    assert.deepEqual([upstream.repo, upstream.sha], ['r', 'abc']);
    for (const p of ['skills/a/one', 'skills/two']) { fs.mkdirSync(path.join(into, p), { recursive: true }); fs.writeFileSync(path.join(into, p, 'SKILL.md'), 'x'); }
  };
  const installed = await installKits({ kits, work, skillsDir, fetchTo });
  assert.deepEqual(installed.map((i) => [i.skill, i.matchesManifest]), [['one', false], ['two', false]]);
  assert.ok(fs.existsSync(path.join(skillsDir, 'one', 'SKILL.md')));
  await assert.rejects(installKits({ kits: [{ ...kits[0], folders: [{ path: 'skills/missing', hash: 'x' }] }], work, skillsDir, fetchTo }), /no SKILL\.md/);
  await assert.rejects(installKits({ kits: [kits[0], { ...kits[0], name: 'k2' }], work: tempFolder('wh-kits-work-'), skillsDir: tempFolder('wh-skills-'), fetchTo }), /Two kits both have a skill named/);
});

test('Copilot own events give the skills loaded, the subagent dispatches, and a tally of tools', () => {
  const calls = [
    { tool: 'skill', arguments: '{"skill":"superpowers:brainstorming"}', success: true, code: null },
    { tool: 'skill', arguments: 'writing-plans please', success: true, code: null },
    { tool: 'view', arguments: '{"path":"/x/skills/executing-plans/SKILL.md"}', success: true, code: null },
    { tool: 'task', arguments: '{"agent_type":"general-purpose"}', success: false, code: 'failure', error: 'no' },
    { tool: 'bash', arguments: '{}', success: false, code: 'denied' },
    { tool: 'bash', arguments: '{}', success: true, code: null },
  ];
  assert.deepEqual(skillsLoaded(calls, ['writing-plans']).map((s) => [s.skill, s.via]), [['brainstorming', 'skill-tool'], ['writing-plans', 'skill-tool'], ['executing-plans', 'view']]);
  assert.deepEqual(subagentCalls(calls).map((c) => [c.tool, c.success, c.code]), [['task', false, 'failure']]);
  assert.deepEqual(toolTally(calls).bash, { calls: 2, failed: 1, codes: ['denied'] });
  assert.deepEqual(eventTypeCounts([{ type: 'a' }, { type: 'a' }, {}]), { a: 2, unknown: 1 });
  assert.equal(handoffEvents([{ type: 'skill.invoked', data: {} }, { type: 'assistant.message' }]).length, 1);
});

test('the debug log excerpt keeps skill and subagent lines and shortens paths', () => {
  const logs = tempFolder('wh-kits-log-');
  fs.writeFileSync(path.join(logs, 'a.log'), 'noise\nloading skill /home/me/x/skills/a\nstarted subagent task\n');
  const lines = logExcerpt(logs, { scrub: [['/home/me', '~']] });
  assert.deepEqual(lines, ['loading skill ~/x/skills/a', 'started subagent task']);
  assert.deepEqual(logExcerpt(path.join(logs, 'none')), []);
});

t('--dry-run makes every run, writes the results and logs, and undoes everything it made', async () => {
  const resultsDir = tempFolder('wh-results-');
  const printed = [];
  const { results, file } = await main(['--dry-run', '--results-dir', resultsDir], { out: (line) => printed.push(line) });
  assert.equal(results.error, null);
  assert.equal(file, path.join(resultsDir, `${CHECK}.dry-run.json`));
  assert.deepEqual(results.runs.map((run) => run.id), ID_ORDER);
  assert.match(printed[0], /6 model run/);
  assert.match(printed.join('\n'), /Debug logs: /);
  assert.equal(printed.find((line) => line.startsWith('Raw results')), `Raw results: ${file}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).runs.map((run) => run.id), ID_ORDER);
  for (const run of results.runs) {
    assert.ok(!fs.existsSync(run.cwd), run.cwd);
    assert.ok(run.args.includes('--allow-all-tools') && run.args.includes('--no-ask-user') && !run.args.includes('--disallow-temp-dir'));
    assert.equal(run.promptStartsWithOverride, true);
    assert.deepEqual(Object.keys(run.env.copilotValues), ['COPILOT_HOME']);
    assert.equal(run.expectedSkillLoaded, true, run.id);
  }
  assert.ok(!fs.existsSync(path.dirname(results.bin)));
  assert.ok(results.kits.length >= 6 && results.kits.every((k) => k.matchesManifest === false));
  assert.ok(results.skillList.includes('brainstorming') && results.skillList.includes('tdd'));
});

t('the dry run reads hand-offs, failed subagent dispatch and the project the way the real run will', async () => {
  const { results } = await main(['--dry-run', '--results-dir', tempFolder('wh-results-')], { out: () => {} });
  const plan = byId(results, 'brainstorm-to-plan');
  assert.deepEqual(plan.skillsLoaded.filter((s) => s.via === 'skill-tool').map((s) => s.skill), ['brainstorming', 'writing-plans']);
  assert.equal(plan.project.plans.length, 1);
  assert.equal(plan.project.versionIsPackageVersion, false);
  const sdd = byId(results, 'subagent-driven');
  assert.deepEqual(sdd.subagentCalls.map((c) => [c.tool, c.success, c.code]), [['task', false, 'failure']]);
  assert.equal(sdd.project.versionIsPackageVersion, true);
  assert.equal(sdd.project.greetingStillWorks, true);
  assert.equal(sdd.project.testsPass, true);
  assert.equal(sdd.project.uncommittedFiles, 2);
  assert.deepEqual(byId(results, 'tdd-matt').subagentCalls, []);
  const text = summarise(results);
  assert.match(text, /subagent dispatches: task:failure/);
  assert.match(text, /--version works/);
});

t('a Copilot that fails every run stops the probe with a plain message, and the folders are still undone', async () => {
  process.env.WHEELHOUSE_FAKE_FAIL = '1';
  try {
    const { results } = await main(['--dry-run', '--results-dir', tempFolder('wh-results-')], { out: () => {} });
    assert.match(results.error, /failed before the model answered/);
    assert.equal(results.runs.length, 1);
    assert.ok(!fs.existsSync(results.runs[0].cwd));
    assert.match(summarise(results), /STOPPED EARLY/);
  } finally {
    delete process.env.WHEELHOUSE_FAKE_FAIL;
  }
});

t('with no Copilot installed the probe stops before it makes anything', async () => {
  const resultsDir = tempFolder('wh-results-');
  const { results } = await main(['--bin', path.join(resultsDir, 'no-such-copilot'), '--results-dir', resultsDir], { out: () => {} });
  assert.match(results.error, /There is no Copilot at/);
  assert.equal(results.runs.length, 0);
});

t('run.js --dry-run works as a command and prints where the raw results are', () => {
  const resultsDir = tempFolder('wh-results-');
  const result = spawnSync(process.execPath, [dir('run.js'), '--dry-run', '--results-dir', resultsDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Raw results: .*63-kits\.dry-run\.json/);
});
