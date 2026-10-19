// tests/scripts/protection/windows-builds.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  LEVELS, GIT_LOCAL, settingKey, buildsLevel, UNATTENDED_CARD, GUARDED_CARD, BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, buildGrants,
} from '../../../scripts/protection/windows-builds.js';
import { unattendedBuildsLine, confirmLine } from '../../../scripts/state/card-lines.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeEvent, confirmationFor, dataHash } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { computerId } from '../../../scripts/lib/paths.js';
import { tempFolder } from '../../helpers/homes.js';

const T = (n) => `2026-10-19T02:00:${String(n).padStart(2, '0')}.000Z`;
const at = (n) => () => new Date(T(n));
const OTHER = 'deadbeef';

function withHome(fn) {
  const home = path.join(tempFolder('wh-winbuilds-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    return fn(computerId());
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}

const setting = (n, computer, value, { from = computer } = {}) => ({
  ...makeEvent({ kind: 'setting', data: { key: settingKey(computer), value, words: `Build commands: ${value}` }, now: at(n) }),
  computer: from,
});
// A signed confirmation of `target`, carrying `line` when one is given (the Unattended card's click).
const confirm = (n, target, line) => {
  const { kind, data } = confirmationFor(target);
  return makeEvent({ kind, data: line === undefined ? data : { ...data, line }, now: at(n) });
};
const views = (events) => buildViews(events, readEnrolled(), { now: () => new Date('2026-10-19T09:00:00.000Z') });
const level = (events, computer, extra = {}) => buildsLevel({ views: views(events), computer, locked: false, guardedReady: true, ...extra });

test('the levels, the key and the local git commands', () => {
  assert.deepEqual(LEVELS, ['ask', 'guarded', 'unattended']);
  assert.equal(settingKey('0a1b2c3d'), 'windowsBuildCommands:0a1b2c3d');
  assert.deepEqual(GIT_LOCAL, ['git status', 'git diff', 'git log', 'git show', 'git add', 'git commit', 'git restore', 'git rm', 'git mv']);
  assert.deepEqual(BUILD_QUESTION_LABELS, { once: 'Allow this time', feature: 'Allow for this feature', notNow: 'Not now' });
  assert.equal(unattendedBuildsLine('e-1', '0a1b2c3d'), 'Run build commands unattended on this Windows computer, with nothing to hold them (0a1b2c3d, e-1)');
});

test('nothing set, an unconfirmed proposal, or an unknown value reads as ask', () => {
  withHome((me) => {
    assert.equal(level([], me), 'ask');
    assert.equal(buildsLevel({ views: null, computer: me, locked: false, guardedReady: true }), 'ask');
    assert.equal(buildsLevel({ views: {}, computer: me, locked: false, guardedReady: true }), 'ask');
    const proposed = setting(1, me, 'unattended');
    assert.equal(level([proposed], me), 'ask');
    const guarded = setting(2, me, 'guarded');
    assert.equal(level([guarded], me), 'ask');
    const odd = setting(3, me, 'always');
    assert.equal(level([odd, confirm(4, odd)], me), 'ask');
  });
});

test('unattended counts only from a confirmation on its own card line', () => {
  withHome((me) => {
    const on = setting(1, me, 'unattended');
    assert.equal(level([on, confirm(2, on, unattendedBuildsLine(on.id, me))], me), 'unattended');
    // The general Confirm click accepts the setting, but Unattended needs its own card.
    const plain = confirm(2, on);
    const v = views([on, plain]);
    assert.equal(v.settings[settingKey(me)].value, 'unattended');
    assert.equal(v.settings[settingKey(me)].line, null);
    assert.equal(buildsLevel({ views: v, computer: me, locked: false, guardedReady: false }), 'ask');
    // A line for another event, or another computer, is not this one's.
    const other = setting(3, me, 'unattended');
    assert.equal(level([on, confirm(4, on, unattendedBuildsLine(other.id, me))], me), 'ask');
    assert.equal(level([on, confirm(4, on, unattendedBuildsLine(on.id, OTHER))], me), 'ask');
    assert.equal(level([on, confirm(4, on, confirmLine(on))], me), 'ask');
    // The latest confirmation is the one read: a later general Confirm gives ask.
    assert.equal(level([on, confirm(2, on, unattendedBuildsLine(on.id, me)), confirm(5, on)], me), 'ask');
  });
});

test('a plain event back to ask takes effect at once; a plain event to anything else does not', () => {
  withHome((me) => {
    const on = setting(1, me, 'unattended');
    const accepted = [on, confirm(2, on, unattendedBuildsLine(on.id, me))];
    assert.equal(level([...accepted, setting(3, me, 'ask')], me), 'ask');
    assert.equal(level([...accepted, setting(3, me, 'guarded')], me), 'unattended');
    assert.equal(level([...accepted, setting(3, me, 'unattended')], me), 'unattended');
    // A plain ask older than the accepted value is not in force.
    const off = setting(0, me, 'ask');
    assert.equal(level([off, ...accepted], me), 'unattended');
    // A plain ask for another computer's key does not touch this one.
    assert.equal(level([...accepted, setting(3, OTHER, 'ask')], me), 'unattended');
    // With nothing accepted, a plain ask is ask too.
    assert.equal(level([setting(3, me, 'ask')], me), 'ask');
  });
});

test('a level set on another computer reads as ask here', () => {
  withHome((me) => {
    // Turned on for the other computer, on the other computer.
    const theirs = setting(1, OTHER, 'unattended');
    const events = [theirs, confirm(2, theirs, unattendedBuildsLine(theirs.id, OTHER))];
    assert.equal(level(events, me), 'ask');
    // This computer's key, written by another computer.
    const forged = setting(3, me, 'unattended', { from: OTHER });
    assert.equal(level([forged, confirm(4, forged, unattendedBuildsLine(forged.id, me))], me), 'ask');
    const guarded = setting(3, me, 'guarded', { from: OTHER });
    assert.equal(level([guarded, confirm(4, guarded)], me), 'ask');
  });
});

test('unattended in a Locked project reads as ask', () => {
  withHome((me) => {
    const on = setting(1, me, 'unattended');
    const events = [on, confirm(2, on, unattendedBuildsLine(on.id, me))];
    assert.equal(level(events, me, { locked: true }), 'ask');
    assert.equal(level(events, me, { locked: false }), 'unattended');
  });
});

test('guarded reads as ask until this computer\'s self-test passes', () => {
  withHome((me) => {
    const g = setting(1, me, 'guarded');
    const events = [g, confirm(2, g)];
    assert.equal(level(events, me, { guardedReady: false }), 'ask');
    assert.equal(level(events, me, { guardedReady: undefined }), 'ask');
    assert.equal(level(events, me, { guardedReady: true }), 'guarded');
    // Guarded is read from the general Confirm click, not from the Unattended card's line.
    assert.equal(level([g, confirm(2, g, unattendedBuildsLine(g.id, me))], me, { guardedReady: true }), 'ask');
    // Guarded in a Locked project still holds: Locked takes away only Unattended.
    assert.equal(level(events, me, { guardedReady: true, locked: true }), 'guarded');
  });
});

test('the Unattended card recommends Guarded where it is offered, and keeping asking otherwise', () => {
  const offered = UNATTENDED_CARD({ guardedReady: true });
  assert.deepEqual(offered.options.map((o) => [o.name, o.label]), [['keep-asking', 'Keep asking'], ['turn-on', 'Turn on (dangerous)'], ['guarded', 'Use Guarded']]);
  assert.equal(offered.recommend, 'guarded');
  const not = UNATTENDED_CARD({ guardedReady: false });
  assert.deepEqual(not.options.map((o) => o.name), ['keep-asking', 'turn-on']);
  assert.equal(not.recommend, 'keep-asking');
  assert.equal(UNATTENDED_CARD({}).recommend, 'keep-asking');
  for (const card of [offered, not]) {
    assert.equal(card.risk, 'Builders on this computer will run their tests and build steps without asking you, and with nothing to hold them. A builder writes the code these steps run, so one that goes wrong, or is misled by something it reads, could read your passwords and sign-ins on this computer, change Wheelhouse\'s own safety checks, or send your files anywhere, and nothing would ask you first. Reviews, the merge gate and STOP still hold.');
    for (const k of ['what', 'why']) assert.ok(typeof card[k] === 'string' && card[k] !== '', k);
    assert.ok(card.options.every((o) => typeof o.says === 'string' && o.says !== ''));
    assert.match(card.options.find((o) => o.name === 'turn-on').says, /whatever your account can/);
  }
});

test('the Guarded card says whether the keys folder could be read', () => {
  const held = GUARDED_CARD({ writesHeld: true, readsHeld: true });
  const open = GUARDED_CARD({ writesHeld: true, readsHeld: false });
  assert.match(held.risk, /couldn't read the helper's keys folder/);
  assert.match(open.risk, /could still read the helper's keys folder/);
  for (const card of [held, open]) {
    assert.match(card.risk, /Windows stopped a build changing files outside the project/);
    assert.match(card.risk, /can still use the network/);
    assert.deepEqual(card.options.map((o) => o.label), ['Confirm', 'Keep asking']);
    assert.equal(card.recommend, 'confirm');
  }
  // Guarded is offered only where the write was refused.
  assert.equal(GUARDED_CARD({ writesHeld: false, readsHeld: true }), null);
  assert.equal(GUARDED_CARD(null), null);
});

// --- Grants ---

const WORK = 'login-page';
const asked = (n, id, commands, over = {}) => makeEvent({
  kind: 'question',
  data: {
    id, work: WORK, what: `Let this feature's builder run: ${commands.join('; ')}.`, why: 'The tests need running', options: BUILD_QUESTION_OPTIONS,
    recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands, ...over,
  },
  now: at(n),
});
// The director's signed click on one of the question's options.
const clicked = (n, q, label) => makeEvent({
  kind: 'action', data: { action: 'answer', questionId: q.data.id, questionHash: dataHash(q.data), question: q.data.what, label }, now: at(n),
});
const building = (n) => makeEvent({ kind: 'feature', data: { work: WORK, step: 'building' }, now: at(n) });
const grantsOf = (events, extra = {}) => buildGrants({ views: views(events), work: WORK, used: [], computer: computerId(), ...extra });

test('the build-command question\'s options are the design\'s, and each Allow says what it lets the builder do', () => {
  assert.deepEqual(BUILD_QUESTION_OPTIONS.map((o) => o.label), ['Allow this time', 'Allow for this feature', 'Not now']);
  for (const o of BUILD_QUESTION_OPTIONS.slice(0, 2)) assert.match(o.says, /for as long as this lasts, the builder can do whatever your account can/i, o.label);
  assert.match(BUILD_QUESTION_OPTIONS[0].says, /next run only/);
  assert.match(BUILD_QUESTION_OPTIONS[1].says, /until the feature ends/i);
  assert.match(BUILD_QUESTION_OPTIONS[2].says, /waits/);
});

test('allow this time grants its commands for a run, until the waker records it used', () => {
  withHome((me) => {
    const q = asked(2, 'q-login-page-1', ['npm test', 'git status']);
    const events = [building(1), q, clicked(3, q, BUILD_QUESTION_LABELS.once)];
    assert.deepEqual(grantsOf(events), [{ questionId: 'q-login-page-1', commands: ['npm test', 'git status'], scope: 'run' }]);
    assert.deepEqual(grantsOf(events, { used: ['q-login-page-1'] }), []);
    assert.deepEqual(grantsOf(events, { used: new Set(['q-login-page-1']) }), []);
    // A record of used grants that can't be read counts every run grant as used.
    assert.deepEqual(grantsOf(events, { used: null }), []);
    assert.deepEqual(grantsOf(events, { used: undefined }), []);
    // Not now is never an answer, and an unanswered question grants nothing.
    assert.deepEqual(grantsOf([building(1), q]), []);
    // Another feature's question is not this one's.
    assert.deepEqual(buildGrants({ views: views(events), work: 'search-box', used: [], computer: me }), []);
  });
});

test('allow for this feature lasts until the feature reports or closes', () => {
  withHome(() => {
    const q = asked(2, 'q-login-page-1', ['npm run build']);
    const events = [building(1), q, clicked(3, q, BUILD_QUESTION_LABELS.feature)];
    const granted = [{ questionId: 'q-login-page-1', commands: ['npm run build'], scope: 'feature' }];
    assert.deepEqual(grantsOf(events), granted);
    assert.deepEqual(grantsOf(events, { used: ['q-login-page-1'] }), granted, 'a feature grant is not used up by a run');
    assert.deepEqual(grantsOf(events, { used: null }), granted);
    const reported = makeEvent({ kind: 'report', data: { work: WORK, outcome: 'closed', summary: 'Done', rulings: [] }, now: at(4) });
    assert.deepEqual(grantsOf([...events, reported]), []);
    const closed = makeEvent({ kind: 'feature', data: { work: WORK, step: 'closed' }, now: at(4) });
    assert.deepEqual(grantsOf([...events, closed]), []);
    // Work queued again after its report starts afresh: the grant from before the report stays ended.
    const earlier = makeEvent({ kind: 'report', data: { work: WORK, outcome: 'blocked', summary: 'Stuck', rulings: [] }, now: at(0) });
    assert.deepEqual(grantsOf([earlier, ...events]), granted);
    assert.deepEqual(grantsOf([...events, reported, building(5)]), []);
    // No feature at all grants nothing.
    assert.deepEqual(grantsOf([q, clicked(3, q, BUILD_QUESTION_LABELS.feature)]), []);
  });
});

test('an unsigned answer grants nothing', () => {
  withHome(() => {
    const q = asked(2, 'q-login-page-1', ['npm test']);
    const signed = clicked(3, q, BUILD_QUESTION_LABELS.feature);
    assert.equal(grantsOf([building(1), q, signed]).length, 1, 'the signed click grants');
    const { sig, ...unsigned } = signed;
    assert.deepEqual(grantsOf([building(1), q, unsigned]), []);
    const forged = { ...signed, sig: { ...sig, value: Buffer.alloc(64, 1).toString('base64') } };
    assert.deepEqual(grantsOf([building(1), q, forged]), []);
    const altered = { ...signed, data: { ...signed.data, label: BUILD_QUESTION_LABELS.once } };
    assert.deepEqual(grantsOf([building(1), q, altered]), []);
    // A plain question with no commands, answered with an Allow label, is no build-command question.
    const plain = asked(4, 'q-login-page-2', ['npm test']);
    const { commands, ...words } = plain.data;
    const noCommands = { ...plain, data: words };
    assert.deepEqual(grantsOf([building(1), noCommands, clicked(5, noCommands, BUILD_QUESTION_LABELS.feature)]), []);
  });
});

test('a grant holds only on the computer where the click was made', () => {
  withHome((me) => {
    const q = asked(2, 'q-login-page-1', ['npm test']);
    const events = [building(1), q, clicked(3, q, BUILD_QUESTION_LABELS.feature)];
    assert.equal(views(events).questions['q-login-page-1'].answer.computer, me);
    assert.equal(grantsOf(events).length, 1);
    assert.deepEqual(grantsOf(events, { computer: OTHER }), []);
    assert.deepEqual(grantsOf(events, { computer: undefined }), []);
  });
});
