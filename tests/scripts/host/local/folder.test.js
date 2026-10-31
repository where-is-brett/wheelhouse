// tests/scripts/host/local/folder.test.js
// The folder beside its home (spec 5.4): what the home holds comes down fast-forward only, and what the folder holds raises
// one card for each tip and reaches the home only through a local change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../../helpers/homes.js';
import { commitIn, git, projectFolderWith, withKeyedHome } from '../../../helpers/local-home.js';
import { addFolderRemote, bringFolderUp, compareFolder, folderWatch, handMadeCard, HAND_MADE_WORK, OWN_CHANGES_LINE } from '../../../../scripts/host/local/folder.js';
import { homeDir, makeHome } from '../../../../scripts/host/local/home.js';
import { CHECK_AND_ADD, LEAVE_THEM_OUT } from '../../../../scripts/state/card-lines.js';

const P = 'shop';
const inHome = (args) => git(homeDir(P), args);

// A folder and its home, level with each other.
async function level(fn) {
  await withKeyedHome(async () => {
    const folder = await projectFolderWith();
    await makeHome({ project: P, folder });
    await fn(folder);
  });
}
// Moves the home's main on by one commit made in a copy, as a merge would.
async function homeMovesOn(file = 'merged.txt') {
  const copy = path.join(tempFolder('wh-copy-'), 'copy');
  await git(path.dirname(copy), ['clone', '-q', homeDir(P), copy]);
  const commit = await commitIn(copy, file);
  await git(copy, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return commit;
}
// A watch over the folder, with what it raised and said.
function watching(folder, { answers = {}, add = async () => ({ ok: true }) } = {}) {
  const cards = [];
  const notes = [];
  const added = [];
  const watch = folderWatch({
    project: P, folder, branchOf: async () => 'main', file: path.join(tempFolder('wh-kept-'), 'folder.json'),
    card: async (data) => { cards.push(data); }, answerOf: (id) => answers[id] ?? null, note: async (words) => { notes.push(words); },
    add: async (tip, how) => { added.push({ tip, ...how }); return add(tip, how); },
  });
  return { watch, cards, notes, added };
}

test('the two level with each other read the same', () => level(async (folder) => {
  assert.equal(await compareFolder({ project: P, folder, branch: 'main' }), 'same');
}));

test('home ahead, clean, on the branch: comes up', () => level(async (folder) => {
  const commit = await homeMovesOn();
  assert.equal(await compareFolder({ project: P, folder, branch: 'main' }), 'home-ahead');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { moved: true });
  assert.equal(await git(folder, ['rev-parse', 'HEAD']), commit);
  assert.equal(fs.existsSync(path.join(folder, 'merged.txt')), true);
}));

test('home ahead leaves the tracking ref on the merge, which is what clean-up reads (check 83)', () => level(async (folder) => {
  const commit = await homeMovesOn();
  await bringFolderUp({ project: P, folder, branch: 'main' });
  assert.equal(await git(folder, ['rev-parse', 'refs/remotes/wheelhouse/main']), commit);
}));

test('home ahead, dirty: stays, with one line', () => level(async (folder) => {
  const before = await git(folder, ['rev-parse', 'HEAD']);
  await homeMovesOn();
  fs.writeFileSync(path.join(folder, 'a.txt'), 'unfinished\n');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { line: OWN_CHANGES_LINE });
  assert.equal(await git(folder, ['rev-parse', 'HEAD']), before);
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'unfinished\n');
  const { watch, notes } = watching(folder);
  await watch.tick();
  await watch.tick();
  assert.deepEqual(notes, [OWN_CHANGES_LINE]);
}));

test('a file git doesn\'t track holds nothing up', () => level(async (folder) => {
  await homeMovesOn();
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'mine\n');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { moved: true });
}));

test('a file git ignores in the way stays as it is, and the folder waits with one line', () => level(async (folder) => {
  await commitIn(folder, '.gitignore', '.env\n');
  await git(homeDir(P), ['fetch', '-q', folder, '+refs/heads/main:refs/heads/main']);
  fs.writeFileSync(path.join(folder, '.env'), 'mine\n');
  const copy = path.join(tempFolder('wh-copy-'), 'copy');
  await git(path.dirname(copy), ['clone', '-q', homeDir(P), copy]);
  fs.writeFileSync(path.join(copy, '.env'), 'theirs\n');
  await git(copy, ['add', '-f', '.env']);
  await git(copy, ['commit', '-q', '-m', 'Add .env']);
  await git(copy, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { line: OWN_CHANGES_LINE });
  assert.equal(fs.readFileSync(path.join(folder, '.env'), 'utf8'), 'mine\n');
}));

