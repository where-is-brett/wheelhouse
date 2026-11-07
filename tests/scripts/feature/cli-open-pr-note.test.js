// tests/scripts/feature/cli-open-pr-note.test.js
// open-pr makes the proof note the pull request's body (design section 7 of the director's way of working), with the data
// before and after for data work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ask, openPr, CliError } from '../../../scripts/feature/cli.js';
import { featurePaths, parseReport } from '../../../scripts/feature/files.js';
import { HEADINGS } from '../../../scripts/proof/note.js';
import { REPORT_WORDS } from '../../../scripts/lib/build-loop.js';
import { tempFolder } from '../../helpers/homes.js';

const real = (dir) => fs.realpathSync.native(dir);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
const words = (t) => t.split(/\s+/).filter(Boolean).length;

const brief = () => ({
  v: 1, work: 'tide-table', lane: 'feature', version: 1, goal: 'Show the next tide for each harbour', done: ['Tides show'],
  appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true,
});

function feature() {
  const tree = real(tempFolder('wh-note-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/tide-table\n');
  write(featurePaths(tree).brief, `${fence(brief())}\nThe brief.\n`);
  return tree;
}

const fields = (extra = {}) => ({
  v: 1, work: 'tide-table', status: 'done', pr: 7, head: 'abc', tests: '14 tests pass', assumptions: [], concerns: [], rulings: [], ...extra,
});
const snap = (rows, status = 'new') => ({ tables: [{ name: 'boats', rows, sample: [{ key: 'w-tide-1', values: { status } }] }] });

// A fake helper: the push and the pull request, and the data check's answer.
function helper(dataAnswer) {
  const calls = { opened: [], data: [] };
  const client = {
    push: async () => ({ ok: true }),
    openPr: async (args) => { calls.opened.push(args); return { ok: true, result: { number: 7 } }; },
    ...(dataAnswer === undefined ? {} : { dataCheck: async (args) => { calls.data.push(args); return typeof dataAnswer === 'function' ? dataAnswer() : dataAnswer; } }),
  };
  return { client, calls };
}
// The session's own reading of the files is given here, never run: no repository history in a test worktree.
const unread = async () => null;
const open = (client, tree, extra = {}) => openPr({ client, worktree: tree, argv: ['--title', 'Show the next tide'], localChange: unread, ...extra });
const withReport = (tree, extra, text = 'The tide table shows the next high tide for each harbour.') => {
  write(featurePaths(tree).report, `${fence(fields(extra))}\n${text}\n`);
};

test('open-pr makes the note the pull request body', async () => {
  const tree = feature();
  write(featurePaths(tree).decisions, `${JSON.stringify({ v: 1, at: '2026-11-08T01:00:00.000Z', decided: 'Round times to the minute', options: ['Minute', 'Second'], why: 'Seconds add noise', kind: 'structure' })}\n`);
  const asked = await ask({ worktree: tree, argv: ['--what', 'Which harbours first?', '--why', 'It decides what users see', '--option', 'A=Use A', '--option', 'B=Use B', '--cost', 'A=An hour', '--undo', 'A=yes', '--cost', 'B=An hour', '--undo', 'B=yes', '--because', 'It is simplest', '--meanwhile', 'I build the rest', '--recommend', 'A', '--level', '3'] });
  withReport(tree, { followed: [{ question: asked.id, answer: 'The two largest' }] });
  const { client, calls } = helper({ ok: true, dataWork: false, changes: [{ status: 'M', path: 'src/pages/tides/index.tsx' }, { status: 'M', path: 'src/lib/x.ts' }], ran: false, why: 'this project names no data command' });
  client.state = { answer: async () => ({ ok: true, answer: 'A', decision: { at: '2026-11-08T01:00:00.000Z', option: 'A', words: '', private: false } }) };
  assert.deepEqual(await open(client, tree), { number: 7, already: false });
  const body = calls.opened[0].body;
  assert.deepEqual([...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]), HEADINGS.slice(0, 6));
  assert.ok(body.includes('The tide table shows the next high tide'));
  assert.ok(body.includes('Show the next tide for each harbour'), 'the goal is the why');
  assert.ok(body.includes('Round times to the minute'), 'the decision log is in it');
  assert.ok(body.includes('Which harbours first?') && body.includes('The two largest'));
  assert.ok(body.includes('14 tests pass'));
  assert.ok(body.includes('`/tides`'), 'the page the change touches is named');
  assert.ok(words(body) <= REPORT_WORDS);
  assert.ok(!body.includes('The data, before and after'), 'no data work, no data section');
  assert.equal(calls.data.length, 1);
  assert.equal(calls.data[0].branch, 'feature/tide-table');
  assert.equal(calls.data[0].cwd, tree);
  // The note is not part of what the report check reads: the report on disk is unchanged.
  assert.equal(parseReport(fs.readFileSync(featurePaths(tree).report, 'utf8')).fields.work, 'tide-table');
});

