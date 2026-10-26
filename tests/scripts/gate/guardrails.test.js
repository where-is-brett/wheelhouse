// tests/scripts/gate/guardrails.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChange, readConfig, GUARDRAILS, CI_FILES } from '../../../scripts/gate/guardrails.js';
import { AGENT_CONTROL } from '../../../scripts/lib/agent-control.js';

const empty = readConfig(null);

test('a change under .claude/ touches the guardrails', () => {
  const answer = classifyChange({ paths: ['src/a.js', '.claude/settings.json', '.claude/wheelhouse.json'], config: empty });
  assert.deepEqual(answer, { touchesGuardrails: true, guardrailPaths: ['.claude/settings.json', '.claude/wheelhouse.json'], criticalAreas: [] });
  assert.deepEqual(classifyChange({ paths: ['src/a.js'], config: empty }), { touchesGuardrails: false, guardrailPaths: [], criticalAreas: [] });
  assert.deepEqual(classifyChange({ paths: [], config: empty }), { touchesGuardrails: false, guardrailPaths: [], criticalAreas: [] });
});

test('CLAUDE.md in any folder, .mcp.json, workflows and GitLab CI files touch the guardrails', () => {
  const paths = ['CLAUDE.md', 'docs/CLAUDE.md', '.mcp.json', '.github/workflows/ci.yml', '.github/actions/x/action.yml', '.gitlab-ci.yml', '.gitlab/ci/a.yml'];
  assert.deepEqual(classifyChange({ paths, config: empty }).guardrailPaths, paths);
  assert.equal(classifyChange({ paths: ['docs/CLAUDE.md.bak', 'src/.mcp.json'], config: empty }).touchesGuardrails, false);
  assert.deepEqual(GUARDRAILS, ['.claude/**', '**/CLAUDE.md', '.mcp.json', ...AGENT_CONTROL]);
  assert.deepEqual(CI_FILES, ['.github/workflows/**', '.github/actions/**', '.gitlab-ci.yml', '.gitlab/**']);
});

test('the configuration\'s ciFiles are guardrails too', () => {
  const config = readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: ['ci/**', 'Jenkinsfile'], mcpServers: [], webDomains: [] }));
  assert.deepEqual(classifyChange({ paths: ['ci/a.sh', 'Jenkinsfile', 'src/x'], config }).guardrailPaths, ['ci/a.sh', 'Jenkinsfile']);
});

test('a critical area\'s check file is a guardrail; a file in the area only names the area', () => {
  const config = readConfig(JSON.stringify({
    v: 1,
    criticalAreas: [
      { name: 'money', paths: ['src/money/**'], checks: ['tests/money/**'] },
      { name: 'login', paths: ['src/login/**'], checks: [] },
    ],
    ciFiles: [], mcpServers: [], webDomains: [],
  }));
  assert.deepEqual(classifyChange({ paths: ['src/money/a.js'], config }), { touchesGuardrails: false, guardrailPaths: [], criticalAreas: ['money'] });
  assert.deepEqual(classifyChange({ paths: ['tests/money/a.test.js'], config }), { touchesGuardrails: true, guardrailPaths: ['tests/money/a.test.js'], criticalAreas: [] });
  const both = classifyChange({ paths: ['src/login/x', 'src/money/a.js', 'src/money/b.js'], config });
  assert.deepEqual(both.criticalAreas, ['money', 'login']);
});

// What readConfig fills in for each build-loop key a configuration leaves out.
const ROUTING_NONE = { frontDesk: null, foreman: null, builder: null, reviewer: null, reviewerCritical: null, tester: null, mechanical: null, feature: null, builderCritical: null };
const DEFAULTS = {
  routing: ROUTING_NONE, sessionMode: 'acceptEdits', buildCommands: ['npm test', 'npm run', 'node'], watcherShape: 1,
  hotFiles: ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '**/migrations/**'], flagFiles: [],
};

