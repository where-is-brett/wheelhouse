// tests/scripts/proof/note.test.js
// The proof note a finished piece reaches the director as (design section 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADINGS, proofNote } from '../../../scripts/proof/note.js';
import { REPORT_WORDS } from '../../../scripts/lib/build-loop.js';

const words = (text) => text.split(/\s+/).filter(Boolean).length;

const fields = (extra = {}) => ({
  v: 1, work: 'tide-table', status: 'done', tests: '14 tests pass', assumptions: ['Tides are in local time'], concerns: [], rulings: [], ...extra,
});
const base = (over = {}) => ({
  report: { fields: fields(), body: 'The tide table now shows each harbour\'s next high tide.', goal: 'Show the next tide for each harbour' },
  calls: [{ decided: 'Round times to the minute', options: ['Minute', 'Second'], why: 'Seconds add noise', kind: 'structure' }],
  followed: [{ question: 'Which harbours first?', answer: 'The two largest' }],
  review: null,
  previews: [],
  data: null,
  ...over,
});
const headingsOf = (note) => [...note.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

test('the note has the headings in order and stays within the report\'s word limit', () => {
  const long = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
  const many = Array.from({ length: 40 }, (_, i) => ({ decided: `Call ${i} ${long}`, options: ['a', 'b'], why: long, kind: 'structure' }));
  const note = proofNote(base({
    report: { fields: fields({ tests: long }), body: long, goal: long },
    calls: many,
    followed: many.map((c) => ({ question: c.decided, answer: long })),
    previews: [{ page: '/tides' }, { page: '/harbours' }],
    data: { route: 'test', comparison: { counts: Array.from({ length: 30 }, (_, i) => ({ table: `t${i}`, before: 1, after: 2 })), changed: [], unexpected: [] } },
  }));
  assert.deepEqual(headingsOf(note), [...HEADINGS]);
  assert.ok(words(note) <= REPORT_WORDS, `${words(note)} words`);
  assert.ok(note.trimEnd().endsWith('On test data.'));
  // Even when every part is long, the last build is cut hard before it is returned over the limit.
  const huge = proofNote(base({ notes: Array.from({ length: 2 }, () => long), report: { fields: fields({ concerns: Array.from({ length: 9 }, () => long) }), body: long, goal: long } }));
  assert.ok(words(huge) <= REPORT_WORDS);
  // A short note is whole, not cut.
  const short = proofNote(base());
  assert.ok(short.includes('next high tide'));
  assert.ok(short.includes('Round times to the minute'));
  assert.ok(short.includes('Which harbours first?'));
  assert.ok(short.includes('14 tests pass'));
  assert.deepEqual(headingsOf(short), HEADINGS.slice(0, 6));
});

test('a note with no data work has no data section', () => {
  const note = proofNote(base());
  assert.ok(!note.includes('The data, before and after'));
  assert.ok(!note.includes('On test data.'));
  assert.ok(!note.includes('real data'));
});

test('a note with data work says which data it ran on, last', () => {
  const comparison = { counts: [{ table: 'boats', before: 3, after: 4 }], changed: [{ table: 'boats', key: 'w-tide-1', column: 'status', before: 'new', after: 'ready' }], unexpected: ['crews moved, and the change was not expected to touch it'] };
  const real = proofNote(base({ data: { route: 'real', comparison } }));
  assert.ok(real.trimEnd().endsWith('On a read-only sample of real data.'));
  assert.ok(real.includes('`boats`: 3 to 4'));
  assert.ok(real.includes('`w-tide-1`'));
  assert.ok(real.includes('crews moved'));
  const test = proofNote(base({ data: { route: 'test', comparison: { counts: [{ table: 'boats', before: 3, after: 3 }], changed: [], unexpected: [] } } }));
  assert.ok(test.trimEnd().endsWith('On test data.'));
  assert.ok(test.includes('Nothing moved that was not expected'));
  // Data work with no comparison says why, and still names its data.
  const none = proofNote(base({ data: { route: 'test', none: 'The project names no data command' } }));
  assert.ok(none.includes('No comparison was made: The project names no data command'));
  assert.ok(none.trimEnd().endsWith('Nothing was compared.'));
  assert.ok(!none.includes('On test data.'));
  // A failure, and a check that could not be made, are said as such beside the session's reason.
  const failed = proofNote(base({ data: { route: 'test', failure: 'it could not run', none: 'Only adds a column' } }));
  assert.ok(failed.includes('The data command failed: it could not run'));
  assert.ok(failed.includes("The session's reason: Only adds a column"));
  const missed = proofNote(base({ data: { route: 'test', unavailable: 'All stop is on', none: 'Only adds a column' } }));
  assert.ok(missed.includes('## The data, before and after\n\nThe data check could not be made: All stop is on'));
  assert.ok(missed.trimEnd().endsWith('Nothing was compared.'));
  // Names and values are code, so nothing in them reads as the note's own marks.
  const odd = proofNote(base({ data: { route: 'test', comparison: { counts: [{ table: 'a`b', before: 1, after: 2 }], changed: [{ table: 'a', key: '**k**', column: 'c', before: '<x>', after: '`y`' }], unexpected: [] } } }));
  assert.ok(odd.includes("`a'b`: 1 to 2"));
  assert.ok(odd.includes('`**k**`'));
  // A real route that was refused is said, and the note falls back to test data.
  const refused = proofNote(base({ data: { route: 'test', realRefused: 'no signed approval', comparison: { counts: [], changed: [], unexpected: [] } } }));
  assert.ok(refused.includes('The real-data route was not used: no signed approval'));
});

test('the note says what it decided, what it followed, how it was checked and what it looks like', () => {
  const none = proofNote(base({ calls: [], followed: [] }));
  assert.ok(none.includes('Nothing was decided on its own.'));
  assert.ok(none.includes('No decision of the director\'s applied.'));
  const reviewed = proofNote(base({ review: { verdict: 'FINDINGS', findings: 2, blocking: 0, lenses: ['security', 'accessibility'] }, previews: [{ page: '/tides' }] }));
  assert.ok(reviewed.includes('2 findings, none blocking'));
  assert.ok(reviewed.includes('security, accessibility'));
  assert.ok(reviewed.includes('The change touches `/tides`.'));
  assert.ok(!reviewed.includes('Show me'));
  const clean = proofNote(base({ review: { verdict: 'CLEAN', findings: 0, blocking: 0 } }));
  assert.ok(clean.includes('reviewed independently and found nothing'));
  const waiting = proofNote(base());
  assert.ok(waiting.includes('independent review follows'));
  assert.ok(waiting.includes('Nothing on a page changed'));
});