test('data work shows its before and after, on the data the helper ran it on', async () => {
  const tree = feature();
  withReport(tree, { data: { expect: ['boats'] } });
  const { client, calls } = helper({ ok: true, dataWork: true, changes: [{ status: 'A', path: 'db/migrations/002_status.sql' }], ran: true, route: 'test', before: snap(3), after: snap(4, 'ready') });
  await open(client, tree);
  const body = calls.opened[0].body;
  assert.ok(body.includes('## The data, before and after'));
  assert.ok(body.includes('`boats`: 3 to 4'));
  assert.ok(body.includes('`w-tide-1`, `status`'));
  assert.ok(body.includes('Nothing moved that was not expected'));
  assert.ok(body.trimEnd().endsWith('On test data.'));
  assert.ok(words(body) <= REPORT_WORDS);

  // A move outside what the piece expected is said.
  const other = feature();
  withReport(other, { data: { expect: ['crews'] } });
  const second = helper({ ok: true, dataWork: true, changes: [], ran: true, route: 'real', before: snap(3), after: snap(4) });
  await open(second.client, other);
  assert.ok(second.calls.opened[0].body.includes('Unexpected: boats moved, and the change was not expected to touch it'));
  assert.ok(second.calls.opened[0].body.trimEnd().endsWith('On a read-only sample of real data.'));
});

test('open-pr refuses data work with no data comparison and no reason', async () => {
  const tree = feature();
  withReport(tree, {});
  const { client, calls } = helper({ ok: true, dataWork: true, changes: [{ status: 'A', path: 'db/migrations/002_status.sql' }], ran: false, why: 'this project names no data command' });
  await assert.rejects(open(client, tree), (error) => error instanceof CliError && /"data"/.test(error.message) && /this project names no data command/.test(error.message));
  assert.equal(calls.opened.length, 0, 'the pull request is not opened');
  // With the reason in the report, it opens, and the note says so.
  withReport(tree, { data: { none: 'The table is rebuilt on every start, so there is nothing to compare' } });
  await open(client, tree);
  assert.equal(calls.opened.length, 1);
  assert.ok(calls.opened[0].body.includes('No comparison was made: The table is rebuilt on every start'));
  assert.ok(calls.opened[0].body.trimEnd().endsWith('Nothing was compared.'));
  assert.ok(!calls.opened[0].body.includes('On test data.'));
  // A report that says its change moves data (expect) and has no comparison needs a reason too, though the files don't show it.
  const declared = feature();
  withReport(declared, { data: { expect: ['boats'] } });
  const none = helper({ ok: true, dataWork: false, changes: [], ran: false, why: 'this project names no data command' });
  await assert.rejects(open(none.client, declared), /"data"/);
});

test('a data check the helper could not make does not stop the pull request, and the note says so', async () => {
  const tree = feature();
  withReport(tree, {});
  const refused = helper({ ok: false, refused: 'the branch is not on the host yet' });
  await open(refused.client, tree);
  assert.ok(refused.calls.opened[0].body.includes('The data check could not be made: the branch is not on the host yet'));
  const thrown = feature();
  withReport(thrown, {});
  const broken = helper(() => { throw new Error('the helper is not running'); });
  await open(broken.client, thrown);
  assert.ok(broken.calls.opened[0].body.includes('The data check could not be made'));
  // A helper client with no such request (an older one) is no reason to stop either.
  const old = feature();
  withReport(old, {});
  const plain = helper();
  await open(plain.client, old);
  assert.equal(plain.calls.opened.length, 1);
});

