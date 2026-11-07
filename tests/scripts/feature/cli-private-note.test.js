// tests/scripts/feature/cli-private-note.test.js
// An answer the director marked private never reaches the pull request: the proof note leaves out any `followed` or `rework`
// entry about a private decision, found by the helper's record of how the question was answered, whatever the report says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ask, openPr } from '../../../scripts/feature/cli.js';
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

function helper(answers) {
  const opened = [];
  return {
    opened,
    client: {
      push: async () => ({ ok: true }),
      openPr: async (args) => { opened.push(args); return { ok: true, result: { number: 7 } }; },
      state: { answer: async ({ questionId }) => ({ ok: true, ...answers[questionId] }) },
      dataCheck: async () => ({ ok: true, dataWork: false, changes: [], ran: false, why: 'this project names no data command' }),
    },
  };
}

test('a private answer listed in followed never reaches the PR body', async () => {
  const { tree, open, secret } = await piece();
  write(featurePaths(tree).report, `${fence(report({
    followed: [
      { question: 'Which harbours first?', answer: 'The two largest' },
      { question: 'Which supplier do we use?', answer: 'Harbourside Ltd' },
      { question: secret, answer: 'Harbourside Ltd again' },
    ],
  }))}\nThe tide table shows the next tide.\n`);
  const { client, opened } = helper({
    [open]: { answer: 'A', decision: { at: '2026-11-08T01:00:00.000Z', option: 'A', words: '', private: false } },
    [secret]: { answer: 'A', decision: { at: '2026-11-08T01:00:00.000Z', option: 'A', words: '', private: true } },
  });
  await openPr({ client, worktree: tree, argv: ['--title', 'Show the next tide'], localChange: async () => null });
  const body = opened[0].body;
  assert.ok(body.includes('Which harbours first?') && body.includes('The two largest'), 'a public decision is still listed');
  assert.ok(!body.includes('Harbourside'), 'the private answer is not in the body');
  assert.ok(!body.includes('Which supplier'), 'nor is its question');
});

test('a private answer that differs from the recommendation is left out of the rework the note carries', async () => {
  const { tree, open, secret } = await piece();
  write(featurePaths(tree).report, `${fence(report({
    rework: { question: secret, chose: 'B', recommended: 'A', cost: 'a day' },
  }))}\nThe tide table shows the next tide.\n`);
  const { client, opened } = helper({
    [open]: { answer: 'A' },
    [secret]: { answer: 'B', decision: { at: '2026-11-08T01:00:00.000Z', option: 'B', words: '', private: true } },
  });
  await openPr({ client, worktree: tree, argv: ['--title', 'Show the next tide'], localChange: async () => null });
  assert.equal(opened.length, 1, 'the report check still holds the rework, so the pull request opens');
  assert.ok(!opened[0].body.includes('a day') && !opened[0].body.includes(secret));
});
