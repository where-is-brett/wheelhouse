// tests/scripts/frontdesk/glossary.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { glossaryOf, termsIn, termMatches } from '../../../scripts/frontdesk/glossary.js';

const STARTER_TERMS = [
  'pull request', 'CI', 'merge', 'branch', 'commit', 'review', 'slice', 'lane', 'feature flag', 'preview',
  'worktree', 'STOP', 'Standard', 'Locked', 'the helper', 'the foreman', 'the gate', 'appetite', 'the done contract',
];

test('the starter holds every term, each with plain words and an everyday example', () => {
  const g = glossaryOf({});
  assert.deepEqual(Object.keys(g).sort(), [...STARTER_TERMS].sort());
  for (const [term, entry] of Object.entries(g)) {
    assert.ok(entry.plain.length > 0 && entry.example.length > 0, term);
  }
  const raw = JSON.parse(fs.readFileSync(new URL('../../../templates/glossary.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), [...STARTER_TERMS].sort());
});

test('the project\'s entries come over the starter\'s, whatever their case', () => {
  const g = glossaryOf({
    foreman: { data: { term: 'the foreman', plain: 'our site manager', example: 'Dave' } },
    ci: { data: { term: 'ci', plain: 'the checks' } },
    sprocket: { data: { term: 'sprocket', plain: 'a toothed wheel' } },
    broken: { data: { term: 'broken' } },
  });
  assert.deepEqual(g['the foreman'], { plain: 'our site manager', example: 'Dave' });
  assert.equal(g.CI, undefined);
  assert.deepEqual(g.ci, { plain: 'the checks' });
  assert.deepEqual(g.sprocket, { plain: 'a toothed wheel' });
  assert.equal(g.broken, undefined);
  assert.equal(Object.keys(g).length, STARTER_TERMS.length + 1);
});

test('termsIn finds terms in any case, as whole words, each once, in order', () => {
  const g = glossaryOf({});
  assert.deepEqual(termsIn('The CI is red, so no MERGE yet. Merge later.', g), ['CI', 'merge']);
  assert.deepEqual(termsIn('Ready for Review on the branch', g), ['review', 'branch']);
  assert.deepEqual(termsIn('a pull   request and a feature flag', g), ['pull request', 'feature flag']);
  assert.deepEqual(termsIn('Nothing technical here', g), []);
  assert.deepEqual(termsIn(undefined, g), []);
});

test('plurals, PR and PRs count, and parts of other words do not', () => {
  const g = glossaryOf({});
  assert.deepEqual(termsIn('Two branches, three commits and four slices', g), ['branch', 'commit', 'slice']);
  assert.deepEqual(termsIn("The PR's tests; two PRs", g), ['pull request']);
  assert.deepEqual(termsIn('pull requests', g), ['pull request']);
  assert.deepEqual(termsIn('emerge, committee, reviewer, delicious, pr0', g), []);
  assert.deepEqual(termsIn('the helpers', g), ['the helper']);
});

test('termMatches gives positions, and the longer term wins an overlap', () => {
  const g = { flag: { plain: 'a flag' }, 'feature flag': { plain: 'a switch' } };
  assert.deepEqual(termMatches('a feature flag', g), [{ term: 'feature flag', index: 2, length: 12 }]);
  assert.deepEqual(termsIn('a feature flag', g), ['feature flag']);
});
