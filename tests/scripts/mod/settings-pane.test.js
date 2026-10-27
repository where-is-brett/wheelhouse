// tests/scripts/mod/settings-pane.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { settingsRows, settingsGroups, choiceOf, pressSetting, changesFor, premiumRowShown, ADVANCED } from '../../../scripts/mod/settings-pane.js';
import { handle, lineOf } from '../../../scripts/mod/bridge.js';
import { effectiveSettings } from '../../../scripts/settings/effective.js';
import { SETTINGS } from '../../../scripts/settings/catalogue.js';
import { makeEvent, eventPath, listEvents, eventHash } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol, verify, readEnrolled } from '../../../scripts/state/signing.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { stateDir, profileDir } from '../../../scripts/lib/paths.js';
import { UNDO_MS } from '../../../scripts/lib/mod-numbers.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { withHome } from '../../helpers/homes.js';

const P = 'owner__name';
const STOP_REFUSAL = { ok: false, refused: 'STOP is on' };
const SYDNEY = 'Australia/Sydney';
// Sydney is on daylight time (+11) on 19 October 2026, so 18:00 there is 07:00 UTC.
const at = (iso) => () => new Date(iso);

const withKey = (fn) => withHome(async (home) => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
  return fn(home);
});

function keepEvent(dir, event) {
  const file = path.join(dir, eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
}

// What the helper does for a setting: makes the event, keeps it in the clone, answers its id.
// A signed confirmation is kept as it arrives. `stop` and `down` refuse as the helper does.
function fake({ stop = false, down = false, takesRecord = true, from = '2026-10-19T05:00:00.000Z' } = {}) {
  // Each event the helper makes is a minute after the one before.
  let minute = 0;
  const now = () => new Date(Date.parse(from) + (minute++) * 60 * 1000);
  const calls = { order: [], write: [], profileWrite: [], record: [], profileRecord: [] };
  const wrote = (dir, list, name) => async (body) => {
    list.push(body);
    calls.order.push(name);
    if (stop) return STOP_REFUSAL;
    if (down) return { ok: false, refused: 'the host helper could not be reached: is it running?' };
    const event = makeEvent({ kind: body.kind, data: body.data, now });
    keepEvent(dir(), event);
    return { ok: true, id: event.id, pushed: true };
  };
  const recorded = (dir, list, name) => async (body) => {
    list.push(body);
    calls.order.push(name);
    if (!takesRecord) return { ok: false, refused: 'no' };
    keepEvent(dir(), body.event);
    return { ok: true, id: body.event.id, pushed: true };
  };
  return {
    calls,
    state: { write: wrote(() => stateDir(P), calls.write, 'write'), record: recorded(() => stateDir(P), calls.record, 'record') },
    profile: { write: wrote(() => profileDir(), calls.profileWrite, 'profile-write'), record: recorded(() => profileDir(), calls.profileRecord, 'profile-record') },
  };
}

const press = (client, key, choice, { now = at('2026-10-19T05:00:00.000Z'), timeZone = SYDNEY } = {}) => pressSetting({ project: P, key, choice, client, now, timeZone });
const nothingSent = (c) => c.calls.order.length;
const pendingFiles = () => {
  try {
    return fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
};
const rowOf = (rows, key) => rows.find((r) => r.key === key);
const ids = (row) => row.choices.map((c) => c.id);

test('every everyday setting is a row in the design\'s order, with its current choice marked', () => {
  const now = at('2026-10-19T05:00:00.000Z');
  const effective = effectiveSettings({
    project: { pace: { key: 'pace', value: 2, id: 'a', at: '2026-10-18T00:00:00.000Z', before: null } },
    profile: { briefing: { key: 'briefing', value: 'short', id: 'b', at: '2026-10-18T00:00:00.000Z', before: null } },
    now,
  });
  const rows = settingsRows({ effective, now, timeZone: SYDNEY });
  assert.deepEqual(rows.map((r) => r.key), [
    'autonomy', 'showFirst', 'presence', 'milestones', 'efficiency', 'premium', 'budget', 'pace', 'briefing', 'briefingGapHours', 'explanations',
    'notifications', 'usageMark', 'boardTab', 'hours', 'phase', 'protection',
  ]);
  assert.deepEqual(rows.map((r) => r.label), [
    'Autonomy', 'Show before building', 'Availability', 'Feature milestones', 'Thoroughness', 'Premium model', 'Budget', 'Crew at once', 'Briefing length', 'Hours before a new briefing',
    'Explanations', 'Notifications', 'Usage nudge', 'Logbook opens on', 'Working hours', 'Product phase', 'Protection',
  ]);

  const pace = rowOf(rows, 'pace');
  assert.deepEqual(pace.choices, [{ id: '1', label: '1', chosen: false }, { id: '2', label: '2', chosen: true }, { id: '3', label: '3', chosen: false }]);
  assert.equal(pace.current, '2');
  assert.equal(pace.from, 'this project');
  assert.equal(pace.here, true);

  const briefing = rowOf(rows, 'briefing');
  assert.equal(briefing.from, 'yours');
  assert.deepEqual(briefing.choices.map((c) => [c.id, c.chosen]), [['short', true], ['standard', false], ['detailed', false]]);

  // An unset setting is its default, said so.
  const autonomy = rowOf(rows, 'autonomy');
  assert.equal(autonomy.from, 'the default');
  assert.equal(autonomy.current, 'Balanced');
  assert.deepEqual(autonomy.choices.map((c) => [c.label, c.chosen]), [['Cautious', false], ['Balanced', true], ['Trusting', false]]);
  assert.deepEqual(rowOf(rows, 'milestones').choices.map((c) => c.label), ['Midpoint demos', 'Run to the end', 'Ask per feature']);
  assert.deepEqual(rowOf(rows, 'showFirst').choices.map((c) => c.label), ['Always', 'Visual changes', 'Only when asked']);
  assert.deepEqual(rowOf(rows, 'boardTab').choices.map((c) => c.id), ['director', 'build']);
  assert.equal(rows.filter((r) => r.choices.length > 0).every((r) => r.choices.filter((c) => c.chosen).length === 1 || r.key === 'presence'), true);

  // Every row is plain data the bridge can pass on.
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), rows);
  assert.equal(ADVANCED, 'Advanced settings: ask the First Mate');
});