test('readConfig: no file is the empty config; a malformed one throws', () => {
  assert.deepEqual(empty, { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], ...DEFAULTS });
  const good = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], other: { a: 1 }, runbook: { contain: { describe: 'Stop it', command: ['node', 'x.js'] } } };
  assert.deepEqual(readConfig(JSON.stringify(good)), { ...good, ...DEFAULTS }, 'unknown keys are kept');
  const older = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  assert.deepEqual(readConfig(JSON.stringify(older)), { ...older, ...DEFAULTS }, 'a configuration with no runbook is still valid');
  assert.deepEqual(readConfig(JSON.stringify({ ...older, runbook: {} })), { ...older, runbook: {}, ...DEFAULTS });
  const message = "The project's Wheelhouse configuration can't be read";
  const bad = [
    '', 'not json', 'null', '[]', '{}', '{"v":2,"criticalAreas":[],"ciFiles":[],"mcpServers":[],"webDomains":[]}',
    JSON.stringify({ ...good, criticalAreas: [{ name: 'x', paths: 'src/**', checks: [] }] }),
    JSON.stringify({ ...good, criticalAreas: [{ name: 1, paths: [], checks: [] }] }),
    JSON.stringify({ ...good, criticalAreas: [{ name: 'x', paths: [] }] }),
    JSON.stringify({ ...good, ciFiles: [1] }),
    JSON.stringify({ ...good, mcpServers: 'a' }),
    JSON.stringify({ ...good, runbook: { contain: { describe: 'x', command: 'node' } } }),
    JSON.stringify({ ...good, runbook: { contain: { describe: 'x', command: [] } } }),
    JSON.stringify({ ...good, runbook: { contain: { describe: 'x', command: [''] } } }),
    JSON.stringify({ ...good, runbook: { contain: { command: ['node'] } } }),
    JSON.stringify({ ...good, runbook: [] }),
    JSON.stringify({ ...good, runbook: { contain: { describe: '', command: ['node'] } } }),
  ];
  for (const text of bad) assert.throws(() => readConfig(text), { message }, text);
});

test('readConfig: the build loop\'s keys are kept as given, and the missing ones filled in', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  const given = {
    ...base,
    routing: { foreman: 'model-a', reviewer: 'model-b', reviewerCritical: null, custom: 'model-c' },
    sessionMode: 'plan',
    buildCommands: ['npm test', 'make check'],
    watcherShape: 2,
  };
  assert.deepEqual(readConfig(JSON.stringify(given)), {
    ...given,
    hotFiles: DEFAULTS.hotFiles,
    flagFiles: [],
    routing: { ...ROUTING_NONE, foreman: 'model-a', reviewer: 'model-b', custom: 'model-c' },
  });
  assert.deepEqual(readConfig(JSON.stringify({ ...base, routing: {} })).routing, ROUTING_NONE, 'no model named: the command line\'s own default');
  assert.deepEqual(readConfig(JSON.stringify({ ...base, buildCommands: [] })).buildCommands, [], 'an empty list allows no commands');
  for (const mode of ['acceptEdits', 'auto', 'default', 'dontAsk', 'plan']) {
    assert.equal(readConfig(JSON.stringify({ ...base, sessionMode: mode })).sessionMode, mode);
  }
});

test('readConfig: bypass mode, a model that reads as a flag, and a command a rule cannot hold are refused', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  const message = "The project's Wheelhouse configuration can't be read";
  const bad = [
    { sessionMode: 'bypassPermissions' }, { sessionMode: 'ACCEPTEDITS' }, { sessionMode: '' }, { sessionMode: null },
    { routing: [] }, { routing: 'model-a' }, { routing: null },
    { routing: { foreman: '--dangerously-skip-permissions' } }, { routing: { builder: '' } }, { routing: { tester: 1 } },
    { routing: { reviewer: 'model a' } }, { routing: { mechanical: 'model-a\n' } }, { routing: { foreman: 'x'.repeat(129) } },
    { buildCommands: 'npm test' }, { buildCommands: [''] }, { buildCommands: [' npm test'] }, { buildCommands: ['npm  test'] },
    { buildCommands: ['npm test:*'] }, { buildCommands: ['npm test)'] }, { buildCommands: ['rm -rf *'] }, { buildCommands: ['-x'] },
    { buildCommands: ['npm\ntest'] }, { buildCommands: [1] },
    { watcherShape: 0 }, { watcherShape: 3 }, { watcherShape: '1' }, { watcherShape: 1.5 }, { watcherShape: null },
  ];
  for (const extra of bad) assert.throws(() => readConfig(JSON.stringify({ ...base, ...extra })), { message }, JSON.stringify(extra));
});

test('readConfig: signsApps is true or false when given, and any other value can\'t be read', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  assert.equal(readConfig(JSON.stringify(base)).signsApps, undefined, 'left out: the keychain stays shut');
  assert.equal(readConfig(JSON.stringify({ ...base, signsApps: true })).signsApps, true);
  assert.equal(readConfig(JSON.stringify({ ...base, signsApps: false })).signsApps, false);
  for (const signsApps of ['true', 1, null, [], {}]) {
    assert.throws(() => readConfig(JSON.stringify({ ...base, signsApps })), { message: "The project's Wheelhouse configuration can't be read" }, JSON.stringify(signsApps));
  }
});

