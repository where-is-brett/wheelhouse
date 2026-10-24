// tests/probes/19-setup-time/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stepTimes, summarise, notesSection, installLineOf, desktopNote, statusOf, gone, askedDurations, pickRun, questionTimes,
  assertScratch, times, setup, minutes, TARGET_MINUTES, TITLES, PREFIX,
} from '../../../probes/19-setup-time/run.js';
import { stepTimes as journalStepTimes } from '../../../scripts/setup/journal.js';
import { TARGET_MINUTES as DESIGN_TARGET } from '../../../scripts/lib/setup-numbers.js';
import { SETUP_TITLES } from '../../../scripts/state/card-lines.js';
import { INSTALL_LINE } from '../../../scripts/setup/tools.js';

const README = fs.readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf8');
const T0 = Date.parse('2026-10-25T01:00:00.000Z');
const at = (min) => new Date(T0 + min * 60 * 1000).toISOString();

// A run as the journal holds it: step 1 settled with its first message, cards on steps 2, 3, 6, 7,
// 8 and 10, questions on 3 and 4, step 9 settled after its questions, and the health check's green.
function aRun({ green = 14, first = 0 } = {}) {
  return {
    id: 'run-0123456789', folder: '/Users/wh19probe/Projects/wh19-trial', startedAt: at(1),
    steps: {
      1: { doneAt: at(1) },
      2: { shownAt: at(1.5), clickedAt: at(2), doneAt: at(2.2) },
      3: { shownAt: at(3), clickedAt: at(3.5), doneAt: at(6) },
      4: { doneAt: at(7) },
      5: { doneAt: at(7.1) },
      6: { shownAt: at(7.2), clickedAt: at(7.6), doneAt: at(7.8) },
      7: { shownAt: at(8), clickedAt: at(8.5), doneAt: at(9.5) },
      8: { shownAt: at(9.6), clickedAt: at(9.8), doneAt: at(9.9) },
      9: { doneAt: at(12.5) },
      10: { shownAt: at(12.6), clickedAt: at(13), doneAt: at(green) },
    },
    changes: [
      { id: 'chg-1', step: 1, kind: 'answer', target: 'step 1', before: null, after: { firstMessageAt: first === null ? null : at(first), startedAt: at(1) } },
      { id: 'chg-2', step: 2, kind: 'json-key', target: '/x/settings.local.json', key: ['permissions', 'allow'], before: null, after: ['x'] },
      { id: 'chg-10', step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: at(green) } },
    ],
  };
}
const ASKED = [
  { runId: 'run-0123456789', step: 3, id: 'real-users', at: at(2.3) },
  { runId: 'run-0123456789', step: 4, id: 'product', at: at(6.1) },
  { runId: 'run-0123456789', step: 4, id: 'live-data', at: at(6.5) },
  { runId: 'run-other00000', step: 4, id: 'product', at: at(6.1) },
];
const answer = (step, questionId, min, runId = 'run-0123456789') => ({ kind: 'action', at: at(min), data: { action: 'setup-answer', runId, step, questionId } });
const ANSWERS = [answer(3, 'real-users', 2.8), answer(4, 'product', 6.4), answer(4, 'live-data', 6.9), answer(4, 'product', 9, 'run-other00000')];

test('the copied numbers and titles are the plugin\'s own', () => {
  assert.equal(TARGET_MINUTES, DESIGN_TARGET);
  assert.deepEqual({ ...TITLES }, { ...SETUP_TITLES });
});

test('stepTimes is journal.js\'s, case for case', () => {
  const run = aRun();
  run.steps[5] = { shownAt: at(7), clickedAt: 'not a time', doneAt: at(7.1) };
  run.steps[11] = { shownAt: at(1), clickedAt: at(2) };
  assert.deepEqual(stepTimes(run), journalStepTimes(run));
  assert.deepEqual(stepTimes({}), journalStepTimes({}));
  assert.deepEqual(stepTimes(aRun()).map((t) => t.step), [2, 3, 6, 7, 8, 10]);
});

test('questions are timed from their last asking to the latest answer after it, for their own run only', () => {
  const got = questionTimes('run-0123456789', [...ASKED, { runId: 'run-0123456789', step: 9, id: 'phone-ready', at: at(10) }],
    [...ANSWERS, answer(9, 'phone-ready', 9.5)]);
  assert.deepEqual(got.map((q) => [q.step, q.id, minutes(q.directorMs)]), [[3, 'real-users', 0.5], [4, 'product', 0.3], [4, 'live-data', 0.4], [9, 'phone-ready', null]]);
});