test('presence offers its six choices, marks the one in force, and says when it ends', () => {
  const now = at('2026-10-19T05:00:00.000Z');
  const rowsFor = (entry) => rowOf(settingsRows({ effective: effectiveSettings({ profile: entry ? { presence: entry } : {}, now }), now, timeZone: SYDNEY }), 'presence');
  const here = rowsFor(null);
  assert.deepEqual(here.choices.map((c) => c.label), [
    'Here', 'Away for 2 hours', 'Away until 18:00', 'Away until 09:00 tomorrow', 'Do not disturb until 09:00 tomorrow', 'Do not disturb until I change it',
  ]);
  assert.deepEqual(ids(here), ['here', 'away-hours', 'away-evening', 'away-morning', 'dnd-morning', 'dnd-open']);
  assert.deepEqual([here.current, here.choices.filter((c) => c.chosen).map((c) => c.id)], ['Here', ['here']]);

  // 18:00 in Sydney today is 07:00 UTC.
  const evening = rowsFor({ key: 'presence', value: 'away', until: '2026-10-19T07:00:00.000Z', id: 'x', at: '2026-10-19T04:00:00.000Z', before: null });
  assert.equal(evening.current, 'Away until 18:00');
  assert.equal(evening.until, '2026-10-19T07:00:00.000Z');
  assert.equal(evening.from, 'yours');
  assert.deepEqual(evening.choices.filter((c) => c.chosen).map((c) => c.id), ['away-evening']);

  const morning = rowsFor({ key: 'presence', value: 'dnd', until: '2026-10-19T22:00:00.000Z', id: 'x', at: '2026-10-19T04:00:00.000Z', before: null });
  assert.equal(morning.current, 'Do not disturb until 09:00 tomorrow');
  assert.deepEqual(morning.choices.filter((c) => c.chosen).map((c) => c.id), ['dnd-morning']);

  const open = rowsFor({ key: 'presence', value: 'dnd', id: 'x', at: '2026-10-19T04:00:00.000Z', before: null });
  assert.equal(open.current, 'Do not disturb');
  assert.deepEqual(open.choices.filter((c) => c.chosen).map((c) => c.id), ['dnd-open']);
});

test('a choice sets the setting and signs its confirmation, in the project or the profile by its home', () => withKey(async () => {
  const client = fake();
  const said = await press(client, 'pace', '2');
  assert.deepEqual(said, { made: true, says: 'Crew at once is now 2, for this project' });
  assert.deepEqual(client.calls.order, ['write', 'record']);
  assert.deepEqual(client.calls.write, [{ project: P, kind: 'setting', data: { key: 'pace', value: 2 } }]);
  const setting = listEvents(stateDir(P), { report: () => {} }).find((e) => e.kind === 'setting');
  const [record] = client.calls.record;
  assert.equal(record.project, P);
  assert.equal(verify(record.event, readEnrolled()), true);
  assert.equal(record.event.kind, 'confirmation');
  assert.deepEqual(record.event.data, { confirms: setting.id, confirmsHash: eventHash(setting) });

  // The same record a Confirm click on the setting's card earns.
  const views = buildViews(listEvents(stateDir(P), { report: () => {} }), readEnrolled(), { now: at('2026-10-19T05:00:00.000Z') });
  assert.equal(views.settings.pace.value, 2);
  assert.deepEqual(views.unconfirmed, []);
  assert.deepEqual(pendingFiles(), []);

  // A profile setting goes to the profile, and its confirmation to the profile.
  const own = fake();
  const profile = await press(own, 'briefing', 'short');
  assert.deepEqual(profile, { made: true, says: 'Briefing length is now short, for all your projects' });
  assert.deepEqual(own.calls.order, ['profile-write', 'profile-record']);
  assert.deepEqual(own.calls.profileWrite, [{ kind: 'setting', data: { key: 'briefing', value: 'short' } }]);
  const chosen = listEvents(profileDir(), { report: () => {} }).find((e) => e.kind === 'setting');
  assert.deepEqual(own.calls.profileRecord[0].event.data, { confirms: chosen.id, confirmsHash: eventHash(chosen) });
  assert.equal(verify(own.calls.profileRecord[0].event, readEnrolled()), true);
  assert.equal(own.calls.record.length + own.calls.write.length, 0);

  // A level's word is its choice's label.
  const words = fake();
  assert.equal((await press(words, 'milestones', 'to-the-end')).says, 'Feature milestones is now run to the end, for this project');
  assert.equal((await press(words, 'explanations', 'some-terms')).says, 'Explanations is now some technical terms, for all your projects');
}));

test('a confirmation the helper does not take yet is kept, and the press says so', () => withKey(async () => {
  const client = fake({ takesRecord: false });
  const said = await press(client, 'phase', 'launched');
  assert.deepEqual(said, { made: true, says: 'Product phase is now launched, for this project (kept until the helper takes it)' });
  assert.equal(pendingFiles().length, 1);
  const kept = JSON.parse(fs.readFileSync(path.join(pendingDir(P), pendingFiles()[0]), 'utf8'));
  assert.equal(kept.route, 'record');
  assert.equal(kept.body.event.kind, 'confirmation');
}));

test('where the confirmation can\'t be signed or the setting can\'t be read back, the setting waits for a Confirm', () => withHome(async () => {
  // No signing key: the setting is written, but not confirmed.
  const client = fake();
  const said = await press(client, 'pace', '1');
  assert.equal(said.made, false);
  assert.equal(said.says, 'Crew at once was set but not confirmed, so it waits for your Confirm');
  assert.equal(client.calls.record.length, 0);
  assert.deepEqual(pendingFiles(), []);

  // The helper took the write but its event isn't in the clone.
  const lost = { state: { write: async () => ({ ok: true, id: 'no-such-event', pushed: true }), record: async () => { throw new Error('not reached'); } } };
  assert.equal((await press(lost, 'pace', '1')).says, 'Crew at once was set but not confirmed, so it waits for your Confirm');
}));

