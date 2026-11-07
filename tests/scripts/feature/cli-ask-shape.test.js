// tests/scripts/feature/cli-ask-shape.test.js
// `ask` sends a decision that fails its shape back to the session, with exit code 2 and one problem a line; the director's
// list of waiting decisions is untouched; three failures in a row say to send one plain "stuck" message (design section 6.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ask, main, stuck, CliError, SentBack } from '../../../scripts/feature/cli.js';
import { featurePaths, readQuestions, questionTrail } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const brief = { v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };

function feature() {
  const tree = fs.realpathSync.native(tempFolder('wh-shape-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/w-tide-1\n');
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  return tree;
}

const NOTE_AT = '2026-11-08T05:00:00.000Z';
const base = ['--what', 'How often should the tide digest go out?', '--why', 'It decides what visitors of harbour-demo get', '--level', '3'];
const options = (...labels) => labels.flatMap((l) => ['--option', `${l}=Send it ${l}`]);
const costs = (...labels) => labels.flatMap((l) => ['--cost', `${l}=A day`]);
const undos = (...labels) => labels.flatMap((l) => ['--undo', `${l}=yes`]);
const GOOD = [...base, ...options('Daily', 'Weekly'), ...costs('Daily', 'Weekly'), ...undos('Daily', 'Weekly'), '--recommend', 'Weekly',
  '--because', 'Visitors plan their week', '--holds', 'the digest', '--meanwhile', 'I build the sending, which both need'];
const without = (argv, flag, value) => {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && (value === undefined || argv[i + 1].startsWith(value))) { i += 1; continue; }
    out.push(argv[i]);
  }
  return out;
};

const sentBack = async (tree, argv) => {
  try {
    await ask({ worktree: tree, argv });
  } catch (e) {
    assert.ok(e instanceof SentBack, e.message);
    return e;
  }
  return assert.fail('the ask was not sent back');
};

test('a decision with every part is asked, and keeps its cost, undo, reason, holds and meanwhile', async () => {
  const tree = feature();
  assert.deepEqual(await ask({ worktree: tree, argv: GOOD }), { id: 'q-w-tide-1-1' });
  const [q] = readQuestions(featurePaths(tree).questions).questions;
  assert.deepEqual(q.options[1], { label: 'Weekly', says: 'Send it Weekly', cost: 'A day', undo: 'Can be undone' });
  assert.equal(q.because, 'Visitors plan their week');
  assert.equal(q.holds, 'the digest');
  assert.equal(q.meanwhile, 'I build the sending, which both need');
});

