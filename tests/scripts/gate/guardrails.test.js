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

test('readConfig: no file is the empty config; a malformed one throws', () => {
  assert.deepEqual(empty, { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] });
  const good = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], routing: { a: 1 }, runbook: { contain: { describe: 'Stop it', command: ['node', 'x.js'] } } };
  assert.deepEqual(readConfig(JSON.stringify(good)), good, 'unknown keys are kept');
  const older = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
  assert.deepEqual(readConfig(JSON.stringify(older)), older, 'a configuration with no runbook is still valid');
  assert.deepEqual(readConfig(JSON.stringify({ ...older, runbook: {} })), { ...older, runbook: {} });
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