test('Away until 18:00 is not offered at 18:00, and a press on it then records nothing', () => withKey(async () => {
  for (const [zone, before, edge] of [
    [SYDNEY, '2026-10-19T06:59:00.000Z', '2026-10-19T07:00:00.000Z'],
    ['Asia/Kolkata', '2026-10-19T12:29:00.000Z', '2026-10-19T12:30:00.000Z'],
    ['America/New_York', '2026-10-19T21:59:00.000Z', '2026-10-19T22:00:00.000Z'],
  ]) {
    const offered = (iso) => ids(rowOf(settingsRows({ effective: {}, now: at(iso), timeZone: zone }), 'presence'));
    assert.equal(offered(before).includes('away-evening'), true, `${zone} at 17:59`);
    assert.equal(offered(edge).includes('away-evening'), false, `${zone} at 18:00`);

    // At 17:59 the choice ends at 18:00; at 18:00 it is not a choice any more.
    assert.deepEqual(choiceOf('presence', 'away-evening', { now: at(before), timeZone: zone }), { value: 'away', until: edge });
    assert.equal(choiceOf('presence', 'away-evening', { now: at(edge), timeZone: zone }), null);
    const client = fake();
    const said = await press(client, 'presence', 'away-evening', { now: at(edge), timeZone: zone });
    assert.deepEqual(said, { made: false, says: 'It\'s past 18:00, so Away until 18:00 isn\'t offered now' });
    assert.equal(nothingSent(client), 0);
    assert.deepEqual(pendingFiles(), []);
  }
  // Early in the morning it is offered, for the same evening.
  assert.deepEqual(choiceOf('presence', 'away-evening', { now: at('2026-10-18T14:30:00.000Z'), timeZone: SYDNEY }), { value: 'away', until: '2026-10-19T07:00:00.000Z' });
}));

test('until 09:00 is the next 09:00 to come, worked out at the press, after midnight too', () => withKey(async () => {
  const sydney = (iso) => ({ now: at(iso), timeZone: SYDNEY });
  const until = (iso, id = 'away-morning', zone = sydney(iso)) => choiceOf('presence', id, zone)?.until;
  // 09:00 on the 20th in Sydney is 22:00 UTC on the 19th; 09:00 on the 21st is 22:00 UTC on the 20th.
  // 23:50 on the 19th: the next 09:00 is tomorrow's.
  const late = sydney('2026-10-19T12:50:00.000Z');
  assert.deepEqual(choiceOf('presence', 'away-morning', late), { value: 'away', until: '2026-10-19T22:00:00.000Z' });
  assert.deepEqual(choiceOf('presence', 'dnd-morning', late), { value: 'dnd', until: '2026-10-19T22:00:00.000Z' });
  // 00:10 on the 20th: 09:00 that morning is still to come. A row drawn before midnight carries no
  // time, so the press works it out again.
  const after = sydney('2026-10-19T13:10:00.000Z');
  assert.deepEqual(choiceOf('presence', 'away-morning', after), { value: 'away', until: '2026-10-19T22:00:00.000Z' });
  assert.equal(JSON.stringify(settingsRows({ effective: {}, now: late.now, timeZone: SYDNEY })).includes('2026-10-19T22:00'), false);
  // 08:59 on the 20th it is this morning; at 09:00 it is the next day's; 10:00 likewise.
  assert.equal(until('2026-10-19T21:59:00.000Z'), '2026-10-19T22:00:00.000Z');
  assert.equal(until('2026-10-19T22:00:00.000Z'), '2026-10-20T22:00:00.000Z');
  assert.equal(until('2026-10-19T23:00:00.000Z'), '2026-10-20T22:00:00.000Z');

  // The label says "tomorrow" only when the 09:00 is on another day; the ids stay.
  const labels = (iso) => rowOf(settingsRows({ effective: {}, ...sydney(iso) }), 'presence').choices.filter((c) => c.id.endsWith('-morning')).map((c) => [c.id, c.label]);
  assert.deepEqual(labels('2026-10-19T12:50:00.000Z'), [['away-morning', 'Away until 09:00 tomorrow'], ['dnd-morning', 'Do not disturb until 09:00 tomorrow']]);
  assert.deepEqual(labels('2026-10-19T13:10:00.000Z'), [['away-morning', 'Away until 09:00'], ['dnd-morning', 'Do not disturb until 09:00']]);
  assert.deepEqual(labels('2026-10-19T21:59:00.000Z'), [['away-morning', 'Away until 09:00'], ['dnd-morning', 'Do not disturb until 09:00']]);
  assert.deepEqual(labels('2026-10-19T22:00:00.000Z'), [['away-morning', 'Away until 09:00 tomorrow'], ['dnd-morning', 'Do not disturb until 09:00 tomorrow']]);

  // The press says it as the label does.
  const client = fake();
  assert.deepEqual(await press(client, 'presence', 'dnd-morning', after), { made: true, says: 'Do not disturb until 09:00. Undo in the pane for a minute.' });
  assert.deepEqual(client.calls.profileWrite, [{ kind: 'setting', data: { key: 'presence', value: 'dnd', until: '2026-10-19T22:00:00.000Z' } }]);
  const next = fake();
  assert.equal((await press(next, 'presence', 'away-morning', sydney('2026-10-19T23:00:00.000Z'))).says, 'Away until 09:00 tomorrow. Undo in the pane for a minute.');
  assert.equal(next.calls.profileWrite[0].data.until, '2026-10-20T22:00:00.000Z');

  // In UTC, just after midnight, it is this morning.
  assert.deepEqual(choiceOf('presence', 'away-morning', { now: at('2026-10-20T00:05:00.000Z'), timeZone: 'UTC' }), { value: 'away', until: '2026-10-20T09:00:00.000Z' });
  assert.deepEqual(choiceOf('presence', 'away-morning', { now: at('2026-10-20T09:00:00.000Z'), timeZone: 'UTC' }), { value: 'away', until: '2026-10-21T09:00:00.000Z' });
  // New York ends daylight time at 06:00 UTC on 1 November 2026, so 09:00 that day is 14:00 UTC.
  const york = (iso) => ({ now: at(iso), timeZone: 'America/New_York' });
  assert.equal(until('', 'away-morning', york('2026-10-31T20:00:00.000Z')), '2026-11-01T14:00:00.000Z');
  assert.equal(until('', 'away-morning', york('2026-11-01T00:00:00.000Z')), '2026-11-01T14:00:00.000Z');
  // Before the change (01:00 EDT) and after it (01:30 EST) it is still this morning.
  assert.equal(until('', 'away-morning', york('2026-11-01T05:00:00.000Z')), '2026-11-01T14:00:00.000Z');
  assert.equal(until('', 'away-morning', york('2026-11-01T06:30:00.000Z')), '2026-11-01T14:00:00.000Z');
  // 08:59 EST, then 09:00 EST: the next one is on the 2nd, also 14:00 UTC.
  assert.equal(until('', 'away-morning', york('2026-11-01T13:59:00.000Z')), '2026-11-01T14:00:00.000Z');
  assert.equal(until('', 'away-morning', york('2026-11-01T14:00:00.000Z')), '2026-11-02T14:00:00.000Z');
  // The day before the change, 09:00 is 13:00 UTC; a press at 10:00 EDT ends at 09:00 EST on the 1st.
  assert.equal(until('', 'away-morning', york('2026-10-31T14:00:00.000Z')), '2026-11-01T14:00:00.000Z');
  // Two hours is two hours.
  assert.deepEqual(choiceOf('presence', 'away-hours', late), { value: 'away', until: '2026-10-19T14:50:00.000Z' });
  assert.deepEqual(choiceOf('presence', 'here', late), { value: 'here' });
  assert.deepEqual(choiceOf('presence', 'dnd-open', late), { value: 'dnd' });
}));