test('an option with no cost is sent back, naming the option', async () => {
  const tree = feature();
  const e = await sentBack(tree, without(GOOD, '--cost', 'Weekly='));
  assert.deepEqual(e.problems.map((p) => /Option "Weekly" doesn't say what it costs/.test(p)), [true]);
});

test('an option with no undo answer is sent back', async () => {
  const tree = feature();
  const e = await sentBack(tree, without(GOOD, '--undo', 'Daily='));
  assert.match(e.problems.join('\n'), /Option "Daily" doesn't say whether it can be undone/);
  const odd = await sentBack(tree, [...without(GOOD, '--undo', 'Daily='), '--undo', 'Daily=maybe']);
  assert.match(odd.problems.join('\n'), /--undo "Daily" must be yes, no or partly/);
});

test('--undo yes, no and partly are kept as plain words', async () => {
  const tree = feature();
  const argv = [...without(GOOD, '--undo'), '--undo', 'Daily=no', '--undo', 'Weekly=partly'];
  await ask({ worktree: tree, argv });
  const [q] = readQuestions(featurePaths(tree).questions).questions;
  assert.deepEqual(q.options.map((o) => o.undo), ['Cannot be undone', 'Can be partly undone']);
});

test('one option, or five, is sent back', async () => {
  const tree = feature();
  const one = await sentBack(tree, [...base, ...options('Daily'), ...costs('Daily'), ...undos('Daily'), '--recommend', 'Daily', '--because', 'b', '--meanwhile', 'm']);
  assert.match(one.problems.join('\n'), /two to four options; there is 1/);
  const labels = ['A', 'B', 'C', 'D', 'E'];
  const five = await sentBack(tree, [...base, ...options(...labels), ...costs(...labels), ...undos(...labels), '--recommend', 'A', '--because', 'b', '--meanwhile', 'm']);
  assert.match(five.problems.join('\n'), /two to four options; there are 5/);
});

test('no recommendation, or a recommendation with no reason, is sent back', async () => {
  const tree = feature();
  assert.match((await sentBack(tree, without(GOOD, '--recommend'))).problems.join('\n'), /which option you recommend/);
  assert.match((await sentBack(tree, without(GOOD, '--because'))).problems.join('\n'), /why you recommend it/);
  assert.match((await sentBack(tree, without(GOOD, '--meanwhile'))).problems.join('\n'), /what you go on with while it waits/);
});

test('a message over 1400 characters or 18 lines is sent back with its length', async () => {
  const tree = feature();
  const long = [...without(GOOD, '--why'), '--why', 'w'.repeat(1500)];
  const e = await sentBack(tree, long);
  assert.match(e.problems.join('\n'), /The decision is \d+ characters and \d+ lines; a phone screen takes 1400 characters and 18 lines/);
});

test('the director never sees a failing decision: no question is written, and the main command exits 2 with one problem a line', async () => {
  const tree = feature();
  let out = '';
  let err = '';
  const argv = ['ask', ...without(without(GOOD, '--cost', 'Weekly='), '--recommend')];
  const code = await main(argv, { cwd: tree, out: (t) => { out += t; }, err: (t) => { err += t; }, client: {} });
  assert.equal(code, 2);
  assert.equal(out, '');
  const lines = err.trim().split('\n');
  assert.equal(lines.length, 2, err);
  assert.match(lines[0], /Option "Weekly" doesn't say what it costs/);
  assert.match(lines[1], /which option you recommend/);
  assert.deepEqual(readQuestions(featurePaths(tree).questions).questions, [], 'the pending list is unchanged');
});

test('the third failure in a row tells the agent to send a stuck message', async () => {
  const tree = feature();
  const bad = without(GOOD, '--meanwhile');
  const first = await sentBack(tree, bad);
  const second = await sentBack(tree, bad);
  assert.doesNotMatch(first.problems.join('\n') + second.problems.join('\n'), /stuck/);
  const third = await sentBack(tree, bad);
  assert.equal(third.failures, 3);
  assert.match(third.problems.at(-1), /3 tries in a row.*stuck --why/);
  assert.equal(questionTrail(featurePaths(tree).questions).failures, 3);
});

test('a passing ask resets the count', async () => {
  const tree = feature();
  const bad = without(GOOD, '--meanwhile');
  await sentBack(tree, bad);
  await sentBack(tree, bad);
  await ask({ worktree: tree, argv: GOOD });
  assert.equal(questionTrail(featurePaths(tree).questions).failures, 0);
  const again = await sentBack(tree, bad);
  assert.equal(again.failures, 1);
  assert.doesNotMatch(again.problems.join('\n'), /stuck/);
});

test('stuck writes one plain message and starts the count again', async () => {
  const tree = feature();
  const bad = without(GOOD, '--meanwhile');
  for (let i = 0; i < 3; i += 1) await sentBack(tree, bad);
  const noted = stuck({ worktree: tree, argv: ['--why', 'The meanwhile line keeps failing'], now: () => new Date('2026-11-08T05:00:00.000Z') });
  assert.deepEqual(noted, { stuck: true, at: '2026-11-08T05:00:00.000Z', why: 'The meanwhile line keeps failing' });
  const trail = questionTrail(featurePaths(tree).questions);
  assert.equal(trail.failures, 0);
  assert.deepEqual(trail.stuck, [{ at: '2026-11-08T05:00:00.000Z', why: 'The meanwhile line keeps failing' }]);
  assert.equal(readQuestions(featurePaths(tree).questions).skipped, 0, 'the notes are not malformed lines');
  assert.throws(() => stuck({ worktree: tree, argv: [] }), CliError);
  let out = '';
  const code = await main(['stuck', '--why', 'Still failing'], { cwd: tree, out: (t) => { out += t; }, err: () => {}, client: {} });
  assert.equal(code, 0);
  assert.match(out, /Noted/);
});

test('only failed decisions count in a row: a passing extra-plan line does not reset the count', async () => {
  const tree = feature();
  const bad = without(GOOD, '--meanwhile');
  await sentBack(tree, bad);
  await ask({ worktree: tree, argv: ['--kind', 'extra-plan', '--plan', 'p.md', ...base, ...options('queue', 'drop'), '--recommend', 'queue'] });
  await sentBack(tree, bad);
  assert.equal(questionTrail(featurePaths(tree).questions).failures, 2);
});

test('the ask is added to the file by appending, so a line written meanwhile is kept', async () => {
  const tree = feature();
  const file = featurePaths(tree).questions;
  fs.writeFileSync(file, `${JSON.stringify({ stuck: true, at: NOTE_AT, why: 'earlier' })}\n`);
  await ask({ worktree: tree, argv: GOOD });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).stuck, true);
});

test('--cost and the other shape flags belong to a plain question only', async () => {
  const tree = feature();
  const extra = ['--kind', 'extra-plan', '--plan', 'p.md', ...base, ...options('queue', 'drop'), '--recommend', 'queue'];
  await assert.rejects(ask({ worktree: tree, argv: [...extra, '--cost', 'queue=A day'] }), (e) => e instanceof CliError && !(e instanceof SentBack));
  assert.deepEqual(await ask({ worktree: tree, argv: extra }), { id: 'q-w-tide-1-1' });
});
