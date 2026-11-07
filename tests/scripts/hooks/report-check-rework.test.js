// tests/scripts/hooks/report-check-rework.test.js
// After the director answers a decision with something other than the recommendation, the report says what the rework cost
// (design section 6.4). The report is the feature's own report.md, checked by `report` and again by `open-pr`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ask, reportChecked, openPr } from '../../../scripts/feature/cli.js';
import { featurePaths, parseReport } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const brief = { v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };
const option = (label) => ['--option', `${label}=Send it ${label}`, '--cost', `${label}=A day`, '--undo', `${label}=yes`];
const DECISION = ['--what', 'How often should the tide digest go out?', '--why', 'It decides what visitors of harbour-demo get', '--level', '3',
  ...option('Daily'), ...option('Weekly'), '--recommend', 'Weekly', '--because', 'Visitors plan their week', '--holds', 'the digest',
  '--meanwhile', 'I build the sending, which both need'];
const ID = 'q-w-tide-1-1';
const REWORK = { question: ID, chose: 'Daily', recommended: 'Weekly', cost: 'Half a day to change the schedule, no new tests' };

function feature(rework) {
  const tree = fs.realpathSync.native(tempFolder('wh-rework-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/w-tide-1\n');
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  report(tree, rework);
  return tree;
}
function report(tree, rework) {
  const fields = { v: 1, work: 'w-tide-1', status: 'done', tests: 'tests/a.test.js', assumptions: [], concerns: [], rulings: [], ...(rework === undefined ? {} : { rework }) };
  write(featurePaths(tree).report, `${fence(fields)}\nThe digest goes out.\n`);
}
const answering = (label) => ({ state: { answer: async () => ({ ok: true, answer: label }) } });

test('a report after a different answer must say what the rework cost', async () => {
  const tree = feature();
  await ask({ worktree: tree, argv: DECISION });
  const missing = (await reportChecked({ worktree: tree, client: answering('Daily') })).missing;
  assert.equal(missing.length, 1);
  assert.match(missing[0], /rework/);
  assert.match(missing[0], /q-w-tide-1-1/);
  assert.match(missing[0], /Daily/);
  assert.match(missing[0], /Weekly/);

  report(tree, REWORK);
  assert.deepEqual((await reportChecked({ worktree: tree, client: answering('Daily') })).missing, []);

  // The wrong answer named, or no cost, is not enough.
  report(tree, { ...REWORK, chose: 'Monthly' });
  assert.equal((await reportChecked({ worktree: tree, client: answering('Daily') })).missing.length, 1);
  report(tree, { ...REWORK, cost: '' });
  assert.equal((await reportChecked({ worktree: tree, client: answering('Daily') })).missing.length, 1);
});

test('an answer that is the recommendation, or none yet, needs no rework in the report', async () => {
  const tree = feature();
  await ask({ worktree: tree, argv: DECISION });
  assert.deepEqual((await reportChecked({ worktree: tree, client: answering('Weekly') })).missing, []);
  assert.deepEqual((await reportChecked({ worktree: tree, client: answering(null) })).missing, []);
  // A helper that cannot say leaves the report check as it was: the gate still holds the merge until the answer is applied.
  assert.deepEqual((await reportChecked({ worktree: tree, client: { state: { answer: async () => ({ ok: false, refused: 'no' }) } } })).missing, []);
  assert.deepEqual((await reportChecked({ worktree: tree })).missing, []);
});

test('the rework field is read from the report, and must be whole when it is there', () => {
  const text = `${fence({ v: 1, work: 'w-tide-1', status: 'done', tests: 't', assumptions: [], concerns: [], rulings: [], rework: REWORK })}\nBody.\n`;
  assert.deepEqual(parseReport(text).fields.rework, REWORK);
  // Several decisions answered otherwise: one entry each.
  const many = `${fence({ v: 1, work: 'w-tide-1', status: 'done', tests: 't', assumptions: [], concerns: [], rulings: [], rework: [REWORK, { ...REWORK, question: 'q-w-tide-1-2' }] })}\nBody.\n`;
  assert.equal(parseReport(many).fields.rework.length, 2);
  for (const bad of [{ ...REWORK, cost: undefined }, { ...REWORK, chose: 3 }, 'costly', []]) {
    const odd = `${fence({ v: 1, work: 'w-tide-1', status: 'done', tests: 't', assumptions: [], concerns: [], rulings: [], rework: bad })}\nBody.\n`;
    assert.throws(() => parseReport(odd), /can't be read/);
  }
});

test('open-pr is not opened until the rework is reported', async () => {
  const tree = feature();
  await ask({ worktree: tree, argv: DECISION });
  const client = { ...answering('Daily'), push: async () => ({ ok: true }), openPr: async () => ({ ok: true, result: { number: 7 } }) };
  await assert.rejects(openPr({ client, worktree: tree, argv: ['--title', 'The digest'] }), /rework/);
  report(tree, REWORK);
  assert.deepEqual(await openPr({ client, worktree: tree, argv: ['--title', 'The digest'] }), { number: 7, already: false });
});