test('data work is found by the session\'s own reading of the files when the helper cannot answer', async () => {
  const migration = async () => ({ dataWork: true, changes: [{ status: 'A', path: 'db/migrations/002_status.sql' }] });
  const tree = feature();
  withReport(tree, {});
  for (const answer of [{ ok: false, refused: 'All stop is on' }, () => { throw new Error('the helper is not running'); }, undefined]) {
    const { client, calls } = helper(answer);
    await assert.rejects(open(client, tree, { localChange: migration }), /"data"/);
    assert.equal(calls.opened.length, 0);
  }
  // With the reason, it opens, and the data section (not one buried line) says the check could not be made.
  withReport(tree, { data: { none: 'The migration only adds a column' } });
  const { client, calls } = helper({ ok: false, refused: 'All stop is on' });
  await open(client, tree, { localChange: migration });
  const body = calls.opened[0].body;
  assert.ok(body.includes('## The data, before and after\n\nThe data check could not be made: All stop is on'));
  assert.ok(body.includes("The session's reason: The migration only adds a column"));
  assert.ok(body.trimEnd().endsWith('Nothing was compared.'));
  // A helper that takes too long is the same.
  const slowTree = feature();
  withReport(slowTree, { data: { none: 'The migration only adds a column' } });
  const slow = helper(() => new Promise(() => {}));
  await open(slow.client, slowTree, { localChange: migration, dataMs: 20 });
  assert.ok(slow.calls.opened[0].body.includes('The data check could not be made: it took too long'));
  // Not data work by the session's reading either: no data section, and the check's absence is one line.
  const plain = feature();
  withReport(plain, {});
  const none = helper({ ok: false, refused: 'All stop is on' });
  await open(none.client, plain, { localChange: async () => ({ dataWork: false, changes: [] }) });
  assert.ok(!none.calls.opened[0].body.includes('The data, before and after'));
  assert.ok(none.calls.opened[0].body.includes('The data check could not be made: All stop is on'));
});

test('a data command that failed is printed as a failure beside the session\'s reason', async () => {
  const tree = feature();
  const failed = { ok: true, dataWork: true, changes: [], ran: false, failed: true, why: 'the data command could not be run: it failed' };
  withReport(tree, { data: { none: 'It only adds a column' } });
  const { client, calls } = helper(failed);
  await open(client, tree);
  const body = calls.opened[0].body;
  assert.ok(body.includes('The data command failed: the data command could not be run: it failed'));
  assert.ok(body.includes("The session's reason: It only adds a column"));
  // The end of its output is shown as code, so the director sees why.
  const tailed = feature();
  withReport(tailed, { data: { none: 'It only adds a column' } });
  const withTail = helper({ ...failed, tail: "migration 002 | error in 'boats'" });
  await open(withTail.client, tailed);
  assert.ok(withTail.calls.opened[0].body.includes("Its last lines: `migration 002 | error in 'boats'`"));
  // Without a reason it is refused, and says it failed.
  const bare = feature();
  withReport(bare, {});
  await assert.rejects(open(helper(failed).client, bare), /the data command failed/);
  // Where the comparison was made, a reason in the report is not used.
  const ranTree = feature();
  withReport(ranTree, { data: { none: 'ignored' } });
  const ran = helper({ ok: true, dataWork: true, changes: [], ran: true, route: 'test', before: snap(3), after: snap(3) });
  await open(ran.client, ranTree);
  assert.ok(!ran.calls.opened[0].body.includes('ignored'));
});

test('the helper is told whether the report declares data, and the files that cannot be read here are said', async () => {
  const tree = feature();
  withReport(tree, { data: { none: 'The migration only adds a column' } });
  const seen = [];
  const bodies = [];
  const client = { push: async () => ({ ok: true }), openPr: async (a) => { bodies.push(a.body); return { ok: true, result: { number: 7 } }; }, dataCheck: async (args) => { seen.push(args); return { ok: false, refused: 'All stop is on' }; } };
  await open(client, tree);
  assert.ok(bodies[0].includes('could not be made: All stop is on, and the changed files could not be read here either'));
  assert.equal(seen.at(-1).declared, true);
  const plain = feature();
  withReport(plain, {});
  await open(client, plain);
  assert.equal(seen.at(-1).declared, false);
});

test('the report reads `followed` and `data`, and refuses them in a wrong shape', () => {
  const read = (extra) => parseReport(`${fence(fields(extra))}\nDone.\n`);
  assert.deepEqual(read({ followed: [{ question: 'Q', answer: 'A', how: 'Built on it' }], data: { expect: ['boats'] } }).fields.data, { expect: ['boats'] });
  for (const bad of [
    { followed: 'x' }, { followed: [{ question: 'Q' }] }, { followed: [{ question: 'Q', answer: 'A', extra: 1 }] },
    { data: 'x' }, { data: { expect: 'boats' } }, { data: { none: '' } }, { data: { expect: ['a'], none: 'why' } }, { data: { other: 1 } },
  ]) assert.throws(() => read(bad), /can't be read/, JSON.stringify(bad));
});
