// tests/scripts/feature/cli-review.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main, review, CliError } from '../../../scripts/feature/cli.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const brief = { v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };

// A feature worktree of harbour-demo made by hand: a .git folder on feature/w-tide-1 and the brief.
function feature() {
  const tree = fs.realpathSync.native(tempFolder('wh-review-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/w-tide-1\n');
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  return tree;
}

// A Lookout's reply: the prose, a finding line for each severity given, and the report block.
const reply = (...severities) => [
  'I read the diff and the brief.', 'Checked and sound: the tide table is read in one pass.',
  ...severities.map((s, i) => `- ${s}: src/tides.js:${10 + i} gives the wrong hour at midnight; suggested fix: wrap the hour.`),
  '', 'WHEELHOUSE REPORT', `verdict: ${severities.length === 0 ? 'CLEAN' : 'FINDINGS'}`,
].join('\n');
const file = (tree, name, text) => {
  const where = path.join(featurePaths(tree).dir, 'review', name);
  write(where, text);
  return path.relative(tree, where);
};
const NOW = () => new Date('2026-11-09T10:00:00.000Z');
const ruled = (tree, task, name) => review({ worktree: tree, argv: ['--task', task, '--file', name], now: NOW });
const counter = (tree) => fs.readFileSync(path.join(featurePaths(tree).dir, 'reviews.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('review counts by the severity lines and says clean for a reply with none and verdict CLEAN', () => {
  const tree = feature();
  const got = ruled(tree, '1', file(tree, '1.md', reply()));
  assert.deepEqual([got.step, got.round, got.total, got.blocking, got.repeat], ['clean', 1, 0, 0, false]);
  assert.equal(got.line, "Clean: the Lookout found nothing. This task's review is done; go on.");
});

test('review counts by the severity lines: BLOCKER and HIGH block, MEDIUM and LOW are minors, whatever the report block says', () => {
  const tree = feature();
  const prose = reply('HIGH', 'MEDIUM', 'LOW').replace('verdict: FINDINGS', 'verdict: FINDINGS\nfindings: 3\nblocking: 0');
  const got = ruled(tree, '1', file(tree, '1.md', prose));
  assert.deepEqual([got.step, got.total, got.blocking], ['fix', 3, 1], 'the HIGH line blocks even where the pasted block says blocking: 0');
  const minors = ruled(tree, '2', file(tree, '2.md', reply('MEDIUM', 'LOW')));
  assert.deepEqual([minors.step, minors.total, minors.blocking], ['minors', 2, 0]);
  assert.match(minors.line, /^Only minors left \(2\): defer each in the ledger as deferred, do not fix them, and stop this task's review loop\. Go on\.$/);
});

test('review numbers a task\'s rounds, and stops at the round limit', () => {
  const tree = feature();
  const steps = [1, 2, 3, 4].map((n) => ruled(tree, 'task-3', file(tree, `${n}.md`, `${reply('BLOCKER', 'MEDIUM', ...(n === 3 ? ['LOW'] : []))}\nround ${n}`)));
  assert.deepEqual(steps.map((s) => [s.round, s.step]), [[1, 'fix'], [2, 'fix'], [3, 'fix'], [4, 'limit']]);
  assert.equal(steps[2].line, '1 blocking finding to fix: fix round 3 of 3. Fix them, defer the reply\'s MEDIUM and LOW findings as minors, then have a Lookout review again.');
  assert.equal(steps[3].line, 'Round limit reached: 1 blocking finding is still open after 3 fix rounds. Put them to the director as one question with ask; do not fix them yourself.');
  // Another task starts again at round 1.
  assert.equal(ruled(tree, 'task-4', file(tree, '5.md', reply('HIGH'))).round, 1);
  assert.deepEqual(counter(tree).map((l) => [l.task, l.round]), [['task-3', 1], ['task-3', 2], ['task-3', 3], ['task-3', 4], ['task-4', 1]]);
});

test('review leaves a repeat of the same reply uncounted and prints the same line', () => {
  const tree = feature();
  const name = file(tree, '1.md', reply('HIGH'));
  const first = ruled(tree, 'task-1', name);
  const again = ruled(tree, 'task-1', name);
  assert.equal(again.repeat, true);
  assert.deepEqual([again.round, again.step, again.line], [first.round, first.step, first.line]);
  assert.equal(counter(tree).length, 1, 'nothing more was written');
  // A different reply for the same task is the next round.
  assert.equal(ruled(tree, 'task-1', file(tree, '2.md', reply('HIGH', 'LOW'))).round, 2);
});

test('review refuses a reply it can\'t read: no findings and no verdict CLEAN', () => {
  const tree = feature();
  assert.throws(() => ruled(tree, '1', file(tree, '1.md', 'I started reading the diff and')), (e) => e instanceof CliError && /doesn't read as a Lookout's reply/.test(e.message));
  assert.throws(() => ruled(tree, '1', file(tree, '2.md', 'WHEELHOUSE REPORT\nverdict: FINDINGS')), CliError, 'FINDINGS with no finding line');
  assert.equal(fs.existsSync(path.join(featurePaths(tree).dir, 'reviews.jsonl')), false, 'nothing counted');
});

test('review refuses a bad task, a missing flag, a file outside the worktree and a missing file', () => {
  const tree = feature();
  const name = file(tree, '1.md', reply());
  assert.throws(() => review({ worktree: tree, argv: ['--file', name] }), /--task is needed/);
  assert.throws(() => review({ worktree: tree, argv: ['--task', 'bad task!', '--file', name] }), /--task is a short name/);
  assert.throws(() => review({ worktree: tree, argv: ['--task', '1'] }), /--file is needed/);
  assert.throws(() => review({ worktree: tree, argv: ['--task', '1', '--file', '../outside.md'] }), /inside this worktree/);
  assert.throws(() => review({ worktree: tree, argv: ['--task', '1', '--file', '.wheelhouse/feature/review/none.md'] }), /can't be read/);
});

test('review refuses a feature folder that isn\'t real', () => {
  const tree = feature();
  const name = file(tree, '1.md', reply());
  const real = featurePaths(tree).dir;
  const elsewhere = fs.realpathSync.native(tempFolder('wh-review-away-'));
  fs.cpSync(real, path.join(elsewhere, 'feature'), { recursive: true });
  fs.rmSync(real, { recursive: true });
  fs.symlinkSync(path.join(elsewhere, 'feature'), real);
  assert.throws(() => ruled(tree, '1', name), /feature's folder isn't a real folder/);
});

test('the review command prints the line and exits 0 at each step', async () => {
  const tree = feature();
  const out = [];
  const err = [];
  const run = (argv) => main(argv, { cwd: tree, out: (t) => out.push(t), err: (t) => err.push(t), client: {} });
  assert.equal(await run(['review', '--task', 'a', '--file', file(tree, '1.md', reply('HIGH'))]), 0);
  assert.equal(out.at(-1), '1 blocking finding to fix: fix round 1 of 3. Fix them, defer the reply\'s MEDIUM and LOW findings as minors, then have a Lookout review again.\n');
  assert.equal(await run(['review', '--task', 'a', '--file', file(tree, '2.md', reply('LOW'))]), 0);
  assert.match(out.at(-1), /^Only minors left \(1\)/);
  assert.equal(await run(['review', '--task', 'a']), 1);
  assert.match(err.at(-1), /--file is needed/);
});