test('a level the catalogue refuses records nothing', () => withKey(async () => {
  const client = fake();
  for (const [key, choice] of [
    ['budget', 'weekly-share'], ['budget', 'per-feature'], ['pace', '4'], ['pace', 2], ['autonomy', 'reckless'], ['autonomy', undefined],
    ['presence', 'away'], ['roundCap', '3'], ['known:git', 'true'], ['nonsense', 'x'], [undefined, 'x'], ['hours', 'null'], ['notifications', 'claude'],
    ['protection', 'locked'], ['__proto__', 'x'], ['constructor', 'x'],
  ]) {
    const said = await press(client, key, choice);
    assert.equal(said.made, false, `${key} ${choice}`);
    assert.equal(typeof said.says, 'string');
  }
  assert.equal(nothingSent(client), 0);
  assert.deepEqual(pendingFiles(), []);
}));

test('the value before is the one in force at the press', () => withKey(async () => {
  // The pane was drawn with the default of 3; the director then said "pace 1" in the chat and
  // confirmed it. A press on 2 comes after.
  const drawn = settingsRows({ effective: effectiveSettings({ now: at('2026-10-19T05:00:00.000Z') }), now: at('2026-10-19T05:00:00.000Z'), timeZone: SYDNEY });
  assert.equal(rowOf(drawn, 'pace').current, '3');
  const chat = makeEvent({ kind: 'setting', data: { key: 'pace', value: 1 }, now: at('2026-10-19T05:30:00.000Z') });
  keepEvent(stateDir(P), chat);
  keepEvent(stateDir(P), makeEvent({ kind: 'confirmation', data: { confirms: chat.id, confirmsHash: eventHash(chat) }, now: at('2026-10-19T05:31:00.000Z') }));

  const client = fake({ from: '2026-10-19T06:00:00.000Z' });
  assert.equal((await press(client, 'pace', '2', { now: at('2026-10-19T06:00:00.000Z') })).made, true);
  const views = buildViews(listEvents(stateDir(P), { report: () => {} }), readEnrolled(), { now: at('2026-10-19T06:01:00.000Z') });
  assert.equal(views.settings.pace.value, 2);
  assert.deepEqual(views.settings.pace.before, { value: 1 });

  // An away that ends hands back to what was in force when it was pressed.
  const own = fake({ from: '2026-10-19T06:10:00.000Z' });
  await press(own, 'presence', 'dnd-open', { now: at('2026-10-19T06:10:00.000Z') });
  await press(own, 'presence', 'away-hours', { now: at('2026-10-19T06:20:00.000Z') });
  const profile = buildViews(listEvents(profileDir(), { report: () => {} }), readEnrolled(), { now: at('2026-10-19T06:30:00.000Z') });
  assert.deepEqual(profile.settings.presence.before, { value: 'dnd' });
  const later = effectiveSettings({ profile: profile.settings, now: at('2026-10-19T09:00:00.000Z') });
  assert.equal(later.presence.value, 'dnd');
}));

test('protection, notifications and working hours offer no choice and say where they change', () => {
  const now = at('2026-10-19T05:00:00.000Z');
  const effective = effectiveSettings({
    profile: {
      notifications: { key: 'notifications', value: { channels: ['claude', 'ntfy'], quiet: { from: '22:00', to: '07:00' } }, id: 'n', at: '2026-10-18T00:00:00.000Z', before: null },
    },
    now,
  });
  for (const locked of [true, false, undefined]) {
    const rows = settingsRows({ effective, now, timeZone: SYDNEY, locked });
    for (const key of ['protection', 'notifications', 'hours', 'briefingGapHours']) {
      const row = rowOf(rows, key);
      assert.deepEqual([row.choices, row.here, row.why], [[], false, 'Changed by asking the First Mate'], key);
    }
    assert.equal(rowOf(rows, 'protection').current, locked === true ? 'Locked' : locked === false ? 'Standard' : 'Ask the First Mate');
  }
  const rows = settingsRows({ effective, now, timeZone: SYDNEY });
  assert.equal(rowOf(rows, 'notifications').current, 'claude, ntfy, quiet from 22:00 to 07:00');
  assert.equal(rowOf(rows, 'notifications').from, 'yours');
  assert.equal(rowOf(rows, 'hours').current, 'no set hours');
  assert.equal(rowOf(rows, 'briefingGapHours').current, '2 hours');
  assert.equal(rowOf(rows, 'briefingGapHours').from, 'the default');
  // None of them can be pressed.
  return withKey(async () => {
    const client = fake();
    for (const key of ['protection', 'notifications', 'hours', 'briefingGapHours']) assert.equal((await press(client, key, '2')).made, false);
    assert.equal(nothingSent(client), 0);
  });
});

test('budget offers no other level while budget allocation is in the backlog', () => withKey(async () => {
  const now = at('2026-10-19T05:00:00.000Z');
  const budget = rowOf(settingsRows({ effective: effectiveSettings({ now }), now, timeZone: SYDNEY }), 'budget');
  assert.deepEqual([budget.current, budget.choices, budget.here, budget.why, budget.from], ['Report only', [], false, 'The other budget levels come with the budget design', 'the default']);
  assert.deepEqual(SETTINGS.budget.only, ['report']);
  const client = fake();
  assert.equal((await press(client, 'budget', 'report')).made, false);
  assert.equal(choiceOf('budget', 'report', { now, timeZone: SYDNEY }), null);
  assert.equal(nothingSent(client), 0);
}));

