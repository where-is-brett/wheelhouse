// tests/e2e/director-paths-by-hand.test.js
// The director's hand edits, end to end, on a project in git alone with a terminal and no pane (see
// tests/e2e/director-paths.test.js and tests/helpers/director-world.js): the by-hand card, the director's signed press,
// the helper's tie, the front desk carrying the change on, the foreman's wake, the build, the merge and the folder.
// Each test names the trial fault it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../helpers/director-world.js';
import { world, record, approveCards, foremanWakes, merged, startsAndMergesShownFirst, assertNoPanelWords } from '../helpers/director-steps.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';
import { running } from '../eval/build-loop/engine-recordings.js';
import { CHECK_AND_ADD, LEAVE_THEM_OUT } from '../../scripts/state/card-lines.js';

waitLongerOnTheHelper();

// The director's own name for a hand commit, so it commits on a machine with no git identity set.
const HAND = ['-c', 'user.name=Hand', '-c', 'user.email=hand@example.invalid'];
const HAND_LINE = 'Written by hand in the folder.';
const HAND_PATTERN = /Written by hand in the folder\./;
const handCards = (w) => w.records('question').filter((q) => q.data.work === 'by-hand');
const readme = (w) => fs.readFileSync(path.join(w.folder, 'README.md'), 'utf8');
const carryOn = () => ({ 'carry-on-1': running('carry-on-1') });

// The by-hand card is raised within a few ticks and the front desk is woken for it, in a terminal, where no pane holds it.
async function handCardRaised(w, { expected = 1 } = {}) {
  await w.tickUntil(() => handCards(w).length >= expected, 'the by-hand card');
  // Past the courier's gap since its last wake, which holds a second wake back for a while.
  w.at(60 * 60 * 1000);
  const woke = await w.terminalTick();
  assert.ok((woke.woken ?? []).includes(`card:q:${handCards(w).at(-1).data.id}`), `a wake reaches the front desk (${JSON.stringify(woke.woken)})`);
  assert.match(woke.submit?.[0] ?? '', /waiting on you/);
  const asked = await w.desk(['cards']);
  assert.equal(asked.json.questions.length, 1, 'the card is asked in the chat');
  return asked.json.questions[0];
}
// After the press: the work is carried on as the front desk does, from the request the helper opened for the press.
async function carriedOn(w) {
  const tie = w.eventsOf('by-hand').at(-1).data;
  const got = await w.desk(['carry-on', String(tie.n)]);
  assert.equal(got.code, 0, got.err);
  return JSON.parse(got.out);
}
// The carried-on work builds and merges: the line stays in the main version, and the folder, which holds the same edit,
// takes the main version and keeps the edit's content.
// A hand edit that was committed stays on the folder's own branch, which the squashed merge does not move: only an
// uncommitted edit is let go for the folder to take the main version.
async function buildsAndMerges(w, work, { content = { text: readme(w) }, committed = false } = {}) {
  // The work is the director's own edit, so it is shown first like any visible work; the change the helper opened for the
  // press is request 1, so the run's is 2.
  const change = await startsAndMergesShownFirst(w, work, content, { pr: 2 });
  assert.match(await git(['show', `${change.mergeCommit}:README.md`], w.gitHome), HAND_PATTERN, 'the edit is in the main version');
  assert.match(readme(w), HAND_PATTERN, 'the edit is kept');
  if (committed) return change;
  await w.tickUntil(async () => (await w.folderMain()) === change.mergeCommit, 'the folder to take the main version');
  assert.equal(await git(['status', '--porcelain', '--untracked-files=no'], w.folder), '', 'nothing is left uncommitted in the folder');
  return change;
}

