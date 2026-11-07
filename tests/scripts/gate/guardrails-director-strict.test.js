// tests/scripts/gate/guardrails-director-strict.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiff, readConfig } from '../../../scripts/gate/guardrails.js';

const config = readConfig(null);
const changed = (file, base, head) => classifyDiff({
  paths: [file], config, read: (_f, side) => (side === 'base' ? base : head),
}).directorLevel.length > 0;
const pkg = (deps) => JSON.stringify({ name: 'harbour-demo', dependencies: deps });
const pkgChanged = (was, now) => changed('package.json', pkg({ 'tide-chart': was }), pkg({ 'tide-chart': now }));
const pyproject = (...deps) => `[project]\nname = "harbour-demo"\ndependencies = [\n${deps.map((d) => `  ${d},`).join('\n')}\n]\n`;

test('pyproject: a list is not cut short by an extra or a bracket in a comment', () => {
  const base = pyproject('"uvicorn[standard]>=0.20"', '"tidelib>=1.2"');
  assert.equal(changed('pyproject.toml', base, pyproject('"uvicorn[standard]>=0.20"', '"tidelib>=2.0"')), true, 'a dependency after an extra is read');
  assert.equal(changed('pyproject.toml', base, pyproject('"uvicorn[standard]>=0.20"', '"tidelib>=1.5"')), false);
  const withComment = (v) => `[project]\ndependencies = [\n  "uvicorn>=0.20", # see [docs]\n  "tidelib>=${v}",\n]\n`;
  assert.equal(changed('pyproject.toml', withComment('1.2'), withComment('2.0')), true, 'a bracket in a comment does not end the list');
  assert.equal(changed('pyproject.toml', withComment('1.2'), withComment('1.7')), false);
});

test('pyproject: a list that can\'t be closed counts as a change', () => {
  const open = '[project]\ndependencies = [\n  "tidelib>=1.2",\n';
  assert.equal(changed('pyproject.toml', open, open), true, 'unsure counts as a change, even when both sides read the same');
  assert.equal(changed('pyproject.toml', pyproject('"tidelib>=1.2"'), open), true);
});

test('versions that are not plain ranges count as changed when their text changes', () => {
  for (const [was, now] of [
    ['github:acme/tide-chart#v1.0.0', 'github:acme/tide-chart#v1.1.0'],
    ['git+https://example.com/tide-chart.git#1.0.0', 'git+https://example.com/tide-chart.git#1.0.1'],
    ['npm:other-chart@1.0.0', 'npm:other-chart@1.2.0'],
    ['file:../tide-chart', 'file:../tide-chart-2'],
    ['https://example.com/tide-chart-1.0.0.tgz', 'https://example.com/tide-chart-1.0.1.tgz'],
    ['*', 'latest'],
  ]) assert.equal(pkgChanged(was, now), true, `${was} -> ${now}`);
  assert.equal(pkgChanged('github:acme/tide-chart#v1.0.0', 'github:acme/tide-chart#v1.0.0'), false, 'the same text is no change');
});

test('a changed range with more than one comparator, or ||, counts as changed', () => {
  assert.equal(pkgChanged('^1.2.0', '>=1.2.0 <3.0.0'), true);
  assert.equal(pkgChanged('^1.2.0', '^1.2.0 || ^2.0.0'), true);
  assert.equal(pkgChanged('>=1.0 <2.0', '>=1.1 <2.0'), true);
  assert.equal(changed('requirements.txt', 'tidelib>=1.0,<2.0\n', 'tidelib>=1.1,<2.0\n'), true);
});

test('below 1.0 the first non-zero part is the major', () => {
  assert.equal(pkgChanged('^0.3.1', '^0.4.0'), true);
  assert.equal(pkgChanged('^0.3.1', '^0.3.9'), false);
  assert.equal(pkgChanged('^0.0.3', '^0.0.4'), true);
  assert.equal(pkgChanged('^0.9.0', '^1.0.0'), true);
  assert.equal(pkgChanged('^1.2.0', '^1.9.0'), false);
  const cargo = (v) => `[dependencies]\ntidelib = "${v}"\n`;
  assert.equal(changed('Cargo.toml', cargo('0.3'), cargo('0.4')), true);
  assert.equal(changed('Cargo.toml', cargo('0.3.1'), cargo('0.3.5')), false);
});

test('TOML: a comment after a section header, workspace and target sections are read', () => {
  const cargo = (header, v) => `[package]\nname = "harbour-demo"\n\n${header} # runtime\ntidelib = "${v}"\n`;
  for (const header of ['[dependencies]', '[workspace.dependencies]', "[target.'cfg(unix)'.dependencies]", '[target.x86_64-pc-windows-gnu.dependencies]']) {
    assert.equal(changed('Cargo.toml', cargo(header, '1.2'), cargo(header, '2.0')), true, header);
    assert.equal(changed('Cargo.toml', cargo(header, '1.2'), cargo(header, '1.4')), false, header);
  }
  for (const header of ['[dev-dependencies]', '[build-dependencies]', "[target.'cfg(unix)'.dev-dependencies]"]) {
    assert.equal(changed('Cargo.toml', cargo(header, '1.2'), cargo(header, '2.0')), false, `${header} is not runtime`);
  }
  const poetry = (header, v) => `[tool.poetry]\nname = "harbour-demo"\n\n${header}  # comment\ntidelib = "^${v}"\n`;
  assert.equal(changed('pyproject.toml', poetry('[tool.poetry.dependencies]', '1.2'), poetry('[tool.poetry.dependencies]', '2.0')), true);
  assert.equal(changed('pyproject.toml', poetry('[tool.poetry.group.dev.dependencies]', '1.2'), poetry('[tool.poetry.group.dev.dependencies]', '2.0')), false);
});
