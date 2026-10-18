// tests/scripts/feature/files.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FEATURE_DIR,
  featurePaths,
  parseBrief,
  briefHash,
  readStatus,
  writeStatus,
  readQuestions,
  parseReport,
  ensureIgnored,
} from '../../../scripts/feature/files.js';
import { REPORT_WORDS } from '../../../scripts/lib/build-loop.js';
import { tempFolder } from '../../helpers/homes.js';

const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

const briefFields = () => ({
  v: 1,
  work: 'login-page',
  lane: 'feature',
  version: 1,
  goal: 'Let people sign in',
  done: ['Sign in works', 'Tests pass'],
  appetite: { sessions: 2, tokens: 400000 },
  rulings: [{ id: 'r-1', words: 'Use the existing session store' }],
  routing: { bug: 'systematic-debugging' },
  shownFirst: true,
  plan: 'docs/plans/login.md',
  slices: 2,
});

const status = () => ({
  v: 1,
  work: 'login-page',
  lane: 'feature',
  phase: 'building',
  task: { n: 2, m: 5 },
  fixRound: null,
  waitingOn: null,
  head: 'abc123def456',
  pr: null,
  slice: { n: 1, m: 2 },
  tokens: 12000,
  updatedAt: '2026-10-18T01:02:03.000Z',
});

const question = (n = 1, extra = {}) => ({
  id: `q-login-page-${n}`,
  kind: 'question',
  what: 'Which provider?',
  why: 'It decides what users see',
  options: [{ label: 'A', says: 'Use A' }, { label: 'B', says: 'Use B' }],
  recommendation: 'A',
  level: 3,
  ...extra,
});

test('the feature folder and its four files are named once', () => {
  const p = featurePaths('/w/tree');
  assert.equal(FEATURE_DIR, '.wheelhouse/feature');
  assert.deepEqual(p, {
    dir: path.join('/w/tree', '.wheelhouse', 'feature'),
    brief: path.join('/w/tree', '.wheelhouse', 'feature', 'brief.md'),
    status: path.join('/w/tree', '.wheelhouse', 'feature', 'status.json'),
    questions: path.join('/w/tree', '.wheelhouse', 'feature', 'questions.jsonl'),
    report: path.join('/w/tree', '.wheelhouse', 'feature', 'report.md'),
    rulings: path.join('/w/tree', '.wheelhouse', 'feature', 'rulings.jsonl'),
    session: path.join('/w/tree', '.wheelhouse', 'feature', 'session.json'),
    pr: path.join('/w/tree', '.wheelhouse', 'feature', 'pr.json'),
  });
});

test('a brief round-trips through its JSON block and text', () => {
  const text = `${fence(briefFields())}\n# Brief\n\nBuild the login page.\n`;
  const { fields, body } = parseBrief(text);
  assert.deepEqual(fields, briefFields());
  assert.equal(body, '\n# Brief\n\nBuild the login page.\n');
  const minimal = { ...briefFields() };
  delete minimal.plan;
  delete minimal.slices;
  assert.deepEqual(parseBrief(fence(minimal)).fields, minimal);
});

test('a brief without its JSON block, or with a wrong field, cannot be read', () => {
  const cant = { message: "The brief can't be read" };
  assert.throws(() => parseBrief('# Just text\n'), cant);
  assert.throws(() => parseBrief(`Intro first\n\n${fence(briefFields())}`), cant);
  assert.throws(() => parseBrief('```json\n{not json\n```\n'), cant);
  assert.throws(() => parseBrief('```json\n[]\n```\n'), cant);
  assert.throws(() => parseBrief(42), cant);
  const wrong = [
    { v: 2 },
    { work: 'Bad Slug' },
    { lane: 'huge' },
    { version: '1' },
    { goal: 7 },
    { done: 'all' },
    { done: [1] },
    { appetite: { sessions: 2 } },
    { appetite: { sessions: '2', tokens: 1 } },
    { rulings: [{ id: 'r-1' }] },
    { routing: { bug: 3 } },
    { routing: [] },
    { shownFirst: 'yes' },
    { plan: 4 },
    { slices: '2' },
    { extra: true },
  ];
  for (const change of wrong) {
    assert.throws(() => parseBrief(fence({ ...briefFields(), ...change })), cant, JSON.stringify(change));
  }
  const missing = briefFields();
  delete missing.goal;
  assert.throws(() => parseBrief(fence(missing)), cant);
});

