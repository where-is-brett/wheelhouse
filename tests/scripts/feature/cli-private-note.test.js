// tests/scripts/feature/cli-private-note.test.js
// An answer the director marked private never reaches the pull request. `followed` names each decision by its question id; the
// helper is asked how each was answered (this piece's or another's) and an entry about a private answer is left out whole,
// whatever its `answer` says. An answer that can't be read stops the pull request before anything is pushed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ask, openPr, reportChecked, CliError } from '../../../scripts/feature/cli.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

const real = (dir) => fs.realpathSync.native(dir);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const brief = { v: 1, work: 'tide-table', lane: 'feature', version: 1, goal: 'Show the next tide', done: ['Tides show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };
const shape = (...labels) => [...labels.flatMap((l) => ['--cost', `${l}=An hour`, '--undo', `${l}=yes`]), '--because', 'It is simplest', '--meanwhile', 'I build the rest'];
const askWith = (what) => ['--what', what, '--why', 'It decides what users see', '--option', 'A=Use A', '--option', 'B=Use B', ...shape('A', 'B'), '--recommend', 'A', '--level', '3'];
const THEIRS = 'q-other-piece-3';

async function piece() {
  const tree = real(tempFolder('wh-private-note-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/tide-table\n');
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  const open = await ask({ worktree: tree, argv: askWith('Which harbours first?') });
  const secret = await ask({ worktree: tree, argv: askWith('Which supplier do we use?') });
  return { tree, open: open.id, secret: secret.id };
}

const report = (extra) => ({
  v: 1, work: 'tide-table', status: 'done', pr: 7, head: 'abc', tests: '14 tests pass', assumptions: [], concerns: [], rulings: [], ...extra,
});
const withReport = (tree, extra) => write(featurePaths(tree).report, `${fence(report(extra))}\nThe tide table shows the next tide.\n`);
const publicAnswer = { answer: 'A', decision: { at: '2026-11-08T01:00:00.000Z', option: 'A', words: '', private: false } };
const privateAnswer = { answer: 'A', decision: { at: '2026-11-08T01:00:00.000Z', option: 'A', words: '', private: true } };

// A helper: `answers` by question id, or a function that throws or refuses.
function helper(answers, { withState = true } = {}) {
  const calls = { opened: [], pushed: 0, asked: [] };
  const client = {
    push: async () => { calls.pushed += 1; return { ok: true }; },
    openPr: async (args) => { calls.opened.push(args); return { ok: true, result: { number: 7 } }; },
    dataCheck: async () => ({ ok: true, dataWork: false, changes: [], ran: false, why: 'this project names no data command' }),
    ...(withState ? {
      state: {
        answer: async ({ questionId }) => {
          calls.asked.push(questionId);
          if (typeof answers === 'function') return answers(questionId);
          return { ok: true, ...answers[questionId] };
        },
      },
    } : {}),
  };
  return { calls, client };
}
const open = (client, tree) => openPr({ client, worktree: tree, argv: ['--title', 'Show the next tide'], localChange: async () => null });

test('a private answer listed in followed never reaches the PR body, whatever its words say', async () => {
  const { tree, open: openId, secret } = await piece();
  withReport(tree, {
    followed: [
      { question: openId, answer: 'The two largest' },
      { question: secret, answer: 'Harbourside Ltd', how: 'Built on Harbourside' },
      { question: THEIRS, answer: 'Harbourside again' },
    ],
  });
  const { client, calls } = helper({ [openId]: publicAnswer, [secret]: privateAnswer, [THEIRS]: privateAnswer });
  await open(client, tree);
  const body = calls.opened[0].body;
  assert.ok(body.includes('Which harbours first?') && body.includes('The two largest'), 'a public decision is listed, by its words');
  assert.ok(!body.includes('Harbourside'), 'the private answer is not in the body');
  assert.ok(!body.includes('Which supplier') && !body.includes(secret) && !body.includes(THEIRS), 'nor is its question or id');
  assert.deepEqual([...new Set(calls.asked)].sort(), [openId, secret, THEIRS].sort());
});

test('a decision of another piece is listed under its id, and its answer is read from the helper too', async () => {
  const { tree } = await piece();
  withReport(tree, { followed: [{ question: THEIRS, answer: 'Weekly' }] });
  const { client, calls } = helper({ [THEIRS]: publicAnswer });
  await open(client, tree);
  assert.ok(calls.opened[0].body.includes(THEIRS) && calls.opened[0].body.includes('Weekly'));
});

test('a question named by its words, not its id, is refused with the form to use', async () => {
  const { tree } = await piece();
  withReport(tree, { followed: [{ question: 'Which harbours first?', answer: 'The two largest' }] });
  const { client, calls } = helper({});
  await assert.rejects(open(client, tree), (error) => error instanceof CliError
    && /names each decision by its question id/.test(error.message) && /q-<work>-<number>/.test(error.message) && /"q-tide-table-1"/.test(error.message));
  assert.equal(calls.pushed, 0);
  assert.deepEqual(calls.opened, []);
  const { missing } = await reportChecked({ worktree: tree, client });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /not by its words: Which harbours first\?/);
});

test('an answer that cannot be read stops the pull request before anything is pushed', async () => {
  for (const answers of [
    () => { throw new Error('the helper is down'); },
    () => ({ ok: false, refused: 'All stop is on' }),
    () => null,
  ]) {
    const { tree, open: openId } = await piece();
    withReport(tree, { followed: [{ question: openId, answer: 'The two largest' }] });
    const { client, calls } = helper(answers);
    await assert.rejects(open(client, tree), (error) => error instanceof CliError && /could not be read/.test(error.message) && error.message.includes(openId));
    assert.equal(calls.pushed, 0);
    assert.deepEqual(calls.opened, []);
  }
  // A helper that can't answer at all is the same.
  const { tree, open: openId } = await piece();
  withReport(tree, { followed: [{ question: openId, answer: 'The two largest' }] });
  const { client, calls } = helper({}, { withState: false });
  await assert.rejects(open(client, tree), /could not be read/);
  assert.equal(calls.pushed, 0);
});

test('an id from another piece that the helper cannot answer stops the pull request, though this piece\'s own are read', async () => {
  const { tree, open: openId } = await piece();
  withReport(tree, { followed: [{ question: openId, answer: 'A' }, { question: THEIRS, answer: 'B' }] });
  const { client, calls } = helper((id) => (id === THEIRS ? { ok: false, refused: 'That question is not in this project' } : { ok: true, ...publicAnswer }));
  await assert.rejects(open(client, tree), (error) => /could not be read/.test(error.message) && error.message.includes(THEIRS) && /not in this project/.test(error.message));
  assert.equal(calls.pushed, 0);
});

test('a report with nothing followed needs no answer from the helper', async () => {
  const { tree } = await piece();
  withReport(tree, {});
  const { client, calls } = helper({}, { withState: false });
  await open(client, tree);
  assert.equal(calls.opened.length, 1);
  assert.deepEqual(calls.asked, []);
});
