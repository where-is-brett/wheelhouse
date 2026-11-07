// tests/scripts/feature/status-waiting.test.js
// `ask` leaves the piece building; only `wait-for` sets the waiting phase (design section 6.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ask, answer, waitFor, main, CliError } from '../../../scripts/feature/cli.js';
import { featurePaths, readQuestions } from '../../../scripts/feature/files.js';
import { buildStatus } from '../../../scripts/feature/status.js';
import { tempFolder } from '../../helpers/homes.js';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const brief = { v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };
const NOW = new Date('2026-11-08T05:00:00.000Z');

function feature() {
  const tree = fs.realpathSync.native(tempFolder('wh-waiting-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/w-tide-1\n');
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  return tree;
}

const option = (label) => ['--option', `${label}=Send it ${label}`, '--cost', `${label}=A day`, '--undo', `${label}=yes`];
const DECISION = ['--what', 'How often should the tide digest go out?', '--why', 'It decides what visitors of harbour-demo get', '--level', '3',
  ...option('Daily'), ...option('Weekly'), '--recommend', 'Weekly', '--because', 'Visitors plan their week', '--holds', 'the digest',
  '--meanwhile', 'I build the sending, which both need'];

const statusOf = (tree, answered = []) => buildStatus({ worktree: tree, now: () => NOW, answered: () => new Set(answered), slice: () => null });
const clientAnswering = (label) => ({ state: { answer: async () => ({ ok: true, answer: label }) } });

test('asking does not set the waiting phase', async () => {
  const tree = feature();
  const { id } = await ask({ worktree: tree, argv: DECISION });
  assert.equal(id, 'q-w-tide-1-1');
  const status = statusOf(tree);
  assert.notEqual(status.phase, 'waiting');
  assert.equal(status.waitingOn, null);
});

test('wait-for sets waiting and frees the slot', async () => {
  const tree = feature();
  await ask({ worktree: tree, argv: DECISION });
  const got = await waitFor({ worktree: tree, client: clientAnswering(null), questionId: 'q-w-tide-1-1', now: () => NOW });
  assert.deepEqual(got, { waiting: true });
  const status = statusOf(tree);
  assert.equal(status.phase, 'waiting');
  // A wait that names the decision, which the foreman reads to give up the slot; a build-command wait names a question.
  assert.equal(status.waitingOn, 'decision');
  // The answer ends the wait.
  assert.equal(statusOf(tree, ['q-w-tide-1-1']).waitingOn, null);
  // The line it wrote is not a question and is not counted as a malformed one.
  const read = readQuestions(featurePaths(tree).questions);
  assert.equal(read.skipped, 0);
  assert.equal(read.questions.length, 1);
  // Saying it twice keeps one line.
  await waitFor({ worktree: tree, client: clientAnswering(null), questionId: 'q-w-tide-1-1', now: () => NOW });
  assert.equal(fs.readFileSync(featurePaths(tree).questions, 'utf8').split('\n').filter((l) => l.includes('waitFor')).length, 1);
});

test('wait-for on a decision that is already answered does not wait', async () => {
  const tree = feature();
  await ask({ worktree: tree, argv: DECISION });
  assert.deepEqual(await waitFor({ worktree: tree, client: clientAnswering('Daily'), questionId: 'q-w-tide-1-1', now: () => NOW }), { waiting: false, answer: 'Daily' });
  assert.equal(statusOf(tree).waitingOn, null);
});

test('wait-for refuses an id this piece never asked, and one that is not a decision', async () => {
  const tree = feature();
  await ask({ worktree: tree, argv: DECISION });
  await assert.rejects(waitFor({ worktree: tree, client: clientAnswering(null), questionId: 'q-w-tide-1-9', now: () => NOW }), CliError);
  await assert.rejects(waitFor({ worktree: tree, client: clientAnswering(null), questionId: '../x', now: () => NOW }), CliError);
  assert.equal(statusOf(tree).waitingOn, null);
});

test('a build-command question is still waited on as soon as it is asked', async () => {
  const tree = feature();
  const config = { ok: true, config: { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] } };
  const client = { config: async () => config };
  await ask({ worktree: tree, argv: ['--kind', 'build-command', '--command', 'git status', '--why', 'To see the changes'], client });
  const status = statusOf(tree);
  assert.equal(status.phase, 'waiting');
  assert.equal(status.waitingOn, 'question');
});

test('wait-for through the command line, and answer --applied', async () => {
  const tree = feature();
  await ask({ worktree: tree, argv: DECISION });
  const out = [];
  const err = [];
  const code = await main(['wait-for', 'q-w-tide-1-1'], { cwd: tree, client: clientAnswering(null), out: (t) => out.push(t), err: (t) => err.push(t), find: () => ({ root: tree }) });
  assert.equal(code, 0, err.join(''));
  assert.match(out.join(''), /free|end your turn/i);
  assert.equal(statusOf(tree).waitingOn, 'decision');

  // `answer <id> --applied` asks the helper to mark the answer applied.
  const seen = [];
  const client = { state: { answer: async (args) => { seen.push(args); return { ok: true, answer: 'Daily' }; } } };
  assert.deepEqual(await answer({ client, worktree: tree, questionId: 'q-w-tide-1-1', applied: true }), { answer: 'Daily' });
  assert.equal(seen[0].applied, true);
  assert.equal(seen[0].noChange, undefined);
  const lines = [];
  const code2 = await main(['answer', 'q-w-tide-1-1', '--applied'], { cwd: tree, client, out: (t) => lines.push(t), err: () => {}, find: () => ({ root: tree }) });
  assert.equal(code2, 0);
  assert.equal(seen[1].applied, true);
  assert.match(lines.join(''), /Daily/);
  // Naming both flags is one too many.
  const code3 = await main(['answer', 'q-w-tide-1-1', '--applied', '--no-change'], { cwd: tree, client, out: () => {}, err: () => {}, find: () => ({ root: tree }) });
  assert.equal(code3, 1);
});