test('the summary runs from step 1\'s first message to the green board, and its shares add up to the total', () => {
  const s = summarise(aRun(), { asked: ASKED, answers: ANSWERS });
  assert.equal(s.firstMessageAt, at(0));
  assert.equal(s.greenAt, at(14));
  assert.equal(s.totalMinutes, 14);
  assert.equal(s.verdict, 'Yes');
  assert.equal(s.steps.reduce((sum, x) => sum + x.shareMs, 0), s.totalMs);
  const three = s.steps.find((x) => x.step === 3);
  assert.equal(minutes(three.cardMs), 0.5);
  assert.equal(minutes(three.waitMs), 2.5);
  assert.deepEqual(three.questions.map((q) => q.id), ['real-users']);
  assert.equal(minutes(three.directorMs), 1);
  assert.deepEqual(s.slowest, [3, 9, 7]);
  assert.deepEqual(s.unfinished, []);
});

test('the verdict: up to two minutes over the target is Yes, more is Partly, no green board is neither', () => {
  assert.equal(summarise(aRun({ green: TARGET_MINUTES + 2 })).verdict, 'Yes');
  assert.equal(summarise(aRun({ green: TARGET_MINUTES + 2.2 })).verdict, 'Partly');
  const unfinished = aRun();
  delete unfinished.steps[10].doneAt;
  unfinished.changes = unfinished.changes.filter((c) => c.step !== 10);
  const s = summarise(unfinished);
  assert.equal(s.verdict, 'No green board');
  assert.equal(s.totalMs, null);
  assert.deepEqual(s.unfinished, [10]);
});

test('with no first message found, the run\'s own start is the start (ruling R76)', () => {
  const s = summarise(aRun({ first: null }));
  assert.equal(s.firstMessageAt, null);
  assert.equal(s.startAt, at(1));
  assert.equal(s.totalMinutes, 13);
});

