// tests/e2e/director-paths.test.js
// The director's main paths, end to end, on a project in git alone with a terminal and no pane (tests/helpers/director-world.js):
// the real helper, watcher, foreman's wake, engine dispatcher, local host, folder sync, state views and cards, with the fake
// engine in place of a model. The agents' decisions (the front desk recording work, the builder's change) are the commands
// they run, called by the script; the director's presses are signed by the hooks that sign a click in a terminal.
// Each test names the trial fault it guards. The faults came from seven manual trial rounds, where each path worked in its
// parts and failed as a whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../helpers/director-world.js';
import { world, approvalOf, record, waitingCards, approveCards, merged, assertNoPanelWords } from '../helpers/director-steps.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';
import { approving, running } from '../eval/build-loop/engine-recordings.js';
import { CHECK_AND_ADD } from '../../scripts/state/card-lines.js';

waitLongerOnTheHelper();


// Guards: a visible small change goes from the card to the main version on one press each, with nothing done by hand between.
// The work, recorded visible after the card was pressed, must start by itself (the watcher wakes the foreman and the dispatcher
// starts it); the fake build must pass the guard checks from the commit the helper kept; the merge card is pressed; the folder
// takes the merged main.
test('a visible small change: one Approve card, then it starts by itself, builds, is approved once more and merges', { timeout: 120000 }, () => {
  const recordings = { flag: running('flag') };
  return world({ recordings }, async (w) => {
    await w.watch();
    await record(w, 'flag', { lane: 'small', visible: true });
    const card = await approvalOf(w, 'flag');
    assert.equal(card.code, 0, card.err);
    assert.equal(approveCards(w).length, 1, 'one Approve card is raised');
    await w.tick();
    assert.equal(w.starts().length, 0, 'nothing starts before the press');

    await w.press(card.json.question, 'Approve');
    assert.deepEqual(w.eventsOf('action').filter((e) => e.data.action === 'approve-work').map((e) => e.data.work), ['flag']);
    assert.ok(w.eventsOf('action').every((e) => typeof e.sig?.value === 'string'), 'the press is signed');
    const woken = await w.watch();
    assert.equal(woken.filter((l) => /^WAKE foreman /.test(l)).length, 1, 'the watcher wakes the foreman');

    // The change is made first, because the recorded run names its head when it asks for the director's approval.
    const made = await w.branchFor('flag');
    recordings.flag = approving('flag', { pr: 1, head: made.head });
    await w.tick();
    assert.equal(w.starts().length, 1, 'the work started by itself');
    const build = await w.build('flag', { ready: false });
    assert.deepEqual(build.checks, { done: 0, protected: 0, control: 0 }, 'the guard checks pass');
    assert.equal(build.head, made.head);

    let asked;
    await w.tickUntil(async () => { asked = await w.desk(['cards']); return asked.json.questions.length === 1; }, 'the merge card');
    assert.equal(asked.json.questions.length, 1, 'a clean review leads to one merge card');
    assert.match(asked.json.questions[0].question, /pull request #1/);
    await w.press(asked.json.questions[0], 'Approve');
    assert.deepEqual(w.eventsOf('approval').map((e) => [e.data.pr, e.data.commit]), [[1, build.head]]);
    w.engine.setOutput(build.runId, 'approval', JSON.stringify({ decision: 'approve', text: '' }));
    const marked = await build.ticketed.engine.ready({ runId: build.runId });
    assert.equal(marked.ok, true, marked.refused);

    const change = await merged(w, 1);
    const main = await w.homeMain();
    assert.equal(main, change.mergeCommit);
    assert.match(await git(['show', `${main}:README.md`], w.gitHome), /A line the work added\./);
    await w.tickUntil(async () => (await w.folderMain()) === main, 'the folder to take main');
    assert.doesNotMatch(await waitingCards(w), /pull request #1/, 'the merge card is closed');
    assert.deepEqual(w.hostCalls, []);
  });
});

// Guards: quick work users won't see starts with no card at all and merges (a quick start once needed the same help as small work).
test('a quick change nobody sees: no card, it starts, builds and merges, and the folder takes main', { timeout: 120000 }, () => world({ recordings: { tidy: running('tidy') } }, async (w) => {
  await record(w, 'tidy', { lane: 'quick', visible: false });
  assert.deepEqual((await w.desk(['cards'])).json, { questions: [], left: 0 });
  assert.equal(w.records('card').length, 0);
  await w.tick();
  assert.equal(w.starts().length, 1);
  const build = await w.build('tidy');
  assert.deepEqual(build.checks, { done: 0, protected: 0, control: 0 });
  const change = await merged(w, build.pr);
  await w.tickUntil(async () => (await w.folderMain()) === change.mergeCommit, 'the folder to take main');
  assert.equal(w.records('card').length, 0, 'no card came at any point');
  assert.deepEqual(w.hostCalls, []);
}));

// Guards: the guard checks read a run's change from the commit the helper kept for the run. With the main version ahead of the
// folder's own copy of it (the folder holds an edit, so it cannot take the new main), reading from the folder's branch made the
// moved-on main's files, a control file here, look like the run's own change and held a clean run for the director.
test('a quick change started after the main version moved on carries only its own change through the guard checks', { timeout: 120000 }, () => world({ recordings: { tidy: running('tidy') } }, async (w) => {
  await w.landFiles({ 'CLAUDE.md': 'Notes for agents.\n' });
  fs.appendFileSync(path.join(w.folder, 'README.md'), 'An edit made by hand.\n');
  await record(w, 'tidy', { lane: 'quick', visible: false });
  await w.tick();
  assert.equal(w.starts().length, 1);
  const build = await w.build('tidy');
  const verdicts = build.said.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  assert.deepEqual(verdicts.map((v) => v.clean), [true, true], `the guard checks find nothing: ${build.said.join(' | ')}`);
  await merged(w, build.pr);
}));

// Guards: a refused start raised a new card at every wake, worded afresh. The same fault stands for the engine's start: one
// card for the work, however many wakes find the start refused again, and its choices are ones the director can act on.
test('a start that is refused raises one card across many wakes, with choices the director can act on', { timeout: 120000 }, () => {
  const refusing = { on: true };
  const adapt = (engine) => {
    const start = engine.start.bind(engine);
    engine.start = (order) => (refusing.on ? { ok: false, refused: 'the engine could not be reached' } : start(order));
    return engine;
  };
  return world({ recordings: { tidy: running('tidy') }, adapt }, async (w) => {
    await w.watch();
    await record(w, 'tidy', { lane: 'quick', visible: false });
    for (let wake = 0; wake < 6; wake += 1) {
      await w.tick();
      await w.watch();
      w.at(30 * 60 * 1000);
    }
    const cards = w.records('question').filter((q) => q.data.work === 'tidy');
    assert.equal(cards.length, 1, 'one card for the refused start');
    const labels = cards[0].data.options.map((o) => o.label);
    assert.deepEqual(labels, ['Try again', 'Stop here'], 'the choices are ones the director can act on');
    assert.ok(cards[0].data.options.every((o) => o.says.length > 0));
    // The card is asked once, and a press of Try again, with the fault gone, starts the work.
    const asked = await w.desk(['cards']);
    assert.equal(asked.json.questions.length, 1);
    refusing.on = false;
    await w.press(asked.json.questions[0], 'Try again');
    await w.tickUntil(() => w.eventsOf('run').length > 0, 'the work to start');
    assert.equal(w.records('question').filter((q) => q.data.work === 'tidy').length, 1, 'still one card');
  });
});

// Guards: a dropped work's Approve card stayed in the waiting view, to be asked for work that would never be built.
test('dropping work with an open Approve card takes the card out of the waiting view', { timeout: 120000 }, () => world({ recordings: { flag: running('flag') } }, async (w) => {
  await record(w, 'flag', { lane: 'small', visible: true });
  const card = await approvalOf(w, 'flag');
  assert.equal(card.code, 0, card.err);
  assert.match(await waitingCards(w), /Add the flag change/, 'the card waits');
  const dropped = await w.desk(['drop', 'flag']);
  assert.equal(dropped.code, 0, dropped.err);
  assert.doesNotMatch(await waitingCards(w), /Add the flag change/, 'the card has left the waiting view');
  assert.deepEqual((await w.desk(['cards'])).json.questions, [], 'and is not asked');
  await w.tick();
  assert.equal(w.starts().length, 0, 'the dropped work never starts');
}));

// Guards: a terminal was told of a panel beside the chat. Nothing told to the director in these tests, in the cards, the
// commands' output or the wakes, speaks of one.
test('nothing told to the director in a terminal speaks of a panel', () => {
  assertNoPanelWords();
});