test('under STOP a choice records nothing and says when it can', () => withKey(async () => {
  const client = fake({ stop: true });
  for (const [key, choice] of [['pace', '2'], ['presence', 'away-hours'], ['briefing', 'short']]) {
    assert.deepEqual(await press(client, key, choice), { made: false, says: 'Settings can\'t change while All stop is on. Lift All stop first.' });
  }
  // The helper refused every write; nothing was signed, kept or recorded.
  assert.equal(client.calls.record.length + client.calls.profileRecord.length, 0);
  assert.deepEqual(pendingFiles(), []);
  assert.deepEqual(listEvents(stateDir(P), { report: () => {} }), []);
  assert.deepEqual(listEvents(profileDir(), { report: () => {} }), []);
  // With the real STOP file too: the helper's refusal is the word on it.
  setStop({ by: 'mod' });
  assert.equal((await press(fake({ stop: true }), 'pace', '1')).says, 'Settings can\'t change while All stop is on. Lift All stop first.');
}));

test('a helper that is down or refuses leaves the setting as it was', () => withKey(async () => {
  const down = fake({ down: true });
  assert.deepEqual(await press(down, 'pace', '2'), { made: false, says: 'That setting couldn\'t be changed now: the helper didn\'t take it' });
  assert.equal(down.calls.record.length, 0);
  assert.deepEqual(pendingFiles(), []);
  const throwing = { state: { write: async () => { throw new Error('boom'); } } };
  assert.equal((await press(throwing, 'pace', '2')).made, false);
  // A profile that isn't set up answers { ok: false, why }.
  const unset = { profile: { write: async () => ({ ok: false, why: 'the profile is not set up' }) } };
  assert.equal((await press(unset, 'briefing', 'short')).made, false);
  // An answer without an id is not one to confirm.
  const noId = { state: { write: async () => ({ ok: true }) } };
  assert.equal((await press(noId, 'pace', '2')).says, 'Crew at once was set but not confirmed, so it waits for your Confirm');
}));

test('setting is refused for any origin but pane', () => withKey(async () => {
  const calls = [];
  const pressSettingSpy = async (args) => {
    calls.push(args);
    return { made: true, says: 'Crew at once is now 2, for this project' };
  };
  const client = fake();
  const request = { cmd: 'setting', cwd: '/work', key: 'pace', choice: '2' };
  const deps = (extra = {}) => ({ now: () => new Date('2026-10-19T05:00:00.000Z'), projectOf: () => ({ project: P }), pressSetting: pressSettingSpy, client, timeZone: SYDNEY, ...extra });
  for (const origin of ['composer', 'bridge', 'sdk', 'peer', 'Pane', '', undefined, ['pane']]) {
    assert.deepEqual(await handle({ ...request, origin }, deps()), { ok: false, says: 'Only a press in the pane counts as one' });
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await handle({ ...request, origin: 'pane' }, deps()), { ok: true, says: 'Crew at once is now 2, for this project' });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].project, calls[0].key, calls[0].choice, calls[0].client, calls[0].timeZone], [P, 'pace', '2', client, SYDNEY]);
  assert.deepEqual(await handle({ ...request, origin: 'pane' }, deps({ projectOf: () => null })), { ok: false, says: 'This isn\'t a Wheelhouse project' });
  const refused = async () => ({ made: false, says: 'Settings can\'t change while All stop is on. Lift All stop first.' });
  assert.deepEqual(await handle({ ...request, origin: 'pane' }, deps({ pressSetting: refused })), { ok: false, says: 'Settings can\'t change while All stop is on. Lift All stop first.' });

  // Through the real code: the origin gates the press and the press records.
  assert.deepEqual(await handle({ ...request, origin: 'composer' }, { now: () => new Date('2026-10-19T05:00:00.000Z'), projectOf: () => ({ project: P }), client }), { ok: false, says: 'Only a press in the pane counts as one' });
  assert.equal(nothingSent(client), 0);
  const real = await handle({ ...request, origin: 'pane' }, { now: () => new Date('2026-10-19T05:00:00.000Z'), projectOf: () => ({ project: P }), client });
  assert.deepEqual(real, { ok: true, says: 'Crew at once is now 2, for this project' });
  assert.deepEqual(client.calls.order, ['write', 'record']);
}));

test('settings answers the rows from the views, in the bridge\'s zone, with the advanced settings line', () => withKey(async () => {
  const project = makeEvent({ kind: 'setting', data: { key: 'pace', value: 2 }, now: at('2026-10-19T04:00:00.000Z') });
  keepEvent(stateDir(P), project);
  keepEvent(stateDir(P), makeEvent({ kind: 'confirmation', data: { confirms: project.id, confirmsHash: eventHash(project) }, now: at('2026-10-19T04:01:00.000Z') }));
  // The views as the helper leaves them.
  const views = buildViews(listEvents(stateDir(P), { report: () => {} }), readEnrolled(), { now: at('2026-10-19T05:00:00.000Z') });
  const folder = path.join(stateDir(P), '..', 'views');
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, value] of Object.entries(views)) fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify(value));

  const deps = (extra = {}) => ({ now: () => new Date('2026-10-19T06:59:00.000Z'), projectOf: () => ({ project: P, locked: true }), timeZone: SYDNEY, ...extra });
  const answer = await handle({ cmd: 'settings', cwd: '/work' }, deps());
  assert.equal(answer.ok, true);
  assert.equal(answer.text, 'Advanced settings: ask the First Mate');
  assert.equal(rowOf(answer.rows, 'pace').current, '2');
  assert.equal(rowOf(answer.rows, 'pace').from, 'this project');
  assert.equal(rowOf(answer.rows, 'protection').current, 'Locked');
  assert.equal(ids(rowOf(answer.rows, 'presence')).includes('away-evening'), true);
  // The bridge's zone sets the clock: the same instant in Auckland is past 18:00 there.
  const auckland = await handle({ cmd: 'settings', cwd: '/work' }, deps({ timeZone: 'Pacific/Auckland' }));
  assert.equal(ids(rowOf(auckland.rows, 'presence')).includes('away-evening'), false);
  // lineOf lets the rows and the line through.
  const line = JSON.parse(lineOf(answer));
  assert.deepEqual(line.rows, answer.rows);
  assert.equal(line.text, answer.text);
  // The groups come with the rows, with STOP as it is now.
  assert.deepEqual(answer.groups.map((g) => g.id), ['stop', 'project', 'you', 'advanced']);
  assert.equal(groupRow(answer.groups, 'pace').value, '2');
  assert.equal(groupRow(answer.groups, 'builders').value, 'Working');
  assert.deepEqual(line.groups, answer.groups);
  // Outside a project, nothing is read.
  assert.deepEqual(await handle({ cmd: 'settings', cwd: '/work' }, deps({ projectOf: () => null })), { ok: false, says: 'This isn\'t a Wheelhouse project' });
  // The default zone is the bridge's own.
  const own = await handle({ cmd: 'settings', cwd: '/work' }, { now: deps().now, projectOf: () => ({ project: P }) });
  assert.equal(own.ok, true);
}));

