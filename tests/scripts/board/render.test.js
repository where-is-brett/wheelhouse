// tests/scripts/board/render.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoard, glanceLine } from '../../../scripts/board/render.js';
import { boardModel } from '../../../scripts/board/model.js';
import { CONTEXT_CHARS } from '../../../scripts/lib/core-numbers.js';

const DIRECTOR = ['Waiting on you', 'Progress to launch', 'Work in progress', 'What changed for users', 'The ideas list', 'Health', 'Budget', 'Rulings made within the rules'];
const BUILD = ['Features and their slices', 'Open pull requests', 'Quality this week', 'Decisions made along the way', 'Shortcuts and risks', 'Usage by part'];

const lanes = (over = {}) => ({ quick: [], small: [], feature: [], bug: [], ...over });

// A model in the shape boardModel gives, with something in every section.
function fullModel(over = {}) {
  return {
    project: 'owner__demo',
    builtAt: '2026-10-19T12:00:00.000Z',
    director: {
      first: ['A setting: pace 2, not yet confirmed by you'],
      waiting: [
        { n: 1, what: 'Approve the sign-in page', since: '2026-10-17T09:00:00.000Z' },
        { n: 2, what: 'Which colour for the button?', since: null },
      ],
      launch: { phase: 'before-launch', resolved: 1, total: 3, blockers: ['Payments', 'Privacy page'], next: ['Search'] },
      inProgress: lanes({ feature: [{ title: 'Sign-in page', step: 'building' }], bug: [{ title: 'Broken logo', step: 'planned' }] }),
      changed: [{ what: 'People can reset their password', at: '2026-10-18T10:00:00.000Z' }],
      ideas: { now: ['Dark mode'], next: [], later: ['A mobile app'] },
      health: [{ level: 'stop', text: 'STOP is on, since 18 October 2026' }, { level: 'ok', text: 'Protection: Standard' }],
      budget: { week: { from: '2026-10-13T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z', tokens: 1200000, usd: 84 }, share: 34, setting: 'report', unusual: ['One session used 3.0M tokens, against a usual 400K: a long review'] },
      rulings: [{ what: 'Use British spelling', at: '2026-10-16T10:00:00.000Z' }],
    },
    build: {
      features: [
        { work: 'sign-in', title: 'Sign-in page', lane: 'feature', step: 'building', slice: { n: 2, m: 5 }, pr: 12 },
        { work: 'search', title: 'Search', lane: 'feature', step: 'building', slice: null, pr: null },
        { work: 'logo', title: 'Broken logo', lane: 'bug', step: 'planned', slice: null, pr: null },
        { work: 'dark', title: 'Dark mode', lane: 'small', step: 'building', slice: null, pr: null },
      ],
      pullRequests: [
        { pr: 12, work: 'sign-in', review: 'findings', findings: 3, blocked: null },
        { pr: 14, work: null, review: 'none', findings: null, blocked: null },
        { pr: 15, work: 'search', review: 'none', findings: null, blocked: 'Checks red on #15' },
      ],
      quality: { reviews: 4, withFindings: 1, findings: 3 },
      decisions: [{ what: 'Store sessions in a cookie', why: 'simpler', at: '2026-10-17T10:00:00.000Z' }],
      risks: [{ what: 'No rate limit on sign-in', costLater: 'a day of work' }],
      usage: { 'front-desk': { tokens: 100000, usd: 1 }, foreman: { tokens: 200000, usd: 2 }, feature: { tokens: 900000, usd: 9 }, subagents: 50000 },
    },
    missing: [],
    ...over,
  };
}

