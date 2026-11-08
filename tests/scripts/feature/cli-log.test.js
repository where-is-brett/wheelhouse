// tests/scripts/feature/cli-log.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ask, log, main, CliError } from '../../../scripts/feature/cli.js';
import { featurePaths, readQuestions } from '../../../scripts/feature/files.js';
import { readLog } from '../../../scripts/decisions/log.js';
import { tempFolder } from '../../helpers/homes.js';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const brief = { v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };

// A feature worktree of harbour-demo made by hand: a .git folder on feature/w-tide-1 and the brief.
function feature() {
  const tree = fs.realpathSync.native(tempFolder('wh-log-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/w-tide-1\n');
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  return tree;
}

const LOG = ['--decided', 'Keep tide rows in one table', '--option', 'one table', '--option', 'a table per harbour', '--why', 'Fewer joins to read them back', '--kind', 'structure'];
const NOW = () => new Date('2026-11-08T04:00:00.000Z');

test('log appends one line with the time', () => {
  const tree = feature();
  log({ worktree: tree, argv: LOG, now: NOW });
  log({ worktree: tree, argv: LOG.map((a) => (a === 'structure' ? 'tests' : a)), now: () => new Date('2026-11-08T04:05:00.000Z') });
  const lines = fs.readFileSync(featurePaths(tree).decisions, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), {
    v: 1, at: '2026-11-08T04:00:00.000Z', decided: 'Keep tide rows in one table', options: ['one table', 'a table per harbour'],
    why: 'Fewer joins to read them back', kind: 'structure',
  });
  assert.deepEqual(readLog(tree).map((c) => [c.at, c.kind]), [['2026-11-08T04:00:00.000Z', 'structure'], ['2026-11-08T04:05:00.000Z', 'tests']]);
});

test('log refuses a director kind and says to ask instead', () => {
  const tree = feature();
  for (const kind of ['algorithm', 'data-model', 'major-dependency', 'colour-scheme']) {
    assert.throws(() => log({ worktree: tree, argv: LOG.map((a) => (a === 'structure' ? kind : a)) }), (e) => e instanceof CliError && /director/.test(e.message) && /ask --about/.test(e.message), kind);
  }
  assert.equal(fs.existsSync(featurePaths(tree).decisions), false, 'nothing was written');
});

test('log refuses a call with a part missing and writes nothing', () => {
  const tree = feature();
  const without = (flag) => {
    const i = LOG.indexOf(flag);
    return LOG.filter((_, k) => k !== i && k !== i + 1);
  };
  const bad = {
    'no --decided': without('--decided'),
    'no --why': without('--why'),
    'no --kind': without('--kind'),
    'one option only': ['--decided', 'x', '--option', 'a', '--why', 'y', '--kind', 'tooling'],
    'two options the same': [...without('--option').slice(0, 0), '--decided', 'x', '--option', 'a', '--option', 'a', '--why', 'y', '--kind', 'tooling'],
    'a flag that is not known': [...LOG, '--level', '2'],
  };
  for (const [name, argv] of Object.entries(bad)) assert.throws(() => log({ worktree: tree, argv }), CliError, name);
  assert.equal(fs.existsSync(featurePaths(tree).decisions), false);
});

test('log: --where helm keeps a director\'s kind, and any other place fails', () => {
  const tree = feature();
  const kind = (k) => LOG.map((a) => (a === 'structure' ? k : a));
  assert.throws(() => log({ worktree: tree, argv: kind('behaviour') }), CliError);
  const line = log({ worktree: tree, argv: [...kind('behaviour'), '--where', 'helm'], now: NOW });
  assert.equal(line.where, 'helm');
  assert.equal(readLog(tree)[0].where, 'helm');
  assert.throws(() => log({ worktree: tree, argv: [...kind('structure'), '--where', 'desk'] }), (e) => e instanceof CliError && /--where is helm or left out/.test(e.message));
  assert.equal(readLog(tree).length, 1);
});

test('the log command prints a line and the main command line runs it', async () => {
  const tree = feature();
  let out = '';
  let err = '';
  const code = await main(['log', ...LOG], { cwd: tree, out: (t) => { out += t; }, err: (t) => { err += t; }, client: {} });
  assert.equal(code, 0, err);
  assert.match(out, /Logged/);
  assert.equal(readLog(tree).length, 1);
  const refused = await main(['log', ...LOG.map((a) => (a === 'structure' ? 'rewrite' : a))], { cwd: tree, out: () => {}, err: (t) => { err = t; }, client: {} });
  assert.equal(refused, 1);
  assert.match(err, /ask --about rewrite/);
});

const ASK = ['--what', 'Which order do the tide times show in?', '--why', 'It decides what visitors see', '--option', 'Soonest=Soonest first', '--option', 'Latest=Latest first', '--cost', 'Soonest=An hour', '--cost', 'Latest=An hour', '--undo', 'Soonest=yes', '--undo', 'Latest=yes', '--recommend', 'Soonest', '--because', 'Visitors plan from the next tide', '--meanwhile', 'I build the parts that do not depend on it'];

test('ask --about algorithm refuses a level below 3', async () => {
  const tree = feature();
  for (const level of ['1', '2']) {
    await assert.rejects(ask({ worktree: tree, argv: [...ASK, '--level', level, '--about', 'algorithm'] }), (e) => e instanceof CliError && /level|director/.test(e.message), `level ${level}`);
  }
  await assert.rejects(ask({ worktree: tree, argv: [...ASK, '--level', '2', '--about', 'something-new'] }), CliError, 'a kind the line does not know is the director\'s');
  assert.deepEqual(readQuestions(featurePaths(tree).questions).questions, []);
  assert.deepEqual(await ask({ worktree: tree, argv: [...ASK, '--level', '3', '--about', 'algorithm'] }), { id: 'q-w-tide-1-1' });
  assert.deepEqual(await ask({ worktree: tree, argv: [...ASK, '--level', '4', '--about', 'security'] }), { id: 'q-w-tide-1-2' });
});

test('ask --about an agent kind may come at any level, and --about alone changes nothing else', async () => {
  const tree = feature();
  assert.deepEqual(await ask({ worktree: tree, argv: [...ASK, '--level', '1', '--about', 'structure'] }), { id: 'q-w-tide-1-1' });
  assert.deepEqual(await ask({ worktree: tree, argv: [...ASK, '--level', '2'] }), { id: 'q-w-tide-1-2' });
  const [first] = readQuestions(featurePaths(tree).questions).questions;
  assert.equal('about' in first, false, 'the question line keeps its own shape');
  await assert.rejects(ask({ worktree: tree, argv: [...ASK, '--level', '3', '--about', ''] }), CliError);
  await assert.rejects(ask({ worktree: tree, argv: [...ASK, '--level', '3', '--about', 'algorithm', '--kind', 'extra-plan', '--plan', 'p.md'] }), CliError);
});
