// tests/scripts/frontdesk/glossary.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NAMES, glossaryOf, termsIn, termMatches, plainWords, knownConcepts, conceptOf } from '../../../scripts/frontdesk/glossary.js';

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

test('the verbs count in their other forms', () => {
  const g = glossaryOf({});
  assert.deepEqual(termsIn('It was merged, reviewed and committed; merging and reviewing and committing go on', g), ['merge', 'review', 'commit']);
});

test('STOP, Standard and Locked count only in their own capitals', () => {
  const g = glossaryOf({});
  assert.deepEqual(termsIn('STOP is on; the Standard level, not Locked', g), ['STOP', 'Standard', 'Locked']);
  assert.deepEqual(termsIn('We stop at the standard door, locked up', g), []);
  assert.deepEqual(termsIn('Stop. Locked. Standard.', g), ['Locked', 'Standard']);
  // Other terms stay case-insensitive.
  assert.deepEqual(termsIn('ci and Merge', g), ['CI', 'merge']);
});

test('termMatches gives positions, and the longer term wins an overlap', () => {
  const g = { flag: { plain: 'a flag' }, 'feature flag': { plain: 'a switch' } };
  assert.deepEqual(termMatches('a feature flag', g), [{ term: 'feature flag', index: 2, length: 12 }]);
  assert.deepEqual(termsIn('a feature flag', g), ['feature flag']);
});

const PLAIN = { explanations: 'plain', known: [] };
const SOME = { explanations: 'some-terms', known: [] };

test('"The PR\'s CI is red on slice 2" reads in plain words', () => {
  const g = glossaryOf({});
  const out = plainWords("The PR's CI is red on slice 2", g, PLAIN);
  assert.equal(out.text, "The proposed change's automatic check run is red on piece 2");
  assert.deepEqual(out.terms, ['pull request', 'CI', 'slice']);
});

test('only the first mention is replaced; later ones keep the term, and a sentence start keeps its capital', () => {
  const g = glossaryOf({});
  const later = plainWords('Slice 1 is done. Slice 2 is not; slices 3 and 4 wait.', g, PLAIN);
  // A term mentioned again after its replacement is given its meaning at the end.
  assert.equal(later.text, `Piece 1 is done. Slice 2 is not; slices 3 and 4 wait.\n\nTerms: slice means ${g.slice.plain}.`);
  assert.equal(
    plainWords('- the helper is up\n- the helper is slow', g, PLAIN).text,
    `- the key-holding program on your computer is up\n- the helper is slow\n\nTerms: the helper means ${g['the helper'].plain}.`,
  );
  assert.equal(plainWords('Two PRs and a PR', g, PLAIN).text, `Two proposed changes and a PR\n\nTerms: pull request (PR) means ${g['pull request'].plain}.`);
});

test('a term that stays where the text spelt it by an alias is listed with that spelling; one spelt as the term is not', () => {
  const g = glossaryOf({});
  assert.equal(plainWords('A PR, then PRs', g, PLAIN).text, `A proposed change, then PRs\n\nTerms: pull request (PR) means ${g['pull request'].plain}.`);
  assert.equal(plainWords('A PR, then a pull request', g, PLAIN).text, `A proposed change, then a pull request\n\nTerms: pull request means ${g['pull request'].plain}.`);
});