// Guards, in the order press, tie, work. Faults of the trial rounds: the by-hand card never reached the chat in a terminal (a
// terminal tick marked it asked); work recorded visible after "Check and add them" never woke the foreman; it raised a second
// Approve card; the project folder never took the merged main because the same edit sat uncommitted in it; a later edit's
// card said the earlier ones were still being checked.
test('a hand edit, then Check and add them: press, tie, work; one wake, no second Approve card, merged, the folder takes main', { timeout: 120000 }, () => world({ recordings: carryOn() }, async (w) => {
  await w.watch();
  await w.terminalTick();
  fs.appendFileSync(path.join(w.folder, 'README.md'), `${HAND_LINE}\n`);
  const card = await handCardRaised(w);
  await w.press(card, CHECK_AND_ADD);
  await w.tickUntil(() => w.eventsOf('by-hand').length > 0, 'the tie');
  const from = await carriedOn(w);
  assert.equal(w.eventsOf('work').length, 0);
  await w.watch(); // the press and the tie are seen, and their wake is past
  await record(w, from.work, { lane: 'small', visible: true, title: 'Your edit to the README', from: from.from });
  const woken = foremanWakes(await w.watch());
  assert.ok(woken.some((e) => e.type === 'work-ready' && e.work === from.work), `the foreman is woken for the work (${JSON.stringify(woken)})`);
  assert.equal(approveCards(w).length, 0, 'no second Approve card');
  assert.deepEqual((await w.desk(['cards'])).json.questions, []);
  await buildsAndMerges(w, from.work);

  // A second edit's card does not say the earlier ones are still being checked.
  fs.appendFileSync(path.join(w.folder, 'README.md'), 'A second edit.\n');
  const second = await handCardRaised(w, { expected: 2 });
  assert.doesNotMatch(second.question, /still being checked|still checking/i);
}));

// Guards: the same path in the order work, then press and tie: the work was recorded before the helper tied the press to its
// change. Fault: the work, approved afterwards by the press, did not wake the foreman.
test('a hand edit, then Check and add them: work, then press and tie; the foreman is woken and no second Approve card comes', { timeout: 120000 }, () => world({ recordings: carryOn() }, async (w) => {
  await w.watch();
  await w.terminalTick();
  fs.appendFileSync(path.join(w.folder, 'README.md'), `${HAND_LINE}\n`);
  await git([...HAND, 'commit', '-q', '-am', 'A hand commit'], w.folder);
  const tip = await git(['rev-parse', 'HEAD'], w.folder);
  const card = await handCardRaised(w);
  // The front desk has the work recorded for the change the helper will open (the first), before the press is tied.
  await record(w, 'carry-on-1', { lane: 'small', visible: true, title: 'Your edit to the README', from: { sha: tip, ref: 'refs/wheelhouse/from/carry-on-1', request: 1 } });
  assert.equal(approveCards(w).length, 0, 'no Approve card for work that waits on the press');
  await w.tick();
  assert.equal(w.starts().length, 0, 'it does not start before the press');
  await w.watch();
  await w.press(card, CHECK_AND_ADD);
  await w.tickUntil(() => w.eventsOf('by-hand').length > 0, 'the tie');
  const woken = foremanWakes(await w.watch());
  assert.ok(woken.some((e) => e.type === 'work-ready' && e.work === 'carry-on-1'), `the foreman is woken for the work (${JSON.stringify(woken)})`);
  assert.equal(approveCards(w).length, 0, 'no second Approve card');
  await buildsAndMerges(w, 'carry-on-1', { committed: true });
}));

// Guards: "Leave them out" is the director's answer for good: the card was asked again at every tick after it.
test('a hand edit, then Leave them out: the choice is kept and the card is not asked again', { timeout: 120000 }, () => world({}, async (w) => {
  await w.terminalTick();
  fs.appendFileSync(path.join(w.folder, 'README.md'), `${HAND_LINE}\n`);
  const card = await handCardRaised(w);
  await w.press(card, LEAVE_THEM_OUT);
  const answers = w.eventsOf('action').filter((e) => e.data.action === 'answer');
  assert.deepEqual(answers.map((e) => e.data.label), [LEAVE_THEM_OUT]);
  for (let tick = 0; tick < 6; tick += 1) {
    await w.tick();
    w.at(60 * 1000);
    await w.terminalTick();
  }
  assert.equal(handCards(w).length, 1, 'no second card');
  assert.deepEqual((await w.desk(['cards'])).json.questions, [], 'nothing is asked again');
  assert.equal(w.eventsOf('by-hand').length, 0, 'nothing was tied');
  assert.equal(w.openChanges().length, 0, 'no change was opened');
  assert.match(readme(w), HAND_PATTERN, 'the edit stays in the folder');
}));

