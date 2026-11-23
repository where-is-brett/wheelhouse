// tests/scripts/feature/cli-help-report.test.js
// The feature command names what is wrong: a report field of the wrong kind says which and what kind it must be, a flag it
// does not take lists the flags it does, and `help` and `<command> --help` say what each command takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../../../scripts/feature/cli.js';
import { featurePaths, reportProblems } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const brief = { v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'Show tide times', done: ['Times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };
const WHOLE = { v: 1, work: 'w-tide-1', status: 'done', tests: 'npm test: 12 passed', assumptions: [], concerns: [], rulings: [] };

function feature() {
  const tree = fs.realpathSync.native(tempFolder('wh-help-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/w-tide-1\n');
  write(featurePaths(tree).brief, `${fence(brief)}\nThe brief.\n`);
  return tree;
}
const run = async (tree, argv) => {
  let out = '';
  let err = '';
  const code = await main(argv, { cwd: tree, client: {}, out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
};

test('a report field of the wrong kind is named with the kind it must be', async () => {
  const tree = feature();
  for (const [bad, expected] of [
    [{ status: 'complete' }, /"status" must be one of "done", "blocked", "partial", not "complete"/],
    [{ pr: null }, /"pr" must be a whole number of 1 or more.*not null/],
    [{ pr: 'none' }, /"pr" must be a whole number/],
    [{ tests: ['npm test'] }, /"tests" must be one text.*not a list/],
    [{ concerns: 'none' }, /"concerns" must be a list of texts/],
    [{ extra: 1 }, /"extra" is not a field a report has/],
  ]) {
    write(featurePaths(tree).report, `${fence({ ...WHOLE, ...bad })}\nShipped.\n`);
    const { code, err } = await run(tree, ['report']);
    assert.equal(code, 1);
    assert.match(err, expected);
    assert.match(err, /"status": "done" \| "blocked" \| "partial"/, 'the refusal ends with the whole shape');
  }
  write(featurePaths(tree).report, `${fence(WHOLE)}\nShipped.\n`);
  assert.equal((await run(tree, ['report'])).code, 0);
  assert.deepEqual(reportProblems(WHOLE), []);
});

test('a flag the command does not take lists the flags it does', async () => {
  const tree = feature();
  const { code, err } = await run(tree, ['log', '--kind', 'structure', '--severity', 'low']);
  assert.equal(code, 1);
  assert.match(err, /--severity is not a flag this command takes\. It takes: --decided, --option, --why, --kind, --where/);
  assert.match(err, /--kind <structure\|bug-fix\|tests/);
});

test('help and --help say what each command takes, and a bare report still checks', async () => {
  const tree = feature();
  const all = await run(tree, ['help']);
  assert.equal(all.code, 0);
  for (const name of ['ask', 'log', 'report', 'open-pr', 'review']) assert.match(all.out, new RegExp(`\\n  ${name}`), name);
  const one = await run(tree, ['log', '--help']);
  assert.equal(one.code, 0);
  assert.match(one.out, /--decided .* --kind <structure\|bug-fix\|tests\|performance\|minor-dependency\|library-in-stack\|tooling>/);
  assert.match((await run(tree, ['help', 'report'])).out, /"tests": "<one text>"/);
  const bare = await run(tree, ['report']);
  assert.equal(bare.code, 1);
  assert.match(bare.err, /report\.md is not there/);
});

test('a deferred minor is refused as a kind with the place it goes', async () => {
  const tree = feature();
  const { code, err } = await run(tree, ['log', '--decided', 'x', '--option', 'a', '--option', 'b', '--why', 'y', '--kind', 'deferred']);
  assert.equal(code, 1);
  assert.match(err, /isn't logged/);
  assert.match(err, /concerns in report\.md/);
});
