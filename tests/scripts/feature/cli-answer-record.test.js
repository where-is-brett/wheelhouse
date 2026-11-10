// tests/scripts/feature/cli-answer-record.test.js
// `answer` writes each answered decision as a file under docs/decisions/ in the piece's folder (design section 6.6 of the
// director's way of working) and commits nothing: the session commits it with its work. A private answer writes no file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { answer, ask, main } from '../../../scripts/feature/cli.js';
import { featurePaths } from '../../../scripts/feature/files.js';
import { dayOf } from '../../../scripts/decisions/record-file.js';
import { tempFolder } from '../../helpers/homes.js';

const real = (dir) => fs.realpathSync.native(dir);
const put = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
}).trim();

const brief = { v: 1, work: 'w-tide-1', lane: 'feature', version: 1, goal: 'Show tide times', done: ['Tide times show'], appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true };
const ASK = [
  '--what', 'Should the harbour map show tide times?', '--why', 'It changes what visitors see',
  '--option', 'Show them=Tide times sit under each harbour', '--option', 'Leave them out=The map stays as it is',
  '--cost', 'Show them=A day', '--undo', 'Show them=yes', '--cost', 'Leave them out=Nothing', '--undo', 'Leave them out=yes',
  '--recommend', 'Show them', '--level', '3', '--because', 'visitors ask for them', '--meanwhile', 'I build the parts that do not depend on it',
];

// A real repository on the piece's branch, with the brief and one question asked.
async function piece() {
  const tree = real(tempFolder('wh-answer-record-'));
  git(tree, 'init', '-q', '-b', 'feature/w-tide-1');
  put(path.join(tree, 'README.md'), 'x\n');
  git(tree, 'add', 'README.md');
  git(tree, 'commit', '-q', '-m', 'Base');
  put(featurePaths(tree).brief, `\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\`\n\nThe brief.\n`);
  const { id } = await ask({ worktree: tree, argv: ASK });
  return { tree, id };
}

const ANSWERED = new Date(2026, 10, 7, 16, 0).toISOString();
const helper = (decision, label = 'Show them') => ({ state: { answer: async () => ({ ok: true, answer: label, ...(decision === undefined ? {} : { decision }) }) } });
const said = (extra = {}) => ({ at: ANSWERED, option: 'Show them', words: '', private: false, ...extra });
const FILE = 'docs/decisions/2026-11-07-should-the-harbour-map-show-tide-times.md';