test('a read-back event with another value or end time is not signed', () => withKey(async () => {
  // The helper answers the id of a setting that isn't the one pressed.
  const other = (data) => {
    const calls = { record: [] };
    return {
      calls,
      state: {
        write: async () => {
          const event = makeEvent({ kind: 'setting', data, now: at('2026-10-19T05:00:00.000Z') });
          keepEvent(stateDir(P), event);
          return { ok: true, id: event.id, pushed: true };
        },
        record: async (b) => { calls.record.push(b); return { ok: true }; },
      },
    };
  };
  for (const data of [{ key: 'pace', value: 1 }, { key: 'autonomy', value: 'cautious' }]) {
    const client = other(data);
    assert.deepEqual(await press(client, 'pace', '2'), { made: false, says: 'Crew at once was set but not confirmed, so it waits for your Confirm' });
    assert.equal(client.calls.record.length, 0);
    assert.deepEqual(pendingFiles(), []);
  }
  // An end time that differs: the setting pressed has none, the one read back has one.
  const timed = other({ key: 'pace', value: 2, until: '2026-10-19T09:00:00.000Z' });
  assert.equal((await press(timed, 'pace', '2')).made, false);
  assert.equal(timed.calls.record.length, 0);
}));

test('a write that times out is said apart from one that was refused', () => withKey(async () => {
  const late = 'The helper didn\'t answer in time; if the change lands, it waits for your Confirm';
  // The helper client's own answer when the helper is slow.
  const slow = { state: { write: async () => ({ ok: false, refused: 'the host helper did not answer in time' }) } };
  assert.deepEqual(await press(slow, 'pace', '2'), { made: false, says: late });
  // The press's own budget runs out first.
  const never = { state: { write: () => new Promise(() => {}) } };
  assert.deepEqual(await pressSetting({ project: P, key: 'pace', choice: '2', client: never, now: at('2026-10-19T05:00:00.000Z'), timeZone: SYDNEY, budget: 30 }), { made: false, says: late });
  // A write that throws has no answer either.
  const throwing = { state: { write: async () => { throw new Error('boom'); } } };
  assert.equal((await press(throwing, 'pace', '2')).says, late);
  // Refusals are said as refusals.
  assert.equal((await press(fake({ down: true }), 'pace', '2')).says, 'That setting couldn\'t be changed now: the helper didn\'t take it');
  assert.equal((await press(fake({ stop: true }), 'pace', '2')).says, 'Settings can\'t change while All stop is on. Lift All stop first.');
  assert.deepEqual(pendingFiles(), []);
}));

// The views as the helper leaves them, for the project's clone.
function syncViews(now) {
  const views = buildViews(listEvents(stateDir(P), { report: () => {} }), readEnrolled(), { now });
  const folder = path.join(stateDir(P), '..', 'views');
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, value] of Object.entries(views)) fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify(value));
}

test('undo within a minute sets the value before, signed and confirmed', () => withKey(async () => {
  assert.equal(UNDO_MS, 60000);
  // Pace 3 is the default; the press sets 2 and its confirmation lands a minute later in the fake,
  // so the clock of the press is what counts.
  const first = fake();
  assert.equal((await press(first, 'pace', '1')).made, true);
  const second = fake({ from: '2026-10-19T05:02:00.000Z' });
  assert.equal((await press(second, 'pace', '2', { now: at('2026-10-19T05:02:00.000Z') })).made, true);
  syncViews(at('2026-10-19T05:02:30.000Z'));
  const soon = at('2026-10-19T05:02:40.000Z');
  const changes = changesFor({ project: P });
  assert.equal(changes.pace.before.value, 1);
  const row = rowOf(settingsRows({ effective: effectiveSettings({ project: JSON.parse(fs.readFileSync(path.join(stateDir(P), '..', 'views', 'settings.json'), 'utf8')), now: soon }), changes, now: soon, timeZone: SYDNEY }), 'pace');
  assert.deepEqual(row.changed, { at: changes.pace.at, undo: true });

  const client = fake({ from: '2026-10-19T05:02:40.000Z' });
  const said = await press(client, 'pace', 'undo', { now: soon });
  assert.deepEqual(said, { made: true, says: 'Crew at once is now 1, for this project' });
  assert.deepEqual(client.calls.order, ['write', 'record']);
  assert.deepEqual(client.calls.write, [{ project: P, kind: 'setting', data: { key: 'pace', value: 1 } }]);
  const latest = listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === 'setting').pop();
  assert.equal(verify(client.calls.record[0].event, readEnrolled()), true);
  assert.deepEqual(client.calls.record[0].event.data, { confirms: latest.id, confirmsHash: eventHash(latest) });
}));

test('undo after a minute, or with nothing changed, records nothing', () => withKey(async () => {
  const first = fake();
  await press(first, 'pace', '1');
  syncViews(at('2026-10-19T05:00:30.000Z'));
  const nothing = { made: false, says: 'There\'s nothing to undo now' };
  const late = { made: false, says: 'It\'s too late to undo that. Undo lasts one minute.' };
  const client = fake();
  // Confirmed a minute earlier or more: the row offers no Undo, and a late press says it is too late.
  for (const when of ['2026-10-19T05:02:00.000Z', '2026-10-19T06:00:00.000Z']) {
    const now = at(when);
    assert.deepEqual(await press(client, 'pace', 'undo', { now }), late);
    const changes = changesFor({ project: P });
    assert.equal(rowOf(settingsRows({ effective: effectiveSettings({ now }), changes, now, timeZone: SYDNEY }), 'pace').changed, undefined);
  }
  // A setting never changed, and one that offers no choice.
  assert.deepEqual(await press(client, 'briefing', 'undo', { now: at('2026-10-19T05:00:30.000Z') }), nothing);
  assert.deepEqual(await press(client, 'budget', 'undo'), nothing);
  assert.equal(nothingSent(client), 0);
  assert.deepEqual(pendingFiles(), []);
}));

test('undo under STOP records nothing and says Settings can\'t change while STOP is on', () => withKey(async () => {
  const first = fake();
  await press(first, 'pace', '1');
  syncViews(at('2026-10-19T05:00:30.000Z'));
  setStop({ by: 'mod' });
  const client = fake({ stop: true });
  const now = at('2026-10-19T05:00:40.000Z');
  assert.deepEqual(await press(client, 'pace', 'undo', { now }), { made: false, says: 'Settings can\'t change while All stop is on. Lift All stop first.' });
  assert.deepEqual(await press(client, 'pace', '2', { now }), { made: false, says: 'Settings can\'t change while All stop is on. Lift All stop first.' });
  assert.equal(nothingSent(client), 0);
}));

