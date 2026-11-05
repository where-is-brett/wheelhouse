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
import { gitRoute, homeDir, makeHome } from '../../../../scripts/host/local/home.js';
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
  assert.deepEqual(added, [{ tip, parted: true, question: cards[0].id }]);
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

// A project's settings as an earlier release pinned them, and the same with a later release's pin written over them by an
// update that did not land its change.
const settingsWith = (ref, extra = {}) => `${JSON.stringify({ permissions: { allow: [] }, extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref }, ...extra } } }, null, 2)}\n`;

// The update in progress, as its journal records it: the target tag, and whether it has ended.
function updateUnderWay(tag, { ended = false } = {}) {
  const dir = path.join(process.env.WHEELHOUSE_HOME, 'update', P);
  fs.mkdirSync(dir, { recursive: true });
  const steps = { checks: { state: 'done', data: { tag } }, ...(ended ? { done: { state: 'done' } } : {}) };
  fs.writeFileSync(path.join(dir, 'journal.json'), JSON.stringify({ schema: 1, steps }));
}

async function withPinnedSettings(fn) {
  await levelWithEarlier(async (folder) => {
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    await commitIn(folder, '.claude/settings.json', settingsWith('v0.2.8', { autoUpdate: false }));
    await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
    await fn(folder);
  });
}

test('pins left in the working tree by an update raise no hand-made card', () => withPinnedSettings(async (folder) => {
  updateUnderWay('v0.2.9');
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), settingsWith('v0.2.9'));
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), await ownText(`${MINE}${EARLIER}`));
  const { watch, cards, added } = watching(folder);
  for (let i = 0; i < 4; i += 1) await watch.tick();
  assert.deepEqual(cards, []);
  assert.deepEqual(added, []);
}));

test('pins alone in the settings, with nothing else changed, raise no card either', () => withPinnedSettings(async (folder) => {
  updateUnderWay('v0.2.9');
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), settingsWith('v0.2.9'));
  const { watch, cards } = watching(folder);
  for (let i = 0; i < 4; i += 1) await watch.tick();
  assert.deepEqual(cards, []);
}));

for (const [what, ref, extra, journal] of [
  ['a downgrade to another tag', 'v0.2.7', {}, () => updateUnderWay('v0.2.9')],
  ['a branch name', 'main', {}, () => updateUnderWay('v0.2.9')],
  ['autoUpdate switched on', 'v0.2.9', { autoUpdate: true }, () => updateUnderWay('v0.2.9')],
  ['the target tag with no update under way', 'v0.2.9', {}, () => {}],
  ['the target tag after the update ended', 'v0.2.9', {}, () => updateUnderWay('v0.2.9', { ended: true })],
]) {
  test(`a pin edit that is ${what} raises the card, uncommitted or committed`, () => withPinnedSettings(async (folder) => {
    journal();
    fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), settingsWith(ref, extra));
    const uncommitted = watching(folder);
    for (let i = 0; i < 4; i += 1) await uncommitted.watch.tick();
    assert.equal(uncommitted.cards.length, 1, 'uncommitted');
    assert.deepEqual(uncommitted.added, []);
    await git(folder, ['checkout', '-q', '.']);
    await commitIn(folder, '.claude/settings.json', settingsWith(ref, extra));
    const committed = watching(folder);
    await committed.watch.tick();
    assert.equal(committed.cards.length, 1, 'committed');
    assert.deepEqual(committed.added, []);
  }));
}

test('a settings edit that is more than the pins still raises the card', () => withPinnedSettings(async (folder) => {
  const edited = JSON.parse(settingsWith('v0.2.9'));
  edited.permissions.allow.push('Bash(rm:*)');
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), `${JSON.stringify(edited, null, 2)}\n`);
  const { watch, cards } = watching(folder);
  for (let i = 0; i < 4; i += 1) await watch.tick();
  assert.equal(cards.length, 1);
}));

test('a pin that names another repository still raises the card', () => withPinnedSettings(async (folder) => {
  const edited = JSON.parse(settingsWith('v0.2.9'));
  edited.extraKnownMarketplaces.wheelhouse.source.repo = 'someone/else';
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), `${JSON.stringify(edited, null, 2)}\n`);
  const { watch, cards } = watching(folder);
  for (let i = 0; i < 4; i += 1) await watch.tick();
  assert.equal(cards.length, 1);
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

// The home's main moves on by a commit that writes `text` to `file`, as the merge of an accepted hand edit does.
async function homeWrites(file, text) {
  const copy = path.join(tempFolder('wh-copy-'), 'copy');
  await git(path.dirname(copy), ['clone', '-q', homeDir(P), copy]);
  const commit = await commitIn(copy, file, text);
  await git(copy, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  return commit;
}

test('a folder whose uncommitted edit is exactly what the merged main holds takes the main, losing nothing', () => level(async (folder) => {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited\n');
  const commit = await homeWrites('README.md', 'edited\n');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { moved: true });
  assert.equal(await git(folder, ['rev-parse', 'HEAD']), commit);
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'edited\n');
  assert.equal(await git(folder, ['status', '--porcelain']), '');
}));

test('a folder edit that differs from the merged main still waits, untouched', () => level(async (folder) => {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited again\n');
  await homeWrites('README.md', 'edited\n');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { line: OWN_CHANGES_LINE });
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'edited again\n');
}));

test('an identical edit beside another uncommitted edit waits, and both stay', () => level(async (folder) => {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited\n');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'mine\n');
  await homeWrites('README.md', 'edited\n');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { line: OWN_CHANGES_LINE });
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'edited\n');
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'mine\n');
}));