test('answer writes the record in the folder and commits nothing', async () => {
  const { tree, id } = await piece();
  put(path.join(tree, 'other.txt'), 'staged\n');
  git(tree, 'add', 'other.txt');
  const head = git(tree, 'rev-parse', 'HEAD');

  const got = await answer({ client: helper(said()), worktree: tree, questionId: id });
  assert.deepEqual(got, { answer: 'Show them', record: { path: FILE }, recommended: true });
  const text = fs.readFileSync(path.join(tree, FILE), 'utf8');
  assert.match(text, /^<!-- docs\/decisions\/2026-11-07-should-the-harbour-map-show-tide-times\.md -->\n# Should the harbour map show tide times\?\n/);
  assert.match(text, /- \*\*Piece:\*\* w-tide-1\n/);
  assert.match(text, /- \*\*Options:\*\* A\. Tide times sit under each harbour \(A day; Can be undone\) · B\. The map stays as it is \(Nothing; Can be undone\)\n/);
  assert.match(text, /- \*\*Recommended:\*\* Show them\n- \*\*Chosen:\*\* Show them\n- \*\*The director's words:\*\* none\n$/);
  assert.equal(git(tree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/w-tide-1');
  // Nothing committed or staged by Wheelhouse: the file is untracked and the session commits it with its work.
  assert.equal(git(tree, 'rev-parse', 'HEAD'), head);
  assert.equal(git(tree, 'diff', '--cached', '--name-only'), 'other.txt');
  assert.match(git(tree, 'status', '--porcelain', '--', 'docs'), /^\?\? docs\//);

  // Reading it again finds the identical record and does not write it again.
  const before = fs.statSync(path.join(tree, FILE)).mtimeMs;
  const again = await answer({ client: helper(said()), worktree: tree, questionId: id });
  assert.deepEqual(again, { answer: 'Show them', record: { path: FILE }, recommended: true });
  assert.equal(fs.statSync(path.join(tree, FILE)).mtimeMs, before);
  assert.deepEqual(fs.readdirSync(path.join(tree, 'docs', 'decisions')), [path.basename(FILE)]);
  assert.equal(git(tree, 'rev-parse', 'HEAD'), head);
});

test('the director\'s own words are kept as their own words', async () => {
  const { tree, id } = await piece();
  const got = await answer({ client: helper(said({ option: '', words: 'only at spring tides' }), null), worktree: tree, questionId: id });
  assert.equal(got.answer, null);
  assert.equal(got.record.path, FILE);
  const text = fs.readFileSync(path.join(tree, FILE), 'utf8');
  assert.match(text, /- \*\*Chosen:\*\* own words\n/);
  assert.match(text, /- \*\*The director's words:\*\* "only at spring tides"\n/);
});

test('a private reply writes no file and keeps the signed record', async () => {
  const { tree, id } = await piece();
  const got = await answer({ client: helper(said({ private: true })), worktree: tree, questionId: id });
  assert.deepEqual(got, { answer: 'Show them', private: true, recommended: true });
  assert.equal(fs.existsSync(path.join(tree, 'docs', 'decisions')), false);
  assert.equal(git(tree, 'rev-list', '--count', 'HEAD'), '1');
  // The answer is still the director's: it is read as it was.
  assert.equal(dayOf(ANSWERED), '2026-11-07');
});

test('a second record with the same question on the same day is kept as -2', async () => {
  const { tree, id } = await piece();
  await answer({ client: helper(said()), worktree: tree, questionId: id });
  const second = await ask({ worktree: tree, argv: ASK });
  const got = await answer({ client: helper(said({ option: 'Leave them out' }), 'Leave them out'), worktree: tree, questionId: second.id });
  assert.equal(got.record.path, FILE.replace('.md', '-2.md'));
  assert.equal(git(tree, 'rev-list', '--count', 'HEAD'), '1');
});

const run = async (tree, id, client) => {
  let heard = '';
  const code = await main(['answer', id], { cwd: tree, client, find: () => ({ root: tree }), out: (t) => { heard += t; }, err: (t) => { heard += t; } });
  return { code, heard };
};
const NO_CHANGE = (id) => `This is your recommendation, which this piece is built on. Unless this pull request itself still needs a change for it, run \`answer ${id} --no-change\` now: `
  + 'work the answer asks of a later piece belongs to that piece, and this pull request stays held until you say so.\n';

test('a private reply, end to end through the command, prints the answer, writes no file and makes no commit', async () => {
  const { tree, id } = await piece();
  const { code, heard } = await run(tree, id, helper(said({ private: true })));
  assert.equal(code, 0);
  assert.equal(heard, `Show them\nThe director kept this answer private: no file was written in the project.\n${NO_CHANGE(id)}`);
  assert.equal(fs.existsSync(path.join(tree, 'docs')), false);
  assert.equal(git(tree, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(tree, 'status', '--porcelain', '--', 'docs'), '');
});

test('the command says where the record was written and to commit it with the work, on a branch or off one', async () => {
  for (const detach of [false, true]) {
    const { tree, id } = await piece();
    if (detach) git(tree, 'checkout', '-q', '--detach');
    const { code, heard } = await run(tree, id, helper(said()));
    assert.equal(code, 0);
    assert.equal(heard, `Show them\nThe decision record was written at ${FILE}. Commit it with your work on this branch.\n${NO_CHANGE(id)}`);
    assert.equal(fs.existsSync(path.join(tree, FILE)), true);
    assert.equal(git(tree, 'rev-list', '--count', 'HEAD'), '1');
  }
});

test('a record that cannot be written is a warning after the answer', async () => {
  const { tree, id } = await piece();
  // docs is a file, so the folder for the record can't be made.
  put(path.join(tree, 'docs'), 'not a folder\n');
  const { code, heard } = await run(tree, id, helper(said()));
  assert.equal(code, 0);
  assert.match(heard, /^Show them\nNo decision record was kept: the decision record could not be written/);
});

test('a record that cannot be kept is a warning beside the answer, never a failure of it', async () => {
  const { tree, id } = await piece();
  const elsewhere = real(tempFolder('wh-answer-elsewhere-'));
  fs.symlinkSync(elsewhere, path.join(tree, 'docs'));
  const got = await answer({ client: helper(said()), worktree: tree, questionId: id });
  assert.equal(got.answer, 'Show them');
  assert.equal(got.record, undefined);
  assert.match(got.warning, /docs is a link, so no decision record was kept in it/);
  const { code, heard } = await run(tree, id, helper(said()));
  assert.equal(code, 0);
  assert.match(heard, /^Show them\nNo decision record was kept: docs is a link/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('marking an answer applied or needing no change keeps no record', async () => {
  const { tree, id } = await piece();
  const code = await main(['answer', id, '--applied'], { cwd: tree, client: helper(said()), find: () => ({ root: tree }), out: () => {}, err: () => {} });
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(tree, 'docs', 'decisions')), false);
});

test('the recommendation as the answer says to mark it needing no change; another answer, a mark or no answer does not', async () => {
  const { tree, id } = await piece();
  assert.ok((await run(tree, id, helper(said()))).heard.endsWith(NO_CHANGE(id)));
  const other = await run(tree, id, helper(said({ option: 'Leave them out' }), 'Leave them out'));
  assert.ok(!other.heard.includes('--no-change'));
  const none = await run(tree, id, { state: { answer: async () => ({ ok: true, answer: null }) } });
  assert.equal(none.heard, 'There is no answer yet.\n');
  const marked = await answer({ client: helper(), worktree: tree, questionId: id, noChange: true });
  assert.equal(marked.recommended, undefined);
});