test('classification ignores case, for every kind of pattern', () => {
  const paths = ['.Claude/settings.json', 'claude.md', 'docs/Claude.md', '.MCP.json', '.GitHub/workflows/x.yml', 'CI/run.sh', 'Tests/Money/a.js', 'SRC/Money/b.js'];
  const config = readConfig(JSON.stringify({
    v: 1, criticalAreas: [{ name: 'money', paths: ['src/money/**'], checks: ['tests/money/**'] }], ciFiles: ['ci/**'], mcpServers: [], webDomains: [],
  }));
  const found = classifyChange({ paths, config });
  assert.deepEqual(found.guardrailPaths, paths.slice(0, 7));
  assert.deepEqual(found.criticalAreas, ['money']);
});

test('readConfig: a glob with an empty segment is refused', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  const message = "The project's Wheelhouse configuration can't be read";
  for (const glob of ['/ci/**', 'ci/', 'a//b', '']) {
    assert.throws(() => readConfig(JSON.stringify({ ...base, ciFiles: [glob] })), { message }, glob);
    assert.throws(() => readConfig(JSON.stringify({ ...base, criticalAreas: [{ name: 'x', paths: [glob], checks: [] }] })), { message }, glob);
    assert.throws(() => readConfig(JSON.stringify({ ...base, criticalAreas: [{ name: 'x', paths: [], checks: [glob] }] })), { message }, glob);
  }
});

test('readConfig: hotFiles and flagFiles are globs, with the defaults filled in', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  const defaults = readConfig(JSON.stringify(base));
  assert.deepEqual(defaults.hotFiles, ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '**/migrations/**']);
  assert.deepEqual(defaults.flagFiles, []);
  assert.deepEqual(empty.hotFiles, defaults.hotFiles);
  const given = readConfig(JSON.stringify({ ...base, hotFiles: ['src/routes.js'], flagFiles: ['src/flags/**'] }));
  assert.deepEqual(given.hotFiles, ['src/routes.js']);
  assert.deepEqual(given.flagFiles, ['src/flags/**']);
  assert.deepEqual(readConfig(JSON.stringify({ ...base, hotFiles: [] })).hotFiles, [], 'an empty list names no hot files');
  const message = "The project's Wheelhouse configuration can't be read";
  for (const extra of [
    { hotFiles: 'package.json' }, { hotFiles: [1] }, { hotFiles: ['/a'] }, { hotFiles: ['a//b'] }, { hotFiles: [''] }, { hotFiles: null },
    { flagFiles: 'x' }, { flagFiles: [null] }, { flagFiles: ['a/'] }, { flagFiles: [''] }, { flagFiles: null },
  ]) assert.throws(() => readConfig(JSON.stringify({ ...base, ...extra })), { message }, JSON.stringify(extra));
});

test('readConfig: pages are at most twenty plain paths on the preview, and any other list can\'t be read', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  assert.equal(readConfig(JSON.stringify(base)).pages, undefined, 'no pages: an approval never carries over');
  assert.deepEqual(readConfig(JSON.stringify({ ...base, pages: ['/', '/pricing', '/about?tab=team'] })).pages, ['/', '/pricing', '/about?tab=team']);
  assert.deepEqual(readConfig(JSON.stringify({ ...base, pages: [] })).pages, []);
  const twenty = Array.from({ length: 20 }, (_, i) => `/page-${i}`);
  assert.deepEqual(readConfig(JSON.stringify({ ...base, pages: twenty })).pages, twenty);
  const message = "The project's Wheelhouse configuration can't be read";
  for (const pages of [
    '/', null, {}, [1], [''], ['pricing'], ['//evil.example'], ['/a b'], ['/a\\b'], ['/../secret'], ['/a/%2e%2e/b'],
    ['https://evil.example/'], [...twenty, '/one-more'],
  ]) assert.throws(() => readConfig(JSON.stringify({ ...base, pages })), { message }, JSON.stringify(pages));
});

test('a pull request touching .github/hooks/x.json or a nested AGENTS.md is a guardrail change', () => {
  const paths = ['.github/hooks/x.json', 'docs/deep/AGENTS.md', 'AGENTS.md', 'sub/GEMINI.md', '.vscode/tasks.json', '.codex/config.toml', '.cursor/rules/a.mdc',
    '.gemini/settings.json', '.agents/skills/a/SKILL.md', '.github/copilot-instructions.md', '.github/skills/a/SKILL.md', '.github/mcp.json',
    'plugin.json', '.plugin/x', 'com.github.copilot/a', '.gitattributes'];
  const answer = classifyChange({ paths: [...paths, 'src/a.js'], config: empty });
  assert.equal(answer.touchesGuardrails, true);
  assert.deepEqual(answer.guardrailPaths, paths);
  // Names that only look like them are not.
  assert.deepEqual(classifyChange({ paths: ['src/AGENTS.md.bak', 'docs/MYAGENTS.md', 'src/.vscode-notes.md', 'sub/plugin.json', '.github/ISSUE_TEMPLATE/a.md'], config: empty }).guardrailPaths, []);
  // Case is ignored here as it is for the other guardrails.
  assert.equal(classifyChange({ paths: ['.GitHub/Hooks/x.json'], config: empty }).touchesGuardrails, true);
});

