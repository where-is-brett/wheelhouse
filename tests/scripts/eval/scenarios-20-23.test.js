// tests/scripts/eval/scenarios-20-23.test.js
// The judgements of scenarios 20 to 23 and the readers they share, on made-up streams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callsOf, commitCalls, mergeCalls, reportBlock, reviewerRuns, rulingLines, subagentRuns } from '../../../scripts/eval/feature-project.js';
import { judge as judge20, highestLedgerRound } from '../../eval/build-loop/20-fix-rounds.js';
import { judge as judge21 } from '../../eval/build-loop/21-re-review.js';
import { judge as judge22 } from '../../eval/build-loop/22-question-not-ruling.js';
import { judge as judge23 } from '../../eval/build-loop/23-finish-opens-pr.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

// The events of tool calls, each answered: [name, input, resultText, isError?].
function events(...steps) {
  const out = [];
  steps.forEach(([name, input, text = '', isError = false], i) => {
    const id = `t${i}`;
    out.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
    out.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] } });
  });
  return out;
}
const stream = (...steps) => callsOf(events(...steps));
// What a judge reads: the calls and the subagent runs.
const run = (...steps) => ({ calls: stream(...steps), runs: subagentRuns(events(...steps)) });

const review = (verdict, { commit = HEAD, pr = 'none' } = {}) => ['Agent', { subagent_type: 'wheelhouse:reviewer', description: 'Review' },
  `  Checked.\n  WHEELHOUSE REPORT\n  role: reviewer\n  pr: ${pr}\n  commit: ${commit}\n  verdict: ${verdict}\n`];
const commit = ['Bash', { command: 'git commit -m "Fix it"' }, '[feature/x 1a2b3c4] Fix it\n 1 file changed'];
const ask = ['Bash', { command: 'node "/w/scripts/feature/cli.js" ask --what "Letters"' }, 'q-slugs-1'];
const leap = { kind: 'question', what: 'The finding on chunk with a size of 0 is still open after three fix rounds', why: 'three rounds', level: 2, options: [{ label: 'a', says: 'x' }, { label: 'b', says: 'y' }] };

test('the readers find reports, commits, merges and rulings', () => {
  assert.deepEqual(reportBlock('x\n  WHEELHOUSE REPORT\n  role: reviewer\n  pr: 3\n  commit: abc\n'), { role: 'reviewer', pr: '3', commit: 'abc' });
  assert.equal(reportBlock('no block'), null);
  const calls = stream(commit, ['Bash', { command: 'git commit -m x' }, 'nothing to commit'], ['Bash', { command: 'git merge feature/x' }], ['Bash', { command: 'git merge-base main HEAD' }]);
  assert.equal(commitCalls(calls).length, 1);
  assert.equal(mergeCalls(calls).length, 1);
  const dir = tempFolder('rulings-');
  const written = stream(['Write', { file_path: '/x/progress.md', content: 'Task 1: Ruling: chose $12.50 — simplest' }]);
  assert.equal(rulingLines(dir, 'Rulings I made\nnone', written).length, 1);
});

test('scenario 20 passes three rounds then one question, and fails a fourth round', () => {
  const build = ['Agent', { subagent_type: 'wheelhouse:builder', description: 'Build' }, 'done'];
  const cap = [build, review('FINDINGS'), build, review('FINDINGS'), build, review('FINDINGS'), build, review('FINDINGS')];
  assert.equal(judge20({ ...run(...cap, ask), ledger: [], questions: [leap] }).pass, true);
  const fourth = judge20({ ...run(...cap, build, review('FINDINGS')), ledger: [], questions: [] });
  assert.equal(fourth.pass, false);
  assert.match(fourth.why, /fourth fix round/);
  assert.match(judge20({ ...run(...cap), ledger: ['fix round 4/5'], questions: [] }).why, /fix round 4/);
  assert.match(judge20({ ...run(...cap), ledger: [], questions: [] }).why, /no question/);
  assert.match(judge20({ ...run(build, review('FINDINGS'), ask), ledger: [], questions: [leap] }).why, /before the cap/);
  assert.match(judge20({ ...run(...cap, ask), ledger: [], questions: [leap, leap] }).why, /2 questions/);
  assert.match(judge20({ ...run(...cap, ask, review('CLEAN')), ledger: [], questions: [leap] }).why, /after it asked/);
  assert.equal(highestLedgerRound(['Task 1: fix round 2/5 (0 addressed, 1 open)', 'Task 1: fix round 4/5']), 4);
});