test('the brief hash ignores CRLF line endings', () => {
  const lf = `${fence(briefFields())}\nLine one\nLine two\n`;
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(briefHash(lf), briefHash(crlf));
  assert.match(briefHash(lf), /^[0-9a-f]{64}$/);
  assert.notEqual(briefHash(lf), briefHash(`${lf}more`));
});

test('a status is written whole and read back', () => {
  const dir = tempFolder('wh-feat-');
  const file = path.join(dir, 'nested', 'status.json');
  writeStatus(file, status());
  assert.deepEqual(readStatus(file), status());
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['status.json']);
  assert.throws(() => writeStatus(file, { ...status(), phase: 'nap' }), { message: "The status can't be written" });
  assert.deepEqual(readStatus(file), status());
});

test('a malformed status reads as null', () => {
  const dir = tempFolder('wh-feat-');
  const file = path.join(dir, 'status.json');
  assert.equal(readStatus(file), null);
  const put = (x) => fs.writeFileSync(file, typeof x === 'string' ? x : JSON.stringify(x));
  put('{not json');
  assert.equal(readStatus(file), null);
  put('[]');
  assert.equal(readStatus(file), null);
  put('null');
  assert.equal(readStatus(file), null);
  const wrong = [
    { v: 2 },
    { work: 'Bad Slug' },
    { lane: 'huge' },
    { phase: 'nap' },
    { task: { n: 1 } },
    { task: { n: 3, m: 2 } },
    { task: [1, 2] },
    { fixRound: 'one' },
    { waitingOn: 'weather' },
    { head: 5 },
    { pr: '7' },
    { slice: { n: 1, m: 'x' } },
    { tokens: 'lots' },
    { updatedAt: 'yesterday' },
    { updatedAt: '2026-10-18' },
    { extra: 1 },
  ];
  for (const change of wrong) {
    put({ ...status(), ...change });
    assert.equal(readStatus(file), null, JSON.stringify(change));
  }
  const missing = status();
  delete missing.pr;
  put(missing);
  assert.equal(readStatus(file), null);
  for (const change of [{ task: { n: -1, m: 3 } }, { task: { n: 0, m: 0 } }, { slice: { n: 0, m: 2 } }]) {
    put({ ...status(), ...change });
    assert.equal(readStatus(file), null, JSON.stringify(change));
  }
  // No task complete yet is 0 of m.
  put({ ...status(), task: { n: 0, m: 4 } });
  assert.deepEqual(readStatus(file).task, { n: 0, m: 4 });
  put({ ...status(), task: { n: 4, m: 4 } });
  assert.deepEqual(readStatus(file).task, { n: 4, m: 4 });
  put({ ...status(), task: null, slice: null, head: null, tokens: null, fixRound: 2, waitingOn: 'ci', pr: 9, phase: 'waiting' });
  assert.equal(readStatus(file).waitingOn, 'ci');
});