const headingsOf = (text) => text.split('\n').filter((line) => /^#{2,3} /.test(line)).map((line) => line.replace(/^#+ /, ''));

test('the director tab comes first by default, and the build tab when asked', () => {
  const text = renderBoard(fullModel());
  assert.deepEqual(headingsOf(text), ['Changed without your confirmation', 'Director', ...DIRECTOR, 'Build', ...BUILD]);
  assert.equal(renderBoard(fullModel(), { tab: 'director' }), text);
  const build = renderBoard(fullModel(), { tab: 'build' });
  assert.deepEqual(headingsOf(build), ['Changed without your confirmation', 'Build', ...BUILD, 'Director', ...DIRECTOR]);
  // A tab that isn't one of the two is the director's.
  assert.equal(renderBoard(fullModel(), { tab: 'other' }), text);

  // The words of each section.
  assert.match(text, /^- 1\\\. Approve the sign-in page, waiting since 17 October 2026$/m);
  assert.match(text, /^- 2\\\. Which colour for the button\?$/m);
  assert.match(text, /^- Phase: before launch$/m);
  assert.match(text, /^- Launch blockers: 1 of 3 resolved$/m);
  assert.match(text, /^- Blocker: Payments$/m);
  assert.match(text, /^- Next: Search$/m);
  assert.match(text, /^- Feature lane: Sign-in page, building$/m);
  assert.match(text, /^- Bug lane: Broken logo, planned$/m);
  assert.match(text, /^- People can reset their password \(18 October 2026\)$/m);
  assert.match(text, /^- Now: Dark mode$/m);
  assert.match(text, /^- Later: A mobile app$/m);
  assert.match(text, /^- STOP is on, since 18 October 2026$/m);
  assert.match(text, /^- This week: 1\.2M tokens, about \$84 at API prices, 34% of your weekly allowance$/m);
  assert.match(text, /^- One session used 3\.0M tokens, against a usual 400K: a long review$/m);
  assert.match(text, /^- Budget: spending is reported, with no limit set$/m);
  assert.match(text, /^- Use British spelling \(16 October 2026\)$/m);
  assert.match(text, /^- Sign-in page \(feature lane\): building, slice 2 of 5, pull request #12$/m);
  assert.match(text, /^- Pull request #12 for sign-in: its review found 3 problems$/m);
  assert.match(text, /^- Pull request #14: not reviewed yet$/m);
  assert.match(text, /^- Pull request #15 for search: blocked: Checks red on #15; not reviewed yet$/m);
  assert.match(text, /^- 4 reviews, 1 with findings, 3 findings in all$/m);
  assert.match(text, /^- Store sessions in a cookie: simpler \(17 October 2026\)$/m);
  assert.match(text, /^- No rate limit on sign-in; it would cost later: a day of work$/m);
  assert.match(text, /^- Front desk: 100K tokens, about \$1$/m);
  assert.match(text, /^- Feature builders: 900K tokens, about \$9$/m);
  assert.match(text, /^- Subagents: 50K tokens$/m);
  assert.match(text.split('\n')[0], /owner__demo.*19 October 2026, 12:00 UTC/);
});

test('every section has its heading and says None when empty', () => {
  const empty = fullModel({
    director: {
      first: [], waiting: [], launch: { phase: null, resolved: 0, total: 0, blockers: [], next: [] }, inProgress: lanes(), changed: [],
      ideas: { now: [], next: [], later: [] }, health: [], budget: { week: null, share: null, setting: null, unusual: [] }, rulings: [],
    },
    build: {
      features: [], pullRequests: [], quality: { reviews: 0, withFindings: 0, findings: 0 }, decisions: [], risks: [],
      usage: { 'front-desk': { tokens: null, usd: null }, foreman: { tokens: null, usd: null }, feature: { tokens: null, usd: null }, subagents: null },
    },
  });
  const text = renderBoard(empty);
  // The unconfirmed changes show only when there are some.
  assert.deepEqual(headingsOf(text), ['Director', ...DIRECTOR, 'Build', ...BUILD]);
  const lines = text.split('\n');
  for (const heading of [...DIRECTOR, ...BUILD]) {
    const at = lines.indexOf(`### ${heading}`);
    assert.ok(at >= 0, heading);
    assert.equal(lines[at + 1], 'None', heading);
  }
});

test('a board too long for the context is cut section by section with and N more', () => {
  const long = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1} ${'x'.repeat(150)}`);
  const m = fullModel();
  m.director.ideas = { now: [], next: [], later: long(200, 'Idea') };
  m.build.risks = long(30, 'Risk').map((what) => ({ what, costLater: 'some' }));
  const text = renderBoard(m);
  assert.ok(text.length <= CONTEXT_CHARS, `${text.length} characters`);
  // The longest section is cut, item by item from its end, and says how many are left out.
  const shownIdeas = text.split('\n').filter((line) => line.startsWith('- Later: Idea ')).length;
  assert.ok(shownIdeas > 0 && shownIdeas < 200);
  assert.match(text, new RegExp(`^- and ${200 - shownIdeas} more$`, 'm'));
  assert.match(text, /^- Later: Idea 1 x/m);
  // The short sections are left whole.
  assert.match(text, /^- 1\\\. Approve the sign-in page/m);
  assert.match(text, /^- Use British spelling/m);
  assert.deepEqual(headingsOf(text), headingsOf(renderBoard(fullModel())));

  // Even when everything is long, every heading stays and the whole fits.
  const huge = fullModel();
  huge.director.waiting = long(300, 'Card').map((what, i) => ({ n: i + 1, what, since: null }));
  huge.director.changed = long(300, 'Change').map((what) => ({ what, at: null }));
  huge.build.decisions = long(300, 'Decision').map((what) => ({ what, why: '', at: null }));
  huge.missing = long(300, 'Missing');
  const cut = renderBoard(huge, { tab: 'build' });
  assert.ok(cut.length <= CONTEXT_CHARS, `${cut.length} characters`);
  assert.deepEqual(headingsOf(cut), [...headingsOf(renderBoard(fullModel(), { tab: 'build' })), 'What couldn\'t be read']);
});

test('text from events never becomes a link or a heading on the board', () => {
  const m = fullModel();
  m.director.changed = [{ what: 'See https://evil.test/x and www.evil.test and a@b.test.', at: null }];
  m.build.risks = [{ what: '# Heading\n[click](https://evil.test) <b>bold</b>', costLater: '' }];
  const text = renderBoard(m);
  assert.match(text, /^- See `https:\/\/evil\.test\/x` and `www\.evil\.test` and `a@b\.test`\.$/m);
  assert.match(text, /^- Heading click bold$/m);
  assert.doesNotMatch(text, /\]\(/);
  assert.doesNotMatch(text, /<b>/);
  assert.equal(text.split('\n').filter((line) => /^#/.test(line)).every((line) => /^#{2,3} [A-Z]/.test(line)), true);
});

test('the glance line keeps to 80 characters and leaves out parts with nothing to say', () => {
  assert.equal(glanceLine(fullModel()), 'Wheelhouse · 2 waiting · 3 building · week 34% · STOP on');
  const calm = fullModel();
  calm.director.waiting = [];
  calm.director.health = [{ level: 'stop', text: 'Incident i1 is open, so nothing merges: x' }];
  calm.director.budget.share = null;
  calm.build.features = [];
  assert.equal(glanceLine(calm), 'Wheelhouse');
  const many = fullModel();
  many.director.waiting = Array.from({ length: 789 }, (_, i) => ({ n: i + 1, what: 'x', since: null }));
  many.director.budget.share = 99.6;
  assert.equal(glanceLine(many), 'Wheelhouse · 789 waiting · 3 building · week 100% · STOP on');
  for (const m of [fullModel(), calm, many]) assert.ok(glanceLine(m).length <= 80);
});

test('with every input missing, the board and the glance still come out and name what is missing', () => {
  const m = boardModel({});
  const text = renderBoard(m);
  assert.ok(text.length > 0 && text.length <= CONTEXT_CHARS);
  assert.deepEqual(headingsOf(text), ['Director', ...DIRECTOR, 'Build', ...BUILD, 'What couldn\'t be read']);
  for (const line of m.missing) assert.ok(text.includes(`- ${line}`), line);
  assert.match(text, /There is no state for this project on this computer yet/);
  assert.match(text, /Usage counts aren't on yet/);
  assert.match(text.split('\n')[0], /the time couldn't be read/);
  assert.equal(glanceLine(m), 'Wheelhouse · no state yet');
  // Nothing at all, or the wrong shape, still gives a board and a line.
  for (const bad of [undefined, null, 'x', [], { director: 5, build: 'x', missing: 'y' }]) {
    assert.equal(typeof renderBoard(bad), 'string');
    assert.ok(renderBoard(bad).length <= CONTEXT_CHARS);
    assert.equal(glanceLine(bad), 'Wheelhouse');
  }
});

test('a limit too small for the headings ends the board at a whole line', () => {
  const m = fullModel();
  const whole = renderBoard(m).split('\n');
  for (const limit of [120, 300, 777]) {
    const cut = renderBoard(m, { limit });
    assert.ok(cut.length <= limit, `${cut.length} > ${limit}`);
    assert.ok(cut.length > 0);
    for (const line of cut.split('\n')) assert.ok(line === '' || whole.includes(line) || /^- and \d+ more$/.test(line), line);
  }
  // A limit above CONTEXT_CHARS, or one that isn't a whole number, is CONTEXT_CHARS.
  assert.equal(renderBoard(m, { limit: CONTEXT_CHARS * 2 }), renderBoard(m));
  assert.equal(renderBoard(m, { limit: 'x' }), renderBoard(m));
});
