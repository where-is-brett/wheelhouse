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
  assert.deepEqual(card.options.map((o) => o.label), [CHECK_AND_ADD, LEAVE_THEM_OUT]);
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

test('an unanswered question adds nothing', () => level(async (folder) => {
  await commitIn(folder, 'by-hand.txt');
  const answers = {};
  const { watch, cards, added } = watching(folder, { answers });
  await watch.tick();
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

// Wheelhouse's own section of CLAUDE.md, as an earlier release wrote it and as this one does.
const EARLIER = `## Compact instructions

When this conversation is summarised, keep:
- what the director asked for and decided, in their own words where they gave them;
- the work in hand: the step being done, what is finished and what is not;
- each card shown to the director, and whether it was answered;
- whether All stop is on;
- the pull requests and branches in play, by number and name.

Leave out file contents and command output that can be read again. Wheelhouse's records hold the rulebook, the levels, the waiting list and the status, and the session start after a compaction gives them back.
`;
const MINE = '# The project\n\nMy own notes.\n\n';
const ownText = async (text) => (await import('../../../../scripts/setup/project-files.js')).withOwnSection(text);

// A folder and home that both hold an earlier wording of the section.
async function levelWithEarlier(fn) {
  await level(async (folder) => {
    await commitIn(folder, 'CLAUDE.md', `${MINE}${EARLIER}`);
    await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
    await fn(folder);
  });
}

test('a folder commit that is exactly Wheelhouse\'s own section raises no question and goes by the add route', () => levelWithEarlier(async (folder) => {
  const tip = await commitIn(folder, 'CLAUDE.md', await ownText(`${MINE}${EARLIER}`));
  const { watch, cards, added } = watching(folder);
  await watch.tick();
  await watch.tick();
  assert.deepEqual(cards, []);
  assert.deepEqual(added.map((a) => a.tip), [tip]);
}));

test('a hand edit beside the section still raises the question', () => levelWithEarlier(async (folder) => {
  await commitIn(folder, 'CLAUDE.md', `${await ownText(`${MINE}${EARLIER}`)}\nMy own rule.\n`);
  const { watch, cards, added } = watching(folder);
  await watch.tick();
  assert.equal(cards.length, 1);
  assert.deepEqual(added, []);
}));

test('a hand edit inside the section still raises the question', () => levelWithEarlier(async (folder) => {
  const edited = (await ownText(`${MINE}${EARLIER}`)).replace('whether it was answered', 'whether it was answered or not');
  await commitIn(folder, 'CLAUDE.md', edited.replace('in play, by number and name', 'in play, by number, name and colour'));
  const { watch, cards } = watching(folder);
  await watch.tick();
  assert.equal(cards.length, 1);
}));

test('the section changed in the working tree alone is committed as Wheelhouse\'s own and goes by the add route', () => levelWithEarlier(async (folder) => {
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), await ownText(`${MINE}${EARLIER}`));
  const { watch, cards, added } = watching(folder);
  await watch.tick();
  assert.deepEqual(cards, []);
  assert.equal(added.length, 1);
  assert.equal(await git(folder, ['status', '--porcelain', '--untracked-files=no']), '');
}));

test('a working tree with another change beside the section is left as it is', () => levelWithEarlier(async (folder) => {
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), await ownText(`${MINE}${EARLIER}`));
  fs.writeFileSync(path.join(folder, 'a.txt'), 'changed\n');
  const before = await git(folder, ['rev-parse', 'HEAD']);
  const { watch, added } = watching(folder);
  await watch.tick();
  assert.equal(await git(folder, ['rev-parse', 'HEAD']), before);
  assert.deepEqual(added, []);
}));

test('a tracked file edited by hand and not committed raises the card once the edit has stood, and Check and add sends it', () => level(async (folder) => {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited by hand\n');
  const answers = {};
  const { watch, cards, added } = watching(folder, { answers });
  await watch.tick();
  assert.equal(cards.length, 0);
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].work, HAND_MADE_WORK);
  answers[cards[0].id] = CHECK_AND_ADD;
  await watch.tick();
  await watch.tick();
  assert.equal(added.length, 1);
  assert.equal(added[0].parted, false);
  assert.equal(await git(folder, ['show', `${added[0].tip}:README.md`]), 'edited by hand');
  assert.equal(await git(folder, ['rev-parse', 'HEAD']), await git(folder, ['rev-parse', `${added[0].tip}^`]));
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'edited by hand\n');
  assert.equal(cards.length, 1);
}));

test('Leave them out keeps an uncommitted edit from asking again, and a further edit asks anew', () => level(async (folder) => {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'one\n');
  const answers = {};
  const { watch, cards, added } = watching(folder, { answers });
  await watch.tick();
  await watch.tick();
  answers[cards[0].id] = LEAVE_THEM_OUT;
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 1);
  assert.deepEqual(added, []);
  fs.writeFileSync(path.join(folder, 'README.md'), 'two\n');
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 2);
}));

test('an untracked file alone raises no card', () => level(async (folder) => {
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'mine\n');
  const { watch, cards } = watching(folder);
  await watch.tick();
  await watch.tick();
  await watch.tick();
  assert.deepEqual(cards, []);
}));

test('a further hand edit while an earlier change made by hand is open asks anew, and the card says so', () => level(async (folder) => {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'one\n');
  const answers = {};
  let open = false;
  const cards = [];
  const watch = folderWatch({
    project: P, folder, branchOf: async () => 'main', file: path.join(tempFolder('wh-kept-'), 'folder.json'),
    card: async (data) => { cards.push(data); }, answerOf: (id) => answers[id] ?? null, note: async () => {},
    add: async () => { open = true; return { ok: true }; }, inFlight: async () => open,
  });
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 1);
  assert.equal(cards[0].what, handMadeCard().what);
  answers[cards[0].id] = CHECK_AND_ADD;
  await watch.tick();
  assert.equal(open, true, 'the first edit was added');
  // The folder keeps the first edit, and the director edits again while that change is open.
  fs.writeFileSync(path.join(folder, 'README.md'), 'two\n');
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 2);
  assert.equal(cards[1].what, handMadeCard({ more: true }).what);
  assert.match(cards[1].what, /^More changes were made by hand .* while the earlier ones are still being checked/);
  assert.deepEqual(cards[1].options.map((o) => o.label), [CHECK_AND_ADD, LEAVE_THEM_OUT]);
}));
