// tests/scripts/update/routes.test.js
// The helper's /update/* routes (update design, sections 4, 6 and 15): the plan and its hash, the refusals (All stop, a feature
// session, a hash from another plan, a second update), the status lines and the cards waiting for the director, and the answer
// relay, which signs nothing. Every look at the world is a seam; no process starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { updateRoutes, clickWasMade } from '../../../scripts/update/routes.js';
import { openJournal } from '../../../scripts/update/journal.js';
import { declined } from '../../../scripts/update/declined.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { releaseLine, updateHelperLine } from '../../../scripts/state/card-lines.js';
import { helperCard, helperCardId, STOP_IT } from '../../../scripts/update/finish.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const OLDER = 'c'.repeat(40);
const HELPER_ID = helperCardId({ pid: 4242, startTime: '2026-11-04T09:00:00.000Z' });

const releases = [{ tag: 'v0.2.5', sha: OLDER }, { tag: 'v0.2.6', sha: SHA }, { tag: 'v0.2.7', sha: NEWER }];

function setup(over = {}) {
  const folder = fs.realpathSync(tempFolder('wh-ur-'));
  writeProject('p1', { folder, remoteUrl: 'https://example.com/o/p1.git', host: 'github', repo: 'o/p1', connection: { host: 'github', mode: 'narrow', project: 'o/p1' } });
  const started = [];
  let stop = false;
  let held = false;
  const routes = updateRoutes({
    stopped: () => stop,
    updateHeld: () => held,
    from: () => 'v0.2.6',
    list: async () => releases,
    fetch: async (tag) => ({ ok: true, sha: releases.find((r) => r.tag === tag).sha }),
    check: async () => ({ ok: true, says: 'GitLab merges no longer need glab.', nodeFloor: null, claudeFloor: null }),
    account: () => null,
    kind: async () => 'pins-only',
    locked: async () => ({ locked: false, others: [] }),
    startRunner: (args) => started.push(args),
    addon: async () => false,
    clicked: () => true,
    ...over,
  });
  return { folder, routes, started, stop: (v) => { stop = v; }, hold: (v) => { held = v; } };
}

const refusal = async (promise) => { const got = await promise; return got.ok === false ? got.refused : null; };

test('plan: a newer release gives the card and a 64-character hash, and keeps what was shown', () => withHome(async () => {
  const t = setup();
  const got = await t.routes['/update/plan']({ folder: t.folder });
  assert.equal(got.ok, true);
  assert.match(got.hash, /^[0-9a-f]{64}$/);
  assert.match(got.card.question, /Update Wheelhouse · v0\.2\.6 → v0\.2\.7/);
  assert.deepEqual(got.card.options.map((o) => o.label), ['Update', 'Not now']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(openJournal('p1').folder, 'plan.json'), 'utf8')).hash, got.hash);
}));

test('plan: a project with the dropped plugin installed at project scope has the removal on the card and in the plan', () => withHome(async () => {
  const t = setup({ retired: ({ projectDir }) => (projectDir === undefined ? [] : ["Matt Pocock's skills"]) });
  const got = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(got.card.question, /Matt Pocock's skills is installed for this project; the update removes it/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(openJournal('p1').folder, 'plan.json'), 'utf8')).plan.removes, ["Matt Pocock's skills"]);
  const none = setup({ retired: () => [] });
  assert.doesNotMatch((await none.routes['/update/plan']({ folder: none.folder })).card.question, /removes it/);
}));

test('plan: where VS Code lists the add-on the card and the plan say the update removes it, and nowhere else', () => withHome(async () => {
  const t = setup({ addon: async () => true });
  const got = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(got.card.question, /add-on is installed in VS Code on this computer; the update removes it/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(openJournal('p1').folder, 'plan.json'), 'utf8')).plan.addon, true);
  const none = setup();
  const plain = await none.routes['/update/plan']({ folder: none.folder });
  assert.doesNotMatch(plain.card.question, /add-on/);
  assert.equal('addon' in JSON.parse(fs.readFileSync(path.join(openJournal('p1').folder, 'plan.json'), 'utf8')).plan, false);
  assert.notEqual(plain.hash, got.hash, 'the click is for the plan that named it');
}));

test('plan: with nothing newer it gives the one line and no card', () => withHome(async () => {
  const t = setup({ from: () => 'v0.2.7' });
  const got = await t.routes['/update/plan']({ folder: t.folder });
  assert.deepEqual(got, { ok: true, lines: ['You have the latest Wheelhouse, v0.2.7.'] });
  assert.equal(fs.existsSync(path.join(openJournal('p1').folder, 'plan.json')), false);
}));