test('a known term is kept as it is, named by its term or its concept', () => {
  const g = glossaryOf({});
  const text = "The PR's CI is red on slice 2";
  assert.equal(plainWords(text, g, { explanations: 'plain', known: ['pull-request'] }).text, "The PR's automatic check run is red on piece 2");
  assert.equal(plainWords(text, g, { explanations: 'plain', known: new Set(['pull request', 'CI', 'slice']) }).text, text);
  const some = plainWords(text, g, { explanations: 'some-terms', known: ['ci', 'slice'] });
  assert.match(some.text, /^The PR's CI is red on slice 2\n\nTerms: pull request \(PR\) means a proposed change/);
  assert.doesNotMatch(some.text, /CI means|slice means/);
});

test('with some technical terms, terms are kept with their meanings at the end', () => {
  const g = glossaryOf({});
  const out = plainWords("The PR's CI is red", g, SOME);
  assert.equal(
    out.text,
    `The PR's CI is red\n\nTerms: pull request (PR) means ${g['pull request'].plain}; CI means ${g.CI.plain}.`,
  );
  assert.deepEqual(out.terms, ['pull request', 'CI']);
  assert.equal(plainWords("The PR's CI is red", g, { known: ['pull-request', 'ci'], explanations: 'some-terms' }).text, "The PR's CI is red");
});

test('without a setting, explanations are plain', () => {
  const g = glossaryOf({});
  assert.equal(plainWords('My PR', g).text, 'My proposed change');
  assert.equal(plainWords('My PR', g, {}).text, 'My proposed change');
  assert.equal(plainWords('My PR', g, { explanations: 'nonsense' }).text, 'My proposed change');
});

test('text with no term comes back as it was', () => {
  const g = glossaryOf({});
  assert.deepEqual(plainWords('Nothing technical here', g, PLAIN), { text: 'Nothing technical here', terms: [] });
  assert.deepEqual(plainWords(undefined, g, PLAIN), { text: '', terms: [] });
});

test('the project\'s glossary wins over the starter', () => {
  const g = glossaryOf({
    ci: { data: { term: 'CI', plain: 'our robot inspector', phrase: 'robot inspector', plural: 'robot inspectors' } },
    sprocket: { data: { term: 'sprocket', plain: 'a toothed wheel' } },
  });
  assert.equal(plainWords('Two CIs and a CI', g, PLAIN).text, 'Two robot inspectors and a CI\n\nTerms: CI means our robot inspector.');
  // A project term with no phrase can't be put into a sentence, so it is kept with its meaning.
  assert.equal(plainWords('A sprocket and a PR', g, PLAIN).text, 'A sprocket and a proposed change\n\nTerms: sprocket means a toothed wheel.');
});

test('verbs: a past or -ing form is replaced where there are words for it; the bare verb is kept with its meaning', () => {
  const g = glossaryOf({});
  assert.equal(plainWords('It was merged, then reviewed and committed', g, PLAIN).text, 'It was added to the product, then independently checked and saved');
  assert.equal(plainWords('Reviewing the branches', g, PLAIN).text, 'Independently checking the separate copies of the work');
  const to = plainWords('Ready to merge', g, PLAIN);
  assert.equal(to.text, `Ready to merge\n\nTerms: merge means ${g.merge.plain}.`);
  const verb = plainWords('We will commit it, then the commit is checked', g, PLAIN);
  // The bare verb stays, so the term is listed.
  assert.equal(verb.text, `We will commit it, then the saved step is checked\n\nTerms: commit means ${g.commit.plain}.`);
});

test('STOP, Standard and Locked keep their names, with their meaning, and only in their capitals', () => {
  const g = glossaryOf({});
  assert.equal(
    plainWords('STOP is on, so we stop. Standard is set, not Locked.', g, PLAIN).text,
    'STOP (the emergency stop) is on, so we stop. Standard (the normal protection level) is set, not Locked (the stronger protection level).',
  );
});

test('a term is never left bare: replaced, or listed with its meaning', () => {
  const g = glossaryOf({});
  for (const term of STARTER_TERMS) {
    for (const mode of [PLAIN, SOME]) {
      const out = plainWords(`We looked at ${term} today`, g, mode);
      assert.deepEqual(out.terms, [term], term);
      const listed = out.text.includes(`${term} means ${g[term].plain}`);
      const kept = out.text.split('\n\nTerms:')[0].includes(term);
      assert.ok(listed || !kept || NAMES.includes(term), `${term} (${mode.explanations}): ${out.text}`);
      if (mode === SOME) assert.ok(listed && kept, term);
    }
  }
});

test('every starter term has words that fit a sentence', () => {
  const g = glossaryOf({});
  for (const [term, entry] of Object.entries(g)) {
    assert.ok(entry.phrase || entry.past || entry.ing, term);
    for (const field of ['phrase', 'plural', 'past', 'ing', 'pastBefore', 'ingBefore']) {
      if (entry[field] !== undefined) assert.deepEqual(termsIn(entry[field], g).filter((t) => t !== term), [], `${term}.${field}`);
    }
  }
});

test('knownConcepts reads the known:* settings that are true; conceptOf names a term the same way', () => {
  assert.equal(conceptOf('pull request'), 'pull-request');
  assert.equal(conceptOf('the helper'), 'the-helper');
  assert.equal(conceptOf('CI'), 'ci');
  const settings = {
    explanations: { value: 'plain', from: 'default' },
    'known:ci': { value: true, from: 'profile' },
    'known:slice': { value: false, from: 'profile' },
    'known:the-helper': { value: true, from: 'profile' },
  };
  assert.deepEqual(knownConcepts(settings), ['ci', 'the-helper']);
  assert.deepEqual(knownConcepts(undefined), []);
});

test('commands, addresses, branch and file names, quotations and setting names are kept as written', () => {
  const g = glossaryOf({});
  for (const text of [
    'Run `/wheelhouse:review` now',
    'Type /wheelhouse:review to start',
    'See https://example.com/pull/ci-checks?merge=1 for more',
    'It is on feat/branch-picker today',
    'The file .github/workflows/ci.yml changed',
    'Mail review@example.com about pr-12',
    'Knows "slice": yes',
    'Setting known:ci is on',
    'Pull request "Fix CI on slice 2" is waiting',
    'He called it \u201Cthe PR merge\u201D',
    "It is called 'review' by us",
  ]) {
    const out = plainWords(text, g, PLAIN);
    for (const part of text.match(/`[^`]*`|"[^"]*"|\u201C[^\u201D]*\u201D|'review'|\S*[/@:.-]\S*/g)) assert.ok(out.text.includes(part), `${text} -> ${out.text}`);
  }
  // The words around a protected span still go through.
  assert.equal(plainWords('The PR "Fix CI" has a CI failure', g, PLAIN).text.split('\n\n')[0], 'The proposed change "Fix CI" has an automatic check run failure');
  // A protected mention isn't a term the text used.
  assert.deepEqual(plainWords('Run `/wheelhouse:review` on pr-12', g, PLAIN), { text: 'Run `/wheelhouse:review` on pr-12', terms: [] });
  // An apostrophe in "PR's" opens no quotation.
  assert.equal(plainWords("The PR's CI isn't green; it's the PR's fault", g, PLAIN).text.startsWith("The proposed change's automatic check run isn't"), true);
});

test('text the caller names is kept as written', () => {
  const g = glossaryOf({});
  const out = plainWords('Review round cap: 3. The review ran.', g, { ...PLAIN, protect: ['Review round cap'] });
  assert.equal(out.text, 'Review round cap: 3. The independent check ran.');
  assert.deepEqual(out.terms, ['review']);
});

test('replaced sentences read as English', () => {
  const g = glossaryOf({});
  const plain = (text) => plainWords(text, g, PLAIN).text.split('\n\n')[0];
  assert.equal(plain('We need a review'), 'We need an independent check');
  assert.equal(plain('A review is due'), 'An independent check is due');
  assert.equal(plain('a CI run failed'), 'an automatic check run failed');
  assert.equal(plain('The CI runs failed'), 'The automatic check runs failed');
  assert.equal(plain('a PR'), 'a proposed change');
  assert.equal(plain('merged into main'), 'combined into main');
  assert.equal(plain('merged with main'), 'combined with main');
  assert.equal(plain('The PR was merged'), 'The proposed change was added to the product');
  assert.equal(plain('Merging into main'), 'Combining into main');
  assert.equal(plain('Merged.'), 'Added to the product.');
});

test('a term followed by a name, or by another term, is kept and listed', () => {
  const g = glossaryOf({});
  const branch = plainWords('Branch main is protected', g, PLAIN);
  assert.equal(branch.text, `Branch main is protected\n\nTerms: branch means ${g.branch.plain}.`);
  assert.equal(plainWords('The branch is protected', g, PLAIN).text, 'The separate copy of the work is protected');
  assert.equal(plainWords('On branch feat-x', g, PLAIN).text.split('\n\n')[0], 'On branch feat-x');
  // A verb form after a term is no compound.
  assert.equal(plainWords('1 pull request merged', g, PLAIN).text, '1 proposed change added to the product');
  const compound = plainWords('The PR review is clean', g, PLAIN);
  assert.equal(compound.text, `The PR review is clean\n\nTerms: pull request (PR) means ${g['pull request'].plain}; review means ${g.review.plain}.`);
});