// --- the groups ---

const groupsAt = (iso, extra = {}) => {
  const now = at(iso);
  return settingsGroups({ effective: effectiveSettings({ now }), now, timeZone: SYDNEY, ...extra });
};
const groupRows = (groups, id) => groups.find((g) => g.id === id).rows;
const groupRow = (groups, key) => groups.flatMap((g) => g.rows).find((r) => r.key === key);

test('the four plainer names show, and the keys stay', () => {
  assert.deepEqual(['presence', 'pace', 'efficiency', 'boardTab'].map((k) => SETTINGS[k].label), ['Availability', 'Crew at once', 'Thoroughness', 'Logbook opens on']);
  const groups = groupsAt('2026-10-19T05:00:00.000Z');
  assert.deepEqual(['presence', 'pace', 'efficiency', 'boardTab'].map((k) => groupRow(groups, k).label), ['Availability', 'Crew at once', 'Thoroughness', 'Logbook opens on']);
});

test('the groups come in order, with their notes word for word', () => {
  const groups = groupsAt('2026-10-19T05:00:00.000Z');
  assert.deepEqual(groups.map((g) => [g.id, g.title]), [['stop', 'All stop'], ['project', 'This project'], ['you', 'You, in every project'], ['advanced', 'Advanced settings']]);
  assert.equal(groups[0].note, 'All stop halts the whole Crew at once. Only you can lift it.');
  assert.equal(groups[1].note, 'Only for this project. A pick changes it at once and counts as your confirmation; Undo stays for a minute. Protection and build commands need your password or a careful yes, so the First Mate asks for them.');
  assert.equal(groups[2].note, 'These follow you to every project. Notifications and working hours are changed with the First Mate, which checks them with you.');
  assert.deepEqual(groups[1].rows.map((r) => r.label), [
    'Autonomy', 'Show before building', 'Feature milestones', 'Crew at once', 'Thoroughness', 'Product phase', 'Build commands on Windows', 'Budget', 'Protection',
  ]);
  assert.deepEqual(groups[2].rows.map((r) => r.label), [
    'Availability', 'Briefing length', 'Hours before a new briefing', 'Explanations', 'Usage nudge', 'Logbook opens on', 'Notifications', 'Working hours',
  ]);
  assert.deepEqual(groups[3].rows.map((r) => [r.label, r.kind]), [['Advanced settings', 'change']]);
  assert.deepEqual(JSON.parse(JSON.stringify(groups)), groups);
});

test('a setting with levels is a select with its options and the value in force', () => {
  const now = at('2026-10-19T05:00:00.000Z');
  const effective = effectiveSettings({ project: { pace: { key: 'pace', value: 2, id: 'a', at: '2026-10-18T00:00:00.000Z', before: null } }, now });
  const groups = settingsGroups({ effective, now, timeZone: SYDNEY });
  const pace = groupRow(groups, 'pace');
  assert.deepEqual(pace, { key: 'pace', label: 'Crew at once', value: '2', kind: 'select', options: [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }] });
  const autonomy = groupRow(groups, 'autonomy');
  assert.equal(autonomy.value, 'balanced');
  assert.deepEqual(autonomy.options, [{ value: 'cautious', label: 'Cautious' }, { value: 'balanced', label: 'Balanced' }, { value: 'trusting', label: 'Trusting' }]);
  // Availability's options are its six choices, worked out now.
  const availability = groupRow(groups, 'presence');
  assert.equal(availability.value, 'here');
  assert.deepEqual(availability.options.map((o) => o.value), ['here', 'away-hours', 'away-evening', 'away-morning', 'dnd-morning', 'dnd-open']);
  assert.equal(availability.options[3].label, 'Away until 09:00 tomorrow');
});

test('Protection, Build commands on Windows, Notifications, Working hours and the briefing gap offer Change…', () => {
  const groups = groupsAt('2026-10-19T05:00:00.000Z', { windows: 'guarded', locked: true });
  for (const key of ['protection', 'windowsBuildCommands', 'notifications', 'hours', 'briefingGapHours', 'advanced']) {
    assert.equal(groupRow(groups, key).kind, 'change', key);
  }
  assert.equal(groupRow(groups, 'protection').value, 'Locked');
  assert.equal(groupRow(groups, 'windowsBuildCommands').value, 'Guarded');
  assert.equal(groupRow(groupsAt('2026-10-19T05:00:00.000Z'), 'windowsBuildCommands').value, 'Ask');
  assert.equal(groupRow(groups, 'briefingGapHours').value, '2 hours');
  assert.equal(groupRow(groups, 'notifications').value, 'claude');
  assert.equal(groupRow(groups, 'hours').value, 'no set hours');
});

test('Budget shows Report only alone', () => {
  assert.deepEqual(groupRow(groupsAt('2026-10-19T05:00:00.000Z'), 'budget'), { key: 'budget', label: 'Budget', value: 'Report only', kind: 'value' });
});

test('the STOP group says Working, or Halted since a time', () => {
  const working = groupRows(groupsAt('2026-10-19T05:00:00.000Z', { stop: { on: false } }), 'stop');
  assert.deepEqual(working, [{ key: 'builders', label: 'Crew', value: 'Working', kind: 'value' }]);
  assert.equal(groupRows(groupsAt('2026-10-19T05:00:00.000Z'), 'stop')[0].value, 'Working');
  // 03:05 UTC is 14:05 in Sydney's daylight time.
  assert.equal(groupRows(groupsAt('2026-10-19T05:00:00.000Z', { stop: { on: true, by: 'mod', at: '2026-10-19T03:05:00.000Z' } }), 'stop')[0].value, 'Halted since 14:05');
  assert.equal(groupRows(groupsAt('2026-10-19T05:00:00.000Z', { stop: { on: true } }), 'stop')[0].value, 'Halted');
});