test('plan v0.2.5 on a computer with v0.2.7 gives a put-back card; v0.2.6 is refused as a put-back', () => withHome(async () => {
  const t = setup({ from: () => 'v0.2.7' });
  const back = await t.routes['/update/plan']({ folder: t.folder, tag: 'v0.2.5' });
  // v0.2.5 is before the first release that can finish an update.
  assert.match(back.lines[0], /can't be put back by this command/);
  assert.equal(back.card, undefined);
  const releases2 = [...releases, { tag: 'v0.2.8', sha: 'd'.repeat(40) }];
  const t2 = setup({ from: () => 'v0.2.8', list: async () => releases2, fetch: async (tag) => ({ ok: true, sha: releases2.find((r) => r.tag === tag).sha }) });
  const ok = await t2.routes['/update/plan']({ folder: t2.folder, tag: 'v0.2.7' });
  assert.match(ok.card.question, /^Put Wheelhouse back to v0\.2\.7/m);
  const refused = await t2.routes['/update/plan']({ folder: t2.folder, tag: 'v0.2.6' });
  assert.match(refused.lines[0], /Wheelhouse v0\.2\.6 can't be put back by this command/);
}));

test('plan: a release that does not check out, or whose tag moved, is not offered', () => withHome(async () => {
  const bad = setup({ check: async () => ({ ok: false }) });
  assert.match((await bad.routes['/update/plan']({ folder: bad.folder })).lines[0], /^Release v0\.2\.7 doesn't check out, so it won't be installed\./);
  const moved = setup({ fetch: async () => ({ ok: true, sha: 'f'.repeat(40) }) });
  assert.match((await moved.routes['/update/plan']({ folder: moved.folder })).lines[0], /doesn't check out/);
  const offline = setup({ list: async () => { throw new Error('offline'); } });
  assert.match((await offline.routes['/update/plan']({ folder: offline.folder })).lines[0], /releases couldn't be read just now\. Nothing has changed\./);
}));

test('plan: a release that is not pins-only says the director approves the change', () => withHome(async () => {
  const t = setup({ kind: async () => 'changes' });
  assert.match((await t.routes['/update/plan']({ folder: t.folder })).card.question, /you approve it/);
}));

test('plan: under All stop it says to lift it first, with no card', () => withHome(async () => {
  const t = setup();
  t.stop(true);
  assert.deepEqual(await t.routes['/update/plan']({ folder: t.folder }), { ok: true, lines: ['Lift All stop first.'] });
}));

test('plan and apply: a feature session\'s folder is refused, and so is a folder in no project', () => withHome(async () => {
  const t = setup();
  const worktree = path.join(t.folder, '.claude', 'worktrees', 'f1');
  fs.mkdirSync(worktree, { recursive: true });
  assert.match(await refusal(t.routes['/update/plan']({ folder: worktree })), /director's own command/);
  assert.match(await refusal(t.routes['/update/apply']({ folder: worktree, hash: 'a'.repeat(64) })), /director's own command/);
  assert.match(await refusal(t.routes['/update/plan']({ folder: fs.realpathSync(tempFolder('wh-ur-none-')) })), /isn't set up/);
  assert.deepEqual(t.started, []);
}));

test('apply: only the plan last shown starts, once, and a hash from another plan is refused', () => withHome(async () => {
  const t = setup();
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: 'e'.repeat(64) })), /not the plan on the card/);
  assert.deepEqual(t.started, []);
  const got = await t.routes['/update/apply']({ folder: t.folder, hash: shown.hash });
  assert.equal(got.ok, true);
  assert.equal(got.started, true);
  assert.deepEqual(t.started.map((s) => [s.project, s.folder]), [['p1', t.folder]]);
  // A second update is refused while one runs.
  t.hold(true);
  assert.match(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: shown.hash })), /already under way/);
  assert.equal(t.started.length, 1);
}));

test('apply: under All stop it says to lift All stop first, and starts nothing', () => withHome(async () => {
  const t = setup();
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  t.stop(true);
  assert.equal(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: shown.hash })), 'Lift All stop first.');
  assert.deepEqual(t.started, []);
}));

test('apply: an update part-way is carried on by the plan\'s card, with its journal kept', () => withHome(async () => {
  const t = setup();
  const journal = openJournal('p1');
  journal.mark('checks', 'done', { tag: 'v0.2.7', sha: NEWER, from: 'v0.2.6', put: 'release' });
  journal.mark('change', 'done', { pr: 3, approval: 'review' });
  journal.mark('merged', 'running', { line: 'Waiting for the change naming v0.2.7 to be merged.' });
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(shown.card.question, /^Carry on with the update to v0\.2\.7$/m);
  await t.routes['/update/apply']({ folder: t.folder, hash: shown.hash });
  assert.equal(t.started.length, 1);
  assert.equal(openJournal('p1').read().steps.change.state, 'done');
}));

