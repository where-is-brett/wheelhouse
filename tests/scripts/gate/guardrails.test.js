// tests/scripts/gate/guardrails.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChange, readConfig, GUARDRAILS, CI_FILES } from '../../../scripts/gate/guardrails.js';

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
  assert.deepEqual(GUARDRAILS, ['.claude/**', '**/CLAUDE.md', '.mcp.json']);
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
const ROUTING_NONE = { foreman: null, builder: null, reviewer: null, reviewerCritical: null, tester: null, mechanical: null };
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