test('a row changed less than a minute ago carries changed with undo', () => {
  const now = at('2026-10-19T05:00:30.000Z');
  const effective = effectiveSettings({ project: { pace: { key: 'pace', value: 2, id: 'a', at: '2026-10-19T05:00:00.000Z', before: null } }, now });
  const changes = { pace: { at: '2026-10-19T05:00:00.000Z', before: null } };
  const groups = settingsGroups({ effective, changes, now, timeZone: SYDNEY });
  assert.deepEqual(groupRow(groups, 'pace').changed, { at: '2026-10-19T05:00:00.000Z', undo: true });
  assert.equal(groupRow(groups, 'autonomy').changed, undefined);
  const later = settingsGroups({ effective, changes, now: at('2026-10-19T05:01:00.000Z'), timeZone: SYDNEY });
  assert.equal(groupRow(later, 'pace').changed, undefined);
});

test('the bridge shows this computer\'s build-command level, not another\'s', async () => {
  const entry = (computer, value) => ({ key: `windowsBuildCommands:${computer}`, value, from: 'project' });
  const effective = { 'windowsBuildCommands:aaaaaaaa': entry('aaaaaaaa', 'unattended'), 'windowsBuildCommands:bbbbbbbb': entry('bbbbbbbb', 'guarded') };
  const ask = (computer) => handle({ cmd: 'settings', cwd: '/work' }, {
    now: at('2026-10-19T06:59:00.000Z'), projectOf: () => ({ project: P }), timeZone: SYDNEY, computer: () => computer,
    readEffective: () => effective, readChanges: () => ({}), stopState: () => ({ on: false }),
  });
  assert.equal(groupRow((await ask('bbbbbbbb')).groups, 'windowsBuildCommands').value, 'Guarded');
  assert.equal(groupRow((await ask('aaaaaaaa')).groups, 'windowsBuildCommands').value, 'Unattended');
  assert.equal(groupRow((await ask('cccccccc')).groups, 'windowsBuildCommands').value, 'Ask');
});

// --- Thoroughness, the premium model and the usage nudge ---

test('Thoroughness offers four levels, and a level not ready reads so; Balanced and Thorough are always ready', () => {
  const groups = groupsAt('2026-10-19T05:00:00.000Z');
  assert.deepEqual(groupRow(groups, 'efficiency').options, [
    { value: 'lightest', label: 'Lightest: not ready yet' },
    { value: 'lean', label: 'Lean: not ready yet' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'thorough', label: 'Thorough' },
  ]);
  const lean = groupRow(groupsAt('2026-10-19T05:00:00.000Z', { ready: ['lean'] }), 'efficiency');
  assert.deepEqual(lean.options.map((o) => o.label), ['Lightest: not ready yet', 'Lean', 'Balanced', 'Thorough']);
});

test('a pick of a level that is not ready records nothing and says so', () => withKey(async () => {
  const client = fake();
  assert.deepEqual(await press(client, 'efficiency', 'lean'), { made: false, says: 'Lean isn\'t ready yet, so Thoroughness stays as it is' });
  assert.equal(nothingSent(client), 0);
  assert.equal((await press(fake(), 'efficiency', 'thorough')).made, true);
  assert.equal((await pressSetting({ project: P, key: 'efficiency', choice: 'lean', client: fake(), now: at('2026-10-19T05:00:00.000Z'), timeZone: SYDNEY, ready: ['lean'] })).made, true);
}));

test('Premium model shows, as a Change… row, at Thorough or while allowed, and never on an account found without it', () => {
  const now = at('2026-10-19T05:00:00.000Z');
  const project = (efficiency, premium) => ({
    efficiency: { key: 'efficiency', value: efficiency, id: 'e', at: '2026-10-19T04:00:00.000Z' },
    ...(premium === undefined ? {} : { premium: { key: 'premium', value: premium, id: 'p', at: '2026-10-19T04:00:00.000Z' } }),
  });
  const groups = (efficiency, premiumSetting, premium) => settingsGroups({ effective: effectiveSettings({ project: project(efficiency, premiumSetting), now }), now, timeZone: SYDNEY, premium });
  // Below Thorough and off: no row; a pin in the configuration never makes one.
  assert.equal(groupRow(groupsAt('2026-10-19T05:00:00.000Z'), 'premium'), undefined);
  assert.equal(groupRow(groups('balanced', undefined, { value: 'off', absent: false }), 'premium'), undefined);
  // At Thorough, where its card is offered: the row, with Change…, which asks the front desk.
  const thorough = groups('thorough', undefined, { value: 'off', absent: false });
  assert.deepEqual(groupRow(thorough, 'premium'), { key: 'premium', label: 'Premium model', value: 'off', kind: 'change' });
  assert.deepEqual(groupRows(thorough, 'project').map((r) => r.key).slice(4, 7), ['efficiency', 'premium', 'phase']);
  assert.ok(groupRow(groups('thorough', undefined, null), 'premium'));
  // Allowed below Thorough: it says it isn't in use there.
  assert.equal(groupRow(groups('balanced', 'within-plan', { value: 'within-plan', absent: false }), 'premium').value, 'on, within your plan (not in use at Balanced)');
  assert.equal(groupRow(groups('thorough', 'paid-too', { value: 'paid-too', absent: false }), 'premium').value, 'on, paid credits too');
  // An account the helper's check found without it: never the row.
  assert.equal(groupRow(groups('thorough', undefined, { value: 'off', absent: true }), 'premium'), undefined);
  assert.equal(premiumRowShown({ absent: true, value: 'paid-too' }, 'thorough'), false);
});

test('Usage nudge is a pop-up in the group for every project, at 75% by default', () => {
  const nudge = groupRow(groupsAt('2026-10-19T05:00:00.000Z'), 'usageMark');
  assert.equal(nudge.kind, 'select');
  assert.equal(nudge.value, '75');
  assert.deepEqual(nudge.options.map((o) => o.label), ['Off', 'At 50%', 'At 65%', 'At 75%', 'At 90%']);
  assert.ok(groupRows(groupsAt('2026-10-19T05:00:00.000Z'), 'you').some((r) => r.key === 'usageMark'));
});

test('while Lightest is in force the project note adds its warning', () => {
  const now = at('2026-10-19T05:00:00.000Z');
  const effective = effectiveSettings({ project: { efficiency: { key: 'efficiency', value: 'lightest', id: 'a', at: '2026-10-18T00:00:00.000Z', before: null } }, now });
  const note = settingsGroups({ effective, now, timeZone: SYDNEY }).find((g) => g.id === 'project').note;
  assert.ok(note.endsWith(' Lightest: the lighter model also designs and checks risky work, so mistakes are likelier to slip through. Every check still runs.'));
  assert.ok(!groupsAt('2026-10-19T05:00:00.000Z').find((g) => g.id === 'project').note.includes('Lightest'));
});