test('answer: Not now on the Update card keeps the declined release; another hash, or a put-back, keeps nothing', () => withHome(async () => {
  const t = setup();
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(await refusal(t.routes['/update/answer']({ folder: t.folder, card: 'f'.repeat(64), label: 'Not now' })), /No card of the update/);
  assert.equal(declined('p1'), null);
  const got = await t.routes['/update/answer']({ folder: t.folder, card: shown.hash, label: 'Not now' });
  assert.equal(got.ok, true);
  assert.deepEqual(declined('p1'), { tag: 'v0.2.7' });
}));

test('answer: a card the update raised is relayed only when the director\'s click was signed, and wakes a stopped job', () => withHome(async () => {
  let clicked = false;
  const t = setup({ signed: () => clicked });
  const given = helperCard({ kind: 'unknown', version: '0.2.4', canStop: true, id: HELPER_ID });
  const j = openJournal('p1');
  j.mark('checks', 'done', { tag: 'v0.2.7', sha: NEWER, from: 'v0.2.6', put: 'release' });
  j.mark('installs', 'done');
  j.mark('finish', 'running', { line: 'Waiting for your answer about the old helper.' });
  fs.writeFileSync(path.join(j.folder, 'finish.json'), JSON.stringify({ handover: { waiting: { card: given } } }));
  // Nothing signed: the relay refuses, and nothing starts. The relay never signs for the director.
  assert.match(await refusal(t.routes['/update/answer']({ folder: t.folder, card: HELPER_ID, label: STOP_IT })), /not recorded/);
  assert.equal(t.started.length, 0);
  // A card or a label the update never raised.
  assert.match(await refusal(t.routes['/update/answer']({ folder: t.folder, card: 'update-helper-9999-other', label: STOP_IT })), /No card of the update/);
  assert.match(await refusal(t.routes['/update/answer']({ folder: t.folder, card: HELPER_ID, label: 'Approve' })), /No card of the update/);
  // Signed by the click: the job is woken when it has stopped, and left alone while it runs.
  clicked = true;
  const woke = await t.routes['/update/answer']({ folder: t.folder, card: HELPER_ID, label: STOP_IT });
  assert.equal(woke.recorded, true);
  assert.equal(t.started.length, 1);
  t.hold(true);
  await t.routes['/update/answer']({ folder: t.folder, card: HELPER_ID, label: STOP_IT });
  assert.equal(t.started.length, 1);
}));

test('status: lines for each stage, the approval card while it waits, and the old helper\'s card while it asks', () => withHome(async () => {
  const t = setup();
  assert.deepEqual((await t.routes['/update/status']({ folder: t.folder })).lines, ['No update is under way on this computer.']);
  const j = openJournal('p1');
  j.mark('checks', 'done', { tag: 'v0.2.7', sha: NEWER, from: 'v0.2.6', put: 'release' });
  j.mark('change', 'done', { pr: 3, approval: 'card', card: { previous: 'v0.2.6', release: 'v0.2.7', commit: NEWER } });
  j.mark('merged', 'running', { line: 'Waiting for the change naming v0.2.7 to be merged.' });
  t.hold(true);
  const waiting = await t.routes['/update/status']({ folder: t.folder });
  assert.equal(waiting.state, 'running');
  assert.match(waiting.lines.join('\n'), /Checked Wheelhouse v0\.2\.7\./);
  assert.match(waiting.lines.join('\n'), /Waiting for the change naming v0\.2\.7 to be merged\./);
  assert.equal(waiting.asks.length, 1);
  assert.equal(waiting.asks[0].id, `release-${NEWER}`);
  assert.match(waiting.asks[0].card.question, new RegExp(releaseLine('v0.2.6', 'v0.2.7', NEWER)));
  // Stopped: the process has gone.
  t.hold(false);
  const gone = await t.routes['/update/status']({ folder: t.folder });
  assert.equal(gone.state, 'stopped');
  assert.match(gone.lines.join('\n'), /Type \/wheelhouse:update to carry on\./);
  // The old helper's card.
  const given = helperCard({ kind: 'unknown', version: '0.2.4', canStop: true, id: HELPER_ID });
  j.mark('merged', 'done', { merged: true, approved: true });
  j.mark('installs', 'done');
  j.mark('finish', 'running', { line: 'Waiting for your answer about the old helper.' });
  fs.writeFileSync(path.join(j.folder, 'finish.json'), JSON.stringify({ handover: { waiting: { card: given } } }));
  t.hold(true);
  const asking = await t.routes['/update/status']({ folder: t.folder });
  assert.equal(asking.asks.length, 1);
  assert.equal(asking.asks[0].id, HELPER_ID);
  assert.match(asking.asks[0].card.question, new RegExp(updateHelperLine(HELPER_ID)));
  // Done.
  j.mark('finish', 'done', { line: 'Wheelhouse v0.2.7 is installed. Start a new session on this folder to use it.' });
  j.mark('done', 'done', { line: 'Wheelhouse v0.2.7 is installed. Start a new session on this folder to use it.' });
  t.hold(false);
  const done = await t.routes['/update/status']({ folder: t.folder });
  assert.equal(done.state, 'done');
  assert.deepEqual(done.lines, ['Wheelhouse v0.2.7 is installed. Start a new session on this folder to use it.']);
  assert.equal(done.asks, undefined);
}));

