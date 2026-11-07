// tests/scripts/gate/guardrails-director.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyChange, classifyDiff, readConfig } from '../../../scripts/gate/guardrails.js';

const config = readConfig(null);

// A reader over two made-up trees of harbour-demo: path -> text, for the base and for the head.
const trees = (base, head) => (file, side) => {
  const tree = side === 'base' ? base : head;
  return Object.hasOwn(tree, file) ? tree[file] : null;
};
const kinds = (answer) => answer.directorLevel.map((d) => d.kind);
const pkg = (deps, extra = {}) => JSON.stringify({ name: 'harbour-demo', dependencies: deps, ...extra });

test('classifyDiff keeps what classifyChange says and adds the director-level facts', () => {
  const paths = ['src/tides.js', '.claude/settings.json'];
  const answer = classifyDiff({ paths, read: trees({}, {}), config });
  assert.deepEqual({ ...answer, directorLevel: undefined }, { ...classifyChange({ paths, config }), directorLevel: undefined });
  assert.deepEqual(answer.directorLevel, []);
});

test('a new runtime dependency in package.json is major-dependency', () => {
  const read = trees({ 'package.json': pkg({ chalk: '^5.0.0' }) }, { 'package.json': pkg({ chalk: '^5.0.0', 'tide-chart': '^1.2.0' }) });
  const answer = classifyDiff({ paths: ['package.json'], read, config });
  assert.deepEqual(answer.directorLevel, [{ kind: 'major-dependency', paths: ['package.json'] }]);
});

test('a new development dependency is not major-dependency', () => {
  const read = trees({ 'package.json': pkg({}) }, { 'package.json': pkg({}, { devDependencies: { 'tide-lint': '^1.0.0' } }) });
  assert.deepEqual(classifyDiff({ paths: ['package.json'], read, config }).directorLevel, []);
});

test('a major version bump is major-dependency; a minor or patch bump is not', () => {
  const base = { 'package.json': pkg({ 'tide-chart': '^1.2.3' }) };
  const major = classifyDiff({ paths: ['package.json'], read: trees(base, { 'package.json': pkg({ 'tide-chart': '^2.0.0' }) }), config });
  assert.deepEqual(kinds(major), ['major-dependency']);
  const minor = classifyDiff({ paths: ['package.json'], read: trees(base, { 'package.json': pkg({ 'tide-chart': '^1.9.0' }) }), config });
  assert.deepEqual(kinds(minor), []);
  const patch = classifyDiff({ paths: ['package.json'], read: trees(base, { 'package.json': pkg({ 'tide-chart': '~1.2.9' }) }), config });
  assert.deepEqual(kinds(patch), []);
});

test('swapping a dependency for another is major-dependency', () => {
  const read = trees({ 'package.json': pkg({ 'tide-chart': '^1.0.0' }) }, { 'package.json': pkg({ 'wave-chart': '^1.0.0' }) });
  assert.deepEqual(kinds(classifyDiff({ paths: ['package.json'], read, config })), ['major-dependency']);
});

test('a change to package.json that touches no dependency is not major-dependency', () => {
  const read = trees({ 'package.json': pkg({ a: '^1.0.0' }) }, { 'package.json': pkg({ a: '^1.0.0' }, { version: '1.4.0' }) });
  assert.deepEqual(classifyDiff({ paths: ['package.json'], read, config }).directorLevel, []);
});

test('a manifest that can\'t be read is the director\'s: unsure waits', () => {
  const read = () => { throw new Error('no such object'); };
  assert.deepEqual(kinds(classifyDiff({ paths: ['package.json'], read, config })), ['major-dependency']);
});