test('readConfig: tiers.pins holds up to three model names or null, and the flat routing may name feature and builderCritical', () => {
  const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  const pins = { mostCapable: 'model-top', midSized: null, premium: 'model-premium' };
  assert.deepEqual(readConfig(JSON.stringify({ ...base, tiers: { pins } })).tiers, { pins });
  assert.deepEqual(readConfig(JSON.stringify({ ...base, tiers: { pins: {} } })).tiers, { pins: {} });
  assert.equal(readConfig(JSON.stringify(base)).tiers, undefined);
  const routed = readConfig(JSON.stringify({ ...base, routing: { feature: 'model-a', builderCritical: 'model-b' } })).routing;
  assert.equal(routed.feature, 'model-a');
  assert.equal(routed.builderCritical, 'model-b');
  const bad = [
    { tiers: [] }, { tiers: null }, { tiers: 'x' }, { tiers: {} }, { tiers: { pins: [] } }, { tiers: { pins: null } },
    { tiers: { pins, other: 1 } }, { tiers: { pins: { mostCapable: '--flag' } } }, { tiers: { pins: { midSized: 1 } } },
    { tiers: { pins: { premium: '' } } }, { tiers: { pins: { extra: 'model-a' } } }, { tiers: { pins: { mostCapable: 'model a' } } },
  ];
  for (const extra of bad) assert.throws(() => readConfig(JSON.stringify({ ...base, ...extra })), /can't be read/, JSON.stringify(extra));
});

test('a plugin\'s own parts are guardrails in a project that is a plugin, and ordinary folders elsewhere', () => {
  const paths = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json', 'skills/setup/SKILL.md', 'agents/builder.md',
    'commands/setup.md', 'output-styles/plain.md', '.lsp.json'];
  const plain = ['scripts/hooks/tool-guard.js', 'src/hooks/useCart.js', 'docs/skills.md', 'README.md'];
  const plugin = { ...empty, plugin: true };
  assert.deepEqual(classifyChange({ paths: [...paths, ...plain], config: plugin }).guardrailPaths, paths);
  assert.equal(classifyChange({ paths: ['Hooks/hooks.json'], config: plugin }).touchesGuardrails, true, 'case is ignored, as for the rest');
  assert.deepEqual(classifyChange({ paths: [...paths.slice(2, 7), ...plain], config: empty }).guardrailPaths, [], 'not a plugin: a web app\'s hooks/ is its own');
  assert.equal(classifyChange({ paths: ['hooks/useCart.js'], config: { ...empty, plugin: false } }).touchesGuardrails, false);
});

test('the configuration file can\'t say the project isn\'t a plugin', () => {
  const config = readConfig(JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], plugin: false }));
  assert.equal(Object.hasOwn(config, 'plugin'), false);
});

test('Wheelhouse\'s own configuration reads, and its safety checks need the director when it manages itself', async () => {
  const fs = await import('node:fs');
  const own = readConfig(fs.readFileSync(new URL('../../../.claude/wheelhouse.json', import.meta.url), 'utf8'));
  const config = { ...own, plugin: true };
  for (const file of ['scripts/hooks/tool-guard.js', 'scripts/gate/conditions.js', 'scripts/host/helper.js', 'scripts/protection/settings.js',
    'scripts/setup/host.js', 'scripts/state/events.js', 'scripts/lib/projects.js', 'scripts/briefing/text.js', 'adapters/copilot/lean-guard.sh', 'hooks/register.ts', 'hooks/hooks.json', 'agents/reviewer.md',
    'skills/setup/SKILL.md', '.claude-plugin/plugin.json', 'lineage/manifest.json']) {
    assert.equal(classifyChange({ paths: [file], config }).touchesGuardrails, true, file);
  }
  for (const file of ['docs/specs/x.md', 'tests/e2e/setup.test.js', 'templates/brief/lanes/quick.md', 'README.md']) {
    assert.equal(classifyChange({ paths: [file], config }).touchesGuardrails, false, file);
  }
});