test('status: a failure is said with its line, and the way to carry on', () => withHome(async () => {
  const t = setup();
  const j = openJournal('p1');
  j.mark('checks', 'done', { tag: 'v0.2.7', sha: NEWER, from: 'v0.2.6', put: 'release' });
  j.mark('change', 'done', { pr: 3, approval: 'review' });
  j.mark('merged', 'failed', { line: 'The change naming v0.2.7 was closed without being merged, so nothing was installed.' });
  const got = await t.routes['/update/status']({ folder: t.folder });
  assert.equal(got.state, 'stopped');
  assert.match(got.lines.join('\n'), /closed without being merged, so nothing was installed/);
}));

test('routes: only the fields each route takes are accepted', () => withHome(async () => {
  const t = setup();
  assert.match(await refusal(t.routes['/update/plan']({ folder: t.folder, hash: 'x' })), /only/);
  assert.match(await refusal(t.routes['/update/status']({ folder: t.folder, tag: 'v0.2.7' })), /only/);
  assert.match(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: 'short' })), /full hash/);
  assert.match(await refusal(t.routes['/update/plan']({ folder: t.folder, tag: 'latest' })), /tag/);
}));

// ---- The director's click (update design, section 4): apply and the decline start from a signed click, never from the hash alone.
const LATER = (seconds) => () => new Date(Date.now() + seconds * 1000);

// What the prompt record earns from a click on `label` of the card `shown`, kept as a signed event `seconds` from now.
async function clickOn(shown, label, { seconds = 5, question = shown.card.question, card = shown.card } = {}) {
  const got = await earned({ project: 'p1', question, label, card, client: {}, now: LATER(seconds), left: (p) => p });
  return got === null ? null : makeEvent({ kind: 'action', data: got.made.data, now: LATER(seconds) });
}
const keyed = (fn) => withHome(async () => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-11-04T00:00:00.000Z' });
  return fn();
});
const stored = (project = 'p1') => JSON.parse(fs.readFileSync(path.join(openJournal(project).folder, 'plan.json'), 'utf8'));
const hasClick = (events, label = 'Update') => clickWasMade({ events, enrolled: readEnrolled(), stored: stored(), label });

test('apply: an agent\'s own plan then apply, with no click on the card, starts nothing', () => withHome(async () => {
  const t = setup({ clicked: undefined });
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: shown.hash })), /has not clicked Update/);
  assert.deepEqual(t.started, []);
  assert.equal(stored().used, undefined);
}));

test('apply: the director\'s real click on the card starts the update, once', () => keyed(async () => {
  let events = [];
  const t = setup({ clicked: (a) => clickWasMade({ events, enrolled: readEnrolled(), ...a }) });
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: shown.hash })), /has not clicked Update/);
  events = [await clickOn(shown, 'Update')];
  assert.equal(hasClick(events), true);
  const got = await t.routes['/update/apply']({ folder: t.folder, hash: shown.hash });
  assert.equal(got.started, true);
  assert.equal(t.started.length, 1);
  // The click is spent: the same plan does not start a second update.
  assert.match(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: shown.hash })), /under way|not the plan on the card/);
  assert.equal(t.started.length, 1);
}));

