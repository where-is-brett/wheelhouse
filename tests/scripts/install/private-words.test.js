// tests/scripts/install/private-words.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../../scripts/lib/run.js';
import { PRIVATE_SCAN_COMMITS } from '../../../scripts/lib/install-numbers.js';
import { checkPrivate, maskWords, privateWords, scanRepo } from '../../../scripts/install/private-words.js';
import { g, makeBareRemote } from '../../helpers/git-fixture.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'install', 'private-words.js');

function writeList(home, text) {
  const file = path.join(home, 'install', 'private-words.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// A scratch repository with a remote: one pushed commit naming the word, then a tracked file
// naming it in another case, an untracked one, a binary one, and an unpushed commit naming it.
async function makeRepo() {
  const remote = await makeBareRemote();
  const root = path.join(tempFolder('wh-private-'), 'repo');
  fs.mkdirSync(root);
  await g(root, 'init', '--quiet', '-b', 'main');
  fs.writeFileSync(path.join(root, 'notes.md'), 'nothing here\n');
  await g(root, 'add', '--all');
  await g(root, 'commit', '--quiet', '-m', 'Start the Lanternshop notes');
  await g(root, 'remote', 'add', 'origin', remote.url);
  await g(root, 'push', '--quiet', '-u', 'origin', 'main');
  await g(root, 'remote', 'set-head', 'origin', 'main');
  fs.writeFileSync(path.join(root, 'notes.md'), 'nothing here\nsecond line about LANTERNSHOP stock\n');
  fs.writeFileSync(path.join(root, 'shelf.bin'), Buffer.from([0, 1, 2, ...Buffer.from('lanternshop')]));
  await g(root, 'add', '--all');
  await g(root, 'commit', '--quiet', '-m', 'Tidy\n\nMore about the lanternShop shelves');
  fs.writeFileSync(path.join(root, 'untracked.md'), 'lanternshop\n');
  return root;
}

test('privateWords reads the list, skipping blank and # lines', () => withHome((home) => {
  assert.deepEqual(privateWords(), []);
  writeList(home, '# names only\n\nLanternShop\r\n  quill-and-ink  \n');
  assert.deepEqual(privateWords(), ['LanternShop', 'quill-and-ink']);
}));

test('a listed word in a tracked file or an unpushed commit message fails, whatever its case', async () => {
  const root = await makeRepo();
  const head = await g(root, 'rev-parse', 'HEAD');
  const hits = await scanRepo({ root, words: ['quill-and-ink', 'LanternShop'] });
  const added = hits.filter((h) => h.where === 'diff');
  assert.deepEqual(hits.filter((h) => h.where !== 'diff'), [
    { where: 'file', at: 'notes.md', line: 2, wordNo: 2 },
    { where: 'commit', at: head, line: 3, wordNo: 2 },
  ]);
  // The unpushed commit's added line names it too; the pushed commit's never counts.
  assert.equal(added.length, 1);
  assert.equal(added[0].at, head);
  assert.equal(added[0].wordNo, 2);
  assert.ok(added[0].line > 0);
  await withHome(async (home) => {
    writeList(home, '# names\nquill-and-ink\nlanternshop\n');
    const result = await checkPrivate({ root });
    assert.equal(result.code, 1);
  });
});

test('with no remote, the last commits are read', async () => {
  const root = path.join(tempFolder('wh-private-'), 'repo');
  fs.mkdirSync(root);
  await g(root, 'init', '--quiet', '-b', 'main');
  await g(root, 'commit', '--quiet', '--allow-empty', '-m', 'About LanternShop');
  for (let n = 0; n < PRIVATE_SCAN_COMMITS; n += 1) await g(root, 'commit', '--quiet', '--allow-empty', '-m', `step ${n}`);
  assert.deepEqual(await scanRepo({ root, words: ['lanternshop'], commits: PRIVATE_SCAN_COMMITS + 1 }).then((h) => h.length), 1);
  assert.deepEqual(await scanRepo({ root, words: ['lanternshop'] }), []);
});

test('a hit is reported by place, never by the word', async () => {
  const root = await makeRepo();
  fs.writeFileSync(path.join(root, 'lanternshop-plan.md'), 'plain\n');
  await g(root, 'add', '--all');
  await g(root, 'commit', '--quiet', '-m', 'plan');
  await withHome(async (home) => {
    writeList(home, '# names\n\nLanternShop\n');
    const result = await checkPrivate({ root });
    assert.equal(result.code, 1);
    const text = result.lines.join('\n');
    assert.doesNotMatch(text, /lanternshop/i);
    assert.match(text, /notes\.md, line 2: word 3 of the private list/);
    assert.match(text, /commit [0-9a-f]{40}, line 3: word 3 of the private list/);
    assert.match(text, /a file's name: word 3 of the private list/);
    assert.match(text, /commit [0-9a-f]{40}, line \d+ of its changes: word 3 of the private list/);
  });
});

test('with no list on the computer the check passes and says so', async () => {
  await withHome(async (home) => {
    const result = await run(process.execPath, [SCRIPT], { env: { WHEELHOUSE_HOME: home } });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), 'No private list on this computer.');
  });
});

test('with a list and no hits the check passes and says what it read', async () => {
  const root = await makeRepo();
  await withHome(async (home) => {
    writeList(home, 'quill-and-ink\n');
    const result = await checkPrivate({ root });
    assert.equal(result.code, 0);
    assert.match(result.lines.join('\n'), /No private words found/);
  });
});

test('a word added in one unpushed commit and taken out in a later one still fails', async () => {
  const root = await makeRepo();
  fs.writeFileSync(path.join(root, 'notes.md'), 'nothing here\na draft naming QuillAndInk\n');
  await g(root, 'commit', '--quiet', '-am', 'draft');
  const drafted = await g(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'notes.md'), 'nothing here\n');
  await g(root, 'commit', '--quiet', '-am', 'tidy again');
  const hits = await scanRepo({ root, words: ['quillandink'] });
  assert.deepEqual(hits.map((h) => [h.where, h.at, h.wordNo]), [['diff', drafted, 1]]);
});

test('the index is read, not the working tree, and a link\'s target is read too', async () => {
  const root = await makeRepo();
  // Staged with the word, then taken out of the working tree only: still found.
  fs.writeFileSync(path.join(root, 'staged.md'), 'about quillandink\n');
  await g(root, 'add', 'staged.md');
  fs.writeFileSync(path.join(root, 'staged.md'), 'clean\n');
  // In the working tree only, never staged: not found.
  fs.writeFileSync(path.join(root, 'notes.md'), 'nothing here\nsecond line about LANTERNSHOP stock\nquillandink\n');
  // A link whose committed target names the word.
  const object = (await run('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: '../quillandink/shelf' })).stdout.trim();
  await g(root, 'update-index', '--add', '--cacheinfo', `120000,${object},shelf-link`);
  const hits = (await scanRepo({ root, words: ['quillandink'] })).filter((h) => h.where === 'file');
  assert.deepEqual(hits.map((h) => [h.at, h.line]).sort(), [['shelf-link', 1], ['staged.md', 1]]);
});

test('a masked path leaves no part of any listed word', () => {
  assert.equal(maskWords('foobar.md', ['bar', 'foobar']), '***.md');
  assert.equal(maskWords('docs/Bar-and-FOOBAR/x.md', ['bar', 'foobar']), 'docs/***-and-***/x.md');
  assert.equal(maskWords('plain.md', ['bar']), 'plain.md');
});