test('home ahead, on another branch: stays', () => level(async (folder) => {
  await git(folder, ['switch', '-q', '-c', 'mine']);
  const before = await git(folder, ['rev-parse', 'refs/heads/main']);
  await homeMovesOn();
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { line: OWN_CHANGES_LINE });
  assert.equal(await git(folder, ['rev-parse', 'refs/heads/main']), before);
}));

test('folder ahead raises one card a tip', () => level(async (folder) => {
  await commitIn(folder, 'by-hand.txt');
  assert.equal(await compareFolder({ project: P, folder, branch: 'main' }), 'folder-ahead');
  const { watch, cards } = watching(folder);
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 1);
  await commitIn(folder, 'more.txt');
  await watch.tick();
  assert.equal(cards.length, 2);
  assert.notEqual(cards[0].id, cards[1].id);
}));

test('the card says what it is, recommends adding, and can be put off', () => {
  const card = handMadeCard();
  assert.equal(card.work, HAND_MADE_WORK);
  assert.equal(card.level, 3);
  assert.deepEqual(card.options.map((o) => o.label), [CHECK_AND_ADD, LEAVE_THEM_OUT, 'Not now']);
  assert.equal(card.recommendation, CHECK_AND_ADD);
  assert.match(card.what, /made by hand in your project folder/);
  assert.doesNotMatch(JSON.stringify(card), /remote|commit|bare|pull request/i);
});

test('parted raises the same card and the lane brings it up to date', () => level(async (folder) => {
  await homeMovesOn();
  const tip = await commitIn(folder, 'by-hand.txt');
  assert.equal(await compareFolder({ project: P, folder, branch: 'main' }), 'parted');
  const answers = {};
  const { watch, cards, added } = watching(folder, { answers });
  await watch.tick();
  assert.equal(cards.length, 1);
  assert.deepEqual(added, []);
  answers[cards[0].id] = CHECK_AND_ADD;
  await watch.tick();
  await watch.tick();
  assert.deepEqual(added, [{ tip, parted: true }]);
}));

test('an agent\'s commit to the folder\'s main branch gets the same card and merges nothing', () => level(async (folder) => {
  const home = await inHome(['rev-parse', 'refs/heads/main']);
  await commitIn(folder, 'agent.txt');
  const { watch, cards } = watching(folder);
  await watch.tick();
  assert.equal(cards.length, 1);
  assert.equal(await inHome(['rev-parse', 'refs/heads/main']), home);
}));

test('Leave them out leaves the folder and asks no more for that tip', () => level(async (folder) => {
  const tip = await commitIn(folder, 'by-hand.txt');
  const answers = {};
  const { watch, cards, added } = watching(folder, { answers });
  await watch.tick();
  answers[cards[0].id] = LEAVE_THEM_OUT;
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 1);
  assert.deepEqual(added, []);
  assert.equal(await git(folder, ['rev-parse', 'HEAD']), tip);
}));

test('Not now keeps the question open and adds nothing', () => level(async (folder) => {
  await commitIn(folder, 'by-hand.txt');
  const answers = {};
  const { watch, cards, added } = watching(folder, { answers });
  await watch.tick();
  answers[cards[0].id] = 'Not now';
  await watch.tick();
  assert.deepEqual(added, []);
  answers[cards[0].id] = CHECK_AND_ADD;
  await watch.tick();
  assert.equal(added.length, 1);
}));

test('an add that is refused says so once and is tried again', () => level(async (folder) => {
  await commitIn(folder, 'by-hand.txt');
  const answers = {};
  let refused = true;
  const { watch, cards, notes, added } = watching(folder, { answers, add: async () => (refused ? { ok: false, refused: 'All stop is on' } : { ok: true }) });
  await watch.tick();
  answers[cards[0].id] = CHECK_AND_ADD;
  await watch.tick();
  await watch.tick();
  assert.equal(notes.length, 1);
  refused = false;
  await watch.tick();
  await watch.tick();
  assert.equal(added.length, 3);
}));

test('the folder gains one remote, and leaves one of that name that points elsewhere', () => level(async (folder) => {
  await addFolderRemote({ folder, mirror: '/engine/mirrors/shop.git' });
  await addFolderRemote({ folder, mirror: '/engine/mirrors/shop.git' });
  assert.equal(await git(folder, ['config', '--get', 'remote.wheelhouse.url']), '/engine/mirrors/shop.git');
  assert.equal(await git(folder, ['config', '--get-all', 'remote.wheelhouse.fetch']), '+refs/heads/*:refs/remotes/wheelhouse/*');
  await assert.rejects(addFolderRemote({ folder, mirror: '/elsewhere.git' }), /left as it is/);
}));