test('apply: a click on another plan\'s card, on Not now, or from before the plan was shown is no click for this plan', () => keyed(async () => {
  const old = setup({ from: () => 'v0.2.5' });
  const first = await old.routes['/update/plan']({ folder: old.folder });
  const other = await clickOn(first, 'Update');
  assert.ok(other);
  const t = setup({ clicked: undefined });
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.notEqual(shown.hash, first.hash);
  assert.equal(hasClick([other]), false, 'a click on another plan\'s card');
  assert.equal(hasClick([await clickOn(shown, 'Not now')], 'Update'), false, 'Not now is not Update');
  assert.equal(hasClick([await clickOn(shown, 'Update', { seconds: -3600 })]), false, 'a click made before the plan was shown');
  assert.equal(hasClick([await clickOn(shown, 'Update')]), true);
  assert.deepEqual(t.started, []);
}));

test('apply: a click ties to the kind of move: an update click is no click for a put-back plan of the same hash fields', () => keyed(async () => {
  const t = setup({ from: () => 'v0.2.8' });
  const back = await t.routes['/update/plan']({ folder: t.folder, tag: 'v0.2.7' });
  assert.equal(stored().plan.put, 'undo');
  const click = await clickOn(back, 'Update');
  assert.equal(click.data.put, 'undo');
  assert.equal(hasClick([click]), true);
  const forged = { ...click, data: { ...click.data, put: 'release' } };
  assert.equal(hasClick([forged]), false, 'its signature no longer holds');
}));

test('the prompt record earns the click only from the card the helper showed last, word for word, asked as it was shown', () => keyed(async () => {
  const t = setup();
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.ok(await clickOn(shown, 'Update'));
  assert.ok(await clickOn(shown, 'Not now'));
  assert.equal(await clickOn(shown, 'Maybe'), null, 'a label the card does not offer');
  assert.equal(await clickOn(shown, 'Update', { card: null }), null, 'a reply or a card that was not asked');
  assert.equal(await clickOn(shown, 'Update', { card: { ...shown.card, options: [shown.card.options[0]] } }), null, 'other options');
  const reworded = shown.card.question.replace("What's new", 'Whats new');
  assert.equal(await clickOn(shown, 'Update', { question: reworded, card: { ...shown.card, question: reworded } }), null, 'a reworded card');
  // After it has started, the plan is spent.
  const file = path.join(openJournal('p1').folder, 'plan.json');
  fs.writeFileSync(file, JSON.stringify({ ...stored(), used: true }));
  assert.equal(await clickOn(shown, 'Update'), null);
}));

test('answer: Not now on the Update card keeps the release declined only after the director\'s signed Not now', () => keyed(async () => {
  let events = [];
  const t = setup({ clicked: (a) => clickWasMade({ events, enrolled: readEnrolled(), ...a }) });
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  assert.match(await refusal(t.routes['/update/answer']({ folder: t.folder, card: shown.hash, label: 'Not now' })), /has not clicked Not now/);
  assert.equal(declined('p1'), null);
  events = [await clickOn(shown, 'Update')];
  assert.match(await refusal(t.routes['/update/answer']({ folder: t.folder, card: shown.hash, label: 'Not now' })), /has not clicked Not now/, 'an Update click is no Not now');
  events = [await clickOn(shown, 'Not now')];
  assert.equal((await t.routes['/update/answer']({ folder: t.folder, card: shown.hash, label: 'Not now' })).ok, true);
  assert.deepEqual(declined('p1'), { tag: 'v0.2.7' });
}));

test('placing the project trusts the caller\'s own folder: a lying caller changes nothing without the director\'s click', () => withHome(async () => {
  const t = setup({ clicked: undefined });
  const shown = await t.routes['/update/plan']({ folder: t.folder });
  // A feature session that names the main folder is placed as the main checkout, and then meets the click.
  assert.match(await refusal(t.routes['/update/apply']({ folder: t.folder, hash: shown.hash })), /has not clicked Update/);
  assert.deepEqual(t.started, []);
}));

test('plan: an account that names the catalogue at an old release is said on the card, and one that is not Wheelhouse\'s stops the plan', () => withHome(async () => {
  const named = setup({ account: () => ({ ref: 'v0.2.6' }) });
  const got = await named.routes['/update/plan']({ folder: named.folder });
  assert.match(got.card.question, /Your account settings name Wheelhouse at v0\.2\.6; the update changes that one entry to v0\.2\.7\./);
  const none = setup();
  const plain = await none.routes['/update/plan']({ folder: none.folder });
  assert.doesNotMatch(plain.card.question, /account settings/);
  const odd = setup({ account: () => ({ refused: 'The account\'s settings name a catalogue called wheelhouse that is not the Wheelhouse repository, so the update leaves them alone and stops.' }) });
  const stopped = await odd.routes['/update/plan']({ folder: odd.folder });
  assert.equal(stopped.card, undefined);
  assert.match(stopped.lines[0], /not the Wheelhouse repository/);
}));