test('pyproject.toml, requirements.txt, go.mod, Cargo.toml and Gemfile are read the same way', () => {
  const cases = [
    ['pyproject.toml', '[project]\nname = "harbour-demo"\ndependencies = [\n  "tidelib>=1.2",\n]\n',
      '[project]\nname = "harbour-demo"\ndependencies = [\n  "tidelib>=1.2",\n  "wavelib>=0.3",\n]\n',
      '[project]\nname = "harbour-demo"\ndependencies = [\n  "tidelib>=2.0",\n]\n',
      '[project]\nname = "harbour-demo"\ndependencies = [\n  "tidelib>=1.5",\n]\n'],
    ['requirements.txt', 'tidelib==1.2.3\n', 'tidelib==1.2.3\nwavelib==0.3.0\n', 'tidelib==2.0.0\n', 'tidelib==1.9.0\n'],
    ['go.mod', 'module harbour-demo\n\nrequire (\n\texample.com/tidelib v1.2.3\n)\n',
      'module harbour-demo\n\nrequire (\n\texample.com/tidelib v1.2.3\n\texample.com/wavelib v0.3.0\n)\n',
      'module harbour-demo\n\nrequire (\n\texample.com/tidelib/v2 v2.0.0\n)\n',
      'module harbour-demo\n\nrequire (\n\texample.com/tidelib v1.9.0\n)\n'],
    ['Cargo.toml', '[package]\nname = "harbour-demo"\n\n[dependencies]\ntidelib = "1.2"\n',
      '[package]\nname = "harbour-demo"\n\n[dependencies]\ntidelib = "1.2"\nwavelib = { version = "0.3" }\n',
      '[package]\nname = "harbour-demo"\n\n[dependencies]\ntidelib = "2.0"\n',
      '[package]\nname = "harbour-demo"\n\n[dependencies]\ntidelib = "1.9"\n'],
    ['Gemfile', "source 'https://rubygems.org'\ngem 'tidelib', '~> 1.2'\n",
      "source 'https://rubygems.org'\ngem 'tidelib', '~> 1.2'\ngem 'wavelib', '~> 0.3'\n",
      "source 'https://rubygems.org'\ngem 'tidelib', '~> 2.0'\n",
      "source 'https://rubygems.org'\ngem 'tidelib', '~> 1.9'\n"],
  ];
  for (const [file, base, added, bumped, minor] of cases) {
    const check = (head) => kinds(classifyDiff({ paths: [file], read: trees({ [file]: base }, { [file]: head }), config }));
    assert.deepEqual(check(added), ['major-dependency'], `${file}: a new dependency`);
    assert.deepEqual(check(bumped), ['major-dependency'], `${file}: a major bump`);
    assert.deepEqual(check(minor), [], `${file}: a minor bump`);
  }
});

test('a manifest in a folder is read, and a new manifest brings its dependencies as new', () => {
  const file = 'services/tides/package.json';
  const read = trees({}, { [file]: pkg({ 'tide-chart': '^1.0.0' }) });
  assert.deepEqual(classifyDiff({ paths: [file], read, config }).directorLevel, [{ kind: 'major-dependency', paths: [file] }]);
});

test('a file under migrations/ or a schema.prisma change is data-model', () => {
  const paths = ['db/migrations/0004_add_tides.sql', 'prisma/schema.prisma', 'src/tides.js'];
  const answer = classifyDiff({ paths, read: trees({}, {}), config });
  assert.deepEqual(answer.directorLevel, [{ kind: 'data-model', paths: ['db/migrations/0004_add_tides.sql', 'prisma/schema.prisma'] }]);
});

test('an openapi file or a changed command-line option file is public-interface', () => {
  const paths = ['api/openapi.yaml', 'docs/swagger.json', 'bin/harbour', 'src/cli.js', 'src/cli/options.js', 'src/tides.js'];
  const answer = classifyDiff({ paths, read: trees({}, {}), config });
  assert.deepEqual(answer.directorLevel, [{ kind: 'public-interface', paths: ['api/openapi.yaml', 'docs/swagger.json', 'bin/harbour', 'src/cli.js', 'src/cli/options.js'] }]);
});

test('each kind is listed once with all its paths, and a plain change has none', () => {
  const answer = classifyDiff({ paths: ['migrations/1.sql', 'migrations/2.sql', 'src/a.js'], read: trees({}, {}), config });
  assert.equal(answer.directorLevel.length, 1);
  assert.deepEqual(answer.directorLevel[0].paths, ['migrations/1.sql', 'migrations/2.sql']);
  assert.deepEqual(classifyDiff({ paths: ['src/a.js', 'README.md'], read: trees({}, {}), config }).directorLevel, []);
});