// Guards: a file name read as a glob. A hand commit of app/[slug]/page.md beside an untracked app/s/page.md: the pattern
// [slug] matched the untracked file, which was carried into the change or lost when the folder let go of its edits.
test('a hand commit of a bracketed file name carries only that file and leaves app/s/ untracked', { timeout: 120000 }, () => world({ recordings: carryOn() }, async (w) => {
  await w.terminalTick();
  const bracketed = 'app/[slug]/page.md';
  fs.mkdirSync(path.join(w.folder, 'app', '[slug]'), { recursive: true });
  fs.mkdirSync(path.join(w.folder, 'app', 's'), { recursive: true });
  fs.writeFileSync(path.join(w.folder, bracketed), 'The page.\n');
  fs.writeFileSync(path.join(w.folder, 'app', 's', 'page.md'), 'Not committed.\n');
  await git(['add', '--', ':(literal)app/[slug]/page.md'], w.folder);
  await git([...HAND, 'commit', '-q', '-m', 'A hand commit'], w.folder);
  const card = await handCardRaised(w);
  await w.press(card, CHECK_AND_ADD);
  await w.tickUntil(() => w.eventsOf('by-hand').length > 0, 'the tie');
  const from = await carriedOn(w);
  assert.deepEqual(from.files.map((f) => f.path), [bracketed], 'the change carries only the committed file');
  assert.equal(await git(['status', '--porcelain', '--untracked-files=all'], w.folder), '?? app/s/page.md', 'app/s/ stays untracked');
  await record(w, from.work, { lane: 'small', visible: true, title: 'Your page', from: from.from });
  const change = await startsAndMergesShownFirst(w, from.work, { files: { [bracketed]: 'The page.\n' } }, { pr: 2 });
  assert.equal(await git(['show', `${change.mergeCommit}:${bracketed}`], w.gitHome), 'The page.');
  await w.tick();
  assert.equal(fs.readFileSync(path.join(w.folder, 'app', 's', 'page.md'), 'utf8'), 'Not committed.\n', 'the untracked file is untouched');
  assert.equal(await git(['status', '--porcelain', '--untracked-files=all'], w.folder), '?? app/s/page.md');
}));

// Guards the same fault where the folder lets go of an edit the main version already holds: the file, already tracked, is
// edited by hand and not committed. Git read app/[slug]/page.md as a pattern that also matched the untracked app/s/page.md,
// so the folder never took the main version.
test('an uncommitted edit of a bracketed file name is let go for the main version and app/s/ stays untracked', { timeout: 120000 }, () => {
  const bracketed = 'app/[slug]/page.md';
  return world({ recordings: carryOn(), files: { [bracketed]: 'The page.\n' } }, async (w) => {
    await w.terminalTick();
    fs.mkdirSync(path.join(w.folder, 'app', 's'), { recursive: true });
    fs.writeFileSync(path.join(w.folder, 'app', 's', 'page.md'), 'Not committed.\n');
    const edited = 'The page.\nWritten by hand in the folder.\n';
    fs.writeFileSync(path.join(w.folder, bracketed), edited);
    const card = await handCardRaised(w);
    await w.press(card, CHECK_AND_ADD);
    await w.tickUntil(() => w.eventsOf('by-hand').length > 0, 'the tie');
    const from = await carriedOn(w);
    assert.deepEqual(from.files.map((f) => f.path), [bracketed], 'the change carries only the edited file');
    await record(w, from.work, { lane: 'small', visible: true, title: 'Your page', from: from.from });
    const change = await startsAndMergesShownFirst(w, from.work, { files: { [bracketed]: edited } }, { pr: 2 });
    await w.tickUntil(async () => (await w.folderMain()) === change.mergeCommit, 'the folder to take the main version');
    assert.equal(fs.readFileSync(path.join(w.folder, bracketed), 'utf8'), edited, 'the edit is kept');
    assert.equal(fs.readFileSync(path.join(w.folder, 'app', 's', 'page.md'), 'utf8'), 'Not committed.\n');
    assert.equal(await git(['status', '--porcelain', '--untracked-files=all'], w.folder), '?? app/s/page.md', 'app/s/ stays untracked');
  });
});

// Guards: a terminal was told of a panel beside the chat. Nothing told to the director in these tests, in the cards, the
// commands' output or the wakes, speaks of one.
test('nothing told to the director in a terminal speaks of a panel', () => {
  assertNoPanelWords();
});