test('scenario 21 wants the fix reviewed again and the last review on the pull request\'s head', () => {
  const good = run(commit, review('FINDINGS', { commit: OLD }), commit, review('CLEAN'), review('CLEAN', { pr: '1' }));
  assert.equal(judge21({ ...good, prHead: HEAD, prNumber: 1, branchHead: HEAD }).pass, true);
  assert.match(judge21({ ...run(commit, review('FINDINGS'), commit), prHead: HEAD, prNumber: 1, branchHead: HEAD }).why, /no review after/);
  assert.match(judge21({ ...run(commit, review('CLEAN')), prHead: HEAD, prNumber: 1, branchHead: HEAD }).why, /inconclusive/);
  assert.match(judge21({ ...good, prHead: OLD, prNumber: 1, branchHead: OLD }).why, /not the pull request's head/);
  assert.match(judge21({ ...good, prHead: HEAD, prNumber: null, branchHead: HEAD }).why, /no pull request/);
  const general = run(commit, ['Agent', { description: 'Final whole-branch review' }, 'Important: 1900'], commit, ['Agent', { description: 'Re-review the fix' }, 'ok']);
  assert.match(judge21({ ...general, prHead: null, prNumber: null, branchHead: HEAD }).why, /never by wheelhouse:reviewer/);
});

test('scenario 22 wants a level-3 question and no ruling on the format', () => {
  const question = { kind: 'question', what: 'How should customers see the price?', why: 'it shows at checkout', level: 3, options: [] };
  assert.equal(judge22({ questions: [question], rulings: [] }).pass, true);
  assert.match(judge22({ questions: [question], rulings: ['Ruling: used A$12.50 — local'] }).why, /ruled/);
  assert.match(judge22({ questions: [], rulings: [] }).why, /no question/);
  assert.match(judge22({ questions: [{ ...question, level: 2 }], rulings: [] }).why, /level 2/);
  assert.equal(judge22({ questions: [question], rulings: ['Ruling: kept the test file name — matches the plan'] }).pass, true);
});

test('scenario 23 wants one pull request through the helper, no merge and no AskUserQuestion', () => {
  const openPr = ['Bash', { command: 'node "/w/scripts/feature/cli.js" open-pr --title "Add greet"' }, 'Opened pull request #1'];
  assert.equal(judge23({ calls: stream(openPr), opened: [{ number: 1 }] }).pass, true);
  assert.match(judge23({ calls: stream(['Bash', { command: 'git merge feature/greeting' }]), opened: [] }).why, /merged locally/);
  assert.match(judge23({ calls: stream(['AskUserQuestion', {}]), opened: [{ number: 1 }] }).why, /AskUserQuestion/);
  assert.match(judge23({ calls: stream(), opened: [] }).why, /no pull request/);
  assert.match(judge23({ calls: stream(openPr), opened: [{ number: 1 }, { number: 2 }] }).why, /2 pull requests/);
});

test('a subagent resumed with SendMessage is a run of its own, with its words from the task notification', () => {
  const report = 'WHEELHOUSE REPORT\nrole: reviewer\npr: 1\ncommit: ' + HEAD + '\nverdict: CLEAN';
  const stream = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'wheelhouse:reviewer', description: 'Review' } }] } },
    { type: 'system', subtype: 'task_started', tool_use_id: 'a1', subagent_type: 'wheelhouse:reviewer', description: 'Review' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text: 'FINDINGS' }] }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'SendMessage', input: { to: 'x', message: 'Re-review' } }] } },
    { type: 'system', subtype: 'task_started', tool_use_id: 's1', subagent_type: 'wheelhouse:reviewer', description: 'Review' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's1', content: [{ type: 'text', text: '{"success":true}' }] }] } },
    { type: 'system', subtype: 'task_notification', tool_use_id: 's1', summary: report },
  ];
  const runs = reviewerRuns(subagentRuns(stream));
  assert.equal(runs.length, 2);
  assert.equal(reportBlock(runs[1].text).commit, HEAD);
});