test('a further hand edit after the earlier change stopped being checked does not say it is still being checked', () => level(async (folder) => {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'one\n');
  const answers = {};
  const cards = [];
  const watch = folderWatch({
    project: P, folder, branchOf: async () => 'main', file: path.join(tempFolder('wh-kept-'), 'folder.json'),
    card: async (data) => { cards.push(data); }, answerOf: (id) => answers[id] ?? null, note: async () => {},
    add: async () => ({ ok: true }), inFlight: async () => false,
  });
  await watch.tick();
  await watch.tick();
  answers[cards[0].id] = CHECK_AND_ADD;
  await watch.tick();
  fs.writeFileSync(path.join(folder, 'README.md'), 'two\n');
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 2);
  assert.doesNotMatch(cards[1].what, /still being checked/);
  assert.match(cards[1].what, /^More changes were made by hand/);
  assert.match(cards[1].what, /no longer being checked/);
}));

// A folder holding README.md as committed, and the home's main moved on to write `text` there.
async function readmeCase(folder, text) {
  await commitIn(folder, 'README.md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  return homeWrites('README.md', text);
}

test('a mode-only change with the same content waits and keeps its mode', () => level(async (folder) => {
  await readmeCase(folder, 'first\nmore\n');
  fs.writeFileSync(path.join(folder, 'README.md'), 'first\nmore\n');
  fs.chmodSync(path.join(folder, 'README.md'), 0o755);
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { line: OWN_CHANGES_LINE });
  assert.equal(fs.statSync(path.join(folder, 'README.md')).mode & 0o111, 0o111);
}));

test('staged content that is neither the folder\'s commit nor the main waits', () => level(async (folder) => {
  await readmeCase(folder, 'edited\n');
  fs.writeFileSync(path.join(folder, 'README.md'), 'staged\n');
  await git(folder, ['add', 'README.md']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited\n');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { line: OWN_CHANGES_LINE });
  assert.match(await git(folder, ['diff', '--cached']), /staged/);
}));

test('a save made after the edits were staged and before the merge survives, whether git takes the move or refuses it', () => level(async (folder) => {
  await readmeCase(folder, 'edited\n');
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited\n');
  const real = gitRoute();
  const racing = (cwd, opts) => {
    const r = real(cwd, opts);
    return { ...r, ok: async (args, ...rest) => { if (args[0] === 'merge') fs.writeFileSync(path.join(folder, 'README.md'), 'late save\n'); return r.ok(args, ...rest); } };
  };
  const got = await bringFolderUp({ project: P, folder, branch: 'main', git: racing });
  assert.ok(got.moved === true || typeof got.line === 'string');
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'late save\n');
  assert.equal(await git(folder, ['stash', 'list']), '');
}));

test('a file name with glob characters stages only that file, never one the name would match', () => level(async (folder) => {
  await commitIn(folder, '[x].md', 'first\n');
  await git(folder, ['push', '-q', homeDir(P), 'HEAD:refs/heads/main', '--force']);
  await homeWrites('[x].md', 'edited\n');
  fs.writeFileSync(path.join(folder, '[x].md'), 'edited\n');
  fs.writeFileSync(path.join(folder, 'x.md'), 'mine\n');
  await bringFolderUp({ project: P, folder, branch: 'main' });
  assert.equal(await git(folder, ['ls-files', '--', 'x.md']), '');
  assert.equal(await git(folder, ['status', '--porcelain', '--', 'x.md']), '?? x.md');
  assert.equal(fs.readFileSync(path.join(folder, 'x.md'), 'utf8'), 'mine\n');
}));

test('a successful move leaves no stash entry behind', () => level(async (folder) => {
  await readmeCase(folder, 'edited\n');
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited\n');
  assert.deepEqual(await bringFolderUp({ project: P, folder, branch: 'main' }), { moved: true });
  assert.equal(await git(folder, ['stash', 'list']), '');
}));

test('when the fast-forward fails after the edits were let go, the folder is put back and says why', () => level(async (folder) => {
  await readmeCase(folder, 'edited\n');
  fs.writeFileSync(path.join(folder, 'README.md'), 'edited\n');
  // An untracked file in the way of a file the home adds makes the merge refuse.
  const copy = path.join(tempFolder('wh-copy-'), 'copy');
  await git(path.dirname(copy), ['clone', '-q', homeDir(P), copy]);
  await commitIn(copy, 'blocker.txt', 'home\n');
  await git(copy, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  fs.writeFileSync(path.join(folder, 'blocker.txt'), 'mine\n');
  const got = await bringFolderUp({ project: P, folder, branch: 'main' });
  assert.equal(got.moved, undefined);
  assert.match(got.line, /put back|left as it was/);
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'edited\n');
  assert.equal(fs.readFileSync(path.join(folder, 'blocker.txt'), 'utf8'), 'mine\n');
}));

test('a tip whose recorded question can no longer be made a card is recorded again under its own id', () => level(async (folder) => {
  await commitIn(folder, 'by-hand.txt');
  const stuckIds = new Set();
  const cards = [];
  const watch = folderWatch({
    project: P, folder, branchOf: async () => 'main', file: path.join(tempFolder('wh-kept-'), 'folder.json'),
    card: async (data) => { cards.push(data); stuckIds.delete(data.id); }, answerOf: () => null, note: async () => {}, stuck: (id) => stuckIds.has(id),
    add: async () => ({ ok: true }),
  });
  await watch.tick();
  assert.equal(cards.length, 1);
  stuckIds.add(cards[0].id);
  await watch.tick();
  await watch.tick();
  assert.equal(cards.length, 2);
  assert.equal(cards[1].id, cards[0].id);
  assert.match(cards[1].id, /^q-by-hand-\d+$/);
  assert.deepEqual(cards[1].options.map((o) => o.label), [CHECK_AND_ADD, LEAVE_THEM_OUT]);
}));