test('malformed question lines are skipped and counted; reading stops at 64 KB', () => {
  const dir = tempFolder('wh-feat-');
  const file = path.join(dir, 'questions.jsonl');
  assert.deepEqual(readQuestions(file), { questions: [], skipped: 0, truncated: false });
  const extra = question(2, { kind: 'extra-plan', plan: 'docs/plans/part-two.md' });
  const lines = [
    JSON.stringify(question(1)),
    '{broken',
    '',
    JSON.stringify({ ...question(3), level: 5 }),
    JSON.stringify({ ...question(4), kind: 'extra-plan' }),
    JSON.stringify({ ...question(5), options: [] }),
    JSON.stringify({ ...question(6), id: 'nope' }),
    JSON.stringify([1]),
    JSON.stringify(extra),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const got = readQuestions(file);
  assert.deepEqual(got.questions, [question(1), extra]);
  assert.equal(got.skipped, 6);
  assert.equal(got.truncated, false);

  // Past the limit nothing is read, and a line cut short is counted as skipped.
  const first = JSON.stringify(question(1));
  const filler = JSON.stringify(question(2, { what: 'x'.repeat(70000) }));
  fs.writeFileSync(file, `${first}\n${filler}\n${JSON.stringify(question(3))}\n`);
  const capped = readQuestions(file);
  assert.deepEqual(capped.questions.map((q) => q.id), ['q-login-page-1']);
  assert.equal(capped.skipped, 1);
  assert.equal(capped.truncated, true);
  assert.equal(readQuestions(file, { maxBytes: 1 << 20 }).questions.length, 3);

  // A file that ends exactly on a line boundary at the limit loses nothing.
  fs.writeFileSync(file, `${first}\n`);
  assert.deepEqual(readQuestions(file, { maxBytes: Buffer.byteLength(`${first}\n`) }), { questions: [question(1)], skipped: 0, truncated: false });
});

test('a report over 300 words is reported with its count', () => {
  const fields = { v: 1, work: 'login-page', status: 'done', pr: 12, head: 'abc123def456', tests: '41 pass', assumptions: ['a'], concerns: [], rulings: ['Used the store'] };
  const body = Array.from({ length: REPORT_WORDS }, (_, i) => `w${i}`).join(' ');
  const ok = parseReport(`${fence(fields)}\n${body}\n`);
  assert.deepEqual(ok.fields, fields);
  assert.equal(ok.words, REPORT_WORDS);
  assert.equal(ok.body.trim(), body);
  const long = parseReport(`${fence(fields)}\n${body} extra\n`);
  assert.equal(long.words, REPORT_WORDS + 1);
  assert.ok(long.words > REPORT_WORDS);
  assert.equal(parseReport(fence({ ...fields, pr: undefined, head: undefined })).words, 0);
  const cant = { message: "The report can't be read" };
  assert.throws(() => parseReport('Words only'), cant);
  assert.throws(() => parseReport(fence({ ...fields, status: 'lost' })), cant);
  assert.throws(() => parseReport(fence({ ...fields, concerns: 'none' })), cant);
  assert.throws(() => parseReport(fence({ ...fields, tests: 3 })), cant);
  assert.throws(() => parseReport(fence({ ...fields, extra: 1 })), cant);
});

test('a multi-byte character cut by the limit leaves no broken line behind', () => {
  const dir = tempFolder('wh-feat-');
  const file = path.join(dir, 'questions.jsonl');
  const first = `${JSON.stringify(question(1))}\n`;
  const second = `${JSON.stringify(question(2, { what: 'é'.repeat(50) }))}\n`;
  fs.writeFileSync(file, first + second);
  const start = Buffer.byteLength(first) + Buffer.byteLength('{"id":"q-login-page-2","kind":"question","what":"');
  for (const cutAt of [start + 1, start + 2, start + 3]) {
    const got = readQuestions(file, { maxBytes: cutAt });
    assert.deepEqual(got.questions.map((q) => q.id), ['q-login-page-1']);
    assert.equal(got.skipped, 1);
    assert.equal(got.truncated, true);
  }
});

test('question lines ending in CRLF are read', () => {
  const dir = tempFolder('wh-feat-');
  const file = path.join(dir, 'questions.jsonl');
  fs.writeFileSync(file, `${JSON.stringify(question(1))}\r\n${JSON.stringify(question(2))}\r\n`);
  assert.deepEqual(readQuestions(file), { questions: [question(1), question(2)], skipped: 0, truncated: false });
});

test('a lone carriage return hashes as a line ending', () => {
  assert.equal(briefHash('a\rb\r\nc'), briefHash('a\nb\nc'));
});

test('a status over 64 KB reads as null', () => {
  const dir = tempFolder('wh-feat-');
  const file = path.join(dir, 'status.json');
  fs.writeFileSync(file, `${JSON.stringify(status())}${' '.repeat(70000)}`);
  assert.equal(readStatus(file), null);
  fs.writeFileSync(file, JSON.stringify(status()));
  assert.deepEqual(readStatus(file), status());
});

function bareRepo(root) {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  return path.join(root, '.git');
}

// A worktree made by hand the way git lays it out: a .git file and a commondir.
function fakeWorktree(main, tree, name) {
  const admin = path.join(main, '.git', 'worktrees', name);
  fs.mkdirSync(admin, { recursive: true });
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
  fs.mkdirSync(tree, { recursive: true });
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${admin}\n`);
}

test('ensureIgnored adds the entry once, from the folder itself and from a worktree, without running git', () => {
  const base = tempFolder('wh-ign-');
  const main = path.join(base, 'main');
  const git = bareRepo(main);
  const exclude = path.join(git, 'info', 'exclude');
  const before = process.env.PATH;
  process.env.PATH = ''; // Git cannot be found, so any attempt to run it would fail.
  try {
    ensureIgnored(main, { mainCheckout: main });
    ensureIgnored(main, { mainCheckout: main });
    assert.equal(fs.readFileSync(exclude, 'utf8'), '.wheelhouse/\n');
    const tree = path.join(base, 'tree');
    fakeWorktree(main, tree, 'tree');
    ensureIgnored(tree, { mainCheckout: main });
    ensureIgnored(tree, { mainCheckout: main });
    assert.equal(fs.readFileSync(exclude, 'utf8'), '.wheelhouse/\n');
    assert.equal(fs.existsSync(path.join(tree, '.gitignore')), false);
    assert.equal(fs.existsSync(path.join(main, '.gitignore')), false);
  } finally {
    process.env.PATH = before;
  }
  // Existing entries are kept, a missing final newline is supplied, and a line already naming it counts.
  fs.writeFileSync(exclude, '# mine\n*.log');
  ensureIgnored(main, { mainCheckout: main });
  assert.equal(fs.readFileSync(exclude, 'utf8'), '# mine\n*.log\n.wheelhouse/\n');
  fs.writeFileSync(exclude, '/.wheelhouse/\r\n');
  ensureIgnored(main, { mainCheckout: main });
  assert.equal(fs.readFileSync(exclude, 'utf8'), '/.wheelhouse/\r\n');
});

const refused = { message: "The worktree's git folder isn't the project's" };

test('ensureIgnored refuses a worktree whose .git file points at another repository', () => {
  const base = tempFolder('wh-ign-');
  const main = path.join(base, 'main');
  const other = path.join(base, 'other');
  bareRepo(main);
  const otherGit = bareRepo(other);
  // A fake folder outside the project whose commondir leads to the other repository's .git.
  const fake = path.join(base, 'fake');
  fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'commondir'), `${otherGit}\n`);
  const tree = path.join(base, 'tree');
  fs.mkdirSync(tree);
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${fake}\n`);
  assert.throws(() => ensureIgnored(tree, { mainCheckout: main }), refused);
  assert.throws(() => ensureIgnored(tree, { mainCheckout: other }), refused);
  assert.equal(fs.existsSync(path.join(otherGit, 'info', 'exclude')), false);
  assert.equal(fs.existsSync(path.join(main, '.git', 'info', 'exclude')), false);
  // A genuine worktree of one project is no worktree of another.
  const real = path.join(base, 'real');
  fakeWorktree(other, real, 'real');
  assert.throws(() => ensureIgnored(real, { mainCheckout: main }), refused);
  assert.equal(fs.existsSync(path.join(main, '.git', 'info', 'exclude')), false);
  // A .git file whose folder is the project's but not under worktrees/ is refused too.
  const stray = path.join(base, 'stray');
  fs.mkdirSync(stray);
  fs.writeFileSync(path.join(stray, '.git'), `gitdir: ${path.join(main, '.git')}\n`);
  fs.writeFileSync(path.join(main, '.git', 'commondir'), '.\n');
  assert.throws(() => ensureIgnored(stray, { mainCheckout: main }), refused);
});

test('ensureIgnored refuses a symlinked .git and writes nothing', { skip: process.platform === 'win32' }, () => {
  const base = tempFolder('wh-ign-');
  const main = path.join(base, 'main');
  const git = bareRepo(main);
  const tree = path.join(base, 'tree');
  fs.mkdirSync(tree);
  fs.symlinkSync(git, path.join(tree, '.git'));
  assert.throws(() => ensureIgnored(tree, { mainCheckout: main }), refused);
  assert.equal(fs.existsSync(path.join(git, 'info', 'exclude')), false);
  // A symlinked main .git is refused as well.
  const linked = path.join(base, 'linked');
  fs.mkdirSync(linked);
  fs.symlinkSync(git, path.join(linked, '.git'));
  assert.throws(() => ensureIgnored(linked, { mainCheckout: linked }), refused);
  assert.equal(fs.existsSync(path.join(git, 'info', 'exclude')), false);
});

test('ensureIgnored refuses a folder that is in no repository, or without the project named', () => {
  const dir = tempFolder('wh-ign-');
  assert.throws(() => ensureIgnored(dir, { mainCheckout: dir }), refused);
  const main = path.join(dir, 'main');
  bareRepo(main);
  assert.throws(() => ensureIgnored(main), refused);
});