test('a failed step is named, and the notes table carries every step', () => {
  const run = aRun();
  run.steps[3].failed = 'the sign-in timed out';
  const text = notesSection(summarise(run, { asked: ASKED, answers: ANSWERS }), { at: at(20) });
  assert.match(text, /^## Times \(from the journal, read /);
  assert.match(text, /\| 3\. The host and the connection \(failed once: the sign-in timed out\) \| 0\.5 \| real-users 0\.5 \| 2\.5 \|/);
  for (const n of Object.keys(TITLES)) assert.match(text, new RegExp(`\\| ${n}\\. `));
  assert.match(text, /Total, first message to green board: 14 minutes \(target 15/);
  assert.match(text, /Verdict on these numbers: Yes\./);
});

test('a folder\'s newest run is picked; with no folder, the newest of all', { skip: process.platform === 'win32' ? 'check 19 runs on a Mac, and these folders are a Mac\'s paths' : false }, () => {
  const journal = { v: 1, runs: [
    { id: 'run-a', folder: '/f/one', startedAt: at(0) },
    { id: 'run-b', folder: '/f/two', startedAt: at(5) },
    { id: 'run-c', folder: '/f/one', startedAt: at(3) },
  ] };
  assert.equal(pickRun(journal, '/f/one').id, 'run-c');
  assert.equal(pickRun(journal).id, 'run-b');
  assert.equal(pickRun(journal, '/f/three'), null);
  assert.equal(pickRun({ v: 1, runs: [] }), null);
  assert.equal(pickRun(journal, '/link/one', { real: (p) => p.replace('/link/', '/f/') }).id, 'run-c');
});

test('the note carries the README\'s own install line, with the tag put in that line only', () => {
  assert.equal(installLineOf(README), INSTALL_LINE);
  const note = desktopNote(README, 'v0.0.0-probe19');
  assert.ok(note.includes(INSTALL_LINE.replace('#<tag>', '#v0.0.0-probe19')));
  assert.ok(!note.includes('#<tag>'));
  assert.ok(note.includes('## Install'));
  assert.ok(note.includes('wh19-trial'));
  assert.ok(!/^## (?!Install)/m.test(note), 'only the Install section');
  assert.throws(() => desktopNote(README, 'v1 && rm'), /tag/);
  assert.throws(() => installLineOf('# no line here'), /no install line/);
});

test('the status is read from gh api -i\'s head, or from its error line', () => {
  assert.equal(statusOf('HTTP/2.0 404 Not Found\nX-GitHub-Request-Id: 1\n\n{"message":"Not Found"}'), 404);
  assert.equal(statusOf('HTTP/1.1 200 OK\n'), 200);
  assert.equal(statusOf('gh: Not Found (HTTP 404)'), 404);
  assert.equal(statusOf('nothing'), null);
});

// `gone` is given a stand-in for gh: the real one is never run here.
function standInGh(answers) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    const key = args.join(' ');
    return answers[key] ?? { code: 1, stdout: '', stderr: 'unexpected' };
  };
  return { run, calls };
}

test('gone: a 404 counts only once gh says who it is signed in as', async () => {
  const lines = [];
  const say = (line) => lines.push(line);
  const absent = standInGh({
    'api user --jq .login': { code: 0, stdout: 'a-director\n', stderr: '' },
    'api -i repos/a-director/wh19-trial': { code: 1, stdout: 'HTTP/2.0 404 Not Found\n\n{}', stderr: 'gh: Not Found (HTTP 404)' },
  });
  assert.deepEqual(await gone(['a-director/wh19-trial'], { run: absent.run, say }), { ok: true, status: 404, login: 'a-director' });
  assert.deepEqual(absent.calls.map((c) => c[0]), ['gh', 'gh']);
  assert.equal((await gone(['a-director/wh19-trial', '--want', 'present'], { run: absent.run, say })).ok, false);

  const present = standInGh({
    'api user --jq .login': { code: 0, stdout: 'a-director\n', stderr: '' },
    'api -i repos/a-director/wh19-trial': { code: 0, stdout: 'HTTP/2.0 200 OK\n\n{}', stderr: '' },
  });
  assert.equal((await gone(['a-director/wh19-trial'], { run: present.run, say })).ok, false);
  assert.equal((await gone(['a-director/wh19-trial', '--want', 'present'], { run: present.run, say })).ok, true);

  const signedOut = standInGh({ 'api user --jq .login': { code: 1, stdout: '', stderr: 'gh auth login' } });
  assert.deepEqual(await gone(['a-director/wh19-trial'], { run: signedOut.run, say }), { ok: false, status: null, login: null });
  assert.equal(signedOut.calls.length, 1, 'the repository is not asked about when gh is signed out');
  await assert.rejects(gone(['not a repo'], { run: signedOut.run, say }), /Usage/);
  assert.ok(lines.some((l) => l.includes('HTTP 404 (asked as a-director): absent')));
});

test('gone: a 404 for a repository the signed-in login doesn\'t own can\'t tell', async () => {
  const lines = [];
  const say = (line) => lines.push(line);
  const other = standInGh({
    'api user --jq .login': { code: 0, stdout: 'someone-else\n', stderr: '' },
    'api -i repos/a-director/wh19-trial': { code: 1, stdout: 'HTTP/2.0 404 Not Found\n\n{}', stderr: 'gh: Not Found (HTTP 404)' },
  });
  assert.deepEqual(await gone(['a-director/wh19-trial'], { run: other.run, say }), { ok: false, status: 404, login: 'someone-else' });
  assert.ok(lines.some((l) => l.includes('HTTP 404 (asked as someone-else): can\'t tell')), lines.join('\n'));
  // GitHub's logins are not case-sensitive.
  const cased = standInGh({
    'api user --jq .login': { code: 0, stdout: 'A-Director\n', stderr: '' },
    'api -i repos/a-director/wh19-trial': { code: 1, stdout: 'HTTP/2.0 404 Not Found\n\n{}', stderr: 'gh: Not Found (HTTP 404)' },
  });
  assert.equal((await gone(['a-director/wh19-trial'], { run: cased.run, say })).ok, true);
});

test('setup: of the shared folder\'s files only the notes are writable by every account', { skip: process.platform === 'win32' ? 'no account modes on Windows' : false }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIX}-test-`));
  const log = console.log;
  try {
    console.log = () => {};
    setup(['--root', root]);
    console.log = log;
    const mode = (name) => fs.statSync(path.join(root, name)).mode & 0o777;
    assert.equal(fs.statSync(root).mode & 0o777, 0o777);
    assert.equal(mode('notes.md'), 0o666);
    assert.equal(mode('run.js'), 0o644);
    assert.equal(mode('run.md'), 0o644);
  } finally {
    console.log = log;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Windows: each AskUserQuestion card is timed from its call to its result', () => {
  const entries = [
    { type: 'user', timestamp: at(0), message: { content: 'hello' } },
    { type: 'assistant', timestamp: at(1), message: { content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [{ question: 'Step 4?' }] } }] } },
    { type: 'assistant', timestamp: at(1.1), message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: {} }] } },
    { type: 'user', timestamp: at(1.1), message: { content: [{ type: 'tool_result', tool_use_id: 't2' }] } },
    { type: 'user', timestamp: at(1.75), message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } },
  ];
  assert.deepEqual(askedDurations(entries), [{ askedAt: at(1), question: 'Step 4?', answeredAt: at(1.75), directorMs: 45000 }]);
});

test('only a wheelhouse-check19 folder directly in the temporary folder or /Users/Shared is touched', { skip: process.platform === 'win32' ? 'check 19 runs on a Mac, and these folders are a Mac\'s paths' : false }, () => {
  const tmp = os.tmpdir();
  assert.equal(assertScratch(path.join(tmp, `${PREFIX}-x`)), path.resolve(tmp, `${PREFIX}-x`));
  assert.equal(assertScratch('/Users/Shared/wheelhouse-check19'), '/Users/Shared/wheelhouse-check19');
  assert.throws(() => assertScratch('/Users/Shared'), /Refusing/);
  assert.throws(() => assertScratch(path.join(tmp, 'other')), /Refusing/);
  assert.throws(() => assertScratch(path.join(tmp, `${PREFIX}-x`, 'deeper')), /Refusing/);
  assert.throws(() => assertScratch(path.join(os.homedir(), PREFIX)), /Refusing/);
});

test('times reads a Wheelhouse home\'s journal and records and writes the notes, times.json and cards.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIX}-test-`));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh19-home-'));
  try {
    fs.writeFileSync(path.join(root, 'notes.md'), '# Check 19 notes\n');
    const setup = path.join(home, 'setup');
    for (const d of ['asked', 'answers', 'shown']) fs.mkdirSync(path.join(setup, d), { recursive: true });
    fs.writeFileSync(path.join(setup, 'journal.json'), JSON.stringify({ v: 1, runs: [aRun()] }));
    const card = { question: 'Q', header: null, options: [{ label: 'Go ahead', description: null }] };
    ASKED.forEach((a, i) => fs.writeFileSync(path.join(setup, 'asked', `${i}.json`), JSON.stringify({ ...a, folder: '/x', typed: false, card })));
    ANSWERS.forEach((a, i) => fs.writeFileSync(path.join(setup, 'answers', `${i}.json`), JSON.stringify({ ...a, data: { ...a.data, question: 'words', label: 'Mine' } })));
    fs.writeFileSync(path.join(setup, 'shown', 'run-0123456789-2.json'), JSON.stringify({ runId: 'run-0123456789', folder: '/x', step: 2, hash: 'a'.repeat(64), card, at: at(1.5) }));
    fs.writeFileSync(path.join(setup, 'answers', 'junk.json'), 'not json');
    const said = [];
    const s = times(['--root', root, '--home', home], { now: () => new Date(at(30)), say: (l) => said.push(l) });
    assert.equal(s.totalMinutes, 14);
    assert.match(fs.readFileSync(path.join(root, 'notes.md'), 'utf8'), /## Times \(from the journal/);
    const kept = JSON.parse(fs.readFileSync(path.join(root, 'times.json'), 'utf8'));
    assert.equal(kept.summary.verdict, 'Yes');
    assert.ok(!JSON.stringify(kept).includes('Mine'), 'no answer\'s words');
    const cards = JSON.parse(fs.readFileSync(path.join(root, 'cards.json'), 'utf8'));
    assert.deepEqual(cards.map((c) => [c.step, c.kind]), [[2, 'go-ahead'], [3, 'question'], [4, 'question'], [4, 'question']]);
    assert.throws(() => times(['--root', root, '--home', home, '--folder', '/nowhere']), /No setup run for \/nowhere/);
    assert.throws(() => times(['--root', home, '--home', home]), /Refusing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
